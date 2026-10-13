import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  GenerationRecordSchema,
  judgingCriteriaPath,
  JudgmentSchema,
  loadJudgingCriteria,
  MARK_LABEL,
  MarkSchema,
  REQUIREMENT_LABEL,
  type GenerationRecord,
  type JudgingCriteria,
  type Judgment,
  type Mark,
  type ModelEntry,
  type RequirementKey,
} from '@opb/core';
import { resultDirPath } from '../generation/batch.js';
import { formatIssues, loadModels } from '../generation/models.js';
import type { Ask } from '../system/ask.js';
import type { Confirm } from '../system/confirm.js';
import type { Output } from '../tokens.js';
import { buildJudgment, MARK_SHORTHAND, NOTE_MAX, noteProblem, parseMarkAnswer } from './judgment.js';

/* ────────────────────────────────────────────────────────────
 * `npm run judge -- <slug>`: 사람이 판정한 값을 results/<slug>/judgment.json에 쓴다 (ARCHITECTURE "판정 도우미").
 *  - outcome이 ok이고 결과물이 있는 모델만. 모르는 slug·meta.json 없음·깨진 meta.json·잘못된 플래그는
 *    아무것도 쓰지 않고 exit 1
 *  - 플래그(--scene --cycle --look --label --note)로 받지 못한 값만 묻는다. 값의 기본값은 없다
 *  - 기존 판정이 있으면(깨졌어도) 보여 주고 덮어쓸지 확인한다(--yes면 확인 없이). 물을 것이 있어도 확인이 먼저다
 * ──────────────────────────────────────────────────────────── */

/** 요구사항 키 → 플래그 이름 (REQUIREMENT_LABEL 순서) */
export const MARK_OPTION = {
  scene: 'scene',
  seasonCycle: 'cycle',
  seasonLook: 'look',
  seasonLabel: 'label',
} as const satisfies Record<RequirementKey, string>;
type MarkOption = (typeof MARK_OPTION)[RequirementKey];

/** 플래그 값은 받은 문자열 그대로 (검사는 runJudge가 한다) */
export type JudgeOptions = { slug: string; note?: string; yes?: boolean } & { [K in MarkOption]?: string };

export interface JudgeDeps {
  repoRoot: string;
  ask: Ask;
  confirm: Confirm;
  out: Output;
  now: () => Date;
}

const REQUIREMENT_KEYS = Object.keys(REQUIREMENT_LABEL) as RequirementKey[];
/** 같은 항목을 이만큼 잘못 입력하면 취소 */
const MAX_TRIES = 3;
const NOT_SAVED = '판정을 저장하지 않았습니다.';

/** exit code: 저장했으면 0, 거절·취소·덮어쓰기 거절이면 1 */
export async function runJudge(opts: JudgeOptions, deps: JudgeDeps): Promise<number> {
  const { out } = deps;
  const refuse = (reason: string) => {
    out.error(`${reason} — ${NOT_SAVED}`);
    return 1;
  };

  // 1. 플래그 값 (파일을 읽기 전에)
  const given: Partial<Record<RequirementKey, Mark>> = {};
  for (const key of REQUIREMENT_KEYS) {
    const value = opts[MARK_OPTION[key]];
    if (value === undefined) continue;
    const mark = MarkSchema.safeParse(value);
    if (!mark.success) {
      return refuse(`--${MARK_OPTION[key]} 값을 알 수 없습니다: ${JSON.stringify(value)} (${MarkSchema.options.join(' · ')} 중 하나)`);
    }
    given[key] = mark.data;
  }
  if (opts.note !== undefined) {
    const problem = noteProblem(opts.note);
    if (problem) return refuse(`--note: ${problem}`);
  }

  // 2. 대상: models.json에 있고, meta.json이 스키마를 통과하고, 결과물이 있는 ok
  let models: ModelEntry[];
  try {
    models = await loadModels(deps.repoRoot);
  } catch (err) {
    return refuse(errorMessage(err));
  }
  const model = models.find((m) => m.slug === opts.slug);
  if (!model) return refuse(`모르는 모델 slug: ${opts.slug} (models.json에 없음)`);
  const target = await readJudgeTarget(deps.repoRoot, model.slug);
  if (target.kind === 'refused') return refuse(`${model.slug}: ${target.reason}`);
  const { record } = target;

  const missing = REQUIREMENT_KEYS.filter((k) => given[k] === undefined);
  const needsInput = missing.length > 0 || opts.note === undefined;
  let criteria: JudgingCriteria | null = null;
  if (needsInput) {
    try {
      criteria = await loadJudgingCriteria(deps.repoRoot, record.prompt.id, record.prompt.version);
    } catch (err) {
      return refuse(`판정 기준표를 읽을 수 없습니다: ${errorMessage(err)}`);
    }
  }

  // 3. 보여 주기: 결과물·스크린샷 (+ 물을 것이 있으면 판정 기준표)
  out.log(`판정: ${model.displayName} (${model.slug}) · 프롬프트 ${record.prompt.id}-${record.prompt.version}`);
  out.log(`  결과물    ${record.output.path}  (npm run dev의 결과 탭에서 한 바퀴 넘게 지켜본다)`);
  if (record.validation === null || record.validation.screenshots.length === 0) {
    out.log(`  스크린샷  없음 — 검증 전입니다 (npm run validate -- ${model.slug})`);
  } else {
    for (const [i, s] of record.validation.screenshots.entries()) {
      out.log(`  ${i === 0 ? '스크린샷' : '        '}  ${s.path}  (${s.atMs / 1000}초)`);
    }
  }
  if (criteria) {
    out.log('');
    for (const line of formatCriteria(criteria, relPath(deps.repoRoot, record))) out.log(line);
  }

  // 4. 기존 판정: 보여 주고 덮어쓸지 확인 (--yes면 확인 없이)
  const judgmentFile = path.join(resultDirPath(deps.repoRoot, model.slug), 'judgment.json');
  const judgmentRel = `results/${model.slug}/judgment.json`;
  const existing = await readExistingJudgment(judgmentFile);
  if (existing.kind !== 'none') {
    out.log('');
    if (existing.kind === 'broken') {
      out.log(`깨진 판정이 있습니다: ${judgmentRel} (${existing.reason})`);
    } else {
      out.log(`기존 판정이 있습니다: ${judgmentRel}`);
      for (const line of formatJudgment(existing.judgment, record)) out.log(`  ${line}`);
    }
    if (opts.yes) {
      out.log('--yes: 확인 없이 덮어씁니다.');
    } else if (!(await deps.confirm(`${judgmentRel}을 덮어쓸까요?`))) {
      out.error('덮어쓰지 않았습니다 — 기존 판정을 그대로 둡니다.');
      return 1;
    }
  }

  // 5. 플래그로 받지 못한 값만 묻는다
  const requirements = { ...given };
  if (needsInput) {
    out.log('');
    out.log(
      `입력: ${MarkSchema.options.map((m) => `${MARK_SHORTHAND[m]} 또는 ${m} = ${MARK_LABEL[m]}`).join(' · ')}` +
        ` (기본값 없음, Ctrl+C로 취소)`,
    );
  }
  for (const key of missing) {
    const mark = await askUntilValid(deps, `${REQUIREMENT_LABEL[key]} (${key}) [p/a/f]: `, (answer) => {
      const m = parseMarkAnswer(answer);
      return m === null
        ? { ok: false, problem: `판정 값이 아닙니다: ${JSON.stringify(answer)} (p·a·f 또는 pass·partial·fail)` }
        : { ok: true, value: m };
    });
    if (mark === null) return cancelled(out);
    requirements[key] = mark;
  }
  let note = opts.note;
  if (note === undefined) {
    const answer = await askUntilValid(deps, `메모 (1~${NOTE_MAX}자, 사이트에 그대로 공개): `, (a) => {
      const problem = noteProblem(a);
      return problem ? { ok: false, problem } : { ok: true, value: a };
    });
    if (answer === null) return cancelled(out);
    note = answer;
  }

  // 6. 저장: 스키마 검사(buildJudgment) 뒤 meta.json과 같은 형식(2칸 들여쓰기 + 끝 줄바꿈)
  const judgment = buildJudgment({
    record,
    answers: { requirements: requirements as Judgment['requirements'], note },
    now: deps.now(),
  });
  await writeFile(judgmentFile, JSON.stringify(judgment, null, 2) + '\n', 'utf8');
  out.log('');
  out.log(`저장했습니다: ${judgmentRel}`);
  for (const line of formatJudgment(judgment, record)) out.log(`  ${line}`);
  return 0;
}

/* ───────── 대상 읽기 ───────── */

/** 결과물이 있는 기록 */
type JudgeableRecord = GenerationRecord & { output: NonNullable<GenerationRecord['output']> };

type JudgeTarget = { kind: 'ok'; record: JudgeableRecord } | { kind: 'refused'; reason: string };

/** results/<slug>/meta.json → 판정할 수 있는 기록인지. 파일은 바꾸지 않는다 */
async function readJudgeTarget(repoRoot: string, slug: string): Promise<JudgeTarget> {
  const file = path.join(resultDirPath(repoRoot, slug), 'meta.json');
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { kind: 'refused', reason: 'meta.json이 없습니다 (생성 전). 결과물이 있는 모델만 판정합니다' };
    }
    return { kind: 'refused', reason: `meta.json을 읽을 수 없습니다 (${errorMessage(err)})` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { kind: 'refused', reason: `meta.json이 JSON이 아닙니다 (${errorMessage(err)})` };
  }
  const parsed = GenerationRecordSchema.safeParse(raw);
  if (!parsed.success) {
    return { kind: 'refused', reason: `meta.json이 스키마를 통과하지 못합니다: ${formatIssues(parsed.error)}` };
  }
  const record = parsed.data;
  if (record.modelSlug !== slug) {
    return { kind: 'refused', reason: `meta.json의 modelSlug(${record.modelSlug})가 폴더 이름(${slug})과 다릅니다` };
  }
  if (record.outcome !== 'ok') {
    return { kind: 'refused', reason: `outcome이 ${record.outcome}입니다. 결과물이 있는 모델(ok)만 판정합니다` };
  }
  if (record.output === null) return { kind: 'refused', reason: 'meta.json의 output이 null입니다 (결과물 없음)' };
  return { kind: 'ok', record: { ...record, output: record.output } };
}

type ExistingJudgment = { kind: 'none' } | { kind: 'ok'; judgment: Judgment } | { kind: 'broken'; reason: string };

/** 기존 judgment.json. 깨져 있어도 던지지 않고 이유를 돌려준다 */
async function readExistingJudgment(file: string): Promise<ExistingJudgment> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'none' };
    return { kind: 'broken', reason: `읽을 수 없습니다: ${errorMessage(err)}` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { kind: 'broken', reason: `JSON이 아닙니다: ${errorMessage(err)}` };
  }
  const parsed = JudgmentSchema.safeParse(raw);
  if (!parsed.success) return { kind: 'broken', reason: `스키마를 통과하지 못합니다: ${formatIssues(parsed.error)}` };
  return { kind: 'ok', judgment: parsed.data };
}

/* ───────── 입력 ───────── */

type Parsed<T> = { ok: true; value: T } | { ok: false; problem: string };

/** 답이 맞을 때까지 MAX_TRIES번 묻는다. 취소되거나 다 틀리면 null */
async function askUntilValid<T>(
  deps: Pick<JudgeDeps, 'ask' | 'out'>,
  question: string,
  parse: (answer: string) => Parsed<T>,
): Promise<T | null> {
  for (let i = 1; i <= MAX_TRIES; i++) {
    const answer = await deps.ask(question);
    if (answer === null) return null;
    const parsed = parse(answer);
    if (parsed.ok) return parsed.value;
    deps.out.error(`  ${parsed.problem}${i < MAX_TRIES ? ' — 다시 입력하세요.' : ''}`);
  }
  deps.out.error(`  ${MAX_TRIES}번 잘못 입력했습니다.`);
  return null;
}

function cancelled(out: Output): number {
  out.error(`입력이 취소되었습니다 — ${NOT_SAVED}`);
  return 1;
}

/* ───────── 표시 ───────── */

/** 판정 기준표 요약: 출처 · 표 위 문단 · 요구사항마다 기호별 문구 */
function formatCriteria(criteria: JudgingCriteria, source: string): string[] {
  const lines = [`판정 기준 (${source})`, ...criteria.intro.map((l) => `  ${l}`)];
  for (const row of criteria.rows) {
    lines.push('', `  ${row.label} (${row.key})`);
    for (const mark of MarkSchema.options) lines.push(`    ${MARK_LABEL[mark]}: ${row[mark]}`);
  }
  return lines;
}

/** 판정 시각 · 요구사항 4개(MARK_LABEL) · 메모 · 결과물 sha256이 지금 결과물과 다르면 그 사실 */
function formatJudgment(j: Judgment, record: JudgeableRecord): string[] {
  return [
    `판정 시각: ${j.judgedAt}`,
    ...REQUIREMENT_KEYS.map((k) => `${REQUIREMENT_LABEL[k]}: ${MARK_LABEL[j.requirements[k]]}`),
    `메모: ${j.note}`,
    ...(j.outputSha256 === record.output.sha256
      ? []
      : [`(이 판정의 outputSha256이 지금 결과물의 sha256과 다릅니다 — 예전 결과물을 보고 한 판정)`]),
  ];
}

/** 판정 기준표 파일의 레포 기준 POSIX 경로 */
function relPath(repoRoot: string, record: GenerationRecord): string {
  return path.relative(repoRoot, judgingCriteriaPath(repoRoot, record.prompt.id, record.prompt.version)).split(path.sep).join('/');
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
