import path from 'node:path';
import { REQUIREMENT_LABEL, type RequirementKey } from './display.js';
import { readPromptFile } from './prompt.js';
import { MarkSchema, type Mark } from './schema.js';

/* ────────────────────────────────────────────────────────────
 * 판정 기준표 읽기: prompts/<id>-<version>.judging.md (단일 출처)
 * 판정 도우미(pipeline judge)와 사이트 프롬프트 탭이 같은 값을 쓴다.
 * 표의 행 이름 칸 `장면 (`scene`)`에서는 키만 읽고, 표시 이름은 REQUIREMENT_LABEL을 쓴다.
 * ──────────────────────────────────────────────────────────── */

export interface JudgingRow {
  key: RequirementKey;
  /** REQUIREMENT_LABEL[key] */
  label: string;
  /** 칸 문구 그대로 (앞뒤 공백만 뗌, 백틱 등은 글자 그대로) */
  pass: string;
  partial: string;
  fail: string;
}

export interface JudgingCriteria {
  /** 표 위의 문단 줄들 (제목·빈 줄 제외). 표 아래 내용은 넣지 않는다 */
  intro: string[];
  /** REQUIREMENT_LABEL 순서로 4개 */
  rows: JudgingRow[];
}

const REQUIREMENT_KEYS = Object.keys(REQUIREMENT_LABEL) as RequirementKey[];

/** 행 이름 칸·열 이름 칸 끝의 (`key`) */
const KEY_IN_CELL = /\(`([^`]+)`\)\s*$/;
const SEPARATOR_CELL = /^:?-+:?$/;

/**
 * 판정 기준표 Markdown에서 첫 번째 표를 읽는다. source는 에러 메시지에 넣을 출처(파일 경로).
 * 표가 없거나, 열 이름에 (`pass`)·(`partial`)·(`fail`)이 없거나, 요구사항 키가 빠지거나 겹치거나 모르는 키면 던진다.
 */
export function parseJudgingCriteria(markdown: string, source = 'judging criteria'): JudgingCriteria {
  function fail(message: string): never {
    throw new Error(`${source}: ${message}`);
  }
  const lines = markdown.split('\n');
  const start = lines.findIndex(isTableLine);
  if (start === -1) fail('no table (expected a Markdown table of requirements)');
  let end = start;
  while (end < lines.length && isTableLine(lines[end]!)) end++;

  const intro = lines
    .slice(0, start)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

  const [headerLine, separatorLine, ...rowLines] = lines.slice(start, end);
  const header = splitRow(headerLine!);
  if (separatorLine === undefined || !splitRow(separatorLine).every((c) => SEPARATOR_CELL.test(c))) {
    fail('table has no separator line (|---|) under the header');
  }

  // 열 이름의 (`pass`)·(`partial`)·(`fail`)로 열 위치를 정한다
  const column = {} as Record<Mark, number>;
  for (const mark of MarkSchema.options) {
    const i = header.findIndex((cell, col) => col > 0 && KEY_IN_CELL.exec(cell)?.[1] === mark);
    if (i === -1) fail(`table header has no column for (\`${mark}\`)`);
    column[mark] = i;
  }

  const byKey = new Map<RequirementKey, JudgingRow>();
  for (const line of rowLines) {
    const cells = splitRow(line);
    const name = cells[0] ?? '';
    const key = KEY_IN_CELL.exec(name)?.[1];
    if (key === undefined) fail(`row "${name}" has no requirement key like (\`scene\`)`);
    if (!isRequirementKey(key)) fail(`unknown requirement key "${key}" (expected ${REQUIREMENT_KEYS.join(', ')})`);
    if (byKey.has(key)) fail(`duplicate requirement key "${key}"`);
    if (cells.length !== header.length) fail(`row "${key}" has ${cells.length} cells, header has ${header.length}`);
    const text = {} as Record<Mark, string>;
    for (const mark of MarkSchema.options) {
      text[mark] = cells[column[mark]]!;
      if (text[mark].length === 0) fail(`row "${key}" has an empty ${mark} cell`);
    }
    byKey.set(key, { key, label: REQUIREMENT_LABEL[key], ...text });
  }

  const missing = REQUIREMENT_KEYS.filter((k) => !byKey.has(k));
  if (missing.length > 0) fail(`missing requirement rows: ${missing.join(', ')}`);
  return { intro, rows: REQUIREMENT_KEYS.map((k) => byKey.get(k)!) };
}

/** prompts/<id>-<version>.judging.md를 loadPrompt와 같은 규칙(UTF-8, BOM·CRLF 거부)으로 읽는다 */
export async function loadJudgingCriteria(repoRoot: string, id: string, version: string): Promise<JudgingCriteria> {
  const file = judgingCriteriaPath(repoRoot, id, version);
  return parseJudgingCriteria(await readPromptFile(file), file);
}

export function judgingCriteriaPath(repoRoot: string, id: string, version: string): string {
  return path.join(repoRoot, 'prompts', `${id}-${version}.judging.md`);
}

const isTableLine = (line: string) => line.trimStart().startsWith('|');

const isRequirementKey = (key: string): key is RequirementKey => (REQUIREMENT_KEYS as string[]).includes(key);

/** `| a | b \| c |` → ['a', 'b | c'] (앞뒤 |와 칸의 앞뒤 공백을 뗀다) */
function splitRow(line: string): string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  return inner.split(/(?<!\\)\|/).map((cell) => cell.trim().replaceAll('\\|', '|'));
}
