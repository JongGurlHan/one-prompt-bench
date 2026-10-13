/**
 * 헤더 탭 (단일 출처). 페이지가 있는 탭만 COPY 순서(소개 · 결과 · 비교표 · 프롬프트)로 둔다 — ADR-024.
 * phase 5에서 소개·프롬프트 페이지를 만들 때 여기에 더한다.
 */
export const TABS = [
  { id: 'results', label: '결과', path: '' },
  { id: 'compare', label: '비교표', path: 'compare/' },
] as const;

export type TabId = (typeof TABS)[number]['id'];
