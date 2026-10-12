# Step 1: cli-process

## 목표

CLI 생성 도구(Claude Code는 이번 phase, Codex는 phase 4)를 실행하는 공통 모듈이 `pipeline/src/system/`에 생긴다.

- shell 없이 실행 파일을 띄우고, 프롬프트를 stdin으로 넘기고, stdout·stderr를 UTF-8 문자열로 돌려준다.
- 자식 환경에서 API 키 변수와 Claude Code 세션이 물려준 변수를 지운다.
- abort되면 손자까지 포함한 프로세스 트리를 종료하고 AbortError로 끝난다. 매달리지 않는다.
- 매 시도 빈 임시 디렉토리를 만들고 끝나면 지운다.
- node로 만든 가짜 CLI 스크립트를 실제로 띄우는 테스트가 위를 증명한다.

어댑터(Claude Code)는 다음 step이 만든다. 이 step은 도구를 모르는 공통 부분만 만든다.

## 관련 파일

- `docs/ARCHITECTURE.md` "도구별 호출 사양"의 공통 절과 "Claude Code CLI"의 자식 환경 항목, "테스트 전략"
- `docs/ADR.md` ADR-001, ADR-006, ADR-015
- `pipeline/src/generation/preflight.ts`(`FORBIDDEN_ENV_KEYS`), `pipeline/src/system/git.ts`(실행 함수를 주입받는 기존 방식)
- `pipeline/src/adapters/gemini/gemini.errors.ts`(abort를 알아보는 방식: `name`이 `AbortError`·`TimeoutError`)
- `scripts/execute.py`의 `resolve_claude_bin`, 자식 프로세스 트리 종료 코드(참고만)

## 작업

테스트를 먼저 작성한다. 시그니처는 예시이고 재량이다. 바꾸면 handoff에 남긴다.

1. `pipeline/src/system/cli.ts`:
   ```ts
   export interface CliRequest {
     bin: string;                 // 실행 파일 경로 (shell 없이 spawn)
     args: readonly string[];
     stdin: string;               // UTF-8로 쓰고 닫는다
     cwd: string;
     env: Readonly<Record<string, string>>; // 이 값만 자식에게 준다 (process.env를 섞지 않는다)
     signal?: AbortSignal;
   }
   export interface CliResult { exitCode: number | null; signal: string | null; stdout: string; stderr: string }
   /** 0이 아닌 exit code는 예외가 아니다(해석은 어댑터 몫). 실행 파일이 없으면 spawn 에러(code ENOENT)로 reject */
   export type RunCli = (req: CliRequest) => Promise<CliResult>;
   export const runCli: RunCli;

   /** base 환경에서 지울 것을 지우고 set을 덮어쓴 자식 환경 */
   export function cliEnv(base: Readonly<Record<string, string | undefined>>, set?: Readonly<Record<string, string>>): Record<string, string>;

   /** PATH(Windows는 PATHEXT 포함)에서 실행 파일을 찾는다. 없으면 null */
   export function findOnPath(name: string, opts?: { env?: …; platform?: NodeJS.Platform }): string | null;

   /** OS 임시 디렉토리에 빈 폴더를 만들어 fn에 주고, 성공·실패와 관계없이 지운다 */
   export function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T>): Promise<T>;
   ```
   - 실행: `shell: false`, `windowsHide: true`. stdout·stderr는 Buffer로 모아 끝난 뒤 한 번에 UTF-8로 디코딩한다(한글이 청크 경계에서 깨지지 않게). 출력 크기 제한은 생성 결과(수백 KB)보다 넉넉하게 둔다.
   - stdin: 자식이 stdin을 읽지 않고 먼저 끝나도(EPIPE) 실패로 만들지 않는다.
   - abort: 이미 abort된 signal이면 띄우지 않고 reject한다. 도중에 abort되면 프로세스 트리를 종료하고(Windows: `taskkill /PID <pid> /T /F`, POSIX: `detached`로 띄워 프로세스 그룹에 SIGKILL), 자식이 끝난 뒤 `name`이 `AbortError`인 에러로 reject한다.
   - `cliEnv`가 지우는 것: `FORBIDDEN_ENV_KEYS`(ANTHROPIC_API_KEY·OPENAI_API_KEY), `CLAUDECODE`, `CLAUDE_CODE_`로 시작하는 변수(단 `CLAUDE_CODE_GIT_BASH_PATH`는 남긴다), `CLAUDE_EFFORT`, `CLAUDE_PID`, `AI_AGENT`. `CLAUDE_CONFIG_DIR`는 남긴다. 값이 undefined인 항목은 뺀다. Windows는 환경변수 이름의 대소문자를 구분하지 않으므로 비교도 대소문자 무시로 한다. `set`은 지운 뒤에 덮어쓴다(예: 어댑터가 `CLAUDE_CODE_MAX_OUTPUT_TOKENS`를 넣는다).
   - `FORBIDDEN_ENV_KEYS`의 정의는 한 곳에만 둔다. preflight와 cli가 같은 상수를 쓰게 하고, 옮기면 import를 고친다.
2. 테스트(`pipeline/test/cli.process.test.ts` 등)와 가짜 CLI(`pipeline/test/fixtures/cli/`의 node 스크립트):
   - stdin을 그대로 stdout에 쓰기(한글·줄바꿈·수백 KB), stderr 쓰기, 지정한 exit code로 끝나기, 받은 환경변수 이름 출력, cwd 출력.
   - 손자 프로세스를 띄우고 그 pid를 알려 준 뒤 둘 다 끝나지 않고 기다리기 → abort 후 몇 초 안에 reject(AbortError)되고, 자식·손자 pid가 모두 살아 있지 않다(`process.kill(pid, 0)`이 ESRCH). 테스트가 끝날 때 남은 프로세스가 없게 정리한다.
   - 이미 abort된 signal, 없는 실행 파일(ENOENT), 0이 아닌 exit code(예외 아님).
   - `cliEnv`: 지울 변수·남길 변수·덮어쓰기·대소문자(Windows 동작은 `platform` 주입이나 대소문자 섞인 키로 확인).
   - `findOnPath`: 임시 디렉토리에 가짜 실행 파일을 만들고 PATH·PATHEXT를 주입해 찾는다.
   - `withTempDir`: 빈 폴더를 주고, fn이 throw해도 폴더가 지워진다.
   - 가짜 CLI는 `process.execPath`(node)로 띄운다. 테스트 시간이 길어지지 않게 대기 시간은 짧게 둔다.

## 금지사항

- 테스트에서 실제 `claude`·`codex`를 띄우지 마라(`--version`·`auth status` 포함). 이유: CLAUDE.md CRITICAL — 테스트는 가짜만. 훅도 `claude -p`를 막는다.
- `shell: true`, `exec`(셸 문자열 실행), cross-spawn 같은 새 의존성을 쓰지 마라. 이유: 한글 인자·프롬프트 인용 문제를 피하려고 인자 배열 + 실행 파일 경로 해석으로 정했다(ARCHITECTURE 공통 절).
- `process.env`를 그대로 자식에게 넘기지 마라. 항상 `cliEnv`를 거친다. 이유: API 키 과금(ADR-001)과 Claude Code 중첩 세션 변수(ARCHITECTURE "Claude Code CLI").
- 임시 디렉토리를 레포 안에 만들지 마라. 이유: 생성 도구가 CLAUDE.md·AGENTS.md를 읽어 벤치마크가 오염된다(ADR-006).
- Claude Code·Codex 전용 로직(인자, 출력 파싱, `claude.exe` 찾기)을 이 모듈에 넣지 마라. 이유: 다음 step과 phase 4의 어댑터가 각자 맡는다. 이 모듈은 도구 중립이다.
