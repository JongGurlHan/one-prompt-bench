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
import { ClaudeCodeAdapter } from '../src/adapters/claude-code/claude-code.adapter.js';
import {
  FAKE_CLAUDE_BIN,
  FAKE_CLAUDE_VERSION,
  PARENT_ENV,
  exited,
  fakeRunCli,
  loadFixture,
  loadStdout,
  type FakeRun,
} from './claude-code-fakes.js';

/* ───────── core Runner + Claude Code 어댑터 + 가짜 실행 함수 → OS 임시 디렉토리에 meta.json ───────── */

const model: ModelEntry = {
  slug: 'claude-opus-5-5',
  provider: 'anthropic',
  modelId: 'claude-opus-5-5',
  displayName: 'Claude Opus 5.5',
  releasedAt: '2026-09-22',
  pricing: { inputPer1M: 5, outputPer1M: 25, asOf: '2026-10-10', sourceUrl: 'https://example.com/pricing' },
};

const tmpRoots: string[] = [];
after(async () => {
  await Promise.all(tmpRoots.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function run(script: FakeRun[]) {
  const repoRoot = await mkdtemp(path.join(tmpdir(), 'opb-claude-runner-'));
  tmpRoots.push(repoRoot);
  const cli = fakeRunCli(script);
  const adapter = new ClaudeCodeAdapter(cli, { bin: FAKE_CLAUDE_BIN, version: FAKE_CLAUDE_VERSION, env: PARENT_ENV });
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

test('정상 출력 → outcome ok, meta.json이 스키마를 통과하고 runtime.generator가 claude-code·버전·명령줄', async () => {
  const { record, meta, cli, outDir } = await run([exited(await loadStdout('ok'))]);

  assert.deepEqual(meta, record);
  assert.equal(meta.outcome, 'ok');
  assert.equal(meta.runtime.generator.tool, 'claude-code');
  assert.equal(meta.runtime.generator.version, FAKE_CLAUDE_VERSION);
  assert.match(meta.runtime.generator.invocation, /^CLAUDE_CODE_MAX_OUTPUT_TOKENS=65536 claude -p --model claude-opus-5-5 /);
  assert.equal(meta.params.maxOutputTokens, 65_536);
  assert.equal(cli.requests[0]?.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS, '65536');

  assert.equal(meta.attempts.length, 1);
  const result = meta.attempts[0]?.result;
  assert.equal(result?.type, 'response');
  assert.equal(result?.type === 'response' && result.rawStopReason, 'end_turn');
  assert.equal(result?.type === 'response' && result.resolvedModelId, 'claude-opus-5-5');
  assert.equal(meta.attempts[0]?.firstTokenMs, null);
  assert.deepEqual(meta.usageTotal, { inputTokens: 428, outputTokens: 11_250, reasoningTokens: 4_200 });
  assert.equal(meta.output?.extraction, 'fenced_block');
  assert.deepEqual((await readdir(outDir)).sort(), ['index.html', 'meta.json', 'response.txt']);
});

test('구독 한도 초과(실제 출력) → 재시도하지 않고 usage_limit 1회로 api_failed', async () => {
  const usageLimit = exited(await loadFixture('stdout-usage-limit.json'), 1);
  const { meta, cli, sleeps, outDir } = await run([usageLimit, exited(await loadStdout('ok'))]);

  assert.equal(RETRYABLE_FAILURES.has('usage_limit'), false);
  assert.equal(meta.outcome, 'api_failed');
  assert.equal(cli.requests.length, 1, '한도가 풀릴 때까지 다시 부르지 않는다');
  assert.deepEqual(sleeps, []);
  const result = meta.attempts[0]?.result;
  assert.equal(result?.type === 'error' && result.kind, 'usage_limit');
  assert.equal(result?.type === 'error' && result.httpStatus, 429);
  assert.equal(result?.type === 'error' && result.message, "You've hit your session limit · resets 8pm (Asia/Seoul)");
  assert.deepEqual(await readdir(outDir), ['meta.json']);
});

test('529 overloaded → server_error로 재시도해 ok (시도 2회, 백오프 1번)', async () => {
  const { meta, cli, sleeps } = await run([exited(await loadStdout('overloaded-529'), 1), exited(await loadStdout('ok'))]);

  assert.equal(RETRYABLE_FAILURES.has('server_error'), true);
  assert.equal(meta.outcome, 'ok');
  assert.equal(cli.requests.length, 2);
  assert.equal(sleeps.length, 1);
  const first = meta.attempts[0]?.result;
  assert.equal(first?.type === 'error' && first.kind, 'server_error');
  assert.equal(first?.type === 'error' && first.httpStatus, 529);
  assert.notEqual(cli.cwdStates[0]?.cwd, cli.cwdStates[1]?.cwd, '시도마다 새 임시 폴더');
});

test('401 → auth 1회로 api_failed (재시도해도 결과가 같다)', async () => {
  const { meta, cli } = await run([exited(await loadStdout('auth-401'), 1), exited(await loadStdout('ok'))]);
  assert.equal(meta.outcome, 'api_failed');
  assert.equal(cli.requests.length, 1);
  assert.equal(meta.attempts[0]?.result.type === 'error' && meta.attempts[0].result.kind, 'auth');
});

test('이어 쓰기(출력이 상한을 넘고 end_turn) → truncated, HTML을 꺼내지 않는다 (재시도 없음)', async () => {
  const stdout = JSON.stringify({
    ...JSON.parse(await loadStdout('ok')),
    stop_reason: 'end_turn',
    result: ' 조각</script>\n</body>\n</html>\n```',
    usage: { input_tokens: 67_708, output_tokens: 87_265, output_tokens_details: { thinking_tokens: 69_211 } },
  });
  const continued = await run([exited(stdout)]);
  assert.equal(continued.meta.outcome, 'truncated');
  assert.equal(continued.meta.output, null);
  assert.equal(continued.cli.requests.length, 1);
});

test('max_tokens → truncated, refusal → refused (재시도 없음)', async () => {
  const truncated = await run([exited(await loadStdout('max-tokens'))]);
  assert.equal(truncated.meta.outcome, 'truncated');
  assert.equal(truncated.cli.requests.length, 1);

  const refused = await run([exited(await loadStdout('refusal'))]);
  assert.equal(refused.meta.outcome, 'refused');
  assert.equal(refused.cli.requests.length, 1);
});
