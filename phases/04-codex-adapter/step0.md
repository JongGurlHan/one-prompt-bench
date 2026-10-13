# Step 0: codex-adapter

## 목표

Codex CLI 어댑터(`provider: 'openai'`)가 `docs/ARCHITECTURE.md` "Codex CLI" 사양대로 실행하고, JSONL 출력을 정규화하고, 에러를 분류한다. 실행 파일 찾기와 버전 읽기도 동작한다.

- Windows의 `codex.cmd` shim을 shell 없이 띄울 수 있는 명령(`node <codex.js>`)으로 바꾼다.
- 매 시도 임시 폴더에 빈 작업 폴더와 지시문 파일을 만들어 실행하고, `-o`로 받은 마지막 메시지를 본문으로 쓴다.
- Codex 0.157.1 소스 형식으로 만든 합성 JSONL fixture와 가짜 실행 함수로 위를 증명한다. 실제 `codex`는 한 번도 띄우지 않는다.

레지스트리 등록·로그인 점검(preflight)·smoke 기록기·batch 연결은 다음 step이 한다. 이 step에서는 어댑터를 직접 만들어 테스트한다.

## 관련 파일

- `docs/ARCHITECTURE.md` "도구별 호출 사양"의 공통 절과 "CLI 실행 모듈", **"Codex CLI" 전체**(호출, 실행 파일, 작업 폴더, 시스템 프롬프트, `-c` TOML 규칙, 출력 이벤트, 정규화, 에러 분류, 한계)
- `docs/DATA.md` "정규화 규칙", meta.json의 `params.maxOutputTokens`(Codex는 null)·`runtime.generator`
- `docs/ADR.md` ADR-001, ADR-004, ADR-005, ADR-006, ADR-007, ADR-015, ADR-027
- `pipeline/src/system/cli.ts`(`runCli`·`RunCli`·`cliEnv`·`findOnPath`·`withTempDir`)
- 본보기: `pipeline/src/adapters/claude-code/`(adapter·errors·bin)와 그 테스트(`pipeline/test/claude-code-adapter.test.ts`·`claude-code-errors.test.ts`·`claude-code-bin.test.ts`·`claude-code-runner.test.ts`·`claude-code-fakes.ts`), `pipeline/test/fixtures/claude-code/README.md`(실제/합성 구분 방식)
- `packages/core/src/adapter.ts`(`ProviderAdapter`·`GenerationRequest`·`ProviderResponse`·`ClassifiedError`·`RETRYABLE_FAILURES`·`maxOutputTokensFor`), `packages/core/src/schema.ts`(`StopReason`·`FailureKind`)

## 작업

테스트를 먼저 작성한다. 시그니처는 예시이고 재량이다. 바꾸면 handoff에 남긴다.

1. `pipeline/src/adapters/codex/`:
   - **실행 명령** (`codex.bin.ts`):
     ```ts
     export interface CodexCommand { bin: string; prefixArgs: readonly string[] }
     export function resolveCodexCommand(opts?: { env?; platform?; nodePath? }): CodexCommand
     ```
     `findOnPath('codex')`가 `.cmd`·`.bat` shim(대소문자 무시)을 돌려주면 shim 옆 `node_modules/@openai/codex/bin/codex.js`가 있을 때 `{ bin: nodePath ?? process.execPath, prefixArgs: [codex.js 경로] }`. 없으면 사람이 읽을 에러로 멈춘다. shim이 아니면 `{ bin: 찾은 경로, prefixArgs: [] }`. PATH에 없으면 에러.
   - **버전**: `codex --version` 출력 `codex-cli 0.157.1` → `0.157.1`. 동기 실행 함수를 주입받는다(`claude-code.bin.ts`의 `RunSync`·`spawnSync` 구현을 함께 쓰려면 `system/cli.ts`로 옮겨도 된다 — 동작은 바꾸지 않는다). 숫자를 못 읽으면 에러로 멈춘다.
   - **어댑터** `CodexAdapter implements ProviderAdapter`: `provider: 'openai'`, `generator: { tool: 'codex-cli', version }`, `supportsMaxOutputTokens: false`. 실행 함수(`RunCli`)·`CodexCommand`·버전·기본 환경을 주입받는다.
     - `generate(req, signal)`: `req.maxOutputTokens`가 null이 아니면 에러를 던진다(기록된 상한과 실제 호출이 어긋나지 않게 — 정상 경로는 `maxOutputTokensFor`가 null을 준다).
     - `withTempDir`로 임시 폴더를 만들고, 그 안에 빈 `work/` 폴더와 `instructions.md`(`req.system`을 UTF-8로, 내용 그대로)를 만든다. 인자는 `[...prefixArgs, 'exec', ...]`로 ARCHITECTURE의 호출 사양 그대로다(`-o <tmp>/last-message.txt`, `-C <tmp>/work`, `-c` 6개, 마지막 `-`). 프로세스 cwd도 `work/`다. stdin은 `req.user`, 환경은 `cliEnv(기본 환경)`, signal은 그대로 넘긴다.
     - `-c` 값: 문자열은 큰따옴표, 경로는 슬래시(`/`)로 바꾼다. 불리언은 따옴표 없이.
     - 실행이 끝나면 임시 폴더가 지워지기 **전에** `last-message.txt`를 읽는다(없을 수 있다).
     - stdout은 줄마다 JSON 이벤트(빈 줄은 건너뜀)다. JSON이 아닌 줄이 있으면 실패로 본다.
     - 성공 = exit code 0 + `turn.completed` 이벤트 + `last-message.txt` 있음. 그 밖은 파싱한 이벤트·exit code·stderr·마지막 에러 메시지를 담은 에러를 던진다.
     - 정규화: 본문 = `last-message.txt`. 사용량 = **마지막** `turn.completed`의 `usage`(누적값이라 더하지 않는다). inputTokens = `input_tokens`(캐시분 포함 — `cached_input_tokens`를 더하지 않는다), outputTokens = `output_tokens`, reasoningTokens = `reasoning_output_tokens`. 필드가 없거나 숫자가 아니면 입력·출력 0, 추론 null(지어내지 않는다). reasoning > output이면 추론 null. stopReason `other`, rawStopReason `turn.completed`, resolvedModelId·requestId·firstTokenMs null.
     - `describeInvocation(req)`: 실제 인자를 만드는 같은 함수로, 임시 경로는 `<tmp>/last-message.txt`·`<tmp>/work`·`<tmp>/instructions.md` 자리표시, 실행 파일은 `codex`, 끝에 `(stdin: <user prompt>)`. Node 경로·`codex.js` 경로·사용자 폴더·프롬프트 내용이 들어가지 않는다.
     - `classifyError(err)`: ARCHITECTURE "Codex CLI" 에러 분류 목록을 **위에서부터 처음 맞는 것** 순서로. httpStatus는 메시지의 `unexpected status NNN`에서, 없으면 null. message는 `turn.failed`의 `error.message` → 마지막 `error` 이벤트 → stderr → exit code·출력 모양 설명 순서, 500자 상한. `retryAfterMs`는 null. 실패 출력에는 사용량이 없으니 `usage`는 null.
2. fixture `pipeline/test/fixtures/codex/`(모두 **합성**):
   - JSONL: 정상(`thread.started` → `turn.started` → `reasoning` item → `agent_message` item → `turn.completed`, usage에 캐시·추론 포함), 명령 실행을 시도한 정상(`command_execution` item이 실패한 뒤 `agent_message`), 한도 초과(`error` + `turn.failed`, 문구는 ARCHITECTURE의 `You’ve hit your usage limit…` — 굽은 따옴표 그대로), `unexpected status 401 Unauthorized: …`, `unexpected status 503 Service Unavailable: …`, `stream disconnected before completion: …`, 잘림(`stream disconnected before completion: Incomplete response returned, reason: max_output_tokens`), JSON이 아닌 stdout.
   - 필드 이름·모양은 ARCHITECTURE "Codex CLI"의 출력 절(0.157.1 `codex-rs/exec/src/exec_events.rs`)을 따른다. `thread_id`는 0으로 채우고, 본문에는 "합성 fixture"라고 적는다.
   - `README.md`: 파일별 내용 표, "합성 — Codex 0.157.1 공개 소스 기준(파일 경로)"이라고 적고, 실제 출력은 Codex smoke 뒤 더한다고 적는다.
   - 테스트용 가짜 실행 함수는 요청 인자의 `-o` 경로에 마지막 메시지를 써서 Codex를 흉내 낸다(실패 fixture는 쓰지 않는다).
3. 테스트(`pipeline/test/codex-*.test.ts`):
   - 어댑터: 인자 배열(prefixArgs 포함, `-c` 6개의 정확한 문자열, 슬래시 경로), stdin, 프로세스 cwd = 빈 `work/`(매 호출 다른 폴더, 끝나면 없음), `instructions.md` 내용 = `req.system`(바이트 그대로), `last-message.txt`·`instructions.md`가 `work/` 밖, 환경(API 키·Claude Code 세션 변수 없음), `maxOutputTokens`가 null이 아니면 throw, 정규화 값, 사용량은 마지막 `turn.completed`(두 번 오는 변형으로 더하지 않음을 확인), describeInvocation에 프롬프트·사용자 경로 없음.
   - 성공 조건: exit 0이지만 `turn.completed`가 없거나 `last-message.txt`가 없으면 실패, JSON이 아닌 줄이 있으면 실패.
   - 에러 분류: 목록의 각 줄, 순서(잘림 메시지는 `stream disconnected`가 들어 있어도 `unknown`), 한도 초과 → `usage_limit`, `rate limit` 문구는 `usage_limit`이 아님, abort → `timeout`, 실행 파일 없음 → `unknown`.
   - Runner와 함께: 한도 초과·잘림은 재시도하지 않고, 503·스트림 끊김은 재시도한다(core `RETRYABLE_FAILURES` 그대로).
   - 실행 명령 찾기: `.cmd` shim 옆에 `codex.js`가 있을 때·없을 때, PATH에 없을 때, POSIX(Windows에서는 건너뛰는 테스트로). 버전 파싱·실패.
4. 끝나면 ARCHITECTURE "Codex CLI"와 구현이 다른 점이 생겼으면 handoff에 남긴다(⚠ 항목은 smoke 전까지 그대로 둔다).

## 금지사항

- 실제 `codex`를 어떤 하위 명령으로도 띄우지 마라(`exec`, `--version`, `login status` 포함, 테스트에서도). `npm run gen`·`npm run smoke`도 실행하지 마라. 이유: CLAUDE.md CRITICAL — ChatGPT 구독 한도를 쓴다.
- `~/.codex/`(auth.json·config.toml·skills 등)를 읽거나 쓰지 마라. `CODEX_HOME`을 바꾸거나 지우지 마라. 이유: 인증 정보이고, 토큰이 갱신되면 사용자 로그인이 깨질 수 있다.
- 자식 환경에 API 키를 넣지 마라. `shell: true`로 띄우지 마라. 프롬프트를 인자로 넘기지 마라. 이유: ADR-001, Windows 인용 문제(ARCHITECTURE 공통 절).
- 레포 안 폴더를 작업 폴더로 쓰지 마라. `work/` 안에 파일을 두지 마라. 이유: AGENTS.md 등이 생성 맥락에 섞인다(ADR-006).
- 실제 출력인 척하는 fixture를 만들지 마라. 이유: fixture의 출처가 기록의 정직성을 떠받친다(README에 합성이라고 적는다).
- ⚠ 항목(입력 토큰 규모, 추론 강도 적용, 모델의 도구 시도, 실제 에러 문구)을 추측으로 확정하지 마라. 이유: Codex smoke 원본 출력으로 확정한다(OPERATIONS).
- 레지스트리·preflight·smoke 기록기를 이 step에서 만들지 마라. 이유: step 1 범위다.
- core 스키마(`schema.ts`)와 `site/`를 바꾸지 마라. 이유: 이 phase에 예정된 스키마·화면 변경이 없다. 필요해 보이면 멈추고 handoff에 남긴다.
