import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import {
  DEFAULT_RUN_POLICY,
  GenerationRecordSchema,
  maxOutputTokensFor,
  runGeneration,
  type ModelEntry,
  type RunInput,
  type RunnerDeps,
} from '@opb/core';
import { GeminiAdapter } from '../src/adapters/gemini/gemini.adapter.js';
import { fakeClient, loadApiError, loadChunks, type FakeCall } from './gemini-fakes.js';

/* ───────── core Runner + Gemini 어댑터 + 가짜 클라이언트 → OS 임시 디렉토리에 meta.json ───────── */

const model: ModelEntry = {
  slug: 'gemini-3-8-flash',
  provider: 'google',
  modelId: 'gemini-3.8-flash',
  displayName: 'Gemini 3.8 Flash',
  releasedAt: '2026-09-02',
  pricing: { inputPer1M: 0.75, outputPer1M: 3.75, asOf: '2026-10-10', sourceUrl: 'https://ai.google.dev/gemini-api/docs/pricing' },
};

const tmpRoots: string[] = [];
after(async () => {
  await Promise.all(tmpRoots.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function run(calls: FakeCall[]) {
  const repoRoot = await mkdtemp(path.join(tmpdir(), 'opb-gemini-'));
  tmpRoots.push(repoRoot);
  const client = fakeClient(calls);
  const adapter = new GeminiAdapter(client, { sdkVersion: '2.28.0' });
  const sleeps: number[] = [];
  let t = Date.parse('2026-10-12T09:00:00+09:00');
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
  return { record, meta, client, sleeps, outDir };
}

test('정상 스트림 → outcome ok, meta.json이 스키마를 통과하고 generator.tool이 gemini-api', async () => {
  const { record, meta, client, outDir } = await run([{ chunks: await loadChunks('ok') }]);

  assert.deepEqual(meta, record);
  assert.equal(meta.outcome, 'ok');
  assert.equal(meta.runtime.generator.tool, 'gemini-api');
  assert.equal(meta.runtime.generator.version, '2.28.0');
  const invocation = JSON.parse(meta.runtime.generator.invocation) as { model: string; config: { maxOutputTokens: number } };
  assert.equal(invocation.model, 'gemini-3.8-flash');
  assert.equal(invocation.config.maxOutputTokens, 65_536);
  assert.equal(meta.params.maxOutputTokens, 65_536);
  assert.equal(client.params[0]?.config?.maxOutputTokens, 65_536);

  assert.equal(meta.attempts.length, 1);
  const [attempt] = meta.attempts;
  assert.equal(attempt?.result.type, 'response');
  assert.equal(attempt?.result.type === 'response' && attempt.result.rawStopReason, 'STOP');
  assert.equal(attempt?.result.type === 'response' && attempt.result.resolvedModelId, 'gemini-3.8-flash');
  assert.equal(typeof attempt?.firstTokenMs, 'number');
  assert.deepEqual(meta.usageTotal, { inputTokens: 412, outputTokens: 8380, reasoningTokens: 3150 });
  assert.equal(meta.output?.extraction, 'fenced_block');
  assert.deepEqual((await readdir(outDir)).sort(), ['index.html', 'meta.json', 'response.txt']);
});

test('MAX_TOKENS → truncated, 프롬프트 차단 → refused (재시도 없음)', async () => {
  const truncated = await run([{ chunks: await loadChunks('max-tokens') }]);
  assert.equal(truncated.meta.outcome, 'truncated');
  assert.equal(truncated.client.params.length, 1);

  const refused = await run([{ chunks: await loadChunks('prompt-blocked') }]);
  assert.equal(refused.meta.outcome, 'refused');
  assert.equal(refused.client.params.length, 1);
});

test('429 짧은 한도 → Runner가 retryDelay만큼 기다렸다 재시도해 ok', async () => {
  const { meta, sleeps, client } = await run([
    { reject: await loadApiError('429-rate-limit') },
    { chunks: await loadChunks('ok') },
  ]);
  assert.equal(meta.outcome, 'ok');
  assert.equal(client.params.length, 2);
  assert.deepEqual(sleeps, [37_000]);
  const first = meta.attempts[0]?.result;
  assert.equal(first?.type, 'error');
  assert.equal(first?.type === 'error' && first.kind, 'rate_limited');
  assert.equal(first?.type === 'error' && first.httpStatus, 429);
});

test('429 일일 할당량 → usage_limit 1회로 끝나 api_failed (재시도 안 함)', async () => {
  const { meta, sleeps, client, outDir } = await run([
    { reject: await loadApiError('429-daily-quota') },
    { chunks: await loadChunks('ok') },
  ]);
  assert.equal(meta.outcome, 'api_failed');
  assert.equal(client.params.length, 1);
  assert.deepEqual(sleeps, []);
  assert.equal(meta.attempts[0]?.result.type === 'error' && meta.attempts[0].result.kind, 'usage_limit');
  assert.deepEqual(await readdir(outDir), ['meta.json']);
});

test('스트림 도중 503 → 그때까지의 usage가 시도 기록과 usageTotal에 남고, 재시도해 ok', async () => {
  const chunks = await loadChunks('ok');
  const { meta } = await run([
    { chunks: chunks.slice(0, 3), throwAfter: await loadApiError('503', 'in_stream') },
    { chunks },
  ]);
  assert.equal(meta.outcome, 'ok');
  const first = meta.attempts[0]?.result;
  assert.equal(first?.type === 'error' && first.kind, 'server_error');
  assert.deepEqual(first?.usage, { inputTokens: 412, outputTokens: 3198, reasoningTokens: 3150 });
  assert.deepEqual(meta.usageTotal, { inputTokens: 824, outputTokens: 11_578, reasoningTokens: 6300 });
});
