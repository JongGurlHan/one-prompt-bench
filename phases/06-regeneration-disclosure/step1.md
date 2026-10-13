# Step 1: regeneration-disclosure

## 목표

다시 생성한 사실과 이유가 사이트에 보인다(ADR-032).

- 결과 탭: 버린 결과물이 있는 모델을 고르면 실행 카드 위에 안내 박스가 보이고, 없는 모델을 고르면 사라진다(첫 화면 HTML·모델 전환·휴대폰 선택기 모두).
- 비교표 표 1: "결과" 다음에 "생성 횟수" 열(`1회`, `3회 ¶`)과 표 아래 각주 ¶.
- 바뀐 확정 문구: 칩 "모델당 1회 생성(빈 화면은 다시)"(결과·소개 탭), 프롬프트 탭 생성 조건 "횟수" 값, 소개 탭 How·Caution 본문.

## 관련 파일

- `docs/COPY.md` 결과 탭(칩)·**"다시 생성하거나 고친 결과물"**, 비교표 탭 표 1(생성 횟수·각주 ¶), 프롬프트 탭 "횟수", 소개 탭(칩·How·Caution). 소개 탭 수록 기준의 "(추가, ADR-032 — 실제로 제외되는 모델이 생기면 구현)" 줄과 수정본 문구는 이 step에서 쓰지 않는다
- `docs/UI_GUIDE.md` 결과 탭 "재생성 안내 박스", 비교표 탭 표 1, 각주 기호, 휴대폰
- `docs/DATA.md` "표시 규칙"의 "생성 횟수"·"재생성 안내", `docs/ADR.md` ADR-032
- step 0 산출물: `ModelDisplay`의 `generationCount`·`generationCountMark`·`regeneration`, 테스트 빌더의 `discarded` 지원 (실제 이름은 step 0 handoff 확인)
- 코드: `site/src/pages/index.astro`·`site/src/scripts/results-tab.ts`·`site/src/lib/results-view.ts`(`ResultView` JSON으로 클라이언트에 넘기는 방식), `site/src/pages/compare/index.astro`(표 1·각주 구조), `site/src/lib/copy.ts`, `site/src/pages/intro/index.astro`·`prompt/index.astro`
- 테스트: `site/test/results-tab.test.ts`·`results-tab-browser.test.ts`·`compare-tab.test.ts`·`prompt-intro-tabs.test.ts`·`narrow-screen-browser.test.ts`, `site/test/support/results-data.ts`

## 작업

테스트를 먼저 작성한다. 시그니처는 예시이고 재량이다. 바꾸면 handoff에 남긴다.

1. **결과 탭 안내 박스**
   - `ResultView`에 `regeneration`(core `ModelDisplay.regeneration` 그대로 — `{ title, lines } | null`)을 더해 기존 JSON(`#result-views`)으로 넘긴다. 클라이언트에서 문구를 다시 만들지 않는다.
   - 마크업: 실행 카드 바로 위에 안내 박스 하나(`[data-field=regeneration]`, 첫 줄 + 줄 목록). 첫 선택 모델이 다시 생성한 모델이면 빌드 HTML에 내용이 들어 있고, 아니면 숨겨져 있다(`hidden`). 모델 전환(버튼·휴대폰 선택기 모두 같은 `select()` 경로) 때 내용과 숨김을 바꾼다. 커밋 해시 부분은 Mono로 보이게 해도 되지만 글자는 COPY 그대로다.
   - 스타일은 UI_GUIDE "재생성 안내 박스"(안내 박스 토큰, 경고색 없음). 휴대폰에서도 넘치지 않는다.
2. **비교표 표 1**: "결과" 다음에 "생성 횟수" 열(`generationCount`, Mono 13px, ¶는 기존 각주 기호처럼 `<sup>`). 표 아래 각주 한 줄 ¶(COPY 그대로, 기존 각주 스타일). 열 키는 `data-col=generationCount`(기존 DOM 계약 방식).
3. **바뀐 확정 문구** (`copy.ts`, COPY 그대로): 결과 탭·소개 탭 칩의 세 번째 = `모델당 1회 생성(빈 화면은 다시)`, 프롬프트 탭 "횟수" 값, 소개 탭 How·Caution 본문(가운데 문장 추가). 기존 테스트의 기대 문구도 COPY 기준으로 고친다.
4. **테스트** (`STATUS_CASES` 등 기존 데이터에 `discarded`가 있는 모델 두 종류 — 커밋 있는 `blank_screen` 2개(3회), 커밋 null인 `continued_output` 1개(2회) — 를 더하거나 별도 데이터 루트를 만든다)
   - dist HTML: 첫 선택 모델이 다시 생성한 모델일 때와 아닐 때 안내 박스 내용·`hidden`, `#result-views` JSON의 `regeneration`이 `displayModel` 값과 같다. 비교표 "생성 횟수" 열 값·¶ 위치(버린 결과물이 있는 행만)·각주 문구, 바뀐 칩·생성 조건·How·Caution 문구가 COPY와 정확히 같다.
   - 브라우저: 버튼으로 다시 생성한 모델 ↔ 아닌 모델을 오가면 안내 박스가 보였다 숨는다. 휴대폰(375px) 선택기로도 같다. 375px에서 가로 넘침 없음(기존 narrow-screen 테스트가 안내 박스가 있는 상태도 보게).
   - 기존 결과 탭·비교표·프롬프트·소개 탭 테스트가 그대로 통과한다(DOM 계약 유지).
5. handoff에 새 DOM 계약(`[data-field=regeneration]`, `data-col=generationCount`, 각주 ¶)과 UI_GUIDE와 다르게 정한 수치를 적는다.

## 금지사항

- 문구를 클라이언트나 페이지에서 새로 조합하지 마라. 이유: CLAUDE.md CRITICAL — 표시 규칙은 `display.ts` 한 곳.
- COPY 문구를 다듬거나 수정본·수록 제외 문구를 미리 넣지 마라. 이유: 확정 문구이고, 수정 요청·제외는 아직 구현하지 않기로 했다(ADR-032).
- 안내 박스에 경고색(빨강·노랑)·아이콘·애니메이션을 쓰지 마라. 이유: 잘못이 아니라 기록 공개다(UI_GUIDE).
- 버린 결과물(git 커밋)을 사이트에서 실행하거나 링크하지 마라. 이유: 결과물은 샌드박스 iframe 안에서만, 공개 결과물만 실행한다(ADR-009). 커밋 해시는 글자로만 보인다.
- `results/`·`models.json`·`prompts/`를 고치지 마라. 이유: CLAUDE.md CRITICAL, 데이터는 step 0에서 끝났다.
- 실제 모델 호출, `npm run validate`·`judge` 실행 금지. `docs/` 수정 금지(달라진 점은 handoff).
