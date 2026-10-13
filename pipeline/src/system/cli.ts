import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { accessSync, constants as fsConstants, statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/* ────────────────────────────────────────────────────────────
 * CLI 생성 도구(Claude Code·Codex)를 띄우는 공통 부분 (ARCHITECTURE "도구별 호출 사양" 공통 절).
 * 도구 중립이다: 인자·출력 해석·실행 파일 고르기는 어댑터가 한다.
 * - shell 없이 실행 파일 경로 + 인자 배열로 띄운다 (한글 인자·프롬프트 인용 문제 방지). 프롬프트는 stdin.
 * - 자식 환경은 cliEnv를 거친 값만 준다 (API 키·Claude Code 세션 변수 삭제, ADR-001).
 * - abort되면 손자까지 프로세스 트리를 종료한다. 작업 디렉토리는 매 시도 빈 OS 임시 폴더 (ADR-006).
 * ──────────────────────────────────────────────────────────── */

/** 환경에 있으면 CLI가 구독 대신 API 키로 과금할 수 있는 변수 (ADR-001). preflight도 이 상수로 검사한다 */
export const FORBIDDEN_ENV_KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'] as const;

/** stdout·stderr 각각의 기본 상한. 생성 결과(수백 KB)보다 훨씬 크게 — 넘으면 고장 난 프로세스로 보고 멈춘다 */
export const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

/** 트리를 종료한 뒤 출력 파이프가 닫히기를 기다리는 최대 시간. 넘으면 기다리지 않고 끝낸다 */
export const KILL_GRACE_MS = 3_000;

export interface CliRequest {
  /** 실행 파일 경로 (shell 없이 spawn — Windows의 .cmd shim은 띄울 수 없다) */
  bin: string;
  args: readonly string[];
  /** UTF-8로 쓰고 닫는다 */
  stdin: string;
  cwd: string;
  /** 이 값만 자식에게 준다 (process.env를 섞지 않는다). cliEnv로 만든다 */
  env: Readonly<Record<string, string>>;
  signal?: AbortSignal;
  /** stdout·stderr 각각의 상한 (기본 MAX_OUTPUT_BYTES). 넘으면 트리를 종료하고 CliOutputLimitError로 reject */
  maxOutputBytes?: number;
}

export interface CliResult {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
}

/** 0이 아닌 exit code는 예외가 아니다(해석은 어댑터 몫). 실행 파일이 없으면 spawn 에러(code ENOENT)로 reject */
export type RunCli = (req: CliRequest) => Promise<CliResult>;

/** abort로 끝난 실행. 어댑터는 Gemini와 같은 방식(name === 'AbortError')으로 알아본다. cause = signal.reason */
export class CliAbortError extends Error {
  override name = 'AbortError';

  constructor(reason: unknown) {
    super('CLI 실행을 중단했습니다 (abort)', { cause: reason });
  }
}

export class CliOutputLimitError extends Error {
  override name = 'CliOutputLimitError';

  constructor(
    readonly stream: 'stdout' | 'stderr',
    readonly limit: number,
  ) {
    super(`CLI ${stream} 출력이 ${limit}바이트를 넘어 실행을 멈췄습니다`);
  }
}

export const runCli: RunCli = (req) =>
  new Promise<CliResult>((resolve, reject) => {
    const { signal } = req;
    if (signal?.aborted) {
      reject(new CliAbortError(signal.reason));
      return;
    }

    const child = spawn(req.bin, [...req.args], {
      cwd: req.cwd,
      env: { ...req.env },
      shell: false,
      windowsHide: true,
      // POSIX: 자식을 새 프로세스 그룹의 리더로 띄워 그룹째 종료한다. Windows는 taskkill /T가 트리를 찾는다
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const limit = req.maxOutputBytes ?? MAX_OUTPUT_BYTES;
    const output = { stdout: [] as Buffer[], stderr: [] as Buffer[] };
    const size = { stdout: 0, stderr: 0 };
    /** 트리를 종료한 이유. 정해지면 결과 대신 이 에러로 끝난다 */
    let stopped: Error | null = null;
    let settled = false;
    let grace: NodeJS.Timeout | undefined;

    const finish = (done: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(grace);
      signal?.removeEventListener('abort', onAbort);
      done();
    };

    const stop = (error: Error) => {
      if (stopped) return;
      stopped = error;
      killTree(child);
      // 트리 밖으로 빠져나간 손자가 파이프를 쥐고 있으면 close가 오지 않는다 → 기다리지 않고 끝낸다
      grace = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
        finish(() => reject(error));
      }, KILL_GRACE_MS);
    };

    function onAbort() {
      stop(new CliAbortError(signal?.reason));
    }
    signal?.addEventListener('abort', onAbort, { once: true });

    const collect = (stream: 'stdout' | 'stderr') => (chunk: Buffer) => {
      if (stopped) return;
      size[stream] += chunk.length;
      if (size[stream] > limit) stop(new CliOutputLimitError(stream, limit));
      else output[stream].push(chunk);
    };
    child.stdout.on('data', collect('stdout'));
    child.stderr.on('data', collect('stderr'));

    // 자식이 stdin을 읽지 않고 먼저 끝나면 EPIPE·EOF가 난다. 실패 여부는 exit code와 출력으로 판단한다
    child.stdin.on('error', () => {});
    child.stdin.end(req.stdin, 'utf8');

    // spawn 실패(ENOENT 등). 트리를 종료하는 중이면 그 이유로 끝난다
    child.on('error', (err) => finish(() => reject(stopped ?? err)));
    // close = 프로세스가 끝나고 stdout·stderr가 모두 닫힘. 끝난 뒤 한 번에 디코딩해 한글이 청크 경계에서 깨지지 않는다
    child.on('close', (exitCode, exitSignal) =>
      finish(() => {
        if (stopped) reject(stopped);
        else
          resolve({
            exitCode,
            signal: exitSignal,
            stdout: Buffer.concat(output.stdout).toString('utf8'),
            stderr: Buffer.concat(output.stderr).toString('utf8'),
          });
      }),
    );
  });

/** 자식과 그 자손을 모두 강제 종료한다 (Windows: taskkill /T /F, POSIX: 프로세스 그룹에 SIGKILL) */
function killTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    // taskkill을 못 띄우거나 실패하면 자식만이라도
    killer.on('error', () => child.kill());
    killer.on('exit', (code) => {
      if (code !== 0) child.kill();
    });
  } else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}

/* ───────── 동기 실행 (버전 읽기) ───────── */

/** `--version`처럼 짧은 동기 실행이 끝나기를 기다리는 최대 시간 */
export const SYNC_TIMEOUT_MS = 30_000;

export interface SyncRunResult {
  status: number | null;
  stdout: string;
  stderr: string;
  /** 띄우지 못했거나 시간 초과 */
  error?: Error;
}

/** 동기 실행 함수. 레지스트리의 create()가 동기라서 버전 읽기에만 쓴다 */
export type RunSync = (bin: string, args: readonly string[], env: Readonly<Record<string, string>>) => SyncRunResult;

/** shell 없이, OS 임시 폴더(레포 밖)에서, 준 env만으로 실행한다. env는 cliEnv로 만든다 */
export const runSync: RunSync = (bin, args, env) => {
  const r = spawnSync(bin, [...args], {
    cwd: tmpdir(),
    env: { ...env },
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: SYNC_TIMEOUT_MS,
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', ...(r.error ? { error: r.error } : {}) };
};

/* ───────── 자식 환경 ───────── */

/** Claude Code 세션이 자식에게 물려주는 변수 — 중첩 세션 거부(CLAUDECODE)·추론 강도 섞임(CLAUDE_EFFORT)을 막는다 */
const SESSION_ENV_KEYS: readonly string[] = ['CLAUDECODE', 'CLAUDE_EFFORT', 'CLAUDE_PID', 'AI_AGENT'];
const SESSION_ENV_PREFIX = 'CLAUDE_CODE_';
/** CLAUDE_CODE_로 시작하지만 사용자가 설정하는 변수 (CLAUDE_CONFIG_DIR는 접두어가 달라 원래 남는다) */
const KEPT_ENV_KEYS: readonly string[] = ['CLAUDE_CODE_GIT_BASH_PATH'];
const FORBIDDEN: readonly string[] = FORBIDDEN_ENV_KEYS;

/** 이름 비교는 모든 플랫폼에서 대소문자를 무시한다 (Windows는 대소문자를 구분하지 않고, 지우는 쪽으로 틀리는 것은 안전하다) */
function isRemoved(name: string): boolean {
  const key = name.toUpperCase();
  if (KEPT_ENV_KEYS.includes(key)) return false;
  return FORBIDDEN.includes(key) || SESSION_ENV_KEYS.includes(key) || key.startsWith(SESSION_ENV_PREFIX);
}

/** base 환경에서 지울 것을 지우고 set을 덮어쓴 자식 환경. set에 API 키 변수가 있으면 throw */
export function cliEnv(
  base: Readonly<Record<string, string | undefined>>,
  set: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(base)) {
    if (value !== undefined && !isRemoved(name)) env[name] = value;
  }
  for (const [name, value] of Object.entries(set)) {
    if (FORBIDDEN.includes(name.toUpperCase())) throw new Error(`자식 환경에 ${name}를 넣을 수 없습니다 (API 키 과금, ADR-001)`);
    // 대소문자만 다른 기존 항목을 지운다: Windows에서 같은 변수가 두 번 들어가면 어느 값이 쓰일지 모른다
    for (const existing of Object.keys(env)) {
      if (existing.toUpperCase() === name.toUpperCase()) delete env[existing];
    }
    env[name] = value;
  }
  return env;
}

/* ───────── 실행 파일 찾기 ───────── */

const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';

/**
 * PATH(Windows는 PATHEXT 포함)에서 실행 파일을 찾는다. 없으면 null. 현재 디렉토리는 보지 않는다.
 * Windows: 디렉토리 순서 → PATHEXT 순서. 돌려주는 경로의 확장자는 PATHEXT 표기 그대로다(대문자일 수 있다).
 */
export function findOnPath(
  name: string,
  opts: { env?: Readonly<Record<string, string | undefined>>; platform?: NodeJS.Platform } = {},
): string | null {
  const env = opts.env ?? process.env;
  const windows = (opts.platform ?? process.platform) === 'win32';
  const pathValue = windows ? envValue(env, 'PATH') : env['PATH'];
  if (!pathValue) return null;

  const dirs = pathValue
    .split(windows ? ';' : ':')
    .map((d) => (windows ? d.trim().replace(/^"(.*)"$/, '$1') : d))
    .filter((d) => d !== '');
  let names = [name];
  if (windows) {
    const exts = (envValue(env, 'PATHEXT') || DEFAULT_PATHEXT).split(';').filter((e) => e !== '');
    const hasExt = exts.some((ext) => name.toUpperCase().endsWith(ext.toUpperCase()));
    names = hasExt ? [name] : exts.map((ext) => name + ext);
  }

  for (const dir of dirs) {
    for (const candidate of names) {
      const file = path.join(dir, candidate);
      if (isExecutableFile(file, windows)) return file;
    }
  }
  return null;
}

function envValue(env: Readonly<Record<string, string | undefined>>, name: string): string | undefined {
  const key = Object.keys(env).find((k) => k.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
}

function isExecutableFile(file: string, windows: boolean): boolean {
  try {
    if (!statSync(file).isFile()) return false;
    if (!windows) accessSync(file, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/* ───────── 임시 작업 디렉토리 ───────── */

/**
 * OS 임시 디렉토리에 빈 폴더를 만들어 fn에 주고, 성공·실패와 관계없이 지운다.
 * 레포 안에 만들지 않는다: 생성 도구가 CLAUDE.md·AGENTS.md를 읽으면 벤치마크가 오염된다 (ADR-006).
 * 지우기 실패는 fn의 결과·에러를 덮지 않는다 (OS 임시 폴더라 남아도 해가 없고, 이미 받은 생성 결과를 잃지 않게).
 */
export async function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    // Windows: 막 끝난 프로세스가 폴더를 잠깐 쥐고 있을 수 있어 재시도한다
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {});
  }
}
