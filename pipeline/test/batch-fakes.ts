import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  DEFAULT_RUN_POLICY,
  GENERATOR_BY_PROVIDER,
  GenerationRecordSchema,
  runGeneration,
  type ClassifiedError,
  type FailureKind,
  type GenerationRecord,
  type GenerationRequest,
  type GeneratorTool,
  type ModelEntry,
  type Provider,
  type ProviderAdapter,
  type ProviderResponse,
  type RunnerDeps,
  type StopReason,
  type Validation,
} from '@opb/core';
import type { AdapterEntry, AdapterRegistry } from '../src/adapters/registry.js';
import type { AppConfig } from '../src/config/config.js';
import type { BatchDeps } from '../src/generation/batch.js';
import type { GitClient } from '../src/system/git.js';

/* ────────────────────────────────────────────────────────────
 * batch·preflight 테스트용 가짜 레포·가짜 어댑터·가짜 git (실제 모델·git·네트워크 없음)
 * 가짜 레포는 OS 임시 디렉토리에 만든다. 레포의 results/·models.json은 건드리지 않는다.
 * ──────────────────────────────────────────────────────────── */

export const FAKE_GEMINI_KEY = 'fake-gemini-key-0123456789abcdef';
export const FAKE_COMMIT = '0123456789abcdef0123456789abcdef01234567';
export const HTML = '<!doctype html><html><body><canvas></canvas></body></html>';
export const SYSTEM = '사용자의 요청에 답하세요.\n';
export const USER = '사계절이 바뀌는 3D 나무를 만들어주세요.\n';

const PROVIDER_BY_TOOL: Record<GeneratorTool, Provider> = {
  'claude-code': 'anthropic',
  'codex-cli': 'openai',
  'gemini-api': 'google',
};

function model(slug: string, provider: Provider, releasedAt: string, displayName: string): ModelEntry {
  return {
    slug,
    provider,
    modelId: `${slug}-id`,
    displayName,
    releasedAt,
    pricing: { inputPer1M: 1, outputPer1M: 5, asOf: '2026-10-10', sourceUrl: 'https://example.com/pricing' },
  };
}

/** 가짜 레포의 models.json. 등록 순서는 출시일 순서와 일부러 다르게 둔다 */
export const MODELS: readonly ModelEntry[] = [
  model('gemini-a', 'google', '2026-09-02', 'Gemini A'),
  model('claude-a', 'anthropic', '2026-09-22', 'Claude A'),
  model('claude-b', 'anthropic', '2026-10-07', 'Claude B'),
  model('gpt-a', 'openai', '2026-09-29', 'GPT A'),
];

export function modelBySlug(slug: string): ModelEntry {
  const m = MODELS.find((x) => x.slug === slug);
  if (!m) throw new Error(`no fake model ${slug}`);
  return m;
}

/** OS 임시 디렉토리에 models.json·prompts/를 가진 가짜 레포를 만든다 */
export async function makeRepo(models: readonly ModelEntry[] = MODELS): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'opb-batch-'));
  await writeFile(path.join(root, 'models.json'), JSON.stringify(models, null, 2) + '\n', 'utf8');
  await mkdir(path.join(root, 'prompts'));
  await writeFile(path.join(root, 'prompts', 'season-tree-v1.md'), USER, 'utf8');
  await writeFile(path.join(root, 'prompts', 'season-tree-v1.system.md'), SYSTEM, 'utf8');
  return root;
}

/* ───────── 가짜 어댑터: 모델별 대본 (core runner 테스트와 같은 방식) ───────── */

export type Step =
  | { respond?: string; stopReason?: StopReason }
  | { fail: FailureKind; httpStatus?: number; message?: string };

class FakeCallError extends Error {
  constructor(readonly ce: ClassifiedError) {
    super(ce.message);
  }
}

/** 정상 응답 하나 (```html 블록) */
export const OK: Step = { respond: `여기 있습니다.\n\`\`\`html\n${HTML}\n\`\`\`\n` };

export interface FakeWorld {
  registry: AdapterRegistry;
  /** create()가 불린 도구 (어댑터를 만든 순서) */
  created: GeneratorTool[];
  /** generate()가 불린 modelId (호출 순서) */
  calls: string[];
  /** create()에 넘어온 설정 */
  configs: AppConfig[];
}

/**
 * tools에 있는 도구마다 가짜 레지스트리 항목을 만든다. 어댑터는 요청의 modelId로 대본을 고른다.
 * 대본이 없는 모델은 정상 응답(OK) 1회.
 */
export function fakeWorld(
  scripts: Record<string, Step[]> = {},
  tools: readonly GeneratorTool[] = ['gemini-api', 'claude-code', 'codex-cli'],
): FakeWorld {
  const world: FakeWorld = { registry: {}, created: [], calls: [], configs: [] };
  const cursor = new Map<string, number>();

  const entryFor = (tool: GeneratorTool): AdapterEntry => ({
    create(config: AppConfig): ProviderAdapter {
      world.created.push(tool);
      world.configs.push(config);
      return {
        provider: PROVIDER_BY_TOOL[tool],
        generator: { tool, version: '0.0.0-fake' },
        supportsMaxOutputTokens: tool !== 'codex-cli',
        describeInvocation: (req: GenerationRequest) => `fake ${tool} --model ${req.modelId}`,
        async generate(req: GenerationRequest): Promise<ProviderResponse> {
          world.calls.push(req.modelId);
          const slug = req.modelId.replace(/-id$/, '');
          const n = cursor.get(slug) ?? 0;
          cursor.set(slug, n + 1);
          const step = (scripts[slug] ?? [OK])[n];
          if (!step) throw new Error(`script exhausted for ${slug}`);
          if ('fail' in step) {
            throw new FakeCallError({
              kind: step.fail,
              httpStatus: step.httpStatus ?? null,
              retryAfterMs: null,
              message: step.message ?? step.fail,
              usage: null,
            });
          }
          return {
            text: step.respond ?? '',
            stopReason: step.stopReason ?? 'end',
            rawStopReason: 'STOP',
            usage: { inputTokens: 1_000, outputTokens: 20_000, reasoningTokens: 8_000 },
            resolvedModelId: null,
            requestId: null,
            firstTokenMs: null,
          };
        },
        classifyError(err: unknown): ClassifiedError {
          if (err instanceof FakeCallError) return err.ce;
          return { kind: 'unknown', httpStatus: null, retryAfterMs: null, message: String(err), usage: null };
        },
      };
    },
  });

  const registry: { -readonly [K in GeneratorTool]?: AdapterEntry } = {};
  for (const tool of tools) registry[tool] = entryFor(tool);
  world.registry = registry as AdapterRegistry;
  return world;
}

/** 1초씩 가는 가짜 시계 (실제로 기다리지 않는다) */
export function fakeClock(): RunnerDeps {
  let t = Date.parse('2026-10-12T00:00:00.000Z');
  return {
    now: () => new Date((t += 1_000)),
    sleep: async () => {},
  };
}

/** results/<slug>/에 파이프라인(core runner)으로 이전 기록을 만들어 둔다 */
export async function seedResult(repoRoot: string, slug: string, script: Step[] = [OK]): Promise<GenerationRecord> {
  const m = modelBySlug(slug);
  const world = fakeWorld({ [slug]: script });
  const adapter = world.registry[GENERATOR_BY_PROVIDER[m.provider]]!.create({ repoRoot, dotenv: {} });
  return runGeneration(
    adapter,
    {
      model: m,
      prompt: { id: 'season-tree', version: 'v1', system: SYSTEM, user: USER },
      maxOutputTokens: 65_536,
      repoRoot,
      outDirRel: `results/${slug}`,
      runtime: { gitCommit: FAKE_COMMIT, nodeVersion: 'v24.14.0' },
    },
    DEFAULT_RUN_POLICY,
    fakeClock(),
  );
}

/** 폴더의 파일 이름 → 내용 (변경 여부 비교용). 폴더가 없으면 null */
export async function snapshot(dir: string): Promise<Record<string, string> | null> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return null;
  }
  const out: Record<string, string> = {};
  for (const name of names.sort()) out[name] = await readFile(path.join(dir, name), 'utf8');
  return out;
}

export async function readMeta(repoRoot: string, slug: string): Promise<GenerationRecord> {
  const text = await readFile(path.join(repoRoot, 'results', slug, 'meta.json'), 'utf8');
  return GenerationRecordSchema.parse(JSON.parse(text));
}

/**
 * status: 모든 호출에 같은 출력, 또는 경로마다 출력을 고르는 함수 (preflight의 코드 경로와 results/<slug>/를 나눠 답할 때).
 * statusError: 함수면 그 경로에서만 throw할지 고른다
 */
export function fakeGit(
  opts: {
    status?: string | ((paths: readonly string[]) => string);
    head?: string;
    statusError?: Error | ((paths: readonly string[]) => Error | null);
  } = {},
): GitClient & {
  statusCalls: (readonly string[])[];
  headCalls: number;
} {
  const git = {
    statusCalls: [] as (readonly string[])[],
    headCalls: 0,
    async status(paths: readonly string[]): Promise<string> {
      git.statusCalls.push(paths);
      const error = typeof opts.statusError === 'function' ? opts.statusError(paths) : opts.statusError;
      if (error) throw error;
      return typeof opts.status === 'function' ? opts.status(paths) : (opts.status ?? '');
    },
    async head(): Promise<string> {
      git.headCalls++;
      return opts.head ?? FAKE_COMMIT;
    },
  };
  return git;
}

/** 가짜 검증기가 돌려주는 값 (batch는 쓰지 않는다 — meta.json에도 쓰지 않는다) */
const FAKE_VALIDATION: Validation = {
  checkedAt: '2026-10-12T00:10:00.000Z',
  environment: { browser: 'chromium', browserVersion: '0.0.0-fake' },
  loaded: true,
  consoleErrors: [],
  pageErrors: [],
  externalRequests: [],
  screenshots: [],
};

export interface Harness {
  deps: BatchDeps;
  world: FakeWorld;
  git: ReturnType<typeof fakeGit>;
  logs: string[];
  errors: string[];
  confirms: string[];
  validated: string[];
  /** 출력 전체 (log + error) */
  output(): string;
}

/** runBatch에 넘길 가짜 의존성 묶음. 기본: 세 도구 모두 등록, GEMINI 키 있음, git 깨끗함, 확인은 거절 */
export function harness(
  repoRoot: string,
  opts: {
    world?: FakeWorld;
    git?: ReturnType<typeof fakeGit>;
    env?: Record<string, string | undefined>;
    dotenv?: Record<string, string>;
    confirm?: boolean;
    validate?: (slug: string) => Promise<void>;
  } = {},
): Harness {
  const world = opts.world ?? fakeWorld();
  const git = opts.git ?? fakeGit();
  const h: Harness = {
    world,
    git,
    logs: [],
    errors: [],
    confirms: [],
    validated: [],
    output: () => [...h.logs, ...h.errors].join('\n'),
    deps: {
      config: { repoRoot, dotenv: opts.dotenv ?? { GEMINI_API_KEY: FAKE_GEMINI_KEY } },
      env: opts.env ?? {},
      adapters: world.registry,
      git,
      confirm: async (message) => {
        h.confirms.push(message);
        return opts.confirm ?? false;
      },
      validator: {
        validate: async (slug) => {
          h.validated.push(slug);
          await opts.validate?.(slug);
          return FAKE_VALIDATION;
        },
      },
      run: (adapter, input) => runGeneration(adapter, input, DEFAULT_RUN_POLICY, fakeClock()),
      out: { log: (line) => void h.logs.push(line), error: (line) => void h.errors.push(line) },
      nodeVersion: 'v24.14.0',
    },
  };
  return h;
}
