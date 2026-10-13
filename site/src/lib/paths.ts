/* 내부 주소는 모두 BASE_URL 기준이다 (GitHub Pages 프로젝트 경로 /<레포 이름>/) */

const BASE = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;

/** 'view/x/' → '/<base>/view/x/' */
export const withBase = (to: string) => BASE + to.replace(/^\/+/, '');

/** 결과물 사본. 샌드박스 iframe의 src로만 쓴다 — 직접 링크하지 않는다 (ADR-009) */
export const resultSrc = (slug: string) => withBase(`r/${slug}/index.html`);

/** 응답 원문 사본 (결과물이 없는 모델을 고를 때 fetch) */
export const responseTextSrc = (slug: string) => withBase(`r/${slug}/response.txt`);

/** "새 창에서 열기"의 래퍼 페이지 */
export const viewHref = (slug: string) => withBase(`view/${slug}/`);

/** 프롬프트 탭의 "판정 기준" 섹션 (비교표의 "판정 기준 보기" 링크) */
export const judgingCriteriaHref = () => withBase('prompt/#judge');
