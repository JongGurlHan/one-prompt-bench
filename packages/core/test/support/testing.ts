import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STATUS_LEGEND, type StatusLabel } from '../../src/display.js';
import { CURRENT_PROMPT } from '../../src/prompt.js';
import {
  DiscardedSchema,
  GENERATOR_BY_PROVIDER,
  GenerationRecordSchema,
  JudgmentSchema,
  ModelRegistrySchema,
  type Attempt,
  type Discarded,
  type FailureKind,
  type GenerationRecord,
  type Judgment,
  type Mark,
  type ModelEntry,
  type Outcome,
  type Provider,
  type Usage,
  type Validation,
} from '../../src/schema.js';

/* ────────────────────────────────────────────────────────────
 * @opb/core/testing — 가짜 데이터 루트 빌더 (core·pipeline·site 테스트 공용)
 * OS 임시 디렉토리에 models.json · prompts/ · results/<slug>/를 만든다. 레포의 results/는 건드리지 않는다.
 * 기록은 쓰기 전에 스키마로 검사한다. 일부러 깨진 데이터는 테스트가 만든 뒤 patchJson 등으로 직접 고친다.
 * ──────────────────────────────────────────────────────────── */

export const FAKE_COMMIT = '0123456789abcdef0123456789abcdef01234567';
export const FAKE_HTML =
  '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>tree</title></head>' +
  '<body><canvas></canvas></body></html>\n';
/** 스크린샷 파일 내용. JPEG 시그니처(FF D8 FF)로 시작하기만 하면 된다 */
export const FAKE_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]);
export const FAKE_SCREENSHOTS = [
  { label: 'spring', atMs: 5_000 },
  { label: 'summer', atMs: 15_000 },
  { label: 'autumn', atMs: 25_000 },
  { label: 'winter', atMs: 35_000 },
] as const;

/** 외부 요청 예시: 조건 검사가 각각 정상 · 지시 미준수 · 위반이 되는 것 */
export const THREE_PINNED_URL = 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';
export const THREE_UNPINNED_URL = 'https://unpkg.com/three@latest/build/three.module.js';
export const LIBRARY_URL = 'https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js';

const DEFAULT_USAGE: Usage = { inputTokens: 1_000, outputTokens: 20_000, reasoningTokens: 8_000 };
const DEFAULT_LATENCY_MS = 214_000;
const RETRY_LATENCY_MS = 1_000;
const BACKOFF_MS = 5_000;
const T0 = Date.parse('2026-10-12T00:00:00.000Z');

/** discarded를 주면 버린 결과물 기록이 있는 모델(ADR-032). 생략하면 키가 없다 (첫 생성 결과물을 그대로 공개한 모델) */
export function fakeModel(
  slug: string,
  provider: Provider,
  releasedAt: string,
  displayName: string,
  pricing: Partial<ModelEntry['pricing']> = {},
  discarded?: Discarded[],
): ModelEntry {
  return {
    slug,
    provider,
    modelId: `${slug}-id`,
    displayName,
    releasedAt,
    pricing: {
      inputPer1M: 1,
      outputPer1M: 5,
      asOf: '2026-10-10',
      sourceUrl: 'https://example.com/pricing',
      ...pricing,
    },
    ...(discarded ? { discarded } : {}),
  };
}

/** 버린 결과물을 처음 커밋한 커밋 (가짜). 표시는 앞 7자 9876543 */
export const FAKE_DISCARDED_COMMIT = '9876543210fedcba9876543210fedcba98765432';

/** 버린 결과물 기록 하나. 기본: 화면에 나무가 그려지지 않아 다시 생성한 생성본, 커밋 있음 */
export function fakeDiscarded(over: Partial<Discarded> = {}): Discarded {
  return DiscardedSchema.parse({
    made: 'generation',
    reason: 'blank_screen',
    next: 'regenerate',
    at: '2026-10-13',
    commit: FAKE_DISCARDED_COMMIT,
    ...over,
  } satisfies Discarded);
}

/** 기본 models.json. 등록 순서는 출시일 순서와 일부러 다르게 둔다 */
export const FAKE_MODELS: readonly ModelEntry[] = [
  fakeModel('gemini-a', 'google', '2026-09-02', 'Gemini A'),
  fakeModel('claude-a', 'anthropic', '2026-09-22', 'Claude A'),
  fakeModel('claude-b', 'anthropic', '2026-10-07', 'Claude B'),
  fakeModel('gpt-a', 'openai', '2026-09-29', 'GPT A'),
];

/* ───────── 결과 하나의 명세 ───────── */

interface CommonSpec {
  /** 마지막 시도 전에 실패한 시도 수 (server_error, 사용량 없음) */
  retries?: number;
  /** 마지막 시도의 latencyMs (기본 214초) */
  latencyMs?: number;
}

export interface FakeValidation {
  loaded?: boolean;
  consoleErrors?: string[];
  pageErrors?: string[];
  /** 기본: three.js 고정 버전 1개 → 조건 검사 정상 */
  externalRequests?: { url: string; resourceType: string }[];
}

export interface FakeJudgment {
  requirements?: Partial<Judgment['requirements']>; // 기본: 전부 pass
  /** 생략하면 기본 메모, null = 메모 없이 한 판정 */
  note?: string | null;
}

export type FakeResult =
  | (CommonSpec & {
      outcome: 'ok';
      html?: string | Buffer;
      responseText?: string;
      usage?: Usage;
      /** null = 검증 전. 생략하면 검증한 기록 */
      validation?: FakeValidation | null;
      /** 생략·null = 판정 없음 */
      judgment?: FakeJudgment | null;
    })
  | (CommonSpec & { outcome: 'no_html' | 'truncated' | 'refused'; responseText?: string; usage?: Usage })
  | (CommonSpec & {
      outcome: 'api_failed';
      /** 마지막 시도의 에러 종류 (기본 server_error) */
      failure?: FailureKind;
      /** 마지막 시도가 과금된 경우의 사용량 (기본 null) */
      usage?: Usage | null;
    });

export interface BuiltResult {
  record: GenerationRecord;
  judgment: Judgment | null;
  /** results/<slug>/ 안에 쓸 파일 이름 → 바이트 (meta.json·judgment.json 포함) */
  files: Record<string, Buffer>;
}

const STOP_REASON = { ok: 'end', no_html: 'end', truncated: 'max_tokens', refused: 'refusal' } as const;
const DEFAULT_RESPONSE_TEXT: Record<Exclude<Outcome, 'api_failed'>, string> = {
  ok: '', // html로 만든다
  no_html: '나무를 만드는 방법을 설명할게요. 먼저 three.js로 장면을 만들고…\n',
  truncated: '```html\n<!doctype html>\n<html><body><script>\n// 출력 상한에서 끊긴 응답\n',
  refused: '죄송하지만 이 요청은 도와드릴 수 없어요.\n',
};

/**
 * 파일을 쓰지 않고 기록·판정·파일 내용을 만든다. 스키마를 통과하지 못하면 throw한다.
 * display 테스트처럼 파일이 필요 없을 때 직접 쓰고, writeResult도 이것을 쓴다.
 */
export function buildResult(
  model: ModelEntry,
  spec: FakeResult = { outcome: 'ok' },
  opts: { promptSha256?: string } = {},
): BuiltResult {
  const dir = `results/${model.slug}`;
  const tool = GENERATOR_BY_PROVIDER[model.provider];
  const files: Record<string, Buffer> = {};

  // ── 시도: 실패 retries번 → 마지막 시도 ──
  const attempts: Attempt[] = [];
  let t = T0;
  for (let i = 0; i < (spec.retries ?? 0); i++) {
    attempts.push({
      n: attempts.length + 1,
      startedAt: new Date(t).toISOString(),
      latencyMs: RETRY_LATENCY_MS,
      firstTokenMs: null,
      result: { type: 'error', kind: 'server_error', httpStatus: 500, message: 'fake server error', usage: null },
    });
    t += RETRY_LATENCY_MS + BACKOFF_MS;
  }
  const latencyMs = spec.latencyMs ?? DEFAULT_LATENCY_MS;
  const last: Attempt = {
    n: attempts.length + 1,
    startedAt: new Date(t).toISOString(),
    latencyMs,
    firstTokenMs: null,
    result:
      spec.outcome === 'api_failed'
        ? {
            type: 'error',
            kind: spec.failure ?? 'server_error',
            httpStatus: null,
            message: `fake ${spec.failure ?? 'server_error'}`,
            usage: spec.usage ?? null,
          }
        : {
            type: 'response',
            stopReason: STOP_REASON[spec.outcome],
            rawStopReason: STOP_REASON[spec.outcome],
            resolvedModelId: null,
            requestId: null,
            usage: spec.usage ?? DEFAULT_USAGE,
          },
  };
  attempts.push(last);
  const finishedAt = t + latencyMs;

  // ── 파일 ──
  let responseTextPath: string | null = null;
  let output: GenerationRecord['output'] = null;
  if (spec.outcome !== 'api_failed') {
    let html: Buffer | null = null;
    if (spec.outcome === 'ok') {
      html = Buffer.isBuffer(spec.html) ? spec.html : Buffer.from(spec.html ?? FAKE_HTML, 'utf8');
      files['index.html'] = html;
      output = { path: `${dir}/index.html`, bytes: html.byteLength, sha256: sha256(html), extraction: 'fenced_block' };
    }
    const text = spec.responseText ?? (html ? `\`\`\`html\n${html.toString('utf8')}\`\`\`\n` : DEFAULT_RESPONSE_TEXT[spec.outcome]);
    files['response.txt'] = Buffer.from(text, 'utf8');
    responseTextPath = `${dir}/response.txt`;
  }

  // ── 검증 ──
  let validation: Validation | null = null;
  if (spec.outcome === 'ok' && spec.validation !== null) {
    const v = spec.validation ?? {};
    validation = {
      checkedAt: new Date(finishedAt + 60_000).toISOString(),
      environment: { browser: 'chromium', browserVersion: '0.0.0-fake' },
      loaded: v.loaded ?? true,
      consoleErrors: v.consoleErrors ?? [],
      pageErrors: v.pageErrors ?? [],
      externalRequests: v.externalRequests ?? [{ url: THREE_PINNED_URL, resourceType: 'script' }],
      screenshots: FAKE_SCREENSHOTS.map((s) => ({ ...s, path: `${dir}/${s.label}.jpg` })),
    };
    for (const s of FAKE_SCREENSHOTS) files[`${s.label}.jpg`] = FAKE_JPEG;
  }

  const usageTotal = sumUsage(attempts);
  const inputUsd = round6((usageTotal.inputTokens * model.pricing.inputPer1M) / 1_000_000);
  const outputUsd = round6((usageTotal.outputTokens * model.pricing.outputPer1M) / 1_000_000);

  const record = GenerationRecordSchema.parse({
    schemaVersion: 1,
    modelSlug: model.slug,
    modelId: model.modelId,
    prompt: { id: CURRENT_PROMPT.id, version: CURRENT_PROMPT.version, sha256: opts.promptSha256 ?? repoPromptSha256() },
    params: { reasoningEffort: 'high', maxOutputTokens: tool === 'codex-cli' ? null : 65_536 },
    runtime: {
      gitCommit: FAKE_COMMIT,
      nodeVersion: 'v24.14.0',
      generator: { tool, version: '0.0.0-fake', invocation: `fake ${tool} --model ${model.modelId}` },
    },
    startedAt: new Date(T0).toISOString(),
    finishedAt: new Date(finishedAt).toISOString(),
    attempts,
    outcome: spec.outcome,
    responseTextPath,
    output,
    usageTotal,
    cost: { inputUsd, outputUsd, totalUsd: round6(inputUsd + outputUsd), pricingAsOf: model.pricing.asOf },
    validation,
  } satisfies GenerationRecord);
  files['meta.json'] = json(record);

  let judgment: Judgment | null = null;
  if (spec.outcome === 'ok' && spec.judgment) {
    judgment = JudgmentSchema.parse({
      schemaVersion: 1,
      modelSlug: model.slug,
      prompt: { id: record.prompt.id, version: record.prompt.version },
      outputSha256: output!.sha256,
      judgedAt: new Date(finishedAt + 3_600_000).toISOString(),
      requirements: { scene: 'pass', seasonCycle: 'pass', seasonLook: 'pass', seasonLabel: 'pass', ...spec.judgment.requirements },
      note: spec.judgment.note === undefined ? '네 계절이 순서대로 바뀐다' : spec.judgment.note,
    } satisfies Judgment);
    files['judgment.json'] = json(judgment);
  }

  return { record, judgment, files };
}

/* ───────── 데이터 루트 ───────── */

/**
 * OS 임시 디렉토리에 models.json과 prompts/(레포의 season-tree-v1*.md 복사)를 가진 데이터 루트를 만든다.
 * results/는 만들지 않는다 (결과가 없는 상태). 경로를 돌려준다.
 */
export async function makeDataRoot(models: readonly ModelEntry[] = FAKE_MODELS): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'opb-data-'));
  await writeFile(path.join(root, 'models.json'), json(ModelRegistrySchema.parse(models)));
  await mkdir(path.join(root, 'prompts'));
  const prefix = `${CURRENT_PROMPT.id}-${CURRENT_PROMPT.version}`;
  for (const name of await readdir(REPO_PROMPTS_DIR)) {
    if (name.startsWith(prefix) && name.endsWith('.md')) {
      await copyFile(path.join(REPO_PROMPTS_DIR, name), path.join(root, 'prompts', name));
    }
  }
  return root;
}

/**
 * 데이터 루트의 models.json에 있는 모델의 결과 폴더(results/<slug>/)를 만든다. 폴더는 비어 있거나 없어야 한다.
 * meta.json의 prompt.sha256은 데이터 루트의 prompts/로 계산한다.
 */
export async function writeResult(dataRoot: string, slug: string, spec?: FakeResult): Promise<BuiltResult> {
  const models = ModelRegistrySchema.parse(JSON.parse(await readFile(path.join(dataRoot, 'models.json'), 'utf8')));
  const model = models.find((m) => m.slug === slug);
  if (!model) throw new Error(`fake data root has no model "${slug}" in models.json`);

  const built = buildResult(model, spec, { promptSha256: await promptSha256(dataRoot) });
  const dir = path.join(dataRoot, 'results', slug);
  await mkdir(dir, { recursive: true });
  if ((await readdir(dir)).length > 0) throw new Error(`results/${slug}/ is not empty`);
  for (const [name, bytes] of Object.entries(built.files)) await writeFile(path.join(dir, name), bytes);
  return built;
}

/** 데이터 루트 기준 경로(POSIX)의 JSON 파일을 읽어 고친 뒤 스키마 검사 없이 다시 쓴다 (깨진 데이터 만들기용) */
export async function patchJson<T>(dataRoot: string, relPath: string, mutate: (value: T) => void): Promise<void> {
  const file = path.join(dataRoot, ...relPath.split('/'));
  const value = JSON.parse(await readFile(file, 'utf8')) as T;
  mutate(value);
  await writeFile(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

/* ───────── 상태 라벨마다 모델 하나 ───────── */

export interface StatusCase {
  label: StatusLabel;
  model: ModelEntry;
  /** null = 결과 폴더 없음 (생성 전) */
  result: FakeResult | null;
}

const partialJudgment = (seasonCycle: Mark): FakeJudgment => ({
  requirements: { seasonCycle },
  note: '계절이 바뀌지만 겨울이 늦게 시작된다',
});

/** STATUS_LEGEND의 라벨 10개를 하나씩 갖는 모델과 결과. 출시일·회사가 섞여 있다 */
export const STATUS_CASES: readonly StatusCase[] = [
  {
    label: '정상',
    model: fakeModel('model-ok', 'anthropic', '2026-10-07', 'Model Ok'),
    result: { outcome: 'ok', judgment: { note: '언덕 위 나무가 계절마다 자연스럽게 바뀐다' } },
  },
  {
    label: '지시 미준수',
    model: fakeModel('model-miss', 'openai', '2026-10-01', 'Model Miss'),
    result: {
      outcome: 'ok',
      validation: { externalRequests: [{ url: THREE_UNPINNED_URL, resourceType: 'script' }] },
      judgment: partialJudgment('partial'),
    },
  },
  {
    label: '위반',
    model: fakeModel('model-violation', 'google', '2026-09-29', 'Model Violation'),
    result: {
      outcome: 'ok',
      validation: {
        externalRequests: [
          { url: THREE_PINNED_URL, resourceType: 'script' },
          { url: LIBRARY_URL, resourceType: 'script' },
        ],
        consoleErrors: ['Failed to load texture'],
      },
    },
  },
  {
    label: '잘림',
    model: fakeModel('model-truncated', 'anthropic', '2026-09-28', 'Model Truncated'),
    result: { outcome: 'truncated' },
  },
  {
    label: 'HTML 없음',
    model: fakeModel('model-no-html', 'openai', '2026-09-22', 'Model No Html'),
    result: { outcome: 'no_html' },
  },
  {
    label: '거부',
    model: fakeModel('model-refused', 'google', '2026-09-22', 'Model Refused'),
    result: { outcome: 'refused' },
  },
  {
    label: '한도 초과',
    model: fakeModel('model-usage-limit', 'anthropic', '2026-09-15', 'Model Usage Limit'),
    result: { outcome: 'api_failed', failure: 'usage_limit', latencyMs: 2_000 },
  },
  {
    label: '생성 실패',
    model: fakeModel('model-failed', 'openai', '2026-09-10', 'Model Failed'),
    result: { outcome: 'api_failed', failure: 'timeout', retries: 2, latencyMs: 1_200_000 },
  },
  {
    label: '생성 전',
    model: fakeModel('model-pending', 'google', '2026-09-05', 'Model Pending'),
    result: null,
  },
  {
    label: '검증 전',
    model: fakeModel('model-unvalidated', 'anthropic', '2026-09-03', 'Model Unvalidated'),
    result: { outcome: 'ok', validation: null },
  },
];

/**
 * labels의 STATUS_CASES로 데이터 루트를 만든다. 기본은 10개 전부.
 * '검증 전'은 check:results 규칙 6을 어기므로, 검사를 통과해야 하는 데이터에서는 빼고 부른다.
 */
export async function makeStatusDataRoot(labels: readonly StatusLabel[] = STATUS_LEGEND): Promise<string> {
  const cases = STATUS_CASES.filter((c) => labels.includes(c.label));
  const root = await makeDataRoot(cases.map((c) => c.model));
  for (const c of cases) if (c.result) await writeResult(root, c.model.slug, c.result);
  return root;
}

/* ───────── helpers ───────── */

const REPO_PROMPTS_DIR = fileURLToPath(new URL('../../../../prompts/', import.meta.url));

let repoPromptShaCache: string | null = null;
/** 레포 prompts/의 현재 프롬프트로 계산한 meta.json prompt.sha256 (runner와 같은 방식) */
function repoPromptSha256(): string {
  if (repoPromptShaCache === null) {
    const base = path.join(REPO_PROMPTS_DIR, `${CURRENT_PROMPT.id}-${CURRENT_PROMPT.version}`);
    repoPromptShaCache = promptHash(readFileSync(`${base}.system.md`, 'utf8'), readFileSync(`${base}.md`, 'utf8'));
  }
  return repoPromptShaCache;
}

async function promptSha256(dataRoot: string): Promise<string> {
  const base = path.join(dataRoot, 'prompts', `${CURRENT_PROMPT.id}-${CURRENT_PROMPT.version}`);
  return promptHash(await readFile(`${base}.system.md`, 'utf8'), await readFile(`${base}.md`, 'utf8'));
}

const promptHash = (system: string, user: string) => sha256(JSON.stringify({ system, user }));

function sumUsage(attempts: readonly Attempt[]): Usage {
  let inputTokens = 0;
  let outputTokens = 0;
  let reasoning = 0;
  let reasoningKnown = true;
  let any = false;
  for (const a of attempts) {
    const u = a.result.usage;
    if (!u) continue;
    any = true;
    inputTokens += u.inputTokens;
    outputTokens += u.outputTokens;
    if (u.reasoningTokens === null) reasoningKnown = false;
    else reasoning += u.reasoningTokens;
  }
  return { inputTokens, outputTokens, reasoningTokens: any && reasoningKnown ? reasoning : null };
}

const json = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2) + '\n', 'utf8');
const round6 = (x: number) => Math.round(x * 1e6) / 1e6;
const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
