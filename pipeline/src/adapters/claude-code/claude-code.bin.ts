import { existsSync } from 'node:fs';
import path from 'node:path';
import { cliEnv, findOnPath, runSync, type RunSync } from '../../system/cli.js';

/* ────────────────────────────────────────────────────────────
 * claude 실행 파일 찾기와 버전 읽기 (ARCHITECTURE "Claude Code CLI").
 * Windows의 npm 전역 설치는 claude.cmd shim이라 shell 없이 띄울 수 없다 → shim 옆의 실제 claude.exe를 쓴다
 * (하네스 scripts/execute.py resolve_claude_bin과 같은 방식). 버전은 meta.json runtime.generator.version이 된다.
 * ──────────────────────────────────────────────────────────── */

const COMMAND = 'claude';
/** shell 없이 spawn할 수 없는 Windows 스크립트 확장자 */
const SHIM_EXTENSIONS = ['.cmd', '.bat'];
/** npm shim이 실제로 띄우는 실행 파일 (shim과 같은 폴더 기준) */
const EXE_BESIDE_SHIM = ['node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'];

export interface ResolveClaudeBinOptions {
  env?: Readonly<Record<string, string | undefined>>;
  platform?: NodeJS.Platform;
}

/** PATH에서 claude를 찾아 shell 없이 띄울 수 있는 경로를 돌려준다. 못 찾으면 사람이 읽을 에러로 멈춘다 */
export function resolveClaudeBin(opts: ResolveClaudeBinOptions = {}): string {
  const found = findOnPath(COMMAND, opts);
  if (found === null) {
    throw new Error(
      'claude 실행 파일을 PATH에서 찾지 못했습니다. Claude Code를 설치하고 터미널에서 claude --version이 되는지 확인하세요.',
    );
  }
  // findOnPath는 PATHEXT 표기(대문자일 수 있다) 그대로 돌려준다
  if (!SHIM_EXTENSIONS.some((ext) => found.toLowerCase().endsWith(ext))) return found;
  const exe = path.join(path.dirname(found), ...EXE_BESIDE_SHIM);
  if (existsSync(exe)) return exe;
  throw new Error(
    `PATH의 claude가 npm shim(${path.basename(found)})이고 옆에 실제 실행 파일이 없습니다: ${exe}\n` +
      'shell 없이는 shim을 띄울 수 없습니다. Claude Code를 npm으로 다시 설치하세요.',
  );
}

/* ───────── 버전 ───────── */

/** `2.1.296 (Claude Code)` → `2.1.296`. 버전 숫자로 시작하지 않으면 null */
export function parseClaudeVersion(stdout: string): string | null {
  const m = /^\s*(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?=\s|$)/.exec(stdout);
  return m?.[1] ?? null;
}

/** `<bin> --version`을 정리한 환경(API 키·세션 변수 없음)으로 실행해 버전을 읽는다. 못 읽으면 throw (지어낸 버전을 기록하지 않는다) */
export function readClaudeVersion(
  bin: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  run: RunSync = runSync,
): string {
  const r = run(bin, ['--version'], cliEnv(env));
  if (r.error) throw new Error(`claude --version을 실행하지 못했습니다: ${r.error.message}`);
  if (r.status !== 0) {
    throw new Error(`claude --version이 실패했습니다 (exit code ${r.status}): ${r.stderr.trim().slice(0, 200)}`);
  }
  const version = parseClaudeVersion(r.stdout);
  if (version === null) {
    throw new Error(`claude --version 출력에서 버전 숫자를 읽지 못했습니다: ${JSON.stringify(r.stdout.trim().slice(0, 100))}`);
  }
  return version;
}
