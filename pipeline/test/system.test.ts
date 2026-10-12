import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { createTerminalConfirm, isYes } from '../src/system/confirm.js';
import { createGitClient, type ExecFile } from '../src/system/git.js';
import { PlaceholderValidator } from '../src/validation/validator.js';

/* ───────── git (실제 git을 부르지 않고 실행 함수를 가짜로) ───────── */

function fakeExec(stdout: string): ExecFile & { calls: { file: string; args: readonly string[]; cwd: string }[] } {
  const calls: { file: string; args: readonly string[]; cwd: string }[] = [];
  const exec = async (file: string, args: readonly string[], opts: { cwd: string }) => {
    calls.push({ file, args, cwd: opts.cwd });
    return { stdout };
  };
  return Object.assign(exec, { calls });
}

test('git status: 레포 루트에서 --porcelain -- <경로…>로 부르고 출력을 그대로 돌려준다', async () => {
  const exec = fakeExec(' M pipeline/src/main.ts\n?? prompts/new.md\n');
  const git = createGitClient('/repo', exec);
  const out = await git.status(['packages', 'pipeline', 'prompts', 'models.json']);
  assert.equal(out, ' M pipeline/src/main.ts\n?? prompts/new.md\n');
  assert.deepEqual(exec.calls, [
    {
      file: 'git',
      args: ['status', '--porcelain', '--', 'packages', 'pipeline', 'prompts', 'models.json'],
      cwd: '/repo',
    },
  ]);
});

test('git head: rev-parse HEAD의 줄바꿈을 뗀다', async () => {
  const exec = fakeExec('0123456789abcdef0123456789abcdef01234567\n');
  const git = createGitClient('/repo', exec);
  assert.equal(await git.head(), '0123456789abcdef0123456789abcdef01234567');
  assert.deepEqual(exec.calls[0]?.args, ['rev-parse', 'HEAD']);
});

/* ───────── y/N 확인 ───────── */

test('isYes: y·yes만 승인 (대소문자·앞뒤 공백 무시), 그 밖은 모두 거절', () => {
  for (const a of ['y', 'Y', 'yes', ' YES ', 'y\n']) assert.equal(isYes(a), true, a);
  for (const a of ['', 'n', 'no', 'yy', 'ㅛ', 'sure']) assert.equal(isYes(a), false, a);
});

function streams() {
  const input = new PassThrough();
  const output = new PassThrough();
  let printed = '';
  output.on('data', (b: Buffer) => (printed += b.toString('utf8')));
  return { input, output, printed: () => printed };
}

test('터미널 확인: 질문 뒤에 [y/N]을 붙이고, y를 입력하면 승인', async () => {
  const s = streams();
  const confirm = createTerminalConfirm(s.input, s.output);
  const answer = confirm('지울까요?');
  s.input.write('y\n');
  assert.equal(await answer, true);
  assert.match(s.printed(), /지울까요\? \[y\/N\] /);
});

test('터미널 확인: 그냥 Enter는 거절', async () => {
  const s = streams();
  const answer = createTerminalConfirm(s.input, s.output)('지울까요?');
  s.input.write('\n');
  assert.equal(await answer, false);
});

test('터미널 확인: 입력이 끝나면(EOF) 거절', async () => {
  const s = streams();
  const answer = createTerminalConfirm(s.input, s.output)('지울까요?');
  s.input.end();
  assert.equal(await answer, false);
});

/* ───────── 검증기 자리표시 (phase 2가 Playwright 검증기로 바꾼다) ───────── */

test('PlaceholderValidator: 아무것도 하지 않고 "검증기 없음 — validation은 null로 남는다"를 알린다', async () => {
  const lines: string[] = [];
  const validator = new PlaceholderValidator({ log: (l) => void lines.push(l), error: (l) => void lines.push(l) });
  await validator.validate('gemini-3-8-flash');
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /gemini-3-8-flash/);
  assert.match(lines[0]!, /검증기 없음 — validation은 null로 남는다/);
});
