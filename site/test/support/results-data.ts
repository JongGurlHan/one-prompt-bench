import {
  FAKE_COMMIT,
  STATUS_CASES,
  fakeDiscarded,
  fakeModel,
  makeDataRoot,
  writeResult,
  type FakeResult,
  type StatusCase,
} from '@opb/core/testing';
import type { Discarded, ModelEntry, RegenerationNotice, StatusLabel } from '@opb/core';

/* ────────────────────────────────────────────────────────────
 * 결과 탭 테스트용 데이터 (dist 검사·브라우저 테스트 공용)
 * 상태 라벨 10개(STATUS_CASES) + 맨 위에 결과물이 없는 모델 + ✗ 판정과 콘솔·페이지 에러가 있는 모델.
 * 그중 두 모델은 버린 결과물이 있다(ADR-032): 커밋한 blank_screen 2개(3회), 커밋하지 않은 continued_output 1개(2회).
 * 결과물 HTML은 load 이벤트마다 콘솔에 runLog(slug)를 남겨서, 브라우저 테스트가 실행·다시 시작을 셀 수 있다.
 * 원문을 보여 주는 라벨(거부·잘림·HTML 없음)의 response.txt에는 표식(RESPONSE_MARK)을 넣어 빌드 HTML에 없는지 본다.
 * ──────────────────────────────────────────────────────────── */

/** 목록 맨 위(출시일이 가장 늦음)인데 결과물이 없다 → 첫 선택이 아니다 (ADR-025) */
export const NEWEST = fakeModel('model-newest', 'google', '2026-10-10', 'Model Newest');
/** 결과물이 있는 첫 모델 = 첫 선택 */
export const FIRST_WITH_OUTPUT = 'model-ok';
/** ✗ 미충족·△ 부분 충족이 섞인 판정 */
export const FAIL_MARK = fakeModel('model-fail-mark', 'openai', '2026-09-25', 'Model Fail Mark');
/** '<'가 든 메모: 페이지에 넣은 JSON이 </script>에서 끊기지 않고, 메모가 글자 그대로 나오는지 본다 */
export const FAIL_MARK_NOTE = '나무는 있지만 겨울 모습이 없다 </script><b>끝</b>';
/** 조건 검사는 정상인데 콘솔 에러 2 + 페이지 에러 1 (ADR-026: "정상" 배지와 에러 수가 함께 보인다) */
const FAIL_MARK_ERRORS = {
  consoleErrors: ['THREE.Color: addScaledColor is not a function', 'THREE.Color: addScaledColor is not a function'],
  pageErrors: ['TypeError: Cannot read properties of undefined (reading "position")'],
};

/** 결과 탭 "생성 기록"의 에러 수 (DATA "값 계산·포맷": 콘솔 + 페이지 에러, 검증 기록이 없으면 —) */
export const EXPECTED_ERROR_COUNT: Readonly<Record<string, string>> = {
  'model-newest': '—',
  'model-ok': '0',
  'model-miss': '0',
  'model-violation': '1',
  'model-truncated': '—',
  'model-fail-mark': '3',
  'model-no-html': '—',
  'model-refused': '—',
  'model-usage-limit': '—',
  'model-failed': '—',
  'model-pending': '—',
  'model-unvalidated': '—',
};

/** 결과물이 load될 때마다 콘솔에 남는 줄 */
export const runLog = (slug: string) => `opb-load:${slug}`;
const runHtml = (slug: string) =>
  `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>${slug}</title></head>` +
  `<body><script>addEventListener('load', () => console.log(${JSON.stringify(runLog(slug))}));</script></body></html>\n`;

export const RESPONSE_MARK = 'opb-response-mark';
/** 원문 카드에 나올 response.txt (HTML처럼 보이는 글자를 넣어 텍스트로 나오는지 본다) */
export const RESPONSE_TEXT: Readonly<Record<string, string>> = {
  'model-truncated': `\`\`\`html\n<!doctype html>\n<html><body><script>\n// ${RESPONSE_MARK}:model-truncated 출력 상한에서 끊긴 응답\n`,
  'model-no-html': `${RESPONSE_MARK}:model-no-html 나무를 만드는 방법을 설명할게요.\n<b>굵게</b> & 끝\n`,
  'model-refused': `${RESPONSE_MARK}:model-refused 죄송하지만 이 요청은 도와드릴 수 없어요.\n`,
};

/** 결과물이 없는 모델의 이유 문구 (docs/COPY.md "결과물이 없을 때" 그대로) */
export const EXPECTED_REASON: Readonly<Record<string, string>> = {
  'model-newest': '아직 생성하지 않았어요.',
  'model-truncated': '출력 상한에 닿아 응답이 중간에 끊겼어요.',
  'model-no-html': '응답에서 실행할 HTML 문서를 찾지 못했어요.',
  'model-refused': '모델이 요청을 거부했어요.',
  'model-usage-limit': '구독 사용 한도에 걸려 생성하지 못했어요. 한도가 풀리면 다시 생성해요.',
  'model-failed': '기술적인 문제로 생성하지 못했어요. (시간 초과)',
  'model-pending': '아직 생성하지 않았어요.',
};

/** docs/UI_GUIDE.md "상태 배지"의 계열 */
export const EXPECTED_TONE: Readonly<Record<StatusLabel, string>> = {
  정상: 'green',
  '지시 미준수': 'yellow',
  위반: 'red',
  잘림: 'purple',
  'HTML 없음': 'purple',
  거부: 'purple',
  '한도 초과': 'blue',
  '생성 실패': 'blue',
  '생성 전': 'gray',
  '검증 전': 'gray',
};

/* ───────── 다시 생성한 모델 (ADR-032) ───────── */

/** 화면에 나무가 그려지지 않아 두 번 버리고(둘 다 커밋 있음) 3번째 생성본을 공개했다 */
export const REGENERATED_BLANK = 'model-miss';
/** 생성 도구가 이어 쓴 응답을 잘못 기록해 커밋하기 전에 버리고 2번째 생성본을 공개했다 (Sonnet 모양) */
export const REGENERATED_CONTINUED = 'model-fail-mark';
const DISCARDED: Readonly<Record<string, Discarded[]>> = {
  [REGENERATED_BLANK]: [fakeDiscarded({ at: '2026-10-11' }), fakeDiscarded({ at: '2026-10-12', commit: FAKE_COMMIT })],
  [REGENERATED_CONTINUED]: [fakeDiscarded({ reason: 'continued_output', commit: null })],
};

/** 결과 탭 재생성 안내 박스 (docs/COPY.md "다시 생성하거나 고친 결과물" 그대로). 여기에 없는 모델은 안내 박스가 없다 */
export const EXPECTED_REGENERATION: Readonly<Record<string, RegenerationNotice>> = {
  [REGENERATED_BLANK]: {
    title: '3번째로 생성한 결과물이에요.',
    lines: [
      '1번째 생성: 화면에 나무가 그려지지 않아 다시 생성했어요. (커밋 9876543)',
      '2번째 생성: 화면에 나무가 그려지지 않아 다시 생성했어요. (커밋 0123456)',
    ],
  },
  [REGENERATED_CONTINUED]: {
    title: '2번째로 생성한 결과물이에요.',
    lines: [
      '1번째 생성: 생성 도구가 출력 상한을 넘겨 이어 쓴 응답을 잘못 기록해서, 그 기록을 버리고 다시 생성했어요. (기록은 남아 있지 않아요)',
    ],
  },
};
/** 안내 박스 줄 안의 커밋 해시 (앞 7자, Mono) */
export const EXPECTED_COMMIT_HASHES: Readonly<Record<string, string[]>> = {
  [REGENERATED_BLANK]: ['9876543', '0123456'],
  [REGENERATED_CONTINUED]: [],
};

/** 비교표 표 1 "생성 횟수" 값 + 각주 기호 (DATA "표시 규칙": meta.json이 없으면 —, 버린 결과물이 있으면 ¶) */
export const EXPECTED_GENERATION_COUNT: Readonly<Record<string, string>> = {
  'model-newest': '—',
  'model-ok': '1회',
  'model-miss': '3회¶',
  'model-violation': '1회',
  'model-truncated': '1회',
  'model-fail-mark': '2회¶',
  'model-no-html': '1회',
  'model-refused': '1회',
  'model-usage-limit': '1회',
  'model-failed': '1회',
  'model-pending': '—',
  'model-unvalidated': '1회',
};

export interface TabCase {
  label: StatusLabel;
  model: ModelEntry;
  result: FakeResult | null;
}

const withFixtureFiles = (c: StatusCase): TabCase => {
  const { label, model, result } = c;
  if (result === null) return { label, model, result };
  if (result.outcome === 'ok') return { label, model, result: { ...result, html: runHtml(model.slug) } };
  const responseText = RESPONSE_TEXT[model.slug];
  if (result.outcome === 'api_failed' || !responseText) return { label, model, result };
  return { label, model, result: { ...result, responseText } };
};

const withDiscarded = (c: TabCase): TabCase => {
  const discarded = DISCARDED[c.model.slug];
  return discarded ? { ...c, model: { ...c.model, discarded } } : c;
};

const CASES: readonly TabCase[] = [
  { label: '생성 전', model: NEWEST, result: null },
  ...STATUS_CASES.map(withFixtureFiles),
  {
    label: '정상',
    model: FAIL_MARK,
    result: {
      outcome: 'ok',
      html: runHtml(FAIL_MARK.slug),
      validation: FAIL_MARK_ERRORS,
      judgment: { requirements: { scene: 'partial', seasonLook: 'fail' }, note: FAIL_MARK_NOTE },
    },
  },
];
export const TAB_CASES: readonly TabCase[] = CASES.map(withDiscarded);

/** 목록 순서 (출시일 최신순, 같은 날은 표시명 알파벳순) */
export const EXPECTED_ORDER = [
  'model-newest',
  'model-ok',
  'model-miss',
  'model-violation',
  'model-truncated',
  'model-fail-mark',
  'model-no-html',
  'model-refused',
  'model-usage-limit',
  'model-failed',
  'model-pending',
  'model-unvalidated',
];

async function makeRoot(cases: readonly TabCase[]): Promise<string> {
  const root = await makeDataRoot(cases.map((c) => c.model));
  for (const c of cases) if (c.result) await writeResult(root, c.model.slug, c.result);
  return root;
}

/** 모든 상태 + 판정 있음/없음 */
export const makeResultsTabDataRoot = () => makeRoot(TAB_CASES);

/** 결과물이 하나도 없는 모델들 (맨 위는 원문을 보여 주는 "잘림") */
export const NO_OUTPUT_SLUGS = ['model-truncated', 'model-failed', 'model-pending'];
export const makeNoOutputDataRoot = () => makeRoot(TAB_CASES.filter((c) => NO_OUTPUT_SLUGS.includes(c.model.slug)));

/** 다시 생성한 모델(3회)이 결과물이 있는 첫 모델 = 첫 선택이다. 뒤에 다시 생성하지 않은 모델과 커밋 없이 버린 모델이 있다 */
export const REGENERATED_FIRST_SLUGS = [REGENERATED_BLANK, 'model-violation', REGENERATED_CONTINUED];
export const makeRegeneratedFirstDataRoot = () => makeRoot(TAB_CASES.filter((c) => REGENERATED_FIRST_SLUGS.includes(c.model.slug)));
