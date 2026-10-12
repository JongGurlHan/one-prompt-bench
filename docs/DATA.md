# 데이터 형식과 표시 규칙

데이터 모양과 불변식의 단일 출처는 `packages/core/src/schema.ts`(zod)다. 이 문서는 그 의도와 아직 코드에 반영되지 않은 변경, 사이트 표시 규칙을 적는다. 예시는 `packages/core/examples/`.

## 파일 배치

```
models.json                   모델 레지스트리 (사람이 관리)
results/<slug>/
  response.txt                모델 응답 원문 (api_failed면 없음)
  index.html                  응답에서 꺼낸 결과물 (outcome ok일 때만)
  meta.json                   생성·검증 기록 (Runner가 쓰고, validation은 검증기가 채움)
  judgment.json               사람이 쓴 판정 (판정 도우미가 씀)
  spring.jpg summer.jpg autumn.jpg winter.jpg   계절별 스크린샷 (시점은 ARCHITECTURE "검증기")
```

`results/`의 파일은 사람도 Claude 세션도 손으로 고치지 않는다. 바꾸려면 `npm run gen -- <slug> --force`로 다시 만들고, 판정은 `npm run judge`로 다시 쓴다. `check:results`가 index.html의 sha256을 meta.json과 대조해 손으로 고친 것을 잡는다. `.gitattributes`의 `results/** -text`로 git이 결과물의 줄바꿈을 바꾸지 않으므로, sha256 대조는 체크아웃한 OS와 관계없이 맞는다.

## models.json (`ModelRegistrySchema`)

| 필드 | 설명 |
|---|---|
| `slug` | kebab-case. 결과 폴더명. 중복 금지 |
| `provider` | `anthropic` \| `openai` \| `google` → 생성 도구가 정해진다 (아래 표) |
| `modelId` | 도구에 보내는 모델 문자열 (예: `gpt-6.1-sol`) |
| `displayName` | 표시명 |
| `releasedAt` | 출시일 (YYYY-MM-DD). 정렬 기준 |
| `pricing` | `inputPer1M`·`outputPer1M`(USD, 추론 토큰도 출력 단가), `asOf`, `sourceUrl` |

| provider | 생성 도구 (`generator.tool`) | 표시 이름 | 회사 표시 |
|---|---|---|---|
| anthropic | `claude-code` | Claude Code | Anthropic |
| openai | `codex-cli` | Codex CLI | OpenAI |
| google | `gemini-api` | Gemini API | Google |

이 대응표는 core에 상수로 둔다. "생성 전" 모델의 생성 도구도 표시해야 하기 때문이다.

## meta.json (`GenerationRecordSchema`)

- `modelSlug`, `modelId`(실제로 보낸 값 스냅샷), `prompt`(`id`·`version`·`sha256` — `{system, user}`의 해시), `params`(`reasoningEffort: "high"`, `maxOutputTokens`)
- `runtime`: `gitCommit`(생성 전에 커밋이 한 번은 있어야 함), `nodeVersion`, `generator`(아래)
- `startedAt`, `finishedAt`, `attempts[]`(시도마다 응답 또는 에러, `latencyMs`, `firstTokenMs`, 사용량)
- `outcome`: `ok` / `no_html` / `truncated` / `refused` / `api_failed`
- `responseTextPath`, `output`(`path`·`bytes`·`sha256`·`extraction`)
- `usageTotal`: `inputTokens`, `outputTokens`(추론 포함 전체 출력), `reasoningTokens`(그중 추론, 모르면 null)
- `cost`: `inputUsd`·`outputUsd`·`totalUsd`, `pricingAsOf` — models.json 정가로 계산
- `validation`: 생성 직후 null, 검증기가 채움 (`loaded`, `consoleErrors`, `pageErrors`, `externalRequests`, `screenshots`, `environment`, `checkedAt`)

### 스키마 변경 예정 (아직 코드에 없음, 첫 phase에서 반영)

실제 데이터가 아직 없으므로 `schemaVersion`은 1을 유지한다.

| 대상 | 지금 | 바꿀 모양 | 이유 |
|---|---|---|---|
| `runtime.sdkPackage`·`sdkVersion` | SDK 이름·버전 | `runtime.generator: { tool: 'claude-code' \| 'codex-cli' \| 'gemini-api', version: string, invocation: string }` | CLI 방식으로 바뀜. `invocation`은 프롬프트·비밀값을 뺀 실제 호출(명령줄 또는 SDK 설정 JSON) — 조건 공개용 |
| `params.maxOutputTokens` | 양의 정수 | 양의 정수 \| `null` | Codex CLI는 상한을 지정할 수 없음. null = 도구 기본값 |
| `ProviderAdapter.sdk` | `{ package, version }` | `generator: { tool, version }` + 호출마다 `invocation` | 위와 같음 |
| `PromptSpec.system` | null | `prompts/<id>-<version>.system.md` 내용 | 공통 최소 시스템 프롬프트 (ADR-005) |
| `validation.screenshots[].path` | `.webp$` 정규식 (`schema.ts` 주석·메시지 포함) | `.jpg$` 정규식. `examples/meta.sample.json`의 스크린샷 경로 4개도 `.jpg`로 | 스크린샷은 Playwright JPEG (ADR-010) |

### 정규화 규칙 (어댑터 책임)

- `inputTokens` = 캐시 여부와 관계없이 **모든 입력 토큰의 합**(Claude의 cache_creation·cache_read 포함, Codex의 cached_input 포함). 비용은 전부 입력 정가로 계산한다.
- `outputTokens` = 추론 토큰을 포함한 전체 출력. 도구가 추론을 따로 주면 더한다. `reasoningTokens`는 그중 추론분이고, 도구가 주지 않으면 null이다.
- `firstTokenMs`: 스트리밍이 아닌 CLI는 null.
- `resolvedModelId`·`requestId`: 도구가 주면 기록하고, 없으면 null.

### 불변식 (저장할 때 schema.ts가 검사)

- 시도 번호는 1부터 빠짐없이 이어진다. `finishedAt` ≥ `startedAt`.
- `outcome`·마지막 시도·`output`·`responseTextPath`가 서로 맞는다 (`api_failed`면 결과물·원문 없음, `ok`면 결과물 있음, 응답 계열이면 원문 있음).
- `usageTotal` = 시도별 사용량의 합. `cost.totalUsd` = `inputUsd` + `outputUsd`.
- `reasoningTokens` ≤ `outputTokens`. 결과물 없이 `validation`이 있을 수 없다.

## judgment.json (`JudgmentSchema`)

`modelSlug`, `prompt`(`id`·`version`), `outputSha256`(판정한 결과물), `judgedAt`, `requirements`(`scene`·`seasonCycle`·`seasonLook`·`seasonLabel` 각각 `pass`/`partial`/`fail`), `note`(1~200자, 사이트의 모델별 관찰 코멘트로 그대로 노출).
판정 기준: `prompts/season-tree-v1.judging.md`. 결과물(`outcome: ok`)이 있는 모델만 판정한다.

## check:results (배포 게이트)

`npm run check:results`는 아래 중 하나라도 어기면 실패한다(배포 중단). 결과가 하나도 없어도 통과한다.

1. `models.json`이 스키마를 통과한다.
2. `results/` 아래 폴더 이름이 모두 models.json의 slug다.
3. 모든 결과 폴더에 `meta.json`이 있고 스키마를 통과하며 `modelSlug`가 폴더 이름과 같다. meta.json이 없는 폴더(중단된 생성)는 실패다.
4. meta.json이 가리키는 파일(`responseTextPath`, `output.path`, 스크린샷)이 실제로 있다.
5. `index.html`의 sha256이 `output.sha256`과 같다.
6. `outcome`이 `ok`면 `validation`이 null이 아니다.
7. `judgment.json`이 있으면 스키마를 통과하고, `modelSlug`·`prompt`가 meta.json과 같고, `outputSha256`이 meta.json의 `output.sha256`과 같다 (ADR-012).

## 표시 규칙 (`packages/core/src/display.ts`)

### 상태 라벨 (결과 탭 목록, 비교표 "결과" 칸)

위에서부터 처음 맞는 것을 쓴다. 배지 색은 `docs/UI_GUIDE.md`.

| 조건 | 라벨 | 배지 계열 |
|---|---|---|
| meta.json 없음 | 생성 전 | 회색 |
| `api_failed`, 마지막 시도 kind = `usage_limit` | 한도 초과 | 파랑 |
| `api_failed` (그 외) | 생성 실패 | 파랑 |
| `refused` | 거부 | 보라 |
| `truncated` | 잘림 | 보라 |
| `no_html` | HTML 없음 | 보라 |
| `ok`, validation null | 검증 전 (배포 게이트가 막으므로 로컬에서만 보임) | 회색 |
| `ok`, 조건 검사 `violation` | 위반 | 빨강 |
| `ok`, 조건 검사 `instruction_miss` | 지시 미준수 | 노랑 |
| `ok`, 조건 검사 `ok` | 정상 | 초록 |

"거부"·"생성 실패"·"검증 전"은 기획 시안에 없던 라벨이다(ADR-016).

### 결과물이 없을 때 보여줄 이유 (결과 탭)

라벨별 이유 문구와 응답 원문 표시 여부는 `docs/COPY.md` "결과 탭"의 "결과물이 없을 때"에 있다.

### 값 계산·포맷

| 표시 항목 | 계산 | 포맷 / 없을 때 |
|---|---|---|
| 조건 검사 | `judgeRequests(validation.externalRequests).verdict` (저장하지 않고 매번 계산) | 정상 / 지시 미준수 / 위반, validation 없으면 — |
| three.js 버전 | `kind`가 three인 요청의 URL에서 `three@x.y.z` → `x.y.z`, cdnjs `r170` → `r170`. 여러 버전이면 쉼표로 | three_unpinned만 있으면 "미고정", three 요청 없음 → — |
| 에러 수 | `consoleErrors.length + pageErrors.length` | 정수, validation 없으면 — |
| 파일 크기 | `output.bytes` | `40.3 KB` (1024 기준, 소수 1자리), 없으면 — |
| 입력·출력 토큰 | `usageTotal` | 천 단위 쉼표, api_failed이고 사용량 0이면 — |
| 그중 추론 | `usageTotal.reasoningTokens` | null이면 — |
| 비용 | `cost.totalUsd` | `$0.47` (소수 2자리), 0보다 크고 0.01 미만이면 `<$0.01` |
| 걸린 시간 | **마지막 시도**의 `latencyMs` (재시도·백오프 제외, 도구 시작 시간 포함) | `3분 34초` / `48초`, api_failed면 — |
| 재시도 | `attempts.length - 1` | 정수 |
| 요구사항 판정 | judgment.json | ✓ 충족 / △ 부분 충족 / ✗ 미충족, 판정 없음 → 판정 전, 결과물 없음 → — |
| 출력 토큰 † | 생성 도구가 Codex CLI인 행 | 값 옆에 † |
| 그중 추론 ‡ | 회사가 Google인 행 | 값 옆에 ‡ |
| 모델 수 `{N}` | models.json의 모델 수 | 문구의 `{N}` 치환 |
| 정렬 | `sortByRelease`: 출시일 최신순, 같은 날은 표시명 알파벳순(숫자는 크기순) | 모든 목록·표 공통 |
