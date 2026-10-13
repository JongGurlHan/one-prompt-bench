import assert from 'node:assert/strict';
import { readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { after, test } from 'node:test';
import { GenerationRecordSchema, runGeneration, type GenerationRecord, type ModelEntry } from '@opb/core';
import { RAW_EXIT_FILE, RAW_STDERR_FILE, RAW_STDOUT_FILE } from '../src/adapters/cli-recorder.js';
import { createCodexEntry, type AdapterRegistry } from '../src/adapters/registry.js';
import { runBatch } from '../src/generation/batch.js';
import { SMOKE_MAX_OUTPUT_TOKENS, SMOKE_PROMPT, runSmoke, type SmokeDeps } from '../src/generation/smoke.js';
import {
  FAKE_GEMINI_KEY,
  MODELS,
  SYSTEM,
  USER,
  fakeClock,
  fakeGit,
  harness,
  makeRepo,
  modelBySlug,
  readMeta,
  type FakeWorld,
} from './batch-fakes.js';
import type { FakeRun } from './claude-code-fakes.js';
import {
  CODEX_PARENT_ENV,
  FAKE_CODEX_COMMAND,
  FAKE_CODEX_VERSION,
  codexExited,
  configString,
  fakeCodex,
  loadLoginStatus,
  loadStdout,
  loginStatus,
} from './codex-fakes.js';

/* ────────────────────────────────────────────────────────────
 * gen·smoke가 openai 모델을 codex-cli 항목으로 끝까지 돈다.
 * 실제 레지스트리 항목(createCodexEntry)에 가짜 실행 함수·실행 명령·버전만 주입한다 — 실제 codex 없음.
 * 가짜 레포는 OS 임시 디렉토리. 레포의 results/·results-smoke/에 쓰지 않는다.
 * ──────────────────────────────────────────────────────────── */

const roots: string[] = [];
after(async () => {
  await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
});

/** 한도 초과 뒤 다음 모델로 넘어가는지 보려고 openai 모델을 하나 더 둔다 */
const GPT_B: ModelEntry = { ...modelBySlug('gpt-a'), slug: 'gpt-b', modelId: 'gpt-b-id', displayName: 'GPT B' };

async function repo(models: readonly ModelEntry[] = MODELS): Promise<string> {
  const root = await makeRepo(models);
  roots.push(root);
  return root;
}

async function codexWorld(opts: { login?: FakeRun; runs: FakeRun[] }) {
  const cli = fakeCodex({ login: opts.login ?? loginStatus(await loadLoginStatus('chatgpt')), runs: opts.runs });
  const entry = createCodexEntry({
    runCli: cli,
    resolveCommand: () => FAKE_CODEX_COMMAND,
    readVersion: () => FAKE_CODEX_VERSION,
    env: () => CODEX_PARENT_ENV,
  });
  const registry: AdapterRegistry = { 'codex-cli': entry };
  const world: FakeWorld = { registry, created: [], calls: [], configs: [] };
  return { cli, registry, world };
}

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );

const INVOCATION =
  'codex exec --model gpt-a-id --sandbox read-only --skip-git-repo-check --ephemeral ' +
  '--ignore-user-config --ignore-rules --json -o <tmp>/last-message.txt -C <tmp>/work ' +
  '-c model_reasoning_effort="high" -c model_instructions_file="<tmp>/instructions.md" ' +
  '-c include_environment_context=false -c include_apps_instructions=false ' +
  '-c include_collaboration_mode_instructions=false -c skills.include_instructions=false - (stdin: <user prompt>)';

/* ───────── gen ───────── */

test('gen: codex-cli 항목으로 openai 모델을 생성한다. maxOutputTokens null, runtime.generator에 tool·version·invocation', async () => {
  const root = await repo();
  let instructions: string | null = null;
  const { cli, world } = await codexWorld({
    runs: [
      codexExited(await loadStdout('ok'), {
        inspect: async (r) => {
          instructions = await readFile(configString(r.args, 'model_instructions_file'), 'utf8');
        },
      }),
    ],
  });
  const h = harness(root, { world });

  const code = await runBatch({ slugs: ['gpt-a'], all: false, force: false }, h.deps);

  assert.equal(code, 0, h.output());
  const meta = await readMeta(root, 'gpt-a');
  assert.equal(meta.outcome, 'ok');
  assert.equal(meta.params.maxOutputTokens, null, 'Codex는 상한을 지정할 수 없다 (ADR-007)');
  assert.equal(meta.runtime.generator.tool, 'codex-cli');
  assert.equal(meta.runtime.generator.version, FAKE_CODEX_VERSION);
  assert.equal(meta.runtime.generator.invocation, INVOCATION);
  assert.doesNotMatch(meta.runtime.generator.invocation, /MAX_OUTPUT_TOKENS/, '상한 환경 변수가 없다');
  assert.deepEqual(meta.usageTotal, { inputTokens: 5_200, outputTokens: 9_800, reasoningTokens: 4_100 });
  assert.deepEqual(h.validated, ['gpt-a'], 'ok면 검증을 이어서 한다');

  // preflight의 로그인 점검 1회 → 생성 1회. 프롬프트 파일 내용 그대로
  assert.equal(cli.login.requests.length, 1);
  assert.equal(cli.generation.requests.length, 1);
  const sent = cli.generation.requests[0]!;
  assert.equal(sent.stdin, USER);
  assert.equal(instructions, SYSTEM, 'system은 instructions.md에 내용 그대로');
  assert.equal(sent.args[sent.args.indexOf('--model') + 1], 'gpt-a-id');
  assert.equal(sent.env.OPENAI_API_KEY, undefined);
  assert.match(h.output(), /\[통과\] Codex 로그인/);
});

test('gen: ChatGPT 로그인이 아니면(API 키) preflight에서 멈추고 생성하지 않는다. 가린 키는 출력하지 않는다', async () => {
  const root = await repo();
  const { cli, world } = await codexWorld({
    login: loginStatus(await loadLoginStatus('api-key')),
    runs: [codexExited(await loadStdout('ok'))],
  });
  const h = harness(root, { world });

  assert.equal(await runBatch({ slugs: ['gpt-a'], all: false, force: false }, h.deps), 1);
  assert.equal(cli.generation.requests.length, 0);
  assert.equal(await exists(path.join(root, 'results')), false);
  assert.match(h.output(), /\[실패\] Codex 로그인/);
  assert.doesNotMatch(h.output(), /sk-fake0|FAKE9|\*\*\*/);
});

test('gen: 한도 초과는 재시도 없이 기록하고 다음 모델로 넘어간다 (exit 0)', async () => {
  const root = await repo([...MODELS, GPT_B]);
  const usageLimit = codexExited(await loadStdout('usage-limit'), { exitCode: 1 });
  const { cli, world } = await codexWorld({ runs: [usageLimit, codexExited(await loadStdout('ok'))] });
  const h = harness(root, { world });

  assert.equal(await runBatch({ slugs: ['gpt-a', 'gpt-b'], all: false, force: false }, h.deps), 0, h.output());
  assert.equal(cli.generation.requests.length, 2, 'gpt-a 1회(재시도 없음) + gpt-b 1회');
  assert.equal(cli.login.requests.length, 1, '로그인 점검은 preflight에서 한 번');
  const a = await readMeta(root, 'gpt-a');
  assert.equal(a.outcome, 'api_failed');
  assert.equal(a.attempts.length, 1);
  assert.equal(a.attempts[0]?.result.type === 'error' && a.attempts[0].result.kind, 'usage_limit');
  assert.equal(a.params.maxOutputTokens, null);
  assert.equal((await readMeta(root, 'gpt-b')).outcome, 'ok');
  assert.deepEqual(h.validated, ['gpt-b']);
  assert.match(h.output(), /한도 초과로 기록했습니다/);
});

/* ───────── smoke ───────── */

const AT = new Date(2026, 9, 13, 9, 5, 7);
const DIR = 'results-smoke/gpt-a-20261013-090507';

function smokeDeps(root: string, registry: AdapterRegistry) {
  const logs: string[] = [];
  const errors: string[] = [];
  const deps: SmokeDeps = {
    config: { repoRoot: root, dotenv: { GEMINI_API_KEY: FAKE_GEMINI_KEY } },
    env: {},
    adapters: registry,
    git: fakeGit(),
    run: (adapter, input, policy) => runGeneration(adapter, input, policy, fakeClock()),
    out: { log: (line) => void logs.push(line), error: (line) => void errors.push(line) },
    now: () => AT,
    nodeVersion: 'v24.14.0',
  };
  return { deps, output: () => [...logs, ...errors].join('\n') };
}

async function smokeMeta(root: string): Promise<GenerationRecord> {
  return GenerationRecordSchema.parse(JSON.parse(await readFile(path.join(root, DIR, 'meta.json'), 'utf8')));
}

test('smoke: 상한 8000을 넘겨도 Codex 요청은 상한 없음(null). raw-stdout.txt(JSONL 그대로)·raw-stderr.txt·raw-exit.json을 남긴다', async () => {
  const root = await repo();
  const stdout = await loadStdout('ok');
  const { cli, registry } = await codexWorld({ runs: [codexExited(stdout, { stderr: 'note\n' })] });
  const s = smokeDeps(root, registry);

  assert.equal(await runSmoke({ slug: 'gpt-a' }, s.deps), 0, s.output());

  assert.deepEqual(
    (await readdir(path.join(root, DIR))).sort(),
    ['index.html', 'meta.json', RAW_EXIT_FILE, RAW_STDERR_FILE, RAW_STDOUT_FILE, 'response.txt'].sort(),
  );
  assert.equal(await readFile(path.join(root, DIR, RAW_STDOUT_FILE), 'utf8'), stdout, 'fixture(stdout-*.jsonl)로 그대로 옮길 수 있다');
  assert.equal(await readFile(path.join(root, DIR, RAW_STDERR_FILE), 'utf8'), 'note\n');
  assert.deepEqual(JSON.parse(await readFile(path.join(root, DIR, RAW_EXIT_FILE), 'utf8')), { exitCode: 0, signal: null });

  const meta = await smokeMeta(root);
  assert.equal(meta.outcome, 'ok');
  assert.ok(SMOKE_MAX_OUTPUT_TOKENS > 0);
  assert.equal(meta.params.maxOutputTokens, null, `smoke 상한 ${SMOKE_MAX_OUTPUT_TOKENS}이 Codex에는 null로`);
  assert.equal(meta.runtime.generator.tool, 'codex-cli');
  assert.equal(meta.runtime.generator.version, FAKE_CODEX_VERSION);
  assert.match(meta.runtime.generator.invocation, /^codex exec --model gpt-a-id /);
  assert.doesNotMatch(meta.runtime.generator.invocation, /MAX_OUTPUT_TOKENS/);

  const sent = cli.generation.requests[0]!;
  assert.equal(sent.stdin, SMOKE_PROMPT.user);
  assert.equal(sent.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS, undefined, '부모 환경의 상한 변수도 넘기지 않는다');
  assert.equal(cli.login.requests.length, 1);
  assert.match(s.output(), /출력 상한 없음\(도구 기본값\)/);
  assert.match(s.output(), /stopReason other \(turn\.completed\)/);
  assert.match(s.output(), /사용량: 입력 5,200 · 출력 9,800 · 추론 4,100/);
});

test('smoke: 한도 초과면 exit 1, 원본 출력과 api_failed meta.json이 남고 stderr의 .env 값은 가린다', async () => {
  const root = await repo();
  const stdout = await loadStdout('usage-limit');
  const { registry } = await codexWorld({
    runs: [codexExited(stdout, { exitCode: 1, stderr: `debug ${FAKE_GEMINI_KEY}\n` })],
  });
  const s = smokeDeps(root, registry);

  assert.equal(await runSmoke({ slug: 'gpt-a' }, s.deps), 1, s.output());
  const meta = await smokeMeta(root);
  assert.equal(meta.outcome, 'api_failed');
  assert.equal(meta.attempts[0]?.result.type === 'error' && meta.attempts[0].result.kind, 'usage_limit');
  assert.equal(await readFile(path.join(root, DIR, RAW_STDOUT_FILE), 'utf8'), stdout);
  assert.equal(await readFile(path.join(root, DIR, RAW_STDERR_FILE), 'utf8'), 'debug ***\n');
  assert.deepEqual(JSON.parse(await readFile(path.join(root, DIR, RAW_EXIT_FILE), 'utf8')), { exitCode: 1, signal: null });
  assert.match(s.output(), /api_failed \(usage_limit\)/);
});

test('smoke: 로그인되어 있지 않으면 preflight에서 멈추고 생성·폴더 생성을 하지 않는다', async () => {
  const root = await repo();
  const { cli, registry } = await codexWorld({
    login: loginStatus(await loadLoginStatus('not-logged-in'), 1),
    runs: [codexExited(await loadStdout('ok'))],
  });
  const s = smokeDeps(root, registry);

  assert.equal(await runSmoke({ slug: 'gpt-a' }, s.deps), 1);
  assert.equal(cli.generation.requests.length, 0);
  assert.equal(await exists(path.join(root, 'results-smoke')), false);
  assert.match(s.output(), /\[실패\] Codex 로그인/);
});
