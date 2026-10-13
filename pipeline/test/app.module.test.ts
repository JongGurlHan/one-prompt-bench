import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { chromium } from 'playwright';
import { registeredTools, type AdapterRegistry } from '../src/adapters/registry.js';
import { AppModule } from '../src/app.module.js';
import { defaultRepoRoot } from '../src/config/config.js';
import { BatchService } from '../src/generation/batch.service.js';
import { GenerationRunner } from '../src/generation/generation-runner.js';
import { SmokeService } from '../src/generation/smoke.service.js';
import { JudgeService } from '../src/judging/judge.service.js';
import type { Ask } from '../src/system/ask.js';
import type { Confirm } from '../src/system/confirm.js';
import type { GitClient } from '../src/system/git.js';
import {
  ADAPTERS,
  ASK,
  CLOCK,
  CONFIRM,
  GIT,
  OUTPUT,
  REPO_ROOT,
  VALIDATOR,
  type Clock,
  type Output,
} from '../src/tokens.js';
import { ValidateService } from '../src/validation/validate.service.js';
import { PlaywrightValidator, type Validator } from '../src/validation/validator.js';

test('AppModule: @Inject(CLOCK)로 받은 시계가 서비스에 들어오고 동작한다 (tsx, 메타데이터 없이)', async () => {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const runner = app.get(GenerationRunner);
    assert.ok(runner.clock, 'CLOCK이 주입되지 않았다 (emitDecoratorMetadata 없이 타입 기반 주입을 썼는지 확인)');
    assert.equal(runner.clock, app.get<Clock>(CLOCK));

    const before = Date.now();
    const now = runner.clock.now();
    assert.ok(now instanceof Date);
    assert.ok(Math.abs(now.getTime() - before) < 5_000);
    await runner.clock.sleep(1);
  } finally {
    await app.close();
  }
});

test('AppModule: BatchService의 모든 의존성이 @Inject(TOKEN)으로 들어온다 (컨텍스트 생성은 .env를 읽지 않는다)', async () => {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const batch = app.get(BatchService);
    assert.equal(batch.repoRoot, app.get<string>(REPO_ROOT));
    assert.equal(batch.repoRoot, defaultRepoRoot());
    assert.equal(batch.adapters, app.get<AdapterRegistry>(ADAPTERS));
    assert.deepEqual([...registeredTools(batch.adapters)].sort(), ['claude-code', 'codex-cli', 'gemini-api']);
    assert.equal(batch.git, app.get<GitClient>(GIT));
    assert.equal(batch.confirm, app.get<Confirm>(CONFIRM));
    assert.equal(batch.validator, app.get<Validator>(VALIDATOR));
    assert.ok(batch.validator instanceof PlaywrightValidator);
    assert.equal(batch.out, app.get<Output>(OUTPUT));
    assert.equal(batch.runner, app.get(GenerationRunner));
  } finally {
    await app.close();
  }
});

test('AppModule: SmokeService도 같은 레지스트리·git·출력·Runner를 @Inject(TOKEN)으로 받는다', async () => {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const smoke = app.get(SmokeService);
    assert.equal(smoke.repoRoot, app.get<string>(REPO_ROOT));
    assert.equal(smoke.adapters, app.get<AdapterRegistry>(ADAPTERS));
    assert.equal(smoke.git, app.get<GitClient>(GIT));
    assert.equal(smoke.out, app.get<Output>(OUTPUT));
    assert.equal(smoke.runner, app.get(GenerationRunner));
  } finally {
    await app.close();
  }
});

test('AppModule: ValidateService가 VALIDATOR(PlaywrightValidator)·REPO_ROOT·OUTPUT을 @Inject(TOKEN)으로 받는다', async () => {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const validate = app.get(ValidateService);
    assert.equal(validate.repoRoot, app.get<string>(REPO_ROOT));
    assert.equal(validate.validator, app.get<Validator>(VALIDATOR));
    assert.ok(validate.validator instanceof PlaywrightValidator);
    assert.equal(validate.out, app.get<Output>(OUTPUT));
    const validator = validate.validator as PlaywrightValidator;
    assert.equal(validator.repoRoot, app.get<string>(REPO_ROOT));
    assert.equal(validator.out, app.get<Output>(OUTPUT));
  } finally {
    await app.close();
  }
});

test('AppModule: JudgeService가 REPO_ROOT·ASK·CONFIRM·CLOCK·OUTPUT을 @Inject(TOKEN)으로 받는다', async () => {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const judge = app.get(JudgeService);
    assert.equal(judge.repoRoot, app.get<string>(REPO_ROOT));
    assert.equal(judge.ask, app.get<Ask>(ASK));
    assert.equal(typeof judge.ask, 'function');
    assert.equal(judge.confirm, app.get<Confirm>(CONFIRM));
    assert.equal(judge.clock, app.get<Clock>(CLOCK));
    assert.equal(judge.out, app.get<Output>(OUTPUT));
  } finally {
    await app.close();
  }
});

test('AppModule: 컨텍스트를 만들고 닫을 때 브라우저를 띄우지 않는다 (검증할 때만 띄운다)', async (t) => {
  // playwright의 chromium은 모듈 하나뿐인 객체라, 여기서 바꾸면 검증기가 쓰는 launch도 바뀐다
  const launches: unknown[] = [];
  t.mock.method(chromium, 'launch', async (...args: unknown[]) => {
    launches.push(args);
    throw new Error('컨텍스트 생성 중에 브라우저를 띄웠다');
  });

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  app.get<Validator>(VALIDATOR);
  app.get(ValidateService);
  app.get(BatchService);
  await app.close();

  assert.deepEqual(launches, []);
});
