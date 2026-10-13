import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { REQUIREMENT_LABEL } from '../src/display.js';
import { loadJudgingCriteria, parseJudgingCriteria } from '../src/judging.js';
import { CURRENT_PROMPT } from '../src/prompt.js';

/* ────────────────────────────────────────────────────────────
 * 판정 기준표(prompts/<id>-<version>.judging.md) 읽기.
 * 레포의 기준표는 읽기만 하고, 깨진 파일은 OS 임시 디렉토리에 만든다.
 * ──────────────────────────────────────────────────────────── */

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const HEADER = '| 요구사항 | ✓ 충족 (`pass`) | △ 부분 충족 (`partial`) | ✗ 미충족 (`fail`) |\n|---|---|---|---|\n';
const row = (name: string, key: string) => `| ${name} (\`${key}\`) | ${key} 좋음 | ${key} 보통 | ${key} 나쁨 |\n`;
const ALL_ROWS = row('장면', 'scene') + row('계절 순환', 'seasonCycle') + row('계절 모습', 'seasonLook') + row('계절 이름', 'seasonLabel');

/** 임시 레포에 prompts/season-tree-v1.judging.md를 바이트 그대로 쓴다 */
async function fakeRepo(content: string | Buffer) {
  const repoRoot = await mkdtemp(path.join(tmpdir(), 'opb-judging-'));
  await mkdir(path.join(repoRoot, 'prompts'));
  const file = path.join(repoRoot, 'prompts', 'season-tree-v1.judging.md');
  await writeFile(file, content);
  return { repoRoot, file };
}

const throwsWith =
  (...parts: string[]) =>
  (err: unknown) => {
    assert.ok(err instanceof Error);
    for (const p of parts) assert.ok(err.message.includes(p), `"${err.message}" should include "${p}"`);
    return true;
  };

/* ───────── 레포의 기준표 ───────── */

test('레포의 판정 기준표: 행 4개를 REQUIREMENT_LABEL 순서·이름으로, 칸 문구는 파일 그대로 (읽기만)', async () => {
  const criteria = await loadJudgingCriteria(REPO_ROOT, CURRENT_PROMPT.id, CURRENT_PROMPT.version);

  assert.deepEqual(
    criteria.rows.map((r) => [r.key, r.label]),
    Object.entries(REQUIREMENT_LABEL),
  );
  assert.deepEqual(criteria.rows[0], {
    key: 'scene',
    label: '장면',
    pass: '3D로 만든 언덕 위 나무, 하늘과 땅도 계절에 따라 바뀜',
    partial: '나무는 있지만 하늘·땅이 안 바뀌거나, 2D로 만듦',
    fail: '나무가 없거나 화면이 안 나옴',
  });
  assert.deepEqual(criteria.rows[3], {
    key: 'seasonLabel',
    label: '계절 이름',
    pass: '지금 계절에 맞게 표시',
    partial: '표시는 되지만 틀리거나 늦게 바뀜',
    fail: '표시 없음',
  });
  for (const r of criteria.rows) {
    for (const cell of [r.pass, r.partial, r.fail]) assert.ok(cell.length > 0 && cell === cell.trim(), r.key);
  }
});

test('레포의 판정 기준표: intro는 표 위의 문단 줄들이다 (제목·빈 줄·표 아래 문단은 넣지 않는다)', async () => {
  const file = path.join(REPO_ROOT, 'prompts', 'season-tree-v1.judging.md');
  const criteria = parseJudgingCriteria(await readFile(file, 'utf8'));

  assert.deepEqual(criteria.intro, [
    '결과물을 한 바퀴 넘게(약 50초) 지켜보고, 자동 검증이 찍은 스크린샷 4장(5·15·25·35초)을 함께 본다.',
    '"계절마다 10초"는 스톱워치로 재지 않고, 스크린샷 4장이 각각 맞는 계절인지로 판단한다.',
  ]);
  assert.ok(criteria.intro.every((l) => !l.includes('judgment.json')));
});

/* ───────── 표 읽기 규칙 ───────── */

test('칸 안의 백틱과 기호는 글자 그대로 두고 앞뒤 공백만 뗀다', () => {
  const md =
    '# 기준\n\n소개 문단\n\n' +
    HEADER +
    '| 장면 (`scene`) |   `canvas`가 있음   | △는 `div` | ✗ 없음 |\n' +
    row('계절 순환', 'seasonCycle') +
    row('계절 모습', 'seasonLook') +
    row('계절 이름', 'seasonLabel');

  const criteria = parseJudgingCriteria(md);
  assert.deepEqual(criteria.rows[0], { key: 'scene', label: '장면', pass: '`canvas`가 있음', partial: '△는 `div`', fail: '✗ 없음' });
  assert.deepEqual(criteria.intro, ['소개 문단']);
});

test('행 순서는 파일이 아니라 REQUIREMENT_LABEL 순서, 표시 이름도 REQUIREMENT_LABEL (파일의 이름 칸은 쓰지 않는다)', () => {
  const md = HEADER + row('라벨', 'seasonLabel') + row('Scene', 'scene') + row('모습', 'seasonLook') + row('순환', 'seasonCycle');

  const criteria = parseJudgingCriteria(md);
  assert.deepEqual(
    criteria.rows.map((r) => [r.key, r.label, r.pass]),
    [
      ['scene', '장면', 'scene 좋음'],
      ['seasonCycle', '계절 순환', 'seasonCycle 좋음'],
      ['seasonLook', '계절 모습', 'seasonLook 좋음'],
      ['seasonLabel', '계절 이름', 'seasonLabel 좋음'],
    ],
  );
  assert.deepEqual(criteria.intro, []);
});

test('열 순서는 열 이름의 (`pass`)·(`partial`)·(`fail`)로 정한다', () => {
  const header = '| 요구사항 | ✗ (`fail`) | ✓ (`pass`) | △ (`partial`) |\n| --- | :--- | :---: | ---: |\n';
  const md = header + ALL_ROWS;

  const scene = parseJudgingCriteria(md).rows[0]!;
  assert.deepEqual([scene.fail, scene.pass, scene.partial], ['scene 좋음', 'scene 보통', 'scene 나쁨']);
});

/* ───────── 거부 ───────── */

test('표가 없으면 던진다 (메시지에 출처)', () => {
  assert.throws(() => parseJudgingCriteria('# 기준\n\n문단만 있다\n', 'prompts/x.judging.md'), throwsWith('prompts/x.judging.md', 'table'));
});

test('구분 줄이 없거나 열 이름에 pass·partial·fail이 없으면 던진다', () => {
  assert.throws(() => parseJudgingCriteria(HEADER.split('\n')[0] + '\n' + ALL_ROWS), throwsWith('separator'));
  const noPartial = '| 요구사항 | ✓ (`pass`) | △ | ✗ (`fail`) |\n|---|---|---|---|\n';
  assert.throws(() => parseJudgingCriteria(noPartial + ALL_ROWS), throwsWith('partial'));
});

test('요구사항 키가 빠지거나 겹치거나 모르는 키면 던진다 (메시지에 키)', () => {
  const missing = HEADER + row('장면', 'scene') + row('계절 순환', 'seasonCycle') + row('계절 모습', 'seasonLook');
  assert.throws(() => parseJudgingCriteria(missing, 'src.md'), throwsWith('src.md', 'seasonLabel'));

  const duplicate = HEADER + ALL_ROWS + row('장면 다시', 'scene');
  assert.throws(() => parseJudgingCriteria(duplicate, 'src.md'), throwsWith('src.md', 'scene', 'duplicate'));

  const unknown = HEADER + ALL_ROWS + row('음악', 'music');
  assert.throws(() => parseJudgingCriteria(unknown, 'src.md'), throwsWith('src.md', 'music'));

  const noKey = HEADER + ALL_ROWS + '| 장면 | a | b | c |\n';
  assert.throws(() => parseJudgingCriteria(noKey, 'src.md'), throwsWith('src.md', '장면'));
});

test('칸 수가 다르거나 빈 칸이 있으면 던진다', () => {
  const short = HEADER + ALL_ROWS.replace('| scene 나쁨 |', '|');
  assert.throws(() => parseJudgingCriteria(short), throwsWith('scene'));

  const empty = HEADER + ALL_ROWS.replace('scene 보통', '  ');
  assert.throws(() => parseJudgingCriteria(empty), throwsWith('scene', 'partial'));
});

/* ───────── 파일 읽기 (loadPrompt와 같은 규칙) ───────── */

test('loadJudgingCriteria: prompts/<id>-<version>.judging.md를 읽어 parse한 값과 같다', async () => {
  const md = '# 기준\n\n소개\n\n' + HEADER + ALL_ROWS + '\n표 아래 문단\n';
  const { repoRoot } = await fakeRepo(md);
  assert.deepEqual(await loadJudgingCriteria(repoRoot, 'season-tree', 'v1'), parseJudgingCriteria(md));
});

test('loadJudgingCriteria: 파일이 없거나 표가 없으면 파일 경로가 든 에러', async () => {
  const { repoRoot } = await fakeRepo('x\n');
  const missing = path.join(repoRoot, 'prompts', 'season-tree-v2.judging.md');
  await assert.rejects(loadJudgingCriteria(repoRoot, 'season-tree', 'v2'), throwsWith(missing));

  const noTable = await fakeRepo('# 기준\n\n문단만\n');
  await assert.rejects(loadJudgingCriteria(noTable.repoRoot, 'season-tree', 'v1'), throwsWith(noTable.file, 'table'));
});

test('loadJudgingCriteria: CRLF·BOM은 고치지 않고 거부', async () => {
  const crlf = await fakeRepo((HEADER + ALL_ROWS).replaceAll('\n', '\r\n'));
  await assert.rejects(loadJudgingCriteria(crlf.repoRoot, 'season-tree', 'v1'), throwsWith(crlf.file, 'CRLF'));

  const bom = await fakeRepo('﻿' + HEADER + ALL_ROWS);
  await assert.rejects(loadJudgingCriteria(bom.repoRoot, 'season-tree', 'v1'), throwsWith(bom.file, 'BOM'));
});
