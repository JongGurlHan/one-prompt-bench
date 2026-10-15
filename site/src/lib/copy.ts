import {
  CURRENT_PROMPT,
  DEFAULT_MAX_OUTPUT_TOKENS,
  GENERATOR_LABEL,
  MARK_LABEL,
  MAX_GENERATIONS,
  MAX_REPAIRS,
  REQUIREMENT_LABEL,
  VERDICT_LABEL,
  fillCount,
  formatInt,
  type ModelDisplay,
} from '@opb/core';

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

/** 결과 탭 제목·설명. 설명은 넓은 화면(왼쪽 목록)과 휴대폰(드롭다운 화면, "왼쪽에서" → "목록에서") 두 가지다 */
export const RESULTS_TAB = {
  title: '사계절이 바뀌는 3D 나무',
  description: {
    wide: '같은 프롬프트로 여러 모델이 한 번씩 만든 결과물이에요. 왼쪽에서 모델을 고르면 그 결과물 하나만 실행돼요.',
    narrow: '같은 프롬프트로 여러 모델이 한 번씩 만든 결과물이에요. 목록에서 모델을 고르면 그 결과물 하나만 실행돼요.',
  },
} as const;

/** 결과 탭·소개 탭 칩의 생성 횟수 (괄호 부분은 ADR-031) */
const GENERATION_CHIP = '모델당 1회 생성(빈 화면은 다시)';

/** 결과 탭 칩: season-tree-v1 · 모델 {N}개 · 모델당 1회 생성(빈 화면은 다시) */
export const resultsChips = (modelCount: number) => [PROMPT_LABEL, fillCount('모델 {N}개', modelCount), GENERATION_CHIP];

/** 결과물 iframe의 title */
export const resultFrameTitle = (displayName: string) => `${displayName} 결과물`;

/** 결과 탭 모델 목록: 제목 · 정렬 안내 · 범례 상자 제목 */
export const MODEL_LIST = { title: '모델', sortNote: '출시일 최신순', legendTitle: '상태 표시' } as const;

/** 목록 항목 보조 줄: {회사} · {생성 도구} */
export const modelListMeta = (company: string, generator: string) => `${company} · ${generator}`;

/** 휴대폰 모델 선택기(<label>모델</label><select>)의 옵션: {표시명} · {상태 라벨} (UI_GUIDE "결과 탭") */
export const modelOptionLabel = (displayName: string, statusLabel: string) => `${displayName} · ${statusLabel}`;

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

/** 각주 기호 (core displayModel의 *Mark 값) */
export type FootnoteMark = Exclude<
  | ModelDisplay['inputTokensMark']
  | ModelDisplay['outputTokensMark']
  | ModelDisplay['reasoningTokensMark']
  | ModelDisplay['generationCountMark'],
  ''
>;

/** 표 1 "수록 모델"의 열 (이 순서로 보인다. 키는 칸의 data-col)과 표 아래 각주 ¶ (ADR-032) */
export const MODELS_TABLE = {
  title: '수록 모델',
  columns: {
    displayName: '모델',
    company: '회사',
    releasedAt: '출시일',
    generator: '생성 도구',
    status: '결과',
    generationCount: '생성 횟수',
    fileSize: '파일 크기',
    threeVersion: 'three.js 버전',
  },
  footnotes: [
    {
      mark: '¶',
      text: `다시 생성했거나 고친 결과물이에요. 화면에 나무가 그려지지 않으면 같은 프롬프트로 최대 ${MAX_GENERATIONS}번까지 생성하고, 그래도 안 되면 브라우저 에러를 알려 주고 최대 ${MAX_REPAIRS}번 고치게 해요. 그래도 안 되면 수록에서 빼요. 자세한 과정은 결과 탭에 적었어요.`,
    },
  ] satisfies { mark: FootnoteMark; text: string }[],
} as const;

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

/* ───────── 프롬프트 탭 ───────── */

export const PROMPT_TAB = {
  title: '프롬프트',
  description: '모든 모델에 아래 문장을 한 글자도 바꾸지 않고 그대로 보냈어요. 레퍼런스 이미지는 없어요.',
} as const;

/** 원문 카드의 복사 버튼: 복사에 성공하면 2초 동안 "복사됨" */
export const PROMPT_COPY = { idle: '복사', copied: '복사됨' } as const;

/** "생성 조건" 카드의 행 (이 순서로 보인다. 키는 값 칸의 data-condition) */
export const CONDITIONS_CARD = {
  title: '생성 조건',
  rows: {
    count: '횟수',
    reasoning: '추론 강도',
    outputLimit: '출력 상한',
    generators: '생성 도구',
    retry: '재시도',
    systemPrompt: '시스템 프롬프트',
  },
} as const;
export type ConditionKey = keyof typeof CONDITIONS_CARD.rows;

/**
 * "생성 조건"의 값. 횟수의 최대 생성·수정 횟수는 MAX_GENERATIONS·MAX_REPAIRS(ADR-032), 출력 상한은 DEFAULT_MAX_OUTPUT_TOKENS,
 * 생성 도구는 GENERATOR_LABEL에서 채운다.
 * 시스템 프롬프트는 prompts/<id>-<version>.system.md 내용 — 끝 줄바꿈은 화면에서만 지우고 큰따옴표로 감싼다.
 */
export const conditionValues = (systemPrompt: string): Record<ConditionKey, string> => ({
  count: `모델마다 1회, 사람이 고치지 않음 (나무가 그려지지 않으면 최대 ${MAX_GENERATIONS}번까지 생성하고, 그래도 안 되면 에러를 알려 주고 최대 ${MAX_REPAIRS}번 고치게 함)`,
  reasoning: 'high (회사마다 단계 구성이 달라요, 비교표 각주 참고)',
  outputLimit: `${formatInt(DEFAULT_MAX_OUTPUT_TOKENS)} 토큰 (도구별 차이는 비교표 각주 참고)`,
  generators: Object.values(GENERATOR_LABEL).join(' · '),
  retry: '기술적 실패일 때만',
  systemPrompt: `"${systemPrompt.replace(/\n+$/, '')}" (모든 도구 같음)`,
});

/**
 * "판정 기준" 섹션: 제목, 설명, 표의 열 (칸 내용은 prompts/<id>-<version>.judging.md — 여기에 다시 쓰지 않는다).
 * 열 이름의 판정 기호·문구는 core MARK_LABEL이다.
 */
export const JUDGE_SECTION = {
  title: '판정 기준',
  description:
    '결과물을 한 바퀴 넘게 지켜보고, 5·15·25·35초에 찍은 스크린샷 4장을 함께 봐요. "계절마다 10초"는 스크린샷이 각각 맞는 계절인지로 판단해요.',
  columns: { label: '요구사항', ...MARK_LABEL },
} as const;

/* ───────── 소개 탭 ───────── */

export const INTRO_TAB = {
  /** 탭 이름 (<title>) */
  name: '소개',
  label: 'AI 모델 결과물 비교',
  title: '하나의 프롬프트, 모델마다 다른 나무',
  /** 제목 아래 문장 (= meta description) */
  description: SITE_DESCRIPTION,
  /** 버튼: 결과 보러 가기(주) · 비교표 보기 · 프롬프트 전문 */
  actions: { results: '결과 보러 가기', compare: '비교표 보기', prompt: '프롬프트 전문' },
} as const;

/** 소개 탭 칩: 모델 {N}개 · season-tree-v1 · 모델당 1회 생성(빈 화면은 다시) */
export const introChips = (modelCount: number) => [fillCount('모델 {N}개', modelCount), PROMPT_LABEL, GENERATION_CHIP];

/** 소개 탭 카드 3개 (본문의 {N}은 fillCount로 채운다. How·Caution의 가운데 문장은 ADR-032) */
export const INTRO_CARDS = [
  {
    key: 'what',
    label: 'What',
    title: '같은 과제, 다른 모델',
    body: '2026년 9월 이후 출시된 OpenAI·Anthropic·Google 모델에 똑같은 프롬프트를 보냈어요. 지금까지 {N}개 모델이 참여했고, 새 모델도 같은 조건으로 추가해요.',
  },
  {
    key: 'how',
    label: 'How',
    title: '같은 조건, 자동 기록',
    body: '모델마다 한 번, 추론 강도 high로 만들었고 사람이 손대지 않았어요. 화면에 나무가 그려지지 않은 결과물만 다시 생성하거나 모델이 고치게 하고, 그 사실을 표시해요. 생성과 검증은 프로그램이 자동으로 하고, 토큰과 시간과 에러를 기록해요.',
  },
  {
    key: 'caution',
    label: 'Caution',
    title: '순위가 아니라 기록',
    body: '모델마다 한 번씩만 생성해서 운이 섞여 있어요. 나무가 그려지지 않아 다시 생성하거나 고치게 한 모델은 기회를 더 받은 셈이라 결과 탭과 비교표에 표시했어요. 생성 도구마다 조건이 조금씩 다른 부분은 비교표 각주에 적었어요.',
  },
] as const;

/** 소개 탭 "수록 기준"과 대상에서 뺀 모델 (모델명 / 사유) */
export const INCLUSION = {
  title: '수록 기준',
  description: '2026년 9월 1일 이후 출시된 OpenAI·Anthropic·Google 모델이 대상이에요. 새로 추가되는 모델도 이 기준을 따라요.',
  excludedTitle: '대상에서 뺀 모델',
  excluded: [
    { name: 'Claude Mythos 5.1', reason: '처음부터 대상에서 제외' },
    { name: 'Claude Fable 5.1', reason: '사용 중인 구독 플랜에서 추가 결제가 필요해 제외' },
    { name: 'Gemini 4 Argon', reason: 'Gemini API 무료 티어에서 제공하지 않아 추가 결제가 필요해 제외' },
  ],
} as const;
