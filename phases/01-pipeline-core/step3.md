# Step 3: batch-gen

## 목표

`npm run gen -- <slug…> | --all [--force]`가 동작하는 코드가 완성된다. preflight를 통과해야만 대상 모델을 순차 생성하고, 덮어쓰기 규칙을 지키고, 끝에 요약표를 출력한다. 가짜 어댑터, OS 임시 디렉토리, 주입한 가짜 git·환경으로 테스트가 증명한다. 이 step에서 실제로 `gen`을 실행하지 않는다.

## 관련 파일

- `docs/ARCHITECTURE.md` "생성 파이프라인" → **Batch 규칙(preflight 포함)**, "도구별 호출 사양" 공통·Gemini(`.env` 처리), "NestJS 사용 규칙", "명령어"
- `docs/ADR.md` ADR-001, ADR-004, ADR-006, ADR-007, ADR-012(`--force`가 판정도 지운다)
- `docs/OPERATIONS.md` "생성"
- step 0~2 산출물: `pipeline/src/main.ts`·`cli.ts`·`app.module.ts`·`tokens.ts`, `pipeline/src/adapters/gemini/`, core의 `runGeneration`·`loadPrompt`·`CURRENT_PROMPT`·`maxOutputTokensFor`·`GENERATOR_BY_PROVIDER`(실제 이름은 이전 step handoff를 확인)

## 작업

테스트를 먼저 작성한다. 도메인 판단(대상 선택, 폴더 상태 판정, preflight 판정, 요약표 문자열)은 순수 함수로 둔다. Nest provider는 I/O(파일·git·프로세스·readline)를 주입하는 얇은 층으로 둔다.

1. 설정(`pipeline/src/config/`): 레포 루트(기본은 패키지 위치에서 계산, 테스트는 주입)와 `.env`를 `dotenv.parse`로 읽은 값.
   - **`process.env`에 넣지 마라.** 나중에 띄울 Claude·Codex 자식 프로세스로 키가 넘어가지 않게 하려는 것이다.
   - `.env`가 없으면 빈 설정이다. 키 값은 로그·에러 메시지에 절대 넣지 않는다.
2. 어댑터 레지스트리: `ADAPTERS` 토큰 → 생성 도구(`GeneratorTool`)별 항목.
   - 각 항목은 어댑터를 만드는 함수와 선택적인 도구별 `preflight()`를 갖는다. 어댑터는 preflight를 통과한 뒤 실제로 필요할 때 만든다.
   - phase 1에는 `gemini-api`만 등록한다. 설정의 `GEMINI_API_KEY`로 `createGeminiClient`를 만든다. claude-code·codex-cli는 phase 3·4에서 등록한다.
   - step 4(smoke)가 어댑터에 주입하는 클라이언트를 기록용 래퍼로 감쌀 수 있게, 만드는 함수가 클라이언트 래퍼(예: `wrapClient?`)를 받을 수 있게 둔다.
3. preflight(`pipeline/src/generation/preflight.ts`): 대상 모델 목록을 받아 검사 결과 목록(통과/실패와 사람이 읽을 사유)을 돌려준다. **하나라도 실패하면 어떤 어댑터도 만들거나 호출하지 않고 종료한다(exit 1).**
   - 현재 프로세스 환경에 `ANTHROPIC_API_KEY`·`OPENAI_API_KEY`가 없다. 실패 메시지에는 변수 이름만 쓰고 값은 쓰지 않는다.
   - 대상 모델의 생성 도구(`GENERATOR_BY_PROVIDER`)가 모두 레지스트리에 있다. 없으면 "아직 지원하지 않는 생성 도구: claude-code (claude-opus-5-5, …)" 식으로 실패한다. phase 1에서 `--all`이 여기서 멈추는 것은 정상이다.
   - Google 대상이 있으면 설정의 `GEMINI_API_KEY`가 비어 있지 않다.
   - `git status --porcelain -- packages pipeline prompts models.json`이 비어 있다. 변경이 있으면 실패하고 목록을 보여 준다. `runtime.gitCommit`은 `git rev-parse HEAD`로 얻는다.
   - git 검사는 옵션으로 끌 수 있게 둔다(step 4의 smoke가 끈다).
   - `claude auth status`·`codex login status` 점검은 만들지 마라. 해당 어댑터 phase에서 레지스트리 항목의 `preflight()`로 붙인다.
   - git과 환경은 주입해서 테스트한다.
4. batch(`pipeline/src/generation/batch.ts` + Nest 서비스):
   - 대상: `<slug…>` 또는 `--all`(models.json 전체를 `sortByRelease` 순서로). 모르는 slug가 있으면 아무것도 호출하지 않고 실패한다. slug도 `--all`도 없으면 사용법 오류.
   - 폴더 상태 판정(순수 함수), `results/<slug>/` 기준:
     - 폴더 없음이나 빈 폴더 → 생성
     - meta.json이 있고 outcome ≠ `api_failed` → 건너뜀
     - meta.json의 outcome = `api_failed` → 비우고 생성
     - meta.json 없이 파일만 있음(중단된 생성) → 비우고 생성
     - meta.json이 스키마를 통과하지 못함 → 건드리지 않고 실패로 보고(사람이 확인), 다음 모델로
   - `--force`: 파일이 있는 대상 폴더 목록과 "판정(judgment.json)도 함께 지워진다"는 문구를 보여 주고 확인받는다. `confirm(message): Promise<boolean>`을 주입하고, 실제 구현은 `node:readline/promises`의 y/N이다. 거절하면 아무것도 바꾸지 않고 종료한다.
   - 모델마다 `runGeneration(adapter, { model, prompt: await loadPrompt(repoRoot, …CURRENT_PROMPT), maxOutputTokens: maxOutputTokensFor(adapter), repoRoot, outDirRel: 'results/<slug>', runtime })`를 호출한다. 순차 실행하고, 한 모델이 예외로 실패해도 다음 모델을 계속한다.
   - `usage_limit`으로 끝난 모델은 기록된 채로 두고 다음 모델로 넘어간다(Runner가 이미 재시도하지 않는다).
   - outcome이 `ok`면 `VALIDATOR` 토큰의 `validate(slug)`를 호출한다. phase 1 구현은 자리표시로, 아무것도 하지 않고 "검증기 없음 — validation은 null로 남는다"를 알린다(phase 2가 Playwright 검증기로 바꾼다). 검증이 throw해도 batch는 계속한다.
   - 끝에 요약표를 출력한다: slug · 처리(생성/건너뜀/실패) · outcome · 시도 수 · 걸린 시간(마지막 시도 latencyMs) · 비용. 표 문자열은 순수 함수로 만들어 테스트한다.
   - exit code: preflight 실패·사용법 오류·모델 처리 중 예외가 있으면 1. 모델의 outcome이 `api_failed`인 것은 기록이 정상으로 남은 것이므로 0으로 본다. 다르게 정했다면 handoff에 남긴다.
   - 폴더 비우기는 반드시 `<repoRoot>/results/<slug>` 안에서만 하고, slug는 models.json 스키마를 통과한 값만 쓴다.
5. `cli.ts`·`main.ts`: `gen` 명령을 추가한다(`parseArgs`: positional slug들, `--all`, `--force`). 루트 `package.json`에 `"gen": "tsx pipeline/src/main.ts gen"` 같은 스크립트를 둔다(경로는 실제 구조에 맞게). 진입점 파일 이름 `pipeline/src/main.ts`는 유지한다.
6. 테스트: OS 임시 디렉토리에 가짜 레포(models.json, prompts/, results/)를 만들고, 가짜 어댑터(core runner 테스트의 대본 방식)를 레지스트리에 주입한다. 최소 케이스:
   - 건너뛰기, api_failed 폴더 재생성, 중단된 폴더 재생성, 스키마가 깨진 meta.json 보고
   - `--force` 확인 거절 시 아무것도 바뀌지 않음, 승인 시 judgment.json까지 지우고 재생성
   - 모르는 slug면 어댑터를 호출하지 않음
   - preflight 실패 4종(API 키 변수 있음, 어댑터 없는 도구, GEMINI 키 없음, git 변경 있음) 각각 어댑터 미생성·미호출
   - usage_limit 뒤에도 다음 모델 계속
   - ok일 때 validator 호출, validator가 throw해도 계속
   - 요약표 문자열
   - `parseCommand`의 gen 인자 해석
   - 설정이 `process.env`를 바꾸지 않음

## 금지사항

- 이 step에서 `npm run gen`이나 `tsx pipeline/src/main.ts gen`을 실행하지 마라. 이유: 실제 모델 호출이다(CLAUDE.md CRITICAL, 훅이 막는다). 동작 확인은 테스트로만 한다.
- 레포의 `.env`를 읽거나 출력하지 마라. 테스트는 임시 디렉토리의 가짜 `.env`만 쓴다. 이유: CLAUDE.md CRITICAL.
- 테스트에서 레포의 `results/`·`models.json`을 쓰거나 지우지 마라. 이유: CLAUDE.md CRITICAL. 파일을 쓰는 테스트는 OS 임시 디렉토리에서 한다.
- 테스트 판정에 실제 `git` 명령 결과를 쓰지 마라(주입한 가짜를 쓴다). 이유: 결과가 작업 트리 상태에 따라 달라진다.
- `--force` 확인을 건너뛰는 플래그(`--yes` 등)를 만들지 마라. 이유: 문서에 없는 기능이고, 판정까지 지운다.
- Playwright 검증기를 구현하지 마라. 이유: phase 2 범위다. 자리표시만 둔다.
