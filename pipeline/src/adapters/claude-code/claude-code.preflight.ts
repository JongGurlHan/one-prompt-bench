import type { PreflightCheck } from '../../generation/preflight.js';
import { cliEnv, withTempDir, type CliResult, type RunCli } from '../../system/cli.js';

/* ────────────────────────────────────────────────────────────
 * Claude Code 로그인 점검 (ARCHITECTURE "Batch 규칙" preflight, "Claude Code CLI" 로그인 점검).
 * `claude auth status --json`이 claude.ai 구독(loggedIn, authMethod claude.ai, apiProvider firstParty)일 때만 통과한다.
 * 출력에는 email·orgId·orgName이 있다 — 계정 정보가 터미널·smoke 파일에 남지 않게 authMethod·subscriptionType 말고는 옮기지 않는다.
 * 실행 실패·JSON이 아닌 출력도 throw하지 않고 실패 항목으로 돌려준다.
 * ──────────────────────────────────────────────────────────── */

export const CLAUDE_AUTH_CHECK = 'Claude Code 로그인 (claude auth status)';

const AUTH_STATUS_ARGS = ['auth', 'status', '--json'];
const AUTH_TIMEOUT_MS = 30_000;
const TEMP_PREFIX = 'opb-claude-auth-';

const SUBSCRIPTION_AUTH_METHOD = 'claude.ai';
const FIRST_PARTY = 'firstParty';

export interface ClaudeAuthDeps {
  runCli: RunCli;
  /** 실행 파일 경로. 못 찾으면 throw (그 메시지가 실패 사유가 된다) */
  resolveBin: () => string;
  /** 자식 환경의 바탕. 생성과 같은 정리(cliEnv)를 거친다 */
  env: Readonly<Record<string, string | undefined>>;
}

export async function claudeAuthPreflight(deps: ClaudeAuthDeps): Promise<PreflightCheck[]> {
  const fail = (detail: string): PreflightCheck[] => [{ ok: false, name: CLAUDE_AUTH_CHECK, detail }];

  let bin: string;
  try {
    bin = deps.resolveBin();
  } catch (err) {
    return fail(errorMessage(err));
  }

  let result: CliResult;
  try {
    result = await withTempDir(TEMP_PREFIX, (cwd) =>
      deps.runCli({
        bin,
        args: AUTH_STATUS_ARGS,
        stdin: '',
        cwd,
        env: cliEnv(deps.env),
        signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
      }),
    );
  } catch (err) {
    const reason = isRecord(err) && err.name === 'AbortError' ? `${AUTH_TIMEOUT_MS / 1000}초 안에 끝나지 않았습니다` : errorMessage(err);
    return fail(`claude auth status를 실행하지 못했습니다: ${reason}`);
  }

  // 로그아웃 상태는 exit code가 0이 아닐 수 있다 — JSON이면 exit code와 관계없이 읽는다
  const status = parseObject(result.stdout);
  if (status === null || typeof status.loggedIn !== 'boolean') {
    // 출력 내용은 옮기지 않는다 (JSON이 아닌 출력에 계정 정보가 섞일 수 있다)
    return fail(
      `claude auth status --json 출력을 읽지 못했습니다 (JSON이 아님, exit code ${result.exitCode}). ` +
        '터미널에서 직접 claude auth status로 확인하세요.',
    );
  }
  return [evaluateClaudeAuth(status)];
}

/** 판정. detail에는 authMethod·subscriptionType만 쓴다 */
function evaluateClaudeAuth(status: Record<string, unknown>): PreflightCheck {
  const summary = `authMethod: ${shown(status.authMethod)} · subscriptionType: ${shown(status.subscriptionType)}`;
  const problems: string[] = [];
  if (status.loggedIn !== true) {
    problems.push('로그인되어 있지 않습니다. 터미널에서 claude를 실행해 /login으로 claude.ai 구독 계정에 로그인하세요.');
  } else {
    if (status.authMethod !== SUBSCRIPTION_AUTH_METHOD) {
      problems.push(
        `인증 방식이 claude.ai 구독이 아닙니다 (${summary}). API 키 등은 구독 대신 요금이 청구될 수 있습니다 — ` +
          '/login으로 claude.ai 계정에 로그인하세요.',
      );
    }
    if (status.apiProvider !== FIRST_PARTY) {
      problems.push(
        `Anthropic에 직접 연결(apiProvider ${FIRST_PARTY})하지 않습니다. Bedrock·Vertex 같은 다른 과금 경로 설정을 끄세요.`,
      );
    }
  }
  return problems.length === 0
    ? { ok: true, name: CLAUDE_AUTH_CHECK, detail: `claude.ai 구독 (${summary})` }
    : { ok: false, name: CLAUDE_AUTH_CHECK, detail: problems.join('\n') };
}

/** 짧은 식별자 모양의 문자열만 그대로 보여 준다. 그 밖(이메일·조직 이름 같은 값)은 옮기지 않는다 */
function shown(value: unknown): string {
  if (value === null || value === undefined) return '없음';
  return typeof value === 'string' && /^[\w.-]{1,40}$/.test(value) ? value : '(표시하지 않는 값)';
}

function parseObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
