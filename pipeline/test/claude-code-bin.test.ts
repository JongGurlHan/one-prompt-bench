import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { parseClaudeVersion, readClaudeVersion, resolveClaudeBin } from '../src/adapters/claude-code/claude-code.bin.js';
import type { RunSync } from '../src/system/cli.js';
import { PARENT_ENV } from './claude-code-fakes.js';

/* ───────── claude 실행 파일 찾기·버전 읽기 (실제 claude를 띄우지 않는다: PATH는 임시 폴더, 실행은 가짜) ───────── */

const roots: string[] = [];
after(async () => {
  await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'opb-claude-bin-'));
  roots.push(dir);
  return dir;
}

async function touch(file: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, '', { mode: 0o755 });
}

/** Windows처럼 찾는다(PATH는 ;, PATHEXT). 다른 OS의 CI에서도 같은 결과가 나오게 platform을 고정한다 */
const windows = (dir: string) => ({ env: { PATH: dir, PATHEXT: '.COM;.EXE;.BAT;.CMD' }, platform: 'win32' as const });
const EXE_BESIDE_SHIM = ['node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'];

/* ───────── 실행 파일 ───────── */

test('Windows: PATH에서 찾은 것이 .cmd shim이고 옆에 claude.exe가 있으면 exe를 쓴다 (확장자 대소문자 무시)', async () => {
  const dir = await tempDir();
  await touch(path.join(dir, 'claude.CMD')); // findOnPath는 PATHEXT 표기(대문자) 그대로 돌려준다
  const exe = path.join(dir, ...EXE_BESIDE_SHIM);
  await touch(exe);

  assert.equal(resolveClaudeBin(windows(dir)), exe);
});

test('Windows: .cmd shim 옆에 claude.exe가 없으면 사람이 읽을 에러로 멈춘다 (shell 없이 shim을 띄울 수 없다)', async () => {
  const dir = await tempDir();
  await touch(path.join(dir, 'claude.CMD'));
  assert.throws(
    () => resolveClaudeBin(windows(dir)),
    (err: Error) => /claude\.exe/.test(err.message) && err.message.includes(path.join(dir, ...EXE_BESIDE_SHIM)),
  );
});

test('Windows: PATH에 claude.exe가 바로 있으면 그것을 쓴다', async () => {
  const dir = await tempDir();
  await touch(path.join(dir, 'claude.EXE'));
  assert.equal(resolveClaudeBin(windows(dir)), path.join(dir, 'claude.EXE'));
});

test('PATH에 없으면 설치를 안내하는 에러로 멈춘다', async () => {
  const dir = await tempDir();
  assert.throws(() => resolveClaudeBin(windows(dir)), /PATH/);
  assert.throws(() => resolveClaudeBin({ env: {}, platform: 'linux' }), /PATH/);
});

test('POSIX: PATH의 실행 파일 claude를 그대로 쓴다', { skip: process.platform === 'win32' && 'POSIX 실행 권한 검사' }, async () => {
  const dir = await tempDir();
  await touch(path.join(dir, 'claude'));
  assert.equal(resolveClaudeBin({ env: { PATH: dir }, platform: 'linux' }), path.join(dir, 'claude'));
});

/* ───────── 버전 ───────── */

test('parseClaudeVersion: "2.1.296 (Claude Code)"의 앞 숫자. 숫자로 시작하지 않으면 null', () => {
  assert.equal(parseClaudeVersion('2.1.296 (Claude Code)\n'), '2.1.296');
  assert.equal(parseClaudeVersion('2.1.296\r\n'), '2.1.296');
  assert.equal(parseClaudeVersion('3.0.0-beta.1 (Claude Code)'), '3.0.0-beta.1');
  assert.equal(parseClaudeVersion(''), null);
  assert.equal(parseClaudeVersion('Claude Code'), null);
  assert.equal(parseClaudeVersion('v2.1'), null);
  assert.equal(parseClaudeVersion('2.1 (Claude Code)'), null);
});

function fakeRunSync(result: ReturnType<RunSync>) {
  const calls: Parameters<RunSync>[] = [];
  const run: RunSync = (...args) => {
    calls.push(args);
    return result;
  };
  return { run, calls };
}

test('readClaudeVersion: <bin> --version을 정리한 환경(API 키·세션 변수 없음)으로 실행해 버전을 읽는다', () => {
  const fake = fakeRunSync({ status: 0, stdout: '2.1.296 (Claude Code)\n', stderr: '' });
  assert.equal(readClaudeVersion('/x/claude.exe', PARENT_ENV, fake.run), '2.1.296');

  assert.equal(fake.calls.length, 1);
  const [bin, args, env] = fake.calls[0]!;
  assert.equal(bin, '/x/claude.exe');
  assert.deepEqual(args, ['--version']);
  for (const name of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'CLAUDECODE', 'CLAUDE_CODE_SESSION_ID']) {
    assert.equal(env[name], undefined, name);
  }
  assert.equal(env.PATH, PARENT_ENV.PATH);
});

test('readClaudeVersion: 숫자를 못 읽거나 실행이 실패하면 에러로 멈춘다 (지어낸 버전을 기록하지 않는다)', () => {
  assert.throws(
    () => readClaudeVersion('/x/claude', {}, fakeRunSync({ status: 0, stdout: 'Claude Code\n', stderr: '' }).run),
    /버전/,
  );
  assert.throws(() => readClaudeVersion('/x/claude', {}, fakeRunSync({ status: 1, stdout: '', stderr: 'boom' }).run), /exit code 1/);
  assert.throws(
    () =>
      readClaudeVersion(
        '/x/claude',
        {},
        fakeRunSync({ status: null, stdout: '', stderr: '', error: Object.assign(new Error('spawnSync /x/claude ENOENT'), { code: 'ENOENT' }) }).run,
      ),
    /ENOENT/,
  );
});
