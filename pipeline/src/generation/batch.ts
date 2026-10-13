import { readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  CURRENT_PROMPT,
  GENERATOR_BY_PROVIDER,
  GenerationRecordSchema,
  ModelEntrySchema,
  loadPrompt,
  maxOutputTokensFor,
  sortByRelease,
  type GenerationRecord,
  type ModelEntry,
  type PromptSpec,
  type ProviderAdapter,
  type RunInput,
} from '@opb/core';
import type { AdapterRegistry } from '../adapters/registry.js';
import { redactSecrets, type AppConfig } from '../config/config.js';
import type { Confirm } from '../system/confirm.js';
import type { GitClient } from '../system/git.js';
import type { Output } from '../tokens.js';
import type { Validator } from '../validation/validator.js';
import { formatIssues, loadModels } from './models.js';
import { formatPreflight, preflightPassed, runPreflight } from './preflight.js';

/* ────────────────────────────────────────────────────────────
 * Batch (`npm run gen -- <slug…> | --all [--force]`): 대상 선택 → preflight → 순차 실행 → 덮어쓰기 규칙 →
 * 생성 직후 검증 → 요약표. 규칙은 ARCHITECTURE "Batch 규칙"·"다시 생성·수정 요청", ADR-004·ADR-012·ADR-032.
 * 판단(대상·폴더 상태·요약표)은 순수 함수, I/O(git·확인·검증·Runner)는 BatchDeps로 주입한다.
 * ──────────────────────────────────────────────────────────── */

export interface BatchOptions {
  slugs: readonly string[];
  all: boolean;
  force: boolean;
}

/* ───────── 대상 선택 ───────── */

export type TargetSelection = { ok: true; models: ModelEntry[] } | { ok: false; message: string };

/** slug는 준 순서대로, --all은 models.json 전체를 sortByRelease 순서로. 모르는 slug가 하나라도 있으면 실패 */
export function selectTargets(
  registry: readonly ModelEntry[],
  opts: Pick<BatchOptions, 'slugs' | 'all'>,
): TargetSelection {
  if (opts.all) return { ok: true, models: sortByRelease(registry) };
  const slugs = [...new Set(opts.slugs)];
  if (slugs.length === 0) return { ok: false, message: '대상이 없습니다: 모델 slug나 --all을 주세요.' };
  const bySlug = new Map(registry.map((m) => [m.slug, m]));
  const unknown = slugs.filter((s) => !bySlug.has(s));
  if (unknown.length > 0) {
    return { ok: false, message: `모르는 모델 slug: ${unknown.join(', ')} (models.json에 없음)` };
  }
  return { ok: true, models: slugs.map((s) => bySlug.get(s)!) };
}

/* ───────── 결과 폴더 상태 판정 ───────── */

export interface ResultDirSnapshot {
  slug: string;
  /** results/<slug>/ 안의 항목 이름. null = 폴더 없음 */
  files: readonly string[] | null;
  /** meta.json 내용. 없으면 null */
  metaText: string | null;
}

export type ResultDirPlan =
  | { kind: 'generate'; reason: 'new' | 'api_failed' | 'interrupted' | 'force'; clear: boolean }
  | { kind: 'skip'; record: GenerationRecord }
  | { kind: 'broken'; reason: string };

/**
 * 폴더 없음·빈 폴더 → 생성 / --force → 비우고 생성 / meta.json 없이 파일만(중단된 생성) → 비우고 생성 /
 * outcome api_failed(한도 초과 포함) → 비우고 생성 / 그 밖의 정상 기록 → 건너뜀 /
 * meta.json이 깨짐(JSON·스키마·modelSlug 불일치) → 건드리지 않고 broken(사람이 확인)
 */
export function planResultDir(dir: ResultDirSnapshot, force: boolean): ResultDirPlan {
  if (dir.files === null || dir.files.length === 0) return { kind: 'generate', reason: 'new', clear: false };
  if (force) return { kind: 'generate', reason: 'force', clear: true };
  if (dir.metaText === null) return { kind: 'generate', reason: 'interrupted', clear: true };

  let json: unknown;
  try {
    json = JSON.parse(dir.metaText);
  } catch (err) {
    return { kind: 'broken', reason: `meta.json이 JSON이 아닙니다 (${errorMessage(err)})` };
  }
  const parsed = GenerationRecordSchema.safeParse(json);
  if (!parsed.success) {
    return { kind: 'broken', reason: `meta.json이 스키마를 통과하지 못합니다: ${formatIssues(parsed.error)}` };
  }
  if (parsed.data.modelSlug !== dir.slug) {
    return {
      kind: 'broken',
      reason: `meta.json의 modelSlug(${parsed.data.modelSlug})가 폴더 이름(${dir.slug})과 다릅니다`,
    };
  }
  if (parsed.data.outcome === 'api_failed') return { kind: 'generate', reason: 'api_failed', clear: true };
  return { kind: 'skip', record: parsed.data };
}

const GENERATE_REASON: Record<Extract<ResultDirPlan, { kind: 'generate' }>['reason'], string> = {
  new: '생성합니다',
  api_failed: '이전 기록이 api_failed — 폴더를 비우고 다시 생성합니다',
  interrupted: 'meta.json 없이 파일만 있습니다(중단된 생성) — 폴더를 비우고 다시 생성합니다',
  force: '--force — 폴더를 비우고 다시 생성합니다',
};

/** --force 확인 문구: 파일이 있는 대상 폴더 목록 + 판정도 지워진다는 경고 (ADR-012) */
export function forceConfirmMessage(dirs: readonly ResultDirSnapshot[]): string {
  const lines = dirs
    .filter((d) => d.files !== null && d.files.length > 0)
    .map((d) => `  results/${d.slug}/${d.files!.includes('judgment.json') ? ' (판정 있음)' : ''}`);
  return [
    '--force: 아래 폴더의 파일을 모두 지우고 다시 생성합니다. 판정(judgment.json)도 함께 지워집니다.',
    ...lines,
    '계속할까요?',
  ].join('\n');
}

/* ───────── 버리기 전 커밋 검사 (ADR-032, ARCHITECTURE "다시 생성·수정 요청") ───────── */

/** git status의 경로 인자: results/<slug>/ */
export const resultDirGitPath = (slug: string) => `results/${slug}/`;

/**
 * --force로 비우기 전에 git에 커밋돼 있어야 하는 폴더인지 = 표본(버린 결과물로 남을 것)인지.
 * meta.json이 없거나(중단된 생성) outcome이 api_failed면 표본이 아니라 검사하지 않는다.
 * meta.json이 깨진 폴더는 무엇인지 모르므로 검사한다 (문서에 없는 경우 → 엄격하게)
 */
export function needsCommitBeforeDiscard(dir: ResultDirSnapshot): boolean {
  const plan = planResultDir(dir, false);
  return plan.kind === 'skip' || plan.kind === 'broken';
}

/** 커밋 안 된 변경이 있는 폴더 목록 + 먼저 커밋하라는 안내 (아무것도 지우지 않았다) */
export function uncommittedMessage(dirty: readonly { slug: string; status: string }[]): string {
  return [
    '--force: 아래 결과 폴더에 커밋 안 된 변경이 있습니다. 먼저 커밋하세요(ADR-032 — 버린 결과물은 git에 남아야 한다).',
    ...dirty.flatMap((d) => [
      `  ${resultDirGitPath(d.slug)}`,
      ...d.status
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => `      ${line}`),
    ]),
    '아무것도 지우지 않았습니다.',
  ].join('\n');
}

/* ───────── 결과 폴더 I/O (반드시 <repoRoot>/results/<slug> 안에서만) ───────── */

/** <repoRoot>/results/<slug>. models.json 스키마의 slug 규칙을 통과하지 않거나 results/ 바로 아래가 아니면 throw */
export function resultDirPath(repoRoot: string, slug: string): string {
  if (!ModelEntrySchema.shape.slug.safeParse(slug).success) {
    throw new Error(`결과 폴더로 쓸 수 없는 slug: ${JSON.stringify(slug)}`);
  }
  const resultsRoot = path.resolve(repoRoot, 'results');
  const dir = path.resolve(resultsRoot, slug);
  if (path.dirname(dir) !== resultsRoot) throw new Error(`results/ 밖을 가리키는 slug: ${JSON.stringify(slug)}`);
  return dir;
}

export async function readResultDir(repoRoot: string, slug: string): Promise<ResultDirSnapshot> {
  const dir = resultDirPath(repoRoot, slug);
  let files: string[];
  try {
    files = (await readdir(dir)).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { slug, files: null, metaText: null };
    throw err;
  }
  const metaText = files.includes('meta.json') ? await readFile(path.join(dir, 'meta.json'), 'utf8') : null;
  return { slug, files, metaText };
}

/** 폴더는 남기고 안의 항목만 지운다 (Runner는 빈 폴더를 요구한다) */
export async function clearResultDir(repoRoot: string, slug: string): Promise<void> {
  const dir = resultDirPath(repoRoot, slug);
  for (const name of await readdir(dir)) {
    await rm(path.join(dir, name), { recursive: true, force: true });
  }
}

/* ───────── 요약표 ───────── */

export interface SummaryRow {
  slug: string;
  action: 'generated' | 'skipped' | 'failed';
  /** 새로 만든 기록 또는 건너뛴 기존 기록. 실패면 null */
  record: GenerationRecord | null;
  /** 사람이 확인할 문제 (broken meta.json, 예외, 검증 실패). 있으면 exit 1 */
  issue: string | null;
}

const ACTION_LABEL: Record<SummaryRow['action'], string> = { generated: '생성', skipped: '건너뜀', failed: '실패' };

/**
 * slug · 처리 · outcome · 시도 수 · 걸린 시간(마지막 시도 latencyMs, ADR-021) · 비용.
 * 운영자용 로그라 사이트 표시 규칙(display.ts)이 아니라 원래 단위(초·USD 소수 4자리)로 보여 준다.
 */
export function formatSummary(rows: readonly SummaryRow[]): string {
  const table = [
    ['slug', '처리', 'outcome', '시도', '걸린 시간', '비용'],
    ...rows.map((r) => [r.slug, ACTION_LABEL[r.action], ...recordCells(r.record)]),
  ];
  const widths = table[0]!.map((_, col) => Math.max(...table.map((row) => displayWidth(row[col]!))));
  const lines = table.map((row) =>
    row
      .map((cell, col) => cell + ' '.repeat(widths[col]! - displayWidth(cell) + 2))
      .join('')
      .trimEnd(),
  );

  const count = (action: SummaryRow['action']) => rows.filter((r) => r.action === action).length;
  const out = [
    '요약',
    ...lines,
    '',
    `생성 ${count('generated')} · 건너뜀 ${count('skipped')} · 실패 ${count('failed')}`,
  ];
  const issues = rows.filter((r) => r.issue !== null);
  if (issues.length > 0) out.push('', '확인할 것:', ...issues.map((r) => `  - ${r.slug}: ${r.issue}`));
  return out.join('\n');
}

function recordCells(record: GenerationRecord | null): string[] {
  if (record === null) return ['-', '-', '-', '-'];
  const last = record.attempts[record.attempts.length - 1]!;
  return [
    describeOutcome(record),
    String(record.attempts.length),
    `${(last.latencyMs / 1000).toFixed(1)}s`,
    `$${record.cost.totalUsd.toFixed(4)}`,
  ];
}

/** api_failed면 마지막 시도의 실패 종류를 붙인다 (예: api_failed (usage_limit)) */
function describeOutcome(record: GenerationRecord): string {
  const last = record.attempts[record.attempts.length - 1]!.result;
  return record.outcome === 'api_failed' && last.type === 'error' ? `api_failed (${last.kind})` : record.outcome;
}

/** 터미널 칸 수: 한글 등 동아시아 전각 문자는 2칸 (validate 요약표도 쓴다) */
export function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const wide =
      (cp >= 0x1100 && cp <= 0x115f) ||
      (cp >= 0x2e80 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe4f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6);
    width += wide ? 2 : 1;
  }
  return width;
}

/** 실패(broken·예외)나 확인할 문제(검증 실패)가 있으면 1. api_failed 기록은 정상으로 남은 것이라 0 */
export function batchExitCode(rows: readonly SummaryRow[]): 0 | 1 {
  return rows.some((r) => r.action === 'failed' || r.issue !== null) ? 1 : 0;
}

/* ───────── 실행 ───────── */

export interface BatchDeps {
  config: AppConfig;
  /** 현재 프로세스 환경 (preflight의 API 키 변수 검사) */
  env: Readonly<Record<string, string | undefined>>;
  adapters: AdapterRegistry;
  git: GitClient;
  confirm: Confirm;
  validator: Validator;
  /** core runGeneration (Nest에서는 GenerationRunner.run) */
  run(adapter: ProviderAdapter, input: RunInput): Promise<GenerationRecord>;
  out: Output;
  nodeVersion: string;
}

/** exit code를 돌려준다: preflight 실패·대상 오류·확인 거절·준비 실패·모델 처리 중 실패가 있으면 1 */
export async function runBatch(opts: BatchOptions, deps: BatchDeps): Promise<number> {
  const { config, out } = deps;
  const fail = (message: string): number => {
    out.error(redactSecrets(message, config));
    return 1;
  };

  // 1. 대상: 모르는 slug면 아무것도 하지 않는다
  let registry: ModelEntry[];
  try {
    registry = await loadModels(config.repoRoot);
  } catch (err) {
    return fail(errorMessage(err));
  }
  const selected = selectTargets(registry, opts);
  if (!selected.ok) return fail(selected.message);
  const targets = selected.models;
  out.log(`대상 ${targets.length}개: ${targets.map((m) => m.slug).join(', ')}`);

  // 2. preflight: 하나라도 실패하면 어떤 어댑터도 만들거나 호출하지 않는다
  const checks = await runPreflight(targets, { env: deps.env, config, adapters: deps.adapters, git: deps.git });
  out.log(formatPreflight(checks));
  if (!preflightPassed(checks)) return fail('preflight 실패 — 어떤 모델도 호출하지 않고 종료합니다.');

  // 3. 준비: 여기서 실패하면 폴더를 비우거나 모델을 부르기 전에 멈춘다
  let gitCommit: string;
  let prompt: PromptSpec;
  let dirs: ResultDirSnapshot[];
  try {
    gitCommit = await resolveCommit(deps.git);
    prompt = await loadPrompt(config.repoRoot, CURRENT_PROMPT.id, CURRENT_PROMPT.version);
    dirs = await Promise.all(targets.map((m) => readResultDir(config.repoRoot, m.slug)));
  } catch (err) {
    return fail(errorMessage(err));
  }

  // 4. --force: 버릴 표본이 커밋돼 있는지 보고(ADR-032), 지울 폴더를 보여 주고 확인받는다. 멈추면 아무것도 바꾸지 않는다
  if (opts.force) {
    const toClear = dirs.filter((d) => d.files !== null && d.files.length > 0);
    const dirty: { slug: string; status: string }[] = [];
    for (const d of toClear.filter(needsCommitBeforeDiscard)) {
      let status: string;
      try {
        status = await deps.git.status([resultDirGitPath(d.slug)]);
      } catch (err) {
        return fail(`git status를 실행하지 못했습니다 (${resultDirGitPath(d.slug)}): ${errorMessage(err)} — 아무것도 지우지 않았습니다.`);
      }
      if (status.trim() !== '') dirty.push({ slug: d.slug, status });
    }
    if (dirty.length > 0) return fail(uncommittedMessage(dirty));

    if (toClear.length > 0 && !(await deps.confirm(forceConfirmMessage(toClear)))) {
      return fail('취소했습니다. 아무것도 바꾸지 않았습니다.');
    }
  }

  // 5. 순차 실행: 한 모델이 실패해도 다음 모델을 계속한다
  const rows: SummaryRow[] = [];
  for (const [i, model] of targets.entries()) {
    out.log('');
    out.log(`[${i + 1}/${targets.length}] ${model.slug}`);
    rows.push(await processModel(model, planResultDir(dirs[i]!, opts.force), { deps, gitCommit, prompt }));
  }

  out.log('');
  out.log(formatSummary(rows));
  return batchExitCode(rows);
}

interface RunContext {
  deps: BatchDeps;
  gitCommit: string;
  prompt: PromptSpec;
}

async function processModel(model: ModelEntry, plan: ResultDirPlan, ctx: RunContext): Promise<SummaryRow> {
  const { deps } = ctx;
  const { config, out } = deps;
  const slug = model.slug;
  const redact = (text: string) => redactSecrets(text, config);

  if (plan.kind === 'skip') {
    out.log(`  건너뜀: 기록이 있습니다 (outcome ${plan.record.outcome}). 다시 만들려면 --force`);
    return { slug, action: 'skipped', record: plan.record, issue: null };
  }
  if (plan.kind === 'broken') {
    out.error(`  실패: ${plan.reason} — 폴더를 건드리지 않았습니다`);
    return { slug, action: 'failed', record: null, issue: `${plan.reason} (results/${slug}/를 확인하세요)` };
  }

  let record: GenerationRecord;
  try {
    out.log(`  ${GENERATE_REASON[plan.reason]}`);
    if (plan.clear) await clearResultDir(config.repoRoot, slug);
    const tool = GENERATOR_BY_PROVIDER[model.provider];
    const entry = deps.adapters[tool];
    if (!entry) throw new Error(`등록되지 않은 생성 도구: ${tool}`); // preflight가 막지만 방어
    const adapter = entry.create(config);
    record = await deps.run(adapter, {
      model,
      prompt: ctx.prompt,
      maxOutputTokens: maxOutputTokensFor(adapter),
      repoRoot: config.repoRoot,
      outDirRel: path.posix.join('results', slug),
      runtime: { gitCommit: ctx.gitCommit, nodeVersion: deps.nodeVersion },
    });
  } catch (err) {
    const message = redact(errorMessage(err));
    out.error(`  실패: ${message}`);
    return { slug, action: 'failed', record: null, issue: message };
  }

  out.log(`  outcome ${describeOutcome(record)} · 시도 ${record.attempts.length}회`);
  const last = record.attempts[record.attempts.length - 1]!.result;
  if (last.type === 'error' && last.kind === 'usage_limit') {
    out.log('  한도 초과로 기록했습니다. 한도가 풀린 뒤 다시 실행하면 이 모델만 다시 돕니다.');
  }

  let issue: string | null = null;
  if (record.outcome === 'ok') {
    try {
      await deps.validator.validate(slug);
    } catch (err) {
      issue = redact(
        `검증 실패: ${errorMessage(err)} — validation은 null로 남았습니다. 나중에 npm run validate -- ${slug}`,
      );
      out.error(`  ${issue}`);
    }
  }
  return { slug, action: 'generated', record, issue };
}

/** runtime.gitCommit. 스키마의 커밋 해시 규칙을 통과해야 한다 (Runner가 저장할 때 실패하면 호출이 낭비된다). smoke도 쓴다 */
export async function resolveCommit(git: GitClient): Promise<string> {
  let head: string;
  try {
    head = await git.head();
  } catch (err) {
    throw new Error(`git rev-parse HEAD 실패 — 생성 전에 커밋이 한 번은 있어야 합니다 (${errorMessage(err)})`, {
      cause: err,
    });
  }
  if (!GenerationRecordSchema.shape.runtime.shape.gitCommit.safeParse(head).success) {
    throw new Error(`git rev-parse HEAD가 커밋 해시가 아닙니다: ${JSON.stringify(head)} — 커밋이 한 번은 있어야 합니다`);
  }
  return head;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
