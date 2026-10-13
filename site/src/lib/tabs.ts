/**
 * 헤더 탭 (단일 출처). 페이지가 있는 탭만 COPY 순서(소개 · 결과 · 비교표 · 프롬프트)로 둔다 — ADR-024.
 * 첫 화면은 결과 탭이라 결과 탭의 주소가 base 루트(/)다.
 */
export const TABS = [
  { id: 'intro', label: '소개', path: 'intro/' },
  { id: 'results', label: '결과', path: '' },
  { id: 'compare', label: '비교표', path: 'compare/' },
  { id: 'prompt', label: '프롬프트', path: 'prompt/' },
] as const;

export type TabId = (typeof TABS)[number]['id'];
