# Step 3: results-tab

## 목표

결과 탭(`/`)이 완성된다. 들어가는 것:

- 출시일 최신순 모델 목록(상태 배지)과 범례
- 고른 결과물 하나만 실행하는 실행 카드(다시 시작·새 창에서 열기)
- 결과물이 없을 때의 이유 문구와 응답 원문
- 요구사항 판정 카드와 생성 기록 카드

처음 열면 결과물이 있는 첫 모델이 선택돼 있다(ADR-025). 빌드한 HTML 검사와 브라우저 클릭 테스트가 이를 증명한다.

## 관련 파일

- `docs/UI_GUIDE.md` "디자인 원칙", "AI 슬롭 안티패턴", "토큰", "공통 레이아웃", "탭별 화면" → **결과 탭**
- `docs/COPY.md` "공통", **"결과 탭"**("결과물이 없을 때" 포함)
- `docs/DATA.md` "표시 규칙"
- `docs/ARCHITECTURE.md` "사이트"
- `docs/ADR.md` ADR-009, ADR-016, ADR-018, ADR-019, ADR-021, ADR-025
- `docs/design/Main.dc.html`: 시안(참고용, 단독으로 렌더링되지 않음). 수치는 UI_GUIDE가 기준이다.
- step 0 산출물: core `displayModel`·`statusOf`·`missingOutputReason`·`STATUS_LEGEND`·`fillCount`·`RESULT_IFRAME_SANDBOX`, `@opb/core/testing`
- step 2 산출물: site 레이아웃·데이터 모듈·`/r/<slug>/`·`/view/<slug>/`, site 테스트의 빌드 헬퍼. 실제 이름은 step 2 handoff를 확인한다.

## 작업

테스트를 먼저 작성한다.

1. `/` 페이지(UI_GUIDE "결과 탭"의 데스크톱 레이아웃):
   - **상단**: h1·설명·칩 3개(step 2에서 만든 것을 유지).
   - **두 열**(`flex-wrap`): 왼쪽은 모델 목록과 범례 상자, 오른쪽은 실행 카드, (원문 카드), 아래 카드 두 개다. 좁은 화면에서 두 열이 위아래로 쌓이는 것은 괜찮다.
   - **모델 목록**: 각 항목은 `<button type="button">`이다. 표시명, "회사 · 생성 도구", 출시일, 상태 배지를 보여 준다. 선택한 항목은 `aria-pressed="true"`, 나머지는 `false`다.
   - **범례 상자** "상태 표시": `STATUS_LEGEND`의 배지를 전부 둔다.
   - **실행 카드**:
     - 머리 줄에 표시명, COPY의 머리 문구, [다시 시작] [새 창에서 열기]를 둔다.
     - 실행 영역은 `aspect-ratio 16 / 10`, 바탕은 `--viewer-bg`다.
     - **결과물 iframe은 페이지 전체에 하나**다. sandbox는 `RESULT_IFRAME_SANDBOX`, src는 `BASE_URL` 기준 `r/<slug>/index.html`, title은 COPY `{표시명} 결과물`.
   - **결과물이 없는 모델**:
     - 실행 영역 가운데에 `missingOutputReason` 문구를 보여 주고, 두 버튼은 숨긴다.
     - 원문을 보여 주는 라벨이면 실행 카드 아래에 "응답 원문" 카드(`<pre>`)를 둔다. 그 모델을 고를 때 `fetch(BASE_URL + 'r/<slug>/response.txt')`로 불러온다. 빌드 HTML에는 원문을 넣지 않는다(첫 화면 용량).
     - 불러오기에 실패했을 때의 표시는 재량이다. COPY에 없는 문구를 썼다면 handoff에 남긴다.
   - **"요구사항 판정" 카드**: 장면·계절 순환·계절 모습·계절 이름과 메모. 메모가 없으면 그 줄을 생략한다.
   - **"생성 기록" 카드**: 결과·조건 검사·토큰 (입력 / 출력)·비용 (정가 기준)·걸린 시간.
   - 카드의 값은 전부 `displayModel` 결과를 쓴다.
   - **첫 선택**(ADR-025): 목록 순서에서 결과물이 있는 첫 모델, 없으면 맨 위 모델이다. 빌드 때 정해 HTML에 넣어서, 스크립트가 돌기 전에도 그 모델의 카드와 iframe이 보이게 한다.
2. 클라이언트 동작(Astro `<script>`의 순수 TS):
   - 모델 버튼을 누르면 aria-pressed, 머리 줄, 카드, iframe src(또는 이유 문구)가 바뀐다.
   - 결과물이 없는 모델을 고르면 이전 결과물이 계속 돌지 않게 iframe을 비우거나(about:blank) 없앤다.
   - "다시 시작"은 같은 src를 처음부터 다시 불러온다.
   - "새 창에서 열기"는 `/view/<slug>/`로 가는 링크(`target="_blank" rel="noopener"`)다.
   - 모델별 표시 값은 빌드 때 HTML(숨긴 패널이나 data 속성) 또는 JSON으로 넣는다. 클라이언트에서 라벨·포맷을 다시 계산하지 마라.
3. 스타일:
   - UI_GUIDE의 토큰과 컴포넌트 값을 따른다(배지·작은 버튼·카드·목록 버튼·점선 범례·둥글기).
   - 안티패턴 표에 있는 것(그림자, blur, 그라데이션 텍스트, 애니메이션, 이모지 등)은 쓰지 마라.
   - 키보드만으로 모델을 고를 수 있어야 하고, 포커스 링이 보여야 한다.
4. 테스트(`site/test/`, step 2의 빌드 헬퍼를 재사용):
   - **데이터**: `@opb/core/testing`으로 만든다. 모든 상태(정상·지시 미준수·위반·잘림·HTML 없음·거부·한도 초과·생성 실패·생성 전·검증 전)와 판정 있음/없음을 넣는다. 결과물이 하나도 없는 데이터 루트도 하나 둔다.
   - **dist 검사**:
     - 목록 순서가 sortByRelease이고, 모델마다 상태 라벨과 배지 계열이 맞다. 범례 라벨이 전부 있다.
     - 첫 선택 모델의 aria-pressed와 iframe src가 맞다. 결과물이 하나도 없으면 맨 위 모델이 선택되고 실행 중인 결과물이 없다.
     - iframe이 하나이고 sandbox 값이 정확히 `allow-scripts`다.
     - 이유 문구가 COPY 그대로다. 판정 기호·판정 전·—이 맞게 나온다.
     - 생성 기록 값이 `displayModel` 결과와 같다.
     - 원문 텍스트가 HTML에 없다. `{N}`이 치환됐다.
   - **브라우저 테스트**(playwright 라이브러리 + node:test):
     - dist를 임시 정적 서버(base 경로 포함)로 띄운다. 외부 요청(Google Fonts 등)은 route로 막는다.
     - 다른 모델 클릭 → aria-pressed·iframe src·카드 값이 바뀐다.
     - 결과물 없는 모델 클릭 → 이유 문구가 보이고 실행 중인 결과물이 없다. 원문 카드에 response.txt 내용이 나온다.
     - 다시 시작 → iframe이 다시 로드된다(load 이벤트가 다시 발생).
     - 키보드(Tab·Enter/Space)로 모델을 고를 수 있다.
   - `playwright`를 site devDependencies에 추가한다. 브라우저는 step 1에서 설치했다. 없으면 `npx playwright install chromium`.

## 금지사항

- 휴대폰 드롭다운(`<select>`)과 소개·비교표·프롬프트 페이지를 만들지 마라. 이유: phase 5 범위다(PRD 개발 순서, ADR-024).
- 모델별 딥링크(URL 해시·쿼리로 모델 선택), 정상 결과의 응답 원문 보기, 푸터를 만들지 마라. 이유: MVP 제외다(ADR-019).
- 결과물 iframe을 둘 이상 두거나 여러 결과물을 동시에 실행하지 마라. 이유: ADR-009.
- 스크린샷을 사이트에 보여 주지 마라. 이유: MVP 제외다(PRD).
- 라벨·포맷·문구를 site에서 다시 만들거나 바꾸지 마라. 이유: CLAUDE.md CRITICAL(display.ts 한 곳), COPY.md 확정 문구.
- 결과물 파일로 가는 직접 링크를 만들지 마라. 이유: CLAUDE.md CRITICAL, ADR-009.
- 테스트가 실제 네트워크에 닿게 하지 마라. 이유: CLAUDE.md CRITICAL.
