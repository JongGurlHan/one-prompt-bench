import { CURRENT_PROMPT, MARK_LABEL, REQUIREMENT_LABEL, VERDICT_LABEL, fillCount, type ModelDisplay } from '@opb/core';

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

/* ───────── 비교표 탭 ───────── */

export const COMPARE_TAB = {
  title: '비교표',
  description: '모델마다 어떻게 만들어졌고, 얼마나 들었고, 프롬프트를 얼마나 지켰는지 나란히 봐요. 모델은 출시일 최신순이에요.',
} as const;

/** 표 1 "수록 모델"의 열 (이 순서로 보인다. 키는 칸의 data-col) */
export const MODELS_TABLE = {
  title: '수록 모델',
  columns: {
    displayName: '모델',
    company: '회사',
    releasedAt: '출시일',
    generator: '생성 도구',
    status: '결과',
    fileSize: '파일 크기',
    threeVersion: 'three.js 버전',
  },
} as const;

/** 각주 기호 (core displayModel의 *TokensMark 값) */
export type FootnoteMark = Exclude<
  ModelDisplay['inputTokensMark'] | ModelDisplay['outputTokensMark'] | ModelDisplay['reasoningTokensMark'],
  ''
>;

/** 표 2 "생성 기록": 표 위 안내 박스, 열, 표 아래 각주 († ‡ § 순서) */
export const RECORD_TABLE = {
  title: '생성 기록',
  notice: '비용은 API 정가로 계산한 값이에요. 실제로는 구독과 무료 티어로 생성해서 청구된 금액은 없어요.',
  columns: {
    displayName: '모델',
    inputTokens: '입력 토큰',
    outputTokens: '출력 토큰',
    reasoningTokens: '그중 추론',
    cost: '비용 (정가 기준)',
    duration: '걸린 시간',
    retries: '재시도',
  },
  footnotes: [
    { mark: '†', text: 'Codex CLI는 출력 상한을 지정할 수 없어 모델 기본값으로 생성했어요. 다른 모델의 출력 상한은 65,536 토큰이에요.' },
    {
      mark: '‡',
      text: 'Gemini 3.8 Flash는 추론 강도가 low·medium·high 세 단계라 high가 최고 단계예요. 다른 모델은 high 위에 단계가 더 있어요.',
    },
    {
      mark: '§',
      text: 'Claude Code와 Codex CLI는 프롬프트 밖에 도구 정의 같은 내용을 덧붙여 보내요. 입력 토큰에 이 몫이 들어 있어요(Claude Code 약 600토큰, Codex CLI 약 7,000토큰).',
    },
  ] satisfies { mark: FootnoteMark; text: string }[],
} as const;

/**
 * 표 3 "요구사항과 검증": 열, 표 아래 범례 두 줄과 링크.
 * 요구사항 이름·판정 기호·조건 검사 라벨은 core display.ts의 것을 COPY 순서대로 잇는다.
 */
export const CHECKS_TABLE = {
  title: '요구사항과 검증',
  columns: {
    displayName: '모델',
    ...REQUIREMENT_LABEL,
    requestCheck: '조건 검사',
    errorCount: '에러 수',
  },
  legend: [`${Object.values(MARK_LABEL).join(' · ')} (사람이 판정)`, `조건 검사: ${Object.values(VERDICT_LABEL).join(' · ')}`],
  criteriaLink: '판정 기준 보기',
} as const;
