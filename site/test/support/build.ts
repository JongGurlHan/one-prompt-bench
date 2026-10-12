import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* ────────────────────────────────────────────────────────────
 * site 테스트용 빌드 헬퍼 (step 3도 재사용한다)
 * 데이터 루트(@opb/core/testing으로 만든 임시 디렉토리)를 OPB_DATA_ROOT로 넘겨 `astro build`를 자식 프로세스로 돌리고,
 * 출력은 OS 임시 디렉토리에 둔다. 레포의 results/·site/dist/는 읽지도 쓰지도 않는다.
 *
 * 빌드는 (데이터 루트, base)마다 한 번만 하고 결과를 공유한다(buildSite가 같은 Promise를 돌려준다).
 * 같은 site 폴더에서 Astro 빌드가 동시에 돌면 site/.astro·Vite 캐시가 충돌할 수 있어서
 *  - 한 프로세스 안에서는 빌드를 큐에 넣어 하나씩 돌리고
 *  - 테스트 파일끼리는 package.json의 `--test-concurrency=1`로 파일을 하나씩 실행한다.
 * ──────────────────────────────────────────────────────────── */

/** 테스트 빌드의 base (GitHub Pages 프로젝트 경로처럼 / 아닌 base에서도 링크가 맞는지 본다) */
export const TEST_BASE = '/opb-test/';
export const SITE_DIR = fileURLToPath(new URL('../../', import.meta.url));

const ASTRO_BIN = path.join(path.dirname(createRequire(import.meta.url).resolve('astro/package.json')), 'bin', 'astro.mjs');

export interface BuiltSite {
  dataRoot: string;
  base: string;
  outDir: string;
  /** astro build의 stdout + stderr */
  log: string;
  /** outDir 기준 POSIX 경로 전부(파일만, 정렬) */
  files: string[];
  has(rel: string): boolean;
  read(rel: string): Promise<Buffer>;
  readText(rel: string): Promise<string>;
}

/** astro build가 0이 아닌 코드로 끝났을 때. log에 빌드 출력 전체가 있다 */
export class SiteBuildError extends Error {
  constructor(
    readonly exitCode: number | null,
    readonly log: string,
  ) {
    super(`astro build failed (exit ${exitCode})\n${log}`);
    this.name = 'SiteBuildError';
  }
}

const builds = new Map<string, Promise<BuiltSite>>();
let queue: Promise<unknown> = Promise.resolve();

/** dataRoot로 사이트를 빌드한다. 같은 (dataRoot, base)는 한 번만 빌드하고, 빌드끼리는 동시에 돌지 않는다 */
export function buildSite(dataRoot: string, opts: { base?: string } = {}): Promise<BuiltSite> {
  const base = opts.base ?? TEST_BASE;
  const key = `${path.resolve(dataRoot)}\0${base}`;
  let build = builds.get(key);
  if (!build) {
    build = queue.then(() => runBuild(dataRoot, base));
    queue = build.catch(() => {}); // 실패한 빌드가 다음 빌드를 막지 않게
    builds.set(key, build);
  }
  return build;
}

async function runBuild(dataRoot: string, base: string): Promise<BuiltSite> {
  const outDir = await mkdtemp(path.join(tmpdir(), 'opb-site-dist-'));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    OPB_DATA_ROOT: dataRoot,
    SITE_BASE: base,
    ASTRO_TELEMETRY_DISABLED: '1', // 테스트는 네트워크에 닿지 않는다
    NO_COLOR: '1', // log를 글자 그대로 검사한다
  };
  delete env.SITE_URL;
  delete env.FORCE_COLOR;

  const { code, log } = await new Promise<{ code: number | null; log: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [ASTRO_BIN, 'build', '--outDir', outDir], {
      cwd: SITE_DIR,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (b: Buffer) => chunks.push(b));
    child.stderr.on('data', (b: Buffer) => chunks.push(b));
    child.on('error', reject);
    child.on('close', (exitCode) => resolve({ code: exitCode, log: Buffer.concat(chunks).toString('utf8') }));
  });
  if (code !== 0) throw new SiteBuildError(code, log);

  const files = (await readdir(outDir, { recursive: true, withFileTypes: true }))
    .filter((e) => e.isFile())
    .map((e) => path.relative(outDir, path.join(e.parentPath, e.name)).split(path.sep).join('/'))
    .sort();
  const fileSet = new Set(files);
  const abs = (rel: string) => path.join(outDir, ...rel.split('/'));
  return {
    dataRoot,
    base,
    outDir,
    log,
    files,
    has: (rel) => fileSet.has(rel),
    read: (rel) => readFile(abs(rel)),
    readText: (rel) => readFile(abs(rel), 'utf8'),
  };
}

export const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

/** 사이트가 만든 HTML 페이지(결과물 사본 r/ 제외) */
export const sitePages = (site: BuiltSite) => site.files.filter((f) => f.endsWith('.html') && !f.startsWith('r/'));
