# Step 2: gemini-adapter

## 목표

`pipeline/src/adapters/gemini/`의 Gemini 어댑터가 core `ProviderAdapter`를 구현한다. 주입받은 `@google/genai` 클라이언트로 스트리밍 요청을 1회 보내고, 응답을 `ProviderResponse`로 정규화하고, 에러를 `ClassifiedError`로 분류한다. 실제 네트워크 없이 가짜 클라이언트와 fixture로 테스트가 증명한다.

## 관련 파일

- `docs/ARCHITECTURE.md` "도구별 호출 사양" → 공통, **Gemini API**
- `docs/DATA.md` "정규화 규칙"
- `docs/ADR.md` ADR-004(재시도 분류), ADR-005(시스템 프롬프트), ADR-007(출력 상한)
- `packages/core/src/adapter.ts`(step 1에서 바뀐 인터페이스: `generator`, `supportsMaxOutputTokens`, `describeInvocation`, `maxOutputTokens: number | null`), `schema.ts`의 `FailureKind`·`StopReason`·`UsageSchema`
- 설치한 `@google/genai`의 타입 정의(`node_modules/@google/genai/dist/**/*.d.ts`) — 필드 이름의 근거로 쓴다

## 작업

1. `pipeline`에 `@google/genai` 의존성을 추가한다(설치 시점 최신 안정판).
2. 어댑터(예: `pipeline/src/adapters/gemini/gemini.adapter.ts`). 시그니처는 설계 의도이며, SDK 실제 타입에 맞게 조정해도 된다:
   ```ts
   /** 테스트가 가짜를 주입할 수 있는 최소 인터페이스. SDK의 ai.models.generateContentStream 모양을 따른다 */
   export interface GeminiClient {
     generateContentStream(params: GeminiStreamParams): Promise<AsyncIterable<GeminiChunk>>;
   }
   export class GeminiAdapter implements ProviderAdapter {
     constructor(client: GeminiClient, opts: { sdkVersion: string; clock?: () => number });
   }
   export function createGeminiClient(apiKey: string): GeminiClient;  // 실제 SDK 래핑. 테스트에서 호출하지 않는다
   export function readGeminiSdkVersion(): string;                      // 설치된 @google/genai의 package.json version
   ```
   - 요청: `model = req.modelId`, `contents = req.user`(그대로), `config.systemInstruction = req.system`, thinking level high, `config.maxOutputTokens = req.maxOutputTokens`(null이면 넣지 않음), `config.abortSignal = signal`.
   - `generator = { tool: 'gemini-api', version: <SDK 버전> }`, `supportsMaxOutputTokens = true`.
   - `describeInvocation(req)`: SDK 설정 JSON 문자열. 모델, thinking 설정, maxOutputTokens, 스트리밍 여부를 담고, `systemInstruction`은 자리표시로 둔다. user 프롬프트와 API 키는 넣지 않는다.
   - 스트림 처리: part 중 `thought: true`인 것은 본문에서 뺀다. `text` = thought가 아닌 텍스트 part를 받은 순서대로 이어 붙인 것. `firstTokenMs` = 요청 시작부터 thought가 아닌 첫 텍스트를 받을 때까지(시계는 주입).
   - 사용량(마지막으로 받은 `usageMetadata` 기준): `inputTokens` = 모든 입력 토큰의 합(`promptTokenCount`가 캐시분을 포함하는지 SDK 타입 주석으로 확인하고, 따로라면 더한다). `reasoningTokens` = `thoughtsTokenCount ?? null`. `outputTokens` = `candidatesTokenCount + (thoughtsTokenCount ?? 0)`. 필드가 없으면 0·null로 처리한다. 결과가 core `UsageSchema`(`reasoningTokens ≤ outputTokens`)를 통과해야 한다.
   - `stopReason`: `STOP` → `end`, `MAX_TOKENS` → `max_tokens`. 안전·정책 계열(설치한 SDK의 `FinishReason` enum을 보고 고른다. 예: `SAFETY`, `PROHIBITED_CONTENT`, `BLOCKLIST`, `SPII`, `RECITATION`)이거나 `promptFeedback.blockReason`이 있으면 → `refusal`. 그 밖이나 값이 없으면 → `other`. `rawStopReason` = 원문 문자열(없으면 null, 차단이면 blockReason).
   - `resolvedModelId = modelVersion ?? null`, `requestId = responseId ?? null`.
   - `classifyError(err)`:
     - abort(AbortError 또는 signal 사유) → `timeout`.
     - SDK `ApiError`(또는 숫자 `status`를 가진 에러): 429 → 기본 `rate_limited`. 단 에러 본문에 일일 할당량 소진 표시(예: QuotaFailure의 quotaId에 `PerDay`)가 있으면 `usage_limit`. 401·403 → `auth`. 400 → `bad_request`(API 키 무효 표시면 `auth`). 5xx → `server_error`.
     - fetch 실패·`ECONNRESET`·`ENOTFOUND`·`ETIMEDOUT` 등 → `network`. 그 밖 → `unknown`.
     - `retryAfterMs`: 429 본문의 RetryInfo `retryDelay`(예: `"37s"`)를 파싱하고, 없으면 null. `httpStatus`는 아는 경우만 넣는다.
     - `message`에 API 키가 들어가지 않게 한다(URL 쿼리 `key=…` 등이 섞이면 가린다).
     - 스트림 도중 에러가 나면, 그때까지 받은 usage가 있으면 `ClassifiedError.usage`에 담는다(없으면 null). generate가 던지는 에러에 usage를 실어 classifyError가 꺼낼 수 있게 한다.
3. fixture(`pipeline/test/fixtures/gemini/`): 설치한 SDK 타입에 맞춰 만든 **합성** 스트림 청크 JSON과 에러 본문을 둔다.
   - 청크 종류: 정상(thought 포함 여러 청크), MAX_TOKENS, SAFETY, promptFeedback 차단, usage 없음.
   - 에러 종류: 429 짧은 한도, 429 일일 할당량, 400 키 무효, 503.
   - 같은 폴더의 `README.md`에 "합성 fixture — 사람이 smoke를 실행한 뒤 원본 출력으로 교체 예정"이라고 적는다.
4. 테스트(먼저 작성): 가짜 `GeminiClient`가 fixture 청크를 async iterable로 흘려보낸다. 다음을 검증한다.
   - 요청 파라미터: 시스템 지시문·thinking·상한·abortSignal이 전달되고, 상한이 null이면 빠진다.
   - 본문과 thought의 분리.
   - 사용량 정규화와 `UsageSchema` 통과.
   - stopReason 매핑.
   - 에러 분류 표(위 규칙 전부)와 retryAfterMs.
   - `describeInvocation`에 user 프롬프트와 키가 없음.
   - firstTokenMs(주입한 시계).
   - 통합: core `runGeneration`에 이 어댑터와 가짜 클라이언트를 넣어 OS 임시 디렉토리에 meta.json이 스키마를 통과하며 써지고, `runtime.generator.tool`이 `gemini-api`다.

## ⚠ 열어 둘 것

다음은 실제 출력으로 확인되지 않았다(사람이 phase 뒤 smoke로 확인한다): SDK의 thinking level 설정 이름, usage 필드 이름(캐시 토큰 포함 여부), finishReason 값, 429의 짧은 한도와 일일 할당량을 구분하는 방법. 설치한 SDK 타입 정의를 근거로 구현하되, 필드가 없거나 모르는 값이면 `null`·`other`·`unknown`·`rate_limited`(429의 기본값)로 안전하게 떨어지게 한다. 추측으로 정한 부분은 handoff에 목록으로 남겨라.

## 금지사항

- 실제 Gemini API를 부르는 코드를 테스트에서 실행하지 마라(`createGeminiClient` 호출 포함). 이유: CLAUDE.md CRITICAL, 무료 할당량과 키를 쓴다.
- `.env`를 읽거나 API 키를 출력하지 마라. 이 step의 어댑터는 키를 인자로만 받는다(`.env` 읽기는 step 3). 이유: CLAUDE.md CRITICAL.
- 어댑터 안에서 재시도·백오프·타임아웃 타이머를 만들지 마라. 이유: Runner의 책임이다(ADR-004). 어댑터는 받은 signal을 SDK에 넘기기만 한다.
- 429를 무조건 `usage_limit`로 분류하지 마라. 이유: 짧은 요청 한도는 재시도해야 하는데, `usage_limit`은 재시도하지 않아 결과가 "한도 초과"로 굳는다.
- Nest 모듈 등록이나 `gen` 명령 연결은 하지 마라. 이유: step 3 범위(어댑터 레지스트리·설정과 함께 만든다).
