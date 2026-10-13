import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { CURRENT_PROMPT, loadPrompt } from '@opb/core';
import { promptBlocks, renderPromptBody } from '../src/lib/prompt-body.ts';
import { decodeEntities, elements } from './support/html.ts';

/* 프롬프트 탭 본문 렌더링 (순수 함수): 빈 줄로 나뉜 문단, "- " 줄은 목록, 그 밖 마크다운은 글자 그대로 */

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** 태그를 지우고 엔티티를 푼 글자 (공백·줄바꿈을 건드리지 않는다) */
const rawText = (html: string) => decodeEntities(html.replace(/<[^>]*>/g, ''));

/** 원문에서 목록 표시 "- "와 줄바꿈을 뺀 글자 */
const sourceText = (source: string) =>
  source
    .split('\n')
    .map((line) => line.replace(/^- /, ''))
    .join('');

test('실제 프롬프트 파일: 문단 2개(둘째 문단은 줄 2개) · 목록 1개(항목 4개), 순서는 문단 · 목록 · 문단', async () => {
  const { user } = await loadPrompt(REPO_ROOT, CURRENT_PROMPT.id, CURRENT_PROMPT.version);
  const blocks = promptBlocks(user);
  assert.deepEqual(
    blocks.map((b) => (b.kind === 'list' ? `list:${b.items.length}` : `paragraph:${b.lines.length}`)),
    ['paragraph:1', 'list:4', 'paragraph:2'],
  );

  const html = renderPromptBody(user);
  assert.equal(elements(html, 'p').length, 2);
  const lists = elements(html, 'ul');
  assert.equal(lists.length, 1);
  const items = elements(lists[0]!.inner, 'li').map((li) => rawText(li.inner));
  assert.deepEqual(
    items.map((t) => t.split(':')[0]),
    ['장면', '계절', '모습', '표시'],
  );
  // 문단 안의 줄바꿈은 <br>로 남는다
  assert.equal(elements(html, 'br').length, 1);
  assert.match(elements(html, 'p')[1]!.inner, /쓰지 마세요\.<br>하나의 HTML 파일로/);
});

test('실제 프롬프트 파일: 렌더링한 글자를 이어 붙이면 원문의 글자와 같다 (목록 표시와 줄바꿈 제외)', async () => {
  const { user } = await loadPrompt(REPO_ROOT, CURRENT_PROMPT.id, CURRENT_PROMPT.version);
  const html = renderPromptBody(user);
  assert.equal(rawText(html), sourceText(user));
  // 문장 속의 ```html은 코드 블록이 아니라 글자 그대로다
  assert.ok(rawText(html).includes('하나의 HTML 파일로 만들어 ```html 코드 블록 하나에 담아주세요.'));
  assert.ok(!/<(pre|code)\b/.test(html));
});

test('모든 글자는 이스케이프하고, 굵게·코드·링크 같은 마크다운 문법은 해석하지 않는다', () => {
  const source = [
    '첫 줄 <b>굵게</b> & "따옴표" \'작은\'',
    '</script><script>alert(1)</script>',
    '',
    '- **굵게** 항목',
    '- `코드` 항목 [링크](https://example.com)',
    '',
    '# 제목처럼 보이는 줄',
    '',
  ].join('\n');
  const html = renderPromptBody(source);

  assert.ok(!html.includes('<b>'), html);
  assert.ok(!html.includes('<script'), html);
  assert.ok(!html.includes('</script'), html);
  assert.ok(!/<(strong|em|code|a|h\d)\b/.test(html), html);
  assert.equal(rawText(html), sourceText(source));
  assert.deepEqual(
    elements(html, 'li').map((li) => rawText(li.inner)),
    ['**굵게** 항목', '`코드` 항목 [링크](https://example.com)'],
  );
  assert.deepEqual(
    elements(html, 'p').map((p) => rawText(p.inner)),
    ['첫 줄 <b>굵게</b> & "따옴표" \'작은\'</script><script>alert(1)</script>', '# 제목처럼 보이는 줄'],
  );
});

test('블록 나누기: 빈 줄(공백만 있는 줄 포함)이 여럿이어도 블록 하나로 끊고, 빈 줄 없이 붙은 문단과 목록도 따로 나눈다', () => {
  const source = '앞 문단\n- 하나\n- 둘\n뒤 문단 1\n뒤 문단 2\n\n  \n\n마지막\n';
  assert.deepEqual(promptBlocks(source), [
    { kind: 'paragraph', lines: ['앞 문단'] },
    { kind: 'list', items: ['하나', '둘'] },
    { kind: 'paragraph', lines: ['뒤 문단 1', '뒤 문단 2'] },
    { kind: 'paragraph', lines: ['마지막'] },
  ]);
  assert.equal(
    renderPromptBody(source),
    '<p>앞 문단</p><ul><li>하나</li><li>둘</li></ul><p>뒤 문단 1<br>뒤 문단 2</p><p>마지막</p>',
  );
});

test('"- "로 시작하지 않는 줄은 목록이 아니다 (들여쓴 "- "·"-"만 있는 줄·"* ")', () => {
  assert.deepEqual(promptBlocks('  - 들여쓴 줄\n-붙은 줄\n* 별표 줄'), [
    { kind: 'paragraph', lines: ['  - 들여쓴 줄', '-붙은 줄', '* 별표 줄'] },
  ]);
  assert.deepEqual(promptBlocks(''), []);
  assert.deepEqual(promptBlocks('\n\n'), []);
});
