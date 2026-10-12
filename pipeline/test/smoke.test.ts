import assert from 'node:assert/strict';
import { readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { after, test } from 'node:test';
import { FinishReason } from '@google/genai';
import {
  DEFAULT_RUN_POLICY,
  GenerationRecordSchema,
  runGeneration,
  type GenerationRecord,
  type RunPolicy,
} from '@opb/core';
import type { GeminiChunk, GeminiClient } from '../src/adapters/gemini/gemini.adapter.js';
import { readGeminiSdkVersion } from '../src/adapters/gemini/gemini.client.js';
import { RAW_ERROR_FILE, RAW_STREAM_FILE } from '../src/adapters/gemini/gemini.recorder.js';
import { createAdapterRegistry, type AdapterRegistry } from '../src/adapters/registry.js';
import {
  SMOKE_INPUT_TOKEN_WARN,
  SMOKE_MAX_OUTPUT_TOKENS,
  SMOKE_PROMPT,
  SMOKE_RUN_POLICY,
  formatSmokeReport,
  inputTokenWarning,
  loadSmokePrompt,
  runSmoke,
  smokeDirRel,
  type SmokeDeps,
} from '../src/generation/smoke.js';
import { FAKE_COMMIT, FAKE_GEMINI_KEY, SYSTEM, fakeClock, fakeGit, fakeWorld, makeRepo } from './batch-fakes.js';
import { apiError, fakeClient, loadApiError, loadChunks, type FakeCall } from './gemini-fakes.js';

/* ────────────────────────────────────────────────────────────
 * smoke (`npm run smoke -- <slug>`): OS 임시 디렉토리의 가짜 레포 + 실제 레지스트리 항목(키 읽기·기록 래퍼)
 * + 가짜 GeminiClient. 실제 SDK 요청·git·네트워크를 쓰지 않고, 레포의 results-smoke/·results/에 쓰지 않는다.
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

/** 저장 폴더 이름에 쓰는 시각. 로컬 시각 생성자라 실행 PC의 시간대와 관계없이 20261012-090507 */
const AT = new Date(2026, 9, 12, 9, 5, 7);
const DIR = 'results-smoke/gemini-a-20261012-090507';

/**
 * 실제 gemini-api 항목으로 어댑터를 만든다(.env 키 확인·SDK 버전·smoke 기록 래퍼 그대로).
 * 실제 SDK 클라이언트는 만들어지기만 하고(네트워크 없음) 가짜 클라이언트로 바꿔 끼운다.
 */
function geminiRegistry(fake: GeminiClient): AdapterRegistry {
  const real = createAdapterRegistry()['gemini-api']!;
  return {
    'gemini-api': {
      createRecorder: (redact) => real.createRecorder!(redact),
      create: (config, options) => real.create(config, { wrapClient: () => options?.wrapClient?.(fake) ?? fake }),
    },
  };
}

function smokeHarness(
  root: string,
  opts: {
    calls?: FakeCall[];
    env?: Record<string, string | undefined>;
    dotenv?: Record<string, string>;
    git?: ReturnType<typeof fakeGit>;
    registry?: AdapterRegistry;
  } = {},
) {
  const client = fakeClient(opts.calls ?? []);
  const git = opts.git ?? fakeGit();
  const logs: string[] = [];
  const errors: string[] = [];
  const policies: RunPolicy[] = [];
  const deps: SmokeDeps = {
    config: { repoRoot: root, dotenv: opts.dotenv ?? { GEMINI_API_KEY: FAKE_GEMINI_KEY } },
    env: opts.env ?? {},
    adapters: opts.registry ?? geminiRegistry(client),
    git,
    run: (adapter, input, policy) => {
      policies.push(policy);
      return runGeneration(adapter, input, policy, fakeClock());
    },
    out: { log: (line) => void logs.push(line), error: (line) => void errors.push(line) },
    now: () => AT,
    nodeVersion: 'v24.14.0',
  };
  return { deps, client, git, logs, errors, policies, output: () => [...logs, ...errors].join('\n') };
}

async function readMeta(root: string, dirRel = DIR): Promise<GenerationRecord> {
  return GenerationRecordSchema.parse(JSON.parse(await readFile(path.join(root, dirRel, 'meta.json'), 'utf8')));
}

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );

/** 짧은 Hello 응답 스트림 (본문 청크 2개, 마지막에 usage) */
function helloChunks(promptTokenCount = 120): GeminiChunk[] {
  return [
    { candidates: [{ content: { parts: [{ text: '```html\n<!doctype html>' }], role: 'model' }, index: 0 }] },
    {
      candidates: [
        { content: { parts: [{ text: '<p>Hello</p>\n```\n' }], role: 'model' }, finishReason: FinishReason.STOP, index: 0 },
      ],
      usageMetadata: { promptTokenCount, candidatesTokenCount: 30, thoughtsTokenCount: 200, totalTokenCount: 0 },
      modelVersion: 'gemini-a-id',
      responseId: 'resp-1',
    },
  ];
}

/* ───────── 상수·순수 함수 ───────── */

test('smoke 프롬프트: id smoke·v1, 짧은 Hello 요청, 출력 상한 8000, 재시도 없는 정책(타임아웃 5분)', () => {
  assert.equal(SMOKE_PROMPT.id, 'smoke');
  assert.equal(SMOKE_PROMPT.version, 'v1');
  assert.match(SMOKE_PROMPT.user, /Hello/);
  assert.match(SMOKE_PROMPT.user, /```html/);
  assert.equal(SMOKE_MAX_OUTPUT_TOKENS, 8_000);
  assert.equal(SMOKE_RUN_POLICY.maxAttempts, 1);
  assert.equal(SMOKE_RUN_POLICY.timeoutMs, 5 * 60_000);
  assert.ok(SMOKE_RUN_POLICY.timeoutMs < DEFAULT_RUN_POLICY.timeoutMs);
});

test('loadSmokePrompt: system은 레포의 season-tree-v1.system.md 내용 그대로, user는 smoke 상수', async () => {
  const root = await repo();
  assert.deepEqual(await loadSmokePrompt(root), {
    id: 'smoke',
    version: 'v1',
    system: SYSTEM,
    user: SMOKE_PROMPT.user,
  });
});

test('smokeDirRel: results-smoke/<slug>-<YYYYMMDD-HHmmss> (로컬 시각, 두 자리 채움). 이상한 slug는 거부', () => {
  assert.equal(smokeDirRel('gemini-a', AT), DIR);
  assert.equal(smokeDirRel('x', new Date(2027, 0, 2, 3, 4, 5)), 'results-smoke/x-20270102-030405');
  assert.throws(() => smokeDirRel('../results/x', AT), /slug/);
  assert.throws(() => smokeDirRel('', AT), /slug/);
});

test('inputTokenWarning: 2,000을 넘을 때만 "도구 기본 지시문·메모리가 섞였을 수 있음" 경고', () => {
  assert.equal(SMOKE_INPUT_TOKEN_WARN, 2_000);
  assert.equal(inputTokenWarning(412), null);
  assert.equal(inputTokenWarning(2_000), null);
  const warning = inputTokenWarning(2_345);
  assert.ok(warning);
  assert.match(warning, /도구 기본 지시문·메모리가 섞였을 수 있음/);
  assert.match(warning, /2,345/);
});

/* ───────── (a) 정상 호출 ───────── */

test('(a) 정상: results-smoke/<slug>-<시각>/에 meta.json(스키마 통과, 상한 8000, prompt smoke)·response.txt·index.html', async () => {
  const root = await repo();
  const h = smokeHarness(root, { calls: [{ chunks: helloChunks() }] });

  const code = await runSmoke({ slug: 'gemini-a' }, h.deps);

  assert.equal(code, 0, h.output());
  const meta = await readMeta(root);
  assert.equal(meta.outcome, 'ok');
  assert.equal(meta.modelSlug, 'gemini-a');
  assert.equal(meta.params.maxOutputTokens, SMOKE_MAX_OUTPUT_TOKENS);
  assert.equal(meta.prompt.id, 'smoke');
  assert.equal(meta.prompt.version, 'v1');
  assert.equal(meta.runtime.gitCommit, FAKE_COMMIT);
  assert.equal(meta.runtime.nodeVersion, 'v24.14.0');
  assert.deepEqual(
    { tool: meta.runtime.generator.tool, version: meta.runtime.generator.version },
    { tool: 'gemini-api', version: readGeminiSdkVersion() },
  );
  assert.equal(meta.attempts.length, 1);
  assert.deepEqual(
    (await readdir(path.join(root, DIR))).sort(),
    ['index.html', 'meta.json', RAW_STREAM_FILE, 'response.txt'].sort(),
  );

  // 실제 요청: 시스템 지시문은 season-tree-v1.system.md, user는 smoke 요청, 상한 8000
  assert.equal(h.client.params.length, 1);
  const sent = h.client.params[0]!;
  assert.equal(sent.model, 'gemini-a-id');
  assert.equal(sent.contents, SMOKE_PROMPT.user);
  assert.equal(sent.config?.systemInstruction, SYSTEM);
  assert.equal(sent.config?.maxOutputTokens, SMOKE_MAX_OUTPUT_TOKENS);

  // 재시도 없는 정책으로 Runner를 부른다
  assert.deepEqual(h.policies, [SMOKE_RUN_POLICY]);
});

test('(a) 끝나면 저장 폴더·outcome·사용량(입력·출력·추론)·걸린 시간을 출력한다', async () => {
  const root = await repo();
  const h = smokeHarness(root, { calls: [{ chunks: helloChunks() }] });

  assert.equal(await runSmoke({ slug: 'gemini-a' }, h.deps), 0, h.output());
  const out = h.output();
  assert.match(out, new RegExp(`${DIR}/`));
  assert.match(out, /outcome: ok/);
  assert.match(out, /입력 120/);
  assert.match(out, /출력 230/);
  assert.match(out, /추론 200/);
  assert.match(out, /걸린 시간: \d+\.\ds/);
  assert.match(out, new RegExp(RAW_STREAM_FILE.replace('.', '\\.')));
  assert.doesNotMatch(out, /섞였을 수 있음/);
});

test('(a) smoke는 results/에 쓰지 않는다', async () => {
  const root = await repo();
  const h = smokeHarness(root, { calls: [{ chunks: helloChunks() }] });
  assert.equal(await runSmoke({ slug: 'gemini-a' }, h.deps), 0, h.output());
  assert.equal(await exists(path.join(root, 'results')), false);
});

/* ───────── (b) 원본 스트림 ───────── */

test('(b) raw-stream.jsonl: SDK 청크를 받은 순서대로 한 줄에 하나씩 (fixture 형식 그대로)', async () => {
  const root = await repo();
  const chunks = await loadChunks('ok');
  const h = smokeHarness(root, { calls: [{ chunks }] });

  assert.equal(await runSmoke({ slug: 'gemini-a' }, h.deps), 0, h.output());
  const text = await readFile(path.join(root, DIR, RAW_STREAM_FILE), 'utf8');
  const lines = text.split('\n').filter((line) => line !== '');
  assert.equal(lines.length, chunks.length);
  assert.deepEqual(
    lines.map((line) => JSON.parse(line) as GeminiChunk),
    chunks,
  );
  assert.equal(await exists(path.join(root, DIR, RAW_ERROR_FILE)), false);
});

/* ───────── (c) 실패 ───────── */

test('(c) 클라이언트가 429를 던지면: 재시도 없이 1회, api_failed meta.json + raw-error.json, exit 1', async () => {
  const root = await repo();
  const h = smokeHarness(root, {
    calls: [{ reject: await loadApiError('429-rate-limit') }, { chunks: helloChunks() }],
  });

  const code = await runSmoke({ slug: 'gemini-a' }, h.deps);

  assert.equal(code, 1, h.output());
  assert.equal(h.client.params.length, 1, '429(rate_limited)여도 다시 부르지 않는다');
  const meta = await readMeta(root);
  assert.equal(meta.outcome, 'api_failed');
  assert.equal(meta.attempts.length, 1);
  const result = meta.attempts[0]!.result;
  assert.equal(result.type === 'error' && result.kind, 'rate_limited');
  assert.equal(result.type === 'error' && result.httpStatus, 429);

  assert.deepEqual((await readdir(path.join(root, DIR))).sort(), [RAW_ERROR_FILE, 'meta.json'].sort());
  const raw = JSON.parse(await readFile(path.join(root, DIR, RAW_ERROR_FILE), 'utf8')) as {
    name: string;
    status: number;
    body: { error: { status: string } };
  };
  assert.equal(raw.name, 'ApiError');
  assert.equal(raw.status, 429);
  assert.equal(raw.body.error.status, 'RESOURCE_EXHAUSTED');
  assert.match(h.output(), /api_failed \(rate_limited\)/);
  assert.match(h.output(), new RegExp(RAW_ERROR_FILE.replace('.', '\\.')));
});

test('(c) 스트림 도중 실패: raw-stream.jsonl(받은 청크)과 raw-error.json이 함께 남는다', async () => {
  const root = await repo();
  const chunks = (await loadChunks('ok')).slice(0, 3);
  const h = smokeHarness(root, { calls: [{ chunks, throwAfter: await loadApiError('503', 'in_stream') }] });

  assert.equal(await runSmoke({ slug: 'gemini-a' }, h.deps), 1, h.output());
  assert.equal(h.client.params.length, 1);
  assert.equal((await readMeta(root)).outcome, 'api_failed');
  const lines = (await readFile(path.join(root, DIR, RAW_STREAM_FILE), 'utf8')).split('\n').filter(Boolean);
  assert.equal(lines.length, 3);
  const raw = JSON.parse(await readFile(path.join(root, DIR, RAW_ERROR_FILE), 'utf8')) as { stage: string; status: number };
  assert.deepEqual([raw.stage, raw.status], ['stream', 503]);
});

test('(c) raw-error.json과 출력에 .env의 API 키가 섞이면 가린다', async () => {
  const root = await repo();
  const leaky = apiError(400, { error: { code: 400, message: `bad key ${FAKE_GEMINI_KEY}`, status: 'INVALID_ARGUMENT' } });
  const h = smokeHarness(root, { calls: [{ reject: leaky }] });

  assert.equal(await runSmoke({ slug: 'gemini-a' }, h.deps), 1, h.output());
  const raw = await readFile(path.join(root, DIR, RAW_ERROR_FILE), 'utf8');
  assert.doesNotMatch(raw, new RegExp(FAKE_GEMINI_KEY));
  assert.match(raw, /bad key \*\*\*/);
  assert.doesNotMatch(h.output(), new RegExp(FAKE_GEMINI_KEY));
});

/* ───────── (d) preflight ───────── */

test('(d) git에 커밋 안 된 변경이 있어도 smoke는 진행한다 (git status를 부르지 않음)', async () => {
  const root = await repo();
  const git = fakeGit({ status: ' M pipeline/src/main.ts\n?? prompts/new.md\n' });
  const h = smokeHarness(root, { calls: [{ chunks: helloChunks() }], git });

  assert.equal(await runSmoke({ slug: 'gemini-a' }, h.deps), 0, h.output());
  assert.deepEqual(git.statusCalls, []);
  assert.equal(git.headCalls, 1, 'meta.json runtime.gitCommit용 HEAD는 읽는다');
  assert.equal((await readMeta(root)).outcome, 'ok');
  assert.doesNotMatch(h.output(), /git 작업 트리/);
});

test('(d) API 키 변수가 환경에 있으면 어댑터를 만들지도 부르지도 않고 중단한다 (빈 값이어도)', async () => {
  for (const env of [{ ANTHROPIC_API_KEY: 'sk-ant-xxx' }, { OPENAI_API_KEY: '' }]) {
    const root = await repo();
    const h = smokeHarness(root, { calls: [{ chunks: helloChunks() }], env });

    assert.equal(await runSmoke({ slug: 'gemini-a' }, h.deps), 1, h.output());
    assert.equal(h.client.params.length, 0);
    assert.deepEqual(h.policies, []);
    assert.equal(await exists(path.join(root, 'results-smoke')), false);
    assert.match(h.output(), /\[실패\] API 키 환경변수/);
  }
});

test('(d) .env에 GEMINI_API_KEY가 없으면 중단한다', async () => {
  const root = await repo();
  const h = smokeHarness(root, { calls: [{ chunks: helloChunks() }], dotenv: {} });
  assert.equal(await runSmoke({ slug: 'gemini-a' }, h.deps), 1, h.output());
  assert.equal(h.client.params.length, 0);
  assert.equal(await exists(path.join(root, 'results-smoke')), false);
});

test('모르는 slug·등록되지 않은 도구면 아무것도 부르지 않고 exit 1', async () => {
  const root = await repo();
  const unknown = smokeHarness(root, { calls: [{ chunks: helloChunks() }] });
  assert.equal(await runSmoke({ slug: 'nope' }, unknown.deps), 1);
  assert.match(unknown.output(), /nope/);
  assert.equal(unknown.client.params.length, 0);

  const unregistered = smokeHarness(root, { calls: [{ chunks: helloChunks() }] });
  assert.equal(await runSmoke({ slug: 'claude-a' }, unregistered.deps), 1);
  assert.match(unregistered.output(), /아직 지원하지 않는 생성 도구: claude-code/);
  assert.equal(await exists(path.join(root, 'results-smoke')), false);
});

test('기록 래퍼가 없는 도구도 호출은 하고, 원본 출력이 없다고 알린다', async () => {
  const root = await repo();
  const world = fakeWorld({}, ['gemini-api']); // 가짜 항목: createRecorder 없음
  const h = smokeHarness(root, { registry: world.registry });

  assert.equal(await runSmoke({ slug: 'gemini-a' }, h.deps), 0, h.output());
  assert.deepEqual(world.calls, ['gemini-a-id']);
  assert.deepEqual((await readdir(path.join(root, DIR))).sort(), ['index.html', 'meta.json', 'response.txt']);
  assert.match(h.output(), /원본 출력/);
});

/* ───────── (e) 입력 토큰 경고 ───────── */

test('(e) 입력 토큰이 2,000을 넘으면 "도구 기본 지시문·메모리가 섞였을 수 있음" 경고', async () => {
  const root = await repo();
  const h = smokeHarness(root, { calls: [{ chunks: helloChunks(2_345) }] });

  assert.equal(await runSmoke({ slug: 'gemini-a' }, h.deps), 0, h.output());
  assert.match(h.output(), /도구 기본 지시문·메모리가 섞였을 수 있음/);
});

test('formatSmokeReport: api_failed면 실패 종류와 메시지, 추론 토큰이 없으면 그렇게 표시', async () => {
  const root = await repo();
  const h = smokeHarness(root, { calls: [{ reject: await loadApiError('429-daily-quota') }] });
  await runSmoke({ slug: 'gemini-a' }, h.deps);
  const meta = await readMeta(root);

  const report = formatSmokeReport(meta, DIR, ['meta.json', RAW_ERROR_FILE]);
  assert.match(report, /outcome: api_failed \(usage_limit\)/);
  assert.match(report, /HTTP 429/);
  assert.match(report, /입력 0 · 출력 0 · 추론 -/);
  assert.match(report, /raw-error\.json/);
});
