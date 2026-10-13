# Step 1: codex-preflight-smoke

## 목표

`npm run gen`·`npm run smoke`가 OpenAI 모델(provider `openai`)을 Codex CLI로 생성할 수 있다.

- 레지스트리에 `codex-cli` 항목이 등록된다: 어댑터 생성, 도구별 preflight(ChatGPT 로그인 점검), smoke 원본 기록기.
- Claude Code의 smoke 기록기를 도구 중립 위치로 옮겨 두 CLI 어댑터가 함께 쓴다(동작 변경 없음).
- 가짜 실행 함수를 주입한 `codex-cli` 항목으로 batch·smoke가 끝까지 도는 테스트가 위를 증명한다. 실제 `codex`는 한 번도 띄우지 않는다.

## 관련 파일

- `docs/ARCHITECTURE.md` "Batch 규칙"의 preflight, "Codex CLI"의 로그인 점검·smoke 기록기, "smoke", "어댑터 인터페이스"
- `docs/DATA.md` meta.json의 `params.maxOutputTokens`(Codex는 null)·`runtime.generator`
- `docs/ADR.md` ADR-001, ADR-007, ADR-015, ADR-027
- step 0 산출물: `pipeline/src/adapters/codex/`, `pipeline/test/fixtures/codex/`, 가짜 실행 함수. 실제 이름은 step 0 handoff를 확인한다.
- 본보기: `pipeline/src/adapters/registry.ts`의 `createClaudeCodeEntry`, `pipeline/src/adapters/claude-code/claude-code.preflight.ts`·`claude-code.recorder.ts`, `pipeline/src/adapters/raw-recorder.ts`
- 테스트 본보기: `pipeline/test/claude-code-preflight.test.ts`·`claude-code-recorder.test.ts`·`claude-code-registry.test.ts`·`claude-code-pipeline.test.ts`, `pipeline/test/batch-fakes.ts`(가짜 레포에 `gpt-a` 모델이 있다), `pipeline/test/smoke.test.ts`
- 바꿔야 하는 기존 단정: `pipeline/test/adapter-registry.test.ts`·`pipeline/test/app.module.test.ts`의 등록 도구 목록

## 작업

테스트를 먼저 작성한다. 시그니처는 예시이고 재량이다. 바꾸면 handoff에 남긴다.

1. **CLI 기록기 공용화**: `claude-code.recorder.ts`의 기록기(`raw-stdout.txt`·`raw-stderr.txt`·`raw-exit.json`)를 `pipeline/src/adapters/cli-recorder.ts`(예: `createCliRecorder(redact)`)로 옮기고 Claude Code 항목도 그것을 쓴다. 파일 이름·내용·redact 규칙은 바꾸지 않는다. 기존 기록기 테스트는 import만 고쳐 그대로 통과해야 한다.
2. **preflight** (`pipeline/src/adapters/codex/codex.preflight.ts`): `[...prefixArgs, 'login', 'status']`를 실행 함수로 실행한다(stdin 빈 문자열, OS 임시 폴더, `cliEnv` 환경, 30초 제한). 결과는 **stderr**의 첫 줄이다(비어 있으면 stdout도 본다).
   - 이름: `Codex 로그인 (codex login status)`.
   - 통과: exit code 0이고 줄이 정확히 `Logged in using ChatGPT`일 때만.
   - 실패 안내: `Logged in using an API key - …`이면 "API 키 로그인(요금이 청구될 수 있다) — `codex logout` 뒤 `codex login`으로 ChatGPT 로그인", `Not logged in`이면 로그인 안내, 그 밖의 `Logged in using …`이면 인증 방식 이름만. **` - ` 뒤(가린 키)는 절대 detail·로그에 쓰지 않는다.** 모르는 출력은 내용을 옮기지 않고 일반 안내만 쓴다.
   - 실행 명령을 못 찾거나 실행이 실패해도 throw하지 않고 실패 항목으로 돌려준다.
   - fixture: step 0이 만든 로그인 상태 합성 fixture(ChatGPT / API 키(가짜로 가린 키) / Not logged in)를 쓴다. 없으면 이 step에서 `pipeline/test/fixtures/codex/`에 더하고 README에 "합성"으로 적는다.
3. **레지스트리** (`registry.ts`): `createCodexEntry(overrides?: Partial<CodexEntryDeps>)`를 만들어 `codex-cli`로 등록한다. 주입점은 실행 함수, 실행 명령 찾기, 버전 읽기, 환경(기본값은 실제 구현). `AdapterRegistry['codex-cli']`를 `AdapterEntry<RunCli>`로. 항목을 만들 때는 아무것도 실행하지 않는다. `create()`가 명령 찾기 → 버전 읽기(실패하면 throw, 모델 호출 없음), `preflight()`가 로그인 점검을 한다. `createRecorder`는 1의 공용 기록기.
4. 테스트:
   - preflight: ChatGPT 통과, API 키·Not logged in·모르는 출력·실행 실패는 실패. 출력에 가짜 키 값이 나오지 않는다.
   - 레지스트리: 만들 때 실행 없음, `create()`가 주입한 명령·버전으로 어댑터를 만든다, 버전 읽기 실패면 throw.
   - batch: 가짜 실행 함수를 주입한 `codex-cli` 항목으로 `gpt-a`를 생성한다. meta.json `params.maxOutputTokens`가 null, `runtime.generator`(tool `codex-cli`·version·invocation — `codex exec …`로 시작하고 상한 환경 변수가 없다), 사용량, 생성 직후 검증 호출. 로그인 실패면 preflight에서 멈추고 생성하지 않는다. 한도 초과는 재시도 없이 기록하고 다음 모델로 넘어간다(exit 0).
   - smoke: `gpt-a` smoke 폴더의 `raw-stdout.txt`(JSONL 그대로)·`raw-stderr.txt`·`raw-exit.json`, smoke 출력 상한 8,000을 넘겨도 Codex 요청의 `maxOutputTokens`는 null.
   - Claude Code 항목의 기존 테스트가 공용 기록기로 그대로 통과한다.
   - 파일을 쓰는 테스트는 OS 임시 디렉토리에서만 한다.
5. 끝나면 ARCHITECTURE와 구현이 다른 점이 생겼으면 handoff에 남긴다.

## 금지사항

- 실제 `codex`를 어떤 하위 명령으로도 띄우지 마라(`exec`, `--version`, `login status` 포함, 테스트에서도). `npm run gen`·`npm run smoke`, 파이프라인 진입점의 gen·smoke도 실행하지 마라. 이유: CLAUDE.md CRITICAL — ChatGPT 구독 한도를 쓴다.
- preflight·에러 메시지·로그·smoke 파일에 API 키(가린 것 포함)·email·계정 식별자를 쓰지 마라. 이유: 계정 정보가 터미널·파일에 남는다.
- `~/.codex/`를 읽거나 쓰지 마라. `CODEX_HOME`을 바꾸거나 지우지 마라. 이유: 인증 정보이고, 사용자 로그인이 깨질 수 있다.
- 공용 기록기로 옮기면서 Claude Code smoke 파일의 이름·내용을 바꾸지 마라. 이유: 이미 fixture로 쓰는 형식이다(`stdout-smoke-ok.json`은 `raw-stdout.txt`를 그대로 복사한 것).
- 레포의 `results/`·`results-smoke/`에 쓰지 마라. 이유: CLAUDE.md CRITICAL.
- core 스키마(`schema.ts`)와 `site/`를 바꾸지 마라. 이유: 이 phase에 예정된 스키마·화면 변경이 없다. 필요해 보이면 멈추고 handoff에 남긴다.
