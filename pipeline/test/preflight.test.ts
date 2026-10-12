import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GeneratorTool } from '@opb/core';
import type { AdapterRegistry } from '../src/adapters/registry.js';
import {
  GIT_CLEAN_PATHS,
  evaluatePreflight,
  formatPreflight,
  runPreflight,
  type PreflightCheck,
  type PreflightFacts,
} from '../src/generation/preflight.js';
import { FAKE_GEMINI_KEY, MODELS, fakeGit, fakeWorld, modelBySlug } from './batch-fakes.js';

/* ───────── 판정 (순수 함수) ───────── */

const ALL_TOOLS: ReadonlySet<GeneratorTool> = new Set(['gemini-api', 'claude-code', 'codex-cli']);

function facts(overrides: Partial<PreflightFacts> = {}): PreflightFacts {
  return {
    models: MODELS,
    env: {},
    registeredTools: ALL_TOOLS,
    geminiApiKey: FAKE_GEMINI_KEY,
    git: { status: '' },
    ...overrides,
  };
}

const failed = (checks: PreflightCheck[]) => checks.filter((c) => !c.ok);

test('모두 갖추면 전부 통과', () => {
  const checks = evaluatePreflight(facts());
  assert.deepEqual(failed(checks), []);
  assert.ok(checks.length >= 4);
});

test('ANTHROPIC_API_KEY·OPENAI_API_KEY가 환경에 있으면 실패 — 변수 이름만 쓰고 값은 쓰지 않는다', () => {
  const env = { ANTHROPIC_API_KEY: 'sk-ant-secret-value-1', OPENAI_API_KEY: 'sk-openai-secret-value-2', PATH: '/bin' };
  const checks = evaluatePreflight(facts({ env }));
  const text = failed(checks)
    .map((c) => `${c.name} ${c.detail}`)
    .join('\n');
  assert.match(text, /ANTHROPIC_API_KEY/);
  assert.match(text, /OPENAI_API_KEY/);
  assert.doesNotMatch(text, /secret-value/);
  assert.doesNotMatch(formatPreflight(checks), /secret-value/);
});

test('빈 문자열이어도 변수가 있으면 실패 (도구가 어떻게 해석할지 모른다)', () => {
  assert.equal(failed(evaluatePreflight(facts({ env: { OPENAI_API_KEY: '' } }))).length, 1);
});

test('어댑터가 없는 생성 도구가 섞이면 실패: "아직 지원하지 않는 생성 도구: <도구> (<slug…>)"', () => {
  const checks = evaluatePreflight(facts({ registeredTools: new Set(['gemini-api']) }));
  const details = failed(checks).map((c) => c.detail);
  assert.ok(details.includes('아직 지원하지 않는 생성 도구: claude-code (claude-a, claude-b)'), details.join('\n'));
  assert.ok(details.includes('아직 지원하지 않는 생성 도구: codex-cli (gpt-a)'), details.join('\n'));
});

test('대상 모델의 도구만 본다: gemini 모델만 고르면 다른 도구가 없어도 통과', () => {
  const checks = evaluatePreflight(
    facts({ models: [modelBySlug('gemini-a')], registeredTools: new Set(['gemini-api']) }),
  );
  assert.deepEqual(failed(checks), []);
});

test('Google 대상이 있는데 GEMINI_API_KEY가 없거나 비어 있으면 실패', () => {
  for (const geminiApiKey of [undefined, '', '   ']) {
    const f = failed(evaluatePreflight(facts({ geminiApiKey })));
    assert.equal(f.length, 1, String(geminiApiKey));
    assert.match(f[0]!.detail, /GEMINI_API_KEY/);
  }
});

test('Google 대상이 없으면 GEMINI_API_KEY를 보지 않는다', () => {
  const checks = evaluatePreflight(facts({ models: [modelBySlug('claude-a')], geminiApiKey: undefined }));
  assert.deepEqual(failed(checks), []);
  assert.ok(!checks.some((c) => /GEMINI/.test(c.name)));
});

test('git 변경이 있으면 실패하고 목록을 보여 준다', () => {
  const status = ' M pipeline/src/main.ts\n?? prompts/season-tree-v2.md\n';
  const f = failed(evaluatePreflight(facts({ git: { status } })));
  assert.equal(f.length, 1);
  assert.match(f[0]!.detail, / M pipeline\/src\/main\.ts/);
  assert.match(f[0]!.detail, /\?\? prompts\/season-tree-v2\.md/);
});

test('git을 실행하지 못하면 실패', () => {
  const f = failed(evaluatePreflight(facts({ git: { error: 'not a git repository' } })));
  assert.equal(f.length, 1);
  assert.match(f[0]!.detail, /not a git repository/);
});

test('git 검사를 끄면(null) git 항목이 없다', () => {
  const checks = evaluatePreflight(facts({ git: null }));
  assert.ok(!checks.some((c) => /git/i.test(c.name)));
});

/* ───────── 수집 + 판정 (git·환경·레지스트리 주입) ───────── */

test('runPreflight: git status를 packages·pipeline·prompts·models.json으로 부르고, 어댑터는 만들지 않는다', async () => {
  const world = fakeWorld();
  const git = fakeGit({ status: ' M models.json\n' });
  const checks = await runPreflight(MODELS, {
    env: {},
    config: { repoRoot: '/r', dotenv: { GEMINI_API_KEY: FAKE_GEMINI_KEY } },
    adapters: world.registry,
    git,
  });
  assert.deepEqual(git.statusCalls, [GIT_CLEAN_PATHS]);
  assert.deepEqual([...GIT_CLEAN_PATHS], ['packages', 'pipeline', 'prompts', 'models.json']);
  assert.equal(failed(checks).length, 1);
  assert.deepEqual(world.created, []);
  assert.deepEqual(world.calls, []);
});

test('runPreflight: checkGit false면 git을 부르지 않는다 (smoke용)', async () => {
  const git = fakeGit({ status: ' M pipeline/src/main.ts\n' });
  const checks = await runPreflight(
    MODELS,
    { env: {}, config: { repoRoot: '/r', dotenv: { GEMINI_API_KEY: FAKE_GEMINI_KEY } }, adapters: fakeWorld().registry, git },
    { checkGit: false },
  );
  assert.deepEqual(git.statusCalls, []);
  assert.deepEqual(failed(checks), []);
});

test('runPreflight: git status가 throw하면 실패 항목으로 돌려준다', async () => {
  const checks = await runPreflight(MODELS, {
    env: {},
    config: { repoRoot: '/r', dotenv: { GEMINI_API_KEY: FAKE_GEMINI_KEY } },
    adapters: fakeWorld().registry,
    git: fakeGit({ statusError: new Error('fatal: not a git repository') }),
  });
  assert.match(failed(checks)[0]?.detail ?? '', /not a git repository/);
});

test('runPreflight: 대상 모델의 등록된 도구만 도구별 preflight()를 부르고 결과를 붙인다, throw는 실패로', async () => {
  const ran: string[] = [];
  const registry: AdapterRegistry = {
    'gemini-api': {
      preflight: async () => {
        ran.push('gemini-api');
        return [{ ok: true, name: 'gemini 점검', detail: '좋음' }];
      },
      create: () => {
        throw new Error('만들면 안 된다');
      },
    },
    'claude-code': {
      preflight: async () => {
        ran.push('claude-code');
        throw new Error('claude auth status 실행 실패');
      },
      create: () => {
        throw new Error('만들면 안 된다');
      },
    },
    'codex-cli': {
      preflight: async () => {
        ran.push('codex-cli');
        return [];
      },
      create: () => {
        throw new Error('만들면 안 된다');
      },
    },
  };
  const checks = await runPreflight([modelBySlug('gemini-a'), modelBySlug('claude-a')], {
    env: {},
    config: { repoRoot: '/r', dotenv: { GEMINI_API_KEY: FAKE_GEMINI_KEY } },
    adapters: registry,
    git: fakeGit(),
  });
  assert.deepEqual(ran.sort(), ['claude-code', 'gemini-api']);
  assert.ok(checks.some((c) => c.ok && c.name === 'gemini 점검'));
  assert.ok(checks.some((c) => !c.ok && /claude-code/.test(c.name) && /claude auth status 실행 실패/.test(c.detail)));
});

/* ───────── 출력 ───────── */

test('formatPreflight: 항목마다 [통과]/[실패], 여러 줄 사유는 들여쓴다', () => {
  const text = formatPreflight([
    { ok: true, name: 'API 키 환경변수', detail: '없음' },
    { ok: false, name: 'git 작업 트리', detail: '커밋 안 된 변경:\n M a.ts\n?? b.ts' },
  ]);
  assert.equal(
    text,
    [
      'preflight',
      '  [통과] API 키 환경변수: 없음',
      '  [실패] git 작업 트리: 커밋 안 된 변경:',
      '           M a.ts',
      '          ?? b.ts',
    ].join('\n'),
  );
});
