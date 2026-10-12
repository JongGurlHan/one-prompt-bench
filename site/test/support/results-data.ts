import { STATUS_CASES, fakeModel, makeDataRoot, writeResult, type FakeResult, type StatusCase } from '@opb/core/testing';
import type { ModelEntry, StatusLabel } from '@opb/core';

/* ────────────────────────────────────────────────────────────
 * 결과 탭 테스트용 데이터 (dist 검사·브라우저 테스트 공용)
 * 상태 라벨 10개(STATUS_CASES) + 맨 위에 결과물이 없는 모델 + ✗ 판정이 있는 모델.
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

export const TAB_CASES: readonly TabCase[] = [
  { label: '생성 전', model: NEWEST, result: null },
  ...STATUS_CASES.map(withFixtureFiles),
  {
    label: '정상',
    model: FAIL_MARK,
    result: {
      outcome: 'ok',
      html: runHtml(FAIL_MARK.slug),
      judgment: { requirements: { scene: 'partial', seasonLook: 'fail' }, note: FAIL_MARK_NOTE },
    },
  },
];

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
