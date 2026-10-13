import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ClassifiedError, FailureKind, GenerationRequest } from '@opb/core';
import { CodexAdapter } from '../src/adapters/codex/codex.adapter.js';
import { classifyCodexError } from '../src/adapters/codex/codex.errors.js';
import { CliAbortError, CliOutputLimitError } from '../src/system/cli.js';
import { exited, fakeRunCli, type FakeRun } from './claude-code-fakes.js';
import {
  FAKE_CODEX_COMMAND,
  FAKE_CODEX_VERSION,
  codexExited,
  loadEvents,
  loadFixture,
  loadStdout,
  toJsonl,
} from './codex-fakes.js';

/* ───────── Codex 에러 → ClassifiedError (ARCHITECTURE "Codex CLI" 에러 분류). 어댑터가 던진 에러를 그대로 분류한다 ───────── */

const req: GenerationRequest = {
  modelId: 'gpt-6.1-sol',
  system: 'sys\n',
  user: 'user\n',
  reasoningEffort: 'high',
  maxOutputTokens: null,
};

/** 가짜 실행 함수가 step대로 끝나면 어댑터가 던진 에러를 분류한다 */
async function classifyRun(step: FakeRun, signal = new AbortController().signal): Promise<ClassifiedError> {
  const adapter = new CodexAdapter(fakeRunCli([step]), { command: FAKE_CODEX_COMMAND, version: FAKE_CODEX_VERSION, env: {} });
  const err = await adapter.generate(req, signal).then(
    () => assert.fail('generate가 던져야 한다'),
    (e: unknown) => e,
  );
  return adapter.classifyError(err);
}

const classifyOutput = (stdout: string, exitCode: number | null = 1, stderr = '') =>
  classifyRun(codexExited(stdout, { exitCode, stderr }));

/** turn.failed(+ 같은 문구의 error 이벤트)로 끝나는 출력 — 합성 실패 fixture와 같은 모양에 문구만 바꾼다 */
async function failedWith(message: string): Promise<string> {
  const events = await loadEvents('server-503');
  return toJsonl([...events.slice(0, 2), { type: 'error', message }, { type: 'turn.failed', error: { message } }]);
}

const classifyMessage = async (message: string) => classifyOutput(await failedWith(message));

/** 웹소켓 에러 프레임을 Codex가 그대로 message에 담은 모양 (실제 출력 stdout-model-not-supported.jsonl) */
const wsError = (status: number, type: string, message: string) =>
  JSON.stringify({ type: 'error', status, error: { type, message } });

/* ───────── fixture별 ───────── */

test('fixture별 분류: 한도 → usage_limit, 401 → auth, 503 → server_error, 스트림 끊김 → network, 잘림 → unknown', async () => {
  const cases: [string, FailureKind, number | null][] = [
    ['usage-limit', 'usage_limit', null],
    ['auth-401', 'auth', 401],
    ['server-503', 'server_error', 503],
    ['stream-disconnected', 'network', null],
    ['incomplete', 'unknown', null],
  ];
  for (const [name, kind, status] of cases) {
    const ce = await classifyOutput(await loadStdout(name));
    assert.deepEqual([ce.kind, ce.httpStatus], [kind, status], name);
    assert.equal(ce.retryAfterMs, null, name);
    assert.equal(ce.usage, null, `${name}: 실패 출력에는 사용량이 없다`);
  }
});

test('실제 출력(0.157.1, 모델 거부): 웹소켓 에러 JSON의 status 400 → bad_request. 앞선 모델 정보 경고 item은 message가 아니다', async () => {
  const ce = await classifyOutput(await loadStdout('model-not-supported'));
  assert.deepEqual([ce.kind, ce.httpStatus], ['bad_request', 400]);
  assert.equal(
    ce.message,
    '{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The \'gpt-6.1-sol\' model is not supported when using Codex with a ChatGPT account."}}',
  );
  assert.equal(ce.usage, null);
});

test('한도 초과: message는 turn.failed의 error.message (굽은 따옴표 그대로)', async () => {
  const ce = await classifyOutput(await loadStdout('usage-limit'));
  assert.equal(ce.kind, 'usage_limit');
  assert.equal(ce.message, 'You’ve hit your usage limit. 합성 fixture — 이 뒤 문구는 실제와 다를 수 있다.');
});

test('잘림(Incomplete response returned)은 stream disconnected가 들어 있어도 network가 아니라 unknown (재시도하지 않는다)', async () => {
  const ce = await classifyOutput(await loadStdout('incomplete'));
  assert.equal(ce.kind, 'unknown');
  assert.equal(ce.message, 'stream disconnected before completion: Incomplete response returned, reason: max_output_tokens');
});

/* ───────── 목록의 각 줄 (위에서부터 처음 맞는 것) ───────── */

test('목록의 각 줄과 httpStatus(unexpected status NNN)', async () => {
  const cases: [string, FailureKind, number | null][] = [
    // 한도
    ['You’ve hit your usage limit. Try again later.', 'usage_limit', null],
    ["You've hit your usage limit.", 'usage_limit', null],
    ['Quota exceeded. Check your plan and billing details.', 'usage_limit', null],
    ['You have hit your weekly limit', 'usage_limit', null],
    ['Weekly limit reached', 'usage_limit', null],
    // 잘림·필터
    ['Incomplete response returned, reason: content_filter', 'unknown', null],
    // 짧은 한도
    ['rate limit exceeded', 'rate_limited', null],
    ['unexpected status 429 Too Many Requests: slow down', 'rate_limited', 429],
    // 서버
    ['unexpected status 500 Internal Server Error: x', 'server_error', 500],
    ['unexpected status 502 Bad Gateway: x', 'server_error', 502],
    ['We are currently experiencing high demand, which may cause temporary errors.', 'server_error', null],
    ['The model is at capacity', 'server_error', null],
    // 네트워크
    ['stream disconnected before completion: error sending request', 'network', null],
    ['Connection failed: error sending request for url', 'network', null],
    // 인증
    ['unexpected status 401 Unauthorized: x', 'auth', 401],
    ['unexpected status 403 Forbidden: x', 'auth', 403],
    ['Not logged in', 'auth', null],
    ['To use Codex with your ChatGPT plan, upgrade to Plus: https://example.com', 'auth', null],
    // 요청
    ['unexpected status 400 Bad Request: x', 'bad_request', 400],
    // 그 밖
    ['unexpected status 404 Not Found: x', 'unknown', 404],
    ['something else happened', 'unknown', null],
    // 웹소켓 에러 JSON (실제 출력 stdout-model-not-supported.jsonl의 모양 — "unexpected status NNN" 대신 "status":NNN)
    [wsError(400, 'invalid_request_error', 'bad'), 'bad_request', 400],
    [wsError(401, 'invalid_api_key', 'x'), 'auth', 401],
    [wsError(403, 'forbidden', 'x'), 'auth', 403],
    [wsError(429, 'rate_limit_exceeded', 'slow down'), 'rate_limited', 429],
    [wsError(429, 'usage_limit_reached', 'x'), 'usage_limit', 429],
    [wsError(503, 'server_error', 'x'), 'server_error', 503],
    [wsError(404, 'not_found', 'x'), 'unknown', 404],
  ];
  for (const [message, kind, status] of cases) {
    const ce = await classifyMessage(message);
    assert.deepEqual([ce.kind, ce.httpStatus], [kind, status], message);
  }
});

test('순서: 앞 줄이 이긴다 (한도 > 잘림 > 429 > 5xx > 스트림 끊김 > 인증 > 400)', async () => {
  const cases: [string, FailureKind][] = [
    ['You’ve hit your usage limit. Upgrade to Plus to continue.', 'usage_limit'],
    ['stream disconnected before completion: Incomplete response returned, reason: max_output_tokens', 'unknown'],
    ['unexpected status 429 Too Many Requests: stream disconnected', 'rate_limited'],
    ['stream disconnected before completion: unexpected status 503 Service Unavailable', 'server_error'],
    ['stream disconnected before completion: Not logged in', 'network'],
  ];
  for (const [message, kind] of cases) {
    assert.equal((await classifyMessage(message)).kind, kind, message);
  }
});

test('"rate limit" 문구는 usage_limit이 아니다', async () => {
  for (const message of ['rate limit exceeded', 'Rate limit reached for requests', "You've hit your rate limit"]) {
    assert.notEqual((await classifyMessage(message)).kind, 'usage_limit', message);
  }
  assert.equal((await classifyMessage('rate limit exceeded')).kind, 'rate_limited');
});

/* ───────── message 출처 ───────── */

test('message: turn.failed → 마지막 error 이벤트 → stderr → exit code·출력 모양 순서', async () => {
  const head = (await loadEvents('server-503')).slice(0, 2);

  const turnFailed = await classifyOutput(
    toJsonl([...head, { type: 'error', message: 'unexpected status 503 first' }, { type: 'turn.failed', error: { message: 'Not logged in' } }]),
    1,
    'rate limit exceeded\n',
  );
  assert.deepEqual([turnFailed.message, turnFailed.kind], ['Not logged in', 'auth'], 'turn.failed가 먼저');

  const lastError = await classifyOutput(
    toJsonl([...head, { type: 'error', message: 'unexpected status 503 first' }, { type: 'error', message: 'unexpected status 401 last' }]),
    1,
    'rate limit exceeded\n',
  );
  assert.deepEqual([lastError.message, lastError.kind, lastError.httpStatus], ['unexpected status 401 last', 'auth', 401], '마지막 error 이벤트');

  const stderr = await classifyOutput(toJsonl(head), 1, '  Error: Not logged in\n');
  assert.deepEqual([stderr.message, stderr.kind], ['Error: Not logged in', 'auth'], '이벤트에 에러가 없으면 stderr');

  const bare = await classifyOutput(toJsonl(head), 3);
  assert.equal(bare.kind, 'unknown');
  assert.match(bare.message, /exit code 3/);
});

test('message는 500자까지', async () => {
  const long = await classifyMessage(`unexpected status 503 ${'x'.repeat(5_000)}`);
  assert.equal(long.kind, 'server_error');
  assert.ok(long.message.length <= 501, `길이 ${long.message.length}`);
  assert.ok(long.message.startsWith('unexpected status 503 xxxx'));

  const stderr = await classifyOutput('', 1, 'y'.repeat(5_000));
  assert.ok(stderr.message.length <= 501);
});

test('정상 본문(agent_message)의 글자는 분류에 쓰지 않는다', async () => {
  const events = await loadEvents('ok');
  const body = { type: 'item.completed', item: { id: 'item_9', type: 'agent_message', text: 'usage limit reached 라는 글자가 든 HTML' } };
  const ce = await classifyOutput(toJsonl([...events.slice(0, -1), body, events.at(-1)]), 1);
  assert.equal(ce.kind, 'unknown');
  assert.doesNotMatch(ce.message, /HTML/, '모델 본문을 에러 메시지로 쓰지 않는다');
});

test('JSON이 아닌 줄 → unknown, message에 그 줄', async () => {
  const ce = await classifyOutput(await loadFixture('stdout-not-json.txt'));
  assert.equal(ce.kind, 'unknown');
  assert.equal(ce.httpStatus, null);
  assert.match(ce.message, /JSON이 아닌 줄/);
  assert.match(ce.message, /unexpected output/);
  assert.equal(ce.usage, null);
});

test('exit 0인데 turn.completed·last-message.txt가 없는 실패 → unknown', async () => {
  const noTurn = await classifyRun(codexExited(toJsonl((await loadEvents('ok')).slice(0, -1)), { lastMessage: 'x' }));
  assert.equal(noTurn.kind, 'unknown');
  const noFile = await classifyRun(codexExited(await loadStdout('ok'), { lastMessage: null }));
  assert.equal(noFile.kind, 'unknown');
  assert.match(noFile.message, /last-message\.txt/);
});

/* ───────── 실행 자체의 실패 ───────── */

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
  assert.equal(classifyCodexError(new CliAbortError(new Error('timeout'))).kind, 'timeout');
  assert.equal(classifyCodexError(new DOMException('aborted', 'AbortError')).kind, 'timeout');
  assert.equal(classifyCodexError(new DOMException('timed out', 'TimeoutError')).kind, 'timeout');
});

test('실행 파일 없음(spawn ENOENT) → unknown, message에 원인', async () => {
  const enoent = Object.assign(new Error(`spawn ${FAKE_CODEX_COMMAND.bin} ENOENT`), { code: 'ENOENT' });
  const ce = await classifyRun({ reject: enoent });
  assert.equal(ce.kind, 'unknown');
  assert.equal(ce.httpStatus, null);
  assert.match(ce.message, /ENOENT/);
});

test('출력 상한 초과·그 밖의 값 → unknown', async () => {
  assert.equal(classifyCodexError(new CliOutputLimitError('stdout', 10)).kind, 'unknown');
  assert.equal(classifyCodexError('문자열').kind, 'unknown');
  assert.equal(classifyCodexError(undefined).kind, 'unknown');
  // 실행 함수가 결과 대신 last-message 없이 끝난 것(가짜 exited)도 어댑터 에러로 분류된다
  assert.equal((await classifyRun(exited('', 1))).kind, 'unknown');
});
