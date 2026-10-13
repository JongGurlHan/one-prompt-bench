# 데이터 형식과 표시 규칙

데이터 모양과 불변식의 단일 출처는 `packages/core/src/schema.ts`(zod)다. 이 문서는 그 의도와 앞으로 할 스키마 변경, 사이트 표시 규칙을 적는다. 예시는 `packages/core/examples/`.

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
| `discarded` | (선택, phase 6에서 추가 — 아래 "스키마 변경 예정") 버린 결과물 기록(ADR-032). 없으면 첫 생성 결과물을 그대로 공개한 모델 |

| provider | 생성 도구 (`generator.tool`) | 표시 이름 | 회사 표시 |
|---|---|---|---|
| anthropic | `claude-code` | Claude Code | Anthropic |
| openai | `codex-cli` | Codex CLI | OpenAI |
| google | `gemini-api` | Gemini API | Google |

이 대응표는 core에 상수로 둔다. "생성 전" 모델의 생성 도구도 표시해야 하기 때문이다.

## meta.json (`GenerationRecordSchema`)

- `modelSlug`, `modelId`(실제로 보낸 값 스냅샷), `prompt`(`id`·`version`·`sha256` — `{system, user}`의 해시), `params`(`reasoningEffort: "high"`, `maxOutputTokens` — 양의 정수, 상한을 지정할 수 없는 Codex CLI는 `null` = 도구 기본값)
- `runtime`: `gitCommit`(생성 전에 커밋이 한 번은 있어야 함), `nodeVersion`, `generator: { tool: 'claude-code' | 'codex-cli' | 'gemini-api', version, invocation }`. `version`은 CLI 버전 또는 SDK 패키지 버전이고, `invocation`은 프롬프트·비밀값을 뺀 실제 호출(명령줄 또는 SDK 설정 JSON)이다. 시스템 프롬프트 내용은 자리표시로 둔다(조건 공개용).
- `startedAt`, `finishedAt`, `attempts[]`(시도마다 응답 또는 에러, `latencyMs`, `firstTokenMs`, 사용량)
- `outcome`: `ok` / `no_html` / `truncated` / `refused` / `api_failed`
- `responseTextPath`, `output`(`path`·`bytes`·`sha256`·`extraction`)
- `usageTotal`: `inputTokens`, `outputTokens`(추론 포함 전체 출력), `reasoningTokens`(그중 추론, 모르면 null)
- `cost`: `inputUsd`·`outputUsd`·`totalUsd`, `pricingAsOf` — models.json 정가로 계산
- `validation`: 생성 직후 null, 검증기가 채움 (`loaded`, `consoleErrors`, `pageErrors`, `externalRequests`, `screenshots`, `environment`, `checkedAt`)

### 스키마 변경 예정

스키마를 바꿔야 하면 구현 전에 이 절에 표(대상 · 지금 · 바꿀 모양 · 이유)로 적는다. 반영하면 표에서 지우고 해당 절로 옮긴다.

| 대상 | 지금 | 바꿀 모양 | 이유 |
|---|---|---|---|
| `ModelEntrySchema` (models.json) | 없음 | `discarded?: Array<{ made: 'generation' \| 'repair'; reason: 'blank_screen' \| 'continued_output'; next: 'regenerate' \| 'repair'; at: YYYY-MM-DD; commit: string(40자 hex) \| null }>`, 오래된 것부터 | ADR-032: 버린 결과물(만든 방법·버린 이유·다음에 한 일·날짜·커밋)을 공개한다. `results/`는 파이프라인만 쓰고 `--force`가 폴더를 비우므로 사람이 관리하는 레지스트리에 둔다. 이미 다시 생성한 Sonnet(ADR-029)도 결과물을 건드리지 않고 기록할 수 있다 |
| `GenerationRecordSchema` (meta.json) | 없음 | `repair?: { round: 1 \| 2; previousOutputSha256: Sha256; errors: Array<{ message: string; count: number }> }` — 공개 결과물이 수정본일 때만 파이프라인(`gen --repair`)이 쓴다. `errors`는 수정 요청문에 실제로 넣은 에러 목록이다. `prompt`의 id·version은 원래 프롬프트 그대로이고 `sha256`은 실제로 보낸 `{system, user(채운 수정 요청문)}`의 해시다 | 수정본이라는 사실과 무엇을 전했는지를 생성 기록에 남긴다 |
| check:results | — | 규칙 추가는 아래 "불변식(phase 6)" | 기록끼리 어긋나지 않게 |

`GenerationRecordSchema`의 `repair`는 `gen --repair`와 함께 실제로 필요해질 때 반영한다(ADR-032). 그 전(phase 6)에는 `discarded`에 수정 요청 관련 항목(`made: 'repair'` 또는 `next: 'repair'`)이 있으면 check:results가 "수정 요청은 아직 구현되지 않았다"로 실패한다.

- 이유 코드: `blank_screen` = 화면에 나무가 그려지지 않음(ADR-032). `continued_output` = 생성 도구가 출력 상한 뒤 이어 쓴 응답을 잘못 기록해 버림(ADR-029, Sonnet). 새 이유가 생기면 코드와 COPY 문구를 함께 더한다.
- `commit`은 버린 결과물을 처음 커밋한 커밋의 전체 해시다(사이트에는 앞 7자). 커밋하기 전에 버렸으면 null(Sonnet만 — ADR-032부터는 버리기 전에 반드시 커밋한다).
- 횟수 상한(core 상수 한 곳): 생성본은 첫 생성 포함 총 3회(`MAX_GENERATIONS = 3`), 수정본은 2회(`MAX_REPAIRS = 2`).
- 불변식(phase 6, 스키마 + check:results):
  - `discarded`의 `made: 'generation'` 항목 수 + (공개 결과물이 생성본이면 1) ≤ 3, `made: 'repair'` 항목 수 + (공개 결과물이 수정본이면 1) ≤ 2.
  - 순서: 생성본 항목이 모두 앞, 수정본 항목이 뒤다. `next: 'repair'`는 마지막 생성본 항목과 수정본 항목에만, 그 앞의 생성본 항목은 `next: 'regenerate'`다. 수정본 항목의 `next`는 `repair`뿐이다.
  - `meta.json`에 `repair`가 있으면 `discarded`의 마지막 항목이 `next: 'repair'`이고, `repair.round` = 수정본 항목 수 + 1이다. `repair`가 없으면 `discarded`의 마지막 항목(있다면)은 `next: 'regenerate'`다.
  - `discarded`가 있는 모델은 `results/<slug>/meta.json`이 있어야 한다. 커밋이 실제로 있는지는 보지 않는다(CI는 얕은 clone).
- 수록 제외(ADR-032 3단계)는 실제로 생기면 모양을 정한다(예: `excluded?: { at }`). 지금은 정하지 않는다.

phase 1에서 반영한 변경(SDK 방식 → CLI 방식): `runtime.sdkPackage`·`sdkVersion` → `runtime.generator`, `params.maxOutputTokens`에 null 허용, `PromptSpec.system` = system.md 내용, 스크린샷 경로 `.webp` → `.jpg`. 실제 데이터가 없던 때라 `schemaVersion`은 1을 유지했다.

### 정규화 규칙 (어댑터 책임)

- `inputTokens` = 캐시 여부와 관계없이 **모든 입력 토큰의 합**(Claude는 input에 cache_creation·cache_read를 더한다. Codex는 `input_tokens`에 cached_input이 이미 들어 있어 더하지 않는다 — ARCHITECTURE "Codex CLI"). 비용은 전부 입력 정가로 계산한다.
- `outputTokens` = 추론 토큰을 포함한 전체 출력. 도구가 추론을 따로 주면 더한다. `reasoningTokens`는 그중 추론분이고, 도구가 주지 않으면 null이다.
- `firstTokenMs`: 스트리밍이 아닌 CLI는 null.
- `resolvedModelId`·`requestId`: 도구가 주면 기록하고, 없으면 null.
- `stopReason`: 도구가 출력 상한에 닿은 뒤 스스로 이어 쓴 응답(Claude Code — 출력 합이 요청 상한을 넘음)은 마지막 값과 관계없이 `max_tokens`다. `rawStopReason`은 도구가 준 원문 그대로 둔다(ADR-029, ARCHITECTURE "Claude Code CLI").

### 불변식 (저장할 때 schema.ts가 검사)

- 시도 번호는 1부터 빠짐없이 이어진다. `finishedAt` ≥ `startedAt`.
- `outcome`·마지막 시도·`output`·`responseTextPath`가 서로 맞는다 (`api_failed`면 결과물·원문 없음, `ok`면 결과물 있음, 응답 계열이면 원문 있음).
- `usageTotal` = 시도별 사용량의 합. `cost.totalUsd` = `inputUsd` + `outputUsd`.
- `reasoningTokens` ≤ `outputTokens`. 결과물 없이 `validation`이 있을 수 없다.

## judgment.json (`JudgmentSchema`)

`modelSlug`, `prompt`(`id`·`version`), `outputSha256`(판정한 결과물), `judgedAt`, `requirements`(`scene`·`seasonCycle`·`seasonLook`·`seasonLabel` 각각 `pass`/`partial`/`fail`), `note`(1~200자, 사이트의 모델별 관찰 코멘트로 그대로 노출).
판정 기준: `prompts/season-tree-v1.judging.md`. 결과물(`outcome: ok`)이 있는 모델만 판정한다.

## check:results (배포 게이트)

`npm run check:results`(`packages/core/scripts/check-results.ts`)는 아래 중 하나라도 어기면 실패한다(배포 중단). 처음 어긴 것에서 멈추지 않고 어긴 것을 모두 `경로: 이유`로 보고한다. 결과가 하나도 없어도(`results/` 없음 포함) 통과한다.

1. `models.json`이 스키마를 통과한다.
2. `results/` 아래 항목은 모두 폴더이고, 이름이 models.json의 slug다.
3. 모든 결과 폴더에 `meta.json`이 있고 스키마를 통과하며 `modelSlug`가 폴더 이름과 같다. meta.json이 없는 폴더(중단된 생성)는 실패다.
4. meta.json이 가리키는 파일(`responseTextPath`, `output.path`, 스크린샷)이 실제로 있다.
5. `index.html`의 sha256이 `output.sha256`과 같다.
6. `outcome`이 `ok`면 `validation`이 null이 아니다.
7. `judgment.json`이 있으면 스키마를 통과하고, `modelSlug`·`prompt`가 meta.json과 같고, `outputSha256`이 meta.json의 `output.sha256`과 같다 (ADR-012).
8. meta.json의 `runtime.generator.tool`이 models.json `provider`의 생성 도구(`GENERATOR_BY_PROVIDER`)와 같다.
9. meta.json이 가리키는 경로(`responseTextPath`, `output.path`, 스크린샷)는 모두 `results/<slug>/` 안이다.

8·9는 phase 2 계획 때 더했다(8은 `check-samples.ts`에 있던 대조). 문서에 없는 경우를 만나면 엄격한 쪽(실패)으로 정한다. phase 2 구현에서 엄격하게 정한 것:
- `results/` 아래의 심볼릭 링크(Windows junction 포함)와 결과 폴더 안의 하위 폴더는 실패다.
- 결과 폴더에 meta.json이 가리키지 않는 파일이 있으면 실패다(`judgment.json` 제외).
- `output.path`·`responseTextPath`는 정확히 `results/<slug>/index.html`·`results/<slug>/response.txt`이고, 스크린샷은 폴더 바로 아래에 있어야 한다.
- `output.bytes`도 실제 파일 크기와 대조한다.
- 결과물이 없는 기록(outcome이 ok가 아님)에 judgment.json이 있으면 실패다.
- models.json이 깨지면 규칙 2·8은 건너뛴다(규칙 1로 이미 실패).

출력: 어긴 것은 stderr에 `경로: 이유` 한 줄씩 쓰고 끝에 FAIL 요약을 쓴다(exit 1). 통과하면 stdout에 `OK  check:results: N result folders in <root>`를 쓴다. `OPB_DATA_ROOT`가 빈 문자열이면 설정하지 않은 것으로 본다.

### 사이트 빌드의 데이터 검사

사이트 빌드(`loadResults`)는 check:results보다 느슨하다. 로컬에서 생성 직후 상태를 볼 수 있게 하려는 것이고, 공개 배포는 check:results가 막는다.
- models.json·meta.json·judgment.json 중 스키마를 통과하지 못하는 파일이 있으면 빌드가 실패한다(파일 경로를 보여 준다).
- meta.json이 없는 폴더는 "생성 전", `ok`인데 `validation`이 null이면 "검증 전"으로 보인다.
- 파일 존재·sha256·판정 대조(규칙 4·5·7)는 check:results만 검사한다.

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

라벨별 이유 문구와 응답 원문 표시 여부는 `docs/COPY.md` "결과 탭"의 "결과물이 없을 때"에 있다. "생성 실패"는 마지막 시도의 에러 종류 표시를 문구 뒤에 괄호로 붙인다: `기술적인 문제로 생성하지 못했어요. (시간 초과)`. 마지막 시도가 에러가 아니면 붙이지 않는다.

### 값 계산·포맷

| 표시 항목 | 계산 | 포맷 / 없을 때 |
|---|---|---|
| 조건 검사 | `judgeRequests(validation.externalRequests).verdict` (저장하지 않고 매번 계산) | 정상 / 지시 미준수 / 위반, validation 없으면 — |
| three.js 버전 | `kind`가 three인 요청의 URL에서 `three@x.y.z` → `x.y.z`, cdnjs `r170` → `r170`. 여러 버전이면 쉼표로 | three_unpinned만 있으면 "미고정", three 요청 없음 → — |
| 에러 수 | `consoleErrors.length + pageErrors.length` | 정수(쉼표 없음), validation 없으면 —. 결과 탭 "생성 기록"과 비교표에 보인다(ADR-026) |
| 파일 크기 | `output.bytes` | `40.3 KB` (1024 기준, 소수 1자리, 쉼표 없음, 크기와 관계없이 항상 KB), 없으면 — |
| 입력·출력 토큰 | `usageTotal` | 천 단위 쉼표, api_failed이고 입력·출력이 모두 0이면 — (응답이 온 기록은 0도 숫자). 결과 탭은 `입력 / 출력` 한 칸 |
| 그중 추론 | `usageTotal.reasoningTokens` | null이면 — (입력·출력이 —이면 함께 —) |
| 비용 | `cost.totalUsd` | `$0.47` (소수 2자리, 쉼표 없음), 0보다 크고 0.01 미만이면 `<$0.01`. api_failed도 기록된 값을 보인다(`$0.00`), 생성 전 → — |
| 걸린 시간 | **마지막 시도**의 `latencyMs` (재시도·백오프 제외, 도구 시작 시간 포함) | 초 단위로 반올림, 60초 미만 `48초`, 이상 `3분 34초`(60초 → `1분 0초`). api_failed면 — |
| 재시도 | `attempts.length - 1` | 정수 |
| 요구사항 판정 | judgment.json | ✓ 충족 / △ 부분 충족 / ✗ 미충족, 판정 없음 → 판정 전, 결과물 없음 → — |
| 출력 토큰 † | 생성 도구가 Codex CLI인 행 | 값 옆에 † (값이 —여도 붙는다 — 2026-10-13 phase 5 계획에서 그대로 두기로 했다). 결과 탭의 토큰 값에는 붙이지 않는다(각주가 비교표에만 있음) |
| 그중 추론 ‡ | 회사가 Google인 행 | 값 옆에 ‡ (†와 같음) |
| 입력 토큰 § | 생성 도구가 Claude Code 또는 Codex CLI인 행 | 값 옆에 § (`inputTokensMark`, ADR-030). 값이 —이어도 붙는다. 결과 탭의 토큰 값에는 붙이지 않는다 |
| 모델 수 `{N}` | models.json의 모델 수 | 문구의 `{N}` 치환 |
| 생성 횟수 | 생성본 = `discarded`의 `made: 'generation'` 수 + (공개 결과물이 생성본이면 1), 수정본 = `made: 'repair'` 수 + (수정본이면 1) (ADR-032) | `1회`, `3회 · 수정 1회`. 버린 결과물이 있으면 값 옆에 ¶. 비교표 표 1. meta.json이 없으면 — |
| 재생성 안내 | 첫 줄(생성본/수정본) + `discarded` 각 항목 → COPY "다시 생성하거나 고친 결과물"의 줄 | `discarded`가 있는 모델에만 결과 탭 안내 박스. 커밋은 앞 7자, null이면 "기록은 남아 있지 않아요" |
| 정렬 | `sortByRelease`: 출시일 최신순, 같은 날은 표시명 알파벳순(숫자는 크기순) | 모든 목록·표 공통 |
