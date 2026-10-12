import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from '@google/genai';
import { UsageSchema, type ClassifiedError, type GenerationRequest } from '@opb/core';
import { GeminiAdapter } from '../src/adapters/gemini/gemini.adapter.js';
import { apiError, fakeClient, loadApiError, loadChunks, type FakeCall } from './gemini-fakes.js';

const req: GenerationRequest = {
  modelId: 'gemini-3.8-flash',
  system: 'system\n',
  user: 'user\n',
  reasoningEffort: 'high',
  maxOutputTokens: 65_536,
};

const adapter = new GeminiAdapter(fakeClient([]), { sdkVersion: '2.28.0' });
const classify = (err: unknown) => adapter.classifyError(err);

/** generate가 던진 값을 그대로 받아 분류 (generate가 usage·abort 여부를 실어 보내는지 보려고) */
async function classifyFromGenerate(call: FakeCall, signal = new AbortController().signal): Promise<ClassifiedError> {
  const a = new GeminiAdapter(fakeClient([call]), { sdkVersion: '2.28.0' });
  const err = await a.generate(req, signal).then(
    () => assert.fail('generate should throw'),
    (e: unknown) => e,
  );
  return a.classifyError(err);
}

const pick = (ce: ClassifiedError) => ({ kind: ce.kind, httpStatus: ce.httpStatus, retryAfterMs: ce.retryAfterMs });
const rpc = (code: number, status: string, message: string, details?: unknown[]) => ({
  error: { code, message, status, ...(details ? { details } : {}) },
});
const withCode = (message: string, code: string) => Object.assign(new Error(message), { code });

/* ───────── HTTP 상태가 있는 에러 (ApiError) ───────── */

test('429 짧은 요청 한도 → rate_limited, RetryInfo retryDelay → retryAfterMs (응답·스트림 도중 두 형식)', async () => {
  for (const form of ['response', 'in_stream'] as const) {
    const ce = classify(await loadApiError('429-rate-limit', form));
    assert.deepEqual(pick(ce), { kind: 'rate_limited', httpStatus: 429, retryAfterMs: 37_000 }, form);
    assert.match(ce.message, /429/);
    assert.match(ce.message, /RESOURCE_EXHAUSTED/);
    assert.equal(ce.usage, null);
  }
});

test('429 일일 할당량(QuotaFailure quotaId에 PerDay) → usage_limit, 사유가 message에 남는다', async () => {
  for (const form of ['response', 'in_stream'] as const) {
    const ce = classify(await loadApiError('429-daily-quota', form));
    assert.equal(ce.kind, 'usage_limit', form);
    assert.equal(ce.httpStatus, 429);
    assert.match(ce.message, /GenerateRequestsPerDayPerProjectPerModel-FreeTier/);
  }
});

test('429는 일일 표시가 없으면 언제나 rate_limited (본문 없음·JSON 아님·분당 위반만)', () => {
  const noDetails = apiError(429, rpc(429, 'RESOURCE_EXHAUSTED', 'Resource has been exhausted (e.g. check quota).'));
  assert.deepEqual(pick(classify(noDetails)), { kind: 'rate_limited', httpStatus: 429, retryAfterMs: null });

  const notJson = new ApiError({ status: 429, message: 'Too Many Requests' });
  assert.deepEqual(pick(classify(notJson)), { kind: 'rate_limited', httpStatus: 429, retryAfterMs: null });

  const perMinuteTokens = apiError(
    429,
    rpc(429, 'RESOURCE_EXHAUSTED', 'quota', [
      {
        '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
        violations: [{ quotaId: 'GenerateContentInputTokensPerModelPerMinute-FreeTier' }],
      },
    ]),
  );
  assert.equal(classify(perMinuteTokens).kind, 'rate_limited');
});

test('일일 위반이 하나라도 섞이면 usage_limit (분당·일일 동시)', () => {
  const both = apiError(
    429,
    rpc(429, 'RESOURCE_EXHAUSTED', 'quota', [
      {
        '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
        violations: [
          { quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' },
          { quotaId: 'GenerateContentInputTokensPerModelPerDay-FreeTier' },
        ],
      },
    ]),
  );
  assert.equal(classify(both).kind, 'usage_limit');
});

test('retryDelay 파싱: 소수 초, 0초, 형식이 다르면 null', () => {
  const withDelay = (retryDelay: unknown) =>
    classify(
      apiError(
        429,
        rpc(429, 'RESOURCE_EXHAUSTED', 'quota', [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay }]),
      ),
    ).retryAfterMs;
  assert.equal(withDelay('0.5s'), 500);
  assert.equal(withDelay('1.25s'), 1250);
  assert.equal(withDelay('0s'), 0);
  assert.equal(withDelay('37'), null);
  assert.equal(withDelay('-3s'), null);
  assert.equal(withDelay('soon'), null);
  assert.equal(withDelay(37), null);
});

test('400 API 키 무효 → auth, 그 밖의 400 → bad_request', async () => {
  assert.deepEqual(pick(classify(await loadApiError('400-api-key-invalid'))), {
    kind: 'auth',
    httpStatus: 400,
    retryAfterMs: null,
  });
  const badField = apiError(400, rpc(400, 'INVALID_ARGUMENT', "Invalid value at 'generation_config.thinking_config'"));
  assert.deepEqual(pick(classify(badField)), { kind: 'bad_request', httpStatus: 400, retryAfterMs: null });
  // 본문 상세 없이 메시지만 있어도 키 무효로 본다
  const keyMessageOnly = apiError(400, rpc(400, 'INVALID_ARGUMENT', 'API key not valid. Please pass a valid API key.'));
  assert.equal(classify(keyMessageOnly).kind, 'auth');
});

test('401·403 → auth, 5xx → server_error, 그 밖의 상태 → unknown(상태는 기록)', async () => {
  const cases: [number, string][] = [
    [401, 'auth'],
    [403, 'auth'],
    [500, 'server_error'],
    [502, 'server_error'],
    [504, 'server_error'],
    [404, 'unknown'],
    [409, 'unknown'],
  ];
  for (const [status, kind] of cases) {
    const ce = classify(apiError(status, rpc(status, 'X', `status ${status}`)));
    assert.deepEqual(pick(ce), { kind, httpStatus: status, retryAfterMs: null }, String(status));
  }
  assert.deepEqual(pick(classify(await loadApiError('503'))), { kind: 'server_error', httpStatus: 503, retryAfterMs: null });
});

test('ApiError가 아니어도 숫자 status를 가진 에러는 HTTP 상태로 분류한다', () => {
  const ce = classify(Object.assign(new Error('upstream'), { status: 502 }));
  assert.deepEqual(pick(ce), { kind: 'server_error', httpStatus: 502, retryAfterMs: null });
});

/* ───────── abort·네트워크·그 밖 ───────── */

test('AbortError → timeout (httpStatus 없음)', () => {
  const ce = classify(new DOMException('This operation was aborted', 'AbortError'));
  assert.deepEqual(pick(ce), { kind: 'timeout', httpStatus: null, retryAfterMs: null });
  assert.equal(classify(new DOMException('signal timed out', 'TimeoutError')).kind, 'timeout');
});

test('signal이 abort된 뒤의 에러는 사유가 무엇이든 timeout (Runner가 abort 사유로 던진 Error 포함)', async () => {
  const ac = new AbortController();
  const reason = new Error('timeout after 1200000ms');
  ac.abort(reason);
  const ce = await classifyFromGenerate({ reject: reason }, ac.signal);
  assert.equal(ce.kind, 'timeout');

  const mid = await classifyFromGenerate(
    { chunks: (await loadChunks('ok')).slice(0, 2), throwAfter: new DOMException('This operation was aborted', 'AbortError') },
    ac.signal,
  );
  assert.equal(mid.kind, 'timeout');
  assert.deepEqual(mid.usage, { inputTokens: 412, outputTokens: 3150, reasoningTokens: 3150 });
});

test('fetch 실패·소켓 오류 코드 → network (cause 사슬까지 본다)', () => {
  const cases: unknown[] = [
    new TypeError('fetch failed', { cause: withCode('getaddrinfo ENOTFOUND generativelanguage.googleapis.com', 'ENOTFOUND') }),
    new TypeError('fetch failed', { cause: withCode('connect ETIMEDOUT 142.250.0.1:443', 'ETIMEDOUT') }),
    new TypeError('terminated', { cause: withCode('other side closed', 'UND_ERR_SOCKET') }),
    withCode('read ECONNRESET', 'ECONNRESET'),
    new Error('exception TypeError: fetch failed sending request', { cause: new TypeError('fetch failed') }),
    new TypeError('fetch failed'),
  ];
  for (const err of cases) {
    const ce = classify(err);
    assert.deepEqual(pick(ce), { kind: 'network', httpStatus: null, retryAfterMs: null }, String(err));
  }
});

test('그 밖 → unknown (Error가 아닌 값 포함)', () => {
  for (const err of [new Error('Incomplete JSON segment at the end'), new TypeError('x is not a function'), 'boom', null, 42]) {
    const ce = classify(err);
    assert.deepEqual(pick(ce), { kind: 'unknown', httpStatus: null, retryAfterMs: null }, String(err));
    assert.equal(typeof ce.message, 'string');
  }
});

/* ───────── message에 키가 섞이지 않는다 ───────── */

test('message: URL 쿼리 key=… 와 Google API 키 모양 문자열을 가린다', () => {
  const fakeKey = 'AIza' + 'Sy' + 'Q'.repeat(33);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/m:streamGenerateContent?alt=sse&key=${fakeKey}`;
  const errors: unknown[] = [
    new TypeError('fetch failed', { cause: new Error(`request to ${url} failed`) }),
    new ApiError({ status: 400, message: JSON.stringify(rpc(400, 'INVALID_ARGUMENT', `bad key ${fakeKey}`)) }),
    new Error(`GET ${url}`),
    `key=${fakeKey}`,
  ];
  for (const err of errors) {
    const { message } = classify(err);
    assert.ok(!message.includes(fakeKey), message);
    assert.ok(!message.includes('QQQQQQQQ'), message);
  }
});

/* ───────── 스트림 도중 에러의 usage ───────── */

test('스트림 도중 에러: 그때까지 받은 마지막 usage를 ClassifiedError.usage에 담는다', async () => {
  const chunks = await loadChunks('ok');
  const ce = await classifyFromGenerate({ chunks: chunks.slice(0, 3), throwAfter: await loadApiError('503', 'in_stream') });
  assert.equal(ce.kind, 'server_error');
  assert.equal(ce.httpStatus, 503);
  assert.deepEqual(ce.usage, { inputTokens: 412, outputTokens: 3198, reasoningTokens: 3150 });
  UsageSchema.parse(ce.usage);
});

test('usage를 받기 전 실패(요청 단계·usage 없는 청크 뒤)면 usage는 null', async () => {
  const before = await classifyFromGenerate({ reject: await loadApiError('429-rate-limit') });
  assert.equal(before.kind, 'rate_limited');
  assert.equal(before.retryAfterMs, 37_000);
  assert.equal(before.usage, null);

  const noUsage = await classifyFromGenerate({
    chunks: (await loadChunks('no-usage')).slice(0, 1),
    throwAfter: new TypeError('terminated', { cause: withCode('other side closed', 'UND_ERR_SOCKET') }),
  });
  assert.equal(noUsage.kind, 'network');
  assert.equal(noUsage.usage, null);
});

test('generate가 던지는 에러의 message에도 키가 남지 않는다', async () => {
  const fakeKey = 'AIza' + 'Sy' + 'Z'.repeat(33);
  const a = new GeminiAdapter(fakeClient([{ reject: new Error(`GET /x?key=${fakeKey}`) }]), { sdkVersion: '2.28.0' });
  const err = await a.generate(req, new AbortController().signal).then(
    () => assert.fail('generate should throw'),
    (e: unknown) => e,
  );
  assert.ok(err instanceof Error);
  assert.ok(!err.message.includes(fakeKey), err.message);
});
