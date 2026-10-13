# Step 2: prompt-intro-tabs

## 목표

사이트에 `/prompt/`(프롬프트 탭)와 `/intro/`(소개 탭)가 생긴다. 헤더 탭은 COPY 순서 그대로 소개 · 결과 · 비교표 · 프롬프트 4개가 되고, 첫 화면은 여전히 결과 탭(`/`)이다. 비교표의 "판정 기준 보기" 링크(`/prompt/#judge`)가 실제 앵커로 이어진다.

## 관련 파일

- `docs/UI_GUIDE.md` "프롬프트 탭", "소개 탭", "타이포그래피"(44px 제목 등), "버튼"·"칩"·"카드"; 시안 `docs/design/Prompt.dc.html`·`Intro.dc.html`(참고용)
- `docs/COPY.md` "프롬프트 탭", "소개 탭", "공통"; `docs/ARCHITECTURE.md` "프롬프트 읽기", "사이트"; `docs/ADR.md` ADR-005·ADR-007·ADR-024·ADR-030
- step 0 산출물: `packages/core/src/judging.ts`(`loadJudgingCriteria`·`JudgingCriteria`) — 판정 기준표는 이것으로 읽는다
- step 1 산출물: `site/src/lib/tabs.ts`, `copy.ts`의 비교표 문구와 페이지 구조(같은 방식으로 만든다)
- 데이터: `packages/core/src/prompt.ts`(`loadPrompt`·`CURRENT_PROMPT`), `packages/core/src/adapter.ts`의 `DEFAULT_MAX_OUTPUT_TOKENS`, `display.ts`의 `GENERATOR_LABEL`·`MARK_LABEL`·`fillCount`, `prompts/season-tree-v1.md`·`.system.md`·`.judging.md`
- 본보기: `site/src/scripts/results-tab.ts`(클라이언트 스크립트 방식), `site/test/results-tab-browser.test.ts`(Playwright로 dist 확인)

## 작업

테스트를 먼저 작성한다. 시그니처는 예시이고 재량이다. 바꾸면 handoff에 남긴다.

1. **헤더 탭** (`tabs.ts`): 소개(`path: 'intro/'`)와 프롬프트(`path: 'prompt/'`)를 더해 순서를 소개 · 결과 · 비교표 · 프롬프트로 한다. 결과 탭의 주소는 그대로 `/`.
2. **데이터 읽기**: 프롬프트 탭이 쓰는 값(원문 user, system, 판정 기준표)은 빌드 때 `loadPrompt`·`loadJudgingCriteria`로 읽는다(`site/src/lib/data.ts`에 함께 둔다. `DATA_ROOT` 기준, `OPB_DATA_ROOT`를 쓰는 테스트에서는 그 폴더의 `prompts/`를 읽는다 — 테스트 데이터 루트 빌더가 `prompts/`를 만들지 않는다면 빌더에 복사 옵션을 더하거나 테스트에서 직접 파일을 만든다. 레포의 `prompts/`를 고치지 않는다).
3. **프롬프트 본문 렌더링** (`site/src/lib/prompt-body.ts` 같은 작은 순수 함수): `prompts/season-tree-v1.md`를 블록으로 나눈다 — 빈 줄로 나뉜 문단, `- `로 시작하는 줄들은 목록(`ul`). 문단 안의 줄바꿈은 `<br>`로 살린다. 그 밖 마크다운 문법(굵게·코드·링크 등)은 해석하지 않고 글자 그대로 쓴다(본문에 ` ```html ` 같은 글자가 문장 속에 있으므로 마크다운 라이브러리를 쓰지 않는다 — 새 의존성도 더하지 않는다). 모든 텍스트는 이스케이프한다. 테스트: 실제 프롬프트 파일을 렌더링해서 문단 3개·목록 1개(항목 4개)가 나오고, 텍스트를 이어 붙이면 원문의 글자와 일치한다(목록 표시 `- `와 줄바꿈 제외).
4. **프롬프트 탭** (`site/src/pages/prompt/index.astro`, `<title>` `프롬프트 — One Prompt Bench`): COPY "프롬프트 탭" 문구 그대로.
   - 두 열(`flex-wrap`): 왼쪽 원문 카드 — 머리에 칩 `season-tree-v1`과 [복사] 버튼, 본문은 위 렌더링. 오른쪽 "생성 조건" 카드 — 라벨/값 행 6개(횟수 · 추론 강도 · 출력 상한 · 생성 도구 · 재시도 · 시스템 프롬프트), `--divider-soft` 구분선. 출력 상한의 숫자는 `DEFAULT_MAX_OUTPUT_TOKENS`(쉼표 포맷)에서, 생성 도구는 `GENERATOR_LABEL`에서, 시스템 프롬프트는 `.system.md` 내용에서 읽는다(끝 줄바꿈은 화면에서만 지우고 큰따옴표로 감싼다). 나머지는 COPY 문구 그대로.
   - 아래 "판정 기준" 섹션(`id="judge"`): 제목, COPY 설명, `JudgingCriteria.rows`로 만든 표(열 요구사항 · ✓ 충족 · △ 부분 충족 · ✗ 미충족 — 열 이름 기호·문구는 `MARK_LABEL`에서). 표 컨테이너 스타일은 step 1의 표와 같은 방식. `JudgingCriteria.intro`(표 위 문단)는 화면에 쓰지 않는다(COPY의 설명이 대신한다).
   - **복사 버튼** (`site/src/scripts/prompt-copy.ts`, 순수 TypeScript): 클립보드에 프롬프트 파일 **원문 그대로**(끝 줄바꿈 포함, 렌더링한 텍스트가 아니라 `loadPrompt().user`)를 쓴다. 성공하면 버튼 글자를 "복사됨"으로 바꾸고 2초 뒤 "복사"로 되돌린다. `navigator.clipboard`가 없거나 거절되면 글자를 바꾸지 않는다(거짓 성공 금지). 원문은 `<script type="application/json">`(`<`는 이스케이프, 결과 탭의 `scriptJson` 방식)이나 버튼의 data 속성으로 넘기고, 클라이언트에서 다시 계산하지 않는다. 버튼은 `<button type="button">`, 포커스 링 포함.
5. **소개 탭** (`site/src/pages/intro/index.astro`, `<title>` `소개 — One Prompt Bench`): COPY "소개 탭" 문구 그대로.
   - 히어로: 작은 라벨 "AI 모델 결과물 비교", 44px 제목, 제목 아래 문장, 버튼 3개(주 버튼 "결과 보러 가기"→`/`, 보조 "비교표 보기"→`/compare/`, "프롬프트 전문"→`/prompt/`; `withBase`), 칩 3개(`모델 {N}개`는 `fillCount`로 채움).
   - 카드 3개(`grid auto-fit minmax(280px, 1fr)`): What/How/Caution 작은 라벨(Mono, `--accent`) + h2 + 본문. 본문의 `{N}`은 `fillCount`로 채운다.
   - 수록 기준: 제목, 문단, "대상에서 뺀 모델" 목록(모델명 / 사유 2개).
   - 모델 수는 `models.json`에서 오는 값만 쓴다. 숫자를 하드코딩하지 않는다.
6. **문구** (`copy.ts`): 두 탭의 문구를 COPY.md 그대로 상수로 둔다. meta description은 지금처럼 `SITE_DESCRIPTION` 하나를 쓴다.
7. **테스트**
   - dist HTML: 네 탭의 `<title>`, 헤더 탭 4개의 순서·링크·현재 탭 표시(`aria-current`), 결과 탭(`/`)이 여전히 첫 화면, 프롬프트 탭의 생성 조건 행 6개 값(출력 상한 `65,536`, 시스템 프롬프트 `"사용자의 요청에 답하세요."`), 판정 기준표 4행·열 이름, `id="judge"` 앵커 존재, 소개 탭의 `{N}`이 남지 않고 모델 수로 치환됨(모델 수가 다른 두 데이터로 빌드해 비교), 버튼 3개의 href(base 포함), 제외 모델 2개.
   - 브라우저(Playwright, step의 기존 브라우저 테스트 방식 — 클립보드는 `context.grantPermissions(['clipboard-read','clipboard-write'])`): 복사 클릭 → 클립보드 내용이 프롬프트 파일 원문과 바이트 단위로 같고(끝 줄바꿈 포함) 버튼이 "복사됨"이 됐다가 2초 뒤 "복사"로 돌아온다(시간 대기를 줄이려면 복원 지연을 스크립트에서 주입 가능하게 하거나 Playwright 시계 제어를 쓴다). 클립보드가 막힌 컨텍스트에서는 글자가 안 바뀐다.
   - 비교표 탭의 "판정 기준 보기" 링크가 `/prompt/#judge`로 이동하고 그 앵커 요소가 존재한다(링크 대상 검사).
8. handoff에 새 DOM 계약과 UI_GUIDE와 달라진 수치, `OPB_DATA_ROOT` 테스트에서 `prompts/`를 다루는 방식을 적는다.

## 금지사항

- COPY 문구를 바꾸거나 판정 기준 표의 내용을 사이트 코드에 다시 쓰지 마라. 이유: 문구는 확정이고, 표는 `prompts/season-tree-v1.judging.md`가 단일 출처다.
- 마크다운 라이브러리·클립보드 라이브러리 등 새 의존성을 설치하지 마라. 이유: 외부 의존성은 최소(철학 3), 본문이 단순하다.
- 프롬프트 원문(`prompts/*.md`)을 고치거나 복사본을 사이트 소스에 두지 마라. 이유: 보낸 프롬프트와 sha256이 어긋난다(ADR-005). 읽기는 빌드 때 `loadPrompt`로만.
- 소개 탭에 점수·순위·"1위"·트로피, 숫자 카운트업·스크롤 애니메이션을 넣지 마라. 이유: UI_GUIDE 안티패턴.
- 클립보드 실패를 성공처럼 표시하지 마라. 이유: 거짓 상태 표시.
- 실제 모델 호출, `npm run validate`·`judge` 실행 금지. 레포 `results/`에 쓰기 금지. `docs/` 수정 금지(달라진 점은 handoff).
