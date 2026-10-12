# Step 1: playwright-validator

## 목표

`results/<slug>/index.html`을 사이트와 같은 샌드박스 iframe에서 열어 검증하고, `meta.json`의 `validation`과 스크린샷 4장을 기록하는 Playwright 검증기가 동작한다.

- `npm run gen`이 outcome `ok`인 모델에 대해 바로 이 검증기를 부른다(phase 1 자리표시 교체).
- `npm run validate -- <slug…> | --all`로 재검증할 수 있다.
- 로컬 HTML 픽스처와 `page.route`(가짜 외부 응답)만 쓰는 테스트가 기록 항목 하나하나, iframe 안 이벤트 수집, headless WebGL 동작을 증명한다.
- 이 step에서 레포의 `results/`에 대해 검증을 실행하지 않는다.

## 관련 파일

- `docs/ARCHITECTURE.md` "검증기"(전부), "생성 파이프라인" → Batch 규칙(검증 호출·종료 코드), "명령어", "NestJS 사용 규칙", "테스트 전략"
- `docs/DATA.md` "파일 배치", "meta.json" → validation
- `docs/ADR.md` ADR-009, ADR-010, ADR-011, ADR-015
- `pipeline/src/validation/validator.ts`(Validator 인터페이스·PlaceholderValidator), `pipeline/src/generation/batch.ts`(processModel의 검증 호출), `batch.service.ts`·`smoke.service.ts`(서비스 모양), `app.module.ts`, `tokens.ts`, `cli.ts`, `main.ts`, `pipeline/test/app.module.test.ts`·`cli.test.ts`
- step 0 산출물: core `RESULT_IFRAME_SANDBOX`, `@opb/core/testing`(가짜 데이터 루트 빌더), `loadResults`, `judgeRequests`. 실제 이름은 step 0 handoff를 확인한다.

## 작업

테스트를 먼저 작성한다.

1. 의존성: pipeline dependencies에 `playwright`(라이브러리, `@playwright/test` 아님)를 추가한다. `npx playwright install chromium`으로 브라우저를 받는다(AC에는 넣지 않는다).
2. 검증 로직(`pipeline/src/validation/`). 시그니처는 예시이고 재량이다.
   ```ts
   export const SCREENSHOT_SCHEDULE = [
     { label: 'spring', atMs: 5_000 }, { label: 'summer', atMs: 15_000 },
     { label: 'autumn', atMs: 25_000 }, { label: 'winter', atMs: 35_000 },
   ] as const;
   export interface ValidateOptions {
     schedule?: readonly { label: string; atMs: number }[]; // 테스트는 짧게
     loadTimeoutMs?: number;                                 // 기본 30_000
     preparePage?: (page: Page) => Promise<void>;            // 테스트가 page.route를 건다
     now?: () => Date;                                       // checkedAt
   }
   export async function validateResult(repoRoot: string, slug: string, opts?: ValidateOptions): Promise<Validation>;
   ```
   - **대상**: meta.json이 스키마를 통과하고 outcome `ok`이고 output이 있는 slug만이다. 아니면 이유를 담아 throw하고 파일을 바꾸지 않는다.
   - **서버와 페이지**:
     - `node:http`로 127.0.0.1의 임의 포트에 로컬 정적 서버를 띄운다. 서버는 검증용 페이지와 그 slug의 `index.html`만 내주고 나머지는 404다.
     - 검증용 페이지는 `<iframe sandbox="${RESULT_IFRAME_SANDBOX}" src="/results/<slug>/index.html">` 하나를 1280×800으로 담는다. 뷰포트도 1280×800이다.
     - 끝나면 서버와 브라우저를 반드시 닫는다(finally).
   - **기록**(ARCHITECTURE "검증기"):
     - `loaded`: iframe load 이벤트, loadTimeoutMs 제한
     - `consoleErrors`: console error 텍스트
     - `pageErrors`: 처리되지 않은 예외 메시지
     - `externalRequests`: 로컬 서버가 아닌 http(s) 요청의 url·resourceType, 요청 순서대로. data:·blob:은 넣지 않는다
     - `environment`: `chromium`과 `browser.version()`
     - `checkedAt`
   - **load가 오지 않을 때**: 제한 시간 안에 load가 오지 않으면 `loaded: false`로 기록한다. 그 시점을 0초로 스크린샷 4장은 그대로 찍는다.
   - **스크린샷**:
     - load 시점을 0초로 schedule의 각 시점에 iframe 요소 영역만 찍어 `results/<slug>/<label>.jpg`에 저장한다. `type: 'jpeg', quality: 80`.
     - 기록하는 `atMs`는 schedule 값이고, `path`는 레포 기준(`results/<slug>/<label>.jpg`)이다.
     - 이미지 변환 라이브러리를 쓰지 마라.
   - **저장**:
     - 기존 meta.json을 읽어 `validation`만 바꾸고, `GenerationRecordSchema`로 검사한 뒤 쓴다.
     - 다른 필드·`judgment.json`·`index.html`은 건드리지 않는다. 재검증이면 스크린샷을 덮어쓴다.
   - **WebGL**: headless Chromium에서 WebGL이 동작해야 한다. ⚠ 필요한 launch 플래그(SwiftShader 등)를 WebGL 픽스처 테스트로 찾는다. 실제로 쓴 플래그와 확인 결과를 handoff에 남긴다.
3. Nest 연결:
   - `PlaywrightValidator implements Validator`(`@Inject(REPO_ROOT)` 등)로 `VALIDATOR` 토큰을 바꾸고, `PlaceholderValidator`는 지운다.
   - Nest 컨텍스트를 만들 때 브라우저를 띄우지 않는다. 검증할 때 띄우고 끝나면 닫는다.
   - `Validator.validate`가 요약 출력에 쓸 `Validation`을 돌려주게 바꿔도 된다. batch는 계속 결과를 무시하고, throw하면 기존처럼 계속한다.
4. `validate` 명령(ARCHITECTURE "검증기"의 명령 규칙):
   - `cli.ts`에 `{ kind: 'validate'; slugs: string[]; all: boolean }`를 추가하고, USAGE와 `main.ts` case도 함께 고친다.
   - `ValidateService`는 `VALIDATOR` 토큰을 주입받는다(테스트는 가짜 검증기로 대상 선택·종료 코드를 확인한다).
   - 루트 스크립트: `"validate": "tsx --tsconfig pipeline/tsconfig.json pipeline/src/main.ts validate"`.
   - 대상 선택:
     - `--all`: models.json 순서(sortByRelease)에서 meta.json outcome이 ok인 모델 전부. 나머지는 "건너뜀(이유)"로 출력한다.
     - slug를 직접 주면: 모르는 slug가 있으면 아무것도 하지 않고 exit 1이다. ok가 아닌 slug는 실패로 보고하고 다음 모델을 계속한 뒤 exit 1이다.
   - 한 모델의 검증이 throw해도 다음 모델을 계속한다. 끝에 모델별 결과(loaded·에러 수·외부 요청 수 또는 실패 이유)를 출력한다.
   - 모델을 부르지 않으므로 preflight는 하지 않는다.
5. 테스트(`pipeline/test/`, 픽스처 HTML은 `pipeline/test/fixtures/validation/`):
   - 데이터는 `@opb/core/testing` 빌더로 OS 임시 디렉토리에 만들고, 픽스처 HTML을 index.html로 넣는다(sha256이 맞게).
   - **모든 브라우저 테스트에서 `preparePage`로 로컬이 아닌 요청을 전부 가로채는 route를 건다**(가짜 응답 또는 abort). 실제 네트워크에 닿는 요청이 없어야 한다.
   - 모듈 스크립트의 가짜 응답에는 `access-control-allow-origin: *`을 넣는다. 샌드박스 iframe은 출처가 opaque라 CORS가 필요하다.
   - schedule은 짧게(예: 100·200·300·400ms), loadTimeoutMs도 짧게 준다.
   - 최소 케이스:
     - 정상 페이지: loaded true, 에러 0, 스크린샷 4장이 `FF D8 FF`로 시작, meta.json의 validation 외 필드가 그대로, 스키마 통과
     - iframe 안의 `console.error`와 잡히지 않은 throw가 consoleErrors·pageErrors에 잡힘
     - 외부 script·image·font 요청이 externalRequests에 잡히고, core `judgeRequests`가 기대 판정을 냄
     - load가 오지 않는 페이지(응답하지 않는 외부 요청): loaded false와 스크린샷 4장
     - iframe 안에서 WebGL 컨텍스트가 만들어짐
     - outcome이 ok가 아닌 slug: throw하고 파일을 바꾸지 않음
     - 재검증: 스크린샷 덮어쓰기, judgment.json 유지
     - `parseCommand`의 validate 인자
     - ValidateService의 대상 선택(`--all`·직접 지정·모르는 slug·ok 아님)과 종료 코드
     - app.module이 VALIDATOR로 PlaywrightValidator를 주고, 컨텍스트를 만들 때 브라우저를 띄우지 않음
   - 브라우저 테스트는 실행 시간을 줄이려고 묶어도 된다. pipeline `npm test` 전체가 몇 분을 넘지 않게 한다.

## 금지사항

- 레포의 `results/`에 대해 `npm run validate`나 `validateResult`를 실행하지 마라. 이유: results/ 갱신은 사람이 지시할 때만 한다(CLAUDE.md). 테스트는 임시 디렉토리에서만 한다.
- `npm run gen`·`npm run smoke`나 진입점의 gen·smoke를 실행하지 마라. 이유: 실제 모델 호출이다(CLAUDE.md CRITICAL, 훅이 막는다).
- 테스트가 실제 네트워크(three.js CDN, Google Fonts 등)에 닿게 하지 마라. 이유: CLAUDE.md CRITICAL, 결과가 결정적이지 않다.
- iframe에 `allow-same-origin`이나 다른 sandbox 토큰을 넣지 마라. sandbox 값은 core 상수만 쓴다. 이유: 사이트와 같은 조건이어야 하고(ADR-009), 규칙을 두 곳에 쓰지 않는다.
- sharp 같은 이미지 변환 라이브러리를 들이지 마라. 이유: ADR-010.
- `@playwright/test` 러너를 들이지 마라. 이유: 테스트 러너는 node:test + tsx로 통일한다(ADR-015).
- 검증 결과로 판정(조건 검사 verdict)을 meta.json에 저장하지 마라. 이유: 매번 계산한다(ADR-011).
