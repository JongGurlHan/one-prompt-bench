import type { ClassifiedError, FailureKind, Usage } from '@opb/core';

/* ────────────────────────────────────────────────────────────
 * Gemini 에러 → ClassifiedError. 재시도 여부는 정하지 않는다(RETRYABLE_FAILURES가 정함).
 * SDK(2.28.0)의 ApiError: status = HTTP 상태, message = 응답 본문 JSON(google.rpc.Status)
 *   - 응답 실패: JSON.stringify(body)          - 스트림 도중 에러 청크: `got status: <status>. <body JSON>`
 * ⚠ 429의 짧은 한도/일일 할당량 구분(QuotaFailure.quotaId의 PerDay)은 smoke로 확인한다.
 * ──────────────────────────────────────────────────────────── */

/** generate가 던지는 에러. 원래 에러(cause)에 그때까지 받은 usage와 abort 여부를 싣는다. message는 키를 가린 설명 */
export class GeminiCallError extends Error {
  override name = 'GeminiCallError';

  constructor(
    cause: unknown,
    readonly usage: Usage | null,
    readonly aborted: boolean,
  ) {
    super(describeError(cause), { cause });
  }
}

export function classifyGeminiError(err: unknown): ClassifiedError {
  const wrapped = err instanceof GeminiCallError ? err : null;
  const cause = wrapped ? wrapped.cause : err;
  const status = httpStatusOf(cause);
  const body = status === null ? null : errorBody(cause);
  const result = (kind: FailureKind, retryAfterMs: number | null = null): ClassifiedError => ({
    kind,
    httpStatus: status,
    retryAfterMs,
    message: describe(cause, status, body),
    usage: wrapped?.usage ?? null,
  });

  // abort: SDK는 사유 없이 abort해 AbortError가 오고, signal 사유(Runner의 timeout Error)가 그대로 올 수도 있다
  if (wrapped?.aborted || errorChain(cause).some(isAbort)) return { ...result('timeout'), httpStatus: null };
  if (status !== null) return result(kindForStatus(status, body, cause), retryDelayMs(body));
  if (errorChain(cause).some(isNetworkError)) return result('network');
  return result('unknown');
}

function kindForStatus(status: number, body: ErrorBody | null, err: unknown): FailureKind {
  // 429의 기본값은 rate_limited(재시도). 일일 할당량만 usage_limit — 몇 시간 안에 풀리지 않는다
  if (status === 429) return body !== null && quotaIds(body).some((id) => /PerDay/i.test(id)) ? 'usage_limit' : 'rate_limited';
  if (status === 401 || status === 403) return 'auth';
  if (status === 400) return isApiKeyInvalid(body, err) ? 'auth' : 'bad_request';
  if (status >= 500) return 'server_error';
  return 'unknown';
}

/* ───────── 에러 본문 (google.rpc.Status) ───────── */

interface ErrorBody {
  status: string | null; // 예: RESOURCE_EXHAUSTED
  message: string | null;
  details: Record<string, unknown>[];
}

function errorBody(err: unknown): ErrorBody | null {
  const msg = err instanceof Error ? err.message : '';
  const start = msg.indexOf('{');
  if (start < 0) return null;
  let json: unknown;
  try {
    json = JSON.parse(msg.slice(start));
  } catch {
    return null;
  }
  const e = isRecord(json) ? json.error : undefined;
  if (!isRecord(e)) return null;
  return {
    status: typeof e.status === 'string' ? e.status : null,
    message: typeof e.message === 'string' ? e.message : null,
    details: Array.isArray(e.details) ? e.details.filter(isRecord) : [],
  };
}

const detailsOf = (body: ErrorBody, type: string) =>
  body.details.filter((d) => typeof d['@type'] === 'string' && d['@type'].endsWith(`google.rpc.${type}`));

function quotaIds(body: ErrorBody): string[] {
  return detailsOf(body, 'QuotaFailure')
    .flatMap((d) => (Array.isArray(d.violations) ? d.violations : []))
    .map((v: unknown) => (isRecord(v) ? v.quotaId : undefined))
    .filter((id): id is string => typeof id === 'string');
}

function isApiKeyInvalid(body: ErrorBody | null, err: unknown): boolean {
  const reasons = body === null ? [] : detailsOf(body, 'ErrorInfo').map((d) => d.reason);
  if (reasons.some((r) => typeof r === 'string' && r.startsWith('API_KEY_'))) return true;
  return /API key (?:not valid|expired)/i.test(body?.message ?? (err instanceof Error ? err.message : ''));
}

/** RetryInfo.retryDelay(protobuf Duration, 예: "37s"·"0.5s") → ms. 없거나 형식이 다르면 null */
function retryDelayMs(body: ErrorBody | null): number | null {
  const delay = body === null ? undefined : detailsOf(body, 'RetryInfo')[0]?.retryDelay;
  const m = typeof delay === 'string' ? /^(\d+(?:\.\d+)?)s$/.exec(delay) : null;
  return m ? Math.round(Number(m[1]) * 1000) : null;
}

/* ───────── 상태·abort·네트워크 판정 ───────── */

/** SDK ApiError(또는 숫자 status를 가진 에러)의 HTTP 상태 */
function httpStatusOf(err: unknown): number | null {
  const status = isRecord(err) ? err.status : undefined;
  return Number.isInteger(status) && (status as number) >= 100 && (status as number) <= 599 ? (status as number) : null;
}

/** 에러와 cause 사슬 (fetch 실패는 TypeError('fetch failed') 안에 실제 소켓 오류가 있다) */
function errorChain(err: unknown): unknown[] {
  const chain: unknown[] = [];
  for (let e = err; e !== undefined && chain.length < 5 && !chain.includes(e); e = isRecord(e) ? e.cause : undefined) {
    chain.push(e);
  }
  return chain;
}

const isAbort = (e: unknown) => isRecord(e) && (e.name === 'AbortError' || e.name === 'TimeoutError');

const NETWORK_CODES: ReadonlySet<string> = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'EPIPE',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_SOCKET',
  'UND_ERR_CLOSED',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

/** Node fetch(undici): 연결 실패는 'fetch failed', 응답 도중 끊김은 'terminated' */
const isNetworkError = (e: unknown) =>
  (isRecord(e) && typeof e.code === 'string' && NETWORK_CODES.has(e.code)) ||
  (e instanceof TypeError && (e.message === 'fetch failed' || e.message === 'terminated'));

/* ───────── message ───────── */

function describeError(err: unknown): string {
  const status = httpStatusOf(err);
  return describe(err, status, status === null ? null : errorBody(err));
}

/** 사람이 읽을 한 줄. 본문이 있으면 상태·메시지·quotaId만 뽑고, 없으면 에러와 cause 사슬. 키는 가린다 */
function describe(err: unknown, status: number | null, body: ErrorBody | null): string {
  let text: string;
  if (body !== null) {
    const ids = quotaIds(body);
    text = `${body.status ?? 'ERROR'}: ${body.message ?? ''}${ids.length > 0 ? ` (quotaId: ${ids.join(', ')})` : ''}`;
  } else {
    text = errorChain(err)
      .map((e) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e)))
      .join(' <- cause: ');
  }
  return redactSecrets(status === null ? text : `HTTP ${status} ${text}`);
}

/** URL 쿼리의 key=…와 Google API 키 모양(AIza…) 문자열을 가린다 */
function redactSecrets(s: string): string {
  return s.replace(/\b((?:api_?)?key=)[^&\s"'#]+/gi, '$1<redacted>').replace(/AIza[0-9A-Za-z_-]{30,}/g, '<redacted>');
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
