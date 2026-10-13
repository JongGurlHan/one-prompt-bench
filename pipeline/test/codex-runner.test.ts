import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import {
  DEFAULT_RUN_POLICY,
  GenerationRecordSchema,
  RETRYABLE_FAILURES,
  maxOutputTokensFor,
  runGeneration,
  type ModelEntry,
  type RunInput,
  type RunnerDeps,
} from '@opb/core';
import { CodexAdapter } from '../src/adapters/codex/codex.adapter.js';
import { fakeRunCli, type FakeRun } from './claude-code-fakes.js';
import { CODEX_PARENT_ENV, FAKE_CODEX_COMMAND, FAKE_CODEX_VERSION, codexExited, loadStdout } from './codex-fakes.js';

/* ───────── core Runner + Codex 어댑터 + 가짜 실행 함수 → OS 임시 디렉토리에 meta.json ───────── */

const model: ModelEntry = {
  slug: 'gpt-6-1-sol',
  provider: 'openai',
  modelId: 'gpt-6.1-sol',
  displayName: 'GPT-6.1 Sol',
  releasedAt: '2026-09-29',
  pricing: { inputPer1M: 2, outputPer1M: 10, asOf: '2026-10-10', sourceUrl: 'https://example.com/pricing' },
};

const tmpRoots: string[] = [];
after(async () => {
  await Promise.all(tmpRoots.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function run(script: FakeRun[]) {
  const repoRoot = await mkdtemp(path.join(tmpdir(), 'opb-codex-runner-'));
  tmpRoots.push(repoRoot);
  const cli = fakeRunCli(script);
  const adapter = new CodexAdapter(cli, { command: FAKE_CODEX_COMMAND, version: FAKE_CODEX_VERSION, env: CODEX_PARENT_ENV });
  const sleeps: number[] = [];
  let t = Date.parse('2026-10-13T09:00:00+09:00');
  const deps: RunnerDeps = {
    now: () => new Date((t += 1_000)),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  };
  const input: RunInput = {
    model,
    prompt: { id: 'season-tree', version: 'v1', system: '사용자의 요청에 답하세요.\n', user: '사계절이 바뀌는 3D 나무\n' },
    maxOutputTokens: maxOutputTokensFor(adapter),
    repoRoot,
    outDirRel: `results/${model.slug}`,
    runtime: { gitCommit: 'abc1234', nodeVersion: process.version },
  };
  const record = await runGeneration(adapter, input, DEFAULT_RUN_POLICY, deps);
  const outDir = path.join(repoRoot, input.outDirRel);
  const meta = GenerationRecordSchema.parse(JSON.parse(await readFile(path.join(outDir, 'meta.json'), 'utf8')));
  return { record, meta, cli, sleeps, outDir };
}

const failed = async (name: string) => codexExited(await loadStdout(name), { exitCode: 1 });

function errorKind(meta: Awaited<ReturnType<typeof run>>['meta'], i: number) {
  const result = meta.attempts[i]?.result;
  return result?.type === 'error' ? result.kind : null;
}

test('정상 출력 → outcome ok, maxOutputTokens null, runtime.generator가 codex-cli·버전·명령줄', async () => {
  const { record, meta, cli, outDir } = await run([codexExited(await loadStdout('ok'))]);

  assert.deepEqual(meta, record);
  assert.equal(meta.outcome, 'ok');
  assert.equal(meta.params.maxOutputTokens, null, 'Codex는 상한을 지정할 수 없다 (ADR-007)');
  assert.equal(meta.runtime.generator.tool, 'codex-cli');
  assert.equal(meta.runtime.generator.version, FAKE_CODEX_VERSION);
  assert.match(meta.runtime.generator.invocation, /^codex exec --model gpt-6\.1-sol /);
  assert.match(meta.runtime.generator.invocation, / - \(stdin: <user prompt>\)$/);
  assert.equal(cli.requests.length, 1);

  const result = meta.attempts[0]?.result;
  assert.equal(result?.type === 'response' && result.rawStopReason, 'turn.completed');
  assert.equal(result?.type === 'response' && result.stopReason, 'other');
  assert.equal(result?.type === 'response' && result.resolvedModelId, null);
  assert.deepEqual(meta.usageTotal, { inputTokens: 5_200, outputTokens: 9_800, reasoningTokens: 4_100 });
  assert.equal(meta.output?.extraction, 'fenced_block');
  assert.deepEqual((await readdir(outDir)).sort(), ['index.html', 'meta.json', 'response.txt']);
});

test('한도 초과 → 재시도하지 않고 usage_limit 1회로 api_failed', async () => {
  const { meta, cli, sleeps, outDir } = await run([await failed('usage-limit'), codexExited(await loadStdout('ok'))]);

  assert.equal(RETRYABLE_FAILURES.has('usage_limit'), false);
  assert.equal(meta.outcome, 'api_failed');
  assert.equal(cli.requests.length, 1, '한도가 풀릴 때까지 다시 부르지 않는다');
  assert.deepEqual(sleeps, []);
  assert.equal(errorKind(meta, 0), 'usage_limit');
  assert.deepEqual(await readdir(outDir), ['meta.json']);
});

test('잘림(Incomplete response returned) → unknown 1회로 api_failed (재시도하지 않는다)', async () => {
  const { meta, cli, sleeps } = await run([await failed('incomplete'), codexExited(await loadStdout('ok'))]);
  assert.equal(meta.outcome, 'api_failed');
  assert.equal(cli.requests.length, 1);
  assert.deepEqual(sleeps, []);
  assert.equal(errorKind(meta, 0), 'unknown');
});

test('503 → server_error로 재시도해 ok (시도 2회, 백오프 1번, 시도마다 새 임시 폴더)', async () => {
  const { meta, cli, sleeps } = await run([await failed('server-503'), codexExited(await loadStdout('ok'))]);

  assert.equal(RETRYABLE_FAILURES.has('server_error'), true);
  assert.equal(meta.outcome, 'ok');
  assert.equal(cli.requests.length, 2);
  assert.equal(sleeps.length, 1);
  assert.equal(errorKind(meta, 0), 'server_error');
  const first = meta.attempts[0]?.result;
  assert.equal(first?.type === 'error' && first.httpStatus, 503);
  assert.equal(first?.type === 'error' && first.usage, null);
  assert.notEqual(cli.cwdStates[0]?.cwd, cli.cwdStates[1]?.cwd);
});

test('스트림 끊김 → network로 재시도한다', async () => {
  const { meta, cli, sleeps } = await run([await failed('stream-disconnected'), codexExited(await loadStdout('ok'))]);

  assert.equal(RETRYABLE_FAILURES.has('network'), true);
  assert.equal(meta.outcome, 'ok');
  assert.equal(cli.requests.length, 2);
  assert.equal(sleeps.length, 1);
  assert.equal(errorKind(meta, 0), 'network');
});

test('401 → auth 1회로 api_failed', async () => {
  const { meta, cli } = await run([await failed('auth-401'), codexExited(await loadStdout('ok'))]);
  assert.equal(meta.outcome, 'api_failed');
  assert.equal(cli.requests.length, 1);
  assert.equal(errorKind(meta, 0), 'auth');
});
