import assert from 'node:assert/strict';
import { test } from 'node:test';
import { regenerationNotice } from '@opb/core';
import { FAKE_COMMIT, fakeDiscarded, fakeModel } from '@opb/core/testing';
import { commitHashParts } from '../src/lib/regeneration-line.ts';

/* 재생성 안내 줄 나누기: 글자는 core regenerationNotice의 줄 그대로, 커밋 해시(앞 7자)만 Mono로 보이게 뗀다 */

const joined = (line: string) => commitHashParts(line).map((p) => p.text).join('');
const hashes = (line: string) => commitHashParts(line).filter((p) => p.hash).map((p) => p.text);

test('커밋이 있는 줄: 줄 끝 괄호 안의 해시 7자만 hash 조각이고, 조각을 이으면 줄 그대로다', () => {
  const notice = regenerationNotice(
    fakeModel('m', 'openai', '2026-10-01', 'M', {}, [fakeDiscarded(), fakeDiscarded({ commit: FAKE_COMMIT })]),
  );
  assert.ok(notice);
  assert.deepEqual(notice.lines.map(hashes), [['9876543'], ['0123456']]);
  for (const line of notice.lines) assert.equal(joined(line), line);
  assert.deepEqual(commitHashParts(notice.lines[0]!), [
    { text: '1번째 생성: 화면에 나무가 그려지지 않아 다시 생성했어요. (커밋 ', hash: false },
    { text: '9876543', hash: true },
    { text: ')', hash: false },
  ]);
});

test('커밋하지 않은 줄·다른 글자는 나누지 않는다', () => {
  const notice = regenerationNotice(
    fakeModel('m', 'anthropic', '2026-10-01', 'M', {}, [fakeDiscarded({ reason: 'continued_output', commit: null })]),
  );
  assert.ok(notice);
  for (const line of [...notice.lines, notice.title, '', 'abcdef0', '(abcdef0) 끝']) {
    assert.deepEqual(commitHashParts(line), [{ text: line, hash: false }], line);
  }
});
