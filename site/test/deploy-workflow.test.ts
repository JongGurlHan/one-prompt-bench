import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before, test } from 'node:test';
import { parseDocument } from 'yaml';

/* ────────────────────────────────────────────────────────────
 * 배포 워크플로(.github/workflows/deploy.yml) 검사 (docs/ARCHITECTURE.md "배포", ADR-017)
 * 레포의 워크플로 파일을 읽기만 한다. 구조는 yaml 파서로 읽는다(정규식으로 YAML을 흉내 내지 않는다).
 * 검사를 모두 통과해야만 배포하고, 비밀값·실제 모델 호출·results를 바꾸는 명령이 없는지 본다.
 * ──────────────────────────────────────────────────────────── */

const WORKFLOW = new URL('../../.github/workflows/deploy.yml', import.meta.url);

interface Step {
  id?: string;
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, unknown>;
  [key: string]: unknown;
}

interface Job {
  'runs-on'?: unknown;
  needs?: unknown;
  environment?: unknown;
  steps?: Step[];
  [key: string]: unknown;
}

interface Workflow {
  on?: Record<string, unknown>;
  permissions?: unknown;
  concurrency?: unknown;
  env?: unknown;
  jobs?: Record<string, Job>;
  [key: string]: unknown;
}

/** build job의 run·uses 순서 (ARCHITECTURE "배포") */
const BUILD_STEPS = [
  'uses actions/checkout@v7',
  'uses actions/setup-node@v7',
  'run npm ci',
  'run npx playwright install --with-deps chromium',
  'run npm run lint',
  'run npm run typecheck',
  'run npm test',
  'run npm run check:results',
  'uses actions/configure-pages@v6',
  'run npm run build',
  'uses actions/upload-pages-artifact@v5',
];
const DEPLOY_STEPS = ['uses actions/deploy-pages@v5'];

let source: string;
let workflow: Workflow;

before(async () => {
  source = await readFile(WORKFLOW, 'utf8');
  const doc = parseDocument(source);
  assert.deepEqual(doc.errors, [], 'YAML 오류');
  assert.deepEqual(doc.warnings, [], 'YAML 경고');
  workflow = doc.toJS() as Workflow;
});

const jobs = () => workflow.jobs ?? {};
const job = (name: string) => {
  const found = jobs()[name];
  assert.ok(found, `job ${name} 없음`);
  return found;
};
const steps = (name: string) => job(name).steps ?? [];
const stepKey = (s: Step) => {
  assert.ok((s.uses === undefined) !== (s.run === undefined), `step은 uses와 run 중 하나만: ${JSON.stringify(s)}`);
  return s.uses !== undefined ? `uses ${s.uses}` : `run ${String(s.run).trim()}`;
};
const stepOf = (name: string, key: string) => {
  const found = steps(name).find((s) => stepKey(s) === key);
  assert.ok(found, `${name}: ${key} 없음`);
  return found;
};
/** 워크플로 전체에서 key가 나오는 곳(경로) */
function findKeys(value: unknown, key: string, at = '$'): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => findKeys(v, key, `${at}[${i}]`));
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([k, v]) => [...(k === key ? [`${at}.${k}`] : []), ...findKeys(v, key, `${at}.${k}`)]);
}

/* ───────── 트리거·권한·동시 실행·환경 ───────── */

test('트리거는 main push와 수동 실행(workflow_dispatch) 두 개뿐이다', () => {
  const on = workflow.on;
  assert.ok(on && typeof on === 'object', 'on 없음');
  assert.deepEqual(Object.keys(on).sort(), ['push', 'workflow_dispatch']);
  assert.deepEqual(on.push, { branches: ['main'] });
  const dispatch = on.workflow_dispatch;
  assert.ok(dispatch == null || (typeof dispatch === 'object' && Object.keys(dispatch).length === 0), '수동 실행은 입력 없음');
});

test('권한은 contents: read, pages: write, id-token: write 세 개뿐이고 job에서 바꾸지 않는다', () => {
  assert.deepEqual(workflow.permissions, { contents: 'read', pages: 'write', 'id-token': 'write' });
  for (const [name, j] of Object.entries(jobs())) assert.equal(j.permissions, undefined, `${name}.permissions`);
});

test('동시 실행은 pages 그룹 하나, 진행 중인 배포를 취소하지 않는다', () => {
  assert.deepEqual(workflow.concurrency, { group: 'pages', 'cancel-in-progress': false });
});

test('워크플로 환경은 Astro 사용 통계 끄기 하나다', () => {
  assert.deepEqual(workflow.env, { ASTRO_TELEMETRY_DISABLED: '1' });
});

/* ───────── build job ───────── */

test('job은 build와 deploy 두 개이고 둘 다 ubuntu-latest에서 돈다', () => {
  assert.deepEqual(Object.keys(jobs()).sort(), ['build', 'deploy']);
  assert.equal(job('build')['runs-on'], 'ubuntu-latest');
  assert.equal(job('deploy')['runs-on'], 'ubuntu-latest');
});

test('build job: 설치 → lint → typecheck → test → check:results → configure-pages → build → upload 순서다', () => {
  assert.deepEqual(steps('build').map(stepKey), BUILD_STEPS);
});

test('Node 24와 npm 캐시를 쓴다', () => {
  const setup = stepOf('build', 'uses actions/setup-node@v7');
  assert.deepEqual(Object.keys(setup.with ?? {}).sort(), ['cache', 'node-version']);
  assert.equal(String(setup.with?.['node-version']), '24');
  assert.equal(setup.with?.cache, 'npm');
});

test('사이트 빌드의 SITE_URL·SITE_BASE는 configure-pages 출력(origin, base_path)에서 온다', () => {
  const pages = stepOf('build', 'uses actions/configure-pages@v6');
  assert.ok(pages.id, 'configure-pages에 id가 있어야 출력을 쓸 수 있다');
  const build = stepOf('build', 'run npm run build');
  assert.deepEqual(build.env, {
    SITE_URL: `\${{ steps.${pages.id}.outputs.origin }}`,
    SITE_BASE: `\${{ steps.${pages.id}.outputs.base_path }}`,
  });
});

test('upload-pages-artifact는 site/dist를 올린다', () => {
  assert.deepEqual(stepOf('build', 'uses actions/upload-pages-artifact@v5').with, { path: 'site/dist' });
});

/* ───────── deploy job ───────── */

test('deploy job: build가 끝난 뒤 github-pages 환경으로 deploy-pages를 돌리고, 주소는 deploy-pages 출력이다', () => {
  const deploy = job('deploy');
  assert.deepEqual([deploy.needs].flat(), ['build']);
  assert.deepEqual(steps('deploy').map(stepKey), DEPLOY_STEPS);
  const step = stepOf('deploy', 'uses actions/deploy-pages@v5');
  assert.ok(step.id, 'deploy-pages에 id가 있어야 page_url을 쓸 수 있다');
  assert.deepEqual(deploy.environment, { name: 'github-pages', url: `\${{ steps.${step.id}.outputs.page_url }}` });
});

/* ───────── 금지 사항 ───────── */

test('액션은 정한 다섯 개(공식 actions/*)의 메이저 태그만 쓴다', () => {
  const uses = Object.keys(jobs()).flatMap((name) => steps(name).flatMap((s) => (s.uses === undefined ? [] : [s.uses])));
  assert.deepEqual(uses.sort(), [
    'actions/checkout@v7',
    'actions/configure-pages@v6',
    'actions/deploy-pages@v5',
    'actions/setup-node@v7',
    'actions/upload-pages-artifact@v5',
  ]);
  // job 단위 재사용 워크플로(jobs.<id>.uses)도 없다
  for (const [name, j] of Object.entries(jobs())) assert.equal(j.uses, undefined, `${name}.uses`);
});

test('검사 단계를 건너뛰게 하는 continue-on-error·if 조건이 없다', () => {
  assert.deepEqual(findKeys(workflow, 'continue-on-error'), []);
  assert.deepEqual(findKeys(workflow, 'if'), []);
});

test('비밀값(secrets.*)·API 키를 쓰지 않는다', () => {
  assert.ok(!source.includes('secrets.'), 'secrets. 가 있다');
  assert.doesNotMatch(source, /API_KEY|ANTHROPIC|OPENAI|GEMINI|GITHUB_TOKEN/i);
});

test('모델을 부르거나 results를 바꾸는 명령(gen·smoke·validate·judge, claude·codex)이 없다', () => {
  assert.doesNotMatch(source, /\b(gen|generate|smoke|validate|judge|claude|codex)\b/i);
  const runs = Object.keys(jobs()).flatMap((name) => steps(name).flatMap((s) => (s.run === undefined ? [] : [String(s.run)])));
  for (const run of runs) {
    assert.doesNotMatch(run, /\n/, `run은 한 줄 명령: ${run}`);
    assert.doesNotMatch(run, /\bnpm run (gen|smoke|validate|judge)\b|\b(claude|codex)\b|results\//, run);
  }
});
