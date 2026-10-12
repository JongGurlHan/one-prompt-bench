import { CURRENT_PROMPT, fillCount } from '@opb/core';

/* ────────────────────────────────────────────────────────────
 * 사이트 문구 (docs/COPY.md 그대로, 바꾸지 않는다)
 * 상태 라벨·판정 기호·결과물이 없을 때의 이유·숫자 포맷은 core display.ts에 있다.
 * 모델 수는 하드코딩하지 않고 {N}을 fillCount로 채운다.
 * ──────────────────────────────────────────────────────────── */

export const SITE_NAME = 'One Prompt Bench';
export const SITE_TAGLINE = '하나의 프롬프트, 모델마다 다른 나무';

/** meta description·og:description = 소개 탭 "제목 아래 문장" */
export const SITE_DESCRIPTION =
  '같은 프롬프트를 여러 AI 모델에 한 번씩 보내, 브라우저에서 바로 실행되는 3D 나무를 받았어요. 새 모델이 나오면 같은 프롬프트로 한 그루씩 더해요.';

/** 페이지 <title>: "<이름> — One Prompt Bench", 결과 탭(/)은 이름 없이 "One Prompt Bench" */
export const pageTitle = (name?: string) => (name ? `${name} — ${SITE_NAME}` : SITE_NAME);

/** 프롬프트 식별자 칩: season-tree-v1 */
export const PROMPT_LABEL = `${CURRENT_PROMPT.id}-${CURRENT_PROMPT.version}`;

export const RESULTS_TAB = {
  title: '사계절이 바뀌는 3D 나무',
  description: '같은 프롬프트로 여러 모델이 한 번씩 만든 결과물이에요. 왼쪽에서 모델을 고르면 그 결과물 하나만 실행돼요.',
} as const;

/** 결과 탭 칩: season-tree-v1 · 모델 {N}개 · 모델당 1회 생성 */
export const resultsChips = (modelCount: number) => [PROMPT_LABEL, fillCount('모델 {N}개', modelCount), '모델당 1회 생성'];

/** 결과물 iframe의 title */
export const resultFrameTitle = (displayName: string) => `${displayName} 결과물`;
