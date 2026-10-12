import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { checkResults, loadResults } from '../src/results.js';
import type { GenerationRecord, Judgment, ModelEntry } from '../src/schema.js';
import { sortByRelease } from '../src/sort.js';
import { FAKE_MODELS, makeDataRoot, patchJson, writeResult } from './support/testing.js';

const file = (root: string, rel: string) => path.join(root, ...rel.split('/'));

const rejectsWith =
  (...parts: string[]) =>
  (err: unknown) => {
    assert.ok(err instanceof Error);
    for (const p of parts) assert.ok(err.message.includes(p), `"${err.message}" should include "${p}"`);
    return true;
  };

test('models.json을 sortByRelease 순서로, 기록·판정을 조인해서 돌려준다', async () => {
  const root = await makeDataRoot();
  const ok = await writeResult(root, 'gemini-a', { outcome: 'ok', judgment: { note: '좋다' } });
  const failed = await writeResult(root, 'gpt-a', { outcome: 'api_failed', failure: 'usage_limit' });

  const entries = await loadResults(root);
  assert.deepEqual(
    entries.map((e) => e.model.slug),
    sortByRelease(FAKE_MODELS).map((m) => m.slug),
  );
  assert.deepEqual(
    entries.map((e) => e.model.slug),
    ['claude-b', 'gpt-a', 'claude-a', 'gemini-a'],
  );

  const bySlug = new Map(entries.map((e) => [e.model.slug, e]));
  assert.deepEqual(bySlug.get('gemini-a')!.record, ok.record);
  assert.deepEqual(bySlug.get('gemini-a')!.judgment, ok.judgment);
  assert.deepEqual(bySlug.get('gpt-a')!.record, failed.record);
  assert.equal(bySlug.get('gpt-a')!.judgment, null);
  assert.deepEqual(bySlug.get('claude-a')!.model, FAKE_MODELS.find((m) => m.slug === 'claude-a'));
});

test('결과 폴더나 meta.json이 없는 모델은 record null (생성 전)', async () => {
  const root = await makeDataRoot();
  assert.ok((await loadResults(root)).every((e) => e.record === null && e.judgment === null), 'results/ 없음');

  await mkdir(file(root, 'results/claude-a'), { recursive: true }); // 중단된 생성
  const entries = await loadResults(root);
  assert.equal(entries.length, FAKE_MODELS.length);
  assert.equal(entries.find((e) => e.model.slug === 'claude-a')!.record, null);
});

test('스키마를 통과하지 못한 meta.json이 있으면 그 경로를 담아 throw', async () => {
  const root = await makeDataRoot();
  await writeResult(root, 'gemini-a', { outcome: 'ok' });
  await patchJson<GenerationRecord>(root, 'results/gemini-a/meta.json', (m) => {
    (m as { outcome: string }).outcome = 'done';
  });
  await assert.rejects(loadResults(root), rejectsWith('results/gemini-a/meta.json', 'outcome'));
});

test('JSON이 아닌 meta.json, 스키마 위반 judgment.json·models.json도 경로를 담아 throw (여러 개면 모두)', async () => {
  const root = await makeDataRoot();
  await writeResult(root, 'gemini-a', { outcome: 'ok', judgment: {} });
  await writeResult(root, 'gpt-a', { outcome: 'refused' });
  await writeFile(file(root, 'results/gpt-a/meta.json'), 'not json', 'utf8');
  await patchJson<Judgment>(root, 'results/gemini-a/judgment.json', (j) => {
    (j.requirements as Record<string, string>).scene = 'great';
  });
  await assert.rejects(
    loadResults(root),
    rejectsWith('results/gpt-a/meta.json', 'results/gemini-a/judgment.json', 'requirements.scene'),
  );

  await patchJson<ModelEntry[]>(root, 'models.json', (models) => {
    models[0]!.releasedAt = '2026/09/02';
  });
  await assert.rejects(loadResults(root), rejectsWith('models.json', '0.releasedAt'));

  await rm(file(root, 'models.json'));
  await assert.rejects(loadResults(root), rejectsWith('models.json'));
});

test('check:results만 검사하는 규칙(파일 존재·sha256·판정 대조·검증 전·모르는 폴더)은 통과시킨다', async () => {
  const root = await makeDataRoot();
  await writeResult(root, 'gemini-a', { outcome: 'ok', judgment: {} });
  await writeResult(root, 'claude-b', { outcome: 'ok', validation: null }); // 검증 전
  await writeResult(root, 'gpt-a', { outcome: 'no_html' });
  await writeFile(file(root, 'results/gemini-a/index.html'), 'edited by hand'); // sha256 불일치
  await rm(file(root, 'results/gemini-a/spring.jpg')); // 파일 없음
  await rm(file(root, 'results/gpt-a/response.txt'));
  await patchJson<Judgment>(root, 'results/gemini-a/judgment.json', (j) => {
    j.outputSha256 = '0'.repeat(64); // 판정 불일치
  });
  await mkdir(file(root, 'results/not-in-models'));

  assert.ok((await checkResults(root)).length >= 6, 'check:results는 잡는다');

  const entries = await loadResults(root);
  const bySlug = new Map(entries.map((e) => [e.model.slug, e]));
  assert.equal(bySlug.get('claude-b')!.record!.validation, null);
  assert.equal(bySlug.get('gemini-a')!.judgment!.outputSha256, '0'.repeat(64));
  assert.equal(bySlug.get('gpt-a')!.record!.outcome, 'no_html');
  assert.ok(!entries.some((e) => e.model.slug === 'not-in-models'));
});
