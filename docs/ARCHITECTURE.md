# 아키텍처 — 모노레포 구조, 파이프라인, 사이트, 배포

결정의 이유는 `docs/ADR.md`, 데이터 모양과 표시 규칙은 `docs/DATA.md`에 있다.

## 디렉토리 구조

npm workspaces 모노레포. 모든 TypeScript는 ESM(`"type": "module"`, NodeNext), strict.

```
/
├── models.json                 모델 레지스트리 (사람이 관리, 스키마는 core)
├── prompts/
│   ├── season-tree-v1.md           프롬프트 원문 (user 메시지, 한 글자도 바꾸지 않음)
│   ├── season-tree-v1.system.md    공통 최소 시스템 프롬프트 (세 도구 동일)
│   └── season-tree-v1.judging.md   판정 기준표 (사람용 + 프롬프트 탭 표시)
├── results/<slug>/             생성 결과 (커밋 대상. 사람·세션 모두 손으로 고치지 않음)
├── results-smoke/              smoke 실행 결과 (gitignore)
├── packages/core/              @opb/core — 프레임워크 없는 도메인 로직
│   ├── src/schema.ts               데이터 모양·불변식 (zod, 단일 출처)
│   ├── src/adapter.ts              어댑터 인터페이스, RETRYABLE_FAILURES, RunPolicy
│   ├── src/runner.ts               재시도·타임아웃·백오프·저장·비용 계산
│   ├── src/extract-html.ts         응답에서 HTML 꺼내기
│   ├── src/request-rules.ts        외부 요청 → 조건 검사 판정
│   ├── src/sort.ts                 목록 정렬 규칙
│   ├── src/results.ts              (신규) results/ 읽기·검증·조인 — 사이트와 check:results가 공유
│   ├── src/display.ts              (신규) 상태 라벨·숫자 포맷 등 표시 규칙 (DATA.md "표시 규칙")
│   ├── test/  examples/  scripts/check-samples.ts
├── pipeline/                   @opb/pipeline — NestJS 스탠드얼론 CLI
│   ├── src/main.ts                 명령 파싱(node:util parseArgs) → createApplicationContext
│   ├── src/adapters/               claude-code, codex, gemini 어댑터 + 자식 프로세스 실행 유틸
│   ├── src/generation/             batch(일괄 실행), preflight(추가 결제 차단 점검), smoke
│   ├── src/validation/             Playwright 검증기
│   ├── src/judging/                판정 도우미
│   └── test/fixtures/              CLI 출력 샘플, 검증용 HTML
├── site/                       @opb/site — Astro 정적 사이트
├── docs/                       설계 문서 (devlog/는 일차별 개발 일지, design/은 시안 원본)
├── phases/                     하네스 phase 계획·상태
├── scripts/                    하네스 (Python: execute.py, 테스트)
└── .github/workflows/deploy.yml
```

의존 방향: `pipeline → core`, `site → core`. core는 다른 워크스페이스를 import하지 않는다. pipeline과 site는 서로 import하지 않는다.

## 명령어 (루트 package.json)

| 명령 | 하는 일 | 실제 모델 호출 |
|---|---|---|
| `npm run lint` | ESLint, 전 워크스페이스 | 없음 |
| `npm run typecheck` | tsc(core·pipeline) + astro check(site) | 없음 |
| `npm test` | 전 워크스페이스 테스트 (가짜 어댑터·로컬 픽스처만) | 없음 |
| `npm run build` | 사이트 빌드 → `site/dist/` | 없음 |
| `npm run dev` | 사이트 개발 서버 | 없음 |
| `npm run check:results` | results/ 전수 검사 (배포 게이트, DATA.md) | 없음 |
| `npm run validate -- <slug…> \| --all` | Playwright 재검증 (results/ 갱신, three.js CDN 접속) | 없음 |
| `npm run judge -- <slug>` | 판정 기록 (대화형) | 없음 |
| `npm run smoke -- <slug>` | 짧은 실호출로 도구·인증·출력 파싱 확인 → `results-smoke/` | **있음 — 사람만** |
| `npm run gen -- <slug…> \| --all [--force]` | 생성 + 검증 → `results/` | **있음 — 사람만** |

`gen`·`generate`·`smoke` 스크립트와 `claude -p`·`codex exec`·Gemini API 직접 호출은 `.claude/hooks/block_dangerous.py`가 Claude 세션에서 막는다. 사람은 터미널이나 `! <명령>`으로 실행한다.

## 생성 파이프라인

```
models.json ─▶ Batch ─▶ Runner(재시도·타임아웃·저장·비용) ─▶ Adapter(도구 호출 1회·정규화·에러 분류)
                 │                     └▶ results/<slug>/{response.txt, index.html, meta.json}
                 └▶ (outcome ok면 바로) Validator(Playwright) ─▶ meta.json.validation + *.webp
```

### 책임 분리 (기존 코드 유지)
- **Runner** (`core/src/runner.ts`): 재시도·타임아웃·백오프·시간 측정·파일 저장·비용 계산. 재시도 정책 `DEFAULT_RUN_POLICY` = 최대 3회, 시도당 20분, 백오프 5초 → 최대 60초(`Retry-After` 우선). 출력 폴더가 비어 있지 않으면 거부.
- **Adapter**: 호출 1회 + 응답 정규화(`ProviderResponse`) + 에러 분류(`ClassifiedError`)만. 재시도 여부는 정하지 않는다. '기술적 실패'(재시도 대상)의 정의는 `RETRYABLE_FAILURES` 한 곳.
- **Batch** (`pipeline/src/generation/`): 대상 선택, 순차 실행, 덮어쓰기 규칙, 생성 직후 검증 호출, 끝에 요약표 출력.

### 기존 코드에서 바꿀 것 (`docs/DATA.md` "스키마 변경 예정")
- `ProviderAdapter.sdk` → `generator { tool, version, invocation }`. meta.json `runtime`도 같이.
- `GenerationRequest.maxOutputTokens`·`params.maxOutputTokens`를 `number | null`로 (Codex는 null).
- `PromptSpec.system`에 `prompts/season-tree-v1.system.md` 내용을 넣는다 (지금은 null).
- 이전 설계의 Anthropic SDK 어댑터는 제거됐다. 새로 만들지 않는다.

### Batch 규칙
- 모델은 순차 실행. 한 모델이 실패해도 다음 모델을 계속한다.
- 건너뛰기: `meta.json`이 있고 `outcome`이 `api_failed`가 아니면 건너뛴다. `api_failed`(한도 초과 포함)이거나 `meta.json` 없이 파일만 남은 폴더(중단된 생성)는 비우고 다시 생성한다.
- `--force`: 폴더를 비우고 새로 만든다. 예전 판정(judgment.json)도 함께 지워진다. 실행 전에 지울 폴더 목록을 보여 주고 확인받는다.
- `usage_limit`(구독 한도)는 바로 재시도하지 않고 기록한 뒤 다음 모델로 넘어간다. 한도가 풀린 뒤 다시 실행하면 그 모델만 돈다.
- outcome이 `ok`면 바로 검증기를 실행한다. 검증이 실패해도 batch는 계속하고 `validation`은 null로 남긴다(나중에 `npm run validate`).
- **preflight** (실제 호출 전 자동 점검, 하나라도 실패하면 아무것도 호출하지 않고 종료):
  - 환경변수에 `ANTHROPIC_API_KEY`·`OPENAI_API_KEY`가 없다.
  - Anthropic 대상이 있으면 `claude auth status` 결과의 인증 방식이 claude.ai 구독이다.
  - OpenAI 대상이 있으면 `codex login status`가 ChatGPT 로그인이다. ⚠ 출력 형식은 smoke 때 확인.
  - Google 대상이 있으면 `.env`에 `GEMINI_API_KEY`가 있다 (값은 출력하지 않는다).
  - `packages/`, `pipeline/`, `prompts/`, `models.json`에 커밋 안 된 변경이 없다 — meta.json의 `gitCommit`이 실제 코드를 가리키게.

### 도구별 호출 사양

공통: 프롬프트 원문은 **stdin**으로 넘긴다(Windows 셸 인용 문제 방지). 자식 프로세스 환경에서 `ANTHROPIC_API_KEY`·`OPENAI_API_KEY`를 지운다. 작업 디렉토리는 **매 시도 새로 만든 빈 임시 디렉토리**다. 레포 안에서 실행하면 CLAUDE.md·AGENTS.md가 생성 맥락에 섞인다. 타임아웃이면 프로세스 트리 전체를 종료한다(Windows: `taskkill /T /F`). Windows에서 npm 전역 설치 CLI는 `.cmd` shim이라 shell 없이 spawn할 수 없다. 실행 파일 경로를 해석하거나 cross-spawn을 쓴다.

**Claude Code CLI** (2.1.296에서 플래그 확인)
```
claude -p --model <modelId> --effort high --tools "" --system-prompt "<system.md 내용>"
       --safe-mode --strict-mcp-config --no-session-persistence --output-format json
env: CLAUDE_CODE_MAX_OUTPUT_TOKENS=65536
```
- shell 없이 인자 배열로 spawn한다(한글 인자 인용 문제 방지). Windows에서는 npm shim(`claude.cmd`) 대신 실제 `claude.exe`를 찾는다. 하네스 `scripts/execute.py`의 `resolve_claude_bin`과 같은 방식이다.
- `--safe-mode`: CLAUDE.md·skills·hooks·MCP 등 사용자 설정을 끄고, 구독 인증은 유지한다.
- **`--bare` 금지**: 인증이 ANTHROPIC_API_KEY로만 돼서 API 요금이 청구된다.
- 출력 JSON의 `result`가 본문, `usage`의 input·cache_creation·cache_read를 합친 값이 inputTokens다(DATA.md). 추론 토큰을 따로 주지 않으면 `reasoningTokens: null`. 사용 한도 메시지("usage limit", "hit your limit" 등)는 `usage_limit`로 분류한다.
- ⚠ smoke로 확인: 입력 토큰이 수백 개 수준인가(수천 개 이상이면 기본 지시문·메모리가 섞인 것). max_tokens 도달·거부를 어떤 필드로 알 수 있는가.

**Codex CLI** (0.157.1에서 플래그 확인)
```
codex exec --model <modelId> --sandbox read-only --skip-git-repo-check --ephemeral
           --ignore-user-config --ignore-rules --json -o <tmp>/last-message.txt -C <emptyTmpDir>
           -c model_reasoning_effort="high" -c model_instructions_file="<system.md 절대경로>" -
```
- Codex는 에이전트라 응답 대신 파일을 쓸 수 있다. read-only 샌드박스와 빈 디렉토리에서 실행해 답을 텍스트로 받는다.
- `--ignore-user-config`: `~/.codex/config.toml`(사용자 기본 모델·추론 강도·MCP)을 무시하고, 인증은 유지한다.
- 출력 상한을 지정할 수 없다 → `maxOutputTokens: null`, 사이트 † 각주.
- 사용량은 JSONL `turn.completed` 이벤트(input / cached_input / output / reasoning_output tokens)를 모든 턴에 걸쳐 합친다.
- ⚠ smoke로 확인: `model_reasoning_effort`·`model_instructions_file` 키가 적용되는가. `output_tokens`가 추론분을 포함하는가(포함이 아니면 더해서 정규화). ChatGPT 한도 초과 메시지 형식.

**Gemini API** (`@google/genai` SDK, `.env`의 GEMINI_API_KEY)
- `systemInstruction` = system.md, thinking level `high`, `maxOutputTokens: 65536`(thinking 포함 상한), 긴 출력이라 스트리밍.
- outputTokens = 본문 + thought 토큰(정규화), reasoningTokens = thought 토큰.
- 무료 티어의 짧은 요청 한도(429) → `rate_limited`(재시도), 일일 할당량 소진 → `usage_limit`(재시도 안 함). ⚠ 정확한 필드·에러 이름은 설치한 SDK 타입과 smoke로 확인.
- 2027-01-01부터 정가가 2배가 된다. 비용은 `models.json`의 `pricing.asOf` 시점 가격으로 계산한다.

**smoke** (`npm run smoke -- <slug>`): "Hello" HTML 한 장을 요청하는 짧은 프롬프트, 출력 상한 8,000. `results-smoke/<slug>-<timestamp>/`에 meta.json과 함께 **도구의 원본 stdout을 그대로 저장**한다. 사람이 확인한 뒤 어댑터 테스트 fixture로 복사하는 용도다(⚠ 항목을 실제 출력으로 확정).

## 검증기 (Playwright, `pipeline/src/validation/`)

- 로컬 정적 서버로 레포를 열고, 사이트와 **같은 조건**으로 `<iframe sandbox="allow-scripts" src=".../results/<slug>/index.html">`(1280×800)을 담은 검증용 페이지를 띄운다.
- 기록: `loaded`(iframe load 이벤트, 30초 제한), `consoleErrors`(console error), `pageErrors`(처리되지 않은 예외), `externalRequests`(로컬 서버가 아닌 모든 요청의 url·resourceType). iframe 안의 이벤트까지 잡히는지 테스트로 확인한다.
- 스크린샷: iframe load를 0초로 5·15·25·35초에 iframe 영역만 찍는다(spring/summer/autumn/winter). Playwright는 PNG/JPEG만 지원하므로 **sharp로 WebP 변환**해 `results/<slug>/<label>.webp`에 저장한다.
- headless Chromium에서 WebGL이 동작해야 한다(SwiftShader 플래그 등). ⚠ 첫 구현 때 three.js 픽스처로 확인.
- 검증 결과는 `meta.json`의 `validation`만 갱신한다. 다른 필드는 건드리지 않고, 저장 전에 스키마로 검사한다.
- 테스트: `test/fixtures/`의 로컬 HTML로 실행하고, 외부 URL은 `page.route`로 가로채 가짜 응답을 준다. 테스트에서 실제 네트워크를 쓰지 않는다.

## 판정 도우미 (`npm run judge -- <slug>`)

- `outcome`이 `ok`이고 결과물이 있는 모델만 판정할 수 있다.
- 결과물 경로·스크린샷 경로·판정 기준 요약을 보여 주고, 요구사항 4개(pass/partial/fail)와 메모(1~200자)를 입력받는다.
- `modelSlug`, `prompt`(id·version), `outputSha256`(meta.json의 `output.sha256`), `judgedAt`(KST 오프셋)은 자동으로 채운다. 저장 전에 `JudgmentSchema`로 검사한다.
- 기존 판정이 있으면 내용을 보여 주고 덮어쓸지 확인받는다.
- 테스트용으로 같은 값을 플래그로도 받는다: `--scene --cycle --look --label --note --yes`.

## 사이트 (Astro, `site/`)

- 정적 출력(`output: 'static'`). 페이지: `/`(결과 탭, 첫 화면), `/compare/`, `/prompt/`, `/intro/`, `/view/<slug>/`(새 창용 전체 화면 래퍼).
- **데이터는 빌드 때만 읽는다**: `core/src/results.ts`로 `models.json`·`results/`·`prompts/`를 읽고 검증·조인해서, 표시 값은 `core/src/display.ts`로 만든다. 데이터 위치는 기본이 레포 루트이고, 테스트에서는 환경변수 `OPB_DATA_ROOT`로 픽스처 폴더를 가리킨다.
- 빌드 때 `results/<slug>/index.html`과 `response.txt`를 `dist/r/<slug>/`로 복사한다. 스크린샷(webp)과 meta.json은 복사하지 않는다.
- **결과물 실행은 항상 `<iframe sandbox="allow-scripts">` 안에서만.** `allow-same-origin`을 절대 넣지 않는다. GitHub Pages는 사용자 계정의 모든 Pages 사이트가 한 출처(`<user>.github.io`)를 쓰기 때문이다. "새 창에서 열기"는 `/view/<slug>/`(같은 샌드박스 iframe을 화면 가득)로 연다. 결과물 파일을 직접 링크하지 않는다.
- 한 번에 결과물 하나만 실행한다. 모델을 바꾸면 iframe의 src를 바꾸고, "다시 시작"은 같은 src를 다시 불러온다.
- 결과물이 없는 모델은 이유를 보여 주고, 응답 원문(response.txt)은 그 모델을 고를 때 `fetch`로 불러온다(첫 화면 용량을 줄이기 위해).
- 클라이언트 동작(모델 전환, 다시 시작, 복사 버튼, 휴대폰 드롭다운)은 Astro `<script>`의 순수 TypeScript로 만든다. UI 프레임워크(React 등)는 쓰지 않는다.
- 스타일: Astro 컴포넌트 scoped CSS + `:root` CSS 변수(토큰은 UI_GUIDE.md). Tailwind는 쓰지 않는다.
- GitHub Pages 프로젝트 경로: `astro.config`의 `site`·`base`를 환경변수(`SITE_URL`, `SITE_BASE`)에서 읽는다. 워크플로가 레포 이름으로 채운다. 모든 내부 링크·에셋은 `import.meta.env.BASE_URL` 기준으로 만든다.

## 배포 (`.github/workflows/deploy.yml`)

- 트리거: main push + `workflow_dispatch`(수동 실행 버튼). 동시 실행은 `concurrency: pages`로 하나만.
- 순서: `npm ci` → `npx playwright install --with-deps chromium` → `npm run lint` → `npm run typecheck` → `npm test` → `npm run check:results` → `npm run build`(SITE_BASE=`/<레포 이름>/`) → `actions/upload-pages-artifact` → `actions/deploy-pages`. **하나라도 실패하면 배포하지 않는다.**
- CI는 실제 모델을 부르지 않는다 (gen·smoke는 워크플로에 없다).
- 한도 참고: Pages 사이트 1GB, 대역폭 월 100GB(권장), 배포 10분. 공개 레포의 Actions는 무료.

## 테스트 전략

- 러너: 모든 워크스페이스에서 `node:test` + `tsx` (`tsx --test`). 기존 core 테스트와 같은 방식이다.
- **실제 CLI·API를 부르는 테스트를 만들지 않는다.** 어댑터는 자식 프로세스 실행 함수나 SDK 클라이언트를 주입받는다. 테스트는 CLI 원본 출력 fixture(`pipeline/test/fixtures/`)를 먹여 파싱·분류를 검증한다.
- 시간은 주입한다(`RunnerDeps.now/sleep`). 테스트에서 실제로 기다리지 않는다.
- 파일을 쓰는 테스트는 OS 임시 디렉토리(`mkdtemp`)에서 한다. 레포의 `results/`를 읽거나 쓰지 않는다.
- 사이트: `OPB_DATA_ROOT`를 픽스처로 두고 빌드한 뒤, `dist/` HTML을 검사한다(샌드박스 속성, `{N}` 치환, 각주, 상태 라벨 등).
- 하네스(Python): `python -m pytest scripts`.

## NestJS 사용 규칙

- `NestFactory.createApplicationContext(AppModule)`만 쓴다. HTTP 서버를 띄우지 않는다.
- **생성자 주입은 `@Inject(TOKEN)`을 명시한다.** tsx(esbuild)는 `emitDecoratorMetadata`를 지원하지 않아서, 타입 기반 주입은 테스트·실행에서 조용히 undefined가 된다. `experimentalDecorators: true`, `import 'reflect-metadata'`.
- 도메인 로직은 core의 순수 함수로 두고, Nest provider는 그것을 감싸 I/O(프로세스·파일·브라우저)를 주입하는 얇은 층으로 둔다.

## 버전 참고 (기획 때 설치해 동작 확인한 값)

zod ^4.6.5 (`z.iso.datetime`, `z.url()` 사용), tsx ^4.23.15, typescript ^7.0.2, @types/node ^26.6.4, dotenv ^18.0.6. Node ≥ 22 (개발 PC는 24.14).
TypeScript 7(네이티브 컴파일러)이 ESLint(typescript-eslint)·astro check와 맞지 않으면 6.x로 내리고 ADR에 기록한다.
