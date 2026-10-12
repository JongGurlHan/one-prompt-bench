/**
 * 모델 응답 텍스트에서 실행할 HTML 문서를 꺼낸다.
 *  1) ```html (또는 언어 표기 없는) 코드 블록 중 완전한 문서처럼 보이는 것 → 가장 긴 것
 *     (모델이 설명용 조각과 최종본을 같이 주는 경우 최종본이 보통 가장 길다)
 *  2) 코드 블록이 없고 응답 전체가 문서로 시작하면 그대로
 *  3) 둘 다 아니면 null → outcome 'no_html'
 */
export interface Extraction {
  html: string;
  method: 'fenced_block' | 'raw_document';
}

const FENCE = /```[ \t]*(?:html?)?[ \t]*\r?\n([\s\S]*?)```/gi;
const looksLikeDocument = (s: string) => /<!doctype html|<html[\s>]/i.test(s);

export function extractHtml(text: string): Extraction | null {
  const blocks = [...text.matchAll(FENCE)]
    .map((m) => (m[1] ?? '').trim())
    .filter(looksLikeDocument);

  if (blocks.length > 0) {
    const longest = blocks.reduce((a, b) => (b.length > a.length ? b : a));
    return { html: longest, method: 'fenced_block' };
  }

  const trimmed = text.trim();
  if (/^(?:<!doctype html|<html[\s>])/i.test(trimmed)) {
    return { html: trimmed, method: 'raw_document' };
  }
  return null;
}
