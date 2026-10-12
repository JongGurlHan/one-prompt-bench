import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { DEFAULT_MAX_OUTPUT_TOKENS } from '@opb/core';
import { runBatch, type BatchOptions } from '../src/generation/batch.js';
import {
  FAKE_COMMIT,
  FAKE_GEMINI_KEY,
  HTML,
  OK,
  fakeGit,
  fakeWorld,
  harness,
  makeRepo,
  readMeta,
  seedResult,
  snapshot,
} from './batch-fakes.js';

/* ────────────────────────────────────────────────────────────
 * runBatch 통합: OS 임시 디렉토리의 가짜 레포 + 가짜 어댑터·git·환경·확인.
 * 실제 모델·git·네트워크를 부르지 않는다.
 * ──────────────────────────────────────────────────────────── */

const gen = (slugs: string[], extra: Partial<BatchOptions> = {}): BatchOptions => ({
  slugs,
  all: false,
  force: false,
  ...extra,
});

const dirOf = (root: string, slug: string) => path.join(root, 'results', slug);

/* ───────── 정상 생성 ───────── */

test('생성: Runner에 모델·프롬프트·상한·출력 폴더·runtime을 넘기고 results/<slug>/에 기록한다', async () => {
  const root = await makeRepo();
  const h = harness(root);

  const code = await runBatch(gen(['gemini-a']), h.deps);

  assert.equal(code, 0, h.output());
  const meta = await readMeta(root, 'gemini-a');
  assert.equal(meta.outcome, 'ok');
  assert.equal(meta.modelId, 'gemini-a-id');
  assert.equal(meta.prompt.id, 'season-tree');
  assert.equal(meta.params.maxOutputTokens, DEFAULT_MAX_OUTPUT_TOKENS);
  assert.equal(meta.runtime.gitCommit, FAKE_COMMIT);
  assert.equal(meta.runtime.nodeVersion, 'v24.14.0');
  assert.equal(meta.runtime.generator.tool, 'gemini-api');
  assert.equal(await readFile(path.join(dirOf(root, 'gemini-a'), 'index.html'), 'utf8'), HTML);
  assert.deepEqual(h.world.created, ['gemini-api']);
  assert.equal(h.world.configs[0]?.dotenv.GEMINI_API_KEY, FAKE_GEMINI_KEY, '어댑터는 설정(.env)에서 키를 받는다');
  assert.equal(h.git.headCalls, 1);
  assert.match(h.output(), /요약/);
});

test('상한을 지정할 수 없는 도구(Codex)는 maxOutputTokens null로 기록', async () => {
  const root = await makeRepo();
  const h = harness(root);
  assert.equal(await runBatch(gen(['gpt-a']), h.deps), 0, h.output());
  assert.equal((await readMeta(root, 'gpt-a')).params.maxOutputTokens, null);
});

test('여러 모델은 준 순서대로 하나씩(순차) 실행한다', async () => {
  const root = await makeRepo();
  const h = harness(root);
  assert.equal(await runBatch(gen(['gpt-a', 'gemini-a', 'claude-a']), h.deps), 0, h.output());
  assert.deepEqual(h.world.calls, ['gpt-a-id', 'gemini-a-id', 'claude-a-id']);
});

/* ───────── 폴더 상태별 처리 ───────── */

test('건너뛰기: meta.json이 있고 outcome이 api_failed가 아니면 어댑터를 만들지도 않고 그대로 둔다', async () => {
  const root = await makeRepo();
  await seedResult(root, 'gemini-a', [{ respond: '설명만 있고 HTML 없음' }]); // no_html
  const before = await snapshot(dirOf(root, 'gemini-a'));
  const h = harness(root);

  const code = await runBatch(gen(['gemini-a']), h.deps);

  assert.equal(code, 0, h.output());
  assert.deepEqual(h.world.created, []);
  assert.deepEqual(h.world.calls, []);
  assert.deepEqual(await snapshot(dirOf(root, 'gemini-a')), before);
  assert.match(h.output(), /gemini-a\s+건너뜀\s+no_html/);
});

test('api_failed 폴더는 비우고 다시 생성한다', async () => {
  const root = await makeRepo();
  const old = await seedResult(root, 'gemini-a', [{ fail: 'auth', httpStatus: 401 }]);
  assert.equal(old.outcome, 'api_failed');
  const h = harness(root);

  assert.equal(await runBatch(gen(['gemini-a']), h.deps), 0, h.output());

  assert.deepEqual(h.world.calls, ['gemini-a-id']);
  const meta = await readMeta(root, 'gemini-a');
  assert.equal(meta.outcome, 'ok');
  assert.equal(meta.attempts.length, 1, '새 기록이다 (이전 시도가 섞이지 않음)');
});

test('중단된 폴더(meta.json 없이 파일만)는 비우고 다시 생성한다', async () => {
  const root = await makeRepo();
  await mkdir(dirOf(root, 'gemini-a'), { recursive: true });
  await writeFile(path.join(dirOf(root, 'gemini-a'), 'response.txt'), '중간에 끊긴 응답', 'utf8');
  await writeFile(path.join(dirOf(root, 'gemini-a'), 'stray.tmp'), 'x', 'utf8');
  const h = harness(root);

  assert.equal(await runBatch(gen(['gemini-a']), h.deps), 0, h.output());

  const files = Object.keys((await snapshot(dirOf(root, 'gemini-a')))!);
  assert.deepEqual(files, ['index.html', 'meta.json', 'response.txt']);
  assert.equal((await readMeta(root, 'gemini-a')).outcome, 'ok');
});

test('스키마가 깨진 meta.json은 건드리지 않고 실패로 보고, 다음 모델은 계속한다 (exit 1)', async () => {
  const root = await makeRepo();
  await mkdir(dirOf(root, 'gemini-a'), { recursive: true });
  await writeFile(path.join(dirOf(root, 'gemini-a'), 'meta.json'), '{"schemaVersion": 1, "outcome": "ok"}\n', 'utf8');
  await writeFile(path.join(dirOf(root, 'gemini-a'), 'judgment.json'), '{}\n', 'utf8');
  const before = await snapshot(dirOf(root, 'gemini-a'));
  const h = harness(root);

  const code = await runBatch(gen(['gemini-a', 'claude-a']), h.deps);

  assert.equal(code, 1);
  assert.deepEqual(await snapshot(dirOf(root, 'gemini-a')), before);
  assert.deepEqual(h.world.calls, ['claude-a-id']);
  assert.equal((await readMeta(root, 'claude-a')).outcome, 'ok');
  assert.match(h.output(), /gemini-a\s+실패/);
  assert.match(h.output(), /확인할 것:[\s\S]*gemini-a: .*meta\.json/);
});

/* ───────── --force ───────── */

test('--force 확인을 거절하면 아무것도 바꾸지 않고 종료한다', async () => {
  const root = await makeRepo();
  await seedResult(root, 'gemini-a');
  await writeFile(path.join(dirOf(root, 'gemini-a'), 'judgment.json'), '{"note":"사람이 쓴 판정"}\n', 'utf8');
  const before = await snapshot(dirOf(root, 'gemini-a'));
  const h = harness(root, { confirm: false });

  const code = await runBatch(gen(['gemini-a', 'claude-a'], { force: true }), h.deps);

  assert.equal(code, 1);
  assert.equal(h.confirms.length, 1);
  assert.match(h.confirms[0]!, /results\/gemini-a\/ \(판정 있음\)/);
  assert.match(h.confirms[0]!, /판정\(judgment\.json\)도 함께 지워/);
  assert.doesNotMatch(h.confirms[0]!, /claude-a/, '파일이 없는 폴더는 목록에 없다');
  assert.deepEqual(await snapshot(dirOf(root, 'gemini-a')), before);
  assert.equal(await snapshot(dirOf(root, 'claude-a')), null, '거절하면 다른 모델도 생성하지 않는다');
  assert.deepEqual(h.world.created, []);
  assert.deepEqual(h.world.calls, []);
});

test('--force 승인: judgment.json까지 지우고 다시 생성한다', async () => {
  const root = await makeRepo();
  await seedResult(root, 'gemini-a', [{ respond: 'HTML 없음' }]);
  await writeFile(path.join(dirOf(root, 'gemini-a'), 'judgment.json'), '{"note":"예전 판정"}\n', 'utf8');
  const h = harness(root, { confirm: true });

  assert.equal(await runBatch(gen(['gemini-a'], { force: true }), h.deps), 0, h.output());

  assert.equal(h.confirms.length, 1);
  assert.deepEqual(Object.keys((await snapshot(dirOf(root, 'gemini-a')))!), [
    'index.html',
    'meta.json',
    'response.txt',
  ]);
  assert.equal((await readMeta(root, 'gemini-a')).outcome, 'ok');
});

test('--force인데 지울 파일이 없으면 묻지 않고 생성한다', async () => {
  const root = await makeRepo();
  const h = harness(root, { confirm: false });
  assert.equal(await runBatch(gen(['gemini-a'], { force: true }), h.deps), 0, h.output());
  assert.equal(h.confirms.length, 0);
  assert.equal((await readMeta(root, 'gemini-a')).outcome, 'ok');
});

/* ───────── 대상 선택 실패 ───────── */

test('모르는 slug가 있으면 어댑터를 만들거나 호출하지 않고 실패한다 (preflight·git도 안 함)', async () => {
  const root = await makeRepo();
  const h = harness(root);

  const code = await runBatch(gen(['gemini-a', 'no-such-model']), h.deps);

  assert.equal(code, 1);
  assert.match(h.output(), /no-such-model/);
  assert.deepEqual(h.world.created, []);
  assert.deepEqual(h.world.calls, []);
  assert.deepEqual(h.git.statusCalls, []);
  assert.equal(await snapshot(path.join(root, 'results')), null);
});

/* ───────── preflight 실패 4종: 어댑터 미생성·미호출, 아무것도 쓰지 않음 ───────── */

async function assertPreflightStops(
  setup: (root: string) => ReturnType<typeof harness>,
  slugs: string[],
  expected: RegExp,
): Promise<string> {
  const root = await makeRepo();
  const h = setup(root);
  const code = await runBatch(gen(slugs), h.deps);
  assert.equal(code, 1);
  assert.match(h.output(), expected);
  assert.match(h.output(), /\[실패\]/);
  assert.deepEqual(h.world.created, []);
  assert.deepEqual(h.world.calls, []);
  assert.equal(h.git.headCalls, 0);
  assert.equal(await snapshot(path.join(root, 'results')), null);
  return h.output();
}

test('preflight 실패: ANTHROPIC_API_KEY가 환경에 있으면 멈추고 값은 출력하지 않는다', async () => {
  const out = await assertPreflightStops(
    (root) => harness(root, { env: { ANTHROPIC_API_KEY: 'sk-ant-real-looking-secret' } }),
    ['gemini-a'],
    /ANTHROPIC_API_KEY/,
  );
  assert.doesNotMatch(out, /sk-ant-real-looking-secret/);
});

test('preflight 실패: 어댑터가 없는 생성 도구가 섞이면 멈춘다 (phase 1의 --all)', async () => {
  const root = await makeRepo();
  const h = harness(root, { world: fakeWorld({}, ['gemini-api']) });
  const code = await runBatch(gen([], { all: true }), h.deps);
  assert.equal(code, 1);
  assert.match(h.output(), /아직 지원하지 않는 생성 도구: claude-code \(claude-b, claude-a\)/);
  assert.match(h.output(), /아직 지원하지 않는 생성 도구: codex-cli \(gpt-a\)/);
  assert.deepEqual(h.world.created, [], '등록된 gemini도 만들지 않는다');
  assert.deepEqual(h.world.calls, []);
});

test('preflight 실패: Google 대상인데 GEMINI_API_KEY가 없으면 멈춘다', async () => {
  await assertPreflightStops((root) => harness(root, { dotenv: {} }), ['gemini-a', 'claude-a'], /GEMINI_API_KEY/);
});

test('preflight 실패: packages·pipeline·prompts·models.json에 커밋 안 된 변경이 있으면 멈추고 목록을 보여 준다', async () => {
  await assertPreflightStops(
    (root) => harness(root, { git: fakeGit({ status: ' M pipeline/src/generation/batch.ts\n' }) }),
    ['claude-a'],
    /pipeline\/src\/generation\/batch\.ts/,
  );
});

/* ───────── 실행 중 실패·한도 ───────── */

test('usage_limit으로 끝난 모델은 기록된 채로 두고 다음 모델을 계속한다 (exit 0)', async () => {
  const root = await makeRepo();
  const world = fakeWorld({ 'claude-a': [{ fail: 'usage_limit', message: "You've hit your limit" }], 'gemini-a': [OK] });
  const h = harness(root, { world });

  const code = await runBatch(gen(['claude-a', 'gemini-a']), h.deps);

  assert.equal(code, 0, h.output());
  const limited = await readMeta(root, 'claude-a');
  assert.equal(limited.outcome, 'api_failed');
  assert.equal(limited.attempts.length, 1, 'usage_limit은 재시도하지 않는다');
  assert.equal((await readMeta(root, 'gemini-a')).outcome, 'ok');
  assert.deepEqual(h.world.calls, ['claude-a-id', 'gemini-a-id']);
  assert.match(h.output(), /api_failed \(usage_limit\)/);
});

test('한 모델에서 예외가 나도 다음 모델을 계속하고 exit 1, 에러 메시지의 키 값은 가린다', async () => {
  const root = await makeRepo();
  const world = fakeWorld();
  world.registry = {
    ...world.registry,
    'gemini-api': {
      create: () => {
        throw new Error(`client init failed for key ${FAKE_GEMINI_KEY}`);
      },
    },
  };
  const h = harness(root, { world });

  const code = await runBatch(gen(['gemini-a', 'claude-a']), h.deps);

  assert.equal(code, 1);
  assert.equal((await readMeta(root, 'claude-a')).outcome, 'ok');
  assert.match(h.output(), /gemini-a\s+실패/);
  assert.match(h.output(), /client init failed/);
  assert.doesNotMatch(h.output(), new RegExp(FAKE_GEMINI_KEY));
});

/* ───────── 검증기 ───────── */

test('outcome이 ok인 모델만 검증기를 부른다', async () => {
  const root = await makeRepo();
  const world = fakeWorld({ 'claude-a': [{ respond: 'HTML 없음' }] });
  const h = harness(root, { world });

  assert.equal(await runBatch(gen(['gemini-a', 'claude-a', 'gpt-a']), h.deps), 0, h.output());

  assert.deepEqual(h.validated, ['gemini-a', 'gpt-a']);
});

test('검증기가 throw해도 다음 모델을 계속하고, 문제로 보고한다 (exit 1)', async () => {
  const root = await makeRepo();
  const h = harness(root, {
    validate: async (slug) => {
      if (slug === 'gemini-a') throw new Error('chromium not installed');
    },
  });

  const code = await runBatch(gen(['gemini-a', 'claude-a']), h.deps);

  assert.equal(code, 1);
  assert.deepEqual(h.validated, ['gemini-a', 'claude-a']);
  const meta = await readMeta(root, 'gemini-a');
  assert.equal(meta.outcome, 'ok');
  assert.equal(meta.validation, null);
  assert.match(h.output(), /gemini-a: .*검증.*chromium not installed/);
  assert.match(h.output(), /npm run validate -- gemini-a/);
});

/* ───────── 준비 단계 실패 ───────── */

test('git rev-parse HEAD가 커밋 해시가 아니면 아무것도 호출하지 않고 실패', async () => {
  const root = await makeRepo();
  const h = harness(root, { git: fakeGit({ head: 'HEAD' }) });
  assert.equal(await runBatch(gen(['gemini-a']), h.deps), 1);
  assert.deepEqual(h.world.created, []);
  assert.match(h.output(), /커밋/);
});

test('프롬프트 파일을 읽을 수 없으면 폴더를 비우기 전에 실패한다', async () => {
  const root = await makeRepo();
  await seedResult(root, 'gemini-a', [{ fail: 'auth' }]);
  const before = await snapshot(dirOf(root, 'gemini-a'));
  await writeFile(path.join(root, 'prompts', 'season-tree-v1.md'), 'CRLF\r\n', 'utf8');
  const h = harness(root);

  assert.equal(await runBatch(gen(['gemini-a']), h.deps), 1);
  assert.deepEqual(await snapshot(dirOf(root, 'gemini-a')), before);
  assert.deepEqual(h.world.created, []);
  assert.match(h.output(), /season-tree-v1\.md/);
});

test('models.json이 스키마를 통과하지 못하면 실패', async () => {
  const root = await makeRepo();
  await writeFile(path.join(root, 'models.json'), '[{"slug":"Bad Slug"}]', 'utf8');
  const h = harness(root);
  assert.equal(await runBatch(gen(['gemini-a']), h.deps), 1);
  assert.match(h.output(), /models\.json/);
  assert.deepEqual(h.world.created, []);
});
