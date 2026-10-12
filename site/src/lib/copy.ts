import { CURRENT_PROMPT, fillCount } from '@opb/core';

/* ────────────────────────────────────────────────────────────
 * 사이트 문구 (docs/COPY.md 그대로, 바꾸지 않는다)
 * 상태 라벨·판정 기호·결과물이 없을 때의 이유·숫자 포맷은 core display.ts에 있다.
 * 모델 수는 하드코딩하지 않고 {N}을 fillCount로 채운다.
 * ──────────────────────────────────────────────────────────── */

export const SITE_NAME = 'One Prompt Bench';
export const SITE_TAGLINE = '하나의 프롬프트, 모델마다 다른 나무';

/** 헤더 탭 목록(nav)의 aria-label */
export const NAV_LABEL = '주요 메뉴';

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

/** 결과 탭 모델 목록: 제목 · 정렬 안내 · 범례 상자 제목 */
export const MODEL_LIST = { title: '모델', sortNote: '출시일 최신순', legendTitle: '상태 표시' } as const;

/** 목록 항목 보조 줄: {회사} · {생성 도구} */
export const modelListMeta = (company: string, generator: string) => `${company} · ${generator}`;

/** 실행 카드 머리: {회사} · {생성 도구}로 생성 · {출시일} 출시 */
export const runCardMeta = (company: string, generator: string, releasedAt: string) =>
  `${company} · ${generator}로 생성 · ${releasedAt} 출시`;

export const RUN_ACTIONS = { restart: '다시 시작', openInNewWindow: '새 창에서 열기' } as const;

export const REQUIREMENTS_CARD_TITLE = '요구사항 판정';

/** 카드 "생성 기록"의 행 (이 순서로 보인다) */
export const RECORD_CARD = {
  title: '생성 기록',
  rows: {
    status: '결과',
    requestCheck: '조건 검사',
    errorCount: '에러 수',
    tokens: '토큰 (입력 / 출력)',
    cost: '비용 (정가 기준)',
    duration: '걸린 시간',
  },
} as const;

export const RESPONSE_CARD_TITLE = '응답 원문';

/** 응답 원문을 불러오지 못했을 때 */
export const RESPONSE_LOAD_FAILED = '응답 원문을 불러오지 못했어요.';
