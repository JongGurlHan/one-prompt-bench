import { existsSync } from 'node:fs';
import path from 'node:path';
import { cliEnv, findOnPath, runSync, type RunSync } from '../../system/cli.js';

/* ────────────────────────────────────────────────────────────
 * codex 실행 명령 찾기와 버전 읽기 (ARCHITECTURE "Codex CLI").
 * Windows의 npm 전역 설치는 codex.cmd shim → node codex.js → 플랫폼 패키지의 codex.exe 순서로 실행된다.
 * shell 없이는 shim을 띄울 수 없어서 shim 옆의 codex.js를 지금 실행 중인 Node로 띄운다
 * (공식 실행기가 넣는 CODEX_MANAGED_* 환경 변수와 신호 전달을 그대로 쓰려고). 버전은 meta.json runtime.generator.version이 된다.
 * ──────────────────────────────────────────────────────────── */

const COMMAND = 'codex';
/** shell 없이 spawn할 수 없는 Windows 스크립트 확장자 */
const SHIM_EXTENSIONS = ['.cmd', '.bat'];
/** npm shim이 Node로 실행하는 공식 실행기 (shim과 같은 폴더 기준) */
const JS_BESIDE_SHIM = ['node_modules', '@openai', 'codex', 'bin', 'codex.js'];

/** shell 없이 띄우는 명령: bin + prefixArgs 뒤에 codex 인자가 온다 (Windows npm 설치는 node + codex.js) */
export interface CodexCommand {
  bin: string;
  prefixArgs: readonly string[];
}

export interface ResolveCodexCommandOptions {
  env?: Readonly<Record<string, string | undefined>>;
  platform?: NodeJS.Platform;
  /** codex.js를 실행할 Node (기본 process.execPath) */
  nodePath?: string;
}

/** PATH에서 codex를 찾아 shell 없이 띄울 수 있는 명령을 돌려준다. 못 찾으면 사람이 읽을 에러로 멈춘다 */
export function resolveCodexCommand(opts: ResolveCodexCommandOptions = {}): CodexCommand {
  const found = findOnPath(COMMAND, { env: opts.env, platform: opts.platform });
  if (found === null) {
    throw new Error(
      'codex 실행 파일을 PATH에서 찾지 못했습니다. Codex CLI를 설치하고 터미널에서 codex --version이 되는지 확인하세요.',
    );
  }
  // findOnPath는 PATHEXT 표기(대문자일 수 있다) 그대로 돌려준다
  if (!SHIM_EXTENSIONS.some((ext) => found.toLowerCase().endsWith(ext))) return { bin: found, prefixArgs: [] };
  const script = path.join(path.dirname(found), ...JS_BESIDE_SHIM);
  if (existsSync(script)) return { bin: opts.nodePath ?? process.execPath, prefixArgs: [script] };
  throw new Error(
    `PATH의 codex가 npm shim(${path.basename(found)})이고 옆에 공식 실행기가 없습니다: ${script}\n` +
      'shell 없이는 shim을 띄울 수 없습니다. Codex CLI를 npm으로 다시 설치하세요(npm install -g @openai/codex).',
  );
}

/* ───────── 버전 ───────── */

/** `codex-cli 0.157.1` → `0.157.1`. 이 형식이 아니면 null (다른 프로그램의 숫자를 버전으로 읽지 않는다) */
export function parseCodexVersion(stdout: string): string | null {
  const m = /^\s*codex-cli (\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?=\s|$)/.exec(stdout);
  return m?.[1] ?? null;
}

/** `[...prefixArgs, --version]`을 정리한 환경(API 키·세션 변수 없음)으로 실행해 버전을 읽는다. 못 읽으면 throw (지어낸 버전을 기록하지 않는다) */
export function readCodexVersion(
  command: CodexCommand,
  env: Readonly<Record<string, string | undefined>> = process.env,
  run: RunSync = runSync,
): string {
  const r = run(command.bin, [...command.prefixArgs, '--version'], cliEnv(env));
  if (r.error) throw new Error(`codex --version을 실행하지 못했습니다: ${r.error.message}`);
  if (r.status !== 0) {
    throw new Error(`codex --version이 실패했습니다 (exit code ${r.status}): ${r.stderr.trim().slice(0, 200)}`);
  }
  const version = parseCodexVersion(r.stdout);
  if (version === null) {
    throw new Error(`codex --version 출력에서 버전 숫자를 읽지 못했습니다: ${JSON.stringify(r.stdout.trim().slice(0, 100))}`);
  }
  return version;
}
