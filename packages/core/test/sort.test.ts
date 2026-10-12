import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ModelRegistrySchema } from '../src/schema.js';
import { sortByRelease } from '../src/sort.js';

const registry = ModelRegistrySchema.parse(
  JSON.parse(readFileSync(new URL('../../../models.json', import.meta.url), 'utf8')),
);

test('models.json: 출시일 최신순, 같은 날은 알파벳순', () => {
  assert.deepEqual(
    sortByRelease(registry).map((m) => m.displayName),
    [
      'Claude Haiku 5.5',
      'GPT-6.1 Sol',
      'Claude Sonnet 5.5',
      'Claude Opus 5.5', // 09-22 세 모델은 알파벳순
      'GPT-6 Luna',
      'GPT-6 Sol',
      'GPT-6 Astra',
      'Gemini 3.8 Flash',
    ],
  );
});

test('입력 순서와 무관하게 같은 결과, 원본 배열은 건드리지 않음', () => {
  const shuffled = [...registry].reverse();
  const before = shuffled.map((m) => m.slug);
  assert.deepEqual(sortByRelease(shuffled), sortByRelease(registry));
  assert.deepEqual(shuffled.map((m) => m.slug), before);
});

test('숫자는 크기순으로 비교', () => {
  const names = sortByRelease([
    { releasedAt: '2026-01-01', displayName: 'GPT-10 Sol' },
    { releasedAt: '2026-01-01', displayName: 'GPT-6 Sol' },
  ]).map((m) => m.displayName);
  assert.deepEqual(names, ['GPT-6 Sol', 'GPT-10 Sol']);
});
