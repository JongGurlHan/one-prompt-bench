import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { parseCodexVersion, readCodexVersion, resolveCodexCommand } from '../src/adapters/codex/codex.bin.js';
import type { RunSync } from '../src/system/cli.js';
import { CODEX_PARENT_ENV, FAKE_CODEX_COMMAND } from './codex-fakes.js';

/* ───────── codex 실행 명령 찾기·버전 읽기 (실제 codex를 띄우지 않는다: PATH는 임시 폴더, 실행은 가짜) ───────── */

const roots: string[] = [];
after(async () => {
  await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'opb-codex-bin-'));
  roots.push(dir);
  return dir;
}

async function touch(file: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, '', { mode: 0o755 });
}

/** Windows처럼 찾는다(PATH는 ;, PATHEXT). 다른 OS의 CI에서도 같은 결과가 나오게 platform을 고정한다 */
const windows = (dir: string) => ({ env: { PATH: dir, PATHEXT: '.COM;.EXE;.BAT;.CMD' }, platform: 'win32' as const });
const JS_BESIDE_SHIM = ['node_modules', '@openai', 'codex', 'bin', 'codex.js'];
const NODE = '/fake/node/node.exe';

/* ───────── 실행 명령 ───────── */

test('Windows: .cmd shim 옆에 codex.js가 있으면 node + codex.js (확장자 대소문자 무시)', async () => {
  const dir = await tempDir();
  await touch(path.join(dir, 'codex.CMD')); // findOnPath는 PATHEXT 표기(대문자) 그대로 돌려준다
  const script = path.join(dir, ...JS_BESIDE_SHIM);
  await touch(script);

  assert.deepEqual(resolveCodexCommand({ ...windows(dir), nodePath: NODE }), { bin: NODE, prefixArgs: [script] });
});

test('Windows: nodePath를 주지 않으면 지금 실행 중인 Node(process.execPath)로 띄운다', async () => {
  const dir = await tempDir();
  // PATHEXT 표기(대문자) 그대로 만든다 — 리눅스 CI는 파일 이름의 대소문자를 구분한다
  await touch(path.join(dir, 'codex.CMD'));
  const script = path.join(dir, ...JS_BESIDE_SHIM);
  await touch(script);

  assert.deepEqual(resolveCodexCommand(windows(dir)), { bin: process.execPath, prefixArgs: [script] });
});

test('Windows: .bat shim도 shim으로 본다', async () => {
  const dir = await tempDir();
  await touch(path.join(dir, 'codex.BAT'));
  const script = path.join(dir, ...JS_BESIDE_SHIM);
  await touch(script);

  assert.deepEqual(resolveCodexCommand({ ...windows(dir), nodePath: NODE }), { bin: NODE, prefixArgs: [script] });
});

test('Windows: shim 옆에 codex.js가 없으면 사람이 읽을 에러로 멈춘다 (shell 없이 shim을 띄울 수 없다)', async () => {
  const dir = await tempDir();
  await touch(path.join(dir, 'codex.CMD'));
  assert.throws(
    () => resolveCodexCommand({ ...windows(dir), nodePath: NODE }),
    (err: Error) => /codex\.js/.test(err.message) && err.message.includes(path.join(dir, ...JS_BESIDE_SHIM)),
  );
});

test('Windows: PATH에 codex.exe가 바로 있으면 그것을 그대로 쓴다', async () => {
  const dir = await tempDir();
  await touch(path.join(dir, 'codex.EXE'));
  assert.deepEqual(resolveCodexCommand({ ...windows(dir), nodePath: NODE }), { bin: path.join(dir, 'codex.EXE'), prefixArgs: [] });
});

test('PATH에 없으면 설치를 안내하는 에러로 멈춘다', async () => {
  const dir = await tempDir();
  assert.throws(() => resolveCodexCommand(windows(dir)), /PATH/);
  assert.throws(() => resolveCodexCommand({ env: {}, platform: 'linux' }), /PATH/);
});

test('POSIX: PATH의 실행 파일 codex를 그대로 띄운다', { skip: process.platform === 'win32' && 'POSIX 실행 권한 검사' }, async () => {
  const dir = await tempDir();
  await touch(path.join(dir, 'codex'));
  assert.deepEqual(resolveCodexCommand({ env: { PATH: dir }, platform: 'linux', nodePath: NODE }), {
    bin: path.join(dir, 'codex'),
    prefixArgs: [],
  });
});

/* ───────── 버전 ───────── */

test('parseCodexVersion: "codex-cli 0.157.1"의 숫자. 형식이 다르면 null', () => {
  assert.equal(parseCodexVersion('codex-cli 0.157.1\n'), '0.157.1');
  assert.equal(parseCodexVersion('codex-cli 0.157.1\r\n'), '0.157.1');
  assert.equal(parseCodexVersion('codex-cli 0.158.0-alpha.2'), '0.158.0-alpha.2');
  assert.equal(parseCodexVersion(''), null);
  assert.equal(parseCodexVersion('codex-cli'), null);
  assert.equal(parseCodexVersion('codex-cli 0.157'), null);
  assert.equal(parseCodexVersion('0.157.1'), null, '다른 프로그램의 숫자를 버전으로 읽지 않는다');
  assert.equal(parseCodexVersion('codex-cli v0.157.1'), null);
});

function fakeRunSync(result: ReturnType<RunSync>) {
  const calls: Parameters<RunSync>[] = [];
  const run: RunSync = (...args) => {
    calls.push(args);
    return result;
  };
  return { run, calls };
}

test('readCodexVersion: [...prefixArgs, --version]을 정리한 환경(API 키·세션 변수 없음, CODEX_HOME 유지)으로 실행해 버전을 읽는다', () => {
  const fake = fakeRunSync({ status: 0, stdout: 'codex-cli 0.157.1\n', stderr: '' });
  assert.equal(readCodexVersion(FAKE_CODEX_COMMAND, CODEX_PARENT_ENV, fake.run), '0.157.1');

  assert.equal(fake.calls.length, 1);
  const [bin, args, env] = fake.calls[0]!;
  assert.equal(bin, FAKE_CODEX_COMMAND.bin);
  assert.deepEqual(args, [...FAKE_CODEX_COMMAND.prefixArgs, '--version']);
  for (const name of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'CLAUDECODE', 'CLAUDE_CODE_SESSION_ID']) {
    assert.equal(env[name], undefined, name);
  }
  assert.equal(env.CODEX_HOME, CODEX_PARENT_ENV.CODEX_HOME);
  assert.equal(env.PATH, CODEX_PARENT_ENV.PATH);
});

test('readCodexVersion: 숫자를 못 읽거나 실행이 실패하면 에러로 멈춘다 (지어낸 버전을 기록하지 않는다)', () => {
  const posix = { bin: '/x/codex', prefixArgs: [] };
  assert.throws(() => readCodexVersion(posix, {}, fakeRunSync({ status: 0, stdout: 'codex\n', stderr: '' }).run), /버전/);
  assert.throws(() => readCodexVersion(posix, {}, fakeRunSync({ status: 1, stdout: '', stderr: 'boom' }).run), /exit code 1/);
  assert.throws(
    () =>
      readCodexVersion(
        posix,
        {},
        fakeRunSync({ status: null, stdout: '', stderr: '', error: Object.assign(new Error('spawnSync /x/codex ENOENT'), { code: 'ENOENT' }) }).run,
      ),
    /ENOENT/,
  );
});
