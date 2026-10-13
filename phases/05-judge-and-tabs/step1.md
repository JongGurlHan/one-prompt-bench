# Step 1: compare-tab

## 목표

사이트에 `/compare/`(비교표 탭)가 생기고 헤더에 "비교표" 탭이 보인다. 표 3개·안내 박스·각주 3개(†‡§)·범례가 `docs/COPY.md` 문구 그대로 나온다. 입력 토큰 칸의 § 표시(ADR-030)가 core `display.ts`에서 계산된다.

## 관련 파일

- `docs/UI_GUIDE.md` "비교표 탭", "표"(공통 레이아웃), "상태 배지", "안티패턴"; 시안 `docs/design/Compare.dc.html`(참고용)
- `docs/COPY.md` "비교표 탭"(각주 § 포함), "공통"; `docs/DATA.md` "표시 규칙"(특히 † ‡ § 줄과 "값 계산·포맷")
- `docs/ADR.md` ADR-024(헤더에는 페이지가 있는 탭만)·ADR-030
- `docs/ARCHITECTURE.md` "사이트", "테스트 전략"
- `packages/core/src/display.ts`(`ModelDisplay`·`displayModel`·`STATUS_LEGEND`·`MARK_LABEL`), `packages/core/test/display.test.ts`
- 본보기: `site/src/pages/index.astro`(카드·배지·토큰 사용), `site/src/components/StatusBadge.astro`·`SiteHeader.astro`, `site/src/lib/tabs.ts`·`copy.ts`·`paths.ts`, `site/src/layouts/SiteLayout.astro`
- 테스트 본보기와 데이터: `site/test/results-tab.test.ts`(dist HTML 검사), `site/test/support/{build,html,results-data}.ts`, `@opb/core/testing`의 `STATUS_CASES`(상태 라벨 10개 전부를 가진 데이터)

## 작업

테스트를 먼저 작성한다. 시그니처는 예시이고 재량이다. 바꾸면 handoff에 남긴다.

1. **core**: `ModelDisplay`에 `inputTokensMark: '' | '§'`를 더한다. 생성 도구가 Claude Code 또는 Codex CLI인 행이면 `'§'`(값이 —여도 붙는다), Gemini API는 `''`. `outputTokensMark`처럼 `displayModel` 안에서 도구(`GENERATOR_BY_PROVIDER`)로 계산한다. `display.test.ts`에 세 도구 각각의 기대값을 더한다. 결과 탭의 `resultView`가 이 필드를 화면에 쓰지 않는지 확인한다(결과 탭 토큰 값에는 붙이지 않는다).
2. **헤더 탭** (`site/src/lib/tabs.ts`): 비교표 탭(`id: 'compare'`, `path: 'compare/'`)을 더한다. 순서는 COPY 순서(소개 · 결과 · 비교표 · 프롬프트)를 지키되 지금 페이지가 있는 것만 둔다 → 결과, 비교표. `TabId`가 `SiteLayout`·`SiteHeader`에서 그대로 쓰이는지 확인한다. 소개·프롬프트는 step 2가 더한다.
3. **문구** (`site/src/lib/copy.ts`): 비교표 탭 문구(제목·설명·표 제목 3개·열 이름·안내 박스·각주 3개·범례·링크 "판정 기준 보기")를 COPY.md 그대로 상수로 둔다. 각주 §의 "(추가, ADR-030)"는 문구가 아니라 출처 표시이므로 화면에 쓰지 않는다. 열 이름은 표마다 COPY의 표기("비용 (정가 기준)" 등)를 그대로 쓴다.
4. **페이지** (`site/src/pages/compare/index.astro`, `<title>`은 `비교표 — One Prompt Bench`):
   - 데이터는 `loadSiteData()`의 `display`만 쓴다. 상태 라벨·포맷·판정 기호·정렬을 다시 계산하지 않는다(`models`는 이미 출시일 최신순).
   - 표 1 "수록 모델": 모델 · 회사 · 출시일 · 생성 도구 · 결과(배지, `StatusBadge`) · 파일 크기 · three.js 버전.
   - 표 2 "생성 기록": 표 위에 안내 박스(비용 안내 문구), 열 모델 · 입력 토큰(+§) · 출력 토큰(+†) · 그중 추론(+‡) · 비용 (정가 기준) · 걸린 시간 · 재시도. 표 아래 각주 3줄(†‡§ 순서, 기호는 `--footnote-mark` 색의 위첨자).
   - 표 3 "요구사항과 검증": 모델 · 장면 · 계절 순환 · 계절 모습 · 계절 이름 · 조건 검사 · 에러 수. 판정 칸은 `requirements[i].text`(✓ 충족 등). 표 아래 범례 줄과 링크 "판정 기준 보기"(`/prompt/#judge`, `withBase`로 만든다 — 대상 페이지는 step 2가 만든다. 이 step의 테스트는 href 문자열만 검사한다).
   - 표 컨테이너·th·td·숫자 칸 스타일은 UI_GUIDE "표"대로(Astro scoped CSS + 토큰 변수). 모델명 칸은 600·nowrap, 숫자는 Mono 13px, 표 `min-width 760px`, 컨테이너 `overflow-x: auto`. 열을 숨기지 않는다. 그림자·그라데이션·이모지 없음.
   - 각 표는 `<table>`에 `aria-label`(또는 `<caption>`) 대신 보이는 `h2`와 `aria-labelledby`를 쓴다. 표 컨테이너가 키보드로 스크롤되도록 `tabindex="0"`과 `role="region"`·`aria-labelledby`를 준다.
   - 모델 이름 셀 등에 모델별 주소(딥링크)를 만들지 마라(ADR-019).
   - 데이터가 없을 때(모델 0개) 페이지가 깨지지 않는다.
5. **테스트** (dist HTML 검사, 필요하면 브라우저 없이): 빌드 헬퍼로 `STATUS_CASES` 데이터를 빌드해서
   - `/compare/`에 표 3개, 행 수 = 모델 수, 행 순서 = 출시일 최신순, 상태 배지 라벨 10개 전부, 에러 수·파일 크기·three.js 버전이 `display` 값과 같다.
   - 각주 3개의 문구가 COPY와 정확히 같고, §는 Claude Code·Codex 행의 입력 토큰에만, †는 Codex 행의 출력 토큰에만, ‡는 Google 행의 그중 추론에만 있다(생성 전·api_failed 행도 기호는 유지).
   - 안내 박스 문구, "판정 기준 보기" 링크 href가 `…/prompt/#judge`(base 포함), 헤더에 탭 2개(결과·비교표)와 현재 탭 `aria-current="page"`, 결과 탭(`/`)에도 비교표 링크가 생겼고 기존 결과 탭 테스트가 그대로 통과한다.
   - `<title>`, 숫자(모델 수 등)가 하드코딩되지 않았다는 확인(모델 수를 바꾼 두 데이터로 빌드해도 문구가 같음)은 필요한 곳에만.
   - 결과물 파일을 직접 링크하지 않는다(`/r/` 주소 없음).
6. handoff에 새로 생긴 DOM 계약(테스트가 쓰는 data 속성)과 UI_GUIDE와 다르게 정한 수치를 적는다.

## 금지사항

- 상태 라벨·판정 기호·포맷 규칙을 페이지나 컴포넌트에서 다시 쓰지 마라. 이유: CLAUDE.md CRITICAL — `display.ts` 한 곳이 단일 출처다.
- 점수 합계·순위·강조 표시(최고값 색칠 등)를 넣지 마라. 이유: "순위가 아니라 기록"(UI_GUIDE 안티패턴).
- COPY 문구를 다듬거나 모델 수·토큰 수를 새로 하드코딩하지 마라(각주 §의 600·7,000은 COPY 문구 그대로만). 이유: 문구는 확정이다.
- `results/`를 읽는 테스트 데이터를 레포의 `results/`로 만들지 마라(`OPB_DATA_ROOT`와 OS 임시 디렉토리 사용). 이유: CLAUDE.md CRITICAL.
- `iframe`을 이 탭에 넣지 마라. 이유: 결과물 실행은 결과 탭과 `/view/`에서만 한다(ADR-009).
- 실제 모델 호출, `npm run validate`·`judge` 실행 금지. `docs/` 수정 금지(달라진 점은 handoff).
