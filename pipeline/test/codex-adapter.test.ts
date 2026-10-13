import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { GENERATOR_BY_PROVIDER, UsageSchema, maxOutputTokensFor, type GenerationRequest } from '@opb/core';
import { CodexAdapter } from '../src/adapters/codex/codex.adapter.js';
import { CodexCallError } from '../src/adapters/codex/codex.errors.js';
import { defaultRepoRoot } from '../src/config/config.js';
import { fakeRunCli, type FakeRun } from './claude-code-fakes.js';
import {
  CODEX_PARENT_ENV,
  FAKE_CODEX_COMMAND,
  FAKE_CODEX_VERSION,
  argAfter,
  codexExited,
  configString,
  lastAgentMessage,
  loadEvents,
  loadFixture,
  loadStdout,
  toJsonl,
} from './codex-fakes.js';

/* ───────── Codex 어댑터: 가짜 실행 함수 + 합성 fixture (실제 codex를 띄우지 않는다) ───────── */

const SYSTEM = '사용자의 요청에 답하세요.\n';
const USER = '사계절이 바뀌는 3D 나무를 "단일 HTML"로 만들어 주세요.\n';
const req: GenerationRequest = {
  modelId: 'gpt-6.1-sol',
  system: SYSTEM,
  user: USER,
  reasoningEffort: 'high',
  maxOutputTokens: null,
};

function adapterWith(script: FakeRun[], env: Readonly<Record<string, string | undefined>> = CODEX_PARENT_ENV) {
  const run = fakeRunCli(script);
  const adapter = new CodexAdapter(run, { command: FAKE_CODEX_COMMAND, version: FAKE_CODEX_VERSION, env });
  return { adapter, run };
}

const signal = () => new AbortController().signal;

async function generateFrom(stdout: string, opts: Parameters<typeof codexExited>[1] = {}) {
  const { adapter } = adapterWith([codexExited(stdout, opts)]);
  return adapter.generate(req, signal());
}

async function failureOf(stdout: string, opts: Parameters<typeof codexExited>[1] = {}): Promise<CodexCallError> {
  const err = await generateFrom(stdout, opts).then(
    () => assert.fail('던져야 한다'),
    (e: unknown) => e,
  );
  assert.ok(err instanceof CodexCallError, String(err));
  return err;
}

/* ───────── 어댑터 정체 ───────── */

test('generator는 codex-cli + 주입한 CLI 버전, provider openai, 출력 상한 지정 불가(→ maxOutputTokens null)', () => {
  const { adapter } = adapterWith([]);
  assert.equal(adapter.provider, 'openai');
  assert.deepEqual(adapter.generator, { tool: 'codex-cli', version: FAKE_CODEX_VERSION });
  assert.equal(GENERATOR_BY_PROVIDER[adapter.provider], adapter.generator.tool);
  assert.equal(adapter.supportsMaxOutputTokens, false);
  assert.equal(maxOutputTokensFor(adapter), null);
  assert.equal(maxOutputTokensFor(adapter, 8_000), null, 'smoke 상한도 Codex에는 넘기지 않는다');
});

/* ───────── 호출: 인자·stdin·작업 폴더·환경 ───────── */

test('호출: node + codex.js(prefixArgs) 뒤 사양 그대로의 인자 배열, -c 6개, stdin은 user 프롬프트, signal은 그대로', async () => {
  const { adapter, run } = adapterWith([codexExited(await loadStdout('ok'))]);
  const ac = new AbortController();
  await adapter.generate(req, ac.signal);

  assert.equal(run.requests.length, 1, '어댑터는 호출을 1회만 한다 (재시도는 Runner)');
  const r = run.requests[0]!;
  const tmp = path.dirname(r.cwd);
  const instructions = path.join(tmp, 'instructions.md');
  assert.equal(r.bin, FAKE_CODEX_COMMAND.bin);
  assert.deepEqual(r.args, [
    ...FAKE_CODEX_COMMAND.prefixArgs,
    'exec',
    '--model',
    'gpt-6.1-sol',
    '--sandbox',
    'read-only',
    '--skip-git-repo-check',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    '--json',
    '-o',
    path.join(tmp, 'last-message.txt'),
    '-C',
    path.join(tmp, 'work'),
    '-c',
    'model_reasoning_effort="high"',
    '-c',
    `model_instructions_file="${instructions.replaceAll('\\', '/')}"`,
    '-c',
    'include_environment_context=false',
    '-c',
    'include_apps_instructions=false',
    '-c',
    'include_collaboration_mode_instructions=false',
    '-c',
    'skills.include_instructions=false',
    '-',
  ]);
  assert.ok(!configString(r.args, 'model_instructions_file').includes('\\'), 'TOML 값의 경로는 슬래시 (역슬래시 이스케이프 방지)');
  assert.ok(!r.args.includes(USER) && !r.args.some((a) => a.includes('사계절')), 'user 프롬프트는 인자가 아니라 stdin으로');
  assert.ok(!r.args.some((a) => a.includes('사용자의 요청')), '시스템 프롬프트는 인자가 아니라 파일로');
  assert.equal(r.stdin, USER);
  assert.equal(r.signal, ac.signal);
});

test('작업 폴더: cwd = -C = 빈 work/, 매 호출 다른 OS 임시 폴더(레포 밖)이고 끝나면(실패해도) 지워진다', async () => {
  const { adapter, run } = adapterWith([
    codexExited(await loadStdout('ok')),
    codexExited(await loadStdout('server-503'), { exitCode: 1 }),
  ]);
  await adapter.generate(req, signal());
  await assert.rejects(adapter.generate(req, signal()), CodexCallError);

  assert.equal(run.cwdStates.length, 2);
  const repoRoot = defaultRepoRoot();
  for (const [i, state] of run.cwdStates.entries()) {
    assert.equal(state.existed, true, '호출할 때 폴더가 있다');
    assert.deepEqual(state.entries, [], 'work/에는 아무것도 두지 않는다 (AGENTS.md 등이 섞이지 않게, ADR-006)');
    assert.equal(path.basename(state.cwd), 'work');
    assert.equal(argAfter(run.requests[i]!.args, '-C'), state.cwd, '프로세스 cwd도 -C와 같은 work/');
    const inTmp = path.relative(tmpdir(), state.cwd);
    assert.ok(inTmp !== '' && !inTmp.startsWith('..') && !path.isAbsolute(inTmp), `OS 임시 폴더 안: ${state.cwd}`);
    const inRepo = path.relative(repoRoot, state.cwd);
    assert.ok(inRepo.startsWith('..') || path.isAbsolute(inRepo), `레포 밖: ${state.cwd}`);
    assert.equal(existsSync(path.dirname(state.cwd)), false, '임시 폴더째 지운다');
  }
  assert.notEqual(path.dirname(run.cwdStates[0]!.cwd), path.dirname(run.cwdStates[1]!.cwd));
});

test('instructions.md = req.system 바이트 그대로(끝 줄바꿈 포함), last-message.txt·instructions.md는 work/ 밖 같은 임시 폴더', async () => {
  const system = '첫 줄\r\n  들여쓰기와 끝 공백  \n\n';
  const seen: { bytes: Buffer; tmpEntries: string[]; work: string; instructions: string; lastMessage: string }[] = [];
  const { adapter } = adapterWith([
    codexExited(await loadStdout('ok'), {
      inspect: async (r) => {
        const instructions = configString(r.args, 'model_instructions_file');
        seen.push({
          bytes: await readFile(instructions),
          tmpEntries: (await readdir(path.dirname(r.cwd))).sort(),
          work: r.cwd,
          instructions: path.resolve(instructions),
          lastMessage: argAfter(r.args, '-o'),
        });
      },
    }),
  ]);
  await adapter.generate({ ...req, system }, signal());

  const s = seen[0];
  assert.ok(s !== undefined);
  assert.deepEqual(s.bytes, Buffer.from(system, 'utf8'), 'trim·줄바꿈 변환 없이 UTF-8');
  assert.deepEqual(s.tmpEntries, ['instructions.md', 'work'], '실행 전 임시 폴더: 지시문 파일과 빈 작업 폴더만');
  const tmp = path.dirname(s.work);
  assert.equal(path.dirname(s.instructions), tmp);
  assert.equal(path.dirname(s.lastMessage), tmp);
  for (const file of [s.instructions, s.lastMessage]) {
    assert.ok(path.relative(s.work, file).startsWith('..'), `work/ 밖: ${file}`);
  }
});

test('환경: API 키·Claude Code 세션 변수를 지우고 CODEX_HOME(인증)은 남긴다. 어댑터가 넣는 변수는 없다', async () => {
  const { adapter, run } = adapterWith([codexExited(await loadStdout('ok'))]);
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
    'CLAUDE_CODE_MAX_OUTPUT_TOKENS',
  ]) {
    assert.equal(env[name], undefined, `${name}가 자식 환경에 남았다`);
  }
  assert.equal(env.CODEX_HOME, CODEX_PARENT_ENV.CODEX_HOME);
  assert.equal(env.PATH, CODEX_PARENT_ENV.PATH);
  assert.equal(env.HOME, CODEX_PARENT_ENV.HOME);
  assert.ok(!Object.values(env).some((v) => /should-not-pass/.test(v)));
  const added = Object.keys(env).filter((k) => !(k in CODEX_PARENT_ENV));
  assert.deepEqual(added, []);
});

test('maxOutputTokens가 null이 아니면 generate·describeInvocation 모두 던진다 (기록된 상한과 실제 호출이 어긋나지 않게)', async () => {
  const { adapter, run } = adapterWith([codexExited(await loadStdout('ok'))]);
  const limited = { ...req, maxOutputTokens: 65_536 };
  await assert.rejects(adapter.generate(limited, signal()), /maxOutputTokens/);
  assert.throws(() => adapter.describeInvocation(limited), /maxOutputTokens/);
  assert.equal(run.requests.length, 0, 'codex를 띄우지 않는다');
});

/* ───────── 정규화 ───────── */

test('정상 출력 → 본문 = last-message.txt, 입력 = input_tokens(캐시 포함, 더하지 않음), 출력·추론, stopReason other', async () => {
  const stdout = await loadStdout('ok');
  const res = await generateFrom(stdout);

  assert.equal(res.text, lastAgentMessage(stdout));
  assert.match(res.text, /```html/);
  assert.equal(res.stopReason, 'other', '이벤트에 모델이 멈춘 이유가 없다');
  assert.equal(res.rawStopReason, 'turn.completed');
  // cached 3,072·cache_write 512는 input 5,200에 이미 들어 있다
  assert.deepEqual(res.usage, { inputTokens: 5_200, outputTokens: 9_800, reasoningTokens: 4_100 });
  assert.ok(UsageSchema.safeParse(res.usage).success);
  assert.equal(res.resolvedModelId, null);
  assert.equal(res.requestId, null);
  assert.equal(res.firstTokenMs, null, '스트리밍이 아닌 CLI (DATA "정규화 규칙")');
});

test('본문은 stdout의 agent_message가 아니라 last-message.txt 내용 그대로다', async () => {
  const lastMessage = '파일에서 읽은 본문\r\n```html\n<p>x</p>\n```\n';
  const res = await generateFrom(await loadStdout('ok'), { lastMessage });
  assert.equal(res.text, lastMessage);
});

test('명령 실행을 시도한(실패한 command_execution) 정상 출력도 성공: 본문은 마지막 메시지', async () => {
  const stdout = await loadStdout('command-failed');
  const res = await generateFrom(stdout);
  assert.equal(res.text, lastAgentMessage(stdout));
  assert.match(res.text, /합성 fixture/);
  assert.deepEqual(res.usage, { inputTokens: 6_100, outputTokens: 10_400, reasoningTokens: 4_300 });
});

test('사용량은 마지막 turn.completed의 usage (스레드 누적값이라 더하지 않는다)', async () => {
  const events = await loadEvents('ok');
  const earlier = { type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 50, reasoning_output_tokens: 10 } };
  const res = await generateFrom(toJsonl([...events.slice(0, -1), earlier, events.at(-1)]));
  assert.deepEqual(res.usage, { inputTokens: 5_200, outputTokens: 9_800, reasoningTokens: 4_100 });
});

async function usageFrom(usage: unknown) {
  const events = await loadEvents('ok');
  const last = usage === undefined ? { type: 'turn.completed' } : { type: 'turn.completed', usage };
  return (await generateFrom(toJsonl([...events.slice(0, -1), last]))).usage;
}

test('사용량 필드가 없거나 숫자가 아니면 입력·출력 0, 추론 null (지어내지 않는다)', async () => {
  assert.deepEqual(await usageFrom(undefined), { inputTokens: 0, outputTokens: 0, reasoningTokens: null });
  assert.deepEqual(await usageFrom(null), { inputTokens: 0, outputTokens: 0, reasoningTokens: null });
  assert.deepEqual(await usageFrom({ input_tokens: 10, output_tokens: 500 }), { inputTokens: 10, outputTokens: 500, reasoningTokens: null });
  assert.deepEqual(
    await usageFrom({ input_tokens: '7', cached_input_tokens: 5, output_tokens: 2.5, reasoning_output_tokens: -1 }),
    { inputTokens: 0, outputTokens: 0, reasoningTokens: null },
    '토큰 수가 아닌 값은 0, cached_input_tokens로 대신하지 않는다',
  );
  assert.deepEqual(
    await usageFrom({ input_tokens: 10, output_tokens: 40, reasoning_output_tokens: 0 }),
    { inputTokens: 10, outputTokens: 40, reasoningTokens: 0 },
    '0은 0 그대로',
  );
});

test('reasoning_output_tokens가 output_tokens보다 크면 추론은 null (출력에 포함된다는 전제가 깨짐)', async () => {
  const usage = await usageFrom({ input_tokens: 10, output_tokens: 100, reasoning_output_tokens: 300 });
  assert.deepEqual(usage, { inputTokens: 10, outputTokens: 100, reasoningTokens: null });
  assert.ok(UsageSchema.safeParse(usage).success);
});

/* ───────── 성공 조건: exit 0 + turn.completed + last-message.txt, JSON이 아닌 줄 없음 ───────── */

test('exit 0이어도 turn.completed가 없으면 실패', async () => {
  const events = await loadEvents('ok');
  const err = await failureOf(toJsonl(events.slice(0, -1)), { lastMessage: '본문' });
  assert.equal(err.exitCode, 0);
  assert.match(err.message, /turn\.completed/);
});

test('exit 0 + turn.completed여도 last-message.txt가 없으면 실패', async () => {
  const err = await failureOf(await loadStdout('ok'), { lastMessage: null });
  assert.equal(err.exitCode, 0);
  assert.match(err.message, /last-message\.txt/);
});

test('exit code가 0이 아니면 turn.completed·last-message.txt가 있어도 실패', async () => {
  const err = await failureOf(await loadStdout('ok'), { exitCode: 1 });
  assert.equal(err.exitCode, 1);
  assert.match(err.message, /exit code 1/);
});

test('JSON이 아닌 줄이 있으면 실패 (정상 이벤트·마지막 메시지가 있어도), 빈 줄은 건너뛴다', async () => {
  const notJson = await failureOf(await loadFixture('stdout-not-json.txt'));
  assert.deepEqual(notJson.invalidLines, ['합성 fixture: JSON이 아닌 줄 (unexpected output)']);
  assert.match(notJson.message, /JSON이 아닌 줄/);

  const ok = await loadStdout('ok');
  const mixed = await failureOf(`${ok}warning: something\n`, { lastMessage: '본문' });
  assert.deepEqual(mixed.invalidLines, ['warning: something']);

  await failureOf(`${ok}[1,2]\n`, { lastMessage: '본문' }); // JSON이어도 이벤트 객체가 아니면

  const blankLines = await generateFrom(`\n${ok.replaceAll('\n', '\r\n\r\n')}\n  \n`);
  assert.equal(blankLines.rawStopReason, 'turn.completed');
});

test('실패 출력은 파싱한 이벤트·exit code·stderr를 담아 던진다', async () => {
  const err = await failureOf(await loadStdout('usage-limit'), { exitCode: 1, stderr: 'stderr 내용\n' });
  assert.equal(err.exitCode, 1);
  assert.equal(err.stderr, 'stderr 내용\n');
  assert.deepEqual(
    err.events.map((e) => e.type),
    ['thread.started', 'turn.started', 'error', 'turn.failed'],
  );
  assert.match(err.message, /^You’ve hit your usage limit\./);
});

test('빈 stdout → 실패', async () => {
  const err = await failureOf('', { exitCode: 1 });
  assert.deepEqual(err.events, []);
  assert.match(err.message, /exit code 1/);
});

test('실행 함수가 던진 에러(실행 파일 없음 등)는 그대로 전한다', async () => {
  const enoent = Object.assign(new Error(`spawn ${FAKE_CODEX_COMMAND.bin} ENOENT`), { code: 'ENOENT' });
  const { adapter } = adapterWith([{ reject: enoent }]);
  await assert.rejects(adapter.generate(req, signal()), (e) => e === enoent);
});

/* ───────── describeInvocation ───────── */

test('describeInvocation: 실제 인자와 같은 명령줄, 실행 파일은 codex, 임시 경로는 자리표시, user는 stdin이라고만', () => {
  const { adapter } = adapterWith([]);
  const invocation = adapter.describeInvocation(req);
  assert.equal(
    invocation,
    'codex exec --model gpt-6.1-sol --sandbox read-only --skip-git-repo-check --ephemeral ' +
      '--ignore-user-config --ignore-rules --json -o <tmp>/last-message.txt -C <tmp>/work ' +
      '-c model_reasoning_effort="high" -c model_instructions_file="<tmp>/instructions.md" ' +
      '-c include_environment_context=false -c include_apps_instructions=false ' +
      '-c include_collaboration_mode_instructions=false -c skills.include_instructions=false - (stdin: <user prompt>)',
  );
  assert.ok(!invocation.includes('사용자의 요청에 답하세요'), '시스템 프롬프트 내용이 없다');
  assert.ok(!invocation.includes('사계절'), 'user 프롬프트 내용이 없다');
  assert.ok(!invocation.includes('/fake/'), 'Node·codex.js 경로(사용자 폴더)가 없다');
  assert.ok(!invocation.includes('codex.js'));
  assert.ok(!invocation.includes(tmpdir()) && !invocation.includes(tmpdir().replaceAll('\\', '/')), '실제 임시 폴더가 없다');
  assert.doesNotMatch(invocation, /MAX_OUTPUT_TOKENS/);
});
