# Step 2: site-setup

## 목표

`site/` Astro 워크스페이스가 연결되어 `npm run build`가 `site/dist/`에 정적 사이트를 만들고, 결과물을 안전하게 실행할 바탕이 갖춰진다.

- 빌드는 core `loadResults`로 데이터를 읽는다. 기본 데이터 위치는 레포 루트이고, 테스트에서는 `OPB_DATA_ROOT`로 바꾼다.
- `dist/r/<slug>/index.html`·`response.txt`가 원본과 바이트까지 같다.
- 결과물이 있는 모델마다 `/view/<slug>/` 래퍼(화면 가득 찬 샌드박스 iframe)가 생긴다.
- 공통 레이아웃(헤더·토큰·폰트)이 있고, 헤더에는 페이지가 있는 탭만 있다. 이번 phase에서는 "결과" 하나다.
- 임시 데이터로 빌드한 dist를 검사하는 테스트가 위를 증명한다.
- 결과 탭의 목록·실행 카드는 step 3 범위다.

## 관련 파일

- `docs/ARCHITECTURE.md` "사이트", "디렉토리 구조", "명령어", "테스트 전략", "버전 참고"
- `docs/UI_GUIDE.md` "디자인 원칙", "AI 슬롭 안티패턴", "토큰", "공통 레이아웃"(헤더·포커스), "탭별 화면" → 결과 탭 상단, "새 창 래퍼"
- `docs/COPY.md` "공통", "결과 탭"(제목·설명·칩), "소개 탭"의 제목 아래 문장(meta description)
- `docs/DATA.md` "사이트 빌드의 데이터 검사"
- `docs/ADR.md` ADR-002, ADR-009, ADR-018, ADR-024
- step 0 산출물: core `loadResults`·`displayModel`·`fillCount`·`RESULT_IFRAME_SANDBOX`, `@opb/core/testing`
- 루트 `package.json`, `eslint.config.js`, `tsconfig.base.json`, `.gitignore`(`site/.astro/`·`site/public/r/` 항목이 이미 있다)

## 작업

테스트를 먼저 작성한다.

1. 워크스페이스: `site/package.json`(`@opb/site`, `"type": "module"`)을 만든다.
   - 의존성은 `astro`와 `@opb/core`, devDependencies는 `@astrojs/check`다. typescript는 루트 것을 쓴다.
   - 계획 때 확인한 최신값: astro 7.3.8(Node ≥ 22.12), @astrojs/check 0.9.10(typescript peer `^5 || ^6`).
   - 루트 `package.json`:
     - `workspaces`에 `site`를 추가한다.
     - `"build"`·`"dev"`는 site 스크립트로 넘긴다.
     - `engines.node`를 Astro 요구에 맞춘다(`>=22.12`).
   - site 스크립트: `typecheck` = `astro check`, `test` = `tsx --test …`, `build`, `dev`.
   - ESLint: `site/**/*.ts`를 대상에 추가하고 `site/.astro/`·`site/dist/`는 무시한다. `.astro` 파일 린트(eslint-plugin-astro)는 필수가 아니다. 타입은 astro check가 본다.
   - `@opb/core`는 TS 소스를 직접 export한다. 이것이 Astro(Vite) 빌드와 astro check에서 해석되는지 확인하고, 해결이 필요했다면 방법을 handoff에 남긴다.
2. `astro.config.mjs`:
   - `output: 'static'`. `site`·`base`는 `SITE_URL`·`SITE_BASE` 환경변수에서 읽고, 없으면 base는 `/`다.
   - 모든 내부 링크와 에셋은 `import.meta.env.BASE_URL` 기준으로 만든다.
3. 데이터: `site/src/lib/` 한 곳에서 데이터 루트(`OPB_DATA_ROOT` ?? 레포 루트)를 정하고, 빌드마다 `loadResults`를 한 번 부른다. 표시 값은 core `display.ts`만 쓴다.
4. 결과물 사본: 결과물이 있는 모델의 `results/<slug>/index.html`과 원문이 있는 모델의 `response.txt`를 `dist/r/<slug>/`에 바이트 그대로 낸다.
   - 방법(정적 endpoint, 통합 훅 등)은 재량이다. 다만 `npm run dev`에서도 같은 주소로 열려야 한다. phase 뒤에 사람이 결과 탭을 로컬에서 확인한다.
   - 레포의 `site/public/`에 복사해 두는 방식을 고르면, 빌드할 때마다 그때의 데이터 루트 기준으로 다시 만들어야 한다. 이전 데이터가 남으면 안 된다.
   - 스크린샷(.jpg)·meta.json·judgment.json은 dist에 넣지 않는다.
5. 레이아웃(`site/src/layouts/`·`components/`):
   - `<html lang="ko">`, `<title>`(COPY "공통": 결과 탭은 `One Prompt Bench`), meta description·og:description(COPY 소개 탭의 "제목 아래 문장")
   - Google Fonts: IBM Plex Sans KR(400·500·600)·IBM Plex Mono(400·500), `display=swap`
   - `:root` 토큰: UI_GUIDE "토큰"의 색 변수 전부(배지 색 포함)
   - 바탕·본문 글꼴과 포커스 링
   - 헤더: 사이트 이름·부제·탭. 탭 목록은 한 곳에 두고 페이지가 있는 탭만 넣는다(ADR-024). 지금은 "결과" 하나이고 현재 탭에 `aria-current="page"`.
   - 스타일은 scoped CSS + CSS 변수로 한다.
6. 페이지:
   - `/`(index): 레이아웃과 결과 탭의 제목·설명·칩까지만 만든다(COPY "결과 탭", `{N}`은 `fillCount`, `season-tree-v1`은 core `CURRENT_PROMPT`에서). 목록·실행 카드는 step 3이 만든다.
   - `/view/<slug>/`: 결과물이 있는 모델만 만든다(UI_GUIDE "새 창 래퍼").
     - 화면 전체를 iframe 하나로 채우고 다른 UI는 두지 않는다.
     - iframe의 `sandbox`는 `RESULT_IFRAME_SANDBOX`, `src`는 `BASE_URL` 기준 `r/<slug>/index.html`, title은 COPY `{표시명} 결과물`.
     - `<title>`은 `<표시명> — One Prompt Bench`.
7. 테스트(`site/test/`):
   - **데이터와 빌드**: `@opb/core/testing`으로 OS 임시 디렉토리에 데이터 루트를 만들고, `OPB_DATA_ROOT`와 `SITE_BASE=/opb-test/`로 빌드한다. 출력도 임시 디렉토리에 둔다.
   - **빌드 헬퍼**: 빌드 헬퍼(예: `site/test/support/`)를 step 3이 다시 쓸 수 있게 만든다.
   - **빌드 횟수와 동시성**: 빌드는 데이터 루트마다 한 번만 하고 결과를 공유한다. 테스트 파일 여러 개가 같은 site 폴더에서 Astro 빌드를 동시에 돌리면 `.astro`·Vite 캐시가 충돌할 수 있다. 빌드가 동시에 돌지 않게 하고, 고른 방법을 handoff에 남긴다.
   - 검사:
     - `dist/r/<slug>/index.html`·`response.txt`의 sha256이 원본과 같다. 결과물 없는 모델은 index.html이 없다.
     - dist 어디에도 `.jpg`·`meta.json`·`judgment.json`이 없다.
     - dist의 모든 HTML에서 `<iframe>`의 sandbox 값이 정확히 `allow-scripts`이고, 문자열 `allow-same-origin`이 없다.
     - `/view/<slug>/`는 결과물 있는 모델에만 생기고, title과 iframe src(base 포함)가 맞다.
     - 헤더 탭이 "결과" 하나이고 `aria-current="page"`가 있다. 내부 링크가 `/opb-test/`로 시작한다.
     - `<html lang="ko">`, title, meta description이 있다. 칩의 `{N}`이 모델 수로 바뀌고 문자열 `{N}`이 남지 않는다.
     - 결과가 하나도 없는 데이터 루트로도 빌드가 성공한다.
     - 스키마를 통과하지 못한 meta.json이 있으면 빌드가 실패한다.

## 금지사항

- React·Vue 같은 UI 프레임워크 통합과 Tailwind를 들이지 마라. 이유: ADR-018.
- 결과물 파일로 가는 직접 링크(`<a href=".../r/<slug>/index.html">`)를 만들지 마라. 새 창은 `/view/<slug>/`다. 이유: CLAUDE.md CRITICAL, ADR-009.
- iframe sandbox에 `allow-same-origin`이나 다른 토큰을 넣지 마라. 값은 core 상수만 쓴다. 이유: CLAUDE.md CRITICAL.
- 문구를 바꾸거나 숫자(모델 수)를 하드코딩하지 마라. 이유: COPY.md는 확정 문구이고, 모델 수는 `{N}` 규칙을 따른다.
- 상태 라벨·포맷을 site에서 다시 만들지 마라. 이유: CLAUDE.md CRITICAL(display.ts 한 곳).
- 테스트가 레포의 `results/`나 `site/dist/`에 의존하거나 그곳에 쓰게 하지 마라. 이유: 결과가 실제 데이터에 따라 달라지고, CLAUDE.md CRITICAL이다.
- 소개·비교표·프롬프트 페이지와 그 탭 링크를 만들지 마라. 이유: phase 5 범위다(ADR-024).
- 휴대폰 드롭다운을 만들지 마라. 이유: phase 5 범위다(PRD 개발 순서).
- 배포 워크플로(`.github/workflows/`)를 만들지 마라. 이유: phase 3 범위다.
