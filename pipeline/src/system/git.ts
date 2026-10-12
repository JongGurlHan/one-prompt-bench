import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/** preflight·runtime.gitCommit에 쓰는 git 조회. 테스트는 가짜를 주입한다 (실제 git 결과는 작업 트리에 따라 달라진다) */
export interface GitClient {
  /** `git status --porcelain -- <paths…>` 출력 그대로. 빈 문자열 = 변경 없음 */
  status(paths: readonly string[]): Promise<string>;
  /** `git rev-parse HEAD` (줄바꿈 제거) */
  head(): Promise<string>;
}

export type ExecFile = (file: string, args: readonly string[], opts: { cwd: string }) => Promise<{ stdout: string }>;

const execFileAsync = promisify(execFile);

const runFile: ExecFile = async (file, args, opts) => {
  const { stdout } = await execFileAsync(file, [...args], { cwd: opts.cwd, encoding: 'utf8', windowsHide: true });
  return { stdout };
};

export function createGitClient(repoRoot: string, exec: ExecFile = runFile): GitClient {
  return {
    async status(paths) {
      return (await exec('git', ['status', '--porcelain', '--', ...paths], { cwd: repoRoot })).stdout;
    },
    async head() {
      return (await exec('git', ['rev-parse', 'HEAD'], { cwd: repoRoot })).stdout.trim();
    },
  };
}
