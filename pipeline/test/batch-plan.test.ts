import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { GenerationRecordSchema, type GenerationRecord } from '@opb/core';
import {
  batchExitCode,
  forceConfirmMessage,
  formatSummary,
  needsCommitBeforeDiscard,
  planResultDir,
  resultDirPath,
  selectTargets,
  uncommittedMessage,
  type SummaryRow,
} from '../src/generation/batch.js';
import { MODELS } from './batch-fakes.js';

/* ───────── 대상 선택 ───────── */

test('slug를 주면 준 순서대로 고른다', () => {
  const r = selectTargets(MODELS, { slugs: ['gpt-a', 'gemini-a'], all: false });
  assert.ok(r.ok);
  assert.deepEqual(
    r.models.map((m) => m.slug),
    ['gpt-a', 'gemini-a'],
  );
});

test('--all이면 models.json 전체를 sortByRelease 순서(출시일 최신순)로', () => {
  const r = selectTargets(MODELS, { slugs: [], all: true });
  assert.ok(r.ok);
  assert.deepEqual(
    r.models.map((m) => m.slug),
    ['claude-b', 'gpt-a', 'claude-a', 'gemini-a'],
  );
});

test('모르는 slug가 하나라도 있으면 실패하고 모르는 것을 모두 알려 준다', () => {
  const r = selectTargets(MODELS, { slugs: ['gemini-a', 'nope-1', 'nope-2'], all: false });
  assert.ok(!r.ok);
  assert.match(r.message, /nope-1, nope-2/);
  assert.match(r.message, /models\.json/);
});

test('slug도 --all도 없으면 실패', () => {
  assert.equal(selectTargets(MODELS, { slugs: [], all: false }).ok, false);
});

/* ───────── 폴더 상태 판정 ───────── */

function record(slug: string, outcome: 'ok' | 'api_failed' | 'no_html', kind: 'usage_limit' | 'auth' = 'auth'): GenerationRecord {
  const responded = outcome !== 'api_failed';
  return GenerationRecordSchema.parse({
    schemaVersion: 1,
    modelSlug: slug,
    modelId: `${slug}-id`,
    prompt: { id: 'season-tree', version: 'v1', sha256: 'a'.repeat(64) },
    params: { reasoningEffort: 'high', maxOutputTokens: 65536 },
    runtime: {
      gitCommit: 'a1b2c3d',
      nodeVersion: 'v24.14.0',
      generator: { tool: 'gemini-api', version: '2.28.0', invocation: '{}' },
    },
    startedAt: '2026-10-12T00:00:00.000Z',
    finishedAt: '2026-10-12T00:03:34.000Z',
    attempts: [
      {
        n: 1,
        startedAt: '2026-10-12T00:00:00.000Z',
        latencyMs: responded ? 214_300 : 1_500,
        firstTokenMs: null,
        result: responded
          ? {
              type: 'response',
              stopReason: 'end',
              rawStopReason: 'STOP',
              resolvedModelId: null,
              requestId: null,
              usage: { inputTokens: 1000, outputTokens: 20000, reasoningTokens: 8000 },
            }
          : { type: 'error', kind, httpStatus: 429, message: kind, usage: null },
      },
    ],
    outcome,
    responseTextPath: responded ? `results/${slug}/response.txt` : null,
    output:
      outcome === 'ok'
        ? { path: `results/${slug}/index.html`, bytes: 10, sha256: 'b'.repeat(64), extraction: 'fenced_block' }
        : null,
    usageTotal: responded
      ? { inputTokens: 1000, outputTokens: 20000, reasoningTokens: 8000 }
      : { inputTokens: 0, outputTokens: 0, reasoningTokens: null },
    cost: responded
      ? { inputUsd: 0.001, outputUsd: 0.1, totalUsd: 0.101, pricingAsOf: '2026-10-10' }
      : { inputUsd: 0, outputUsd: 0, totalUsd: 0, pricingAsOf: '2026-10-10' },
    validation: null,
  });
}

const metaText = (r: GenerationRecord) => JSON.stringify(r, null, 2) + '\n';

test('폴더 없음·빈 폴더 → 생성 (비울 것 없음)', () => {
  assert.deepEqual(planResultDir({ slug: 'gemini-a', files: null, metaText: null }, false), {
    kind: 'generate',
    reason: 'new',
    clear: false,
  });
  assert.deepEqual(planResultDir({ slug: 'gemini-a', files: [], metaText: null }, false), {
    kind: 'generate',
    reason: 'new',
    clear: false,
  });
});

test('meta.json이 있고 outcome이 api_failed가 아니면 건너뜀', () => {
  for (const outcome of ['ok', 'no_html'] as const) {
    const r = record('gemini-a', outcome);
    const plan = planResultDir(
      { slug: 'gemini-a', files: ['index.html', 'meta.json', 'response.txt'], metaText: metaText(r) },
      false,
    );
    assert.equal(plan.kind, 'skip', outcome);
    assert.deepEqual(plan.kind === 'skip' ? plan.record : null, r);
  }
});

test('outcome이 api_failed면(한도 초과 포함) 비우고 생성', () => {
  for (const kind of ['auth', 'usage_limit'] as const) {
    const r = record('gemini-a', 'api_failed', kind);
    assert.deepEqual(planResultDir({ slug: 'gemini-a', files: ['meta.json'], metaText: metaText(r) }, false), {
      kind: 'generate',
      reason: 'api_failed',
      clear: true,
    });
  }
});

test('meta.json 없이 파일만 있으면(중단된 생성) 비우고 생성', () => {
  assert.deepEqual(planResultDir({ slug: 'gemini-a', files: ['response.txt'], metaText: null }, false), {
    kind: 'generate',
    reason: 'interrupted',
    clear: true,
  });
});

test('meta.json이 JSON이 아니거나 스키마를 통과하지 못하면 건드리지 않고 broken', () => {
  const notJson = planResultDir({ slug: 'gemini-a', files: ['meta.json'], metaText: '{ broken' }, false);
  assert.equal(notJson.kind, 'broken');
  assert.match(notJson.kind === 'broken' ? notJson.reason : '', /JSON/);

  const bad = { ...record('gemini-a', 'ok'), outcome: 'great' };
  const invalid = planResultDir({ slug: 'gemini-a', files: ['meta.json'], metaText: JSON.stringify(bad) }, false);
  assert.equal(invalid.kind, 'broken');
  assert.match(invalid.kind === 'broken' ? invalid.reason : '', /outcome/);
});

test('meta.json의 modelSlug가 폴더 이름과 다르면 broken', () => {
  const plan = planResultDir(
    { slug: 'gemini-a', files: ['meta.json'], metaText: metaText(record('claude-a', 'ok')) },
    false,
  );
  assert.equal(plan.kind, 'broken');
  assert.match(plan.kind === 'broken' ? plan.reason : '', /claude-a/);
});

test('--force: 파일이 있으면 상태와 관계없이(깨진 meta.json 포함) 비우고 생성, 빈 폴더는 그냥 생성', () => {
  const force = { kind: 'generate', reason: 'force', clear: true };
  assert.deepEqual(
    planResultDir({ slug: 'gemini-a', files: ['meta.json'], metaText: metaText(record('gemini-a', 'ok')) }, true),
    force,
  );
  assert.deepEqual(planResultDir({ slug: 'gemini-a', files: ['meta.json'], metaText: '{ broken' }, true), force);
  assert.deepEqual(planResultDir({ slug: 'gemini-a', files: null, metaText: null }, true), {
    kind: 'generate',
    reason: 'new',
    clear: false,
  });
});

/* ───────── --force 확인 문구 ───────── */

test('--force 확인 문구: 지울 폴더 목록과 "판정(judgment.json)도 함께 지워진다"', () => {
  const message = forceConfirmMessage([
    { slug: 'claude-a', files: ['judgment.json', 'meta.json'], metaText: '' },
    { slug: 'gemini-a', files: ['response.txt'], metaText: null },
  ]);
  assert.match(message, /results\/claude-a\/ \(판정 있음\)/);
  assert.match(message, /results\/gemini-a\//);
  assert.doesNotMatch(message, /results\/gemini-a\/ \(판정 있음\)/);
  assert.match(message, /판정\(judgment\.json\)도 함께 지워/);
});

/* ───────── 버리기 전 커밋 검사 (ADR-032) ───────── */

test('needsCommitBeforeDiscard: 표본(정상 기록·깨진 meta.json)만 검사, meta.json 없음·api_failed는 표본이 아니다', () => {
  const dir = (metaText: string | null, files = ['meta.json']) => ({ slug: 'gemini-a', files, metaText });
  assert.equal(needsCommitBeforeDiscard(dir(metaText(record('gemini-a', 'ok')))), true);
  assert.equal(needsCommitBeforeDiscard(dir(metaText(record('gemini-a', 'no_html')))), true);
  assert.equal(needsCommitBeforeDiscard(dir('{ broken')), true);
  assert.equal(needsCommitBeforeDiscard(dir(metaText(record('claude-a', 'ok')))), true, 'modelSlug가 다른 meta.json');
  assert.equal(needsCommitBeforeDiscard(dir(metaText(record('gemini-a', 'api_failed', 'usage_limit')))), false);
  assert.equal(needsCommitBeforeDiscard(dir(metaText(record('gemini-a', 'api_failed', 'auth')))), false);
  assert.equal(needsCommitBeforeDiscard(dir(null, ['response.txt'])), false);
  assert.equal(needsCommitBeforeDiscard(dir(null, [])), false);
});

test('uncommittedMessage: 폴더마다 git status 줄을 붙이고 먼저 커밋하라고 안내한다', () => {
  assert.equal(
    uncommittedMessage([
      { slug: 'gemini-a', status: '?? results/gemini-a/\n' },
      { slug: 'gpt-a', status: ' M results/gpt-a/index.html\n D results/gpt-a/spring.jpg\n' },
    ]),
    [
      '--force: 아래 결과 폴더에 커밋 안 된 변경이 있습니다. 먼저 커밋하세요(ADR-032 — 버린 결과물은 git에 남아야 한다).',
      '  results/gemini-a/',
      '      ?? results/gemini-a/',
      '  results/gpt-a/',
      '       M results/gpt-a/index.html',
      '       D results/gpt-a/spring.jpg',
      '아무것도 지우지 않았습니다.',
    ].join('\n'),
  );
});

/* ───────── 결과 폴더 경로 ───────── */

test('resultDirPath: <repoRoot>/results/<slug>, 스키마를 통과하지 않는 slug는 거부', () => {
  const root = path.resolve('/repo');
  assert.equal(resultDirPath(root, 'gemini-a'), path.join(root, 'results', 'gemini-a'));
  for (const bad of ['', '..', '../x', 'a/b', 'a\\b', 'A', '.', 'a..b']) {
    assert.throws(() => resultDirPath(root, bad), /slug/, bad);
  }
});

/* ───────── 요약표 ───────── */

test('formatSummary: slug · 처리 · outcome · 시도 · 걸린 시간 · 비용, 문제는 표 아래에', () => {
  const rows: SummaryRow[] = [
    { slug: 'gemini-a', action: 'generated', record: record('gemini-a', 'ok'), issue: null },
    { slug: 'claude-b', action: 'generated', record: record('claude-b', 'api_failed', 'usage_limit'), issue: null },
    { slug: 'claude-a', action: 'skipped', record: record('claude-a', 'no_html'), issue: null },
    { slug: 'gpt-a', action: 'failed', record: null, issue: 'meta.json이 스키마를 통과하지 못함' },
  ];
  assert.equal(
    formatSummary(rows),
    [
      '요약',
      'slug      처리    outcome                   시도  걸린 시간  비용',
      'gemini-a  생성    ok                        1     214.3s     $0.1010',
      'claude-b  생성    api_failed (usage_limit)  1     1.5s       $0.0000',
      'claude-a  건너뜀  no_html                   1     214.3s     $0.1010',
      'gpt-a     실패    -                         -     -          -',
      '',
      '생성 2 · 건너뜀 1 · 실패 1',
      '',
      '확인할 것:',
      '  - gpt-a: meta.json이 스키마를 통과하지 못함',
    ].join('\n'),
  );
});

test('batchExitCode: 실패·문제가 있으면 1, api_failed 기록은 정상(0)', () => {
  const ok: SummaryRow = { slug: 'a', action: 'generated', record: record('a', 'ok'), issue: null };
  const limited: SummaryRow = {
    slug: 'b',
    action: 'generated',
    record: record('b', 'api_failed', 'usage_limit'),
    issue: null,
  };
  const skipped: SummaryRow = { slug: 'c', action: 'skipped', record: record('c', 'ok'), issue: null };
  assert.equal(batchExitCode([ok, limited, skipped]), 0);
  assert.equal(batchExitCode([ok, { slug: 'd', action: 'failed', record: null, issue: 'x' }]), 1);
  assert.equal(batchExitCode([{ ...ok, issue: '검증 실패' }]), 1);
  assert.equal(batchExitCode([]), 0);
});
