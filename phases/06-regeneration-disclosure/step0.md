# Step 0: discarded-record

## 목표

버린 결과물 기록(`models.json`의 `discarded`, ADR-032)이 데이터로 존재하고 검사·표시 값까지 만들어진다. 화면 반영은 다음 step이 한다.

- core 스키마가 `discarded`를 받고, check:results가 DATA "스키마 변경 예정"의 불변식(phase 6 범위)을 검사한다.
- core `display.ts`가 생성 횟수(`1회`·`3회`)와 ¶ 표시, 결과 탭 안내 박스의 문구(첫 줄 + 버린 결과물마다 한 줄)를 만든다.
- 레포의 `models.json`에 실제 기록 3개가 들어가고 `npm run check:results`가 통과한다.
- `npm run gen -- <slug> --force`가 커밋 안 된 결과물을 지우지 않는다(버리기 전 커밋 검사).

## 관련 파일

- `docs/ADR.md` ADR-029·ADR-032(ADR-031은 대체됨), `docs/DATA.md` "models.json"·**"스키마 변경 예정"**(모양·이유 코드·`commit`·횟수 상한·불변식(phase 6)·수정 요청 항목 거절)·"표시 규칙"의 "생성 횟수"·"재생성 안내" 줄
- `docs/COPY.md` 결과 탭 **"다시 생성하거나 고친 결과물"**(첫 줄·줄 문구·커밋 표기) — 이 step은 생성본 문구만 쓴다(수정본 문구는 `--repair`와 함께 나중에)
- `docs/ARCHITECTURE.md` "다시 생성·수정 요청"의 "버리기 전 커밋 검사", "Batch 규칙"(순서·종료 코드)
- 코드: `packages/core/src/schema.ts`(`ModelEntrySchema`), `packages/core/src/results.ts`(`checkResults`·`loadResults`), `packages/core/src/display.ts`(`ModelDisplay`·`displayModel`, COPY 문구를 상수로 둔 `missingOutputReason` 방식), `packages/core/test/support/testing.ts`(`fakeModel`·`makeDataRoot`·`STATUS_CASES`), `pipeline/src/generation/batch.ts`(`planResultDir`·`forceConfirmMessage`·4번 `--force` 단계), `pipeline/src/system/git.ts`(`GitClient.status`)
- 테스트 본보기: `packages/core/test/schema.test.ts`·`results-check.test.ts`·`display.test.ts`, `pipeline/test/batch.test.ts`·`batch-fakes.ts`

## 작업

테스트를 먼저 작성한다. 시그니처는 예시이고 재량이다. 바꾸면 handoff에 남긴다.

1. **스키마** (`schema.ts`): DATA "스키마 변경 예정"의 `discarded` 모양 그대로 `ModelEntrySchema`에 선택 필드로 더한다(`made`·`reason`·`next`의 enum 전체, `at` = `z.iso.date()`, `commit` = 40자 소문자 hex 또는 null). 횟수 상한 상수 `MAX_GENERATIONS = 3`·`MAX_REPAIRS = 2`를 core 한 곳에 둔다(`index.ts`로 내보냄). `GenerationRecordSchema`의 `repair`는 **더하지 않는다**(ADR-032 — `--repair`와 함께 나중에). `schemaVersion`은 그대로 둔다(선택 필드 추가라 기존 데이터가 그대로 통과).
2. **check:results** (`results.ts`의 `checkResults`, 규칙은 DATA에 적힌 것만):
   - `discarded`가 있는 모델은 `results/<slug>/meta.json`이 있어야 한다.
   - `made: 'generation'` 항목 수 + 1 ≤ `MAX_GENERATIONS`(지금은 공개 결과물이 항상 생성본).
   - 수정 요청 관련 항목(`made: 'repair'` 또는 `next: 'repair'`)이 있으면 실패: "수정 요청(--repair)은 아직 구현되지 않았다(ADR-032)".
   - 순서 규칙(생성본 항목이 앞)은 위 규칙으로 지금은 자동으로 지켜진다. 수정본 규칙은 `--repair` 때 더한다.
   - 위반은 기존 형식(`경로: 이유`, 모두 모아 보고)으로. `models.json`이 스키마에서 깨지면 기존처럼 규칙 1로 실패한다.
3. **표시** (`display.ts`, COPY 문구는 `missingOutputReason`처럼 core 상수로):
   - `ModelDisplay`에 `generationCount: string`(`{N}회`, meta.json이 없으면 `—`), `generationCountMark: '' | '¶'`(`discarded`가 하나라도 있으면 ¶), `regeneration: { title: string; lines: string[] } | null`(`discarded`가 없으면 null)을 더한다.
   - 생성 횟수 N = `made: 'generation'` 항목 수 + 1.
   - `title` = `{N}번째로 생성한 결과물이에요.`, `lines` = 항목마다 `{k}번째 생성: {이유와 한 일} {커밋}`(오래된 것부터 k = 1, 2, …). 이유와 한 일·커밋 표기(`(커밋 {앞 7자})` / `(기록은 남아 있지 않아요)`)는 COPY 그대로. 생성본 문구 두 개(`blank_screen`→다시 생성, `continued_output`→다시 생성)만 쓴다.
   - 표시 값은 JSON으로 옮길 수 있어야 한다(결과 탭이 `ResultView` JSON으로 넘긴다 — 다음 step).
4. **기록 3개** (레포 루트 `models.json` — 사람이 관리하는 레지스트리이고, 이 step에서는 아래 값을 그대로 넣는다. 다른 필드·순서는 바꾸지 않는다):
   - `gpt-6-sol`: `[{ "made": "generation", "reason": "blank_screen", "next": "regenerate", "at": "2026-10-13", "commit": "f0e698868f321729a36937aca7bca80966c706f9" }, { "made": "generation", "reason": "blank_screen", "next": "regenerate", "at": "2026-10-14", "commit": "a766e4f00b5a80c4bd1bb1272f5a36f4ed3ae996" }]` → 3회
   - `gemini-3-8-flash`: `[{ "made": "generation", "reason": "blank_screen", "next": "regenerate", "at": "2026-10-14", "commit": "eac58e07bb8d3d6ffdb1a4ba7ddc6eabd15d4ff0" }]` → 2회
   - `claude-sonnet-5-5`: `[{ "made": "generation", "reason": "continued_output", "next": "regenerate", "at": "2026-10-13", "commit": null }]` → 2회
   - 나머지 5개 모델에는 넣지 않는다. JSON 들여쓰기·키 순서는 파일의 기존 형식을 따른다(`discarded`는 `pricing` 뒤).
5. **버리기 전 커밋 검사** (`batch.ts`, `GitClient.status` 사용): `--force`로 비울 폴더 중 git HEAD와 다른 변경(`git status --porcelain -- results/<slug>`가 비어 있지 않음 — 수정·삭제·추적 안 됨 모두)이 있는 폴더가 있으면, 확인을 묻기 전에 그 목록과 "먼저 커밋하세요(ADR-032 — 버린 결과물은 git에 남아야 한다)"를 출력하고 아무것도 지우지 않고 exit 1. 예외: 그 폴더의 meta.json이 없거나 outcome이 `api_failed`(표본이 아님). `--force` 없는 실행(`api_failed`·중단된 폴더를 다시 돌리는 경로)은 바꾸지 않는다. 검사 위치는 ARCHITECTURE "Batch 규칙"의 순서에서 `--force` 확인 바로 앞이다.
6. **테스트**
   - schema: `discarded` 있음·없음 통과, 잘못된 enum·날짜·해시(대문자·짧음) 거부.
   - check:results(OS 임시 데이터 루트): 정상 기록 통과, meta.json 없는 모델에 `discarded` → 실패, 생성본 3개(=4회) → 실패, `made: 'repair'`·`next: 'repair'` → 실패. 실패는 모아서 보고.
   - display: 위 3개 모델과 같은 모양의 가짜 기록으로 `generationCount`·`generationCountMark`·`regeneration`(문구 전체, 커밋 7자, null 커밋)이 COPY와 정확히 같다. `discarded` 없는 모델은 `1회`·`''`·null, meta.json 없는 모델은 `—`.
   - 테스트 데이터 빌더(`@opb/core/testing`): 모델에 `discarded`를 줄 수 있게 한다(예: `fakeModel`에 선택 인자). 기존 호출은 그대로 동작해야 한다.
   - batch: 가짜 git이 변경을 보고하면 `--force`가 확인을 묻지 않고 exit 1이며 파일이 그대로다. `api_failed`·meta.json 없는 폴더는 변경이 있어도 진행한다. 변경이 없으면 기존처럼 확인을 묻는다.
   - 레포 `models.json`을 읽는 테스트를 새로 만들지 마라(아래 금지사항). AC의 `npm run check:results`가 레포 데이터를 검사한다.
7. handoff에 바뀐 인터페이스(`ModelDisplay` 새 필드, 상수, 테스트 빌더)와 다음 step이 쓸 값을 적는다.

## 금지사항

- `results/` 아래 파일을 만들거나 고치지 마라(테스트 픽스처 포함). 이유: CLAUDE.md CRITICAL — 결과물은 파이프라인만 쓴다. `models.json`은 `results/`가 아니므로 4번 작업은 허용된다.
- `models.json`의 기존 값(가격·출시일·표시명 등)을 바꾸지 마라. 이유: 사람이 관리하는 레지스트리이고, 바뀌면 비용 계산·정렬이 달라진다.
- `GenerationRecordSchema`에 `repair`를 더하거나 `gen --repair`를 만들지 마라. 이유: 사용자가 필요해질 때 만들기로 했다(ADR-032).
- 문구를 다듬지 마라. 이유: COPY는 확정이다. 문구는 `docs/COPY.md` 그대로 옮긴다.
- 사이트(`site/`) 화면은 바꾸지 마라(다음 step). 단 core 타입이 바뀌어 site 타입 검사가 깨지면 최소한으로 맞춘다.
- 실제 모델 호출(`gen`·`smoke`), `npm run validate`·`judge`를 실행하지 마라. 이유: CLAUDE.md CRITICAL, results/ 변경.
- `docs/`를 고치지 마라. 달라진 점은 handoff에 남긴다.
