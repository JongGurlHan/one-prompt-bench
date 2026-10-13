import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { GENERATOR_BY_PROVIDER, UsageSchema, type GenerationRequest } from '@opb/core';
import { ClaudeCodeAdapter } from '../src/adapters/claude-code/claude-code.adapter.js';
import { ClaudeCodeCallError } from '../src/adapters/claude-code/claude-code.errors.js';
import { defaultRepoRoot } from '../src/config/config.js';
import {
  FAKE_CLAUDE_BIN,
  FAKE_CLAUDE_VERSION,
  PARENT_ENV,
  exited,
  fakeRunCli,
  loadFixture,
  loadOutput,
  loadStdout,
  type FakeRun,
} from './claude-code-fakes.js';

/* ───────── Claude Code 어댑터: 가짜 실행 함수 + fixture (실제 claude를 띄우지 않는다) ───────── */

const SYSTEM = '사용자의 요청에 답하세요.\n';
const USER = '사계절이 바뀌는 3D 나무를 "단일 HTML"로 만들어 주세요.\n';
const req: GenerationRequest = {
  modelId: 'claude-opus-5-5',
  system: SYSTEM,
  user: USER,
  reasoningEffort: 'high',
  maxOutputTokens: 65_536,
};

function adapterWith(script: FakeRun[], env: Readonly<Record<string, string | undefined>> = PARENT_ENV) {
  const run = fakeRunCli(script);
  const adapter = new ClaudeCodeAdapter(run, { bin: FAKE_CLAUDE_BIN, version: FAKE_CLAUDE_VERSION, env });
  return { adapter, run };
}

const signal = () => new AbortController().signal;

/** fixture를 고쳐 만든 stdout (필드 하나만 바꾼 변형) */
async function variant(name: string, patch: Record<string, unknown>): Promise<string> {
  return JSON.stringify({ ...(await loadOutput(name)), ...patch });
}

async function generateFrom(stdout: string, exitCode: number | null = 0) {
  const { adapter } = adapterWith([exited(stdout, exitCode)]);
  return adapter.generate(req, signal());
}

/* ───────── 어댑터 정체 ───────── */

test('generator는 claude-code + 주입한 CLI 버전, provider anthropic, 출력 상한 지정 가능', () => {
  const { adapter } = adapterWith([]);
  assert.equal(adapter.provider, 'anthropic');
  assert.deepEqual(adapter.generator, { tool: 'claude-code', version: FAKE_CLAUDE_VERSION });
  assert.equal(GENERATOR_BY_PROVIDER[adapter.provider], adapter.generator.tool);
  assert.equal(adapter.supportsMaxOutputTokens, true);
});

/* ───────── 호출: 인자·stdin·cwd·환경 ───────── */

test('호출: 실행 파일 + 사양 그대로의 인자 배열(빈 문자열 인자 포함), stdin은 user 프롬프트, signal은 그대로', async () => {
  const { adapter, run } = adapterWith([exited(await loadStdout('ok'))]);
  const ac = new AbortController();
  await adapter.generate(req, ac.signal);

  assert.equal(run.requests.length, 1, '어댑터는 호출을 1회만 한다 (재시도는 Runner)');
  const [r] = run.requests;
  assert.equal(r?.bin, FAKE_CLAUDE_BIN);
  assert.deepEqual(r?.args, [
    '-p',
    '--model',
    'claude-opus-5-5',
    '--effort',
    'high',
    '--tools',
    '',
    '--system-prompt',
    SYSTEM,
    '--safe-mode',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--output-format',
    'json',
  ]);
  assert.ok(!r?.args.includes('--bare'), '--bare는 API 키로만 인증해 과금된다 (ADR-006)');
  assert.ok(!r?.args.includes(USER), 'user 프롬프트는 인자가 아니라 stdin으로');
  assert.equal(r?.stdin, USER);
  assert.equal(r?.signal, ac.signal);
});

test('cwd: 매 호출 새로 만든 빈 OS 임시 폴더(레포 밖), 호출마다 다르고 끝나면 지워진다', async () => {
  const ok = await loadStdout('ok');
  const { adapter, run } = adapterWith([exited(ok), exited('not json', 1)]);
  await adapter.generate(req, signal());
  await assert.rejects(adapter.generate(req, signal()), ClaudeCodeCallError);

  assert.equal(run.cwdStates.length, 2);
  const repoRoot = defaultRepoRoot();
  for (const state of run.cwdStates) {
    assert.equal(state.existed, true, '호출할 때 폴더가 있다');
    assert.deepEqual(state.entries, [], '빈 폴더다');
    const inTmp = path.relative(tmpdir(), state.cwd);
    assert.ok(inTmp !== '' && !inTmp.startsWith('..') && !path.isAbsolute(inTmp), `OS 임시 폴더 안: ${state.cwd}`);
    const inRepo = path.relative(repoRoot, state.cwd);
    assert.ok(inRepo.startsWith('..') || path.isAbsolute(inRepo), `레포 밖: ${state.cwd}`);
    assert.equal(existsSync(state.cwd), false, '끝나면(실패해도) 지운다');
  }
  assert.notEqual(run.cwdStates[0]?.cwd, run.cwdStates[1]?.cwd);
});

test('환경: API 키·Claude Code 세션 변수를 지우고 CLAUDE_CODE_MAX_OUTPUT_TOKENS를 넣는다. 사용자 설정 변수는 남긴다', async () => {
  const { adapter, run } = adapterWith([exited(await loadStdout('ok'))]);
  await adapter.generate(req, signal());
  const env = run.requests[0]!.env;

  for (const name of [
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'CLAUDECODE',
    'CLAUDE_EFFORT',
    'CLAUDE_PID',
    'AI_AGENT',
    'CLAUDE_CODE_SESSION_ID',
    'CLAUDE_CODE_ENTRYPOINT',
  ]) {
    assert.equal(env[name], undefined, `${name}가 자식 환경에 남았다`);
  }
  assert.equal(env.CLAUDE_CODE_MAX_OUTPUT_TOKENS, '65536', '부모의 값(1)이 아니라 요청의 상한');
  assert.equal(env.PATH, PARENT_ENV.PATH);
  assert.equal(env.HOME, PARENT_ENV.HOME);
  assert.equal(env.CLAUDE_CONFIG_DIR, PARENT_ENV.CLAUDE_CONFIG_DIR);
  assert.equal(env.CLAUDE_CODE_GIT_BASH_PATH, PARENT_ENV.CLAUDE_CODE_GIT_BASH_PATH);
  assert.ok(!Object.values(env).some((v) => /should-not-pass/.test(v)));
});

test('maxOutputTokens가 null이면 CLAUDE_CODE_MAX_OUTPUT_TOKENS를 넣지 않는다 (부모 값도 지운다)', async () => {
  const { adapter, run } = adapterWith([exited(await loadStdout('ok'))]);
  const unlimited = { ...req, maxOutputTokens: null };
  await adapter.generate(unlimited, signal());
  assert.ok(!Object.keys(run.requests[0]!.env).some((k) => k.toUpperCase() === 'CLAUDE_CODE_MAX_OUTPUT_TOKENS'));
  assert.doesNotMatch(adapter.describeInvocation(unlimited), /CLAUDE_CODE_MAX_OUTPUT_TOKENS/);
});

/* ───────── 정규화 ───────── */

test('정상 출력 → 본문 = result, end_turn → end, 입력 = input + cache_creation + cache_read, 추론 = thinking_tokens', async () => {
  const stdout = await loadStdout('ok');
  const res = await generateFrom(stdout);

  assert.equal(res.text, (JSON.parse(stdout) as { result: string }).result);
  assert.match(res.text, /```html/);
  assert.equal(res.stopReason, 'end');
  assert.equal(res.rawStopReason, 'end_turn');
  assert.deepEqual(res.usage, { inputTokens: 8 + 300 + 120, outputTokens: 11_250, reasoningTokens: 4_200 });
  assert.ok(UsageSchema.safeParse(res.usage).success);
  assert.equal(res.resolvedModelId, 'claude-opus-5-5', 'modelUsage의 키');
  assert.equal(res.requestId, null);
  assert.equal(res.firstTokenMs, null, '스트리밍이 아닌 CLI (DATA "정규화 규칙")');
});

/* ───────── 실제 smoke 원본 (2026-10-13, claude-haiku-5-5, Claude Code 2.1.296) ───────── */

test('실제 출력(fixture smoke-ok): JSON 한 줄 + 줄바꿈, 본문·end_turn·캐시 생성분을 포함한 입력을 정규화한다', async () => {
  const stdout = await loadStdout('smoke-ok');
  assert.equal(stdout.trimEnd().split('\n').length, 1, 'stdout은 JSON 객체 한 줄');
  const res = await generateFrom(stdout);

  assert.equal(
    res.text,
    '```html\n<!DOCTYPE html>\n<html lang="ko">\n<head>\n  <meta charset="UTF-8">\n  <title>Hello</title>\n</head>\n<body>\n  <h1>Hello</h1>\n</body>\n</html>\n```',
  );
  assert.equal(res.stopReason, 'end');
  assert.equal(res.rawStopReason, 'end_turn');
  // input 2 + cache_creation 653 + cache_read 0. thinking_tokens 0 (필드는 있다 → null이 아니라 0)
  assert.deepEqual(res.usage, { inputTokens: 655, outputTokens: 85, reasoningTokens: 0 });
  UsageSchema.parse(res.usage);
  assert.equal(res.resolvedModelId, 'claude-haiku-5-5', 'modelUsage 키 하나');
  assert.equal(res.requestId, null);
  assert.equal(res.firstTokenMs, null);
});

test('stopReason: max_tokens → max_tokens, refusal → refusal, 그 밖·없음 → other (rawStopReason은 원문)', async () => {
  const truncated = await generateFrom(await loadStdout('max-tokens'));
  assert.deepEqual([truncated.stopReason, truncated.rawStopReason], ['max_tokens', 'max_tokens']);
  assert.deepEqual(truncated.usage, { inputTokens: 428, outputTokens: 65_536, reasoningTokens: 30_000 });

  const refused = await generateFrom(await loadStdout('refusal'));
  assert.deepEqual([refused.stopReason, refused.rawStopReason], ['refusal', 'refusal']);

  const stopSeq = await generateFrom(await variant('ok', { stop_reason: 'stop_sequence' }));
  assert.deepEqual([stopSeq.stopReason, stopSeq.rawStopReason], ['other', 'stop_sequence']);

  const missing = await generateFrom(await variant('ok', { stop_reason: undefined }));
  assert.deepEqual([missing.stopReason, missing.rawStopReason], ['other', null]);

  const nullReason = await generateFrom(await variant('ok', { stop_reason: null }));
  assert.deepEqual([nullReason.stopReason, nullReason.rawStopReason], ['other', null]);
});

/**
 * Claude Code는 출력 상한에 닿으면 스스로 이어 쓰기를 요청하고, 마지막 호출의 stop_reason(end_turn)과 마지막 조각만 result로 준다.
 * 사용량은 호출들의 합이다. 숫자는 2026-10-13 claude-sonnet-5-5 생성 기록(meta.json) 그대로
 */
const CONTINUED_USAGE = {
  input_tokens: 67_708,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  output_tokens: 87_265,
  output_tokens_details: { thinking_tokens: 69_211 },
};
const CONTINUED_TAIL = ' lerp(1, .35, p), () => 0];\n</script>\n</body>\n</html>\n```\n\n설명 문단';

test('이어 쓰기: 출력이 요청 상한을 넘으면(첫 호출이 상한에 닿음) stopReason max_tokens, rawStopReason은 원문 end_turn', async () => {
  const res = await generateFrom(await variant('ok', { stop_reason: 'end_turn', result: CONTINUED_TAIL, usage: CONTINUED_USAGE }));
  assert.deepEqual([res.stopReason, res.rawStopReason], ['max_tokens', 'end_turn']);
  assert.equal(res.text, CONTINUED_TAIL, '본문은 받은 그대로 (마지막 조각)');
  assert.deepEqual(res.usage, { inputTokens: 67_708, outputTokens: 87_265, reasoningTokens: 69_211 });
});

test('이어 쓰기 판단은 상한을 "넘을" 때만: 상한과 같거나 작으면 그대로, 상한이 없으면(null) 보지 않는다', async () => {
  const atLimit = await generateFrom(
    await variant('ok', { usage: { ...CONTINUED_USAGE, output_tokens: 65_536, output_tokens_details: { thinking_tokens: 30_000 } } }),
  );
  assert.equal(atLimit.stopReason, 'end');

  const { adapter } = adapterWith([exited(await variant('ok', { usage: CONTINUED_USAGE }))]);
  const noLimit = await adapter.generate({ ...req, maxOutputTokens: null }, signal());
  assert.equal(noLimit.stopReason, 'end');
});

test('사용량 필드가 없으면 입력·출력 0, 추론 null로 떨어진다 (숫자를 지어내지 않는다)', async () => {
  const none = await generateFrom(await variant('ok', { usage: undefined }));
  assert.deepEqual(none.usage, { inputTokens: 0, outputTokens: 0, reasoningTokens: null });

  const noThinking = await generateFrom(
    await variant('ok', { usage: { input_tokens: 10, output_tokens: 500 } }),
  );
  assert.deepEqual(noThinking.usage, { inputTokens: 10, outputTokens: 500, reasoningTokens: null });

  const odd = await generateFrom(
    await variant('ok', {
      usage: { input_tokens: '7', cache_creation_input_tokens: -1, cache_read_input_tokens: 2.5, output_tokens: 40 },
    }),
  );
  assert.deepEqual(odd.usage, { inputTokens: 0, outputTokens: 40, reasoningTokens: null }, '토큰 수가 아닌 값은 0');
});

test('thinking_tokens가 output_tokens보다 크면 추론은 null (출력에 포함된다는 전제가 깨짐 — 기록이 스키마를 통과하게)', async () => {
  const res = await generateFrom(
    await variant('ok', { usage: { input_tokens: 10, output_tokens: 100, output_tokens_details: { thinking_tokens: 300 } } }),
  );
  assert.deepEqual(res.usage, { inputTokens: 10, outputTokens: 100, reasoningTokens: null });
  assert.ok(UsageSchema.safeParse(res.usage).success);
});

test('resolvedModelId: modelUsage 키가 하나면 그 키, 여럿이면 요청한 모델의 키, 알 수 없으면 null', async () => {
  const usageOf = (canonicalModel: string) => ({ inputTokens: 1, outputTokens: 1, canonicalModel });

  const none = await generateFrom(await variant('ok', { modelUsage: undefined }));
  assert.equal(none.resolvedModelId, null);
  const empty = await generateFrom(await variant('ok', { modelUsage: {} }));
  assert.equal(empty.resolvedModelId, null);

  const two = await generateFrom(
    await variant('ok', { modelUsage: { 'claude-haiku-5-5': usageOf('claude-haiku-5-5'), 'claude-opus-5-5': usageOf('claude-opus-5-5') } }),
  );
  assert.equal(two.resolvedModelId, 'claude-opus-5-5');

  const ambiguous = await generateFrom(
    await variant('ok', { modelUsage: { 'claude-haiku-5-5': usageOf('claude-haiku-5-5'), 'other-x': usageOf('other-x') } }),
  );
  assert.equal(ambiguous.resolvedModelId, null);
});

/* ───────── 실패는 던진다 ───────── */

test('exit code 0이 아니거나 is_error가 true면 파싱한 출력·exit code·stderr를 담은 ClaudeCodeCallError를 던진다', async () => {
  const stdout = await loadFixture('stdout-usage-limit.json');
  const { adapter } = adapterWith([exited(stdout, 1, 'some stderr\n')]);
  const err = await adapter.generate(req, signal()).then(
    () => assert.fail('던져야 한다'),
    (e: unknown) => e,
  );
  assert.ok(err instanceof ClaudeCodeCallError);
  assert.equal(err.exitCode, 1);
  assert.equal(err.stderr, 'some stderr\n');
  assert.equal(err.output?.api_error, 'usage_limit_reached');
  assert.equal(err.output?.is_error, true);

  // exit 0이어도 is_error면 실패
  await assert.rejects(generateFrom(await loadStdout('overloaded-529'), 0), ClaudeCodeCallError);
});

test('JSON이 아닌 stdout, is_error 없음·false인데 exit 1, result가 없는 출력은 모두 던진다', async () => {
  const notJson = await generateFrom(await loadFixture('stdout-not-json.txt')).then(
    () => assert.fail('던져야 한다'),
    (e: unknown) => e,
  );
  assert.ok(notJson instanceof ClaudeCodeCallError);
  assert.equal(notJson.output, null);

  await assert.rejects(generateFrom(await loadStdout('ok'), 1), ClaudeCodeCallError);
  await assert.rejects(generateFrom(await variant('ok', { is_error: undefined })), ClaudeCodeCallError);
  await assert.rejects(generateFrom(await variant('ok', { result: undefined })), ClaudeCodeCallError);
  await assert.rejects(generateFrom('[1,2]'), ClaudeCodeCallError);
  await assert.rejects(generateFrom(''), ClaudeCodeCallError);
});

test('실행 함수가 던진 에러(실행 파일 없음 등)는 그대로 전한다', async () => {
  const enoent = Object.assign(new Error(`spawn ${FAKE_CLAUDE_BIN} ENOENT`), { code: 'ENOENT' });
  const { adapter } = adapterWith([{ reject: enoent }]);
  await assert.rejects(adapter.generate(req, signal()), (e) => e === enoent);
});

/* ───────── describeInvocation ───────── */

test('describeInvocation: 실제 인자와 같은 명령줄 + 상한 환경변수, 시스템 프롬프트는 자리표시, user는 stdin이라고만', () => {
  const { adapter } = adapterWith([]);
  const invocation = adapter.describeInvocation(req);
  assert.equal(
    invocation,
    'CLAUDE_CODE_MAX_OUTPUT_TOKENS=65536 claude -p --model claude-opus-5-5 --effort high --tools "" ' +
      '--system-prompt "<system prompt>" --safe-mode --strict-mcp-config --no-session-persistence ' +
      '--output-format json (stdin: <user prompt>)',
  );
  assert.ok(!invocation.includes('사용자의 요청에 답하세요'), '시스템 프롬프트 내용이 없다');
  assert.ok(!invocation.includes('사계절'), 'user 프롬프트 내용이 없다');
  assert.ok(!invocation.includes(FAKE_CLAUDE_BIN), '실행 파일 경로(사용자 폴더)가 없다');
  assert.ok(!invocation.includes('should-not-pass'));
});

test('describeInvocation: 상한이 다르면 그 값을 적는다', () => {
  const { adapter } = adapterWith([]);
  assert.match(adapter.describeInvocation({ ...req, maxOutputTokens: 8_000 }), /^CLAUDE_CODE_MAX_OUTPUT_TOKENS=8000 claude -p /);
});
