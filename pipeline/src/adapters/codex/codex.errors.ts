import type { ClassifiedError, FailureKind } from '@opb/core';
import type { CliResult } from '../../system/cli.js';
import { USAGE_LIMIT_RE } from '../claude-code/claude-code.errors.js';

/* ────────────────────────────────────────────────────────────
 * Codex 에러 → ClassifiedError (ARCHITECTURE "Codex CLI" 에러 분류). 재시도 여부는 정하지 않는다.
 * --json 출력에는 HTTP 상태 필드가 없고 turn.failed·error 이벤트의 message 문자열뿐이라 문구로 판단한다.
 * ⚠ 문구는 0.157.1 공개 소스 기준이다. 실제 출력으로 확인한 에러는 아직 없다(fixture는 모두 합성).
 * ──────────────────────────────────────────────────────────── */

/** --json이 stdout에 한 줄씩 쓰는 이벤트. 필드는 모두 있을 수도 없을 수도 있다고 보고 읽는다 */
export type CodexEvent = Readonly<Record<string, unknown>>;

/** stdout을 줄 단위로 파싱한 결과 */
export interface CodexOutput {
  events: readonly CodexEvent[];
  /** JSON 객체가 아닌 줄 (빈 줄 제외). 하나라도 있으면 실패다 */
  invalidLines: readonly string[];
}

/** meta.json에 남기는 message 길이 상한 (stderr가 길 수 있다) */
const MESSAGE_MAX = 500;

/**
 * 분류 목록. 위에서부터 처음 맞는 것 — 순서가 의미다.
 * 한도 문구 `You’ve hit your usage limit…`는 공통 한도 문구(USAGE_LIMIT_RE의 "usage limit")로도 잡힌다.
 */
const RULES: readonly (readonly [FailureKind, RegExp])[] = [
  ['usage_limit', /You['’]ve hit your usage limit|Quota exceeded/i], // 몇 시간 뒤에야 풀린다 → 재시도하지 않는다
  ['usage_limit', USAGE_LIMIT_RE],
  // 출력 잘림·필터(response.incomplete). "stream disconnected"로 감싸여 오지만 재시도해도 같다 → network보다 먼저
  ['unknown', /Incomplete response returned/i],
  ['rate_limited', /rate limit exceeded|unexpected status 429\b/i],
  ['server_error', /unexpected status 5\d\d\b|high demand|at capacity/i],
  ['network', /stream disconnected|Connection failed/i],
  ['auth', /unexpected status 40[13]\b|Not logged in|upgrade to Plus/i],
  ['bad_request', /unexpected status 400\b/i],
];

/** generate가 CLI를 실행한 뒤 실패로 판단했을 때 던진다. 실행 자체의 실패(ENOENT·abort)는 실행 함수의 에러 그대로 */
export class CodexCallError extends Error {
  override name = 'CodexCallError';
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stderr: string;
  readonly events: readonly CodexEvent[];
  readonly invalidLines: readonly string[];
  /** 분류에 쓰는 에러 문구(자르지 않은 것): turn.failed의 error.message → 마지막 error 이벤트 → stderr. 없으면 null */
  readonly failureText: string | null;

  constructor(
    result: CliResult,
    output: CodexOutput,
    /** -o로 받은 last-message.txt가 있었는가 */
    readonly hasLastMessage: boolean,
  ) {
    const failureText = failureTextOf(output.events, result.stderr);
    super(failureText === null ? describeShape(result, output, hasLastMessage) : head(failureText));
    this.exitCode = result.exitCode;
    this.signal = result.signal;
    this.stderr = result.stderr;
    this.events = output.events;
    this.invalidLines = output.invalidLines;
    this.failureText = failureText;
  }
}

export function classifyCodexError(err: unknown): ClassifiedError {
  // abort: 실행 함수는 CliAbortError(name AbortError)로 끝난다. Runner의 timeout 사유가 그대로 올 수도 있다
  if (errorChain(err).some(isAbort)) return unclassified('timeout', err);
  if (!(err instanceof CodexCallError)) return unclassified('unknown', err); // 실행 파일 없음·출력 상한 초과 등

  const text = err.failureText ?? '';
  const kind = RULES.find(([, re]) => re.test(text))?.[0] ?? 'unknown'; // JSON이 아닌 줄·그 밖
  // 실패 출력(turn.failed·error)에는 사용량이 없다
  return { kind, httpStatus: httpStatusOf(text), retryAfterMs: null, message: err.message, usage: null };
}

/* ───────── message ───────── */

/** turn.failed의 error.message → 마지막 error 이벤트의 message → stderr. 정상 본문(agent_message)은 보지 않는다 */
function failureTextOf(events: readonly CodexEvent[], stderr: string): string | null {
  const lastText = (pick: (e: CodexEvent) => unknown) => events.map((e) => textOf(pick(e))).findLast((t) => t !== null) ?? null;
  return (
    lastText((e) => (e.type === 'turn.failed' && isRecord(e.error) ? e.error.message : undefined)) ??
    lastText((e) => (e.type === 'error' ? e.message : undefined)) ??
    (stderr.trim() || null)
  );
}

/** 에러 문구가 없을 때 exit code·출력 모양으로 설명한다 */
function describeShape(result: CliResult, output: CodexOutput, hasLastMessage: boolean): string {
  const exit = `exit code ${result.exitCode}${result.signal === null ? '' : `, signal ${result.signal}`}`;
  const [invalid] = output.invalidLines;
  if (invalid !== undefined) return head(`JSON이 아닌 줄 (${exit}): ${invalid}`);
  if (output.events.length === 0) return `Codex가 출력 없이 끝났습니다 (${exit})`;
  if (result.exitCode !== 0) return `Codex가 실패했습니다 (${exit})`;
  if (!output.events.some((e) => e.type === 'turn.completed')) return `Codex가 turn.completed 없이 끝났습니다 (${exit})`;
  if (!hasLastMessage) return 'Codex가 마지막 메시지 파일(last-message.txt)을 쓰지 않았습니다';
  return `Codex가 실패했습니다 (${exit})`;
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

/** 메시지의 `unexpected status NNN` (Codex가 HTTP 응답 실패를 이렇게 적는다). 없으면 null */
function httpStatusOf(text: string): number | null {
  const m = /unexpected status (\d{3})\b/i.exec(text);
  const status = m ? Number(m[1]) : null;
  return status !== null && status >= 100 && status <= 599 ? status : null;
}

/** 비어 있지 않은 문자열이면 앞뒤 공백을 지운 값, 아니면 null */
function textOf(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
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
