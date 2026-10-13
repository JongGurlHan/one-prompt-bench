/* ────────────────────────────────────────────────────────────
 * 결과 탭 재생성 안내 줄을 보이는 조각으로 나눈다 (빌드 HTML과 클라이언트 스크립트 공용 — 그래서 import가 없다)
 * 글자는 core regenerationNotice가 만든 줄 그대로다. 줄 끝 괄호 안의 커밋 해시(앞 7자)만 Mono로 보이게 떼어 낸다
 * (UI_GUIDE "재생성 안내 박스"). 해시가 없는 줄은 한 조각이다.
 * ──────────────────────────────────────────────────────────── */

export interface LinePart {
  text: string;
  /** 커밋 해시 조각이면 true (<code>로 그린다) */
  hash: boolean;
}

/** "… (커밋 9876543)"의 해시와 닫는 괄호 */
const TRAILING_HASH = /(?<=\s)([0-9a-f]{7})(\))$/;

/** 조각을 이으면 line 그대로다 */
export function commitHashParts(line: string): LinePart[] {
  const m = TRAILING_HASH.exec(line);
  if (!m) return [{ text: line, hash: false }];
  return [
    { text: line.slice(0, m.index), hash: false },
    { text: m[1]!, hash: true },
    { text: m[2]!, hash: false },
  ];
}
