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
│   ├── src/results.ts              (신규) results/ 읽기·검증·조인 — 사이트와 check:results가 공유
│   ├── src/display.ts              (신규) 상태 라벨·숫자 포맷 등 표시 규칙 (DATA.md "표시 규칙")
│   ├── scripts/check-results.ts    (신규) `npm run check:results` — Nest 없이 core만 쓴다
│   ├── test/  examples/  scripts/check-samples.ts
├── pipeline/                   @opb/pipeline — NestJS 스탠드얼론 CLI
│   ├── src/main.ts                 진입점 → cli.ts(parseArgs) → createApplicationContext. 토큰은 tokens.ts
│   ├── src/config/                 레포 루트 + .env(dotenv.parse, process.env에 넣지 않음)
│   ├── src/adapters/               도구별 어댑터(gemini/ …) + registry.ts(도구 → 생성 함수·도구별 preflight·기록 래퍼)
│   ├── src/generation/             batch(일괄 실행), preflight(추가 결제 차단 점검), smoke
│   ├── src/system/                 git·터미널 확인(y/N) 같은 I/O
│   ├── src/validation/             Playwright 검증기 (phase 1은 `VALIDATOR` 토큰에 자리표시만)
│   ├── src/judging/                (신규) 판정 도우미
│   └── test/fixtures/              CLI 출력 샘플, 검증용 HTML
├── site/                       @opb/site — Astro 정적 사이트
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
- outcome이 `ok`면 바로 검증기(`VALIDATOR` 토큰)를 실행한다. 검증이 실패해도 batch는 계속하고 `validation`은 null로 남긴다(나중에 `npm run validate`). phase 1의 `VALIDATOR`는 아무것도 하지 않는 자리표시(`pipeline/src/validation/validator.ts`)이고, phase 2가 Playwright 검증기로 바꾼다.
- meta.json이 스키마를 통과하지 못하거나 `modelSlug`가 폴더 이름과 다르면 건드리지 않고 실패로 보고한 뒤 다음 모델로 간다(`--force`면 확인 목록에 넣고 비운다).
- 순서: 대상 선택 → preflight → HEAD 커밋 → 프롬프트 1회 로드(깨진 프롬프트로 폴더를 비우지 않게) → 폴더 상태 판정 → `--force` 확인 → 순차 실행 → 요약표.
- 종료 코드: preflight 실패·사용법 오류·`--force` 거절·깨진 meta.json·모델 처리 중 예외·검증기 오류면 1. 모델 outcome이 `api_failed`(한도 초과 포함)인 것은 기록이 정상으로 남은 것이라 0.
- **preflight** (실제 호출 전 자동 점검, 하나라도 실패하면 아무것도 호출하지 않고 종료):
  - 환경변수에 `ANTHROPIC_API_KEY`·`OPENAI_API_KEY`가 없다(빈 문자열로 있어도 실패).
  - 대상 모델의 생성 도구마다 어댑터가 등록돼 있다. 어댑터가 아직 없는 도구가 섞이면 아무것도 호출하지 않는다. 도구별 인증 점검(아래 두 항목)은 그 도구의 어댑터와 함께 만든다.
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
- 원본 출력은 core 어댑터 인터페이스를 바꾸지 않고 저장한다. 레지스트리 항목의 `createRecorder`가 어댑터에 주입하는 프로세스 실행 함수·SDK 클라이언트를 기록용 래퍼로 감싸고, Runner가 끝난 뒤 `raw-*` 파일로 쓴다. Gemini는 `raw-stream.jsonl`(청크 한 줄씩)과 `raw-error.json`(`{status, body, …}`)이다. 두 파일은 fixture 형식(`stream-*.jsonl`, `error-*.json`)과 같아서 그대로 복사할 수 있다. CLI 어댑터(phase 3·4)는 `raw-stdout.txt`·`raw-stderr.txt` 같은 이름으로 낸다.
- 종료 코드: outcome이 `api_failed`이면 1이다(점검 명령이라서 — batch는 0). 끝에 사용량·rawStopReason·resolvedModelId를 출력하고, 입력 토큰이 2,000을 넘으면 경고한다.
- 알려진 한계: 타임아웃이면 SDK의 abort 에러가 기록되기 전에 파일을 써서 `raw-error.json`이 빠질 수 있다(그때까지 받은 청크는 남는다). 같은 초에 다시 실행하면 폴더가 비어 있지 않아 모델을 부르기 전에 거부된다.

## 검증기 (Playwright, `pipeline/src/validation/`)

- 로컬 정적 서버(127.0.0.1)를 띄우고, 사이트와 **같은 조건**으로 `<iframe sandbox="allow-scripts" src=".../results/<slug>/index.html">`(1280×800)을 담은 검증용 페이지를 연다. sandbox 값은 core 상수 `RESULT_IFRAME_SANDBOX` 하나를 사이트와 함께 쓴다. 서버는 그 모델의 결과물만 내준다.
- 대상: meta.json이 스키마를 통과하고 `outcome`이 `ok`인 모델만.
- 기록: `loaded`(iframe load 이벤트, 30초 제한), `consoleErrors`(console error), `pageErrors`(처리되지 않은 예외), `externalRequests`(로컬 서버가 아닌 http(s) 요청의 url·resourceType, 요청 순서대로. data:·blob:은 넣지 않는다). iframe 안의 이벤트까지 잡히는지 테스트로 확인한다.
- 스크린샷: iframe load를 0초로 5·15·25·35초에 iframe 영역만 찍는다(spring/summer/autumn/winter). Playwright의 JPEG(`type: 'jpeg'`, quality 80)로 `results/<slug>/<label>.jpg`에 바로 저장한다. 변환 라이브러리는 쓰지 않는다. 기록하는 `atMs`는 계획한 시점(5000·15000·…)이다.
- load가 30초 안에 오지 않으면 `loaded: false`로 기록하고, 그 시점을 0초로 스크린샷 4장은 그대로 찍는다(방문자가 보는 화면을 남긴다).
- headless Chromium에서 WebGL이 동작해야 한다(SwiftShader 플래그 등). ⚠ 첫 구현 때 WebGL 픽스처로 확인(three.js 본체는 테스트에서 네트워크로 받을 수 없다).
- 검증 결과는 `meta.json`의 `validation`만 갱신한다. 다른 필드·judgment.json·결과물은 건드리지 않고, 저장 전에 스키마로 검사한다. 재검증하면 스크린샷을 덮어쓴다.
- Nest 컨텍스트를 만들 때는 브라우저를 띄우지 않는다. 검증할 때 띄우고 끝나면 닫는다.
- `npm run validate -- <slug…> | --all`: `--all`은 outcome이 ok인 모델 전부이고 나머지는 건너뜀으로 출력한다. slug를 직접 줬는데 ok가 아니면 실패로 보고하고 다음 모델을 계속한 뒤 exit 1이다. 모르는 slug면 아무것도 하지 않고 exit 1. 모델을 부르지 않으므로 preflight는 없다.
- 테스트: `test/fixtures/`의 로컬 HTML로 실행하고, 외부 URL은 `page.route`로 가로채 가짜 응답을 준다. 테스트에서 실제 네트워크를 쓰지 않는다. 스크린샷 시점·load 제한 시간은 주입해서 짧게 돌린다.

## 판정 도우미 (`npm run judge -- <slug>`)

- `outcome`이 `ok`이고 결과물이 있는 모델만 판정할 수 있다.
- 결과물 경로·스크린샷 경로·판정 기준 요약을 보여 주고, 요구사항 4개(pass/partial/fail)와 메모(1~200자)를 입력받는다.
- `modelSlug`, `prompt`(id·version), `outputSha256`(meta.json의 `output.sha256`), `judgedAt`(KST 오프셋)은 자동으로 채운다. 저장 전에 `JudgmentSchema`로 검사한다.
- 기존 판정이 있으면 내용을 보여 주고 덮어쓸지 확인받는다.
- 테스트용으로 같은 값을 플래그로도 받는다: `--scene --cycle --look --label --note --yes`.

## 사이트 (Astro, `site/`)

- 정적 출력(`output: 'static'`). 페이지: `/`(결과 탭, 첫 화면), `/compare/`, `/prompt/`, `/intro/`, `/view/<slug>/`(새 창용 전체 화면 래퍼). 헤더에는 페이지가 있는 탭만 둔다(ADR-024 — phase 2~4는 결과 탭 하나).
- **데이터는 빌드 때만 읽는다**: `core/src/results.ts`로 `models.json`·`results/`·`prompts/`를 읽고 검증·조인해서, 표시 값은 `core/src/display.ts`로 만든다. 데이터 위치는 기본이 레포 루트이고, 테스트에서는 환경변수 `OPB_DATA_ROOT`로 OS 임시 디렉토리에 만든 데이터를 가리킨다. 빌드가 검사하는 범위는 DATA.md "사이트 빌드의 데이터 검사".
- 빌드 때 `results/<slug>/index.html`과 `response.txt`를 `dist/r/<slug>/`로 바이트 그대로 낸다. `npm run dev`에서도 같은 주소로 열린다. 스크린샷(jpg)·meta.json·judgment.json은 내지 않는다.
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

## 버전 참고 (phase 1에서 설치한 값)

typescript ^6.0.3(ADR-023 — 7은 typescript-eslint 미지원), tsx ^4.23.15, zod ^4.6.5(`z.iso.datetime`, `z.url()` 사용), @types/node ^26.6.4, ESLint ^10.12 + typescript-eslint ^8.71.1, NestJS ^12.1.2(@nestjs/common·core, reflect-metadata ^0.2.2, rxjs ^7.8.2), @google/genai ^2.28.0, dotenv ^18.0.7. Node ≥ 22 (개발 PC는 24.14).
TS 6은 `types` 기본값이 `[]`라 `tsconfig.base.json`에 `types: ["node"]`를 둔다. phase 2의 astro check도 TS 6과 맞는지 확인한다.

phase 2 계획 때(2026-10-12) 확인한 최신값: astro 7.3.8(Node ≥ 22.12 요구 → 루트 `engines`도 맞춘다), @astrojs/check 0.9.10(typescript peer `^5.0.0 || ^6.0.0`), playwright 1.64.0(라이브러리만 쓰고 `@playwright/test` 러너는 쓰지 않는다).
