# Step 2: claude-code-adapter

## 목표

`npm run gen`·`npm run smoke`가 Anthropic 모델(provider `anthropic`)을 Claude Code CLI로 생성할 수 있다.

- 레지스트리에 `claude-code` 항목이 등록된다: 어댑터 생성, 도구별 preflight(구독 로그인 점검), smoke 원본 기록기.
- 어댑터가 ARCHITECTURE "Claude Code CLI"의 호출 사양대로 실행하고, JSON 출력을 정규화하고, 에러를 분류한다.
- 실제 한도 초과 출력 fixture와 합성 fixture, 가짜 실행 함수로 어댑터·batch·smoke가 끝까지 도는 테스트가 위를 증명한다. 실제 `claude`는 한 번도 띄우지 않는다.

## 관련 파일

- `docs/ARCHITECTURE.md` "도구별 호출 사양"(공통 절, **Claude Code CLI** 전체), "smoke", "Batch 규칙"의 preflight, "어댑터 인터페이스"
- `docs/DATA.md` "정규화 규칙", meta.json의 `runtime.generator`(invocation 규칙)
- `docs/ADR.md` ADR-001, ADR-004, ADR-005, ADR-006, ADR-007, ADR-015
- `docs/OPERATIONS.md` "smoke로 확인할 것" → Claude Code 행
- `pipeline/test/fixtures/claude-code/README.md`와 `stdout-usage-limit.json`(실제 출력)
- step 1 산출물: `pipeline/src/system/cli.ts`(`runCli`·`RunCli`·`cliEnv`·`findOnPath`·`withTempDir`). 실제 이름은 step 1 handoff를 확인한다.
- 기존 Gemini 구현을 본보기로: `pipeline/src/adapters/gemini/`(adapter·errors·recorder), `pipeline/src/adapters/registry.ts`, `pipeline/src/adapters/raw-recorder.ts`
- `packages/core/src/adapter.ts`(`ProviderAdapter`·`GenerationRequest`·`ProviderResponse`·`ClassifiedError`), `packages/core/src/schema.ts`(`StopReason`·`FailureKind`)
- 테스트 본보기: `pipeline/test/gemini-adapter.test.ts`·`gemini-errors.test.ts`·`gemini-recorder.test.ts`·`gemini-runner.test.ts`·`smoke.test.ts`·`batch-fakes.ts`·`preflight.test.ts`
- `scripts/execute.py`의 `resolve_claude_bin`, `USAGE_LIMIT_RE`·`USAGE_LIMIT_API_ERROR`(한도 문구 기준, 참고만)

## 작업

테스트를 먼저 작성한다. 시그니처는 예시이고 재량이다. 바꾸면 handoff에 남긴다.

1. `pipeline/src/adapters/claude-code/`:
   - **실행 파일**: `findOnPath('claude')`가 `.cmd` shim(Windows)을 돌려주면 shim 옆 `node_modules/@anthropic-ai/claude-code/bin/claude.exe`가 있을 때 그것을 쓴다. 못 찾으면 사람이 읽을 에러로 멈춘다.
   - **버전**: `claude --version` 출력(`2.1.296 (Claude Code)`)의 앞 숫자 → `generator.version`. 레지스트리 `create()`가 동기라면 동기 실행 함수를 주입받아 쓴다. 숫자를 못 읽으면 에러로 멈춘다(기록에 지어낸 버전을 남기지 않는다).
   - **어댑터** `ClaudeCodeAdapter implements ProviderAdapter`: `provider: 'anthropic'`, `generator: { tool: 'claude-code', version }`, `supportsMaxOutputTokens: true`. 실행 함수(`RunCli`)·실행 파일 경로·기본 환경을 주입받는다.
     - `generate(req, signal)`: 매번 `withTempDir`로 빈 폴더를 만들어 cwd로 쓴다. 인자는 `-p --model <modelId> --effort high --tools "" --system-prompt <system 내용> --safe-mode --strict-mcp-config --no-session-persistence --output-format json`(빈 문자열 인자 그대로), stdin은 `req.user`, 환경은 `cliEnv(기본 환경, { CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(req.maxOutputTokens) })`(null이면 넣지 않는다), signal은 그대로 넘긴다.
     - exit code가 0이고 JSON의 `is_error`가 false면 정규화해 돌려준다(ARCHITECTURE "정규화"). 그 밖(0이 아닌 exit code, `is_error: true`, JSON이 아닌 stdout)은 파싱한 내용·exit code·stderr를 담은 에러를 던진다.
     - stopReason: `end_turn` → end, `max_tokens` → max_tokens, `refusal` → refusal, 그 밖·없음 → other. rawStopReason은 원문 그대로.
     - 사용량 필드가 없으면 0이 아니라 안전한 값(0 또는 null)으로 떨어지게 하고, 어떤 경우인지 handoff에 남긴다. 숫자를 지어내지 마라.
     - `describeInvocation(req)`: 실제 인자와 같은 명령줄 문자열. 시스템 프롬프트 내용은 `<system prompt>` 자리표시, user 프롬프트는 넣지 않는다(stdin이라고만), `CLAUDE_CODE_MAX_OUTPUT_TOKENS=<값>`을 함께 적는다.
     - `classifyError(err)`: ARCHITECTURE "에러 분류" 그대로. `usage`는 에러 출력에 0보다 큰 사용량이 있을 때만 담는다. message는 `result` 또는 stderr 앞부분이다.
   - **preflight**: `claude auth status --json`을 실행 함수로 실행해 `loggedIn`·`authMethod`·`apiProvider`를 본다(ARCHITECTURE "로그인 점검"). detail에는 authMethod·subscriptionType만 쓰고 email·orgId·orgName은 절대 쓰지 않는다. 실행 파일이 없거나 JSON이 아니면 실패 항목으로 돌려준다(throw하지 않는다).
   - **smoke 기록기**(`createRecorder`): 생성용 실행 함수를 감싸 `raw-stdout.txt`(stdout 그대로), `raw-stderr.txt`, `raw-exit.json`(`{ exitCode, signal }`)을 낸다. stdout은 가리지 않는다(생성된 코드가 바뀌면 안 된다). stderr·exit 정보에는 redact를 적용한다. 버전·로그인 점검 호출은 기록하지 않는다.
2. `registry.ts`: `claude-code` 항목을 등록한다. 테스트가 실행 함수·PATH 탐색·버전 읽기를 가짜로 바꿀 수 있게 항목 생성 함수에 주입점을 둔다(기본값은 실제 구현). 레지스트리를 만들 때는 아무것도 실행하지 않는다는 기존 규칙을 지킨다.
3. fixture(`pipeline/test/fixtures/claude-code/`):
   - `stdout-usage-limit.json`(실제, 고치지 마라)은 그대로 쓴다.
   - 합성: 정상(`end_turn`, ```` ```html ```` 블록이 든 `result`, thinking_tokens 포함), `max_tokens`, `refusal`, 529 overloaded, 401, `is_error`인데 `api_error_status`가 없는 경우, JSON이 아닌 stdout, `claude auth status --json` 3종(claude.ai 구독 / 다른 authMethod / loggedIn false — email 등은 `user@example.com` 같은 가짜 값). 합성 필드는 실제 출력과 같은 이름·모양으로 만들고 README 표에 "합성"으로 적는다.
4. 테스트:
   - 어댑터: 인자 배열·stdin·cwd(매번 다른 빈 임시 폴더, 끝나면 없음)·환경(API 키·Claude Code 세션 변수 없음, `CLAUDE_CODE_MAX_OUTPUT_TOKENS` 있음), 정규화 값, stopReason 매핑, describeInvocation에 프롬프트 내용이 없음.
   - 에러 분류: 실제 한도 초과 fixture → `usage_limit`, 상태 코드별 분류, 한도 문구만 있고 `api_error`가 없는 경우, `rate limit` 문구는 usage_limit이 아님, abort → `timeout`, 실행 파일 없음 → `unknown`.
   - Runner와 함께: 한도 초과는 재시도하지 않고, 529는 재시도한다(core `RETRYABLE_FAILURES` 그대로).
   - preflight: 세 가지 로그인 상태와 실행 실패. 출력에 가짜 email 값이 나오지 않는다.
   - batch·smoke: 가짜 실행 함수를 주입한 `claude-code` 항목으로 anthropic 모델을 생성한다. meta.json `runtime.generator`(tool·version·invocation), smoke 폴더의 `raw-stdout.txt`·`raw-stderr.txt`·`raw-exit.json`을 확인한다. 임시 디렉토리에서만 쓴다.
   - 실행 파일 찾기: `.cmd` shim 옆에 exe가 있을 때·없을 때, PATH에 없을 때.
5. 끝나면 `docs/ARCHITECTURE.md`의 Claude Code 절에서 구현과 다른 점이 생겼으면 handoff에 남긴다(⚠ 항목은 smoke 전까지 그대로 둔다).

## 금지사항

- `claude -p`, `npm run gen`, `npm run smoke`, 파이프라인 진입점의 gen·smoke를 실행하지 마라. 테스트에서도 실제 `claude`(`--version`·`auth status` 포함)를 띄우지 마라. 이유: CLAUDE.md CRITICAL — Pro 한도를 쓴다. 훅이 막는다.
- `--bare`를 쓰지 마라. API 키를 자식 환경에 넣지 마라. 이유: API 요금이 청구된다(ADR-001, ADR-006).
- 레포 안 폴더를 cwd로 쓰지 마라. 이유: CLAUDE.md가 생성 맥락에 섞인다(ADR-006).
- `stdout-usage-limit.json`을 고치거나 실제 출력인 척하는 합성 fixture를 만들지 마라. 이유: fixture의 출처가 기록의 정직성을 떠받친다(README에 실제/합성 구분).
- ⚠ 항목(입력 토큰 규모, max_tokens·refusal 표시, API 키 로그인의 authMethod)을 추측으로 확정하지 마라. 모르는 값은 other·실패로 안전하게 떨어뜨리고 handoff에 남긴다. 이유: smoke 원본 출력으로 확정한다(OPERATIONS).
- Codex 어댑터를 만들지 마라. 이유: phase 4 범위다.
- core 스키마(`schema.ts`)를 바꾸지 마라. 이유: 예정된 스키마 변경이 없다(DATA "스키마 변경 예정"). 필요해 보이면 멈추고 handoff에 남긴다.
- preflight·에러 메시지·로그에 email·orgId·orgName을 쓰지 마라. 이유: 계정 정보가 터미널·smoke 파일에 남는다.
