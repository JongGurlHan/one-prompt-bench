import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { claudeAuthPreflight } from '../src/adapters/claude-code/claude-code.preflight.js';
import { formatPreflight, type PreflightCheck } from '../src/generation/preflight.js';
import {
  FAKE_CLAUDE_BIN,
  PARENT_ENV,
  exited,
  fakeRunCli,
  loadAuthStatus,
  type FakeRun,
} from './claude-code-fakes.js';

/* ───────── claude auth status --json으로 구독 로그인을 점검 (가짜 실행 함수, 실제 claude 없음) ───────── */

/** fixture의 가짜 계정 정보. preflight 출력 어디에도 나오면 안 된다 */
const ACCOUNT_VALUES = ['user@example.com', '00000000-0000-4000-8000-00000000abcd', 'Example Org'];

async function check(step: FakeRun, resolveBin: () => string = () => FAKE_CLAUDE_BIN) {
  const run = fakeRunCli([step]);
  const checks = await claudeAuthPreflight({ runCli: run, resolveBin, env: PARENT_ENV });
  return { checks, run };
}

function assertNoAccountInfo(checks: PreflightCheck[]): void {
  const text = `${formatPreflight(checks)}\n${JSON.stringify(checks)}`;
  for (const value of ACCOUNT_VALUES) assert.ok(!text.includes(value), `계정 정보 ${value}가 출력에 있다`);
}

test('claude.ai 구독 로그인(loggedIn·authMethod claude.ai·apiProvider firstParty)이면 통과, detail은 authMethod·subscriptionType만', async () => {
  const { checks, run } = await check(exited(await loadAuthStatus('claude-ai')));

  assert.equal(checks.length, 1);
  const [c] = checks;
  assert.equal(c?.ok, true);
  assert.match(c?.name ?? '', /claude auth status/);
  assert.match(c?.detail ?? '', /authMethod: claude\.ai/);
  assert.match(c?.detail ?? '', /subscriptionType: pro/);
  assertNoAccountInfo(checks);

  // 호출: 같은 실행 파일, auth status --json, 정리한 환경, OS 임시 폴더, 시간 제한
  assert.equal(run.requests.length, 1);
  const r = run.requests[0]!;
  assert.equal(r.bin, FAKE_CLAUDE_BIN);
  assert.deepEqual(r.args, ['auth', 'status', '--json']);
  assert.equal(r.stdin, '');
  for (const name of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'CLAUDECODE', 'CLAUDE_CODE_SESSION_ID']) {
    assert.equal(r.env[name], undefined, name);
  }
  const rel = path.relative(tmpdir(), r.cwd);
  assert.ok(!rel.startsWith('..') && !path.isAbsolute(rel), `OS 임시 폴더: ${r.cwd}`);
  assert.ok(r.signal, '매달리지 않게 시간 제한 signal을 준다');
});

test('authMethod가 claude.ai가 아니면 실패 (API 키 등은 과금된다) — authMethod 값은 보여 주고 계정 정보는 쓰지 않는다', async () => {
  const { checks } = await check(exited(await loadAuthStatus('other-method')));
  assert.equal(checks.length, 1);
  assert.equal(checks[0]?.ok, false);
  assert.match(checks[0]?.detail ?? '', /example-other-method/);
  assert.match(checks[0]?.detail ?? '', /claude\.ai/);
  assertNoAccountInfo(checks);
});

test('loggedIn이 false면 실패하고 로그인을 안내한다 (exit code가 0이 아니어도 JSON이면 읽는다)', async () => {
  for (const exitCode of [0, 1]) {
    const { checks } = await check(exited(await loadAuthStatus('logged-out'), exitCode));
    assert.equal(checks[0]?.ok, false);
    assert.match(checks[0]?.detail ?? '', /로그인/);
    assert.doesNotMatch(checks[0]?.detail ?? '', /실행하지 못했/);
  }
});

test('apiProvider가 firstParty가 아니면 실패 (Bedrock·Vertex 같은 다른 과금 경로)', async () => {
  const status = { ...(JSON.parse(await loadAuthStatus('claude-ai')) as object), apiProvider: 'bedrock' };
  const { checks } = await check(exited(JSON.stringify(status)));
  assert.equal(checks[0]?.ok, false);
  assert.match(checks[0]?.detail ?? '', /firstParty/);
  assertNoAccountInfo(checks);
});

test('실행이 실패하면(ENOENT·시간 초과) throw하지 않고 실패 항목으로 돌려준다', async () => {
  const enoent = Object.assign(new Error(`spawn ${FAKE_CLAUDE_BIN} ENOENT`), { code: 'ENOENT' });
  const { checks } = await check({ reject: enoent });
  assert.equal(checks.length, 1);
  assert.equal(checks[0]?.ok, false);
  assert.match(checks[0]?.detail ?? '', /ENOENT/);
});

test('실행 파일을 못 찾으면 실행하지 않고 그 사유로 실패', async () => {
  const { checks, run } = await check(exited('{}'), () => {
    throw new Error('claude 실행 파일을 PATH에서 찾지 못했습니다');
  });
  assert.equal(run.requests.length, 0);
  assert.equal(checks[0]?.ok, false);
  assert.match(checks[0]?.detail ?? '', /PATH에서 찾지 못했습니다/);
});

test('JSON이 아니면 실패 — stdout·stderr 내용(계정 정보가 섞일 수 있다)은 옮기지 않는다', async () => {
  const { checks } = await check(
    exited('Logged in as user@example.com (Example Org)\n', 0, 'org 00000000-0000-4000-8000-00000000abcd\n'),
  );
  assert.equal(checks[0]?.ok, false);
  assert.match(checks[0]?.detail ?? '', /JSON/);
  assertNoAccountInfo(checks);

  for (const stdout of ['[]', 'null', '{"authMethod":"claude.ai","apiProvider":"firstParty"}']) {
    const { checks: odd } = await check(exited(stdout));
    assert.equal(odd[0]?.ok, false, stdout);
  }
});

test('authMethod·subscriptionType 값이 계정 정보처럼 보이면(@ 등) 그대로 옮기지 않는다', async () => {
  const status = {
    loggedIn: true,
    authMethod: 'user@example.com',
    apiProvider: 'firstParty',
    subscriptionType: 'Example Org',
  };
  const { checks } = await check(exited(JSON.stringify(status)));
  assert.equal(checks[0]?.ok, false);
  assertNoAccountInfo(checks);
});
