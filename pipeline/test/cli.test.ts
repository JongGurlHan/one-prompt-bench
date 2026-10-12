import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCommand } from '../src/cli.js';

test('빈 인자 → 사용법 오류', () => {
  const cmd = parseCommand([]);
  assert.equal(cmd.kind, 'usage_error');
});

test('알 수 없는 명령 → 사용법 오류, 메시지에 명령 이름', () => {
  const cmd = parseCommand(['frobnicate']);
  assert.equal(cmd.kind, 'usage_error');
  assert.match(cmd.kind === 'usage_error' ? cmd.message : '', /frobnicate/);
});

test('알 수 없는 옵션 → 던지지 않고 사용법 오류', () => {
  assert.equal(parseCommand(['--nope']).kind, 'usage_error');
});

test('--help·-h → 도움말 (명령 뒤에 붙어도 실행하지 않고 도움말)', () => {
  assert.deepEqual(parseCommand(['--help']), { kind: 'help' });
  assert.deepEqual(parseCommand(['-h']), { kind: 'help' });
  assert.deepEqual(parseCommand(['frobnicate', '--help']), { kind: 'help' });
});
