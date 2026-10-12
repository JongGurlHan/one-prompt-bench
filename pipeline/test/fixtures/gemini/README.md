# Gemini 어댑터 fixture

**합성 fixture — 사람이 smoke를 실행한 뒤 원본 출력으로 교체 예정.**

실제 API를 부르지 않고, 설치한 `@google/genai`(2.28.0)의 타입 정의(`GenerateContentResponse`, `GenerateContentResponseUsageMetadata`, `FinishReason`, `BlockedReason`)와 Gemini API 에러 본문(`google.rpc.Status`) 모양에 맞춰 손으로 만들었다. 값(토큰 수, `modelVersion`, `responseId`, `quotaId`, `retryDelay`)은 예시다.

| 파일 | 내용 |
|---|---|
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

교체할 때 확인할 것(⚠ 실제 출력으로 확정): thought part가 오는지(`includeThoughts`를 켜지 않음), usage 필드 이름과 캐시 토큰 포함 여부, `finishReason` 값, 429의 짧은 한도와 일일 할당량을 구분하는 `quotaId` 모양.
