import type { FailureKind, GeneratorTool, Provider, StopReason, Usage } from './schema.js';

/* ────────────────────────────────────────────────────────────
 * 어댑터 = 도구 호출 1회(CLI 프로세스 또는 SDK 요청) + 응답 정규화 + 에러 분류. 그 외 책임 없음.
 *
 * 재시도·타임아웃·백오프·시간 측정(latency)·파일 저장·비용 계산은 Runner가 한 곳에서 담당.
 * → 3개 어댑터에 같은 로직이 중복되지 않고, '기술적 실패' 정의도 한 군데만 존재.
 *
 *   models.json ─▶ Runner(재시도/타임아웃) ─▶ Adapter(CLI·SDK) ─▶ meta.json + index.html
 *                                                              └▶ Validator(Playwright) ─▶ meta.validation
 * ──────────────────────────────────────────────────────────── */

/** 도구 중립 요청. 각 어댑터가 도구별 플래그·파라미터 이름으로 매핑한다. */
export interface GenerationRequest {
  modelId: string;
  system: string; // prompts/<id>-<version>.system.md 내용 그대로 (ADR-005)
  user: string;
  reasoningEffort: 'high';
  maxOutputTokens: number | null; // null이면 상한 옵션을 보내지 않는다(도구 기본값)
}

/** 도구 응답을 정규화한 결과. 어댑터는 이 모양만 돌려준다. */
export interface ProviderResponse {
  text: string; // 본문 텍스트 전체(추론 내용 제외)
  stopReason: StopReason;
  rawStopReason: string | null;
  usage: Usage; // outputTokens = 추론 포함 전체 출력 (schema.ts 주석 참고)
  resolvedModelId: string | null;
  requestId: string | null;
  firstTokenMs: number | null; // 긴 출력이라 내부적으로 스트리밍, 첫 본문 청크까지 시간
}

/** 도구별 예외·실패를 공통 분류로. 재시도 여부는 여기서 정하지 않는다. */
export interface ClassifiedError {
  kind: FailureKind;
  httpStatus: number | null;
  retryAfterMs: number | null; // 429 Retry-After 헤더가 있으면
  message: string;
  usage: Usage | null; // 스트리밍 중 끊겨도 과금된 경우
}

export interface ProviderAdapter {
  readonly provider: Provider;
  /** meta.json runtime.generator의 tool·version (version = CLI 버전 또는 SDK 패키지 버전) */
  readonly generator: { tool: GeneratorTool; version: string };
  /** 출력 상한을 지정할 수 있는지. Codex CLI는 false → maxOutputTokens: null */
  readonly supportsMaxOutputTokens: boolean;

  /**
   * meta.json runtime.generator.invocation: 실제 호출 조건 공개용.
   * CLI는 명령줄, SDK는 설정 JSON. user 프롬프트·비밀값은 넣지 않고 시스템 프롬프트 내용은 자리표시(예: `<system prompt>`)로 둔다.
   */
  describeInvocation(req: GenerationRequest): string;

  /** signal이 abort되면 도구 호출을 취소하고 throw (Runner의 타임아웃) */
  generate(req: GenerationRequest, signal: AbortSignal): Promise<ProviderResponse>;

  /** generate가 던진 어떤 값이든 분류. AbortError → 'timeout' */
  classifyError(err: unknown): ClassifiedError;
}

/** 출력 상한(thinking 포함). 대상 중 최대 출력이 가장 작은 모델에 맞춘 모든 모델 공통 값 (ADR-007) */
export const DEFAULT_MAX_OUTPUT_TOKENS = 65_536;

/** 상한을 지정할 수 있는 도구면 limit, 없으면 null(도구 기본값으로 생성, 숫자를 지어내 기록하지 않는다) */
export function maxOutputTokensFor(
  adapter: Pick<ProviderAdapter, 'supportsMaxOutputTokens'>,
  limit: number = DEFAULT_MAX_OUTPUT_TOKENS,
): number | null {
  return adapter.supportsMaxOutputTokens ? limit : null;
}

/**
 * '기술적 실패'의 단일 정의. 여기 있는 kind만 재시도한다.
 * 응답이 온 경우(no_html, refused, truncated)는 모델의 결과로 보고 재시도하지 않는다.
 * 구독 한도 초과(usage_limit)는 몇 분 안에 풀리지 않으므로 여기 넣지 않는다.
 * ('rate_limited'는 짧은 요청 한도, 'usage_limit'은 구독의 5시간·주간 한도)
 */
export const RETRYABLE_FAILURES: ReadonlySet<FailureKind> = new Set<FailureKind>([
  'timeout',
  'rate_limited',
  'server_error',
  'network',
]);

export interface RunPolicy {
  maxAttempts: number;
  timeoutMs: number; // 시도 1회당
  backoffBaseMs: number; // 지수 백오프 시작값 (Retry-After가 있으면 그쪽 우선)
  backoffMaxMs: number;
}

export const DEFAULT_RUN_POLICY: RunPolicy = {
  maxAttempts: 3,
  timeoutMs: 20 * 60_000,
  backoffBaseMs: 5_000,
  backoffMaxMs: 60_000,
};
