import {
  FinishReason,
  ThinkingLevel,
  type GenerateContentConfig,
  type GenerateContentParameters,
  type GenerateContentResponse,
  type GenerateContentResponseUsageMetadata,
} from '@google/genai';
import type {
  ClassifiedError,
  GenerationRequest,
  ProviderAdapter,
  ProviderResponse,
  StopReason,
  Usage,
} from '@opb/core';
import { GeminiCallError, classifyGeminiError } from './gemini.errors.js';

/* ────────────────────────────────────────────────────────────
 * Gemini API 어댑터 (@google/genai). 스트리밍 요청 1회 + 정규화 + 에러 분류만.
 * 재시도·타임아웃·백오프는 Runner 책임이라 여기서는 받은 signal을 SDK에 넘기기만 한다 (ADR-004).
 * 필드 이름의 근거는 설치한 SDK(2.28.0) 타입 정의. ⚠ 실제 값은 smoke로 확인한다.
 * ──────────────────────────────────────────────────────────── */

export type GeminiStreamParams = GenerateContentParameters;
/** 스트림 청크 중 어댑터가 읽는 필드. SDK의 GenerateContentResponse가 그대로 들어맞는다 */
export type GeminiChunk = Pick<
  GenerateContentResponse,
  'candidates' | 'promptFeedback' | 'usageMetadata' | 'modelVersion' | 'responseId'
>;

/** 테스트가 가짜를 주입할 수 있는 최소 인터페이스. SDK의 ai.models.generateContentStream 모양을 따른다 */
export interface GeminiClient {
  generateContentStream(params: GeminiStreamParams): Promise<AsyncIterable<GeminiChunk>>;
}

export interface GeminiAdapterOptions {
  sdkVersion: string; // readGeminiSdkVersion()
  clock?: () => number; // ms. firstTokenMs 측정용, 테스트에서 주입
}

const THINKING_LEVEL: Record<GenerationRequest['reasoningEffort'], ThinkingLevel> = {
  high: ThinkingLevel.HIGH, // Gemini는 HIGH가 최고 단계 (ADR-007 ‡)
};

/** 출력 잘림: MAX_TOKENS + 요청당 토큰 한도에 걸려 미완성인 CONTINUATION (SDK 주석) */
const TRUNCATED: ReadonlySet<string> = new Set<FinishReason>([FinishReason.MAX_TOKENS, FinishReason.CONTINUATION]);

/** 안전·정책 계열 중단 → refusal */
const REFUSED: ReadonlySet<string> = new Set<FinishReason>([
  FinishReason.SAFETY,
  FinishReason.RECITATION,
  FinishReason.BLOCKLIST,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.SPII,
  FinishReason.IMAGE_SAFETY,
  FinishReason.IMAGE_PROHIBITED_CONTENT,
  FinishReason.IMAGE_RECITATION,
]);

const SYSTEM_PLACEHOLDER = '<system prompt>';
const USER_PLACEHOLDER = '<user prompt>';

export class GeminiAdapter implements ProviderAdapter {
  readonly provider = 'google' as const;
  readonly generator: ProviderAdapter['generator'];
  readonly supportsMaxOutputTokens = true;
  private readonly clock: () => number;

  constructor(
    private readonly client: GeminiClient,
    opts: GeminiAdapterOptions,
  ) {
    this.generator = { tool: 'gemini-api', version: opts.sdkVersion };
    this.clock = opts.clock ?? (() => performance.now());
  }

  describeInvocation(req: GenerationRequest): string {
    return JSON.stringify({
      sdk: '@google/genai',
      method: 'models.generateContentStream',
      stream: true,
      model: req.modelId,
      contents: USER_PLACEHOLDER,
      config: requestConfig(req, SYSTEM_PLACEHOLDER),
    });
  }

  async generate(req: GenerationRequest, signal: AbortSignal): Promise<ProviderResponse> {
    const t0 = this.clock();
    let text = '';
    let firstTokenMs: number | null = null;
    let usage: GenerateContentResponseUsageMetadata | undefined;
    let finishReason: string | undefined;
    let blockReason: string | undefined;
    let modelVersion: string | undefined;
    let responseId: string | undefined;

    try {
      const stream = await this.client.generateContentStream({
        model: req.modelId,
        contents: req.user,
        config: { ...requestConfig(req, req.system), abortSignal: signal },
      });
      for await (const chunk of stream) {
        usage = chunk.usageMetadata ?? usage; // 마지막으로 받은 값
        blockReason = chunk.promptFeedback?.blockReason ?? blockReason; // 첫 청크에만 온다
        modelVersion = chunk.modelVersion ?? modelVersion;
        responseId = chunk.responseId ?? responseId;
        const candidate = chunk.candidates?.[0];
        finishReason = candidate?.finishReason ?? finishReason;
        for (const part of candidate?.content?.parts ?? []) {
          if (part.thought === true || typeof part.text !== 'string' || part.text === '') continue;
          firstTokenMs ??= Math.max(0, Math.round(this.clock() - t0));
          text += part.text;
        }
      }
    } catch (err) {
      // usage·abort 여부를 실어 보내 classifyError가 꺼낸다
      throw new GeminiCallError(err, usage === undefined ? null : normalizeUsage(usage), signal.aborted);
    }

    return {
      text,
      ...mapStopReason(finishReason, blockReason),
      usage: normalizeUsage(usage),
      resolvedModelId: modelVersion ?? null,
      requestId: responseId ?? null,
      firstTokenMs,
    };
  }

  classifyError(err: unknown): ClassifiedError {
    return classifyGeminiError(err);
  }
}

/** 요청 config(abortSignal 제외). describeInvocation도 이 함수를 써서 기록이 실제 요청과 어긋나지 않게 한다 */
function requestConfig(req: GenerationRequest, systemInstruction: string): GenerateContentConfig {
  return {
    systemInstruction, // ADR-005: system.md 내용 그대로
    thinkingConfig: { thinkingLevel: THINKING_LEVEL[req.reasoningEffort] },
    ...(req.maxOutputTokens === null ? {} : { maxOutputTokens: req.maxOutputTokens }), // thinking 포함 상한
  };
}

/** SDK usage → core Usage. 필드가 없거나 토큰 수가 아닌 값이면 0(추론은 null) */
export function normalizeUsage(u: GenerateContentResponseUsageMetadata | undefined): Usage {
  const t = u?.thoughtsTokenCount;
  const thoughts = isCount(t) ? t : null;
  return {
    // promptTokenCount는 캐시분(cachedContentTokenCount)을 이미 포함한다(SDK 주석). 도구 실행 결과 입력은 따로라 더한다
    inputTokens: count(u?.promptTokenCount) + count(u?.toolUsePromptTokenCount),
    // candidatesTokenCount는 thought를 뺀 본문 (totalTokenCount = prompt + candidates + toolUse + thoughts)
    outputTokens: count(u?.candidatesTokenCount) + (thoughts ?? 0),
    reasoningTokens: thoughts,
  };
}

function mapStopReason(
  finishReason: string | undefined,
  blockReason: string | undefined,
): Pick<ProviderResponse, 'stopReason' | 'rawStopReason'> {
  if (blockReason !== undefined) return { stopReason: 'refusal', rawStopReason: blockReason }; // 프롬프트 차단
  if (finishReason === undefined) return { stopReason: 'other', rawStopReason: null };
  let stopReason: StopReason = 'other';
  if (finishReason === FinishReason.STOP) stopReason = 'end';
  else if (TRUNCATED.has(finishReason)) stopReason = 'max_tokens';
  else if (REFUSED.has(finishReason)) stopReason = 'refusal';
  return { stopReason, rawStopReason: finishReason };
}

const isCount = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
const count = (n: unknown) => (isCount(n) ? n : 0);
