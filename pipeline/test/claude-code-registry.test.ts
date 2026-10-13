import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GenerationRequest } from '@opb/core';
import { ClaudeCodeAdapter } from '../src/adapters/claude-code/claude-code.adapter.js';
import { RAW_STDOUT_FILE } from '../src/adapters/cli-recorder.js';
import { createClaudeCodeEntry, type ClaudeCodeEntryDeps } from '../src/adapters/registry.js';
import {
  FAKE_CLAUDE_BIN,
  FAKE_CLAUDE_VERSION,
  PARENT_ENV,
  exited,
  fakeClaude,
  loadAuthStatus,
  loadStdout,
} from './claude-code-fakes.js';

/* ───────── 레지스트리의 claude-code 항목: 실행 함수·PATH 탐색·버전 읽기를 가짜로 주입 (실제 claude 없음) ───────── */

const req: GenerationRequest = {
  modelId: 'claude-sonnet-5-5',
  system: 'sys\n',
  user: 'Hello\n',
  reasoningEffort: 'high',
  maxOutputTokens: 8_000,
};
const config = { repoRoot: '/r', dotenv: { GEMINI_API_KEY: 'fake-gemini-key-not-real-0000' } };

async function spies(overrides: Partial<ClaudeCodeEntryDeps> = {}) {
  const calls: string[] = [];
  const cli = fakeClaude({ auth: exited(await loadAuthStatus('claude-ai')), runs: [exited(await loadStdout('ok'))] });
  const deps: ClaudeCodeEntryDeps = {
    runCli: (r) => {
      calls.push(`run ${r.args[0]}`);
      return cli(r);
    },
    resolveBin: () => {
      calls.push('resolveBin');
      return FAKE_CLAUDE_BIN;
    },
    readVersion: (bin) => {
      calls.push(`readVersion ${bin}`);
      return FAKE_CLAUDE_VERSION;
    },
    env: () => PARENT_ENV,
    ...overrides,
  };
  return { deps, calls, cli };
}

test('항목을 만들 때는 아무것도 실행하지 않는다 (PATH 탐색·버전·로그인 점검 모두 나중에)', async () => {
  const { deps, calls } = await spies();
  createClaudeCodeEntry(deps);
  assert.deepEqual(calls, []);
});

test('create: 실행 파일을 찾고 버전을 읽어 어댑터를 만든다. 생성은 주입한 실행 함수로, 환경은 정리해서', async () => {
  const { deps, calls, cli } = await spies();
  const adapter = createClaudeCodeEntry(deps).create(config);

  assert.ok(adapter instanceof ClaudeCodeAdapter);
  assert.deepEqual(adapter.generator, { tool: 'claude-code', version: FAKE_CLAUDE_VERSION });
  assert.deepEqual(calls, ['resolveBin', `readVersion ${FAKE_CLAUDE_BIN}`], '어댑터를 만들 때 모델을 부르지 않는다');

  const res = await adapter.generate(req, new AbortController().signal);
  assert.match(res.text, /```html/);
  const sent = cli.generation.requests[0]!;
  assert.equal(sent.bin, FAKE_CLAUDE_BIN);
  assert.equal(sent.env.ANTHROPIC_API_KEY, undefined);
  assert.equal(sent.env.CLAUDECODE, undefined);
  assert.equal(sent.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS, '8000');
  assert.ok(!Object.values(sent.env).includes(config.dotenv.GEMINI_API_KEY), '.env 값을 자식 환경에 넣지 않는다');
});

test('create: 실행 파일을 못 찾거나 버전을 못 읽으면 어댑터를 만들지 않고 멈춘다 (모델을 부르지 않는다)', async () => {
  const missing = await spies({
    resolveBin: () => {
      throw new Error('claude 실행 파일을 PATH에서 찾지 못했습니다');
    },
  });
  assert.throws(() => createClaudeCodeEntry(missing.deps).create(config), /PATH/);
  assert.equal(missing.cli.requests.length, 0);

  const badVersion = await spies({
    readVersion: () => {
      throw new Error('claude --version 출력에서 버전 숫자를 읽지 못했습니다');
    },
  });
  assert.throws(() => createClaudeCodeEntry(badVersion.deps).create(config), /버전/);
  assert.equal(badVersion.cli.requests.length, 0);
});

test('preflight: 주입한 실행 함수로 claude auth status를 부른다', async () => {
  const { deps, cli } = await spies();
  const checks = await createClaudeCodeEntry(deps).preflight!();
  assert.equal(checks.length, 1);
  assert.equal(checks[0]?.ok, true, checks[0]?.detail ?? '');
  assert.deepEqual(cli.auth.requests[0]?.args, ['auth', 'status', '--json']);
  assert.equal(cli.generation.requests.length, 0);
});

test('smoke 기록기: wrapClient로 감싼 생성 호출만 기록한다 (로그인 점검·버전 읽기는 기록하지 않는다)', async () => {
  const { deps } = await spies();
  const entry = createClaudeCodeEntry(deps);
  const recorder = entry.createRecorder!((text) => text);

  await entry.preflight!();
  const adapter = entry.create(config, { wrapClient: (run) => recorder.wrap(run) });
  await adapter.generate(req, new AbortController().signal);

  const stdout = recorder.files().find((f) => f.name === RAW_STDOUT_FILE)?.content;
  assert.equal(stdout, await loadStdout('ok'), '생성 호출의 stdout (auth status 출력이 아니다)');
});
