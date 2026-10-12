import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  CURRENT_PROMPT,
  DEFAULT_RUN_POLICY,
  GENERATOR_BY_PROVIDER,
  ModelEntrySchema,
  loadPrompt,
  maxOutputTokensFor,
  type GenerationRecord,
  type ModelEntry,
  type PromptSpec,
  type ProviderAdapter,
  type RunInput,
  type RunPolicy,
} from '@opb/core';
import { RAW_FILE_NAME, type RawFile, type Redact } from '../adapters/raw-recorder.js';
import type { AdapterEntry, AdapterRegistry } from '../adapters/registry.js';
import { redactSecrets, type AppConfig } from '../config/config.js';
import type { GitClient } from '../system/git.js';
import type { Output } from '../tokens.js';
import { resolveCommit, selectTargets } from './batch.js';
import { loadModels } from './models.js';
import { formatPreflight, preflightPassed, runPreflight } from './preflight.js';

/* ────────────────────────────────────────────────────────────
 * smoke (`npm run smoke -- <slug>`): 짧은 요청 1회로 도구·인증·출력 파싱을 확인한다 (ARCHITECTURE "smoke").
 * preflight(git 검사 제외) → 재시도 없이 1회 → results-smoke/<slug>-<시각>/에 meta.json + 도구 원본 출력(raw-*).
 * 원본 출력은 레지스트리 항목의 기록 래퍼(createRecorder)가 모으고, Runner가 끝난 뒤 같은 폴더에 쓴다.
 * results/에는 쓰지 않는다 — results-smoke/는 gitignore, 사람이 확인한 뒤 어댑터 fixture로 옮긴다.
 * ──────────────────────────────────────────────────────────── */

/** smoke 프롬프트. system은 실제 생성과 같은 파일을 읽는다 — 시스템 지시문 교체가 적용되는지 확인하려는 것 (ADR-005) */
export const SMOKE_PROMPT = {
  id: 'smoke',
  version: 'v1',
  user: "'Hello'라고 쓰인 아주 짧은 HTML 페이지 하나를 ```html 코드 블록 하나에 담아주세요.",
} as const;

export const SMOKE_MAX_OUTPUT_TOKENS = 8_000;

/** 재시도 없이 1회. 짧은 응답이라 타임아웃도 짧게 */
export const SMOKE_RUN_POLICY: RunPolicy = { ...DEFAULT_RUN_POLICY, maxAttempts: 1, timeoutMs: 5 * 60_000 };

/** 입력 토큰이 이보다 많으면 도구 기본 지시문·메모리가 섞인 것으로 의심한다 (OPERATIONS "smoke로 확인할 것" 공통) */
export const SMOKE_INPUT_TOKEN_WARN = 2_000;

export const SMOKE_ROOT = 'results-smoke';

export async function loadSmokePrompt(repoRoot: string): Promise<PromptSpec> {
  const { system } = await loadPrompt(repoRoot, CURRENT_PROMPT.id, CURRENT_PROMPT.version);
  return { id: SMOKE_PROMPT.id, version: SMOKE_PROMPT.version, system, user: SMOKE_PROMPT.user };
}

/** results-smoke/<slug>-<YYYYMMDD-HHmmss>. 사람이 읽는 폴더라 실행 PC의 로컬 시각 */
export function smokeDirRel(slug: string, at: Date): string {
  if (!ModelEntrySchema.shape.slug.safeParse(slug).success) {
    throw new Error(`저장 폴더로 쓸 수 없는 slug: ${JSON.stringify(slug)}`);
  }
  const p2 = (n: number) => String(n).padStart(2, '0');
  const date = `${at.getFullYear()}${p2(at.getMonth() + 1)}${p2(at.getDate())}`;
  const time = `${p2(at.getHours())}${p2(at.getMinutes())}${p2(at.getSeconds())}`;
  return path.posix.join(SMOKE_ROOT, `${slug}-${date}-${time}`);
}

export function inputTokenWarning(inputTokens: number): string | null {
  if (inputTokens <= SMOKE_INPUT_TOKEN_WARN) return null;
  return (
    `경고: 입력 토큰 ${n(inputTokens)}개 — ${n(SMOKE_INPUT_TOKEN_WARN)}을 넘습니다. ` +
    '도구 기본 지시문·메모리가 섞였을 수 있음 (격리 옵션을 확인하세요)'
  );
}

/** 끝난 뒤 보여 줄 내용: 저장 폴더·파일, outcome, 사용량, 걸린 시간, 입력 토큰 경고 */
export function formatSmokeReport(record: GenerationRecord, outDirRel: string, files: readonly string[]): string {
  const attempt = record.attempts[record.attempts.length - 1]!;
  const result = attempt.result;
  const { inputTokens, outputTokens, reasoningTokens } = record.usageTotal;

  const lines = [`저장 폴더: ${outDirRel}/`, `  ${[...files].sort().join(' · ')}`];
  if (result.type === 'error') {
    lines.push(`outcome: ${record.outcome} (${result.kind}) — ${result.message}`);
  } else {
    lines.push(
      `outcome: ${record.outcome}`,
      `응답: stopReason ${result.stopReason} (${result.rawStopReason ?? '-'}) · 모델 ${result.resolvedModelId ?? '-'}`,
    );
  }
  lines.push(
    `사용량: 입력 ${n(inputTokens)} · 출력 ${n(outputTokens)} · 추론 ${reasoningTokens === null ? '-' : n(reasoningTokens)} (토큰)`,
    `걸린 시간: ${seconds(attempt.latencyMs)}${attempt.firstTokenMs === null ? '' : ` (첫 토큰 ${seconds(attempt.firstTokenMs)})`}`,
  );
  const warning = inputTokenWarning(inputTokens);
  if (warning !== null) lines.push(warning);
  if (files.some((f) => RAW_FILE_NAME.test(f))) {
    lines.push('원본 출력(raw-*)은 확인한 뒤 어댑터 테스트 fixture로 옮긴다 (OPERATIONS.md "smoke로 확인할 것")');
  }
  return lines.join('\n');
}

/* ───────── 실행 ───────── */

export interface SmokeOptions {
  slug: string;
}

export interface SmokeDeps {
  config: AppConfig;
  /** 현재 프로세스 환경 (preflight의 API 키 변수 검사) */
  env: Readonly<Record<string, string | undefined>>;
  adapters: AdapterRegistry;
  /** HEAD만 읽는다 (meta.json runtime.gitCommit). 커밋 안 된 변경 검사는 하지 않는다 */
  git: GitClient;
  /** core runGeneration (Nest에서는 GenerationRunner.run) */
  run(adapter: ProviderAdapter, input: RunInput, policy: RunPolicy): Promise<GenerationRecord>;
  out: Output;
  /** 저장 폴더 이름의 시각 */
  now(): Date;
  nodeVersion: string;
}

/** exit code: 응답을 받아 기록했으면 0. 대상·preflight·준비 실패, 예외, api_failed면 1 */
export async function runSmoke(opts: SmokeOptions, deps: SmokeDeps): Promise<number> {
  const { config, out } = deps;
  const redact: Redact = (text) => redactSecrets(text, config);
  const fail = (message: string): number => {
    out.error(redact(message));
    return 1;
  };

  // 1. 대상: slug 정확히 1개
  let model: ModelEntry;
  try {
    const selected = selectTargets(await loadModels(config.repoRoot), { slugs: [opts.slug], all: false });
    if (!selected.ok) return fail(selected.message);
    model = selected.models[0]!;
  } catch (err) {
    return fail(errorMessage(err));
  }
  out.log(`smoke 대상: ${model.slug} (${model.modelId})`);

  // 2. preflight: git 검사만 빼고 gen과 같다. 실패하면 어댑터를 만들지도 부르지도 않는다
  const checks = await runPreflight(
    [model],
    { env: deps.env, config, adapters: deps.adapters, git: deps.git },
    { checkGit: false },
  );
  out.log(formatPreflight(checks));
  if (!preflightPassed(checks)) return fail('preflight 실패 — 모델을 호출하지 않고 종료합니다.');

  // 3. 준비: 여기서 실패하면 모델을 부르지 않는다
  const tool = GENERATOR_BY_PROVIDER[model.provider];
  let gitCommit: string;
  let prompt: PromptSpec;
  let outDirRel: string;
  let recorded: RecordedAdapter;
  try {
    gitCommit = await resolveCommit(deps.git);
    prompt = await loadSmokePrompt(config.repoRoot);
    outDirRel = smokeDirRel(model.slug, deps.now());
    const entry: AdapterEntry<unknown> | undefined = deps.adapters[tool];
    if (!entry) throw new Error(`등록되지 않은 생성 도구: ${tool}`); // preflight가 막지만 방어
    recorded = createRecordedAdapter(entry, config, redact);
  } catch (err) {
    return fail(errorMessage(err));
  }
  const { adapter, rawFiles: recordedFiles } = recorded;
  const maxOutputTokens = maxOutputTokensFor(adapter, SMOKE_MAX_OUTPUT_TOKENS);
  out.log(
    `호출: 재시도 없이 1회 · 출력 상한 ${maxOutputTokens ?? '없음(도구 기본값)'} · ` +
      `타임아웃 ${SMOKE_RUN_POLICY.timeoutMs / 60_000}분 → ${outDirRel}/`,
  );
  if (recordedFiles === null) out.log(`  ${tool}에는 원본 출력 기록 래퍼가 없습니다 — meta.json·response.txt만 남습니다`);

  // 4. 실행 (재시도 없는 정책)
  let record: GenerationRecord | null = null;
  let runError: unknown;
  try {
    record = await deps.run(
      adapter,
      {
        model,
        prompt,
        maxOutputTokens,
        repoRoot: config.repoRoot,
        outDirRel,
        runtime: { gitCommit, nodeVersion: deps.nodeVersion },
      },
      SMOKE_RUN_POLICY,
    );
  } catch (err) {
    runError = err;
  }

  // 5. 원본 출력: Runner가 끝난 뒤 같은 폴더에. 기록이 있으면 모델을 부른 것이라 폴더는 이번 실행이 만든 것이다
  const outDir = path.join(config.repoRoot, outDirRel);
  const rawFiles = recordedFiles?.() ?? [];
  try {
    await writeRawFiles(outDir, rawFiles);
  } catch (err) {
    const also = record === null ? ` (smoke 실패: ${errorMessage(runError)})` : '';
    return fail(`원본 출력을 저장하지 못했습니다: ${errorMessage(err)}${also}`);
  }
  if (record === null) {
    const raw = rawFiles.length > 0 ? `\n원본 출력: ${rawFiles.map((f) => `${outDirRel}/${f.name}`).join(', ')}` : '';
    return fail(`smoke 실패: ${errorMessage(runError)}${raw}`);
  }

  // 6. 보고
  out.log('');
  out.log(redact(formatSmokeReport(record, outDirRel, await readdir(outDir))));
  return record.outcome === 'api_failed' ? 1 : 0;
}

interface RecordedAdapter {
  adapter: ProviderAdapter;
  /** 기록한 원본 출력을 꺼낸다. null = 이 도구에는 기록 래퍼가 없다 */
  rawFiles: (() => RawFile[]) | null;
}

/** 레지스트리 항목의 생성 함수에 기록 래퍼를 넘겨 어댑터를 만든다 */
function createRecordedAdapter<Client>(entry: AdapterEntry<Client>, config: AppConfig, redact: Redact): RecordedAdapter {
  const recorder = entry.createRecorder?.(redact);
  if (!recorder) return { adapter: entry.create(config), rawFiles: null };
  return {
    adapter: entry.create(config, { wrapClient: (client) => recorder.wrap(client) }),
    rawFiles: () => recorder.files(),
  };
}

/** raw-* 이름만, 이미 있는 파일(Runner가 쓴 meta.json 등)은 덮어쓰지 않는다 */
async function writeRawFiles(outDir: string, files: readonly RawFile[]): Promise<void> {
  if (files.length === 0) return;
  const bad = files.find((f) => !RAW_FILE_NAME.test(f.name));
  if (bad) throw new Error(`원본 출력 파일 이름은 raw-로 시작해야 합니다: ${JSON.stringify(bad.name)}`);
  await mkdir(outDir, { recursive: true });
  for (const f of files) {
    await writeFile(path.join(outDir, f.name), f.content, { encoding: 'utf8', flag: 'wx' });
  }
}

const n = (x: number) => x.toLocaleString('en-US');
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
