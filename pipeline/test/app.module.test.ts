import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module.js';
import { GenerationRunner } from '../src/generation/generation-runner.js';
import { CLOCK, type Clock } from '../src/tokens.js';

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
