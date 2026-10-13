import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ClassifiedError, GenerationRequest } from '@opb/core';
import { ClaudeCodeAdapter } from '../src/adapters/claude-code/claude-code.adapter.js';
import { classifyClaudeCodeError } from '../src/adapters/claude-code/claude-code.errors.js';
import { CliAbortError, CliOutputLimitError } from '../src/system/cli.js';
import {
  FAKE_CLAUDE_BIN,
  FAKE_CLAUDE_VERSION,
  exited,
  fakeRunCli,
  loadFixture,
  loadOutput,
  loadStdout,
  type FakeRun,
} from './claude-code-fakes.js';

/* ───────── Claude Code 에러 → ClassifiedError (ARCHITECTURE "에러 분류"). 어댑터가 던진 에러를 그대로 분류한다 ───────── */

const req: GenerationRequest = {
  modelId: 'claude-opus-5-5',
  system: 'sys\n',
  user: 'user\n',
  reasoningEffort: 'high',
  maxOutputTokens: 65_536,
};

/** 가짜 실행 함수가 step대로 끝나면 어댑터가 던진 에러를 분류한다 */
async function classifyRun(step: FakeRun, signal = new AbortController().signal): Promise<ClassifiedError> {
  const adapter = new ClaudeCodeAdapter(fakeRunCli([step]), { bin: FAKE_CLAUDE_BIN, version: FAKE_CLAUDE_VERSION, env: {} });
  const err = await adapter.generate(req, signal).then(
    () => assert.fail('generate가 던져야 한다'),
    (e: unknown) => e,
  );
  return adapter.classifyError(err);
}

const classifyOutput = (stdout: string, exitCode: number | null = 1, stderr = '') =>
  classifyRun(exited(stdout, exitCode, stderr));

async function variant(name: string, patch: Record<string, unknown>): Promise<string> {
  return JSON.stringify({ ...(await loadOutput(name)), ...patch });
}

/* ───────── 구독 한도 ───────── */

test('실제 한도 초과 출력 → usage_limit, httpStatus 429, message = result, 0보다 큰 사용량은 담는다', async () => {
  const ce = await classifyOutput(await loadFixture('stdout-usage-limit.json'));
  assert.equal(ce.kind, 'usage_limit');
  assert.equal(ce.httpStatus, 429);
  assert.equal(ce.retryAfterMs, null);
  assert.equal(ce.message, "You've hit your session limit · resets 8pm (Asia/Seoul)");
  assert.deepEqual(ce.usage, { inputTokens: 12 + 59_703 + 234_817, outputTokens: 1_500, reasoningTokens: 70 });
});

test('api_error가 usage_limit_reached면 문구와 관계없이 usage_limit', async () => {
  const ce = await classifyOutput(await variant('overloaded-529', { api_error: 'usage_limit_reached', result: '알 수 없는 문구' }));
  assert.equal(ce.kind, 'usage_limit');
  assert.equal(ce.httpStatus, 529);
});

test('api_error·상태 코드 없이 한도 문구만 있어도 usage_limit (fixture: stdout-error-no-status)', async () => {
  const ce = await classifyOutput(await loadStdout('error-no-status'));
  assert.equal(ce.kind, 'usage_limit');
  assert.equal(ce.httpStatus, null);
  assert.equal(ce.message, "You've hit your weekly limit · resets Oct 20, 9am (Asia/Seoul)");
  assert.equal(ce.usage, null, '사용량이 0이면 담지 않는다');
});

test('한도 문구: usage limit · hit your … limit · limit reached (execute.py USAGE_LIMIT_RE와 같은 기준)', async () => {
  for (const result of [
    'Claude AI usage limit reached|1760432400',
    "You've hit your 5-hour limit",
    'You have hit your limit for today',
    'Weekly limit reached · resets Mon',
  ]) {
    const ce = await classifyOutput(await variant('error-no-status', { result }));
    assert.equal(ce.kind, 'usage_limit', result);
  }
});

test('"rate limit" 문구는 usage_limit이 아니다: 429면 rate_limited(재시도), 상태가 없으면 unknown', async () => {
  for (const result of ['API Error: Rate limit reached for requests', "You've hit your rate limit", 'rate limit exceeded']) {
    const with429 = await classifyOutput(await variant('overloaded-529', { api_error_status: 429, result }));
    assert.equal(with429.kind, 'rate_limited', result);
    const noStatus = await classifyOutput(await variant('error-no-status', { result }));
    assert.equal(noStatus.kind, 'unknown', result);
  }
});

test('stdout이 JSON이 아니어도 stderr의 한도 문구로 usage_limit, message는 stderr 앞부분', async () => {
  const ce = await classifyOutput('', 1, 'Error: Claude AI usage limit reached|1760432400\n    at main\n');
  assert.equal(ce.kind, 'usage_limit');
  assert.equal(ce.httpStatus, null);
  assert.match(ce.message, /^Error: Claude AI usage limit reached\|1760432400/);
});

test('is_error가 아닌 출력의 result(모델 본문)는 한도 문구를 찾지 않는다', async () => {
  const ce = await classifyOutput(await variant('ok', { result: 'usage limit reached 라는 글자가 든 HTML' }), 1);
  assert.notEqual(ce.kind, 'usage_limit');
  assert.equal(ce.kind, 'unknown');
  assert.doesNotMatch(ce.message, /HTML/, '모델 본문을 에러 메시지로 쓰지 않는다');
});

/* ───────── 상태 코드 ───────── */

test('api_error_status별: 429 → rate_limited, 529·5xx → server_error, 401·403 → auth, 400 → bad_request, 그 밖 → unknown', async () => {
  const overloaded = await classifyOutput(await loadStdout('overloaded-529'));
  assert.equal(overloaded.kind, 'server_error');
  assert.equal(overloaded.httpStatus, 529);
  assert.match(overloaded.message, /^API Error: 529/);
  assert.equal(overloaded.usage, null);

  const unauthorized = await classifyOutput(await loadStdout('auth-401'));
  assert.equal(unauthorized.kind, 'auth');
  assert.equal(unauthorized.httpStatus, 401);

  const cases: [number, ClassifiedError['kind']][] = [
    [429, 'rate_limited'],
    [500, 'server_error'],
    [503, 'server_error'],
    [529, 'server_error'],
    [401, 'auth'],
    [403, 'auth'],
    [400, 'bad_request'],
    [404, 'unknown'],
    [413, 'unknown'],
  ];
  for (const [status, kind] of cases) {
    const ce = await classifyOutput(await variant('overloaded-529', { api_error_status: status, result: `API Error: ${status}` }));
    assert.deepEqual([ce.kind, ce.httpStatus], [kind, status], `status ${status}`);
  }
});

test('상태 코드가 HTTP 범위의 정수가 아니면 없는 것으로 본다', async () => {
  for (const bad of ['529', 52.9, 99, 600, true]) {
    const ce = await classifyOutput(await variant('overloaded-529', { api_error_status: bad, result: 'API Error' }));
    assert.deepEqual([ce.kind, ce.httpStatus], ['unknown', null], String(bad));
  }
});

/* ───────── 그 밖 ───────── */

test('JSON이 아닌 stdout → unknown, message에 stdout 앞부분', async () => {
  const ce = await classifyOutput(await loadFixture('stdout-not-json.txt'));
  assert.equal(ce.kind, 'unknown');
  assert.equal(ce.httpStatus, null);
  assert.match(ce.message, /JSON이 아닌/);
  assert.match(ce.message, /unexpected output/);
  assert.equal(ce.usage, null);
});

test('message: result도 stderr도 없으면 exit code로 설명하고, 긴 stderr는 앞부분만', async () => {
  const empty = await classifyOutput('', 3);
  assert.match(empty.message, /exit code 3/);

  const long = await classifyOutput('', 1, 'x'.repeat(5_000));
  assert.ok(long.message.length <= 501, `길이 ${long.message.length}`);
  assert.ok(long.message.startsWith('xxxx'));
});

test('abort → timeout (실행 함수가 CliAbortError로 끝남)', async () => {
  const ac = new AbortController();
  const ce = await classifyRun(
    (r) =>
      new Promise((_resolve, reject) => {
        r.signal?.addEventListener('abort', () => reject(new CliAbortError(r.signal?.reason)), { once: true });
        ac.abort(new Error('timeout after 1200000ms'));
      }),
    ac.signal,
  );
  assert.equal(ce.kind, 'timeout');
  assert.equal(ce.httpStatus, null);
  assert.equal(ce.usage, null);
});

test('abort 계열 에러는 timeout: CliAbortError, AbortError·TimeoutError 이름의 에러', () => {
  assert.equal(classifyClaudeCodeError(new CliAbortError(new Error('timeout'))).kind, 'timeout');
  assert.equal(classifyClaudeCodeError(new DOMException('aborted', 'AbortError')).kind, 'timeout');
  assert.equal(classifyClaudeCodeError(new DOMException('timed out', 'TimeoutError')).kind, 'timeout');
});

test('실행 파일 없음(spawn ENOENT) → unknown, message에 원인', async () => {
  const enoent = Object.assign(new Error(`spawn ${FAKE_CLAUDE_BIN} ENOENT`), { code: 'ENOENT' });
  const ce = await classifyRun({ reject: enoent });
  assert.equal(ce.kind, 'unknown');
  assert.equal(ce.httpStatus, null);
  assert.match(ce.message, /ENOENT/);
});

test('출력 상한 초과·그 밖의 값 → unknown', () => {
  assert.equal(classifyClaudeCodeError(new CliOutputLimitError('stdout', 10)).kind, 'unknown');
  assert.equal(classifyClaudeCodeError('문자열').kind, 'unknown');
  assert.equal(classifyClaudeCodeError(undefined).kind, 'unknown');
});
