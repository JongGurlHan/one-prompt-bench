import { createHash } from 'node:crypto';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_RUN_POLICY,
  RETRYABLE_FAILURES,
  type GenerationRequest,
  type ProviderAdapter,
  type ProviderResponse,
  type RunPolicy,
} from './adapter.js';
import { extractHtml } from './extract-html.js';
import {
  GenerationRecordSchema,
  type Attempt,
  type GenerationRecord,
  type ModelEntry,
  type Outcome,
  type Usage,
} from './schema.js';

export interface PromptSpec {
  id: string;
  version: string;
  system: string | null;
  user: string;
}

export interface RunInput {
  model: ModelEntry;
  prompt: PromptSpec;
  maxOutputTokens: number; // 모든 모델 공통 상한
  repoRoot: string; // 절대 경로
  outDirRel: string; // 레포 기준, 예: results/<slug>
  runtime: { gitCommit: string; nodeVersion: string };
}

/** 시계·대기를 주입받아 테스트에서 실제로 기다리지 않게 한다. */
export interface RunnerDeps {
  now(): Date;
  sleep(ms: number): Promise<void>;
}

const realDeps: RunnerDeps = {
  now: () => new Date(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * 모델 1개에 대해: 생성(재시도·타임아웃) → 결과 파일 저장 → meta.json 기록.
 * 출력 폴더는 비어 있어야 한다. 이전 결과를 덮어쓸지는 호출하는 쪽(배치)이 정한다.
 */
export async function runGeneration(
  adapter: ProviderAdapter,
  input: RunInput,
  policy: RunPolicy = DEFAULT_RUN_POLICY,
  deps: RunnerDeps = realDeps,
): Promise<GenerationRecord> {
  const outDir = path.join(input.repoRoot, input.outDirRel);
  await mkdir(outDir, { recursive: true });
  if ((await readdir(outDir)).length > 0) {
    throw new Error(`output dir is not empty: ${input.outDirRel}`);
  }

  const req: GenerationRequest = {
    modelId: input.model.modelId,
    system: input.prompt.system,
    user: input.prompt.user,
    reasoningEffort: 'high',
    maxOutputTokens: input.maxOutputTokens,
  };

  const startedAt = deps.now();
  const attempts: Attempt[] = [];
  let response: ProviderResponse | null = null;

  for (let n = 1; n <= policy.maxAttempts; n++) {
    const t0 = deps.now();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(new Error(`timeout after ${policy.timeoutMs}ms`)), policy.timeoutMs);
    try {
      // 어댑터가 signal을 무시해도 Runner가 멈추지 않도록 경쟁시킨다
      const res = await raceAbort(adapter.generate(req, ac.signal), ac.signal);
      attempts.push({
        n,
        startedAt: t0.toISOString(),
        latencyMs: elapsed(t0, deps.now()),
        firstTokenMs: res.firstTokenMs,
        result: {
          type: 'response',
          stopReason: res.stopReason,
          rawStopReason: res.rawStopReason,
          resolvedModelId: res.resolvedModelId,
          requestId: res.requestId,
          usage: res.usage,
        },
      });
      response = res;
      break;
    } catch (err) {
      const ce = adapter.classifyError(err);
      const kind = ac.signal.aborted ? 'timeout' : ce.kind; // 타임아웃 판정은 Runner가 확정
      attempts.push({
        n,
        startedAt: t0.toISOString(),
        latencyMs: elapsed(t0, deps.now()),
        firstTokenMs: null,
        result: { type: 'error', kind, httpStatus: ce.httpStatus, message: ce.message, usage: ce.usage },
      });
      if (!RETRYABLE_FAILURES.has(kind) || n === policy.maxAttempts) break;
      await deps.sleep(backoffMs(n, ce.retryAfterMs, policy));
    } finally {
      clearTimeout(timer);
    }
  }

  // ── 결과 판정 + 파일 저장 ──
  const rel = (file: string) => path.posix.join(input.outDirRel, file);
  let outcome: Outcome;
  let responseTextPath: string | null = null;
  let output: GenerationRecord['output'] = null;

  if (response === null) {
    outcome = 'api_failed';
  } else {
    responseTextPath = rel('response.txt');
    await writeFile(path.join(input.repoRoot, responseTextPath), response.text, 'utf8');

    if (response.stopReason === 'refusal') {
      outcome = 'refused';
    } else if (response.stopReason === 'max_tokens') {
      outcome = 'truncated'; // 결정: 모델의 결과로 기록, 재시도 X
    } else {
      const extracted = extractHtml(response.text);
      if (extracted === null) {
        outcome = 'no_html';
      } else {
        const htmlPath = rel('index.html');
        const buf = Buffer.from(extracted.html, 'utf8');
        await writeFile(path.join(input.repoRoot, htmlPath), buf);
        output = { path: htmlPath, bytes: buf.byteLength, sha256: sha256(buf), extraction: extracted.method };
        outcome = 'ok';
      }
    }
  }

  const usageTotal = sumUsage(attempts);
  const { pricing } = input.model;
  const inputUsd = round6((usageTotal.inputTokens * pricing.inputPer1M) / 1_000_000);
  const outputUsd = round6((usageTotal.outputTokens * pricing.outputPer1M) / 1_000_000);

  // 저장 전에 스키마로 검증: 집계 버그가 있으면 여기서 실패한다
  const record = GenerationRecordSchema.parse({
    schemaVersion: 1,
    modelSlug: input.model.slug,
    modelId: input.model.modelId,
    prompt: {
      id: input.prompt.id,
      version: input.prompt.version,
      sha256: sha256(JSON.stringify({ system: input.prompt.system, user: input.prompt.user })),
    },
    params: { reasoningEffort: 'high', maxOutputTokens: input.maxOutputTokens },
    runtime: {
      gitCommit: input.runtime.gitCommit,
      sdkPackage: adapter.sdk.package,
      sdkVersion: adapter.sdk.version,
      nodeVersion: input.runtime.nodeVersion,
    },
    startedAt: startedAt.toISOString(),
    finishedAt: deps.now().toISOString(),
    attempts,
    outcome,
    responseTextPath,
    output,
    usageTotal,
    cost: { inputUsd, outputUsd, totalUsd: round6(inputUsd + outputUsd), pricingAsOf: pricing.asOf },
    validation: null,
  });

  await writeFile(path.join(outDir, 'meta.json'), JSON.stringify(record, null, 2) + '\n', 'utf8');
  return record;
}

/* ───────── helpers ───────── */

/** Retry-After가 있으면 그대로 따르고, 없으면 지수 백오프 */
export function backoffMs(attempt: number, retryAfterMs: number | null, p: RunPolicy): number {
  if (retryAfterMs !== null) return retryAfterMs;
  return Math.min(p.backoffMaxMs, p.backoffBaseMs * 2 ** (attempt - 1));
}

function raceAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  work.catch(() => {}); // 경쟁에서 진 쪽의 rejection이 unhandled로 남지 않게
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    work.then(resolve, reject);
  });
}

function sumUsage(attempts: Attempt[]): Usage {
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

const elapsed = (a: Date, b: Date) => Math.max(0, b.getTime() - a.getTime());
const round6 = (x: number) => Math.round(x * 1e6) / 1e6;
const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
