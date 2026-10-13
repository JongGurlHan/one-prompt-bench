import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { FORBIDDEN_ENV_KEYS, cliEnv, findOnPath, withTempDir } from '../src/system/cli.js';

/* ───────── cliEnv ───────── */

test('cliEnv: API 키 변수(FORBIDDEN_ENV_KEYS)를 지운다', () => {
  assert.deepEqual([...FORBIDDEN_ENV_KEYS], ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY']);
  const env = cliEnv({ ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'o', PATH: '/bin' });
  assert.deepEqual(env, { PATH: '/bin' });
});

test('cliEnv: Claude Code 세션이 물려준 변수를 지운다', () => {
  const env = cliEnv({
    CLAUDECODE: '1',
    CLAUDE_CODE_ENTRYPOINT: 'cli',
    CLAUDE_CODE_SESSION_ID: 's',
    CLAUDE_CODE_CHILD_SESSION: '1',
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: '32000',
    CLAUDE_EFFORT: 'max',
    CLAUDE_PID: '42',
    AI_AGENT: 'claude-code',
    HOME: '/home/me',
  });
  assert.deepEqual(env, { HOME: '/home/me' });
});

test('cliEnv: 사용자 설정 변수(CLAUDE_CONFIG_DIR·CLAUDE_CODE_GIT_BASH_PATH)와 비슷한 이름의 다른 변수는 남긴다', () => {
  const base = {
    CLAUDE_CONFIG_DIR: 'C:/me/.claude',
    CLAUDE_CODE_GIT_BASH_PATH: 'C:/Git/bin/bash.exe',
    CLAUDE: 'x',
    CLAUDECODE_NOTES: 'y',
    MY_ANTHROPIC_API_KEY_HINT: 'z',
    AI_AGENT_NAME: 'w',
  };
  assert.deepEqual(cliEnv(base), base);
});

test('cliEnv: 값이 undefined인 항목은 뺀다', () => {
  assert.deepEqual(cliEnv({ A: '1', B: undefined, C: '' }), { A: '1', C: '' });
});

test('cliEnv: 지운 뒤에 set을 덮어쓴다 (세션 변수 이름이어도 set이 넣으면 들어간다)', () => {
  const env = cliEnv({ A: '1', CLAUDE_CODE_MAX_OUTPUT_TOKENS: '32000' }, { A: '2', CLAUDE_CODE_MAX_OUTPUT_TOKENS: '65536' });
  assert.deepEqual(env, { A: '2', CLAUDE_CODE_MAX_OUTPUT_TOKENS: '65536' });
});

test('cliEnv: 이름 비교는 대소문자를 무시한다 (Windows 환경변수)', () => {
  const env = cliEnv({
    Anthropic_Api_Key: 'a',
    openai_api_key: 'o',
    ClaudeCode: '1',
    claude_code_entrypoint: 'cli',
    Claude_Effort: 'max',
    claude_pid: '1',
    Ai_Agent: 'x',
    claude_code_git_bash_path: 'C:/Git/bin/bash.exe',
    Path: 'C:\\Windows',
  });
  assert.deepEqual(env, { claude_code_git_bash_path: 'C:/Git/bin/bash.exe', Path: 'C:\\Windows' });
});

test('cliEnv: set은 대소문자만 다른 기존 항목을 대신한다 (같은 변수가 두 번 들어가지 않는다)', () => {
  const env = cliEnv({ Path: 'C:\\old', Other: '1' }, { PATH: 'C:\\new' });
  assert.deepEqual(env, { Other: '1', PATH: 'C:\\new' });
});

test('cliEnv: set으로 API 키 변수를 넣으려 하면 throw한다', () => {
  assert.throws(() => cliEnv({}, { ANTHROPIC_API_KEY: 'x' }), /ANTHROPIC_API_KEY/);
  assert.throws(() => cliEnv({}, { openai_api_key: 'x' }), /openai_api_key/);
});

test('cliEnv: base를 바꾸지 않는다', () => {
  const base = { ANTHROPIC_API_KEY: 'a', A: '1' };
  cliEnv(base, { A: '2' });
  assert.deepEqual(base, { ANTHROPIC_API_KEY: 'a', A: '1' });
});

/* ───────── findOnPath ───────── */

function scratch(t: { after(fn: () => void): void }): (...parts: string[]) => string {
  const root = mkdtempSync(path.join(tmpdir(), 'opb-findonpath-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return (...parts) => path.join(root, ...parts);
}

function touch(file: string, mode = 0o755): string {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, '');
  chmodSync(file, mode);
  return file;
}

test('findOnPath (win32): PATH(대소문자 무관한 키)의 디렉토리 순서 → PATHEXT 순서로 찾는다', (t) => {
  const p = scratch(t);
  mkdirSync(p('empty'), { recursive: true });
  touch(p('a', 'fake-tool.CMD'));
  touch(p('b', 'fake-tool.EXE'));
  touch(p('b', 'fake-tool.CMD'));
  const opts = (dirs: string[]) => ({ platform: 'win32' as const, env: { Path: dirs.join(';'), PATHEXT: '.EXE;.CMD' } });

  assert.equal(findOnPath('fake-tool', opts([p('empty'), p('a'), p('b')])), p('a', 'fake-tool.CMD'));
  assert.equal(findOnPath('fake-tool', opts([p('empty'), p('b'), p('a')])), p('b', 'fake-tool.EXE'));
  assert.equal(findOnPath('other-tool', opts([p('a'), p('b')])), null);
});

test('findOnPath (win32): 이미 PATHEXT 확장자가 붙은 이름은 그대로 찾고, 빈 항목·따옴표 항목·같은 이름의 폴더를 처리한다', (t) => {
  const p = scratch(t);
  touch(p('a', 'fake-tool.CMD'));
  mkdirSync(p('dir', 'fake-tool.EXE'), { recursive: true }); // 폴더는 실행 파일이 아니다
  const env = { PATH: `;"${p('dir')}";;"${p('a')}";`, PATHEXT: '.EXE;.CMD' };
  assert.equal(findOnPath('fake-tool', { platform: 'win32', env }), p('a', 'fake-tool.CMD'));
  assert.equal(findOnPath('fake-tool.CMD', { platform: 'win32', env }), p('a', 'fake-tool.CMD'));
  assert.equal(findOnPath('fake-tool.EXE', { platform: 'win32', env }), null);
});

test('findOnPath (win32): PATHEXT가 없으면 기본 확장자(.COM;.EXE;.BAT;.CMD)를 쓴다', (t) => {
  const p = scratch(t);
  touch(p('a', 'fake-tool.CMD'));
  assert.equal(findOnPath('fake-tool', { platform: 'win32', env: { PATH: p('a') } }), p('a', 'fake-tool.CMD'));
});

test('findOnPath: PATH가 없으면 null', () => {
  assert.equal(findOnPath('node', { platform: 'win32', env: {} }), null);
  assert.equal(findOnPath('node', { platform: 'linux', env: {} }), null);
});

test('findOnPath (POSIX): PATH(:)에서 실행 권한이 있는 파일만 찾는다', { skip: process.platform === 'win32' && 'POSIX 실행 권한·경로 구분자는 POSIX에서만' }, (t) => {
  const p = scratch(t);
  touch(p('a', 'fake-tool'), 0o644);
  touch(p('b', 'fake-tool'), 0o755);
  mkdirSync(p('c', 'other-tool'), { recursive: true });
  const env = { PATH: [p('a'), p('c'), p('b')].join(':') };
  assert.equal(findOnPath('fake-tool', { platform: 'linux', env }), p('b', 'fake-tool'));
  assert.equal(findOnPath('other-tool', { platform: 'linux', env }), null);
  assert.equal(findOnPath('fake-tool', { platform: 'linux', env: { Path: p('b') } }), null, 'POSIX의 변수 이름은 PATH 그대로');
});

test('findOnPath: 기본값은 현재 프로세스의 PATH·플랫폼이다 (node를 찾는다)', () => {
  const found = findOnPath('node');
  assert.ok(found !== null, 'PATH에서 node를 찾아야 한다');
  assert.ok(existsSync(found));
});

/* ───────── withTempDir ───────── */

test('withTempDir: OS 임시 디렉토리에 빈 폴더를 주고, 끝나면 안의 파일까지 지운다', async () => {
  let seen = '';
  const value = await withTempDir('opb-withtemp-', async (dir) => {
    seen = dir;
    assert.equal(path.dirname(dir), tmpdir());
    assert.match(path.basename(dir), /^opb-withtemp-/);
    assert.deepEqual(readdirSync(dir), []);
    mkdirSync(path.join(dir, 'sub'));
    writeFileSync(path.join(dir, 'sub', 'out.txt'), '결과');
    return 42;
  });
  assert.equal(value, 42);
  assert.equal(existsSync(seen), false);
});

test('withTempDir: 부를 때마다 다른 폴더다', async () => {
  const dirs = await Promise.all([1, 2].map(() => withTempDir('opb-withtemp-', async (dir) => dir)));
  assert.notEqual(dirs[0], dirs[1]);
});

test('withTempDir: fn이 throw해도 폴더를 지우고 같은 에러를 다시 던진다', async () => {
  let seen = '';
  const boom = new Error('boom');
  await assert.rejects(
    withTempDir('opb-withtemp-', async (dir) => {
      seen = dir;
      writeFileSync(path.join(dir, 'partial.txt'), 'x');
      throw boom;
    }),
    (err) => err === boom,
  );
  assert.ok(seen !== '');
  assert.equal(existsSync(seen), false);
});
