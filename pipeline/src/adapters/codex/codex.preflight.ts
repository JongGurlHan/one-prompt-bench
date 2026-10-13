import type { PreflightCheck } from '../../generation/preflight.js';
import { cliEnv, withTempDir, type CliResult, type RunCli } from '../../system/cli.js';
import type { CodexCommand } from './codex.bin.js';

/* ────────────────────────────────────────────────────────────
 * Codex 로그인 점검 (ARCHITECTURE "Batch 규칙" preflight, "Codex CLI" 로그인 점검).
 * `codex login status`는 결과를 stderr 한 줄로 쓴다. exit 0 + 정확히 `Logged in using ChatGPT`일 때만 통과한다.
 * API 키 로그인 문구는 `Logged in using an API key - <가린 키>`다 — ` - ` 뒤는 절대 옮기지 않는다.
 * 그 밖의 `Logged in using …`은 인증 방식 이름만, 모르는 출력은 내용을 옮기지 않는다 (계정 정보가 터미널·파일에 남지 않게).
 * 실행 명령을 못 찾거나 실행이 실패해도 throw하지 않고 실패 항목으로 돌려준다.
 * ──────────────────────────────────────────────────────────── */

export const CODEX_LOGIN_CHECK = 'Codex 로그인 (codex login status)';

const LOGIN_STATUS_ARGS = ['login', 'status'];
const LOGIN_TIMEOUT_MS = 30_000;
const TEMP_PREFIX = 'opb-codex-login-';

const CHATGPT = 'Logged in using ChatGPT';
const API_KEY_PREFIX = 'Logged in using an API key';
const NOT_LOGGED_IN = 'Not logged in';
const LOGGED_IN_PREFIX = 'Logged in using ';
/** 소스(0.157.1)에 있는 ChatGPT 밖의 인증 방식. 긴 이름부터 (personal access token이 access token보다 먼저) */
const KNOWN_METHODS = ['personal access token', 'access token', 'Amazon Bedrock'];
/** 모르는 방식 이름은 영문자·공백만일 때 보여 준다 (이메일·계정 ID 같은 값은 옮기지 않는다) */
const SHOWN_METHOD = /^[A-Za-z][A-Za-z ]{0,39}$/;

const LOGIN_GUIDE = '터미널에서 codex login으로 ChatGPT 계정에 로그인하세요("Sign in with ChatGPT").';

export interface CodexLoginDeps {
  runCli: RunCli;
  /** 실행 명령 (Windows npm 설치는 node + codex.js). 못 찾으면 throw (그 메시지가 실패 사유가 된다) */
  resolveCommand: () => CodexCommand;
  /** 자식 환경의 바탕. 생성과 같은 정리(cliEnv)를 거친다 — CODEX_HOME(인증 폴더)은 그대로 남는다 */
  env: Readonly<Record<string, string | undefined>>;
}

export async function codexLoginPreflight(deps: CodexLoginDeps): Promise<PreflightCheck[]> {
  let command: CodexCommand;
  try {
    command = deps.resolveCommand();
  } catch (err) {
    return [fail(errorMessage(err))];
  }

  let result: CliResult;
  try {
    result = await withTempDir(TEMP_PREFIX, (cwd) =>
      deps.runCli({
        bin: command.bin,
        args: [...command.prefixArgs, ...LOGIN_STATUS_ARGS],
        stdin: '',
        cwd,
        env: cliEnv(deps.env),
        signal: AbortSignal.timeout(LOGIN_TIMEOUT_MS),
      }),
    );
  } catch (err) {
    const reason = isRecord(err) && err.name === 'AbortError' ? `${LOGIN_TIMEOUT_MS / 1000}초 안에 끝나지 않았습니다` : errorMessage(err);
    return [fail(`codex login status를 실행하지 못했습니다: ${reason}`)];
  }
  return [evaluateCodexLogin(statusLine(result), result.exitCode)];
}

/** 결과 줄: stderr의 첫 줄(빈 줄 제외), stderr가 비어 있으면 stdout의 첫 줄. 앞뒤 공백(CR 포함)은 지운다 */
function statusLine(result: CliResult): string {
  return firstLine(result.stderr) ?? firstLine(result.stdout) ?? '';
}

function firstLine(text: string): string | null {
  return text.split('\n').map((line) => line.trim()).find((line) => line !== '') ?? null;
}

/** 판정. detail에는 인증 방식 이름 말고는 출력 내용을 쓰지 않는다 */
function evaluateCodexLogin(line: string, exitCode: number | null): PreflightCheck {
  if (line === CHATGPT && exitCode === 0) return { ok: true, name: CODEX_LOGIN_CHECK, detail: `ChatGPT 로그인 (${CHATGPT})` };
  if (line.startsWith(API_KEY_PREFIX)) {
    // ` - ` 뒤의 가린 키는 쓰지 않는다
    return fail(
      'API 키 로그인입니다. 구독 대신 요금이 청구될 수 있습니다 — ' +
        '터미널에서 codex logout 뒤 codex login으로 ChatGPT 계정에 로그인하세요("Sign in with ChatGPT").',
    );
  }
  if (line.startsWith(NOT_LOGGED_IN)) return fail(`로그인되어 있지 않습니다. ${LOGIN_GUIDE}`);
  if (line.startsWith(LOGGED_IN_PREFIX) && !line.startsWith(CHATGPT)) {
    return fail(
      `인증 방식이 ChatGPT 로그인이 아닙니다 (${authMethod(line.slice(LOGGED_IN_PREFIX.length))}). ` +
        `구독 대신 다른 경로로 과금될 수 있습니다 — codex logout 뒤 codex login으로 ChatGPT 계정에 로그인하세요.`,
    );
  }
  // 모르는 출력(Error checking login status 등)·ChatGPT 문구인데 exit code가 0이 아니거나 뒤에 무엇이 붙음: 내용은 옮기지 않는다
  return fail(
    `codex login status 결과를 ChatGPT 로그인으로 확인하지 못했습니다 (exit code ${exitCode ?? '없음'}). ` +
      '터미널에서 직접 codex login status로 확인하고, 필요하면 codex login으로 ChatGPT 계정에 로그인하세요.',
  );
}

/** `Logged in using ` 뒤에서 인증 방식 이름만. 알려진 이름이거나 영문자·공백만이면 보여 주고, 그 밖은 숨긴다 */
function authMethod(rest: string): string {
  const known = KNOWN_METHODS.find((m) => rest === m || rest.startsWith(`${m} `));
  if (known !== undefined) return known;
  const name = rest.split(' - ')[0]!.trim();
  return SHOWN_METHOD.test(name) ? name : '표시하지 않는 방식';
}

function fail(detail: string): PreflightCheck {
  return { ok: false, name: CODEX_LOGIN_CHECK, detail };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
