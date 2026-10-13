import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  RAW_EXIT_FILE,
  RAW_STDERR_FILE,
  RAW_STDOUT_FILE,
  createClaudeCodeRecorder,
} from '../src/adapters/claude-code/claude-code.recorder.js';
import { RAW_FILE_NAME, type RawFile } from '../src/adapters/raw-recorder.js';
import type { CliRequest } from '../src/system/cli.js';
import { exited, fakeRunCli, loadFixture } from './claude-code-fakes.js';

/* ───────── smoke용 Claude Code 기록 래퍼: 실행 함수를 감싸 stdout·stderr·exit 정보를 그대로 모은다 ───────── */

const SECRET = 'secret-value-0123456789';
const redact = (text: string) => text.split(SECRET).join('***');

const request: CliRequest = { bin: '/fake/claude', args: ['-p'], stdin: 'Hello', cwd: '/tmp/x', env: { PATH: '/bin' } };

const fileNamed = (files: RawFile[], name: string) => files.find((f) => f.name === name);

test('정상: 요청·결과를 바꾸지 않고 넘기며 raw-stdout.txt(그대로)·raw-stderr.txt·raw-exit.json을 낸다', async () => {
  const stdout = await loadFixture('stdout-ok.json');
  const inner = fakeRunCli([exited(stdout, 0, 'warn\n')]);
  const recorder = createClaudeCodeRecorder(redact);

  const result = await recorder.wrap(inner)(request);

  assert.deepEqual(result, exited(stdout, 0, 'warn\n'));
  assert.deepEqual(inner.requests, [request]);
  const files = recorder.files();
  assert.deepEqual(files.map((f) => f.name).sort(), [RAW_EXIT_FILE, RAW_STDERR_FILE, RAW_STDOUT_FILE].sort());
  assert.ok(files.every((f) => RAW_FILE_NAME.test(f.name)));
  assert.equal(fileNamed(files, RAW_STDOUT_FILE)?.content, stdout, 'fixture로 그대로 복사할 수 있게 바이트까지 같다');
  assert.equal(fileNamed(files, RAW_STDERR_FILE)?.content, 'warn\n');
  assert.deepEqual(JSON.parse(fileNamed(files, RAW_EXIT_FILE)!.content), { exitCode: 0, signal: null });
});

test('stdout은 가리지 않는다(생성된 코드가 바뀌면 안 된다). stderr·exit 정보에는 redact를 적용한다', async () => {
  const inner = fakeRunCli([{ exitCode: 1, signal: `SIG${SECRET}`, stdout: `code ${SECRET}`, stderr: `oops ${SECRET}\n` }]);
  const recorder = createClaudeCodeRecorder(redact);
  await recorder.wrap(inner)(request);

  const files = recorder.files();
  assert.equal(fileNamed(files, RAW_STDOUT_FILE)?.content, `code ${SECRET}`);
  assert.equal(fileNamed(files, RAW_STDERR_FILE)?.content, 'oops ***\n');
  const exit = fileNamed(files, RAW_EXIT_FILE)!.content;
  assert.doesNotMatch(exit, new RegExp(SECRET));
  assert.deepEqual(JSON.parse(exit), { exitCode: 1, signal: 'SIG***' });
});

test('호출이 없었으면 파일이 없다', () => {
  assert.deepEqual(createClaudeCodeRecorder(redact).files(), []);
});

test('실행 함수가 던지면 같은 에러를 다시 던지고 raw-exit.json에 에러 이름·메시지만 남긴다 (redact 적용)', async () => {
  const enoent = Object.assign(new Error(`spawn /fake/claude ENOENT ${SECRET}`), { code: 'ENOENT' });
  const recorder = createClaudeCodeRecorder(redact);
  await assert.rejects(recorder.wrap(fakeRunCli([{ reject: enoent }]))(request), (e) => e === enoent);

  const files = recorder.files();
  assert.deepEqual(
    files.map((f) => f.name),
    [RAW_EXIT_FILE],
  );
  const exit = JSON.parse(files[0]!.content) as Record<string, unknown>;
  assert.deepEqual(exit, {
    exitCode: null,
    signal: null,
    error: { name: 'Error', message: 'spawn /fake/claude ENOENT ***', code: 'ENOENT' },
  });
});

test('여러 번 불리면 마지막 호출을 남긴다', async () => {
  const recorder = createClaudeCodeRecorder(redact);
  const run = recorder.wrap(fakeRunCli([exited('first', 1), exited('second', 0)]));
  await run(request);
  await run(request);
  assert.equal(fileNamed(recorder.files(), RAW_STDOUT_FILE)?.content, 'second');
});
