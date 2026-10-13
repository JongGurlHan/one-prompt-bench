import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GenerationRequest } from '@opb/core';
import { RAW_STDOUT_FILE } from '../src/adapters/cli-recorder.js';
import type { CodexCommand } from '../src/adapters/codex/codex.bin.js';
import { CodexAdapter } from '../src/adapters/codex/codex.adapter.js';
import { createCodexEntry, type CodexEntryDeps } from '../src/adapters/registry.js';
import {
  CODEX_PARENT_ENV,
  FAKE_CODEX_COMMAND,
  FAKE_CODEX_VERSION,
  codexExited,
  fakeCodex,
  loadLoginStatus,
  loadStdout,
  loginStatus,
} from './codex-fakes.js';

/* ───────── 레지스트리의 codex-cli 항목: 실행 함수·실행 명령 찾기·버전 읽기를 가짜로 주입 (실제 codex 없음) ───────── */

const req: GenerationRequest = {
  modelId: 'gpt-6.1-sol',
  system: 'sys\n',
  user: 'Hello\n',
  reasoningEffort: 'high',
  maxOutputTokens: null,
};
const config = { repoRoot: '/r', dotenv: { GEMINI_API_KEY: 'fake-gemini-key-not-real-0000' } };

async function spies(overrides: Partial<CodexEntryDeps> = {}) {
  const calls: string[] = [];
  const cli = fakeCodex({
    login: loginStatus(await loadLoginStatus('chatgpt')),
    runs: [codexExited(await loadStdout('ok'))],
  });
  const deps: CodexEntryDeps = {
    runCli: (r) => {
      calls.push(`run ${r.args.find((a) => a === 'login' || a === 'exec')}`);
      return cli(r);
    },
    resolveCommand: () => {
      calls.push('resolveCommand');
      return FAKE_CODEX_COMMAND;
    },
    readVersion: (command: CodexCommand) => {
      calls.push(`readVersion ${command.bin}`);
      return FAKE_CODEX_VERSION;
    },
    env: () => CODEX_PARENT_ENV,
    ...overrides,
  };
  return { deps, calls, cli };
}

test('항목을 만들 때는 아무것도 실행하지 않는다 (실행 명령 찾기·버전·로그인 점검 모두 나중에)', async () => {
  const { deps, calls } = await spies();
  createCodexEntry(deps);
  assert.deepEqual(calls, []);
});

test('create: 실행 명령을 찾고 버전을 읽어 어댑터를 만든다. 생성은 주입한 실행 함수로, 환경은 정리해서', async () => {
  const { deps, calls, cli } = await spies();
  const adapter = createCodexEntry(deps).create(config);

  assert.ok(adapter instanceof CodexAdapter);
  assert.equal(adapter.provider, 'openai');
  assert.deepEqual(adapter.generator, { tool: 'codex-cli', version: FAKE_CODEX_VERSION });
  assert.equal(adapter.supportsMaxOutputTokens, false);
  assert.deepEqual(calls, ['resolveCommand', `readVersion ${FAKE_CODEX_COMMAND.bin}`], '어댑터를 만들 때 모델을 부르지 않는다');

  const res = await adapter.generate(req, new AbortController().signal);
  assert.match(res.text, /```html/);
  const sent = cli.generation.requests[0]!;
  assert.equal(sent.bin, FAKE_CODEX_COMMAND.bin);
  assert.deepEqual(sent.args.slice(0, FAKE_CODEX_COMMAND.prefixArgs.length + 1), [...FAKE_CODEX_COMMAND.prefixArgs, 'exec']);
  assert.equal(sent.env.OPENAI_API_KEY, undefined);
  assert.equal(sent.env.ANTHROPIC_API_KEY, undefined);
  assert.equal(sent.env.CLAUDECODE, undefined);
  assert.equal(sent.env.CODEX_HOME, CODEX_PARENT_ENV.CODEX_HOME);
  assert.ok(!Object.values(sent.env).includes(config.dotenv.GEMINI_API_KEY), '.env 값을 자식 환경에 넣지 않는다');
});

test('create: 실행 명령을 못 찾거나 버전을 못 읽으면 어댑터를 만들지 않고 멈춘다 (모델을 부르지 않는다)', async () => {
  const missing = await spies({
    resolveCommand: () => {
      throw new Error('codex 실행 파일을 PATH에서 찾지 못했습니다');
    },
  });
  assert.throws(() => createCodexEntry(missing.deps).create(config), /PATH/);
  assert.equal(missing.cli.requests.length, 0);

  const badVersion = await spies({
    readVersion: () => {
      throw new Error('codex --version 출력에서 버전 숫자를 읽지 못했습니다');
    },
  });
  assert.throws(() => createCodexEntry(badVersion.deps).create(config), /버전/);
  assert.equal(badVersion.cli.requests.length, 0);
});

test('preflight: 주입한 실행 명령·실행 함수로 codex login status를 부른다', async () => {
  const { deps, cli, calls } = await spies();
  const checks = await createCodexEntry(deps).preflight!();
  assert.equal(checks.length, 1);
  assert.equal(checks[0]?.ok, true, checks[0]?.detail ?? '');
  assert.deepEqual(cli.login.requests[0]?.args, [...FAKE_CODEX_COMMAND.prefixArgs, 'login', 'status']);
  assert.equal(cli.generation.requests.length, 0);
  assert.ok(!calls.some((c) => c.startsWith('readVersion')), '로그인 점검은 버전을 읽지 않는다');
});

test('preflight: 로그인 실패도 throw하지 않고 실패 항목으로', async () => {
  const { deps } = await spies({ runCli: async () => loginStatus(await loadLoginStatus('not-logged-in'), 1) });
  const checks = await createCodexEntry(deps).preflight!();
  assert.equal(checks[0]?.ok, false);
});

test('smoke 기록기: wrapClient로 감싼 생성 호출만 기록한다 (로그인 점검은 기록하지 않는다)', async () => {
  const { deps } = await spies();
  const entry = createCodexEntry(deps);
  const recorder = entry.createRecorder!((text) => text);

  await entry.preflight!();
  const adapter = entry.create(config, { wrapClient: (run) => recorder.wrap(run) });
  await adapter.generate(req, new AbortController().signal);

  const stdout = recorder.files().find((f) => f.name === RAW_STDOUT_FILE)?.content;
  assert.equal(stdout, await loadStdout('ok'), '생성 호출의 stdout(JSONL 그대로, login status 출력이 아니다)');
});

test('env 주입: 기본 실행 명령 찾기는 주입한 환경의 PATH로 찾는다 (PATH에 없으면 throw, 아무것도 띄우지 않는다)', async () => {
  const { cli } = await spies();
  const entry = createCodexEntry({ runCli: cli, env: () => ({ PATH: '', PATHEXT: '.EXE' }) });
  assert.throws(() => entry.create(config), /codex 실행 파일을 PATH에서 찾지 못했습니다/);
  assert.equal(cli.requests.length, 0);
});
