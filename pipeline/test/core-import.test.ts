import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CURRENT_PROMPT,
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_RUN_POLICY,
  GENERATOR_BY_PROVIDER,
  GenerationRecordSchema,
  RETRYABLE_FAILURES,
  extractHtml,
  judgeRequests,
  loadPrompt,
  maxOutputTokensFor,
  runGeneration,
  loadResults,
  sortByRelease,
  type PromptSpec,
  type RunInput,
  type RunnerDeps,
} from '@opb/core';
import { makeDataRoot, writeResult } from '@opb/core/testing';

// '@opb/core'가 빌드 없이 TS 소스로 해석되는지 (tsx 실행, tsc NodeNext 양쪽)
test('@opb/core의 값을 pipeline에서 import해 쓸 수 있다', () => {
  assert.ok(RETRYABLE_FAILURES.has('timeout'));
  assert.ok(!RETRYABLE_FAILURES.has('usage_limit'));
  assert.equal(DEFAULT_RUN_POLICY.maxAttempts, 3);
  assert.deepEqual(
    sortByRelease([
      { releasedAt: '2026-01-01', displayName: 'B' },
      { releasedAt: '2026-02-01', displayName: 'A' },
    ]).map((m) => m.displayName),
    ['A', 'B'],
  );
});

test('batch·smoke가 쓸 core 공개 API가 진입점에 있다', () => {
  assert.equal(GENERATOR_BY_PROVIDER.google, 'gemini-api');
  assert.equal(maxOutputTokensFor({ supportsMaxOutputTokens: true }), DEFAULT_MAX_OUTPUT_TOKENS);
  assert.deepEqual(CURRENT_PROMPT, { id: 'season-tree', version: 'v1' });
  for (const fn of [loadPrompt, runGeneration, extractHtml, judgeRequests]) assert.equal(typeof fn, 'function');
  assert.equal(typeof GenerationRecordSchema.safeParse, 'function');

  // 타입도 진입점에서 온다 (tsc가 확인). Codex처럼 상한이 없는 도구는 maxOutputTokens: null
  const prompt: PromptSpec = { id: 'smoke', version: 'v1', system: 's\n', user: 'u' };
  const input: Pick<RunInput, 'prompt' | 'maxOutputTokens'> = { prompt, maxOutputTokens: null };
  const deps: RunnerDeps = { now: () => new Date(0), sleep: async () => {} };
  assert.equal(input.maxOutputTokens, null);
  assert.equal(deps.now().getTime(), 0);
});

// 다음 step(검증기·사이트) 테스트가 쓰는 가짜 데이터 루트 빌더가 서브패스로 해석되는지
test('@opb/core/testing의 빌더로 만든 데이터를 loadResults로 읽을 수 있다', async () => {
  const root = await makeDataRoot();
  const { record } = await writeResult(root, 'gemini-a', { outcome: 'ok' });
  const entry = (await loadResults(root)).find((e) => e.model.slug === 'gemini-a');
  assert.deepEqual(entry?.record, record);
});
