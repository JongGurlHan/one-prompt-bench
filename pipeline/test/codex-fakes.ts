import { readFile, writeFile } from 'node:fs/promises';
import type { CodexCommand } from '../src/adapters/codex/codex.bin.js';
import type { CliRequest, CliResult } from '../src/system/cli.js';
import { PARENT_ENV, exited, type FakeRun } from './claude-code-fakes.js';

/* ───────── Codex 어댑터 테스트용 가짜 실행 함수·fixture 로더 (실제 codex를 띄우지 않는다) ───────── */

const FIXTURES = new URL('./fixtures/codex/', import.meta.url);

/** fixtures/codex/<file> 원문 (stdout 그대로) */
export function loadFixture(file: string): Promise<string> {
  return readFile(new URL(file, FIXTURES), 'utf8');
}

/** fixtures/codex/stdout-<name>.jsonl 원문 */
export const loadStdout = (name: string) => loadFixture(`stdout-${name}.jsonl`);

/** fixtures/codex/stdout-<name>.jsonl을 이벤트 배열로 (테스트가 줄을 바꿔 변형을 만들 때) */
export async function loadEvents(name: string): Promise<Record<string, unknown>[]> {
  return (await loadStdout(name))
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** 이벤트 배열 → stdout (한 줄에 하나 + 끝 줄바꿈) */
export const toJsonl = (events: readonly unknown[]) => events.map((e) => `${JSON.stringify(e)}\n`).join('');

/** 인자 배열에서 flag 바로 뒤의 값 */
export function argAfter(args: readonly string[], flag: string): string {
  const i = args.indexOf(flag);
  const value = i === -1 ? undefined : args[i + 1];
  if (value === undefined) throw new Error(`fake codex: 인자에 ${flag} 값이 없다`);
  return value;
}

/** `-c key="value"`의 value (TOML 큰따옴표를 벗긴다) */
export function configString(args: readonly string[], key: string): string {
  const prefix = `${key}=`;
  const arg = args.find((a, i) => args[i - 1] === '-c' && a.startsWith(prefix));
  if (arg === undefined) throw new Error(`fake codex: -c ${key}가 없다`);
  return JSON.parse(arg.slice(prefix.length)) as string;
}

/** stdout에 turn.completed가 있을 때 마지막 agent_message의 text. Codex는 턴이 완료됐을 때만 -o 파일을 쓴다 */
export function lastAgentMessage(stdout: string): string | null {
  const events = stdout
    .split(/\r?\n/)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Record<string, unknown>];
      } catch {
        return [];
      }
    })
    .filter((e) => typeof e === 'object' && e !== null);
  if (!events.some((e) => e.type === 'turn.completed')) return null;
  let text: string | null = null;
  for (const e of events) {
    const item = e.item as Record<string, unknown> | undefined;
    if (e.type === 'item.completed' && item?.type === 'agent_message' && typeof item.text === 'string') text = item.text;
  }
  return text;
}

export interface CodexExitOptions {
  exitCode?: number | null;
  stderr?: string;
  /** -o 경로에 쓸 내용. 기본은 lastAgentMessage(stdout), null이면 쓰지 않는다 */
  lastMessage?: string | null;
  /** 실행 중(임시 폴더가 있을 때) 요청을 들여다본다 */
  inspect?: (req: CliRequest) => Promise<void>;
}

/** Codex를 흉내 내는 대본 한 줄: -o 경로에 마지막 메시지를 쓰고(실패 출력은 쓰지 않는다) stdout으로 끝난다 */
export function codexExited(stdout: string, opts: CodexExitOptions = {}): FakeRun {
  return async (req: CliRequest): Promise<CliResult> => {
    await opts.inspect?.(req);
    const message = opts.lastMessage === undefined ? lastAgentMessage(stdout) : opts.lastMessage;
    if (message !== null) await writeFile(argAfter(req.args, '-o'), message, 'utf8');
    return exited(stdout, opts.exitCode ?? 0, opts.stderr ?? '');
  };
}

/** 이 테스트들이 기대하는 버전 (codex --version 출력 `codex-cli 0.157.1`의 숫자) */
export const FAKE_CODEX_VERSION = '0.157.1';

/** Windows처럼 node + codex.js로 띄우는 명령. 경로는 기록(invocation)에 나오면 안 된다 */
export const FAKE_CODEX_COMMAND: CodexCommand = {
  bin: '/fake/home/user/node/node.exe',
  prefixArgs: ['/fake/home/user/npm/node_modules/@openai/codex/bin/codex.js'],
};

/** 부모 환경: API 키·Claude Code 세션 변수(PARENT_ENV)에 Codex 인증 폴더 변수를 더했다 */
export const CODEX_PARENT_ENV: Readonly<Record<string, string>> = {
  ...PARENT_ENV,
  CODEX_HOME: '/home/user/.codex-alt',
};
