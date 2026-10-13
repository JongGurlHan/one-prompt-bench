import assert from 'node:assert/strict';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { STATUS_LEGEND } from '../src/display.js';
import { checkResults, type CheckIssue } from '../src/results.js';
import type { GenerationRecord, Judgment, ModelEntry } from '../src/schema.js';
import {
  FAKE_MODELS,
  buildResult,
  fakeDiscarded,
  fakeModel,
  makeDataRoot,
  makeStatusDataRoot,
  patchJson,
  writeResult,
} from './support/testing.js';

/** path가 같고 message에 fragment가 들어 있는 이슈가 있는지 */
function assertIssue(issues: readonly CheckIssue[], issuePath: string, fragment: string) {
  const hit = issues.some((i) => i.path === issuePath && i.message.includes(fragment));
  assert.ok(hit, `expected "${issuePath}: …${fragment}…" in\n${format(issues)}`);
}
const format = (issues: readonly CheckIssue[]) => issues.map((i) => `  ${i.path}: ${i.message}`).join('\n') || '  (none)';

/** 기본 모델 4개 중 gemini-a(ok, 판정 있음)·gpt-a(no_html)만 결과가 있는 데이터 루트 */
async function smallRoot() {
  const root = await makeDataRoot();
  await writeResult(root, 'gemini-a', { outcome: 'ok', judgment: {} });
  await writeResult(root, 'gpt-a', { outcome: 'no_html' });
  assert.deepEqual(await checkResults(root), [], 'baseline must pass');
  return root;
}
const file = (root: string, rel: string) => path.join(root, ...rel.split('/'));

/* ───────── 통과 ───────── */

test('모든 상태(검증 전 제외)와 판정이 있는 정상 데이터는 이슈 없음', async () => {
  const root = await makeStatusDataRoot(STATUS_LEGEND.filter((l) => l !== '검증 전'));
  assert.deepEqual(await checkResults(root), []);
});

test('결과가 하나도 없으면 통과: results/ 없음, 빈 results/', async () => {
  const root = await makeDataRoot();
  assert.deepEqual(await checkResults(root), []);
  await mkdir(path.join(root, 'results'));
  assert.deepEqual(await checkResults(root), []);
});

/* ───────── 규칙 1: models.json ───────── */

test('규칙 1: models.json이 스키마를 통과하지 못하면 이슈', async () => {
  const root = await makeDataRoot();
  await patchJson<ModelEntry[]>(root, 'models.json', (models) => {
    models[1]!.slug = models[0]!.slug; // 중복 slug
  });
  assertIssue(await checkResults(root), 'models.json', 'duplicate slug: gemini-a');

  await patchJson<Record<string, unknown>[]>(root, 'models.json', (models) => {
    delete models[0]!.releasedAt;
  });
  assertIssue(await checkResults(root), 'models.json', '0.releasedAt');
});

test('규칙 1: models.json이 없거나 JSON이 아니면 이슈', async () => {
  const root = await makeDataRoot();
  await rm(file(root, 'models.json'));
  assertIssue(await checkResults(root), 'models.json', 'missing');

  await writeFile(file(root, 'models.json'), '[{', 'utf8');
  assertIssue(await checkResults(root), 'models.json', 'not valid JSON');
});

/* ───────── 규칙 2: results/ 아래 항목 ───────── */

test('규칙 2: results/ 아래의 파일은 이슈', async () => {
  const root = await smallRoot();
  await writeFile(file(root, 'results/README.md'), 'hi\n');
  assertIssue(await checkResults(root), 'results/README.md', 'not a folder');
});

test('규칙 2: models.json에 없는 이름의 폴더는 이슈', async () => {
  const root = await smallRoot();
  await mkdir(file(root, 'results/unknown-model'));
  const issues = await checkResults(root);
  assertIssue(issues, 'results/unknown-model', 'not a slug in models.json');
});

test('규칙 2: 심볼릭 링크(폴더 링크)는 진짜 폴더가 아니므로 이슈 (문서에 없는 경우 → 엄격하게)', async () => {
  const root = await smallRoot();
  // junction은 Windows에서 관리자 권한 없이 만들 수 있고, 다른 OS에서는 일반 심볼릭 링크가 된다
  await symlink(file(root, 'results/gemini-a'), file(root, 'results/claude-a'), 'junction');
  assertIssue(await checkResults(root), 'results/claude-a', 'symbolic link');
});

test('results 자체가 폴더가 아니면 이슈', async () => {
  const root = await makeDataRoot();
  await writeFile(file(root, 'results'), '');
  assertIssue(await checkResults(root), 'results', 'not a folder');
});

/* ───────── 규칙 3: meta.json ───────── */

test('규칙 3: meta.json이 없는 폴더(중단된 생성)는 이슈', async () => {
  const root = await smallRoot();
  await mkdir(file(root, 'results/claude-a'));
  assertIssue(await checkResults(root), 'results/claude-a/meta.json', 'missing');
});

test('규칙 3: meta.json이 스키마를 통과하지 못하거나 JSON이 아니면 이슈', async () => {
  const root = await smallRoot();
  await patchJson<GenerationRecord>(root, 'results/gemini-a/meta.json', (m) => {
    m.usageTotal.inputTokens += 1;
  });
  await writeFile(file(root, 'results/gpt-a/meta.json'), '{"schemaVersion": 1,', 'utf8');
  const issues = await checkResults(root);
  assertIssue(issues, 'results/gemini-a/meta.json', 'sum of attempts');
  assertIssue(issues, 'results/gpt-a/meta.json', 'not valid JSON');
});

test('규칙 3: modelSlug가 폴더 이름과 다르면 이슈', async () => {
  const root = await smallRoot();
  await patchJson<GenerationRecord>(root, 'results/gpt-a/meta.json', (m) => {
    m.modelSlug = 'claude-a';
  });
  assertIssue(await checkResults(root), 'results/gpt-a/meta.json', 'modelSlug "claude-a"');
});

/* ───────── 규칙 4: 가리키는 파일이 있다 ───────── */

test('규칙 4: response.txt·index.html·스크린샷이 없으면 그 경로로 이슈', async () => {
  const root = await smallRoot();
  await rm(file(root, 'results/gemini-a/index.html'));
  await rm(file(root, 'results/gemini-a/summer.jpg'));
  await rm(file(root, 'results/gpt-a/response.txt'));
  const issues = await checkResults(root);
  assertIssue(issues, 'results/gemini-a/index.html', 'missing');
  assertIssue(issues, 'results/gemini-a/summer.jpg', 'missing');
  assertIssue(issues, 'results/gpt-a/response.txt', 'missing');
});

test('규칙 4: 가리키는 파일이 일반 파일이 아니면(폴더) 이슈', async () => {
  const root = await smallRoot();
  await rm(file(root, 'results/gemini-a/spring.jpg'));
  await mkdir(file(root, 'results/gemini-a/spring.jpg'));
  assertIssue(await checkResults(root), 'results/gemini-a/spring.jpg', 'not a regular file');
});

/* ───────── 규칙 5: sha256 ───────── */

test('규칙 5: index.html을 손으로 고치면(줄바꿈 변환 포함) sha256 불일치 이슈', async () => {
  const root = await smallRoot();
  const { record } = buildResult(FAKE_MODELS[0]!, { outcome: 'ok' });
  // git autocrlf가 바꾼 것처럼 LF → CRLF
  const html = await readFile(file(root, 'results/gemini-a/index.html'), 'utf8');
  await writeFile(file(root, 'results/gemini-a/index.html'), html.replaceAll('\n', '\r\n'), 'utf8');
  const issues = await checkResults(root);
  assertIssue(issues, 'results/gemini-a/index.html', `does not match meta.json output.sha256 ${record.output!.sha256}`);
});

test('규칙 5: sha256은 그대로인데 output.bytes만 다르면 이슈', async () => {
  const root = await smallRoot();
  await patchJson<GenerationRecord>(root, 'results/gemini-a/meta.json', (m) => {
    m.output!.bytes += 1;
  });
  assertIssue(await checkResults(root), 'results/gemini-a/index.html', 'output.bytes');
});

/* ───────── 규칙 6: ok면 validation ───────── */

test('규칙 6: outcome ok인데 validation이 null이면 이슈', async () => {
  const root = await makeDataRoot();
  await writeResult(root, 'claude-b', { outcome: 'ok', validation: null });
  assertIssue(await checkResults(root), 'results/claude-b/meta.json', 'validation is null');
});

/* ───────── 규칙 7: judgment.json ───────── */

test('규칙 7: judgment.json이 스키마를 통과하지 못하면 이슈', async () => {
  const root = await smallRoot();
  await patchJson<Judgment>(root, 'results/gemini-a/judgment.json', (j) => {
    j.note = '';
  });
  assertIssue(await checkResults(root), 'results/gemini-a/judgment.json', 'note');
});

test('규칙 7: modelSlug·prompt·outputSha256이 meta.json과 다르면 각각 이슈', async () => {
  const root = await smallRoot();
  await patchJson<Judgment>(root, 'results/gemini-a/judgment.json', (j) => {
    j.modelSlug = 'gpt-a';
    j.prompt.version = 'v2';
    j.outputSha256 = 'f'.repeat(64);
  });
  const issues = await checkResults(root);
  assertIssue(issues, 'results/gemini-a/judgment.json', 'modelSlug "gpt-a"');
  assertIssue(issues, 'results/gemini-a/judgment.json', 'prompt season-tree/v2');
  assertIssue(issues, 'results/gemini-a/judgment.json', 'outputSha256');
  assert.equal(issues.filter((i) => i.path === 'results/gemini-a/judgment.json').length, 3, format(issues));
});

test('규칙 7: 결과물이 없는 기록(no_html)에 judgment.json이 있으면 이슈', async () => {
  const root = await smallRoot();
  const { judgment } = buildResult(FAKE_MODELS[3]!, { outcome: 'ok', judgment: {} }); // gpt-a로 판정한 파일
  await writeFile(file(root, 'results/gpt-a/judgment.json'), JSON.stringify(judgment), 'utf8');
  assertIssue(await checkResults(root), 'results/gpt-a/judgment.json', 'no output');
});

/* ───────── 규칙 8: 생성 도구 ───────── */

test('규칙 8: runtime.generator.tool이 provider의 생성 도구와 다르면 이슈', async () => {
  const root = await smallRoot();
  await patchJson<GenerationRecord>(root, 'results/gemini-a/meta.json', (m) => {
    m.runtime.generator.tool = 'claude-code'; // gemini-a는 google → gemini-api
  });
  assertIssue(await checkResults(root), 'results/gemini-a/meta.json', 'runtime.generator.tool "claude-code"');
});

/* ───────── 규칙 9: 경로는 results/<slug>/ 안 ───────── */

test('규칙 9: 다른 폴더·상위 폴더·절대 경로를 가리키면 이슈, 그 파일은 읽지 않는다', async () => {
  const root = await smallRoot();
  await writeResult(root, 'claude-a', { outcome: 'ok' });
  await patchJson<GenerationRecord>(root, 'results/gemini-a/meta.json', (m) => {
    m.output!.path = 'results/claude-a/index.html'; // 다른 모델의 결과물 (sha256은 그 파일과 다름)
    m.responseTextPath = 'results/gemini-a/../claude-a/response.txt';
    m.validation!.screenshots[0]!.path = '/tmp/spring.jpg';
  });
  const issues = await checkResults(root);
  assertIssue(issues, 'results/gemini-a/meta.json', 'output.path "results/claude-a/index.html"');
  assertIssue(issues, 'results/gemini-a/meta.json', 'responseTextPath "results/gemini-a/../claude-a/response.txt"');
  assertIssue(issues, 'results/gemini-a/meta.json', 'validation.screenshots.0.path "/tmp/spring.jpg"');
  // 밖의 파일로 sha256 대조를 하지 않는다
  assert.ok(!issues.some((i) => i.path.startsWith('results/claude-a')), format(issues));
});

test('규칙 9: 폴더 안이라도 결과물·원문은 정해진 이름(index.html·response.txt)이어야 한다', async () => {
  const root = await smallRoot();
  await patchJson<GenerationRecord>(root, 'results/gpt-a/meta.json', (m) => {
    m.responseTextPath = 'results/gpt-a/answer.txt';
  });
  await writeFile(file(root, 'results/gpt-a/answer.txt'), 'x');
  assertIssue(await checkResults(root), 'results/gpt-a/meta.json', 'responseTextPath must be results/gpt-a/response.txt');
});

/* ───────── 버린 결과물 기록 (models.json discarded, ADR-032 — DATA "불변식(phase 6)") ───────── */

const REPAIR_NOT_IMPLEMENTED = '수정 요청(--repair)은 아직 구현되지 않았다(ADR-032)';

/** 레포의 기록 3개와 같은 모양: 커밋 있는 blank_screen 2개(3회) · 1개(2회) · 커밋 없는 continued_output 1개(2회) */
const REGENERATED: readonly ModelEntry[] = [
  fakeModel('sol', 'openai', '2026-09-22', 'Sol', {}, [fakeDiscarded(), fakeDiscarded({ at: '2026-10-14' })]),
  fakeModel('flash', 'google', '2026-09-02', 'Flash', {}, [fakeDiscarded({ at: '2026-10-14' })]),
  fakeModel('sonnet', 'anthropic', '2026-09-28', 'Sonnet', {}, [fakeDiscarded({ reason: 'continued_output', commit: null })]),
];

async function regeneratedRoot(models: readonly ModelEntry[] = REGENERATED) {
  const root = await makeDataRoot([...models, FAKE_MODELS[0]!]);
  for (const m of models) await writeResult(root, m.slug, { outcome: 'ok', judgment: {} });
  return root;
}

test('discarded: 생성본 기록(상한 안)과 공개 결과물(meta.json)이 있으면 통과', async () => {
  const root = await regeneratedRoot();
  assert.deepEqual(await checkResults(root), []);
  // 공개 결과물이 api_failed·no_html이어도 meta.json만 있으면 된다 (표시는 그대로 생성 횟수)
  const other = await makeDataRoot(REGENERATED);
  await writeResult(other, 'sol', { outcome: 'no_html' });
  await writeResult(other, 'flash', { outcome: 'api_failed' });
  await writeResult(other, 'sonnet', { outcome: 'truncated' });
  assert.deepEqual(await checkResults(other), []);
});

test('discarded: 결과 폴더·meta.json이 없는 모델에 기록이 있으면 이슈 (results/가 없어도)', async () => {
  const noResults = await makeDataRoot(REGENERATED);
  const issues = await checkResults(noResults);
  for (const slug of ['sol', 'flash', 'sonnet']) assertIssue(issues, `results/${slug}/meta.json`, 'discarded');
  assert.equal(issues.length, 3, format(issues));

  const root = await regeneratedRoot();
  await rm(file(root, 'results/flash'), { recursive: true }); // 폴더 없음
  await rm(file(root, 'results/sonnet/meta.json')); // 폴더는 있는데 meta.json 없음 (규칙 3도 실패)
  const after = await checkResults(root);
  assertIssue(after, 'results/flash/meta.json', 'discarded');
  assertIssue(after, 'results/sonnet/meta.json', 'discarded');
  assert.ok(!after.some((i) => i.path.startsWith('results/sol/')), format(after));
});

test('discarded: 생성본 기록 3개(공개 결과물까지 4회)는 상한(3회)을 넘어 이슈', async () => {
  const root = await regeneratedRoot([
    fakeModel('sol', 'openai', '2026-09-22', 'Sol', {}, [fakeDiscarded(), fakeDiscarded(), fakeDiscarded()]),
  ]);
  const issues = await checkResults(root);
  assertIssue(issues, 'models.json', 'sol.discarded');
  assertIssue(issues, 'models.json', '4');
  assert.equal(issues.length, 1, format(issues));
});

test('discarded: 수정 요청 항목(made repair 또는 next repair)은 아직 구현되지 않아 이슈', async () => {
  const root = await regeneratedRoot([
    fakeModel('sol', 'openai', '2026-09-22', 'Sol', {}, [fakeDiscarded(), fakeDiscarded({ next: 'repair' })]),
    fakeModel('flash', 'google', '2026-09-02', 'Flash', {}, [fakeDiscarded({ next: 'repair' }), fakeDiscarded({ made: 'repair', next: 'repair' })]),
  ]);
  const issues = await checkResults(root);
  assertIssue(issues, 'models.json', `sol.discarded.1: ${REPAIR_NOT_IMPLEMENTED}`);
  assertIssue(issues, 'models.json', `flash.discarded.0: ${REPAIR_NOT_IMPLEMENTED}`);
  assertIssue(issues, 'models.json', `flash.discarded.1: ${REPAIR_NOT_IMPLEMENTED}`);
  assert.equal(issues.length, 3, format(issues));
});

test('discarded: 여러 위반을 모두 모아 보고하고, models.json이 스키마에서 깨지면 규칙 1로만 실패한다', async () => {
  const root = await makeDataRoot([
    fakeModel('sol', 'openai', '2026-09-22', 'Sol', {}, [
      fakeDiscarded(),
      fakeDiscarded(),
      fakeDiscarded(),
      fakeDiscarded({ made: 'repair' }),
    ]),
    ...REGENERATED.slice(1),
  ]);
  await writeResult(root, 'flash', { outcome: 'ok' });
  const issues = await checkResults(root);
  assertIssue(issues, 'models.json', 'sol.discarded: 3 discarded generations');
  assertIssue(issues, 'models.json', `sol.discarded.3: ${REPAIR_NOT_IMPLEMENTED}`);
  assertIssue(issues, 'results/sol/meta.json', 'discarded');
  assertIssue(issues, 'results/sonnet/meta.json', 'discarded');
  assert.equal(issues.length, 4, format(issues));

  await patchJson<ModelEntry[]>(root, 'models.json', (models) => {
    models[0]!.discarded![0]!.commit = 'F0E6988'; // 대문자·짧음
  });
  const broken = await checkResults(root);
  assertIssue(broken, 'models.json', 'schema: 0.discarded.0.commit');
  assert.ok(broken.every((i) => i.path === 'models.json' && i.message.startsWith('schema:')), format(broken));
});

/* ───────── 문서에 없는 경우: 엄격하게 ───────── */

test('meta.json이 가리키지 않는 파일이 폴더에 있으면 이슈 (손으로 넣은 파일)', async () => {
  const root = await smallRoot();
  await writeFile(file(root, 'results/gpt-a/index.html'), '<p>hand-made</p>'); // no_html인데 결과물이 있다
  await mkdir(file(root, 'results/gemini-a/extra'));
  const issues = await checkResults(root);
  assertIssue(issues, 'results/gpt-a/index.html', 'unexpected file');
  assertIssue(issues, 'results/gemini-a/extra', 'not a regular file');
});

/* ───────── 여러 이슈 ───────── */

test('이슈가 여러 개면 처음에서 멈추지 않고 모두 보고한다', async () => {
  const root = await smallRoot();
  await writeResult(root, 'claude-b', { outcome: 'ok', validation: null }); // 규칙 6
  await mkdir(file(root, 'results/claude-a')); // 규칙 3
  await mkdir(file(root, 'results/nobody')); // 규칙 2 (+ 3)
  await writeFile(file(root, 'results/gemini-a/index.html'), 'edited'); // 규칙 5
  await rm(file(root, 'results/gpt-a/response.txt')); // 규칙 4
  await patchJson<ModelEntry[]>(root, 'models.json', (models) => {
    models.push({ ...models[0]!, slug: 'Not Kebab' }); // 규칙 1 (나머지 규칙은 계속 검사)
  });

  const issues = await checkResults(root);
  assertIssue(issues, 'models.json', 'kebab-case');
  assertIssue(issues, 'results/nobody/meta.json', 'missing');
  assertIssue(issues, 'results/claude-a/meta.json', 'missing');
  assertIssue(issues, 'results/claude-b/meta.json', 'validation is null');
  assertIssue(issues, 'results/gemini-a/index.html', 'sha256');
  assertIssue(issues, 'results/gpt-a/response.txt', 'missing');
  // 경로는 데이터 루트 기준 POSIX
  for (const i of issues) assert.ok(!i.path.includes('\\') && !path.isAbsolute(i.path), i.path);
});
