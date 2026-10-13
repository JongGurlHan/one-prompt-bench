# Step 3: mobile-readme

## 목표

휴대폰 화면(폭 < 768px)에서 네 탭을 모두 쓸 수 있고, 레포 루트에 `README.md`가 생긴다.

- 결과 탭: 모델 목록이 `<label>모델</label><select>`로 바뀌고, 범례 상자는 결과 아래로 간다. 설명 문구의 "왼쪽에서"가 "목록에서"로 바뀐다.
- 나머지 탭: 좁은 화면에서 페이지가 가로로 넘치지 않는다(표는 컨테이너 안에서만 가로 스크롤).

## 관련 파일

- `docs/UI_GUIDE.md` "결과 탭"의 휴대폰 항목, "공통 레이아웃"(좌우 여백 16px, 헤더 줄바꿈, 표 스크롤), "포커스"
- `docs/COPY.md` "결과 탭"의 설명(휴대폰에서 "목록에서"), `docs/ARCHITECTURE.md` "사이트"(결과 탭의 모델 전환·DOM 계약), `docs/ADR.md` ADR-009·ADR-018·ADR-025
- `site/src/pages/index.astro`, `site/src/scripts/results-tab.ts`, `site/src/lib/results-view.ts`, `site/src/lib/copy.ts`, 이전 step이 만든 `compare/`·`prompt/`·`intro/` 페이지
- 테스트: `site/test/results-tab-browser.test.ts`·`results-tab.test.ts`(DOM 계약 `[data-results-tab]`, `button[data-slug][aria-pressed]` 등을 유지한다), `site/test/support/`
- README 재료: `docs/PRD.md`, `docs/OPERATIONS.md`, `docs/ARCHITECTURE.md`의 "디렉토리 구조"·"명령어", 루트 `package.json`, 공개 주소 `https://jonggurlhan.github.io/one-prompt-bench/`

## 작업

테스트를 먼저 작성한다. 시그니처는 예시이고 재량이다. 바꾸면 handoff에 남긴다.

1. **결과 탭 휴대폰 선택기**
   - 데스크톱 목록(버튼들)과 휴대폰용 `<select>`를 모두 HTML에 두고 CSS 미디어 쿼리(`max-width: 767px`)로 전환한다(스크립트가 돌기 전에도 맞는 쪽이 보이게). 숨겨진 쪽은 접근성 트리와 탭 순서에서도 빠져야 한다(`display: none`).
   - `<label for>` "모델" + `<select>`. 옵션 글자는 `표시명 · 상태 라벨`(예: `GPT-6.1 Sol · 정상`)이고 `value`는 slug, 순서는 목록과 같다. 처음 선택된 옵션은 첫 선택 모델(ADR-025)과 같다.
   - 선택기를 바꾸면 버튼을 눌렀을 때와 **같은 전환 코드**(`results-tab.ts`의 `select`)를 지난다. 두 컨트롤의 선택 상태(버튼 `aria-pressed`, select 값)는 항상 같다. 이미 고른 모델을 다시 고르는 경우(같은 값)는 아무것도 하지 않는다. 라벨·포맷을 클라이언트에서 다시 계산하지 않는다(기존 `ResultView` JSON 그대로).
   - 범례 상자(`상태 표시`)는 휴대폰에서 결과(실행 카드·원문 카드·아래 카드 두 개) 아래로 간다. DOM을 두 벌 만들지 말고 CSS(`order`, `display: contents` 등)나 DOM 순서로 해결한다. 데스크톱 레이아웃은 바뀌지 않는다.
   - 설명 문구: 휴대폰에서는 "왼쪽에서"를 "목록에서"로 바꾼다. COPY의 두 문장을 그대로 `copy.ts`에 두고 CSS로 전환하거나 `<span>` 두 벌로 둔다. 화면 크기에 따라 보이는 쪽은 하나여야 한다(스크린리더가 둘 다 읽지 않게 숨기는 쪽은 `display: none`).
   - 실행 영역은 폭 100%를 유지한다(`aspect-ratio 16 / 10`). 새 창 래퍼(`/view/<slug>/`)는 건드리지 않는다.
2. **나머지 탭의 좁은 화면**: 본문 좌우 여백 16px, 헤더 부제·탭이 줄바꿈되고, 비교표·판정 기준표는 컨테이너 안에서만 가로로 스크롤, 프롬프트 탭의 두 열은 한 열로 쌓이고, 소개 탭 44px 제목은 휴대폰에서 줄바꿈 가능한 크기로 조정한다(UI_GUIDE의 수치는 기준값 — 바꾸면 handoff에 값과 이유를 남긴다). 긴 한 줄 코드(Mono)가 페이지를 넘치게 하지 않는다.
3. **테스트**
   - dist HTML: 결과 탭에 select가 있고 옵션 수 = 모델 수, 옵션 글자·순서, 설명 문구 두 가지가 COPY와 정확히 같다.
   - 브라우저(Playwright, 뷰포트 375×800): select가 보이고 모델 버튼 목록은 안 보인다 / 범례 상자가 결과 아래에 있다(bounding box의 y 비교). select로 모델 변경 → iframe이 바뀌고(실행 카운트는 기존 `runLog` 방식) 버튼 `aria-pressed`와 select 값이 일치, 결과물이 없는 모델을 고르면 이유가 보이고 버튼 두 개가 숨는다. 같은 값을 다시 고르면 다시 로드되지 않는다. 뷰포트 1280×800에서는 반대(목록 보임, select 안 보임).
   - 네 탭(`/`, `/compare/`, `/prompt/`, `/intro/`)을 375px에서 열었을 때 `document.documentElement.scrollWidth <= 375`(가로 넘침 없음)이고, 표 컨테이너는 `scrollWidth > clientWidth`로 컨테이너 안에서 스크롤된다. 외부 요청(Google Fonts 등)은 route로 막는다.
   - 기존 결과 탭 단위·브라우저 테스트가 그대로 통과한다(DOM 계약 유지).
4. **README.md** (레포 루트, 한국어, "~해요"체가 아니라 개발자용 문서체로): 프로젝트 한 문단(무엇을, 왜, "순위가 아니라 기록"), 공개 사이트 링크, 프롬프트 한 줄 소개와 `prompts/` 위치, 모델 수는 쓰지 말고 `models.json` 참고, 기술 스택, 디렉토리 구조 요약, 로컬 실행(`npm install` → `npx playwright install chromium` → `npm run dev`·`npm test`·`npm run build`), 설계 문서 안내(`docs/` 표), 운영(생성·판정·배포는 사람이 `docs/OPERATIONS.md`대로 — 모델 호출 명령은 구독 한도·요금을 쓰므로 자동화·CI에서 돌리지 않는다는 원칙), 비용 원칙(추가 결제 0원), 기록의 정직성(모델마다 1회, 사람이 결과물을 고치지 않음, `check:results`가 배포 게이트). 비밀값·API 키·계정 정보·로컬 절대 경로를 쓰지 않는다. `.env` 값은 읽지 않는다(`.env.example`의 변수 이름만 언급 가능).
   - README의 명령·경로가 실제와 맞는지 `package.json`·디렉토리와 대조한다. 테스트: README에 적힌 `npm run <script>`가 모두 루트 `package.json`의 scripts에 있는지 검사하는 작은 테스트(루트가 아니라 core나 site 테스트 한 곳에 — 위치는 재량)를 더한다. README에 `sk-`·`AIza` 같은 키 모양이 없는지도 확인한다.
5. handoff에 휴대폰에서 정한 수치와 README 구성을 적는다.

## 금지사항

- 결과 탭의 상태 라벨·포맷을 클라이언트에서 새로 계산하지 마라. 이유: `display.ts`가 단일 출처이고 기존 설계가 JSON으로 옮기는 방식이다.
- 모델 목록 DOM을 휴대폰용으로 한 벌 더 만들어 중복 데이터를 두지 마라(select의 옵션은 예외). 이유: 상태가 어긋난다.
- `iframe sandbox`를 바꾸거나 `allow-same-origin`을 넣지 마라. 이유: CLAUDE.md CRITICAL.
- 가로 스크롤을 숨기려고 표 열을 숨기지 마라. 이유: UI_GUIDE "열을 숨기지 않는다".
- README에 모델 수·점수·순위 표현을 쓰지 마라. 이유: 모델은 계속 추가되고 이 사이트는 순위가 아니라 기록이다.
- 실제 모델 호출, `npm run validate`·`judge` 실행 금지. 레포 `results/`에 쓰기 금지. `docs/` 수정 금지(달라진 점은 handoff).
