import type { CliResult, RunCli } from '../system/cli.js';
import type { RawFile, RawRecorder, Redact } from './raw-recorder.js';

/* ────────────────────────────────────────────────────────────
 * smoke용 CLI 기록 래퍼 (Claude Code·Codex 공용). 어댑터에 주입하는 생성용 실행 함수(RunCli)만 감싼다
 * (버전 읽기·로그인 점검은 이 함수를 거치지 않아 기록되지 않는다).
 *   raw-stdout.txt : stdout 그대로 — test/fixtures/claude-code/stdout-*.json·test/fixtures/codex/stdout-*.jsonl로 그대로 복사할 수 있다
 *   raw-stderr.txt : stderr (redact 적용)
 *   raw-exit.json  : { exitCode, signal } (redact 적용). 실행 함수가 던졌으면 error { name, message, code }도
 * 요청·결과·에러는 바꾸거나 삼키지 않고 그대로 넘긴다. 여러 번 불리면 마지막 호출을 남긴다.
 * ──────────────────────────────────────────────────────────── */

export const RAW_STDOUT_FILE = 'raw-stdout.txt';
export const RAW_STDERR_FILE = 'raw-stderr.txt';
export const RAW_EXIT_FILE = 'raw-exit.json';

interface RawExit {
  exitCode: number | null;
  signal: string | null;
  /** 실행 함수가 던진 에러 (ENOENT·abort·출력 상한 초과). 이때는 stdout·stderr를 받지 못했다 */
  error?: { name: string; message: string; code?: string };
}

/**
 * redact: .env 값처럼 정확히 아는 비밀값을 가린다. stdout에는 적용하지 않는다 — 생성된 코드가 바뀌면 안 된다
 * (자식 환경에는 .env 값이 없어 stdout에 섞일 경로도 없다).
 */
export function createCliRecorder(redact: Redact): RawRecorder<RunCli> {
  let last: { result: CliResult } | { error: unknown } | null = null;

  return {
    wrap(run) {
      return async (req) => {
        try {
          const result = await run(req);
          last = { result };
          return result;
        } catch (error) {
          last = { error };
          throw error;
        }
      };
    },

    files() {
      if (last === null) return [];
      if ('error' in last) return [exitFile({ exitCode: null, signal: null, error: describeError(last.error) })];
      const { stdout, stderr, exitCode, signal } = last.result;
      return [
        { name: RAW_STDOUT_FILE, content: stdout },
        { name: RAW_STDERR_FILE, content: redact(stderr) },
        exitFile({ exitCode, signal }),
      ];
    },
  };

  function exitFile(exit: RawExit): RawFile {
    return { name: RAW_EXIT_FILE, content: `${redact(JSON.stringify(exit, null, 2))}\n` };
  }
}

function describeError(err: unknown): NonNullable<RawExit['error']> {
  const code = typeof err === 'object' && err !== null && 'code' in err && typeof err.code === 'string' ? err.code : undefined;
  return {
    name: err instanceof Error ? err.name : typeof err,
    message: err instanceof Error ? err.message : String(err),
    ...(code === undefined ? {} : { code }),
  };
}
