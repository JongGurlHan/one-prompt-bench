# Gemini 어댑터 fixture

**`stream-smoke-ok.jsonl`만 실제 출력이고, 나머지는 합성 fixture다.** 실제 출력은 smoke 원본(`results-smoke/<slug>-<시각>/raw-*`)을 고치지 않고 그대로 복사한다.

합성 fixture는 실제 API를 부르지 않고, 설치한 `@google/genai`(2.28.0)의 타입 정의(`GenerateContentResponse`, `GenerateContentResponseUsageMetadata`, `FinishReason`, `BlockedReason`)와 Gemini API 에러 본문(`google.rpc.Status`) 모양에 맞춰 손으로 만들었다. 값(토큰 수, `modelVersion`, `responseId`, `quotaId`, `retryDelay`)은 예시다.

| 파일 | 내용 |
|---|---|
| `stream-smoke-ok.jsonl` | **실제** smoke 원본(2026-10-12, gemini-3.8-flash, SDK 2.28.0, Hello 요청). 본문 청크 2개 → 빈 text + `thoughtSignature` part와 `STOP`. usage는 청크마다 누적(prompt 35 / candidates 20 / thoughts 561 / total 616), `serviceTier` 필드 있음, 청크마다 `sdkHttpResponse.headers` 포함 |
| `stream-ok.jsonl` | 정상: thought 청크 2개 → 본문 청크 3개, 마지막 `STOP`. 마지막 usage에 `cachedContentTokenCount`(promptTokenCount에 포함된 값) |
| `stream-max-tokens.jsonl` | `MAX_TOKENS`로 끝남 (출력 + thought = 65,536) |
| `stream-safety.jsonl` | 본문 일부 뒤 `SAFETY`로 끝남 (마지막 청크에 content 없음) |
| `stream-prompt-blocked.jsonl` | candidates 없이 `promptFeedback.blockReason` |
| `stream-no-usage.jsonl` | `usageMetadata`·`modelVersion`·`responseId` 없음 |
| `error-429-rate-limit.json` | 429, QuotaFailure `…PerMinute…`, RetryInfo `37s` |
| `error-429-daily-quota.json` | 429, QuotaFailure `…PerDay…` |
| `error-400-api-key-invalid.json` | 400, ErrorInfo `API_KEY_INVALID` |
| `error-503.json` | 503 `UNAVAILABLE` |

형식:
- `stream-*.jsonl`: SDK `generateContentStream`이 내주는 청크를 한 줄에 하나씩(JSON Lines). smoke가 저장하는 원본과 같은 형식이다.
- `error-*.json`: `{ "status": HTTP 상태, "body": 응답 본문 }`. 테스트는 SDK가 하는 것처럼 `new ApiError({ status, message: JSON.stringify(body) })`로 에러를 만든다(`throwErrorIfNotOK`). 스트림 도중 에러는 `got status: <status>. <본문 JSON>` 형식의 message가 된다.

smoke로 확인한 것: thought 본문 part는 오지 않는다(`includeThoughts`를 켜지 않음, 서명만 온다). usage 필드 이름은 `promptTokenCount`·`candidatesTokenCount`·`thoughtsTokenCount`·`totalTokenCount`이다. 정상 종료는 `STOP`이다.
아직 합성인 것(⚠ 실제로 만나면 smoke의 `raw-error.json`이나 meta.json의 에러 message로 교체): 캐시 토큰이 있을 때의 usage, STOP 외 finishReason, 429의 짧은 한도와 일일 할당량을 구분하는 `quotaId` 모양, 키 무효 표시, 스트림 도중 에러 형식.
