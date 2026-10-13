import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { CliRequest, CliResult, RunCli } from '../src/system/cli.js';

/* ───────── Claude Code 어댑터 테스트용 가짜 실행 함수·fixture 로더 (실제 claude를 띄우지 않는다) ───────── */

const FIXTURES = new URL('./fixtures/claude-code/', import.meta.url);

/** fixtures/claude-code/<file> 원문 (stdout 그대로) */
export function loadFixture(file: string): Promise<string> {
  return readFile(new URL(file, FIXTURES), 'utf8');
}

/** fixtures/claude-code/stdout-<name>.json 원문 */
export const loadStdout = (name: string) => loadFixture(`stdout-${name}.json`);

/** fixtures/claude-code/stdout-<name>.json을 JSON으로 (테스트가 필드 하나를 바꿔 변형을 만들 때) */
export async function loadOutput(name: string): Promise<Record<string, unknown>> {
  return JSON.parse(await loadStdout(name)) as Record<string, unknown>;
}

/** fixtures/claude-code/auth-status-<name>.json 원문 */
export const loadAuthStatus = (name: string) => loadFixture(`auth-status-${name}.json`);

export function exited(stdout: string, exitCode: number | null = 0, stderr = ''): CliResult {
  return { exitCode, signal: null, stdout, stderr };
}

/** 호출 1회의 대본: 결과를 돌려주거나, 던지거나, 요청을 보고 직접 처리한다 */
export type FakeRun = CliResult | { reject: unknown } | ((req: CliRequest) => Promise<CliResult>);

/** 실행 함수가 불렸을 때 작업 폴더의 상태 */
export interface CwdState {
  cwd: string;
  existed: boolean;
  entries: string[];
}

export interface FakeRunCli extends RunCli {
  requests: CliRequest[];
  cwdStates: CwdState[];
}

/** 대본대로 답하는 가짜 실행 함수. 부를 때마다 요청과 작업 폴더 상태를 기록한다 */
export function fakeRunCli(script: FakeRun[]): FakeRunCli {
  const requests: CliRequest[] = [];
  const cwdStates: CwdState[] = [];
  const run = async (req: CliRequest): Promise<CliResult> => {
    const n = requests.length;
    requests.push(req);
    const existed = existsSync(req.cwd);
    cwdStates.push({ cwd: req.cwd, existed, entries: existed ? readdirSync(req.cwd) : [] });
    const step = script[n];
    if (step === undefined) throw new Error(`fake claude: 대본이 끝났다 (호출 ${n + 1}번째)`);
    if (typeof step === 'function') return step(req);
    if ('reject' in step) throw step.reject;
    return step;
  };
  return Object.assign(run, { requests, cwdStates });
}

/**
 * preflight·생성을 함께 받는 가짜 claude: `auth status`는 auth로 답하고, 나머지(생성)는 대본대로.
 * batch·smoke 테스트가 레지스트리 항목에 주입한다.
 */
export function fakeClaude(opts: { auth: FakeRun; runs: FakeRun[] }): FakeRunCli & {
  auth: FakeRunCli;
  generation: FakeRunCli;
} {
  const auth = fakeRunCli([opts.auth, opts.auth, opts.auth]);
  const generation = fakeRunCli(opts.runs);
  const all: CliRequest[] = [];
  const cwdStates: CwdState[] = [];
  const run = (req: CliRequest): Promise<CliResult> => {
    all.push(req);
    return req.args[0] === 'auth' ? auth(req) : generation(req);
  };
  return Object.assign(run, { requests: all, cwdStates, auth, generation });
}

/** 이 테스트들이 기대하는 버전 (claude --version 출력 `2.1.296 (Claude Code)`의 앞 숫자) */
export const FAKE_CLAUDE_VERSION = '2.1.296';
export const FAKE_CLAUDE_BIN = '/fake/bin/claude';

/** 자식 환경 정리를 볼 때 쓰는 부모 환경: API 키와 Claude Code 세션이 물려주는 변수가 섞여 있다 */
export const PARENT_ENV: Readonly<Record<string, string>> = {
  PATH: '/usr/bin',
  HOME: '/home/user',
  CLAUDE_CONFIG_DIR: '/home/user/.claude-alt',
  CLAUDE_CODE_GIT_BASH_PATH: 'C:\\Program Files\\Git\\bin\\bash.exe',
  ANTHROPIC_API_KEY: 'sk-ant-should-not-pass',
  OPENAI_API_KEY: 'sk-openai-should-not-pass',
  CLAUDECODE: '1',
  CLAUDE_EFFORT: 'max',
  CLAUDE_PID: '4242',
  AI_AGENT: 'claude-code',
  CLAUDE_CODE_SESSION_ID: 'parent-session',
  CLAUDE_CODE_ENTRYPOINT: 'cli',
  CLAUDE_CODE_MAX_OUTPUT_TOKENS: '1',
};
