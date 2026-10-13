import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCommand, USAGE } from '../src/cli.js';

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

/* ───────── gen ───────── */

test('gen <slug…> → 대상 slug 목록 (순서 유지, 중복 제거)', () => {
  assert.deepEqual(parseCommand(['gen', 'gemini-3-8-flash', 'gpt-6-sol', 'gemini-3-8-flash']), {
    kind: 'gen',
    slugs: ['gemini-3-8-flash', 'gpt-6-sol'],
    all: false,
    force: false,
  });
});

test('gen --all, --force는 위치와 관계없이 읽는다', () => {
  assert.deepEqual(parseCommand(['gen', '--all']), { kind: 'gen', slugs: [], all: true, force: false });
  assert.deepEqual(parseCommand(['gen', '--force', 'claude-opus-5-5']), {
    kind: 'gen',
    slugs: ['claude-opus-5-5'],
    all: false,
    force: true,
  });
  assert.deepEqual(parseCommand(['gen', '--all', '--force']), { kind: 'gen', slugs: [], all: true, force: true });
});

test('gen에 slug도 --all도 없으면 사용법 오류', () => {
  const cmd = parseCommand(['gen']);
  assert.equal(cmd.kind, 'usage_error');
  assert.match(cmd.kind === 'usage_error' ? cmd.message : '', /--all/);
  assert.equal(parseCommand(['gen', '--force']).kind, 'usage_error');
});

test('gen에 slug와 --all을 함께 주면 사용법 오류', () => {
  assert.equal(parseCommand(['gen', 'gpt-6-sol', '--all']).kind, 'usage_error');
});

test('확인을 건너뛰는 옵션은 없다: gen --yes·-y → 사용법 오류', () => {
  assert.equal(parseCommand(['gen', '--all', '--force', '--yes']).kind, 'usage_error');
  assert.equal(parseCommand(['gen', '--all', '--force', '-y']).kind, 'usage_error');
});

test('gen --help → 실행하지 않고 도움말', () => {
  assert.deepEqual(parseCommand(['gen', '--all', '--help']), { kind: 'help' });
});

test('--all·--force만 있고 명령이 없으면 사용법 오류', () => {
  assert.equal(parseCommand(['--all']).kind, 'usage_error');
  assert.equal(parseCommand(['--force', 'gpt-6-sol']).kind, 'usage_error');
});

test('USAGE에 gen 명령과 --all·--force 설명이 있다', () => {
  assert.match(USAGE, /gen <slug…> \| --all \[--force\]/);
  assert.match(USAGE, /--force/);
  assert.match(USAGE, /judgment\.json/);
});

/* ───────── smoke ───────── */

test('smoke <slug> → slug 1개', () => {
  assert.deepEqual(parseCommand(['smoke', 'gemini-3-8-flash']), { kind: 'smoke', slug: 'gemini-3-8-flash' });
});

test('smoke에 slug가 0개·2개 이상이면 사용법 오류 (같은 slug 두 번도)', () => {
  for (const argv of [['smoke'], ['smoke', 'a', 'b'], ['smoke', 'a', 'a']]) {
    const cmd = parseCommand(argv);
    assert.equal(cmd.kind, 'usage_error', argv.join(' '));
    assert.match(cmd.kind === 'usage_error' ? cmd.message : '', /smoke/);
  }
});

test('smoke에 --all·--force는 쓸 수 없다', () => {
  assert.equal(parseCommand(['smoke', '--all']).kind, 'usage_error');
  assert.equal(parseCommand(['smoke', 'gemini-3-8-flash', '--force']).kind, 'usage_error');
});

test('smoke --help → 실행하지 않고 도움말', () => {
  assert.deepEqual(parseCommand(['smoke', 'gemini-3-8-flash', '--help']), { kind: 'help' });
});

test('USAGE에 smoke 명령과 저장 위치가 있다', () => {
  assert.match(USAGE, /smoke <slug>/);
  assert.match(USAGE, /results-smoke\//);
});

/* ───────── validate ───────── */

test('validate <slug…> → 대상 slug 목록 (순서 유지, 중복 제거)', () => {
  assert.deepEqual(parseCommand(['validate', 'gpt-6-sol', 'gemini-3-8-flash', 'gpt-6-sol']), {
    kind: 'validate',
    slugs: ['gpt-6-sol', 'gemini-3-8-flash'],
    all: false,
  });
});

test('validate --all → outcome ok인 모델 전부', () => {
  assert.deepEqual(parseCommand(['validate', '--all']), { kind: 'validate', slugs: [], all: true });
});

test('validate에 slug도 --all도 없거나, 둘을 함께 주면 사용법 오류', () => {
  for (const argv of [['validate'], ['validate', 'gpt-6-sol', '--all']]) {
    const cmd = parseCommand(argv);
    assert.equal(cmd.kind, 'usage_error', argv.join(' '));
    assert.match(cmd.kind === 'usage_error' ? cmd.message : '', /validate/);
  }
});

test('validate에 --force는 쓸 수 없다 (결과물을 지우지 않는다)', () => {
  const cmd = parseCommand(['validate', '--all', '--force']);
  assert.equal(cmd.kind, 'usage_error');
  assert.match(cmd.kind === 'usage_error' ? cmd.message : '', /--force/);
});

test('validate --help → 실행하지 않고 도움말', () => {
  assert.deepEqual(parseCommand(['validate', '--all', '--help']), { kind: 'help' });
});

test('USAGE에 validate 명령이 있다', () => {
  assert.match(USAGE, /validate <slug…> \| --all/);
});

/* ───────── judge ───────── */

test('judge <slug> → slug 1개, 플래그 없으면 값은 비워 두고(대화형) yes는 false', () => {
  assert.deepEqual(parseCommand(['judge', 'gpt-6-sol']), { kind: 'judge', slug: 'gpt-6-sol', yes: false });
});

test('judge 플래그: 요구사항 4개·메모·--yes를 받은 그대로 넘긴다 (값 검사는 명령이 한다)', () => {
  assert.deepEqual(
    parseCommand([
      'judge',
      '--scene',
      'pass',
      'gpt-6-sol',
      '--cycle=partial',
      '--look',
      'fail',
      '--label',
      'nope',
      '--note',
      '봄에 꽃이 핀다',
      '--yes',
    ]),
    {
      kind: 'judge',
      slug: 'gpt-6-sol',
      scene: 'pass',
      cycle: 'partial',
      look: 'fail',
      label: 'nope',
      note: '봄에 꽃이 핀다',
      yes: true,
    },
  );
  // 빈 메모도 그대로 넘긴다 (명령이 거절한다)
  assert.deepEqual(parseCommand(['judge', 'gpt-6-sol', '--note', '']), { kind: 'judge', slug: 'gpt-6-sol', note: '', yes: false });
});

test('judge에 slug가 0개·2개 이상이면 사용법 오류 (같은 slug 두 번도)', () => {
  for (const argv of [['judge'], ['judge', 'a', 'b'], ['judge', 'a', 'a'], ['judge', '--scene', 'pass']]) {
    const cmd = parseCommand(argv);
    assert.equal(cmd.kind, 'usage_error', argv.join(' '));
    assert.match(cmd.kind === 'usage_error' ? cmd.message : '', /judge/);
  }
});

test('judge 플래그에 값이 없으면 사용법 오류', () => {
  assert.equal(parseCommand(['judge', 'gpt-6-sol', '--scene']).kind, 'usage_error');
  assert.equal(parseCommand(['judge', 'gpt-6-sol', '--note']).kind, 'usage_error');
});

test('judge에 --all·--force는 쓸 수 없다', () => {
  for (const argv of [['judge', '--all'], ['judge', 'gpt-6-sol', '--force']]) {
    const cmd = parseCommand(argv);
    assert.equal(cmd.kind, 'usage_error', argv.join(' '));
    assert.match(cmd.kind === 'usage_error' ? cmd.message : '', /judge/);
  }
});

test('judge 전용 플래그는 다른 명령에서 쓸 수 없다', () => {
  for (const argv of [
    ['gen', 'gpt-6-sol', '--scene', 'pass'],
    ['smoke', 'gpt-6-sol', '--note', 'x'],
    ['validate', '--all', '--yes'],
    ['validate', 'gpt-6-sol', '--label', 'fail'],
  ]) {
    const cmd = parseCommand(argv);
    assert.equal(cmd.kind, 'usage_error', argv.join(' '));
    assert.match(cmd.kind === 'usage_error' ? cmd.message : '', /judge/);
  }
});

test('judge --help → 실행하지 않고 도움말', () => {
  assert.deepEqual(parseCommand(['judge', 'gpt-6-sol', '--help']), { kind: 'help' });
});

test('USAGE에 judge 명령과 플래그·값이 있다', () => {
  assert.match(USAGE, /judge <slug>/);
  for (const flag of ['--scene', '--cycle', '--look', '--label', '--note', '--yes']) assert.ok(USAGE.includes(flag), flag);
  assert.match(USAGE, /pass\|partial\|fail/);
});
