/* ────────────────────────────────────────────────────────────
 * 프롬프트 탭 복사 버튼 (ADR-018 — 순수 TypeScript)
 * 클립보드에는 빌드 때 페이지에 넣은 원문(#prompt-source, 프롬프트 파일 내용 그대로 — 끝 줄바꿈 포함)을 쓴다.
 * 화면에 렌더링한 글자를 다시 모으지 않는다. 버튼 글자는 HTML에 있는 값(복사 · data-copied-label)만 쓴다.
 * 클립보드 API가 없거나 쓰기가 거절되면 글자를 바꾸지 않는다 — 실패를 성공처럼 보이지 않는다.
 * ──────────────────────────────────────────────────────────── */

/** "복사됨"을 보여 주는 시간 (마지막으로 복사에 성공한 때부터) */
export const COPIED_MS = 2_000;

export function setupPromptCopy(doc: Document = document): void {
  const button = doc.querySelector<HTMLButtonElement>('button[data-action="copy"]');
  const data = doc.getElementById('prompt-source');
  if (!button || !data) return;

  const source = JSON.parse(data.textContent ?? '') as string;
  const idleLabel = button.textContent?.trim() ?? '';
  const copiedLabel = button.dataset.copiedLabel ?? idleLabel;
  let restore: ReturnType<typeof setTimeout> | undefined;

  button.addEventListener('click', () => {
    // 보안 컨텍스트가 아니거나 지원하지 않는 브라우저에서는 navigator.clipboard가 없다
    const clipboard: Clipboard | undefined = doc.defaultView?.navigator.clipboard;
    if (!clipboard) return;
    clipboard.writeText(source).then(
      () => {
        clearTimeout(restore);
        button.textContent = copiedLabel;
        restore = setTimeout(() => {
          button.textContent = idleLabel;
        }, COPIED_MS);
      },
      () => {}, // 거절됨: 글자를 그대로 둔다
    );
  });
}
