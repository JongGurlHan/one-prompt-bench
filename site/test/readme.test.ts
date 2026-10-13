import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { before, test } from 'node:test';

/* ────────────────────────────────────────────────────────────
 * 레포 루트 README.md 검사 (읽기만 한다)
 * 적힌 npm 명령·경로가 실제와 맞는지, 비밀값·키 모양·로컬 절대 경로·모델 수가 없는지 본다.
 * 모델은 계속 추가되므로 README에 모델 수를 쓰지 않는다 (목록은 models.json).
 * ──────────────────────────────────────────────────────────── */

const REPO = new URL('../../', import.meta.url);
const PUBLIC_URL = 'https://jonggurlhan.github.io/one-prompt-bench/';
/** 빌드하면 생기는 경로 (CI는 테스트를 빌드보다 먼저 돌린다) */
const GENERATED = new Set(['site/dist/']);

let readme: string;
let scripts: Record<string, string>;

before(async () => {
  readme = await readFile(new URL('README.md', REPO), 'utf8');
  scripts = (JSON.parse(await readFile(new URL('package.json', REPO), 'utf8')) as { scripts: Record<string, string> }).scripts;
});

const exists = (rel: string) => stat(new URL(rel, REPO)).then(
  () => true,
  () => false,
);

test('README의 npm 명령은 모두 루트 package.json의 scripts에 있다', () => {
  const used = new Set<string>();
  for (const m of readme.matchAll(/\bnpm run ([\w:.-]+)/g)) used.add(m[1]!);
  for (const m of readme.matchAll(/\bnpm (test|start)\b/g)) used.add(m[1]!);
  for (const name of used) assert.ok(Object.hasOwn(scripts, name), `README의 npm 명령 "${name}"이 package.json scripts에 없다`);
  // 로컬 실행·검사 명령은 빠지지 않는다
  for (const name of ['dev', 'test', 'build', 'lint', 'typecheck', 'check:results']) assert.ok(used.has(name), `npm ${name} 안내가 없다`);
  assert.match(readme, /npm install/);
  assert.match(readme, /npx playwright install chromium/);
});

test('README의 상대 링크와 `경로`는 레포에 있다', async () => {
  const paths = new Set<string>();
  for (const m of readme.matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g)) if (!/^[a-z]+:/i.test(m[1]!)) paths.add(m[1]!);
  for (const m of readme.matchAll(/`([\w.-]+(?:\/[\w.-]+)*\/?)`/g)) {
    const p = m[1]!;
    if (p.includes('/') || /\.(md|json|ts|mjs|js|yml|py)$/.test(p)) paths.add(p);
  }
  assert.ok(paths.size > 0);
  for (const p of paths) {
    if (GENERATED.has(p)) continue;
    assert.ok(await exists(p.replace(/^\.\//, '')), `README가 가리키는 ${p}가 없다`);
  }
});

test('README에 공개 사이트 주소와 원칙(순위가 아니라 기록, 추가 결제 0원, 운영 문서)이 있다', () => {
  assert.ok(readme.includes(PUBLIC_URL));
  assert.ok(readme.includes('순위가 아니라 기록'));
  assert.ok(readme.includes('추가 결제 0원'));
  assert.ok(readme.includes('docs/OPERATIONS.md'));
  assert.ok(readme.includes('models.json'));
  assert.ok(readme.includes('prompts/'));
});

test('README에 비밀값·키 모양·계정 정보·로컬 절대 경로·모델 수가 없다', () => {
  const forbidden: [RegExp, string][] = [
    [/sk-[A-Za-z0-9_-]/, 'sk- 키 모양'],
    [/AIza/, 'Google API 키 모양'],
    [/gh[pousr]_[A-Za-z0-9]{10,}|github_pat_/, 'GitHub 토큰 모양'],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, '개인 키'],
    [/[A-Z_]*(API_KEY|TOKEN|SECRET)\s*=\s*\S/, '비밀값 대입'],
    [/[\w.+-]+@[\w-]+\.[\w.-]+/, '이메일 주소'],
    [/\b[A-Za-z]:[\\/]/, 'Windows 절대 경로'],
    [/(^|[\s`(])\/(Users|home)\//m, 'macOS·Linux 홈 경로'],
    [/모델\s*\d+\s*개|\d+\s*개(의)?\s*모델/, '모델 수'],
  ];
  for (const [pattern, what] of forbidden) assert.doesNotMatch(readme, pattern, what);
});
