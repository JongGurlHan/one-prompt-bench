import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  maxOutputTokensFor,
  type ClassifiedError,
  type GenerationRequest,
  type ProviderAdapter,
  type ProviderResponse,
  type RunPolicy,
} from '../src/adapter.js';
import { runGeneration, type RunInput } from '../src/runner.js';
import { GenerationRecordSchema, type FailureKind, type ModelEntry } from '../src/schema.js';

/* ───────── 가짜 어댑터: 호출마다 정해진 대본대로 응답/실패 ───────── */

class FakeError extends Error {
  constructor(readonly ce: ClassifiedError) {
    super(ce.message);
  }
}

type Step =
  | { respond: Partial<ProviderResponse> & { text: string } }
  | { fail: FailureKind; httpStatus?: number; retryAfterMs?: number }
  | { hang: true };

function fakeAdapter(script: Step[]): ProviderAdapter & { calls: number; requests: GenerationRequest[] } {
  const adapter = {
    provider: 'anthropic' as const,
    generator: { tool: 'claude-code' as const, version: '0.0.0-fake' },
    supportsMaxOutputTokens: true,
    calls: 0,
    requests: [] as GenerationRequest[],
    describeInvocation(req: GenerationRequest): string {
      return `fake-cli --model ${req.modelId} --max-output ${req.maxOutputTokens ?? 'default'} --system <system prompt>`;
    },
    async generate(req: GenerationRequest): Promise<ProviderResponse> {
      adapter.requests.push(req);
      const step = script[adapter.calls++];
      if (!step) throw new Error('script exhausted');
      if ('hang' in step) return new Promise(() => {}); // signal 무시하는 나쁜 어댑터
      if ('fail' in step) {
        throw new FakeError({
          kind: step.fail,
          httpStatus: step.httpStatus ?? null,
          retryAfterMs: step.retryAfterMs ?? null,
          message: step.fail,
          usage: null,
        });
      }
      return {
        stopReason: 'end',
        rawStopReason: 'end_turn',
        usage: { inputTokens: 1000, outputTokens: 20000, reasoningTokens: 8000 },
        resolvedModelId: 'example-model-a-20260920',
        requestId: 'req_1',
        firstTokenMs: 1234,
        ...step.respond,
      };
    },
    classifyError(err: unknown): ClassifiedError {
      if (err instanceof FakeError) return err.ce;
      return { kind: 'unknown', httpStatus: null, retryAfterMs: null, message: String(err), usage: null };
    },
  };
  return adapter;
}

const model: ModelEntry = {
  slug: 'example-model-a',
  provider: 'anthropic',
  modelId: 'example-model-a',
  displayName: 'Example Model A',
  releasedAt: '2026-09-20',
  pricing: { inputPer1M: 5, outputPer1M: 25, asOf: '2026-10-09', sourceUrl: 'https://example.com/pricing' },
};

const policy: RunPolicy = { maxAttempts: 3, timeoutMs: 50, backoffBaseMs: 1000, backoffMaxMs: 8000 };
const HTML = '<!doctype html><html><body><canvas></canvas></body></html>';

const SYSTEM = '사용자의 요청에 답하세요.\n';

async function run(script: Step[], overrides: Partial<RunInput> = {}) {
  const repoRoot = await mkdtemp(path.join(tmpdir(), 'bench-'));
  const input: RunInput = {
    model,
    prompt: { id: 'season-tree', version: 'v1', system: SYSTEM, user: '사계절이 바뀌는 3D 나무 애니메이션을 만들어주세요' },
    maxOutputTokens: 64000,
    repoRoot,
    outDirRel: 'results/example-model-a',
    runtime: { gitCommit: 'a1b2c3d', nodeVersion: process.versions.node },
    ...overrides,
  };
  const sleeps: number[] = [];
  const adapter = fakeAdapter(script);
  const record = await runGeneration(adapter, input, policy, {
    now: () => new Date(),
    sleep: async (ms) => void sleeps.push(ms),
  });
  const files = await readdir(path.join(repoRoot, input.outDirRel));
  return { record, sleeps, files, repoRoot, adapter, input };
}

/* ───────── 케이스 ───────── */

test('429 후 성공: Retry-After를 따르고 2번째 시도에서 ok', async () => {
  const { record, sleeps, files, repoRoot } = await run([
    { fail: 'rate_limited', httpStatus: 429, retryAfterMs: 3000 },
    { respond: { text: `설명입니다.\n\`\`\`html\n${HTML}\n\`\`\`\n끝.` } },
  ]);
  assert.equal(record.outcome, 'ok');
  assert.equal(record.attempts.length, 2);
  assert.deepEqual(sleeps, [3000]);
  assert.equal(record.output?.extraction, 'fenced_block');
  assert.equal(await readFile(path.join(repoRoot, record.output!.path), 'utf8'), HTML);
  assert.deepEqual(files.sort(), ['index.html', 'meta.json', 'response.txt']);
  // 1000 * 5/1M + 20000 * 25/1M
  assert.deepEqual(record.cost, { inputUsd: 0.005, outputUsd: 0.5, totalUsd: 0.505, pricingAsOf: '2026-10-09' });
});

test('구독 한도 초과: 바로 재시도하지 않고 한도 초과로 기록', async () => {
  const { record, sleeps } = await run([{ fail: 'usage_limit' }]);
  assert.equal(record.outcome, 'api_failed');
  assert.equal(record.attempts.length, 1);
  assert.deepEqual(sleeps, []);
  const last = record.attempts[0]!.result;
  assert.equal(last.type === 'error' && last.kind, 'usage_limit');
});

test('인증 오류: 재시도하지 않고 api_failed', async () => {
  const { record, files } = await run([{ fail: 'auth', httpStatus: 401 }]);
  assert.equal(record.outcome, 'api_failed');
  assert.equal(record.attempts.length, 1);
  assert.equal(record.output, null);
  assert.deepEqual(files, ['meta.json']);
});

test('서버 오류 3연속: 지수 백오프 후 시도 소진', async () => {
  const { record, sleeps } = await run([{ fail: 'server_error' }, { fail: 'server_error' }, { fail: 'server_error' }]);
  assert.equal(record.outcome, 'api_failed');
  assert.equal(record.attempts.length, 3);
  assert.deepEqual(sleeps, [1000, 2000]);
});

test('max_tokens 잘림: 결과로 기록하고 재시도하지 않음', async () => {
  const { record, adapter, files } = await run([
    { respond: { text: '```html\n<!doctype html><html><body><script>', stopReason: 'max_tokens' } },
  ]);
  assert.equal(record.outcome, 'truncated');
  assert.equal(adapter.calls, 1);
  assert.equal(record.output, null);
  assert.deepEqual(files.sort(), ['meta.json', 'response.txt']);
});

test('HTML 없는 응답: no_html, 재시도 X', async () => {
  const { record, adapter } = await run([{ respond: { text: '죄송하지만 단계별 설명만 드릴게요.' } }]);
  assert.equal(record.outcome, 'no_html');
  assert.equal(adapter.calls, 1);
});

test('코드 블록 없이 문서만 온 응답: raw_document로 ok', async () => {
  const { record } = await run([{ respond: { text: `\n${HTML}\n` } }]);
  assert.equal(record.outcome, 'ok');
  assert.equal(record.output?.extraction, 'raw_document');
});

test('signal을 무시하고 멈춘 어댑터: Runner가 timeout으로 끊고 재시도', async () => {
  const { record } = await run([{ hang: true }, { respond: { text: `\`\`\`html\n${HTML}\n\`\`\`` } }]);
  const first = record.attempts[0]!.result;
  assert.equal(first.type === 'error' && first.kind, 'timeout');
  assert.equal(record.outcome, 'ok');
});

test('출력 폴더가 비어 있지 않으면 실행 거부', async () => {
  const { repoRoot } = await run([{ fail: 'auth' }]); // meta.json이 남은 폴더
  await assert.rejects(
    runGeneration(fakeAdapter([]), {
      model,
      prompt: { id: 'season-tree', version: 'v1', system: SYSTEM, user: 'x' },
      maxOutputTokens: 1000,
      repoRoot,
      outDirRel: 'results/example-model-a',
      runtime: { gitCommit: 'a1b2c3d', nodeVersion: '22.0.0' },
    }),
    /not empty/,
  );
});

test('meta.json runtime.generator: 어댑터의 tool·version과 describeInvocation 결과를 기록', async () => {
  const { record, adapter, repoRoot, input } = await run([{ respond: { text: `\`\`\`html\n${HTML}\n\`\`\`` } }]);
  const invocation = 'fake-cli --model example-model-a --max-output 64000 --system <system prompt>';
  assert.deepEqual(record.runtime, {
    gitCommit: 'a1b2c3d',
    nodeVersion: process.versions.node,
    generator: { tool: 'claude-code', version: '0.0.0-fake', invocation },
  });
  // 디스크에 쓴 meta.json도 같은 값이고 스키마를 통과한다
  const saved = JSON.parse(await readFile(path.join(repoRoot, input.outDirRel, 'meta.json'), 'utf8'));
  assert.deepEqual(GenerationRecordSchema.parse(saved).runtime.generator, record.runtime.generator);
  // 시스템 프롬프트는 내용 그대로 요청에 실린다
  assert.equal(adapter.requests[0]!.system, SYSTEM);
});

test('maxOutputTokens null(도구 기본값): 요청과 params.maxOutputTokens에 null 그대로', async () => {
  const { record, adapter, repoRoot, input } = await run(
    [{ fail: 'server_error' }, { respond: { text: `\`\`\`html\n${HTML}\n\`\`\`` } }],
    { maxOutputTokens: null },
  );
  assert.equal(record.outcome, 'ok');
  assert.deepEqual(adapter.requests.map((r) => r.maxOutputTokens), [null, null]); // 재시도에도 그대로
  assert.equal(record.params.maxOutputTokens, null);
  assert.equal(
    record.runtime.generator.invocation,
    'fake-cli --model example-model-a --max-output default --system <system prompt>',
  );
  const saved = JSON.parse(await readFile(path.join(repoRoot, input.outDirRel, 'meta.json'), 'utf8'));
  assert.equal(saved.params.maxOutputTokens, null);
});

test('maxOutputTokensFor: 상한을 지원하는 도구는 65,536(또는 준 값), 아니면 null', () => {
  assert.equal(DEFAULT_MAX_OUTPUT_TOKENS, 65_536);
  assert.equal(maxOutputTokensFor({ supportsMaxOutputTokens: true }), 65_536);
  assert.equal(maxOutputTokensFor({ supportsMaxOutputTokens: false }), null);
  assert.equal(maxOutputTokensFor({ supportsMaxOutputTokens: true }, 8_000), 8_000); // smoke
  assert.equal(maxOutputTokensFor({ supportsMaxOutputTokens: false }, 8_000), null);
});
