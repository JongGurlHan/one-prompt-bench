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
│   ├── src/prompt.ts               프롬프트 파일 읽기 (loadPrompt, CURRENT_PROMPT)
│   ├── src/index.ts                공개 진입점 (`@opb/core`, 빌드 없이 TS 소스를 직접 내보냄)
│   ├── src/results.ts              results/ 읽기·검증·조인 (loadResults·checkResults) — 사이트와 check:results가 공유
│   ├── src/display.ts              상태 라벨·숫자 포맷 등 표시 규칙 (DATA.md "표시 규칙", displayModel)
│   ├── src/sandbox.ts              RESULT_IFRAME_SANDBOX (사이트·검증기가 같이 쓰는 iframe sandbox 값)
│   ├── scripts/check-results.ts    `npm run check:results` — Nest 없이 core만 쓴다
│   ├── test/support/testing.ts     `@opb/core/testing` — 테스트용 가짜 데이터 루트 빌더 (pipeline·site 테스트도 씀)
│   ├── test/  examples/  scripts/check-samples.ts
├── pipeline/                   @opb/pipeline — NestJS 스탠드얼론 CLI
│   ├── src/main.ts                 진입점 → cli.ts(parseArgs) → createApplicationContext. 토큰은 tokens.ts
│   ├── src/config/                 레포 루트 + .env(dotenv.parse, process.env에 넣지 않음)
│   ├── src/adapters/               도구별 어댑터(gemini/ · claude-code/ …) + registry.ts(도구 → 생성 함수·도구별 preflight·기록 래퍼)
│   ├── src/generation/             batch(일괄 실행), preflight(추가 결제 차단 점검), smoke
│   ├── src/system/                 git·터미널 확인(y/N)·CLI 실행(cli.ts) 같은 I/O
│   ├── src/validation/             Playwright 검증기(validate-result.ts, `VALIDATOR` 토큰 = PlaywrightValidator)와 validate 명령
│   ├── src/judging/                (신규) 판정 도우미
│   └── test/fixtures/              CLI 출력 샘플, 검증용 HTML
├── site/                       @opb/site — Astro 정적 사이트
│   ├── src/lib/                    data.ts(데이터 읽기) · paths.ts(BASE_URL 기준 주소) · copy.ts(COPY 문구) · tabs.ts · results-view.ts
│   ├── src/pages/                  index.astro(결과 탭) · view/[slug].astro(새 창 래퍼) · r/[slug]/*.ts(결과물 사본 endpoint)
│   ├── src/scripts/                클라이언트 동작 (results-tab.ts)
│   ├── src/layouts/ components/ styles/   공통 레이아웃 · 배지 · 토큰(tokens.css)·바탕(base.css)
│   └── test/support/               빌드 헬퍼(build.ts) · 정적 서버 · HTML 검사 · 결과 탭 데이터
├── docs/                       설계 문서 (design/은 시안 원본)
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
| `npm run check:results` | results/ 전수 검사 (배포 게이트, DATA.md). `OPB_DATA_ROOT`로 다른 데이터 루트를 검사할 수 있다 | 없음 |
| `npm run validate -- <slug…> \| --all` | Playwright 재검증 (results/ 갱신, three.js CDN 접속) | 없음 |
| `npm run judge -- <slug>` | 판정 기록 (대화형) | 없음 |
| `npm run smoke -- <slug>` | 짧은 실호출로 도구·인증·출력 파싱 확인 → `results-smoke/` | **있음 — 사람만** |
| `npm run gen -- <slug…> \| --all [--force]` | 생성 + 검증 → `results/` | **있음 — 사람만** |

`gen`·`generate`·`smoke` 스크립트, 파이프라인 진입점 직접 실행(`tsx`·`node … main.ts gen|smoke`), `claude -p`·`codex exec`·Gemini API 직접 호출은 `.claude/hooks/block_dangerous.py`가 Claude 세션에서 막는다. 무인 세션은 권한 확인 없이 돌기 때문에 이 훅이 실질적인 방어선이다. 진입점 파일 이름을 바꾸면 훅 패턴과 `scripts/test_block_dangerous.py`도 함께 바꾼다. 루트 스크립트는 `tsx --tsconfig pipeline/tsconfig.json pipeline/src/main.ts <명령>` 형태다. tsx는 tsconfig를 현재 폴더에서 찾기 때문에, 루트에서 실행할 때 지정하지 않으면 `experimentalDecorators`가 꺼져 데코레이터가 실패한다. 사람은 터미널이나 `! <명령>`으로 실행한다.

## 생성 파이프라인

```
models.json ─▶ Batch ─▶ Runner(재시도·타임아웃·저장·비용) ─▶ Adapter(도구 호출 1회·정규화·에러 분류)
                 │                     └▶ results/<slug>/{response.txt, index.html, meta.json}
                 └▶ (outcome ok면 바로) Validator(Playwright) ─▶ meta.json.validation + *.jpg
```

### 책임 분리 (기존 코드 유지)
- **Runner** (`core/src/runner.ts`): 재시도·타임아웃·백오프·시간 측정·파일 저장·비용 계산. 재시도 정책 `DEFAULT_RUN_POLICY` = 최대 3회, 시도당 20분, 백오프 5초 → 최대 60초(`Retry-After` 우선). 출력 폴더가 비어 있지 않으면 거부. 첫 호출 전에 `describeInvocation`을 불러 `runtime.generator`를 만든다(여기서 실패하면 모델을 부르지 않는다).
  - 알려진 한계: 타임아웃으로 끊긴 시도는 Runner가 abort 즉시 끝내서, 그 시도에서 이미 과금된 부분 사용량이 기록되지 않는다(어댑터는 담아서 던지지만 Runner가 먼저 끝난다). 다른 이유로 스트림 도중 끊긴 시도는 사용량이 남는다.
- **Adapter**: 호출 1회 + 응답 정규화(`ProviderResponse`) + 에러 분류(`ClassifiedError`)만. 재시도 여부는 정하지 않는다. '기술적 실패'(재시도 대상)의 정의는 `RETRYABLE_FAILURES` 한 곳.
- **Batch** (`pipeline/src/generation/`): 대상 선택, 순차 실행, 덮어쓰기 규칙, 생성 직후 검증 호출, 끝에 요약표 출력.

### 어댑터 인터페이스 (`core/src/adapter.ts`, phase 1에서 CLI 방식으로 전환)
- 필수 멤버: `provider`, `generator { tool, version }`, `supportsMaxOutputTokens`, `describeInvocation(req)`, `generate(req, signal)`, `classifyError(err)`. meta.json `runtime.generator`는 `{ ...generator, invocation }`이다.
- 출력 상한은 `DEFAULT_MAX_OUTPUT_TOKENS`(65,536) 한 곳에 있고, `maxOutputTokensFor(adapter, limit?)`가 상한을 지원하지 않는 도구(Codex)에는 null을 돌려준다. batch는 기본값, smoke는 8,000을 넘긴다.
- `PromptSpec`(`core/src/prompt.ts`)의 `system`은 항상 문자열이다(ADR-005).
- 이전 설계의 Anthropic SDK 어댑터는 제거됐다. 새로 만들지 않는다.

### 프롬프트 읽기
- `prompts/<id>-<version>.md`(user)와 `prompts/<id>-<version>.system.md`(system)를 UTF-8로 읽어 **내용 그대로**(끝 줄바꿈 포함, trim 없음) 보낸다. 로더는 core에 둔다.
- 줄바꿈이 OS에 따라 바뀌지 않게 `.gitattributes`가 `prompts/**`를 LF로 고정한다(개발 PC는 `core.autocrlf=true`). 로더는 CRLF를 고치지 않고 거부한다. 조용히 고치면 보낸 내용과 sha256이 바뀐 사실이 숨기 때문이다. 같은 이유로 단독 CR, UTF-8 BOM, UTF-8이 아닌 파일, 파일 없음도 거부한다(에러에 파일 경로 포함).

### Batch 규칙
- 모델은 순차 실행. 한 모델이 실패해도 다음 모델을 계속한다.
- 건너뛰기: `meta.json`이 있고 `outcome`이 `api_failed`가 아니면 건너뛴다. `api_failed`(한도 초과 포함)이거나 `meta.json` 없이 파일만 남은 폴더(중단된 생성)는 비우고 다시 생성한다.
- `--force`: 폴더를 비우고 새로 만든다. 예전 판정(judgment.json)도 함께 지워진다. 실행 전에 지울 폴더 목록을 보여 주고 확인받는다.
- `usage_limit`(구독 한도)는 바로 재시도하지 않고 기록한 뒤 다음 모델로 넘어간다. 한도가 풀린 뒤 다시 실행하면 그 모델만 돈다.
- outcome이 `ok`면 바로 검증기(`VALIDATOR` 토큰 = `PlaywrightValidator`)를 실행한다. 검증이 실패해도 batch는 계속하고 `validation`은 null로 남긴다(나중에 `npm run validate`).
- meta.json이 스키마를 통과하지 못하거나 `modelSlug`가 폴더 이름과 다르면 건드리지 않고 실패로 보고한 뒤 다음 모델로 간다(`--force`면 확인 목록에 넣고 비운다).
- 순서: 대상 선택 → preflight → HEAD 커밋 → 프롬프트 1회 로드(깨진 프롬프트로 폴더를 비우지 않게) → 폴더 상태 판정 → `--force` 확인 → 순차 실행 → 요약표.
- 종료 코드: preflight 실패·사용법 오류·`--force` 거절·깨진 meta.json·모델 처리 중 예외·검증기 오류면 1. 모델 outcome이 `api_failed`(한도 초과 포함)인 것은 기록이 정상으로 남은 것이라 0.
- **preflight** (실제 호출 전 자동 점검, 하나라도 실패하면 아무것도 호출하지 않고 종료):
  - 환경변수에 `ANTHROPIC_API_KEY`·`OPENAI_API_KEY`가 없다(빈 문자열로 있어도 실패).
  - 대상 모델의 생성 도구마다 어댑터가 등록돼 있다. 어댑터가 아직 없는 도구가 섞이면 아무것도 호출하지 않는다. 도구별 인증 점검(아래 두 항목)은 그 도구의 어댑터와 함께 만든다.
  - Anthropic 대상이 있으면 `claude auth status` 결과의 인증 방식이 claude.ai 구독이다.
  - OpenAI 대상이 있으면 `codex login status`가 ChatGPT 로그인이다(stderr `Logged in using ChatGPT`, 아래 "Codex CLI").
  - Google 대상이 있으면 `.env`에 `GEMINI_API_KEY`가 있다 (값은 출력하지 않는다).
  - `packages/`, `pipeline/`, `prompts/`, `models.json`에 커밋 안 된 변경이 없다 — meta.json의 `gitCommit`이 실제 코드를 가리키게.

### 도구별 호출 사양

공통: 프롬프트 원문은 **stdin**으로 넘긴다(Windows 셸 인용 문제 방지). 자식 프로세스 환경에서 `ANTHROPIC_API_KEY`·`OPENAI_API_KEY`를 지운다. 작업 디렉토리는 **매 시도 새로 만든 빈 임시 디렉토리**다(끝나면 지운다). 레포 안에서 실행하면 CLAUDE.md·AGENTS.md가 생성 맥락에 섞인다. 타임아웃이면 프로세스 트리 전체를 종료한다(Windows: `taskkill /T /F`, POSIX: 프로세스 그룹). Windows에서 npm 전역 설치 CLI는 `.cmd` shim이라 shell 없이 spawn할 수 없다. 실행 파일 경로를 해석하거나 cross-spawn을 쓴다. 이 공통 부분은 `pipeline/src/system/cli.ts` 한 곳에 두고 Claude Code·Codex 어댑터가 같이 쓴다. 어댑터는 실행 함수를 주입받아, 테스트는 가짜 실행 함수나 가짜 CLI 스크립트(`test/fixtures/cli/fake-cli.mjs`)를 쓴다.

CLI 실행 모듈 (`system/cli.ts`, phase 3):
- `runCli(req)`: 0이 아닌 exit code는 예외가 아니다(해석은 어댑터 몫). 실행 파일이 없으면 spawn 에러(code `ENOENT`)로, abort되면 `CliAbortError`(name `AbortError`, cause = signal.reason)로 끝난다. stdout·stderr는 각각 64MiB(`MAX_OUTPUT_BYTES`, 요청마다 `maxOutputBytes`로 바꿀 수 있다)를 넘으면 트리를 종료하고 `CliOutputLimitError`로 끝난다. 트리를 종료한 뒤 3초(`KILL_GRACE_MS`) 안에 파이프가 닫히지 않으면 더 기다리지 않는다.
- `cliEnv(base, set)`: 변수 이름은 모든 OS에서 대소문자를 무시하고 비교한다. set의 값은 대소문자만 다른 기존 변수를 대신하고, set에 API 키 변수가 있으면 throw한다. API 키 목록 `FORBIDDEN_ENV_KEYS`는 이 모듈에 있고 preflight가 가져다 쓴다.
  - 지우는 범위는 ADR-001의 API 키 두 개와 아래 Claude Code 세션 변수다. `ANTHROPIC_AUTH_TOKEN`·`ANTHROPIC_BASE_URL` 같은 다른 과금 경로 변수는 지우지 않는다(OPERATIONS "나중에 정할 것"). Bedrock·Vertex 전환 변수(`CLAUDE_CODE_USE_*`)는 `CLAUDE_CODE_` 접두어 규칙으로 지워진다.
  - Windows의 libuv는 env에 없는 PATH·SYSTEMROOT·TEMP·USERPROFILE 등 시스템 변수 11개를 부모 환경에서 채운다(비밀값 아님). "준 env만 넘긴다"는 Windows에서 이 변수들을 뺀 기준이다.
- `findOnPath(name)`: PATH(Windows는 PATHEXT까지)에서 찾고, 현재 디렉토리는 보지 않는다. Windows에서 돌려주는 경로의 확장자는 PATHEXT 표기 그대로다(`claude.CMD`처럼 대문자일 수 있다).
- `withTempDir(prefix, fn)`: OS 임시 폴더에 mkdtemp로 만들고 끝나면 지운다(재시도 5회). 지우기 실패는 무시한다. 이미 받은 생성 결과를 잃지 않기 위해서다.
- 알려진 한계: POSIX에서는 자식을 새 프로세스 그룹(detached)으로 띄워서 터미널 Ctrl+C(SIGINT)가 CLI에 가지 않는다. 파이프라인이 SIGINT를 받아 abort하지 않으면 CLI가 고아 프로세스로 남을 수 있다(개발 PC는 Windows라 같은 콘솔에서 함께 받는다). 정상 종료 뒤에도 트리 밖으로 빠져나간 손자 프로세스가 파이프를 쥐고 있으면 Runner 타임아웃(abort)까지 기다린다.

**Claude Code CLI** (2.1.296에서 플래그 확인)
```
claude -p --model <modelId> --effort high --tools "" --system-prompt "<system.md 내용>"
       --safe-mode --strict-mcp-config --no-session-persistence --output-format json
env: CLAUDE_CODE_MAX_OUTPUT_TOKENS=65536
```
- 구현: `pipeline/src/adapters/claude-code/`(adapter·errors·bin·preflight·recorder). 레지스트리 항목은 `createClaudeCodeEntry(overrides?)`로 만들고, 테스트는 `runCli`·`resolveBin`·`readVersion`·`env`를 가짜로 바꾼다. 항목을 만들 때는 아무것도 실행하지 않는다. `create()`가 실행 파일 찾기 → 버전 읽기를 하고(실패하면 throw, 모델 호출 없음), `preflight()`가 로그인을 점검한다.
- shell 없이 인자 배열로 spawn한다(한글 인자 인용 문제 방지). Windows에서는 npm shim(`claude.cmd`) 대신 실제 `claude.exe`(shim 옆 `node_modules/@anthropic-ai/claude-code/bin/claude.exe`)를 찾는다. 하네스 `scripts/execute.py`의 `resolve_claude_bin`과 같은 방식이다. 다만 shim 옆에 exe가 없으면 execute.py처럼 shim으로 대신하지 않고 에러로 멈춘다(shell 없이는 shim을 띄울 수 없다). `.cmd`·`.bat` 판별은 대소문자를 무시한다.
- `--safe-mode`: CLAUDE.md·skills·hooks·MCP 등 사용자 설정을 끄고, 구독 인증은 유지한다.
- **`--bare` 금지**: 인증이 ANTHROPIC_API_KEY로만 돼서 API 요금이 청구된다.
- 자식 환경: 공통 규칙(API 키 변수 삭제)에 더해, Claude Code 세션이 자식에게 물려주는 변수를 지운다 — `CLAUDECODE`, `CLAUDE_CODE_`로 시작하는 변수(아래 예외 제외), `CLAUDE_EFFORT`, `CLAUDE_PID`, `AI_AGENT`. 사람이 Claude Code 안에서 `! npm run gen`을 실행하면 이 변수들이 넘어와, 중첩 세션으로 보고 실행을 거부하거나(`CLAUDECODE`) 추론 강도가 섞일 수 있다(`CLAUDE_EFFORT`, 2026-10-13 이 PC에서 변수 이름 확인). 사용자 설정 변수 `CLAUDE_CONFIG_DIR`·`CLAUDE_CODE_GIT_BASH_PATH`는 남기고, 어댑터가 `CLAUDE_CODE_MAX_OUTPUT_TOKENS`를 넣는다.
- 버전: `claude --version` 출력 `2.1.296 (Claude Code)`의 앞 숫자. 레지스트리 `create()`가 동기라서 `spawnSync`로 읽는다(cwd는 OS 임시 폴더, 환경은 `cliEnv`, 30초 제한). 숫자를 못 읽으면 에러로 멈춘다. 지어낸 버전을 기록하지 않기 위해서다.
- 로그인 점검(preflight): `claude auth status --json`은 `{ loggedIn, authMethod, apiProvider, subscriptionType, email, orgId, orgName, … }`이다(2.1.296, 이 PC는 `authMethod: "claude.ai"`, `apiProvider: "firstParty"`, `subscriptionType: "pro"`). `loggedIn`이 true이고 `authMethod`가 `claude.ai`, `apiProvider`가 `firstParty`일 때만 통과한다.
  - 점검 이름 `Claude Code 로그인 (claude auth status)`, 30초 제한, OS 임시 폴더, `cliEnv` 환경. 로그아웃 상태는 exit code가 0이 아닐 수 있어서, 출력이 JSON이면 exit code와 관계없이 판정한다.
  - detail에는 authMethod·subscriptionType만 쓰고, 식별자 모양(`/^[\w.-]{1,40}$/`)이 아닌 값은 숨긴다. email·org·apiProvider 값은 쓰지 않는다. 출력이 JSON이 아니면 내용을 옮기지 않는다. 실행 실패도 throw하지 않고 실패 항목으로 돌려준다.
- 출력(`--output-format json`)은 stdout의 JSON 객체 하나다. stdout 전체가 JSON 객체 하나일 때만 파싱한다(앞뒤 공백만 허용 — 앞에 다른 줄이 오면 JSON이 아닌 출력 → `unknown`). 성공은 exit code 0 + `is_error: false` + 문자열 `result`일 때뿐이고, 그 밖은 모두 에러다. 하네스가 같은 CLI(2.1.296)로 받은 실제 출력에서 확인한 필드:
  - `type: "result"`, `subtype`, `is_error`, `result`(본문 또는 에러 메시지), `stop_reason`(`end_turn` 등), `terminal_reason`(`completed`·`api_error`), `api_error_status`(HTTP 상태 또는 null), `api_error`(예: `usage_limit_reached`), `num_turns`, `session_id`, `ttft_ms`, `total_cost_usd`
  - `usage`: `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens`, `output_tokens_details.thinking_tokens`
  - `modelUsage`: 모델 ID를 키로 한 사용량(`canonicalModel` 포함)
  - 구독 한도: exit code 1, `is_error: true`, `subtype: "success"`, `api_error_status: 429`, `api_error: "usage_limit_reached"`, `result: "You've hit your session limit · resets 8pm (Asia/Seoul)"` (fixture `pipeline/test/fixtures/claude-code/stdout-usage-limit.json`)
- 정규화(DATA "정규화 규칙"): 본문 = `result`. inputTokens = `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`. outputTokens = `output_tokens`, reasoningTokens = `output_tokens_details.thinking_tokens`(없으면 null) — 확인한 두 출력 모두 thinking ≤ output이라 output_tokens에 추론분이 들어 있다고 본다. requestId·firstTokenMs는 null(DATA: 스트리밍이 아닌 CLI).
  - 사용량 필드가 없거나 토큰 수가 아닌 값이면 입력·출력은 0, 추론은 null이다. thinking_tokens가 output_tokens보다 크면(포함 전제가 깨짐) 추론은 null로 둔다.
  - resolvedModelId: `modelUsage` 키가 하나면 그 키, 여럿이면 요청한 모델 ID와 같은 키 또는 `canonicalModel`이 같은 키, 고를 수 없으면 null.
  - stopReason: `end_turn` → end, `max_tokens` → max_tokens, `refusal` → refusal, 그 밖·없음 → other. rawStopReason은 원문 그대로.
- `runtime.generator.invocation`: `CLAUDE_CODE_MAX_OUTPUT_TOKENS=65536 claude -p --model <id> --effort high --tools "" --system-prompt "<system prompt>" --safe-mode --strict-mcp-config --no-session-persistence --output-format json (stdin: <user prompt>)`. 실제 인자를 만드는 같은 함수로 만든다. 실행 파일 경로(사용자 폴더가 들어 있다) 대신 `claude`라고 적고, 출력 상한이 null이면 환경변수 부분이 빠진다.
- 에러 분류: abort → `timeout`. `api_error`가 `usage_limit_reached`이거나 메시지가 사용 한도 문구("usage limit", "hit your session limit" 같은 "hit your … limit", "limit reached" — `rate limit`은 제외, execute.py `USAGE_LIMIT_RE`와 같은 기준)면 `usage_limit`. 그 밖에는 `api_error_status`로: 429 → `rate_limited`, 529·5xx → `server_error`, 401·403 → `auth`, 400 → `bad_request`. 실행 파일 없음·출력 상한 초과·JSON이 아닌 출력·그 밖 → `unknown`.
  - 한도 문구는 에러 결과(`is_error: true`)의 `result`와 stderr에서만 찾는다. 정상 결과의 `result`는 모델이 쓴 본문이라 같은 단어가 나올 수 있어서 보지 않는다.
  - message: 에러 결과의 `result` → stderr → exit code·출력 모양 설명 순서로, 500자까지. `retryAfterMs`는 항상 null이다. `usage`는 실패 출력에 입력+출력 > 0인 사용량이 있을 때만 담는다.
- smoke 기록기: 생성 호출만 감싸서 `raw-stdout.txt`(stdout 그대로, fixture `stdout-*.json`으로 그대로 복사할 수 있다)·`raw-stderr.txt`(redact)·`raw-exit.json`(`{ exitCode, signal }`, redact)을 낸다. 실행 함수가 던졌으면(실행 파일 없음·abort·출력 상한 초과) `raw-exit.json`에 `error { name, message, code }`만 남는다. 버전 읽기·로그인 점검은 기록하지 않는다.
- smoke로 확인한 것(2026-10-13, claude-haiku-5-5, Claude Code 2.1.296, 원본은 fixture `stdout-smoke-ok.json`):
  - 사람이 Claude Code 안에서 `! npm run smoke`로 실행해도 중첩 세션 거부 없이 돈다(`cliEnv`가 세션 변수를 지운 환경). preflight 통과(`authMethod: claude.ai`, `subscriptionType: pro`).
  - exit code 0, stderr 비어 있음, stdout은 JSON 객체 한 줄 + 끝 줄바꿈이다. `stop_reason: "end_turn"`, `terminal_reason: "completed"`. 걸린 시간 3.3초(CLI `duration_ms` 1,171).
  - `modelUsage` 키는 요청한 모델(`claude-haiku-5-5`) 하나이고 `canonicalModel`도 같다 → resolvedModelId = 요청 모델 ID.
  - 입력 655토큰 = `input_tokens` 2 + `cache_creation_input_tokens` 653(1시간 캐시) + `cache_read_input_tokens` 0. 입력 전부가 캐시 생성분으로 온다 — 비용은 ADR-008대로 전부 입력 정가로 계산한다. 같은 smoke 프롬프트(system·user 모두 2026-10-12 이후 그대로)가 Gemini에서는 35토큰이었으므로, 토크나이저 차이를 감안해도 Claude Code가 프롬프트 밖의 내용을 대략 600토큰 더 보낸다. 무엇인지는 출력으로 알 수 없다. 기본 지시문(수천 토큰 이상)은 `--system-prompt`로 교체된 것으로 본다(토큰 수로 미루어 본 추정).
  - `output_tokens_details.thinking_tokens`는 0이다(필드는 있다 → reasoningTokens 0). "Hello" 요청이라 추론하지 않은 것인지 `--effort high`가 적용되지 않은 것인지는 출력으로 구분할 수 없다(출력에 effort 필드가 없다).
  - 위 목록에 없던 필드: `uuid`, `ttft_stream_ms`, `time_to_request_ms`, `first_content_frame_ms`, `fast_mode_state`(`"off"`), `permission_denials`, `subagent_stats`, `safety_stops`(0), `queued_turn_count`, `result_index`. 어댑터는 쓰지 않는다.
- ⚠ 아직 실제 출력으로 확인하지 못한 것(합성 fixture 그대로): 출력 상한 도달(`stop_reason: max_tokens`인지, 에러로 끝나는지)·거부(`refusal`인지, `safety_stops`와 관계있는지)가 어떻게 나오는가 — 지금은 `is_error: false` + `stop_reason`으로 가정했고, 모르는 값은 stopReason `other`로 둔다. `--effort high`가 적용되는가 — 첫 실제 생성의 reasoningTokens로 본다. API 키 로그인일 때 `authMethod` 값. 529·401 출력의 `api_error` 값과 `result` 문구(에러는 smoke로 일부러 만들 수 없으니 실제로 만나면 옮긴다). 시스템 프롬프트 끝 줄바꿈이 Windows 인자로 그대로 가는지는 출력으로 확인할 수 없다.

**Codex CLI** (0.157.1. 플래그는 `codex exec --help`, 이벤트 형식·설정 키·에러 문구는 이 버전의 공개 소스 `openai/codex` 태그 `rust-v0.157.1`로 확인, 2026-10-13)
```
codex exec --model <modelId> --sandbox read-only --skip-git-repo-check --ephemeral
           --ignore-user-config --ignore-rules --json
           -o <tmp>/last-message.txt -C <tmp>/work
           -c model_reasoning_effort="high" -c model_instructions_file="<tmp>/instructions.md"
           -c include_environment_context=false -c include_apps_instructions=false
           -c include_collaboration_mode_instructions=false -c skills.include_instructions=false -
```
- Codex는 에이전트라 응답 대신 파일을 쓸 수 있다. read-only 샌드박스와 빈 디렉토리에서 실행해 답을 텍스트로 받는다. 마지막 `-`는 프롬프트를 stdin에서 읽으라는 뜻이다.
- 실행 파일: PATH의 `codex`. Windows의 npm 전역 설치는 `codex.cmd` shim → `node <shim 폴더>/node_modules/@openai/codex/bin/codex.js` → 플랫폼 패키지(`@openai/codex-win32-x64`)의 `codex.exe` 순서로 실행된다. shell 없이 띄우려고 shim 옆의 `codex.js`를 지금 실행 중인 Node(`process.execPath`)로 실행한다. 공식 실행기가 넣는 `CODEX_MANAGED_*` 환경 변수와 신호 전달을 그대로 쓰기 위해서다. `codex.js`가 없으면 사람이 읽을 에러로 멈춘다. POSIX는 PATH의 `codex`(`codex.js`로 가는 링크, shebang)를 그대로 띄운다. invocation 기록에는 `codex`라고 적는다.
- 버전: `codex --version` 출력 `codex-cli 0.157.1`의 숫자. 못 읽으면 에러로 멈춘다.
- 작업 폴더: 매 시도 임시 폴더 하나에 빈 작업 폴더(`work/`, `-C`), 지시문 파일(`instructions.md`), 마지막 메시지 파일(`last-message.txt`)을 따로 둔다. 작업 폴더에는 아무것도 두지 않는다.
- 시스템 프롬프트(ADR-005): `req.system`을 `instructions.md`에 UTF-8로 쓰고 `model_instructions_file`로 넘긴다. 0.157.1 소스에서 이 키가 기본 지시문을 교체함(요청의 `instructions` 필드)을 확인했다. Codex는 파일 내용의 앞뒤 공백을 지워서 보내므로 끝 줄바꿈이 빠진다(도구 차이로 둔다). 빈 파일이면 Codex가 에러로 멈춘다.
- `-c` 값은 TOML로 읽힌다. 문자열은 큰따옴표로 감싸고, 경로는 슬래시(`/`)로 바꿔 넘긴다(Windows 역슬래시가 TOML 이스케이프로 읽히지 않게, 업스트림 테스트와 같은 방식). 불리언은 따옴표 없이 쓴다.
- 덧붙는 블록(ADR-027): `--ignore-user-config`는 `$CODEX_HOME/config.toml`(사용자 기본 모델·추론 강도·personality·service_tier 등)만 무시하고 인증은 `CODEX_HOME`을 그대로 쓴다. 사용자 폴더의 스킬 목록·실행 환경 정보·앱·작업 방식 안내는 위 `include_*=false`·`skills.include_instructions=false`로 끈다. 읽기 전용 샌드박스 안내(`include_permissions_instructions`)와 도구 정의는 남는다.
- 출력 상한을 지정할 수 없다 → `maxOutputTokens: null`, 사이트 † 각주.
- 자식 환경: 공통 `cliEnv`(API 키·Claude Code 세션 변수 삭제). `CODEX_HOME`은 남긴다(인증).
- 로그인 점검(preflight): `codex login status`는 결과를 **stderr** 한 줄로 쓴다. `Logged in using ChatGPT`(exit 0)일 때만 통과한다(2026-10-13 이 PC 출력 확인). 그 밖의 문구(소스 기준): `Logged in using an API key - <가린 키>`(exit 0), `Not logged in`(exit 1), `Logged in using access token`·`personal access token`·`Amazon Bedrock …`(exit 0), `Error checking login status: …`(exit 1) — 모두 실패다. API 키 문구의 키 부분은 출력·기록하지 않는다.
- 출력(`--json`): stdout에 이벤트 JSON이 한 줄에 하나씩(JSONL) 온다. `type`은 `thread.started`(`thread_id`), `turn.started`, `item.started`·`item.updated`·`item.completed`(`item`: `id` + `type` `agent_message`(`text`)·`reasoning`·`command_execution`·`file_change`·`mcp_tool_call`·`web_search`·`todo_list`·`error` 등), `turn.completed`(`usage`), `turn.failed`(`error.message`), `error`(`message`)다. exec는 턴 하나로 끝난다(`turn.completed`나 `turn.failed` 뒤 종료).
- 성공: exit code 0 + `turn.completed` + `last-message.txt`가 있을 때뿐이다. `last-message.txt`는 턴이 완료됐을 때만 쓰인다.
- 정규화(DATA "정규화 규칙"):
  - 본문 = `last-message.txt` 내용.
  - 사용량 = **마지막** `turn.completed`의 `usage`. 턴별 값이 아니라 스레드 누적 합계라서 더하지 않는다. 값은 OpenAI Responses API usage를 그대로 옮긴 것이다(소스 `codex-api` `From<ResponseCompletedUsage>`).
  - inputTokens = `input_tokens`(이미 `cached_input_tokens`·`cache_write_input_tokens`를 포함한다 — 더하지 않는다). outputTokens = `output_tokens`(추론 포함), reasoningTokens = `reasoning_output_tokens`. 필드가 없거나 숫자가 아니면 Claude Code와 같이 0·null로 떨어뜨린다.
  - stopReason: 이벤트에 모델이 멈춘 이유가 없어 `other`, rawStopReason은 `turn.completed`. resolvedModelId·requestId·firstTokenMs는 null(이벤트에 없다).
- 에러 분류: HTTP 상태 필드가 없고 `turn.failed`·`error` 이벤트의 message 문자열뿐이다(httpStatus는 메시지의 `unexpected status NNN`에서 읽고, 없으면 null). 위에서부터 처음 맞는 것:
  - abort → `timeout`
  - 한도: `You’ve hit your usage limit…`(굽은 따옴표), `Quota exceeded` 또는 공통 한도 문구(`USAGE_LIMIT_RE`) → `usage_limit`
  - `Incomplete response returned`(출력 잘림·필터) → `unknown`(재시도하지 않는다, 아래 한계)
  - `rate limit exceeded`·`unexpected status 429` → `rate_limited`
  - `unexpected status 5xx`·`high demand`·`at capacity` → `server_error`
  - `stream disconnected`·`Connection failed` → `network`
  - `unexpected status 401|403`·`Not logged in`·`upgrade to Plus` → `auth`
  - `unexpected status 400` → `bad_request`
  - 실행 파일 없음·JSON이 아닌 줄·그 밖 → `unknown`
- smoke 기록기: Claude Code와 같다. `raw-stdout.txt`(JSONL 그대로)·`raw-stderr.txt`·`raw-exit.json`.
- 알려진 한계: Codex는 스트림 끊김을 스스로 재시도하고 끌 수 없다. 출력 잘림·필터(`response.incomplete`)도 스트림 에러로 바뀌어 재시도된 뒤 실패하고, 받은 원문은 남지 않는다 → `api_failed`. 출력 상한을 지정할 수 없어(모델 기본값) 실제로 잘릴 가능성은 낮다.
- ⚠ smoke로 확인: 입력 토큰 규모(도구 정의·샌드박스 안내가 남는다 — 수천 개면 무엇이 남는지 본다). Hello 요청에도 `reasoning_output_tokens`가 나오는가(`model_reasoning_effort` 적용). `output_tokens`가 추론분을 포함하는가(소스상 포함). 모델이 명령 실행·파일 쓰기(item 종류)를 시도하는가. stderr에 무엇이 나오는가. 실제 한도·에러 문구.

**Gemini API** (`@google/genai` SDK, `.env`의 GEMINI_API_KEY)
- `.env`는 `dotenv.parse`로 읽어 설정 객체로만 쓰고 `process.env`에는 넣지 않는다. Claude·Codex 자식 프로세스로 키가 넘어가지 않게 하려는 것이다.
- 구현: `pipeline/src/adapters/gemini/`(SDK 2.28.0 타입 기준). `models.generateContentStream`, `config = { systemInstruction: system.md, thinkingConfig: { thinkingLevel: HIGH }, maxOutputTokens: 65536(thinking 포함 상한), abortSignal }`.
- 클라이언트는 `vertexai: false`(환경변수로 백엔드가 바뀌지 않게), `retryOptions.attempts: 1`(SDK 재시도 끔 — 재시도는 Runner 책임)로 만든다. 키가 비어 있으면 SDK가 환경변수 키로 대신 쓰지 않게 만들기 전에 멈춘다.
- 본문은 `thought: true`가 아닌 텍스트 part를 이어 붙인 것이다. inputTokens = `promptTokenCount`(SDK 주석상 캐시분 포함) + `toolUsePromptTokenCount`, outputTokens = `candidatesTokenCount` + `thoughtsTokenCount`, reasoningTokens = `thoughtsTokenCount`(없으면 null).
- stopReason: `STOP` → end, `MAX_TOKENS`·`CONTINUATION`(요청당 토큰 한도로 미완성) → max_tokens, 안전·정책 계열(`SAFETY`·`RECITATION`·`BLOCKLIST`·`PROHIBITED_CONTENT`·`SPII`·`IMAGE_*`)과 `promptFeedback.blockReason` → refusal, 그 밖 → other.
- 에러: 429 → `rate_limited`(재시도), 단 QuotaFailure의 quotaId에 `PerDay`가 있으면 일일 할당량 소진 → `usage_limit`(재시도 안 함). 401·403·키 무효 표시 → `auth`, 400 → `bad_request`, 5xx → `server_error`, 그 밖 4xx → `unknown`, 연결 오류 → `network`, abort → `timeout`. RetryInfo `retryDelay`("37s")가 있으면 `retryAfterMs`로 쓴다. 에러 메시지에서 API 키 모양(`key=…`, `AIza…`)은 가린다.
- smoke로 확인한 것(2026-10-12, gemini-3.8-flash, SDK 2.28.0, 원본은 fixture `stream-smoke-ok.jsonl`):
  - 무료 티어 키로 인증된다. `thinkingLevel: HIGH` 요청이 거부되지 않는다(Hello 요청에 thought 561토큰).
  - `usageMetadata`는 청크마다 누적값으로 온다. `promptTokenCount + candidatesTokenCount + thoughtsTokenCount = totalTokenCount`(35 + 20 + 561 = 616)라서, 위의 출력 정규화가 맞다. 응답에 `serviceTier` 필드가 있다.
  - 마지막 청크에 `finishReason: STOP`과, 빈 text에 `thoughtSignature`만 있는 part가 온다. thought 본문 part는 오지 않는다.
  - 입력은 35토큰이다(도구 기본 지시문이 섞이지 않음). systemInstruction이 실제로 적용됐는지는 이 토큰 수로 미루어 본 것이다(추정).
- ⚠ 아직 실제 출력으로 확인하지 못한 것(합성 fixture 그대로): STOP 외 finishReason, 캐시 토큰이 있을 때의 usage, 429의 짧은 한도와 일일 할당량을 구분하는 표시, 키 무효 표시, retryDelay 형식, 스트림 도중 에러 메시지 형식. 에러는 smoke로 일부러 만들 수 없다. 실제로 만나면 smoke의 `raw-error.json`이나 meta.json의 에러 message를 fixture로 옮긴다.
- 2027-01-01부터 정가가 2배가 된다. 비용은 `models.json`의 `pricing.asOf` 시점 가격으로 계산한다.

**smoke** (`npm run smoke -- <slug>`): "Hello" HTML 한 장을 요청하는 짧은 프롬프트, 출력 상한 8,000. `results-smoke/<slug>-<timestamp>/`에 meta.json과 함께 **도구의 원본 stdout을 그대로 저장**한다. 사람이 확인한 뒤 어댑터 테스트 fixture로 복사하는 용도다(⚠ 항목을 실제 출력으로 확정).
- 프롬프트는 `id: smoke`, `version: v1`이다. system은 실제 `season-tree-v1.system.md`(지시문 교체가 적용되는지 보려고), user는 짧은 Hello 요청이다.
- 재시도 없이 1회 호출하고, 시도당 타임아웃은 5분이다. preflight는 git clean 검사만 빼고 똑같이 한다(HEAD는 읽으므로 커밋이 한 번은 있어야 한다). 폴더 시각은 실행 PC의 로컬 시각 `YYYYMMDD-HHmmss`다.
- 원본 출력은 core 어댑터 인터페이스를 바꾸지 않고 저장한다. 레지스트리 항목의 `createRecorder`가 어댑터에 주입하는 프로세스 실행 함수·SDK 클라이언트를 기록용 래퍼로 감싸고, Runner가 끝난 뒤 `raw-*` 파일로 쓴다. Gemini는 `raw-stream.jsonl`(청크 한 줄씩)과 `raw-error.json`(`{status, body, …}`)이다. 두 파일은 fixture 형식(`stream-*.jsonl`, `error-*.json`)과 같아서 그대로 복사할 수 있다. Claude Code는 `raw-stdout.txt`·`raw-stderr.txt`·`raw-exit.json`이다(위 "Claude Code CLI"의 smoke 기록기). Codex(phase 4)도 같은 이름을 쓴다.
- 종료 코드: outcome이 `api_failed`이면 1이다(점검 명령이라서 — batch는 0). 끝에 사용량·rawStopReason·resolvedModelId를 출력하고, 입력 토큰이 2,000을 넘으면 경고한다.
- 알려진 한계: 타임아웃이면 SDK의 abort 에러가 기록되기 전에 파일을 써서 `raw-error.json`이 빠질 수 있다(그때까지 받은 청크는 남는다). 같은 초에 다시 실행하면 폴더가 비어 있지 않아 모델을 부르기 전에 거부된다.

## 검증기 (Playwright, `pipeline/src/validation/`)

- 로컬 정적 서버(127.0.0.1)를 띄우고, 사이트와 **같은 조건**으로 `<iframe sandbox="allow-scripts" src=".../results/<slug>/index.html">`(1280×800)을 담은 검증용 페이지를 연다. sandbox 값은 core 상수 `RESULT_IFRAME_SANDBOX` 하나를 사이트와 함께 쓴다. 서버는 그 모델의 결과물만 내준다.
- 대상: meta.json이 스키마를 통과하고 `outcome`이 `ok`인 모델만.
- 기록: `loaded`(iframe load 이벤트, 30초 제한), `consoleErrors`(console error), `pageErrors`(처리되지 않은 예외), `externalRequests`(로컬 서버가 아닌 http(s) 요청의 url·resourceType, 요청 순서대로. data:·blob:은 넣지 않는다). iframe 안의 이벤트까지 잡히는지 테스트로 확인한다.
- 스크린샷: iframe load를 0초로 5·15·25·35초에 iframe 영역만 찍는다(spring/summer/autumn/winter). Playwright의 JPEG(`type: 'jpeg'`, quality 80)로 `results/<slug>/<label>.jpg`에 바로 저장한다. 변환 라이브러리는 쓰지 않는다. 기록하는 `atMs`는 계획한 시점(5000·15000·…)이다.
- load가 30초 안에 오지 않으면 `loaded: false`로 기록하고, 그 시점을 0초로 스크린샷 4장은 그대로 찍는다(방문자가 보는 화면을 남긴다).
- headless Chromium WebGL: launch 인자 `CHROMIUM_ARGS` = `--enable-unsafe-swiftshader --use-angle=swiftshader`. Playwright 1.64는 `--enable-unsafe-swiftshader`를 macOS에서만 기본으로 넣어서 명시한다. Windows(playwright 1.64.0, headless shell 156.0.8078.4)에서 WebGL 픽스처로 webgl2 · ANGLE(Vulkan SwiftShader)를 확인했다(2026-10-12). 리눅스 CI(GitHub Actions `ubuntu-latest`, chromium 156.0.8078.4)에서도 같은 값(webgl2 · ANGLE Vulkan 1.3.0 SwiftShader)을 확인했다(2026-10-13 첫 배포).
- load 감지: 검증용 페이지의 iframe `onload` 속성이 window 플래그를 세우고, `waitForFunction`(제한 30초)으로 기다린다. `page.goto`는 `domcontentloaded`까지만 기다린다(top의 load는 iframe load를 기다리기 때문). 서버는 `/`(검증용 페이지)와 `/results/<slug>/index.html`만 내주고 나머지는 404다.
- 검증 결과는 `meta.json`의 `validation`만 갱신한다. 다른 필드·judgment.json·결과물은 건드리지 않고, 저장 전에 스키마로 검사한다. 재검증하면 스크린샷을 덮어쓴다.
  - 스크린샷은 메모리에 받아 두고, 검증이 끝까지 성공한 뒤에만 jpg와 meta.json을 쓴다(도중에 실패하면 파일이 바뀌지 않는다).
  - meta.json은 읽은 원본 객체에서 `validation`만 바꿔 Runner와 같은 형식(2칸 들여쓰기 + 끝 줄바꿈, 키 순서 유지)으로 쓴다. `checkedAt`은 검증이 끝난 시각, `pageErrors`는 에러의 message(타입 이름 없음)다.
- 알려진 한계: 메인 스레드를 막는 결과물(무한 루프)은 스크린샷이 Playwright 기본 제한(30초)에 걸려 검증이 실패하고 `validation`이 null로 남는다 → "검증 전" → check:results가 배포를 막는다. 실제로 만나면 처리 방법을 정한다.
- Nest 컨텍스트를 만들 때는 브라우저를 띄우지 않는다. 검증할 때 띄우고 끝나면 닫는다.
- `npm run validate -- <slug…> | --all`(`validate.ts`·`validate.service.ts`): 모델을 부르지 않으므로 preflight는 없다.
  - `--all`은 outcome이 ok인 모델 전부이고, 나머지와 "생성 전"(meta.json 없음)은 건너뜀으로 출력한다.
  - slug를 직접 줬는데 ok가 아니거나 meta.json이 없으면 실패로 보고하고 다음 모델을 계속한 뒤 exit 1이다. 모르는 slug면 아무것도 하지 않고 exit 1.
  - meta.json이 깨진 모델은 `--all`이어도 실패(exit 1)다. outcome을 알 수 없어 사람이 확인해야 한다.
  - 요약은 운영자용 `loaded · 콘솔 에러 N · 페이지 에러 N · 외부 요청 N`이다(사이트의 "에러 수" 규칙과 따로 보여 준다).
- 테스트: `test/fixtures/`의 로컬 HTML로 실행하고, 외부 URL은 `page.route`로 가로채 가짜 응답을 준다. 테스트에서 실제 네트워크를 쓰지 않는다. 스크린샷 시점·load 제한 시간은 주입해서 짧게 돌린다.

## 판정 도우미 (`npm run judge -- <slug>`)

- `outcome`이 `ok`이고 결과물이 있는 모델만 판정할 수 있다.
- 결과물 경로·스크린샷 경로·판정 기준 요약을 보여 주고, 요구사항 4개(pass/partial/fail)와 메모(1~200자)를 입력받는다.
- `modelSlug`, `prompt`(id·version), `outputSha256`(meta.json의 `output.sha256`), `judgedAt`(KST 오프셋)은 자동으로 채운다. 저장 전에 `JudgmentSchema`로 검사한다.
- 기존 판정이 있으면 내용을 보여 주고 덮어쓸지 확인받는다.
- 테스트용으로 같은 값을 플래그로도 받는다: `--scene --cycle --look --label --note --yes`.

## 사이트 (Astro, `site/`)

- 정적 출력(`output: 'static'`). 페이지: `/`(결과 탭, 첫 화면), `/compare/`, `/prompt/`, `/intro/`, `/view/<slug>/`(새 창용 전체 화면 래퍼). 헤더에는 페이지가 있는 탭만 둔다(ADR-024 — phase 2~4는 결과 탭 하나).
- **데이터는 빌드 때만 읽는다**: `core/src/results.ts`로 `models.json`·`results/`·`prompts/`를 읽고 검증·조인해서, 표시 값은 `core/src/display.ts`로 만든다. 빌드 때 검사하는 범위는 DATA.md "사이트 빌드의 데이터 검사".
  - 데이터 위치는 `site/src/lib/data.ts` 한 곳에서 정한다: `OPB_DATA_ROOT`(빈 문자열은 미설정) 또는 레포 루트. 테스트는 OS 임시 디렉토리에 만든 데이터를 가리킨다. 번들 뒤에는 `import.meta.url`이 바뀌므로, 레포 루트는 `astro.config.mjs`가 `vite.define`의 `__OPB_REPO_ROOT__`로 넘긴다.
  - 빌드는 `loadResults`를 한 번만 부르고(로그 `[opb] data: N models from <root>`), dev는 요청마다 다시 읽는다.
- 빌드 때 `results/<slug>/index.html`과 `response.txt`를 `dist/r/<slug>/`로 바이트 그대로 낸다. 스크린샷(jpg)·meta.json·judgment.json은 내지 않는다.
  - 방법: 정적 endpoint `src/pages/r/[slug]/index.html.ts`·`response.txt.ts`. Astro가 endpoint 본문을 그대로 쓰므로 BOM·CRLF·잘못된 UTF-8도 바뀌지 않는다(테스트로 확인). `npm run dev`에서도 같은 주소로 열린다. `site/public/`에 복사하지 않는다.
  - 원본 경로는 meta.json 값이 아니라 `results/<slug>/index.html`·`response.txt`로 고정이다(check:results가 meta.json의 경로가 이 값인지 검사한다).
- **결과물 실행은 항상 `<iframe sandbox="allow-scripts">` 안에서만.** `allow-same-origin`을 절대 넣지 않는다. GitHub Pages는 사용자 계정의 모든 Pages 사이트가 한 출처(`<user>.github.io`)를 쓰기 때문이다. "새 창에서 열기"는 `/view/<slug>/`(같은 샌드박스 iframe을 화면 가득)로 연다. 결과물 파일을 직접 링크하지 않는다.
- 결과 탭의 모델 전환 (`src/lib/results-view.ts`, `src/scripts/results-tab.ts`):
  - 첫 선택 모델(ADR-025)은 빌드 때 HTML로 그린다. 모델 전부의 표시 값(`ResultView`)은 `<script type="application/json" id="result-views">`로 넣고(`<`는 `<`로 이스케이프), 클라이언트는 그 값을 그대로 옮긴다. 라벨·포맷을 클라이언트에서 다시 계산하지 않는다.
  - 결과물 iframe은 페이지에 하나다. 결과물이 없는 모델을 고르면 iframe을 문서에서 떼어 내서 앞의 결과물이 멈추게 하고, 결과물이 있는 모델을 고르면 src를 먼저 바꾼 뒤 다시 붙인다(한 번만 로드). "다시 시작"은 같은 src를 다시 설정한다. 이미 고른 모델을 다시 누르면 아무것도 하지 않는다.
  - 결과물이 없는 모델은 이유를 보여 주고, 응답 원문(response.txt)은 그 모델을 고를 때 `fetch`로 불러온다(첫 화면 용량을 줄이기 위해). 늦게 온 앞 모델의 원문은 버리고, 받은 원문은 캐시한다.
- site 테스트가 쓰는 DOM 계약(바꾸면 테스트도 함께 바꾼다): `[data-results-tab]`, `button[data-slug][aria-pressed]`, `[data-field=…]`, `dd[data-req=<key>][data-mark]`, `dd[data-record=<key>]`, `[data-action=restart|open]`.
- 클라이언트 동작(모델 전환, 다시 시작, 복사 버튼, 휴대폰 드롭다운)은 Astro `<script>`의 순수 TypeScript로 만든다. UI 프레임워크(React 등)는 쓰지 않는다.
- 스타일: Astro 컴포넌트 scoped CSS + `:root` CSS 변수(토큰은 UI_GUIDE.md). Tailwind는 쓰지 않는다.
- GitHub Pages 프로젝트 경로: `astro.config`의 `site`·`base`를 환경변수(`SITE_URL`, `SITE_BASE`)에서 읽는다. 워크플로가 레포 이름으로 채운다. 모든 내부 링크·에셋은 `import.meta.env.BASE_URL` 기준으로 만든다.

## 배포 (`.github/workflows/deploy.yml`)

- 트리거: main push + `workflow_dispatch`(수동 실행 버튼). 동시 실행은 `concurrency: pages`로 하나만.
- 순서: `npm ci` → `npx playwright install --with-deps chromium` → `npm run lint` → `npm run typecheck` → `npm test` → `npm run check:results` → `actions/configure-pages` → `npm run build` → `actions/upload-pages-artifact` → `actions/deploy-pages`. **하나라도 실패하면 배포하지 않는다.**
- `SITE_BASE`: configure-pages의 `base_path`는 `/<레포 이름>`(끝 슬래시 없음)이거나, 사용자 사이트·사용자 도메인이면 빈 값이다. `astro.config.mjs`의 `normalizeBase`(export, `site/test/astro-config.test.ts`)가 `/<레포 이름>/`·`/`로 맞춘다. Git Bash에서 손으로 `SITE_BASE=/x`를 넘기면 MSYS가 `C:/Program Files/Git/x`로 바꾸므로 `MSYS2_ENV_CONV_EXCL='*'`를 함께 준다(CI 리눅스는 해당 없음).
- 워크플로 환경에 `ASTRO_TELEMETRY_DISABLED=1`을 둔다. `astro check`·`astro build`는 기본으로 사용 통계를 보낸다(site 테스트의 빌드 헬퍼는 이미 끈다).
- 구성: `ubuntu-latest`, Node 24(`actions/setup-node`, npm 캐시). 권한은 `contents: read`, `pages: write`, `id-token: write`만. `SITE_URL`·`SITE_BASE`는 `actions/configure-pages`의 출력(`origin`, `base_path`)에서 채운다. 빌드 job이 `site/dist`를 올리고, 배포 job(`environment: github-pages`)이 `actions/deploy-pages`로 배포한다.
- 워크플로는 비밀값(`secrets.*`)을 쓰지 않는다. 모델을 부르는 명령(gen·smoke)과 results를 바꾸는 명령(validate·judge)은 넣지 않는다.
- `site/test/deploy-workflow.test.ts`가 워크플로를 yaml 파서로 검사한다. 워크플로를 고치면 이 테스트도 함께 고친다.
  - 트리거·권한·concurrency·env 값, job 두 개(build·deploy), build 단계 순서, 액션 다섯 개의 메이저 태그를 그대로 검사한다.
  - 어디에도 `if`·`continue-on-error`가 없고, job에 `permissions`·`uses`가 없어야 한다.
  - 파일 전체 문자열(주석 포함)에 `gen`·`generate`·`smoke`·`validate`·`judge`·`claude`·`codex` 단어와 `API_KEY`·`ANTHROPIC`·`OPENAI`·`GEMINI`·`GITHUB_TOKEN`·`secrets.`가 없어야 한다. 주석에 이 단어를 써도 실패한다.
  - step id는 configure-pages가 `pages`, deploy-pages가 `deployment`다(출력을 참조한다).
- CI(리눅스)에서만 도는 테스트: 검증기 WebGL 픽스처(위 "검증기"), CLI 실행 모듈의 POSIX 분기(프로세스 그룹 SIGKILL, `findOnPath` 실행 권한), `claude-code-bin`의 POSIX 실행 파일 테스트(Windows에서는 건너뜀). 2026-10-13 첫 배포(run 38334877323)에서 모두 통과했다(테스트 86·275·53개, 실패·건너뜀 0). build 1분 34초, deploy 26초.
- `ubuntu-latest`는 2026-10-19부터 Ubuntu 26으로 바뀐다(Actions 안내). 그 뒤 첫 배포가 실패하면 `playwright install --with-deps`의 Ubuntu 26 지원부터 본다.
- CI는 실제 모델을 부르지 않는다 (gen·smoke는 워크플로에 없다).
- 한도 참고: Pages 사이트 1GB, 대역폭 월 100GB(권장), 배포 10분. 공개 레포의 Actions는 무료.

## 테스트 전략

- 러너: 모든 워크스페이스에서 `node:test` + `tsx` (`tsx --test`). 기존 core 테스트와 같은 방식이다.
- **실제 CLI·API를 부르는 테스트를 만들지 않는다.** 어댑터는 자식 프로세스 실행 함수나 SDK 클라이언트를 주입받는다. 테스트는 CLI 원본 출력 fixture(`pipeline/test/fixtures/`)를 먹여 파싱·분류를 검증한다.
- 시간은 주입한다(`RunnerDeps.now/sleep`). 테스트에서 실제로 기다리지 않는다.
- 파일을 쓰는 테스트는 OS 임시 디렉토리(`mkdtemp`)에서 한다. 레포의 `results/`를 읽거나 쓰지 않는다.
- 테스트 데이터는 `@opb/core/testing`(`makeDataRoot`·`writeResult`·`STATUS_CASES` 등)으로 OS 임시 디렉토리에 만든다. "검증 전"은 check:results 규칙 6에 걸리므로, 통과해야 하는 데이터에는 넣지 않는다.
- 검증기: 실제 Chromium으로 `pipeline/test/fixtures/validation/`의 로컬 HTML을 연다(WebGL 픽스처 포함). 외부 요청은 `page.route`로 가로챈다.
- 사이트: `OPB_DATA_ROOT`를 픽스처로 두고 빌드한 뒤, `dist/` HTML을 검사한다(샌드박스 속성, `{N}` 치환, 각주, 상태 라벨 등). 브라우저 테스트는 dist를 임시 정적 서버(base 경로 포함)로 띄우고 클릭·키보드로 확인한다.
  - 빌드 헬퍼 `site/test/support/build.ts`의 `buildSite(dataRoot, {base})`가 `astro build --outDir <임시>`를 자식 프로세스로 돌린다. 같은 (데이터 루트, base)는 한 번만 빌드해 공유하고, 프로세스 안에서는 큐로 하나씩, 테스트 파일끼리는 `--test-concurrency=1`로 순차 실행한다(`.astro`·Vite 캐시 충돌 방지).
- 하네스(Python): `python -m pytest scripts`.

## NestJS 사용 규칙

- `NestFactory.createApplicationContext(AppModule)`만 쓴다. HTTP 서버를 띄우지 않는다.
- **생성자 주입은 `@Inject(TOKEN)`을 명시한다.** tsx(esbuild)는 `emitDecoratorMetadata`를 지원하지 않아서, 타입 기반 주입은 테스트·실행에서 조용히 undefined가 된다. `experimentalDecorators: true`, `import 'reflect-metadata'`.
- 도메인 로직은 core의 순수 함수로 두고, Nest provider는 그것을 감싸 I/O(프로세스·파일·브라우저)를 주입하는 얇은 층으로 둔다.

## 버전 참고 (설치한 값)

typescript ^6.0.3(ADR-023 — 7은 typescript-eslint 미지원), tsx ^4.23.15, zod ^4.6.5(`z.iso.datetime`, `z.url()` 사용), @types/node ^26.6.4, ESLint ^10.12 + typescript-eslint ^8.71.1, NestJS ^12.1.2(@nestjs/common·core, reflect-metadata ^0.2.2, rxjs ^7.8.2), @google/genai ^2.28.0, dotenv ^18.0.7. Node ≥ 22 (개발 PC는 24.14).
TS 6은 `types` 기본값이 `[]`라 `tsconfig.base.json`에 `types: ["node"]`를 둔다.

phase 2에서 설치한 값: astro ^7.3.8(Vite 8.3.4, Node ≥ 22.12 요구 → 루트 `engines`도 `>=22.12`), @astrojs/check ^0.9.10, playwright ^1.64.0(라이브러리만 쓰고 `@playwright/test` 러너는 쓰지 않는다. 브라우저는 `npx playwright install chromium`).
- @astrojs/check 0.9.10은 TS 6.0.3과 동작한다. astro check는 `site/test`의 `.ts`도 검사한다. site tsconfig = `astro/tsconfigs/strict` + `types: ["node"]` + `noUncheckedIndexedAccess`.
- `@opb/core`가 TS 소스를 직접 내보내도 Astro build·dev와 astro check(Bundler 해석)에서 추가 설정 없이 해석된다. `@opb/core/testing`은 tsx와 tsc(NodeNext) 모두에서 해석된다.

phase 3 계획 때(2026-10-13) 확인한 GitHub Actions 최신 메이저: `actions/checkout@v7`, `actions/setup-node@v7`, `actions/configure-pages@v6`, `actions/upload-pages-artifact@v5`, `actions/deploy-pages@v5`. Claude Code CLI 2.1.296.
phase 3에서 설치한 값: yaml ^2.9.1(site devDependencies, 워크플로 테스트용 — astro가 이미 쓰는 버전이라 lock은 한 줄만 바뀌었다).
