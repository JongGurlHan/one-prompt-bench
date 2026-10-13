import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  GENERATOR_BY_PROVIDER,
  GeneratorToolSchema,
  MAX_GENERATIONS,
  MAX_REPAIRS,
  ModelEntrySchema,
  ModelRegistrySchema,
  ProviderSchema,
} from '../src/schema.js';

test('provider → 생성 도구: DATA.md 표와 같고, 모든 provider·도구가 한 번씩 쓰인다', () => {
  assert.deepEqual(GENERATOR_BY_PROVIDER, {
    anthropic: 'claude-code',
    openai: 'codex-cli',
    google: 'gemini-api',
  });
  assert.deepEqual(Object.keys(GENERATOR_BY_PROVIDER).sort(), [...ProviderSchema.options].sort());
  assert.deepEqual(Object.values(GENERATOR_BY_PROVIDER).sort(), [...GeneratorToolSchema.options].sort());
});

/* ───────── models.json의 버린 결과물 기록 (ADR-032, DATA "스키마 변경 예정") ───────── */

const entry = (extra: Record<string, unknown> = {}) => ({
  slug: 'gpt-x',
  provider: 'openai',
  modelId: 'gpt-x',
  displayName: 'GPT X',
  releasedAt: '2026-09-22',
  pricing: { inputPer1M: 2, outputPer1M: 10, asOf: '2026-10-10', sourceUrl: 'https://example.com/pricing' },
  ...extra,
});
const discarded = (over: Record<string, unknown> = {}) => ({
  made: 'generation',
  reason: 'blank_screen',
  next: 'regenerate',
  at: '2026-10-13',
  commit: 'f0e698868f321729a36937aca7bca80966c706f9',
  ...over,
});

const without = (value: Record<string, unknown>, key: string) => {
  const copy = { ...value };
  delete copy[key];
  return copy;
};

test('횟수 상한: 생성본은 첫 생성 포함 3회, 수정본은 2회 (DATA "스키마 변경 예정")', () => {
  assert.equal(MAX_GENERATIONS, 3);
  assert.equal(MAX_REPAIRS, 2);
});

test('discarded는 선택 필드: 없으면 그대로(키도 생기지 않음), 있으면 오래된 것부터 그대로 통과', () => {
  const plain = ModelEntrySchema.parse(entry());
  assert.ok(!('discarded' in plain));

  const records = [
    discarded(),
    discarded({ at: '2026-10-14', commit: 'a766e4f00b5a80c4bd1bb1272f5a36f4ed3ae996' }),
    discarded({ reason: 'continued_output', commit: null }),
  ];
  assert.deepEqual(ModelEntrySchema.parse(entry({ discarded: records })).discarded, records);
  // enum 전체를 받는다 (수정 요청 항목을 막는 것은 check:results — ADR-032)
  assert.ok(ModelEntrySchema.safeParse(entry({ discarded: [discarded({ made: 'repair', next: 'repair' })] })).success);
  assert.ok(ModelRegistrySchema.safeParse([entry({ discarded: records })]).success);
});

test('discarded: 잘못된 enum·날짜·커밋 해시·빠진 필드는 거부', () => {
  const bad: [string, unknown][] = [
    ['made', discarded({ made: 'regenerate' })],
    ['reason', discarded({ reason: 'ugly_tree' })],
    ['next', discarded({ next: 'exclude' })],
    ['at (시각)', discarded({ at: '2026-10-13T00:00:00Z' })],
    ['at (없는 날)', discarded({ at: '2026-02-30' })],
    ['commit (대문자)', discarded({ commit: 'F0E698868F321729A36937ACA7BCA80966C706F9' })],
    ['commit (짧음)', discarded({ commit: 'f0e6988' })],
    ['commit (41자)', discarded({ commit: 'f0e698868f321729a36937aca7bca80966c706f90' })],
    ['commit (hex 아님)', discarded({ commit: 'g0e698868f321729a36937aca7bca80966c706f9' })],
    ['commit (빠짐)', without(discarded(), 'commit')],
    ['at (빠짐)', without(discarded(), 'at')],
  ];
  for (const [name, d] of bad) {
    assert.equal(ModelEntrySchema.safeParse(entry({ discarded: [d] })).success, false, name);
  }
  // 빈 배열은 "버린 결과물이 있다"와 "없다" 중 어느 것인지 모호하다 → 거부 (문서에 없는 경우 → 엄격하게)
  assert.equal(ModelEntrySchema.safeParse(entry({ discarded: [] })).success, false, 'empty');
  assert.equal(ModelEntrySchema.safeParse(entry({ discarded: discarded() })).success, false, 'not an array');
});
