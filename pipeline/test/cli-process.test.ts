import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { KILL_GRACE_MS, cliEnv, runCli, withTempDir, type CliRequest, type CliResult } from '../src/system/cli.js';

/* ────────────────────────────────────────────────────────────
 * runCli를 node 가짜 CLI(fixtures/cli/fake-cli.mjs)로 실제로 띄워 확인한다. 실제 생성 도구는 띄우지 않는다.
 * ──────────────────────────────────────────────────────────── */

const FAKE_CLI = fileURLToPath(new URL('./fixtures/cli/fake-cli.mjs', import.meta.url));

function fake(mode: string, cwd: string, overrides: Partial<CliRequest> = {}): CliRequest {
  const { args = [], ...rest } = overrides;
  return { bin: process.execPath, args: [FAKE_CLI, mode, ...args], stdin: '', cwd, env: cliEnv(process.env), ...rest };
}

/** 성공·실패를 값으로 받아 둔다 (기다리는 동안 처리되지 않은 rejection이 생기지 않게) */
function settle(p: Promise<CliResult>): Promise<{ result: CliResult } | { error: unknown }> {
  return p.then(
    (result) => ({ result }),
    (error: unknown) => ({ error }),
  );
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw err;
  }
}

async function waitFor<T>(what: string, check: () => T | undefined, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = check();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`${what}: ${timeoutMs}ms 안에 오지 않았다`);
    await delay(25);
  }
}

function readPids(dir: string): { child: number; grandchild: number } | undefined {
  const file = path.join(dir, 'pids.json');
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as { child: number; grandchild: number }) : undefined;
}

function killQuietly(pids: readonly number[]): void {
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // 이미 끝남
    }
  }
}

/* ───────── 입출력 ───────── */

test('runCli: stdin을 UTF-8로 넘기고 stdout을 그대로 돌려준다 (한글·줄바꿈·수백 KB, 청크 경계에서 깨지지 않음)', async () => {
  await withTempDir('opb-cli-test-', async (dir) => {
    const line = '사계절이 바뀌는 3D 나무 🌳 — 봄·여름·가을·겨울\r\n';
    const input = line.repeat(Math.ceil(600_000 / Buffer.byteLength(line)));
    const r = await runCli(fake('echo', dir, { stdin: input }));
    assert.equal(r.exitCode, 0);
    assert.equal(r.signal, null);
    assert.equal(r.stdout.length, input.length);
    assert.ok(r.stdout === input, 'stdout이 stdin과 같다');
    assert.equal(r.stderr, '');
  });
});

test('runCli: 인자를 shell 없이 배열 그대로 넘긴다 (빈 문자열·한글·공백·따옴표)', async () => {
  await withTempDir('opb-cli-test-', async (dir) => {
    const args = ['--tools', '', '한글 인자 하나', 'a "quoted" b', "it's", '%PATH%', '$HOME', 'a&b|c'];
    const r = await runCli(fake('args', dir, { args }));
    assert.deepEqual(JSON.parse(r.stdout), args);
  });
});

test('runCli: 0이 아닌 exit code는 예외가 아니다 — stdout·stderr(한글)와 함께 돌려준다', async () => {
  await withTempDir('opb-cli-test-', async (dir) => {
    const r = await runCli(fake('exit', dir, { args: ['3', '{"is_error":true}', '에러: 한도 초과\n'] }));
    assert.deepEqual(r, { exitCode: 3, signal: null, stdout: '{"is_error":true}', stderr: '에러: 한도 초과\n' });
  });
});

test('runCli: 자식이 stdin을 읽지 않고 먼저 끝나도(EPIPE) 실패가 아니다', async () => {
  await withTempDir('opb-cli-test-', async (dir) => {
    const r = await runCli(fake('no-stdin', dir, { stdin: 'x'.repeat(8 * 1024 * 1024) }));
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, 'done');
  });
});

test('runCli: cwd에서 실행한다', async () => {
  await withTempDir('opb-cli-test-', async (dir) => {
    const r = await runCli(fake('cwd', dir));
    assert.equal(realpathSync.native(r.stdout), realpathSync.native(dir));
  });
});

/* ───────── 환경 ───────── */

/** Windows의 libuv는 env에 없으면 부모 환경에서 이 변수들을 채워 넣는다 (src/win/process.c required_vars) */
const LIBUV_WINDOWS_REQUIRED = new Set([
  'HOMEDRIVE',
  'HOMEPATH',
  'LOGONSERVER',
  'PATH',
  'SYSTEMDRIVE',
  'SYSTEMROOT',
  'TEMP',
  'USERDOMAIN',
  'USERNAME',
  'USERPROFILE',
  'WINDIR',
]);

test('runCli: env로 준 변수만 자식에게 간다 (process.env를 섞지 않는다)', async () => {
  await withTempDir('opb-cli-test-', async (dir) => {
    const r = await runCli(fake('env', dir, { env: { OPB_ONLY_THIS: '1' } }));
    const names = JSON.parse(r.stdout) as string[];
    assert.ok(names.includes('OPB_ONLY_THIS'));
    const extra = names.filter((n) => n !== 'OPB_ONLY_THIS');
    if (process.platform === 'win32') {
      assert.deepEqual(extra.filter((n) => !LIBUV_WINDOWS_REQUIRED.has(n.toUpperCase())), []);
    } else {
      assert.deepEqual(extra, []);
    }
  });
});

test('runCli + cliEnv: API 키·Claude Code 세션 변수는 자식에게 가지 않고, 덮어쓴 값과 사용자 설정 변수는 간다', async () => {
  await withTempDir('opb-cli-test-', async (dir) => {
    const base = {
      ...process.env,
      ANTHROPIC_API_KEY: 'fake-anthropic',
      openai_api_key: 'fake-openai',
      CLAUDECODE: '1',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      CLAUDE_EFFORT: 'max',
      CLAUDE_PID: '123',
      AI_AGENT: 'claude-code',
      CLAUDE_CONFIG_DIR: 'C:/fake/.claude',
      CLAUDE_CODE_GIT_BASH_PATH: 'C:/fake/bash.exe',
    };
    const r = await runCli(fake('env', dir, { env: cliEnv(base, { CLAUDE_CODE_MAX_OUTPUT_TOKENS: '65536' }) }));
    const names = new Set((JSON.parse(r.stdout) as string[]).map((n) => n.toUpperCase()));
    for (const gone of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_EFFORT', 'CLAUDE_PID', 'AI_AGENT']) {
      assert.equal(names.has(gone), false, `${gone}가 자식에게 갔다`);
    }
    for (const kept of ['CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_GIT_BASH_PATH', 'CLAUDE_CODE_MAX_OUTPUT_TOKENS']) {
      assert.equal(names.has(kept), true, `${kept}가 자식에게 가지 않았다`);
    }
  });
});

/* ───────── 실패 ───────── */

test('runCli: 실행 파일이 없으면 spawn 에러(code ENOENT)로 reject', async () => {
  await withTempDir('opb-cli-test-', async (dir) => {
    const bin = path.join(tmpdir(), `opb-no-such-cli-${process.pid}.exe`);
    await assert.rejects(runCli({ bin, args: [], stdin: 'x', cwd: dir, env: cliEnv(process.env) }), (err: NodeJS.ErrnoException) => {
      assert.equal(err.code, 'ENOENT');
      return true;
    });
  });
});

test('runCli: 이미 abort된 signal이면 띄우지 않고 AbortError로 reject (없는 실행 파일이어도 ENOENT가 아니다)', async () => {
  await withTempDir('opb-cli-test-', async (dir) => {
    const ac = new AbortController();
    const reason = new Error('timeout after 1ms');
    ac.abort(reason);
    const bin = path.join(tmpdir(), `opb-no-such-cli-${process.pid}.exe`);
    await assert.rejects(runCli({ bin, args: [], stdin: '', cwd: dir, env: {}, signal: ac.signal }), (err: Error) => {
      assert.equal(err.name, 'AbortError');
      assert.equal(err.cause, reason);
      return true;
    });
  });
});

test('runCli: 출력이 상한을 넘으면 프로세스를 끝내고 reject한다', { timeout: 20_000 }, async () => {
  await withTempDir('opb-cli-test-', async (dir) => {
    const started = Date.now();
    await assert.rejects(runCli(fake('flood', dir, { args: ['300000'], maxOutputBytes: 100_000 })), (err: Error & { code?: string }) => {
      assert.equal(err.name, 'CliOutputLimitError');
      assert.match(err.message, /stdout/);
      return true;
    });
    assert.ok(Date.now() - started < 10_000);
  });
});

/* ───────── abort: 프로세스 트리 종료 ───────── */

test('runCli: 도중에 abort되면 자식·손자를 모두 종료하고 AbortError로 reject한다 (매달리지 않는다)', { timeout: 30_000 }, async () => {
  const pids: number[] = [];
  try {
    await withTempDir('opb-cli-test-', async (dir) => {
      const ac = new AbortController();
      const outcome = settle(runCli(fake('tree', dir, { signal: ac.signal })));
      const p = await waitFor('pids.json', () => readPids(dir));
      pids.push(p.child, p.grandchild);
      assert.ok(isAlive(p.child) && isAlive(p.grandchild), 'abort 전에는 둘 다 살아 있다');

      const reason = new Error('timeout after 5ms');
      const abortedAt = Date.now();
      ac.abort(reason);
      const o = await outcome;
      assert.ok(Date.now() - abortedAt < 5_000, `abort 후 ${Date.now() - abortedAt}ms`);
      assert.ok('error' in o, 'reject되어야 한다');
      assert.equal((o.error as Error).name, 'AbortError');
      assert.equal((o.error as Error).cause, reason);

      await waitFor('자식·손자 종료', () => (isAlive(p.child) || isAlive(p.grandchild) ? undefined : true), 3_000);
    });
  } finally {
    killQuietly(pids);
  }
});

test('runCli: 트리 밖으로 빠져나간 손자가 출력 파이프를 쥐고 있어도 abort 뒤 유예 시간 안에 reject한다', { timeout: 30_000 }, async () => {
  const pids: number[] = [];
  try {
    await withTempDir('opb-cli-test-', async (dir) => {
      const ac = new AbortController();
      const outcome = settle(runCli(fake('escape', dir, { signal: ac.signal })));
      const p = await waitFor('pids.json', () => readPids(dir));
      pids.push(p.child, p.grandchild);
      await waitFor('자식 종료', () => (isAlive(p.child) ? undefined : true));

      const abortedAt = Date.now();
      ac.abort(new Error('timeout'));
      const o = await outcome;
      assert.ok(Date.now() - abortedAt < KILL_GRACE_MS + 3_000, `abort 후 ${Date.now() - abortedAt}ms`);
      assert.ok('error' in o, 'reject되어야 한다');
      assert.equal((o.error as Error).name, 'AbortError');

      // 손자의 cwd가 이 폴더라 Windows에서는 손자가 끝나야 지울 수 있다
      killQuietly(pids);
      await waitFor('손자 종료', () => (isAlive(p.grandchild) ? undefined : true), 3_000);
    });
  } finally {
    killQuietly(pids);
  }
});
