import assert from 'node:assert/strict';
import { readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { after, test } from 'node:test';
import { GenerationRecordSchema, runGeneration, type GenerationRecord } from '@opb/core';
import { RAW_EXIT_FILE, RAW_STDERR_FILE, RAW_STDOUT_FILE } from '../src/adapters/cli-recorder.js';
import { createClaudeCodeEntry, type AdapterRegistry } from '../src/adapters/registry.js';
import { runBatch } from '../src/generation/batch.js';
import { SMOKE_MAX_OUTPUT_TOKENS, SMOKE_PROMPT, runSmoke, type SmokeDeps } from '../src/generation/smoke.js';
import { FAKE_GEMINI_KEY, SYSTEM, USER, fakeClock, fakeGit, harness, makeRepo, readMeta, type FakeWorld } from './batch-fakes.js';
import {
  FAKE_CLAUDE_BIN,
  FAKE_CLAUDE_VERSION,
  PARENT_ENV,
  exited,
  fakeClaude,
  loadAuthStatus,
  loadFixture,
  loadStdout,
  type FakeRun,
} from './claude-code-fakes.js';

/* ────────────────────────────────────────────────────────────
 * gen·smoke가 anthropic 모델을 claude-code 항목으로 끝까지 돈다.
 * 실제 레지스트리 항목(createClaudeCodeEntry)에 가짜 실행 함수·실행 파일·버전만 주입한다 — 실제 claude 없음.
 * 가짜 레포는 OS 임시 디렉토리. 레포의 results/·results-smoke/에 쓰지 않는다.
 * ──────────────────────────────────────────────────────────── */

const roots: string[] = [];
after(async () => {
  await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function repo(): Promise<string> {
  const root = await makeRepo();
  roots.push(root);
  return root;
}

async function claudeWorld(opts: { auth?: FakeRun; runs: FakeRun[] }) {
  const cli = fakeClaude({ auth: opts.auth ?? exited(await loadAuthStatus('claude-ai')), runs: opts.runs });
  const entry = createClaudeCodeEntry({
    runCli: cli,
    resolveBin: () => FAKE_CLAUDE_BIN,
    readVersion: () => FAKE_CLAUDE_VERSION,
    env: () => PARENT_ENV,
  });
  const registry: AdapterRegistry = { 'claude-code': entry };
  const world: FakeWorld = { registry, created: [], calls: [], configs: [] };
  return { cli, registry, world };
}

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );

/* ───────── gen ───────── */

test('gen: claude-code 항목으로 anthropic 모델을 생성하고 meta.json runtime.generator에 tool·version·invocation을 남긴다', async () => {
  const root = await repo();
  const { cli, world } = await claudeWorld({ runs: [exited(await loadStdout('ok'))] });
  const h = harness(root, { world });

  const code = await runBatch({ slugs: ['claude-a'], all: false, force: false }, h.deps);

  assert.equal(code, 0, h.output());
  const meta = await readMeta(root, 'claude-a');
  assert.equal(meta.outcome, 'ok');
  assert.equal(meta.runtime.generator.tool, 'claude-code');
  assert.equal(meta.runtime.generator.version, FAKE_CLAUDE_VERSION);
  assert.equal(
    meta.runtime.generator.invocation,
    'CLAUDE_CODE_MAX_OUTPUT_TOKENS=65536 claude -p --model claude-a-id --effort high --tools "" ' +
      '--system-prompt "<system prompt>" --safe-mode --strict-mcp-config --no-session-persistence ' +
      '--output-format json (stdin: <user prompt>)',
  );
  assert.deepEqual(meta.usageTotal, { inputTokens: 428, outputTokens: 11_250, reasoningTokens: 4_200 });
  assert.deepEqual(h.validated, ['claude-a'], 'ok면 검증을 이어서 한다');

  // preflight의 로그인 점검 1회 → 생성 1회. 프롬프트 파일 내용 그대로
  assert.equal(cli.auth.requests.length, 1);
  assert.equal(cli.generation.requests.length, 1);
  const sent = cli.generation.requests[0]!;
  assert.equal(sent.stdin, USER);
  assert.equal(sent.args[sent.args.indexOf('--system-prompt') + 1], SYSTEM);
  assert.equal(sent.args[sent.args.indexOf('--model') + 1], 'claude-a-id');
  assert.match(h.output(), /\[통과\] Claude Code 로그인/);
});

test('gen: 구독 로그인이 아니면 preflight에서 멈추고 생성하지 않는다', async () => {
  const root = await repo();
  const { cli, world } = await claudeWorld({
    auth: exited(await loadAuthStatus('logged-out'), 1),
    runs: [exited(await loadStdout('ok'))],
  });
  const h = harness(root, { world });

  assert.equal(await runBatch({ slugs: ['claude-a'], all: false, force: false }, h.deps), 1);
  assert.equal(cli.generation.requests.length, 0);
  assert.equal(await exists(path.join(root, 'results')), false);
  assert.match(h.output(), /\[실패\] Claude Code 로그인/);
  assert.doesNotMatch(h.output(), /user@example\.com/);
});

test('gen: 한도 초과는 재시도 없이 기록하고 다음 모델로 넘어간다 (exit 0)', async () => {
  const root = await repo();
  const usageLimit = exited(await loadFixture('stdout-usage-limit.json'), 1);
  const { cli, world } = await claudeWorld({ runs: [usageLimit, exited(await loadStdout('ok'))] });
  const h = harness(root, { world });

  assert.equal(await runBatch({ slugs: ['claude-a', 'claude-b'], all: false, force: false }, h.deps), 0, h.output());
  assert.equal(cli.generation.requests.length, 2, 'claude-a 1회(재시도 없음) + claude-b 1회');
  const a = await readMeta(root, 'claude-a');
  assert.equal(a.outcome, 'api_failed');
  assert.equal(a.attempts[0]?.result.type === 'error' && a.attempts[0].result.kind, 'usage_limit');
  assert.equal((await readMeta(root, 'claude-b')).outcome, 'ok');
  assert.match(h.output(), /한도 초과로 기록했습니다/);
});

/* ───────── smoke ───────── */

const AT = new Date(2026, 9, 13, 9, 5, 7);
const DIR = 'results-smoke/claude-a-20261013-090507';

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

test('smoke: 상한 8000으로 1회 생성하고 raw-stdout.txt(그대로)·raw-stderr.txt·raw-exit.json을 함께 남긴다', async () => {
  const root = await repo();
  const stdout = await loadStdout('ok');
  const { cli, registry } = await claudeWorld({ runs: [exited(stdout, 0, 'note\n')] });
  const s = smokeDeps(root, registry);

  assert.equal(await runSmoke({ slug: 'claude-a' }, s.deps), 0, s.output());

  assert.deepEqual(
    (await readdir(path.join(root, DIR))).sort(),
    ['index.html', 'meta.json', RAW_EXIT_FILE, RAW_STDERR_FILE, RAW_STDOUT_FILE, 'response.txt'].sort(),
  );
  assert.equal(await readFile(path.join(root, DIR, RAW_STDOUT_FILE), 'utf8'), stdout, 'fixture로 그대로 옮길 수 있다');
  assert.equal(await readFile(path.join(root, DIR, RAW_STDERR_FILE), 'utf8'), 'note\n');
  assert.deepEqual(JSON.parse(await readFile(path.join(root, DIR, RAW_EXIT_FILE), 'utf8')), { exitCode: 0, signal: null });

  const meta = await smokeMeta(root);
  assert.equal(meta.outcome, 'ok');
  assert.equal(meta.params.maxOutputTokens, SMOKE_MAX_OUTPUT_TOKENS);
  assert.equal(meta.runtime.generator.tool, 'claude-code');
  assert.equal(meta.runtime.generator.version, FAKE_CLAUDE_VERSION);
  assert.match(meta.runtime.generator.invocation, /^CLAUDE_CODE_MAX_OUTPUT_TOKENS=8000 claude -p --model claude-a-id /);

  const sent = cli.generation.requests[0]!;
  assert.equal(sent.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS, '8000');
  assert.equal(sent.stdin, SMOKE_PROMPT.user);
  assert.equal(sent.args[sent.args.indexOf('--system-prompt') + 1], SYSTEM, 'system은 season-tree-v1.system.md 그대로');
  assert.equal(cli.auth.requests.length, 1);
  assert.match(s.output(), /stopReason end \(end_turn\)/);
  assert.match(s.output(), /모델 claude-opus-5-5/);
});

test('smoke: 한도 초과면 exit 1, 원본 출력과 api_failed meta.json이 남고 stderr의 .env 값은 가린다', async () => {
  const root = await repo();
  const stdout = await loadFixture('stdout-usage-limit.json');
  const { registry } = await claudeWorld({ runs: [exited(stdout, 1, `debug ${FAKE_GEMINI_KEY}\n`)] });
  const s = smokeDeps(root, registry);

  assert.equal(await runSmoke({ slug: 'claude-a' }, s.deps), 1, s.output());
  const meta = await smokeMeta(root);
  assert.equal(meta.outcome, 'api_failed');
  assert.equal(meta.attempts[0]?.result.type === 'error' && meta.attempts[0].result.kind, 'usage_limit');
  assert.equal(await readFile(path.join(root, DIR, RAW_STDOUT_FILE), 'utf8'), stdout);
  assert.equal(await readFile(path.join(root, DIR, RAW_STDERR_FILE), 'utf8'), 'debug ***\n');
  assert.deepEqual(JSON.parse(await readFile(path.join(root, DIR, RAW_EXIT_FILE), 'utf8')), { exitCode: 1, signal: null });
  assert.match(s.output(), /api_failed \(usage_limit\)/);
});

test('smoke: 다른 authMethod면 preflight에서 멈추고 생성·폴더 생성을 하지 않는다', async () => {
  const root = await repo();
  const { cli, registry } = await claudeWorld({
    auth: exited(await loadAuthStatus('other-method')),
    runs: [exited(await loadStdout('ok'))],
  });
  const s = smokeDeps(root, registry);

  assert.equal(await runSmoke({ slug: 'claude-a' }, s.deps), 1);
  assert.equal(cli.generation.requests.length, 0);
  assert.equal(await exists(path.join(root, 'results-smoke')), false);
  assert.doesNotMatch(s.output(), /user@example\.com|Example Org/);
});
