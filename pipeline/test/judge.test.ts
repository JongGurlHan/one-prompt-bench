import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import {
  checkResults,
  GenerationRecordSchema,
  JudgmentSchema,
  MARK_LABEL,
  REQUIREMENT_LABEL,
  type GenerationRecord,
  type Judgment,
} from '@opb/core';
import { buildResult, fakeModel, makeDataRoot, makeStatusDataRoot, patchJson, writeResult } from '@opb/core/testing';
import { JudgeService } from '../src/judging/judge.service.js';
import type { JudgeOptions } from '../src/judging/judge.js';
import { buildJudgment, parseMarkAnswer, toKstIsoString } from '../src/judging/judgment.js';
import type { Clock } from '../src/tokens.js';
import { snapshot } from './batch-fakes.js';

/* ────────────────────────────────────────────────────────────
 * `judge` 명령: 판정 기록 만들기·저장·거절. 데이터는 OS 임시 디렉토리(@opb/core/testing),
 * 입력은 가짜 Ask(준비한 답을 차례로 돌려줌)·가짜 Confirm으로 한다. 레포의 results/는 건드리지 않는다.
 * ──────────────────────────────────────────────────────────── */

const NOW = new Date('2026-10-13T10:24:23.456Z');
const NOW_KST = '2026-10-13T19:24:23+09:00';

const fakeClock: Clock = { now: () => NOW, sleep: async () => {} };

interface Run {
  code: number;
  questions: string[];
  confirms: string[];
  /** log·error·ask·confirm을 일어난 순서대로 ("log: …" 형식) */
  events: string[];
  output: string;
  errors: string[];
}

/**
 * answers: Ask가 차례로 돌려줄 답. null = 취소(EOF·Ctrl+C). 준비한 답보다 더 물으면 테스트가 실패한다.
 * confirm: 덮어쓰기 확인의 답
 */
async function run(
  root: string,
  opts: JudgeOptions,
  { answers = [], confirm = false }: { answers?: (string | null)[]; confirm?: boolean } = {},
): Promise<Run> {
  const queue = [...answers];
  const questions: string[] = [];
  const confirms: string[] = [];
  const events: string[] = [];
  const errors: string[] = [];
  const service = new JudgeService(
    root,
    async (question) => {
      questions.push(question);
      events.push(`ask: ${question}`);
      if (queue.length === 0) throw new Error(`준비하지 않은 질문: ${question}`);
      return queue.shift()!;
    },
    async (message) => {
      confirms.push(message);
      events.push(`confirm: ${message}`);
      return confirm;
    },
    fakeClock,
    {
      log: (l) => void events.push(`log: ${l}`),
      error: (l) => {
        errors.push(l);
        events.push(`error: ${l}`);
      },
    },
  );
  const code = await service.judge(opts);
  return { code, questions, confirms, events, output: events.join('\n'), errors };
}

const judgmentPath = (root: string, slug: string) => path.join(root, 'results', slug, 'judgment.json');

async function hasJudgment(root: string, slug: string): Promise<boolean> {
  const files = await snapshot(path.join(root, 'results', slug));
  return files !== null && 'judgment.json' in files;
}

async function readJudgment(root: string, slug: string): Promise<{ text: string; value: Judgment }> {
  const text = await readFile(judgmentPath(root, slug), 'utf8');
  return { text, value: JudgmentSchema.parse(JSON.parse(text)) };
}

async function readRecord(root: string, slug: string): Promise<GenerationRecord> {
  return GenerationRecordSchema.parse(JSON.parse(await readFile(path.join(root, 'results', slug, 'meta.json'), 'utf8')));
}

const ALL_FLAGS = {
  scene: 'pass',
  cycle: 'partial',
  look: 'fail',
  label: 'pass',
  note: '봄에 꽃이 피고 겨울에 눈이 온다',
} as const;

/** 데이터 루트(기본 FAKE_MODELS)에 ok 결과 하나 */
async function okRoot(slug = 'claude-b', judgment: { note: string | null } | null = null): Promise<string> {
  const root = await makeDataRoot();
  await writeResult(root, slug, { outcome: 'ok', judgment });
  return root;
}

/* ───────── 순수 함수 ───────── */

test('buildJudgment: 모델·프롬프트 id/version·outputSha256은 meta.json에서, judgedAt은 KST(+09:00), 스키마를 통과한다', () => {
  const { record } = buildResult(fakeModel('claude-a', 'anthropic', '2026-09-22', 'Claude A'), { outcome: 'ok' });
  const answers = {
    requirements: { scene: 'pass', seasonCycle: 'partial', seasonLook: 'fail', seasonLabel: 'pass' },
    note: '언덕 위 나무가 계절마다 바뀐다',
  } as const;

  const judgment = buildJudgment({ record, answers, now: NOW });

  assert.deepEqual(judgment, {
    schemaVersion: 1,
    modelSlug: 'claude-a',
    prompt: { id: record.prompt.id, version: record.prompt.version },
    outputSha256: record.output!.sha256,
    judgedAt: NOW_KST,
    requirements: answers.requirements,
    note: answers.note,
  });
  assert.deepEqual(JudgmentSchema.parse(judgment), judgment);
  assert.equal(Date.parse(judgment.judgedAt), Date.parse('2026-10-13T10:24:23Z'));
});

test('buildJudgment: 메모 앞뒤 공백은 스키마가 떼고, 결과물이 없는 기록은 던진다', () => {
  const model = fakeModel('gpt-a', 'openai', '2026-09-29', 'GPT A');
  const { record } = buildResult(model, { outcome: 'ok' });
  const requirements = { scene: 'pass', seasonCycle: 'pass', seasonLook: 'pass', seasonLabel: 'pass' } as const;
  assert.equal(buildJudgment({ record, answers: { requirements, note: '  메모  ' }, now: NOW }).note, '메모');

  const truncated = buildResult(model, { outcome: 'truncated' }).record;
  assert.throws(() => buildJudgment({ record: truncated, answers: { requirements, note: '메모' }, now: NOW }), /output/);
});

test('buildJudgment: 메모는 선택 — null이면 note null로 남긴다 (2026-10-14 사용자 결정)', () => {
  const { record } = buildResult(fakeModel('gpt-a', 'openai', '2026-09-29', 'GPT A'), { outcome: 'ok' });
  const requirements = { scene: 'pass', seasonCycle: 'pass', seasonLook: 'partial', seasonLabel: 'pass' } as const;
  const judgment = buildJudgment({ record, answers: { requirements, note: null }, now: NOW });
  assert.equal(judgment.note, null);
  assert.deepEqual(JudgmentSchema.parse(judgment), judgment);
});

test('toKstIsoString: UTC에 9시간을 더한 벽시계 시각 + "+09:00" (초 단위, 날짜가 넘어가도)', () => {
  assert.equal(toKstIsoString(NOW), NOW_KST);
  assert.equal(toKstIsoString(new Date('2026-10-13T15:30:00.999Z')), '2026-10-14T00:30:00+09:00');
  assert.equal(toKstIsoString(new Date('2026-12-31T23:59:59Z')), '2027-01-01T08:59:59+09:00');
});

test('parseMarkAnswer: pass·partial·fail과 짧은 p·a·f (대소문자·앞뒤 공백 무시), 그 밖은 null', () => {
  const ok: [string, string][] = [
    ['pass', 'pass'],
    [' PASS ', 'pass'],
    ['p', 'pass'],
    ['partial', 'partial'],
    ['a', 'partial'],
    ['A', 'partial'],
    ['fail', 'fail'],
    ['f', 'fail'],
  ];
  for (const [input, mark] of ok) assert.equal(parseMarkAnswer(input), mark, input);
  for (const input of ['', ' ', 'x', 'pa', 'yes', 'y', 'n', '✓', 'passed', 'p a']) assert.equal(parseMarkAnswer(input), null, input);
});

/* ───────── 플래그로 저장 ───────── */

test('플래그만: 묻지 않고 results/<slug>/judgment.json을 2칸 들여쓰기 + 끝 줄바꿈으로 저장 → exit 0', async () => {
  const root = await okRoot();
  const record = await readRecord(root, 'claude-b');

  const r = await run(root, { slug: 'claude-b', ...ALL_FLAGS });

  assert.equal(r.code, 0, r.output);
  assert.deepEqual(r.questions, []);
  assert.deepEqual(r.confirms, []);
  const expected: Judgment = {
    schemaVersion: 1,
    modelSlug: 'claude-b',
    prompt: { id: record.prompt.id, version: record.prompt.version },
    outputSha256: record.output!.sha256,
    judgedAt: NOW_KST,
    requirements: { scene: 'pass', seasonCycle: 'partial', seasonLook: 'fail', seasonLabel: 'pass' },
    note: ALL_FLAGS.note,
  };
  const { text } = await readJudgment(root, 'claude-b');
  assert.equal(text, JSON.stringify(expected, null, 2) + '\n');
  assert.match(r.output, /results\/claude-b\/judgment\.json/);
});

test('저장한 판정은 check:results(규칙 7)를 통과한다 — 새 판정과 --yes 덮어쓰기 모두', async () => {
  const root = await makeStatusDataRoot(['정상', '지시 미준수', '위반', '잘림', '생성 전']);
  assert.deepEqual(await checkResults(root), []);

  assert.equal((await run(root, { slug: 'model-violation', ...ALL_FLAGS })).code, 0);
  assert.equal((await run(root, { slug: 'model-ok', ...ALL_FLAGS, yes: true })).code, 0);

  assert.deepEqual(await checkResults(root), []);
  assert.equal((await readJudgment(root, 'model-ok')).value.note, ALL_FLAGS.note);
});

test('메모는 선택: 요구사항 4개만 플래그로 주면 묻지 않고 note null로 저장한다 (입력이 없는 ! 실행도 된다)', async () => {
  const root = await okRoot();
  const { scene, cycle, look, label } = ALL_FLAGS;

  const r = await run(root, { slug: 'claude-b', scene, cycle, look, label });

  assert.equal(r.code, 0, r.output);
  assert.deepEqual(r.questions, []);
  const { text, value } = await readJudgment(root, 'claude-b');
  assert.equal(value.note, null);
  assert.match(text, /"note": null\n\}\n$/);
  assert.ok(!r.output.includes('3D로 만든 언덕 위 나무'), '물을 것이 없으면 기준표도 없다');
  assert.match(r.output, /메모: \(없음\)/);
  assert.deepEqual(await checkResults(root), []);
});

test('메모는 200자까지 받는다 (앞뒤 공백은 떼고 저장)', async () => {
  const root = await okRoot();
  const note = '가'.repeat(200);

  const r = await run(root, { slug: 'claude-b', ...ALL_FLAGS, note: `  ${note}  ` });

  assert.equal(r.code, 0, r.output);
  assert.equal((await readJudgment(root, 'claude-b')).value.note, note);
});

/* ───────── 대화형 ───────── */

test('일부만 플래그: 받지 못한 요구사항과 메모만 REQUIREMENT_LABEL 순서로 묻는다', async () => {
  const root = await okRoot();

  const r = await run(root, { slug: 'claude-b', scene: 'fail', cycle: 'pass' }, { answers: ['a', 'PASS', '  잎이 무성하다  '] });

  assert.equal(r.code, 0, r.output);
  assert.equal(r.questions.length, 3);
  assert.ok(r.questions[0]!.includes(REQUIREMENT_LABEL.seasonLook), r.questions[0]!);
  assert.ok(r.questions[1]!.includes(REQUIREMENT_LABEL.seasonLabel), r.questions[1]!);
  assert.match(r.questions[2]!, /메모/);
  for (const q of r.questions) {
    assert.ok(!q.includes(REQUIREMENT_LABEL.scene) && !q.includes(REQUIREMENT_LABEL.seasonCycle), q);
  }
  const { value } = await readJudgment(root, 'claude-b');
  assert.deepEqual(value.requirements, { scene: 'fail', seasonCycle: 'pass', seasonLook: 'partial', seasonLabel: 'pass' });
  assert.equal(value.note, '잎이 무성하다');
});

test('대화형 메모는 선택: 비우고(공백만 포함) Enter면 note null로 저장한다', async () => {
  for (const blank of ['', '   ']) {
    const root = await okRoot();
    const r = await run(root, { slug: 'claude-b', scene: 'pass', cycle: 'pass', look: 'pass' }, { answers: ['a', blank] });
    assert.equal(r.code, 0, r.output);
    assert.equal(r.questions.length, 2);
    assert.match(r.questions[1]!, /메모 \(선택/);
    const { value } = await readJudgment(root, 'claude-b');
    assert.equal(value.requirements.seasonLabel, 'partial');
    assert.equal(value.note, null, JSON.stringify(blank));
  }
});

test('모두 대화형: 묻기 전에 결과물 경로·스크린샷 4장 경로·판정 기준표 요약을 보여 준다', async () => {
  const root = await okRoot();

  const r = await run(root, { slug: 'claude-b' }, { answers: ['p', 'a', 'f', 'p', '겨울 눈이 예쁘다'] });

  assert.equal(r.code, 0, r.output);
  assert.equal(r.questions.length, 5);
  const firstAsk = r.events.findIndex((e) => e.startsWith('ask: '));
  const before = r.events.slice(0, firstAsk).join('\n');
  assert.ok(before.includes('results/claude-b/index.html'), before);
  for (const season of ['spring', 'summer', 'autumn', 'winter']) {
    assert.ok(before.includes(`results/claude-b/${season}.jpg`), season);
  }
  // 기준표: 출처·intro·행 이름(REQUIREMENT_LABEL)·칸 문구·판정 기호(MARK_LABEL)
  assert.ok(before.includes('prompts/season-tree-v1.judging.md'), before);
  assert.ok(before.includes('스톱워치로 재지 않고'), before);
  assert.ok(before.includes('3D로 만든 언덕 위 나무, 하늘과 땅도 계절에 따라 바뀜'), before);
  assert.ok(before.includes('표시 없음'), before);
  for (const label of [...Object.values(REQUIREMENT_LABEL), ...Object.values(MARK_LABEL)]) {
    assert.ok(before.includes(label), label);
  }

  const { value } = await readJudgment(root, 'claude-b');
  assert.deepEqual(value.requirements, { scene: 'pass', seasonCycle: 'partial', seasonLook: 'fail', seasonLabel: 'pass' });
  assert.equal(value.note, '겨울 눈이 예쁘다');
  assert.equal(value.judgedAt, NOW_KST);
});

test('플래그만이면 판정 기준표 요약을 보여 주지 않는다 (물을 것이 없다)', async () => {
  const root = await okRoot();
  const r = await run(root, { slug: 'claude-b', ...ALL_FLAGS });
  assert.equal(r.code, 0, r.output);
  assert.ok(!r.output.includes('3D로 만든 언덕 위 나무'), r.output);
});

test('잘못된 입력은 이유를 보여 주고 다시 묻는다 (요구사항·메모 각각 3회까지)', async () => {
  const root = await okRoot();

  const r = await run(
    root,
    { slug: 'claude-b', scene: 'pass', cycle: 'pass', look: 'pass' },
    { answers: ['좋음', 'y', 'f', '가'.repeat(201), '나'.repeat(201), '세 번째에 맞게 쓴 메모'] },
  );

  assert.equal(r.code, 0, r.output);
  assert.equal(r.questions.length, 6);
  assert.equal(r.errors.length >= 4, true, r.output);
  assert.ok(r.errors.some((e) => e.includes('좋음')), r.output);
  assert.ok(r.errors.some((e) => /200자/.test(e)), r.output);
  const { value } = await readJudgment(root, 'claude-b');
  assert.equal(value.requirements.seasonLabel, 'fail');
  assert.equal(value.note, '세 번째에 맞게 쓴 메모');
});

test('같은 항목을 3번 잘못 입력하면 취소 → 저장하지 않고 exit 1', async () => {
  const root = await okRoot();

  const marks = await run(root, { slug: 'claude-b' }, { answers: ['x', 'y', 'z'] });
  assert.equal(marks.code, 1);
  assert.equal(marks.questions.length, 3);
  assert.match(marks.output, /취소/);
  assert.equal(await hasJudgment(root, 'claude-b'), false);

  const long = '가'.repeat(201);
  const note = await run(root, { slug: 'claude-b', scene: 'pass', cycle: 'pass', look: 'pass' }, { answers: ['p', long, long, long] });
  assert.equal(note.code, 1);
  assert.equal(note.questions.length, 4);
  assert.equal(await hasJudgment(root, 'claude-b'), false);
});

test('입력이 취소되면(EOF·Ctrl+C) 더 묻지 않고 저장하지 않은 채 exit 1', async () => {
  const root = await okRoot();

  const r = await run(root, { slug: 'claude-b' }, { answers: ['p', null] });

  assert.equal(r.code, 1);
  assert.equal(r.questions.length, 2);
  assert.match(r.output, /취소/);
  assert.equal(await hasJudgment(root, 'claude-b'), false);
});

test('결과물은 있지만 검증 전(스크린샷 없음)이면 그렇다고 알리고 판정은 받는다', async () => {
  const root = await makeStatusDataRoot(['검증 전']);

  const r = await run(root, { slug: 'model-unvalidated', ...ALL_FLAGS });

  assert.equal(r.code, 0, r.output);
  assert.match(r.output, /스크린샷.*npm run validate -- model-unvalidated/);
});

/* ───────── 기존 판정 ───────── */

test('기존 판정: 내용을 보여 주고 덮어쓸지 묻는다. 거절하면 파일이 그대로 → exit 1', async () => {
  const root = await okRoot('claude-b', { note: '예전 메모' });
  const before = await readFile(judgmentPath(root, 'claude-b'));

  const r = await run(root, { slug: 'claude-b', ...ALL_FLAGS }, { confirm: false });

  assert.equal(r.code, 1);
  assert.equal(r.confirms.length, 1);
  const shown = r.events.slice(0, r.events.findIndex((e) => e.startsWith('confirm: '))).join('\n');
  assert.ok(shown.includes('예전 메모'), shown);
  assert.ok(shown.includes(MARK_LABEL.pass), shown);
  assert.ok((await readFile(judgmentPath(root, 'claude-b'))).equals(before));

  // 메모 없이 한 판정은 "(없음)"으로 보여 준다
  const noNote = await okRoot('claude-b', { note: null });
  const r2 = await run(noNote, { slug: 'claude-b', ...ALL_FLAGS }, { confirm: false });
  assert.equal(r2.code, 1);
  assert.match(r2.output, /메모: \(없음\)/);
});

test('기존 판정: 승인하면 덮어쓴다', async () => {
  const root = await okRoot('claude-b', { note: '예전 메모' });

  const r = await run(root, { slug: 'claude-b', ...ALL_FLAGS }, { confirm: true });

  assert.equal(r.code, 0, r.output);
  assert.equal(r.confirms.length, 1);
  assert.equal((await readJudgment(root, 'claude-b')).value.note, ALL_FLAGS.note);
});

test('기존 판정: --yes면 묻지 않고 덮어쓴다', async () => {
  const root = await okRoot('claude-b', { note: '예전 메모' });

  const r = await run(root, { slug: 'claude-b', ...ALL_FLAGS, yes: true });

  assert.equal(r.code, 0, r.output);
  assert.deepEqual(r.confirms, []);
  const { value } = await readJudgment(root, 'claude-b');
  assert.equal(value.note, ALL_FLAGS.note);
  assert.equal(value.requirements.seasonLook, 'fail');
});

test('기존 판정 + 대화형: 덮어쓰기를 먼저 확인하고, 거절하면 아무것도 묻지 않는다', async () => {
  const root = await okRoot('claude-b', { note: '예전 메모' });

  const declined = await run(root, { slug: 'claude-b' }, { confirm: false });
  assert.equal(declined.code, 1);
  assert.deepEqual(declined.questions, []);

  const accepted = await run(root, { slug: 'claude-b' }, { confirm: true, answers: ['f', 'f', 'f', 'f', '새 메모'] });
  assert.equal(accepted.code, 0, accepted.output);
  const confirmAt = accepted.events.findIndex((e) => e.startsWith('confirm: '));
  const firstAsk = accepted.events.findIndex((e) => e.startsWith('ask: '));
  assert.ok(confirmAt >= 0 && confirmAt < firstAsk, accepted.output);
  assert.equal((await readJudgment(root, 'claude-b')).value.note, '새 메모');
});

test('기존 판정이 결과물과 sha256이 다르면 그렇게 알린다', async () => {
  const root = await okRoot('claude-b', { note: '예전 메모' });
  await patchJson<Record<string, unknown>>(root, 'results/claude-b/judgment.json', (j) => {
    j.outputSha256 = 'f'.repeat(64);
  });

  const r = await run(root, { slug: 'claude-b', ...ALL_FLAGS }, { confirm: false });

  assert.equal(r.code, 1);
  assert.match(r.output, /sha256/);
});

test('깨진 기존 판정(JSON 아님·스키마 위반)도 멈추지 않고 "깨진 판정"으로 알린 뒤 덮어쓸지 묻는다', async () => {
  for (const broken of ['{ not json', JSON.stringify({ schemaVersion: 1, note: '' })]) {
    const root = await okRoot();
    await writeFile(judgmentPath(root, 'claude-b'), broken, 'utf8');

    const declined = await run(root, { slug: 'claude-b', ...ALL_FLAGS }, { confirm: false });
    assert.equal(declined.code, 1);
    assert.match(declined.output, /깨진 판정/);
    assert.equal(declined.confirms.length, 1);
    assert.equal(await readFile(judgmentPath(root, 'claude-b'), 'utf8'), broken);

    const accepted = await run(root, { slug: 'claude-b', ...ALL_FLAGS }, { confirm: true });
    assert.equal(accepted.code, 0, accepted.output);
    assert.equal((await readJudgment(root, 'claude-b')).value.note, ALL_FLAGS.note);
  }
});

/* ───────── 거절: 아무것도 쓰지 않고 exit 1 ───────── */

/** 거절 확인: exit 1, 한국어 이유, 묻지 않음, 결과 폴더(있으면)가 그대로 */
async function assertRefused(root: string, opts: JudgeOptions, reason: RegExp) {
  const dir = path.join(root, 'results', opts.slug);
  const before = await snapshot(dir);
  const r = await run(root, opts);
  assert.equal(r.code, 1, r.output);
  assert.match(r.errors.join('\n'), reason);
  assert.match(r.errors.join('\n'), /[가-힣]/);
  assert.deepEqual(r.questions, []);
  assert.deepEqual(r.confirms, []);
  assert.deepEqual(await snapshot(dir), before);
}

test('거절: models.json에 없는 slug', async () => {
  const root = await okRoot();
  await assertRefused(root, { slug: 'no-such-model', ...ALL_FLAGS }, /no-such-model.*models\.json/);
});

test('거절: meta.json 없음 (생성 전)', async () => {
  const root = await okRoot();
  await assertRefused(root, { slug: 'gpt-a', ...ALL_FLAGS }, /meta\.json/);
});

test('거절: outcome이 ok가 아님 (잘림·HTML 없음·거부·생성 실패·한도 초과)', async () => {
  const root = await makeStatusDataRoot(['잘림', 'HTML 없음', '거부', '생성 실패', '한도 초과']);
  for (const [slug, outcome] of [
    ['model-truncated', 'truncated'],
    ['model-no-html', 'no_html'],
    ['model-refused', 'refused'],
    ['model-failed', 'api_failed'],
    ['model-usage-limit', 'api_failed'],
  ] as const) {
    await assertRefused(root, { slug, ...ALL_FLAGS }, new RegExp(outcome));
  }
});

test('거절: output이 null (meta.json이 스키마를 통과하지 못함)', async () => {
  const root = await okRoot();
  await patchJson<Record<string, unknown>>(root, 'results/claude-b/meta.json', (m) => {
    m.output = null;
  });
  await assertRefused(root, { slug: 'claude-b', ...ALL_FLAGS }, /output/);
});

test('거절: meta.json이 JSON이 아니거나 modelSlug가 폴더와 다름', async () => {
  const notJson = await okRoot();
  await writeFile(path.join(notJson, 'results', 'claude-b', 'meta.json'), '{ nope', 'utf8');
  await assertRefused(notJson, { slug: 'claude-b', ...ALL_FLAGS }, /meta\.json/);

  const otherSlug = await okRoot();
  await patchJson<Record<string, unknown>>(otherSlug, 'results/claude-b/meta.json', (m) => {
    m.modelSlug = 'claude-a';
  });
  await assertRefused(otherSlug, { slug: 'claude-b', ...ALL_FLAGS }, /modelSlug/);
});

test('거절: 메모 플래그가 비었거나(공백만 포함 — 메모 없이 저장하려면 --note를 뺀다) 200자를 넘음', async () => {
  const root = await okRoot();
  await assertRefused(root, { slug: 'claude-b', ...ALL_FLAGS, note: '' }, /메모.*--note를 빼/);
  await assertRefused(root, { slug: 'claude-b', ...ALL_FLAGS, note: '   ' }, /메모.*--note를 빼/);
  await assertRefused(root, { slug: 'claude-b', ...ALL_FLAGS, note: '가'.repeat(201) }, /메모.*200자/);
});

test('거절: 요구사항 플래그 값이 pass·partial·fail이 아님 (짧은 입력 p·a·f는 대화형에서만)', async () => {
  const root = await okRoot('claude-b', { note: '예전 메모' });
  await assertRefused(root, { slug: 'claude-b', ...ALL_FLAGS, scene: 'good' }, /--scene.*good/);
  await assertRefused(root, { slug: 'claude-b', ...ALL_FLAGS, label: 'p' }, /--label/);
  await assertRefused(root, { slug: 'claude-b', ...ALL_FLAGS, cycle: '' }, /--cycle/);
});

test('거절: models.json을 읽을 수 없음', async () => {
  const root = await okRoot();
  await writeFile(path.join(root, 'models.json'), '{ not json', 'utf8');
  await assertRefused(root, { slug: 'claude-b', ...ALL_FLAGS }, /models\.json/);
});

test('대화형인데 판정 기준표를 읽을 수 없으면 묻지 않고 exit 1', async () => {
  const root = await okRoot();
  await writeFile(path.join(root, 'prompts', 'season-tree-v1.judging.md'), '# 표 없음\n', 'utf8');

  const r = await run(root, { slug: 'claude-b' });

  assert.equal(r.code, 1);
  assert.deepEqual(r.questions, []);
  assert.match(r.output, /판정 기준표/);
  assert.equal(await hasJudgment(root, 'claude-b'), false);
});
