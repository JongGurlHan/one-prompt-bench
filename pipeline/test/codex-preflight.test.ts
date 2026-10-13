import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { CodexCommand } from '../src/adapters/codex/codex.bin.js';
import { codexLoginPreflight } from '../src/adapters/codex/codex.preflight.js';
import { formatPreflight, type PreflightCheck } from '../src/generation/preflight.js';
import { CliAbortError } from '../src/system/cli.js';
import { exited, fakeRunCli, type FakeRun } from './claude-code-fakes.js';
import { CODEX_PARENT_ENV, FAKE_CODEX_COMMAND, loadLoginStatus, loginStatus } from './codex-fakes.js';

/* ───────── codex login status로 ChatGPT 로그인을 점검 (가짜 실행 함수, 실제 codex 없음) ───────── */

/** fixture의 가린 키 조각·지어낸 계정 정보. preflight 출력 어디에도 나오면 안 된다 */
const SECRET_VALUES = ['sk-fake0', 'FAKE9', '***', 'user@example.com', 'acct_0000', 'secret-profile', '.codex'];

async function check(step: FakeRun, resolveCommand: () => CodexCommand = () => FAKE_CODEX_COMMAND) {
  const run = fakeRunCli([step]);
  const checks = await codexLoginPreflight({ runCli: run, resolveCommand, env: CODEX_PARENT_ENV });
  return { checks, run };
}

function assertNoSecrets(checks: PreflightCheck[]): void {
  const text = `${formatPreflight(checks)}\n${JSON.stringify(checks)}`;
  for (const value of SECRET_VALUES) assert.ok(!text.includes(value), `${value}가 출력에 있다`);
}

function failed(checks: PreflightCheck[]): string {
  assert.equal(checks.length, 1);
  assert.equal(checks[0]?.ok, false, checks[0]?.detail ?? '');
  assert.match(checks[0]?.name ?? '', /^Codex 로그인 \(codex login status\)$/);
  return checks[0]?.detail ?? '';
}

test('stderr가 Logged in using ChatGPT이고 exit 0이면 통과', async () => {
  const { checks, run } = await check(loginStatus(await loadLoginStatus('chatgpt')));

  assert.equal(checks.length, 1);
  const [c] = checks;
  assert.equal(c?.ok, true, c?.detail ?? '');
  assert.equal(c?.name, 'Codex 로그인 (codex login status)');
  assert.match(c?.detail ?? '', /ChatGPT/);

  // 호출: 같은 실행 명령(node + codex.js), login status, 빈 stdin, 정리한 환경, OS 임시 폴더, 시간 제한
  assert.equal(run.requests.length, 1);
  const r = run.requests[0]!;
  assert.equal(r.bin, FAKE_CODEX_COMMAND.bin);
  assert.deepEqual(r.args, [...FAKE_CODEX_COMMAND.prefixArgs, 'login', 'status']);
  assert.equal(r.stdin, '');
  for (const name of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'CLAUDECODE', 'CLAUDE_CODE_SESSION_ID']) {
    assert.equal(r.env[name], undefined, name);
  }
  assert.equal(r.env.CODEX_HOME, CODEX_PARENT_ENV.CODEX_HOME, 'CODEX_HOME(인증 폴더)은 바꾸지 않고 그대로 넘긴다');
  const rel = path.relative(tmpdir(), r.cwd);
  assert.ok(!rel.startsWith('..') && !path.isAbsolute(rel), `OS 임시 폴더: ${r.cwd}`);
  assert.ok(r.signal, '매달리지 않게 시간 제한 signal을 준다');
});

test('Windows 줄바꿈(CRLF)이어도 통과. stderr가 비어 있으면 stdout을 본다', async () => {
  assert.equal((await check(loginStatus('Logged in using ChatGPT\r\n'))).checks[0]?.ok, true);
  assert.equal((await check(exited('Logged in using ChatGPT\n', 0, ''))).checks[0]?.ok, true);
  assert.equal((await check(exited('Logged in using ChatGPT\n', 0, '  \n'))).checks[0]?.ok, true);
});

test('ChatGPT 문구라도 exit code가 0이 아니면 실패', async () => {
  const detail = failed((await check(loginStatus(await loadLoginStatus('chatgpt'), 1))).checks);
  assert.match(detail, /exit code 1/);
});

test('결과는 첫 줄만 본다: 정확히 그 문구일 때만 통과 (뒤에 무엇이 붙거나 앞에 다른 줄이 있으면 실패)', async () => {
  assert.equal((await check(loginStatus('Logged in using ChatGPT\nnote\n'))).checks[0]?.ok, true);
  assert.equal((await check(loginStatus('warning: something\nLogged in using ChatGPT\n'))).checks[0]?.ok, false);
  assert.equal((await check(loginStatus('Logged in using ChatGPT (user@example.com)\n'))).checks[0]?.ok, false);
  assert.equal((await check(loginStatus(''))).checks[0]?.ok, false, '빈 출력');
});

test('API 키 로그인이면 실패: 요금이 청구될 수 있다고 알리고 codex logout → codex login을 안내한다. 가린 키는 쓰지 않는다', async () => {
  const { checks } = await check(loginStatus(await loadLoginStatus('api-key')));
  const detail = failed(checks);
  assert.match(detail, /API 키/);
  assert.match(detail, /요금/);
  assert.match(detail, /codex logout/);
  assert.match(detail, /codex login/);
  assert.match(detail, /ChatGPT/);
  assertNoSecrets(checks);
});

test('Not logged in이면 실패하고 ChatGPT 로그인을 안내한다 (exit code와 관계없이)', async () => {
  for (const exitCode of [1, 0]) {
    const { checks } = await check(loginStatus(await loadLoginStatus('not-logged-in'), exitCode));
    const detail = failed(checks);
    assert.match(detail, /로그인되어 있지 않습니다/);
    assert.match(detail, /codex login/);
    assert.doesNotMatch(detail, /실행하지 못했/);
  }
});

test('그 밖의 Logged in using …이면 실패하고 인증 방식 이름만 보여 준다 (뒤의 값·계정처럼 보이는 값은 쓰지 않는다)', async () => {
  const access = failed((await check(loginStatus('Logged in using access token\n'))).checks);
  assert.match(access, /access token/);
  assert.match(access, /ChatGPT/);

  const pat = failed((await check(loginStatus('Logged in using personal access token - pat-***FAKE9\n'))).checks);
  assert.match(pat, /personal access token/);

  const bedrock = await check(loginStatus('Logged in using Amazon Bedrock (profile: secret-profile, region us-east-1)\n'));
  assert.match(failed(bedrock.checks), /Amazon Bedrock/);

  for (const line of [
    'Logged in using user@example.com\n',
    'Logged in using an API key - sk-fake0***FAKE9 (acct_0000)\n',
    'Logged in using acct_0000\n',
  ]) {
    const { checks } = await check(loginStatus(line));
    failed(checks);
    assertNoSecrets(checks);
  }
  for (const sample of [access, pat]) assert.doesNotMatch(sample, /FAKE9|\*\*\*/);
  assertNoSecrets(bedrock.checks);
});

test('모르는 출력은 내용을 옮기지 않고 일반 안내만 쓴다 (exit code는 쓴다)', async () => {
  const { checks } = await check(
    loginStatus('Error checking login status: failed to read /home/user/.codex/auth.json for acct_0000 user@example.com\n', 1),
  );
  const detail = failed(checks);
  assert.match(detail, /exit code 1/);
  assert.match(detail, /codex login status/);
  assertNoSecrets(checks);
});

test('실행이 실패하면(ENOENT·시간 초과) throw하지 않고 실패 항목으로 돌려준다', async () => {
  const enoent = Object.assign(new Error(`spawn ${FAKE_CODEX_COMMAND.bin} ENOENT`), { code: 'ENOENT' });
  assert.match(failed((await check({ reject: enoent })).checks), /ENOENT/);

  const timeout = failed((await check({ reject: new CliAbortError(new Error('timeout')) })).checks);
  assert.match(timeout, /30초/);
});

test('실행 명령을 못 찾으면 실행하지 않고 그 사유로 실패', async () => {
  const { checks, run } = await check(loginStatus('Logged in using ChatGPT\n'), () => {
    throw new Error('codex 실행 파일을 PATH에서 찾지 못했습니다');
  });
  assert.equal(run.requests.length, 0);
  assert.match(failed(checks), /PATH에서 찾지 못했습니다/);
});
