import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadPrompt } from '../src/prompt.js';
import { GenerationRecordSchema, JudgmentSchema, ModelRegistrySchema } from '../src/schema.js';
import {
  FAKE_MODELS,
  STATUS_CASES,
  buildResult,
  fakeModel,
  makeDataRoot,
  writeResult,
} from './support/testing.js';

const REPO_PROMPTS = fileURLToPath(new URL('../../../prompts/', import.meta.url));
const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

test('makeDataRoot: 임시 디렉토리에 models.json과 레포 prompts/ 사본, results/는 없음', async () => {
  const root = await makeDataRoot();
  assert.ok(!root.startsWith(fileURLToPath(new URL('../../../', import.meta.url))), '레포 밖');
  const models = ModelRegistrySchema.parse(JSON.parse(await readFile(path.join(root, 'models.json'), 'utf8')));
  assert.deepEqual(models, FAKE_MODELS);
  assert.deepEqual((await readdir(root)).sort(), ['models.json', 'prompts']);

  for (const name of ['season-tree-v1.md', 'season-tree-v1.system.md', 'season-tree-v1.judging.md']) {
    const copy = await readFile(path.join(root, 'prompts', name));
    assert.ok(copy.equals(await readFile(path.join(REPO_PROMPTS, name))), name);
  }
});

test('writeResult: ok 기록의 sha256·bytes가 index.html 바이트와 맞고, 스크린샷은 JPEG 시그니처', async () => {
  const root = await makeDataRoot();
  const html = Buffer.from('<!doctype html>\r\n<p>한글</p>\n', 'utf8');
  const { record, judgment } = await writeResult(root, 'gemini-a', { outcome: 'ok', html, judgment: {} });
  const dir = path.join(root, 'results', 'gemini-a');

  const onDisk = await readFile(path.join(dir, 'index.html'));
  assert.ok(onDisk.equals(html), '바이트 그대로 (줄바꿈 변환 없음)');
  assert.equal(record.output!.sha256, sha256(html));
  assert.equal(record.output!.bytes, html.byteLength);
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'meta.json'), 'utf8')), record);
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'judgment.json'), 'utf8')), judgment);
  assert.equal(judgment!.outputSha256, record.output!.sha256);

  assert.equal(record.validation!.screenshots.length, 4);
  for (const s of record.validation!.screenshots) {
    const jpg = await readFile(path.join(root, ...s.path.split('/')));
    assert.deepEqual([...jpg.subarray(0, 3)], [0xff, 0xd8, 0xff], s.path);
  }

  // prompt.sha256은 데이터 루트의 프롬프트로 runner와 같은 방식
  const p = await loadPrompt(root, 'season-tree', 'v1');
  assert.equal(record.prompt.sha256, sha256(JSON.stringify({ system: p.system, user: p.user })));
  assert.equal(record.runtime.generator.tool, 'gemini-api');
});

test('writeResult: 상태별 파일 구성', async () => {
  const root = await makeDataRoot();
  const files = async (slug: string) => (await readdir(path.join(root, 'results', slug))).sort();

  await writeResult(root, 'gemini-a', { outcome: 'ok', validation: null });
  assert.deepEqual(await files('gemini-a'), ['index.html', 'meta.json', 'response.txt']);
  await writeResult(root, 'gpt-a', { outcome: 'truncated' });
  assert.deepEqual(await files('gpt-a'), ['meta.json', 'response.txt']);
  const failed = await writeResult(root, 'claude-a', { outcome: 'api_failed', failure: 'usage_limit' });
  assert.deepEqual(await files('claude-a'), ['meta.json']);
  assert.equal(failed.record.attempts.at(-1)!.result.type, 'error');
  assert.equal(failed.record.params.maxOutputTokens, 65_536);

  await assert.rejects(writeResult(root, 'gpt-a', { outcome: 'no_html' }), /not empty/);
  await assert.rejects(writeResult(root, 'nobody', { outcome: 'no_html' }), /nobody/);
});

test('buildResult: 모든 상태 사례가 스키마를 통과하고, 잘못된 명세는 스키마가 거부한다', () => {
  for (const c of STATUS_CASES) {
    if (!c.result) continue;
    const { record, judgment } = buildResult(c.model, c.result);
    assert.ok(GenerationRecordSchema.safeParse(record).success, c.label);
    if (judgment) assert.ok(JudgmentSchema.safeParse(judgment).success, c.label);
  }
  const codex = buildResult(fakeModel('x', 'openai', '2026-09-01', 'X'), { outcome: 'ok', retries: 2 }).record;
  assert.equal(codex.params.maxOutputTokens, null);
  assert.deepEqual(
    codex.attempts.map((a) => a.n),
    [1, 2, 3],
  );

  assert.throws(() =>
    buildResult(FAKE_MODELS[0]!, { outcome: 'ok', usage: { inputTokens: 1, outputTokens: 1, reasoningTokens: 2 } }),
  );
  assert.throws(() =>
    buildResult(FAKE_MODELS[0]!, { outcome: 'ok', judgment: { note: '' } }),
  );
});
