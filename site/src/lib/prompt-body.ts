/* ────────────────────────────────────────────────────────────
 * 프롬프트 탭 원문 카드의 본문 (빌드 때 prompts/<id>-<version>.md를 HTML로)
 * 빈 줄로 나뉜 문단, "- "로 시작하는 줄들은 목록이다. 문단 안의 줄바꿈은 <br>로 남긴다.
 * 그 밖의 마크다운 문법(굵게·코드·링크·제목 등)은 해석하지 않고 글자 그대로 쓴다 — 본문 문장 속에
 * ```html 같은 글자가 있어서 마크다운 라이브러리를 쓰지 않는다. 모든 글자는 이스케이프한다.
 * 원문 파일은 고치지 않는다(복사 버튼은 이 결과가 아니라 원문 그대로를 쓴다).
 * ──────────────────────────────────────────────────────────── */

export type PromptBlock = { kind: 'paragraph'; lines: string[] } | { kind: 'list'; items: string[] };

const LIST_MARK = '- ';

/** 원문을 블록으로 나눈다. 공백만 있는 줄도 빈 줄이고, 빈 줄 없이 붙은 문단과 목록도 따로 나눈다 */
export function promptBlocks(source: string): PromptBlock[] {
  const blocks: PromptBlock[] = [];
  let current: PromptBlock | null = null;
  for (const line of source.split('\n')) {
    if (line.trim() === '') {
      current = null;
    } else if (line.startsWith(LIST_MARK)) {
      if (current?.kind !== 'list') blocks.push((current = { kind: 'list', items: [] }));
      current.items.push(line.slice(LIST_MARK.length));
    } else {
      if (current?.kind !== 'paragraph') blocks.push((current = { kind: 'paragraph', lines: [] }));
      current.lines.push(line);
    }
  }
  return blocks;
}

/** 원문 → <p>·<ul><li>·<br>만 쓴 HTML (set:html용) */
export function renderPromptBody(source: string): string {
  return promptBlocks(source)
    .map((b) =>
      b.kind === 'list'
        ? `<ul>${b.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
        : `<p>${b.lines.map(escapeHtml).join('<br>')}</p>`,
    )
    .join('');
}

const ESCAPE: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ESCAPE[c]!);
