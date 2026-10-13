import type { ClassifiedError, FailureKind, Usage } from '@opb/core';
import type { CliResult } from '../../system/cli.js';

/* ────────────────────────────────────────────────────────────
 * Claude Code 에러 → ClassifiedError (ARCHITECTURE "Claude Code CLI" 에러 분류). 재시도 여부는 정하지 않는다.
 * 출력(--output-format json)의 is_error·api_error·api_error_status·result와 stderr로 판단한다.
 * 실제로 확인한 에러 출력은 구독 한도 초과 하나다(fixture stdout-usage-limit.json). 나머지는 합성 fixture 기준.
 * ──────────────────────────────────────────────────────────── */

/** --output-format json이 stdout에 쓰는 JSON 객체. 필드는 모두 있을 수도 없을 수도 있다고 보고 읽는다 */
export type ClaudeOutput = Readonly<Record<string, unknown>>;

/** 구조화된 한도 초과 표시. 문구가 바뀌어도 이것으로 잡는다 (execute.py USAGE_LIMIT_API_ERROR와 같은 값) */
export const USAGE_LIMIT_API_ERROR = 'usage_limit_reached';

/**
 * 구독 한도 문구: "usage limit", "hit your session limit" 같은 "hit your … limit", "limit reached".
 * "rate limit"(짧은 요청 한도 → 재시도 대상)은 제외한다. execute.py USAGE_LIMIT_RE와 같은 기준
 */
export const USAGE_LIMIT_RE = /usage limit|hit your (?:(?!rate\b)[\w-]+ )?limit|(?<!rate )limit reached/i;

/** meta.json에 남기는 message 길이 상한 (stderr가 길 수 있다) */
const MESSAGE_MAX = 500;

/** generate가 CLI를 실행한 뒤 실패로 판단했을 때 던진다. 실행 자체의 실패(ENOENT·abort)는 실행 함수의 에러 그대로 */
export class ClaudeCodeCallError extends Error {
  override name = 'ClaudeCodeCallError';
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stderr: string;

  constructor(
    result: CliResult,
    /** 파싱한 stdout. JSON 객체가 아니면 null */
    readonly output: ClaudeOutput | null,
    /** 출력에 있던 사용량. 0보다 클 때만 (실패했어도 과금된 경우) */
    readonly usage: Usage | null,
  ) {
    super(describeFailure(result, output));
    this.exitCode = result.exitCode;
    this.signal = result.signal;
    this.stderr = result.stderr;
  }
}

export function classifyClaudeCodeError(err: unknown): ClassifiedError {
  // abort: 실행 함수는 CliAbortError(name AbortError)로 끝난다. Runner의 timeout 사유가 그대로 올 수도 있다
  if (errorChain(err).some(isAbort)) return unclassified('timeout', err);
  if (!(err instanceof ClaudeCodeCallError)) return unclassified('unknown', err); // 실행 파일 없음·출력 상한 초과 등

  const status = httpStatusOf(err.output);
  return { kind: kindOf(err, status), httpStatus: status, retryAfterMs: null, message: err.message, usage: err.usage };
}

function kindOf(err: ClaudeCodeCallError, status: number | null): FailureKind {
  if (isUsageLimit(err)) return 'usage_limit'; // 몇 시간 뒤에야 풀린다 → 재시도하지 않는다
  if (status === 429) return 'rate_limited';
  if (status !== null && status >= 500) return 'server_error'; // 529 overloaded 포함
  if (status === 401 || status === 403) return 'auth';
  if (status === 400) return 'bad_request';
  return 'unknown';
}

/** api_error가 usage_limit_reached이거나, 에러 결과(is_error)의 result 또는 stderr에 한도 문구가 있다 */
function isUsageLimit(err: ClaudeCodeCallError): boolean {
  if (err.output?.api_error === USAGE_LIMIT_API_ERROR) return true;
  // 정상 결과(is_error 거짓)의 result는 모델 본문이라 보지 않는다 — 생성된 글에 같은 단어가 나올 수 있다
  const texts = err.stderr.split(/\r?\n/);
  const result = errorResult(err.output);
  if (result !== null) texts.push(result);
  return texts.some((text) => USAGE_LIMIT_RE.test(text));
}

/* ───────── message ───────── */

/** 에러 결과(is_error: true)의 result. 그 밖은 null */
function errorResult(output: ClaudeOutput | null): string | null {
  const result = output?.is_error === true ? output.result : undefined;
  return typeof result === 'string' && result.trim() !== '' ? result.trim() : null;
}

/** 사람이 읽을 한 줄: 에러 결과의 result → stderr 앞부분 → exit code·출력 모양 설명 */
function describeFailure(result: CliResult, output: ClaudeOutput | null): string {
  const text = errorResult(output) ?? (result.stderr.trim() || null);
  if (text !== null) return head(text);
  const exit = `exit code ${result.exitCode}${result.signal === null ? '' : `, signal ${result.signal}`}`;
  if (output === null) {
    const stdout = result.stdout.trim();
    return stdout === '' ? `Claude Code가 출력 없이 끝났습니다 (${exit})` : head(`JSON이 아닌 출력 (${exit}): ${stdout}`);
  }
  if (output.is_error === true) return `Claude Code 에러 (${exit}, result 없음)`;
  if (result.exitCode === 0 && output.is_error === false) return 'Claude Code 출력에 본문(result)이 없습니다';
  return `Claude Code가 실패했습니다 (${exit}, is_error: ${JSON.stringify(output.is_error ?? null)})`;
}

function head(text: string): string {
  return text.length <= MESSAGE_MAX ? text : `${text.slice(0, MESSAGE_MAX)}…`;
}

/** 실행 함수의 에러 등 출력이 없는 실패. message는 에러와 cause 사슬 */
function unclassified(kind: FailureKind, err: unknown): ClassifiedError {
  const chain = errorChain(err);
  const message =
    chain.length === 0
      ? String(err)
      : chain.map((e) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e))).join(' <- cause: ');
  return { kind, httpStatus: null, retryAfterMs: null, message: head(message), usage: null };
}

/* ───────── 판정 도우미 ───────── */

/** api_error_status: HTTP 상태 범위의 정수만 */
function httpStatusOf(output: ClaudeOutput | null): number | null {
  const status = output?.api_error_status;
  return Number.isInteger(status) && (status as number) >= 100 && (status as number) <= 599 ? (status as number) : null;
}

function errorChain(err: unknown): unknown[] {
  const chain: unknown[] = [];
  for (let e = err; e !== undefined && chain.length < 5 && !chain.includes(e); e = isRecord(e) ? e.cause : undefined) {
    chain.push(e);
  }
  return chain;
}

const isAbort = (e: unknown) => isRecord(e) && (e.name === 'AbortError' || e.name === 'TimeoutError');

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
