# Step 0: public-deploy

## 목표

사이트를 처음 공개 배포할 준비가 끝난다.

- 결과 탭 "생성 기록" 카드에 "에러 수" 행이 보인다(ADR-026). 모델을 바꾸면 값도 바뀐다.
- `.github/workflows/deploy.yml`이 있다. main push와 수동 실행에서 lint·typecheck·test·check:results·build를 모두 통과해야만 GitHub Pages로 배포한다.
- 워크플로 파일을 파싱하는 테스트가 순서·트리거·권한·액션 버전과 금지 사항(비밀값·실제 호출 명령 없음)을 증명한다.

워크플로를 실제로 돌리는 것(push, Pages 설정)은 phase 뒤에 사람이 한다. 이 step은 파일과 테스트만 만든다.

## 관련 파일

- `docs/ADR.md` ADR-017(배포), ADR-026(에러 수)
- `docs/ARCHITECTURE.md` "배포", "사이트"(결과 탭의 모델 전환, DOM 계약), "버전 참고"(GitHub Actions 메이저 버전)
- `docs/COPY.md` "결과 탭" → 카드 "생성 기록"(행 순서), `docs/UI_GUIDE.md` "탭별 화면" → 결과 탭 "생성 기록"
- `docs/DATA.md` "값 계산·포맷" → 에러 수
- `site/src/lib/copy.ts`(`RECORD_CARD`), `site/src/lib/results-view.ts`(`ResultView.record`, `RECORD_KEYS`), `site/src/pages/index.astro`, `site/src/scripts/results-tab.ts`
- `site/test/results-tab.test.ts`, `site/test/results-tab-browser.test.ts`, `site/test/support/results-data.ts`
- `site/astro.config.mjs`(`SITE_URL`·`SITE_BASE` 읽기, base 정규화)
- 루트 `package.json`(scripts), `site/package.json`

## 작업

테스트를 먼저 작성한다.

1. 결과 탭 "에러 수" 행:
   - `RECORD_CARD.rows`에 COPY 순서대로(결과 · 조건 검사 · **에러 수** · 토큰 · 비용 · 걸린 시간) 행을 넣는다. 값은 core `displayModel`의 `errorCount`를 그대로 쓴다. 라벨·포맷을 site에서 다시 계산하지 않는다.
   - 첫 선택 모델은 빌드 HTML에, 나머지는 페이지의 JSON(`ResultView`)에 들어가 클라이언트가 그대로 옮기는 기존 방식을 따른다. DOM은 기존 계약(`dd[data-record=<key>]`)을 따른다.
   - dist 검사: 모든 상태의 모델에서 에러 수 값이 `displayModel(...).errorCount`와 같다(검증 기록이 없으면 `—`). 결과 탭 테스트 데이터에 콘솔·페이지 에러가 있는 모델이 없으면 하나 더한다(0이 아닌 값을 확인하기 위해).
   - 브라우저 테스트: 다른 모델을 고르면 에러 수 값이 바뀐다.
2. `.github/workflows/deploy.yml` (ARCHITECTURE "배포"):
   - 트리거: `push`(branches: main)와 `workflow_dispatch`. pull_request 트리거는 두지 않는다.
   - `permissions`: `contents: read`, `pages: write`, `id-token: write`만.
   - `concurrency`: group `pages`, `cancel-in-progress: false`.
   - 워크플로 `env`: `ASTRO_TELEMETRY_DISABLED: "1"`.
   - build job(`ubuntu-latest`), 이 순서로:
     1. `actions/checkout@v7`
     2. `actions/setup-node@v7`: node 24, npm 캐시
     3. `npm ci`
     4. `npx playwright install --with-deps chromium`
     5. `npm run lint` → `npm run typecheck` → `npm test` → `npm run check:results`
     6. `actions/configure-pages@v6` (id를 붙여 출력을 쓴다)
     7. `npm run build`: env `SITE_URL` = configure-pages의 `origin`, `SITE_BASE` = `base_path`. `base_path`가 `/one-prompt-bench`처럼 끝 슬래시 없이 오거나 빈 값이어도 `astro.config.mjs`의 정규화가 맞게 처리하는지 확인한다(필요하면 고치고 테스트를 더한다).
     8. `actions/upload-pages-artifact@v5` (path `site/dist`)
   - deploy job: `needs: build`, `environment: github-pages`(url은 deploy-pages 출력 `page_url`), `actions/deploy-pages@v5`.
3. 워크플로 테스트(`site/test/deploy-workflow.test.ts`):
   - YAML 파서는 `yaml` 패키지를 site devDependencies에 더해 쓴다. 정규식으로 YAML 구조를 흉내 내지 마라.
   - 확인할 것: 트리거 두 개, 권한 세 개(그 밖 없음), concurrency, 텔레메트리 env, build job의 `run`·`uses` 순서가 위 목록과 같다, 액션 버전이 위 메이저 태그와 같다, `upload-pages-artifact`의 path, deploy job의 needs·environment.
   - 금지 확인: 파일 전체에 `secrets.`가 없다. `npm run gen`·`smoke`·`validate`·`judge`, `claude`, `codex` 같은 실제 호출·results 변경 명령이 없다.
   - 테스트는 레포의 `.github/workflows/deploy.yml`을 읽기만 한다.

## 금지사항

- 워크플로에서 비밀값(`secrets.*`)·API 키를 쓰지 마라. 이유: 배포는 공개 데이터만 다룬다. 생성은 사람 PC에서만 한다(ADR-001, ADR-015).
- 워크플로에 `gen`·`smoke`·`validate`·`judge`를 넣지 마라. 이유: CI는 모델을 부르지 않고 results를 바꾸지 않는다(ARCHITECTURE "배포").
- 검사 단계를 `continue-on-error`나 조건으로 건너뛰게 만들지 마라. 이유: 하나라도 실패하면 배포하지 않는다(ADR-017).
- 위에 적지 않은 서드파티 액션을 쓰지 마라. 이유: 의존성 최소(ADR 철학 3), 공급망 위험.
- 상태 라벨 규칙이나 새 라벨을 만들지 마라. 이유: ADR-026은 라벨을 그대로 두고 에러 수만 보이기로 했다.
- `git push`, `gh workflow run`, GitHub 설정 변경을 하지 마라. 이유: 첫 배포와 Pages 설정은 phase 뒤에 사람이 한다.
- `results/`를 읽거나 쓰는 테스트를 만들지 마라. 이유: CLAUDE.md CRITICAL. 테스트 데이터는 `@opb/core/testing`으로 임시 디렉토리에 만든다.
