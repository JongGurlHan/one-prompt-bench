import type { FailureKind, Provider, StopReason, Usage } from './schema.js';

/* ────────────────────────────────────────────────────────────
 * 어댑터 = SDK 호출 1회 + 응답 정규화 + 에러 분류. 그 외 책임 없음.
 *
 * 재시도·타임아웃·백오프·시간 측정(latency)·파일 저장·비용 계산은 Runner가 한 곳에서 담당.
 * → 3개 어댑터에 같은 로직이 중복되지 않고, '기술적 실패' 정의도 한 군데만 존재.
 *
 *   models.json ─▶ Runner(재시도/타임아웃) ─▶ Adapter(SDK) ─▶ meta.json + index.html
 *                                                         └▶ Validator(Playwright) ─▶ meta.validation
 * ──────────────────────────────────────────────────────────── */

/** SDK 중립 요청. 각 어댑터가 회사별 파라미터 이름으로 매핑한다. */
export interface GenerationRequest {
  modelId: string;
  system: string | null;
  user: string;
  reasoningEffort: 'high';
  maxOutputTokens: number;
}

/** SDK 응답을 정규화한 결과. 어댑터는 이 모양만 돌려준다. */
export interface ProviderResponse {
  text: string; // 본문 텍스트 전체(추론 내용 제외)
  stopReason: StopReason;
  rawStopReason: string | null;
  usage: Usage; // outputTokens = 추론 포함 전체 출력 (schema.ts 주석 참고)
  resolvedModelId: string | null;
  requestId: string | null;
  firstTokenMs: number | null; // 긴 출력이라 내부적으로 스트리밍, 첫 본문 청크까지 시간
}

/** SDK별 예외를 공통 분류로. 재시도 여부는 여기서 정하지 않는다. */
export interface ClassifiedError {
  kind: FailureKind;
  httpStatus: number | null;
  retryAfterMs: number | null; // 429 Retry-After 헤더가 있으면
  message: string;
  usage: Usage | null; // 스트리밍 중 끊겨도 과금된 경우
}

export interface ProviderAdapter {
  readonly provider: Provider;
  readonly sdk: { package: string; version: string };

  /** signal이 abort되면 SDK 요청을 취소하고 throw (Runner의 타임아웃) */
  generate(req: GenerationRequest, signal: AbortSignal): Promise<ProviderResponse>;

  /** generate가 던진 어떤 값이든 분류. AbortError → 'timeout' */
  classifyError(err: unknown): ClassifiedError;
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
