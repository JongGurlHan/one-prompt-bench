import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  GENERATOR_LABEL,
  PROVIDER_LABEL,
  REQUIREMENT_LABEL,
  STATUS_LEGEND,
  displayModel,
  fillCount,
  missingOutputReason,
  statusOf,
  type BadgeTone,
  type StatusLabel,
} from '../src/display.js';
import * as core from '../src/index.js';
import type { ResultEntry } from '../src/results.js';
import { RESULT_IFRAME_SANDBOX } from '../src/sandbox.js';
import type { FailureKind, GenerationRecord, Judgment, ModelEntry } from '../src/schema.js';
import {
  LIBRARY_URL,
  STATUS_CASES,
  THREE_PINNED_URL,
  THREE_UNPINNED_URL,
  buildResult,
  fakeModel,
  type FakeResult,
} from './support/testing.js';

const anthropic = fakeModel('model-a', 'anthropic', '2026-10-07', 'Model A');
const openai = fakeModel('model-o', 'openai', '2026-09-29', 'Model O');
const google = fakeModel('model-g', 'google', '2026-09-02', 'Model G');

/** spec으로 만든 기록(스키마 통과)에 mutate로 경계값을 넣은 ResultEntry. spec null = 생성 전 */
function entry(
  model: ModelEntry,
  spec: FakeResult | null,
  mutate: (r: GenerationRecord) => void = () => {},
  judgment: Judgment | null = null,
): ResultEntry {
  if (spec === null) return { model, record: null, judgment };
  const built = buildResult(model, spec);
  const record = structuredClone(built.record);
  mutate(record);
  return { model, record, judgment: judgment ?? built.judgment };
}
const show = (model: ModelEntry, spec: FakeResult | null, mutate?: (r: GenerationRecord) => void) =>
  displayModel(entry(model, spec, mutate));

/* ───────── 상태 라벨 ───────── */

test('STATUS_LEGEND는 COPY "공통" 상태 라벨 순서 그대로', () => {
  assert.deepEqual(STATUS_LEGEND, [
    '정상',
    '지시 미준수',
    '위반',
    '잘림',
    'HTML 없음',
    '거부',
    '한도 초과',
    '생성 실패',
    '생성 전',
    '검증 전',
  ]);
});

test('상태 라벨 표의 모든 행과 배지 계열 (DATA "상태 라벨")', () => {
  const tone: Record<StatusLabel, BadgeTone> = {
    '생성 전': 'gray',
    '한도 초과': 'blue',
    '생성 실패': 'blue',
    거부: 'purple',
    잘림: 'purple',
    'HTML 없음': 'purple',
    '검증 전': 'gray',
    위반: 'red',
    '지시 미준수': 'yellow',
    정상: 'green',
  };
  assert.deepEqual(new Set(STATUS_CASES.map((c) => c.label)), new Set(STATUS_LEGEND), '모든 라벨에 사례가 있다');
  for (const c of STATUS_CASES) {
    const record = c.result ? buildResult(c.model, c.result).record : null;
    assert.deepEqual(statusOf(record), { label: c.label, tone: tone[c.label] }, c.label);
  }
});

test('위에서부터 처음 맞는 것: api_failed는 마지막 시도의 kind만 본다', () => {
  // 앞 시도가 usage_limit이어도 마지막이 network면 생성 실패
  const failed = entry(anthropic, { outcome: 'api_failed', failure: 'network', retries: 1 }, (r) => {
    r.attempts[0]!.result = { type: 'error', kind: 'usage_limit', httpStatus: 429, message: 'limit', usage: null };
  }).record;
  assert.equal(statusOf(failed).label, '생성 실패');
  // 재시도 끝에 usage_limit이면 한도 초과
  assert.equal(statusOf(buildResult(anthropic, { outcome: 'api_failed', failure: 'usage_limit', retries: 2 }).record).label, '한도 초과');
});

test('ok의 라벨은 조건 검사 판정: 위반이 지시 미준수보다 먼저, 검증 전은 판정보다 먼저', () => {
  const ok = (externalRequests: { url: string; resourceType: string }[]) =>
    statusOf(buildResult(anthropic, { outcome: 'ok', validation: { externalRequests } }).record).label;
  assert.equal(
    ok([
      { url: THREE_UNPINNED_URL, resourceType: 'script' },
      { url: LIBRARY_URL, resourceType: 'script' },
    ]),
    '위반',
  );
  assert.equal(ok([{ url: THREE_UNPINNED_URL, resourceType: 'script' }]), '지시 미준수');
  assert.equal(ok([]), '정상');
  assert.equal(ok([{ url: 'https://fonts.googleapis.com/css2?family=Inter', resourceType: 'stylesheet' }]), '정상');
  // 로드 실패·에러가 있어도 라벨은 조건 검사로 정한다 (에러 수는 따로 표시)
  const broken = buildResult(anthropic, { outcome: 'ok', validation: { loaded: false, pageErrors: ['boom'] } }).record;
  assert.equal(statusOf(broken).label, '정상');
  assert.equal(statusOf(buildResult(anthropic, { outcome: 'ok', validation: null }).record).label, '검증 전');
});

/* ───────── 결과물이 없을 때의 이유 ───────── */

test('이유 문구와 응답 원문 표시 여부 (COPY "결과물이 없을 때")', () => {
  assert.deepEqual(missingOutputReason(null), { text: '아직 생성하지 않았어요.', showResponseText: false });
  assert.deepEqual(missingOutputReason(buildResult(anthropic, { outcome: 'api_failed', failure: 'usage_limit' }).record), {
    text: '구독 사용 한도에 걸려 생성하지 못했어요. 한도가 풀리면 다시 생성해요.',
    showResponseText: false,
  });
  assert.deepEqual(missingOutputReason(buildResult(anthropic, { outcome: 'refused' }).record), {
    text: '모델이 요청을 거부했어요.',
    showResponseText: true,
  });
  assert.deepEqual(missingOutputReason(buildResult(anthropic, { outcome: 'truncated' }).record), {
    text: '출력 상한에 닿아 응답이 중간에 끊겼어요.',
    showResponseText: true,
  });
  assert.deepEqual(missingOutputReason(buildResult(anthropic, { outcome: 'no_html' }).record), {
    text: '응답에서 실행할 HTML 문서를 찾지 못했어요.',
    showResponseText: true,
  });
  // 결과물이 있으면(정상·검증 전 등) 이유 없음
  assert.equal(missingOutputReason(buildResult(anthropic, { outcome: 'ok' }).record), null);
  assert.equal(missingOutputReason(buildResult(anthropic, { outcome: 'ok', validation: null }).record), null);
});

test('생성 실패 이유에는 마지막 시도의 에러 종류 표시를 괄호로 덧붙인다 (COPY "공통")', () => {
  const kinds: [Exclude<FailureKind, 'usage_limit'>, string][] = [
    ['timeout', '시간 초과'],
    ['rate_limited', '요청 한도'],
    ['server_error', '서버 오류'],
    ['network', '네트워크 오류'],
    ['auth', '인증 오류'],
    ['bad_request', '잘못된 요청'],
    ['blocked', '차단됨'],
    ['unknown', '알 수 없는 오류'],
  ];
  for (const [failure, label] of kinds) {
    const record = buildResult(anthropic, { outcome: 'api_failed', failure, retries: 1 }).record;
    assert.deepEqual(missingOutputReason(record), {
      text: `기술적인 문제로 생성하지 못했어요. (${label})`,
      showResponseText: false,
    });
  }
});

/* ───────── 회사·생성 도구 ───────── */

test('회사·생성 도구 표시 이름, 생성 전 모델도 provider로 생성 도구를 보인다', () => {
  assert.deepEqual(PROVIDER_LABEL, { anthropic: 'Anthropic', openai: 'OpenAI', google: 'Google' });
  assert.deepEqual(GENERATOR_LABEL, { 'claude-code': 'Claude Code', 'codex-cli': 'Codex CLI', 'gemini-api': 'Gemini API' });
  const d = show(openai, null);
  assert.equal(d.company, 'OpenAI');
  assert.equal(d.generator, 'Codex CLI');
  assert.equal(d.releasedAt, '2026-09-29');
  assert.equal(d.displayName, 'Model O');
  assert.equal(d.slug, 'model-o');
  assert.deepEqual(d.status, { label: '생성 전', tone: 'gray' });
  assert.equal(d.hasOutput, false);
  assert.deepEqual(d.missingOutput, { text: '아직 생성하지 않았어요.', showResponseText: false });
});

test('생성 전이면 값은 전부 —, 판정도 —', () => {
  const d = show(anthropic, null);
  for (const key of [
    'requestCheck',
    'threeVersion',
    'errorCount',
    'fileSize',
    'inputTokens',
    'outputTokens',
    'tokens',
    'reasoningTokens',
    'cost',
    'duration',
    'retries',
  ] as const) {
    assert.equal(d[key], '—', key);
  }
  assert.deepEqual(
    d.requirements.map((r) => r.text),
    ['—', '—', '—', '—'],
  );
  assert.equal(d.note, null);
});

/* ───────── 값 포맷 경계 ───────── */

test('파일 크기: 1024 기준 소수 1자리 KB, 결과물 없으면 —', () => {
  const size = (bytes: number) =>
    show(anthropic, { outcome: 'ok' }, (r) => {
      r.output!.bytes = bytes;
    }).fileSize;
  assert.equal(size(0), '0.0 KB');
  assert.equal(size(1023), '1.0 KB');
  assert.equal(size(1024), '1.0 KB');
  assert.equal(size(1075), '1.0 KB'); // 1.0498…
  assert.equal(size(1076), '1.1 KB'); // 1.0507…
  assert.equal(size(41_267), '40.3 KB');
  assert.equal(show(anthropic, { outcome: 'no_html' }).fileSize, '—');
});

test('토큰: 천 단위 쉼표, api_failed이고 사용량 0이면 —', () => {
  const ok = show(anthropic, { outcome: 'ok', usage: { inputTokens: 1_200, outputTokens: 18_500, reasoningTokens: 9_200 } });
  assert.equal(ok.inputTokens, '1,200');
  assert.equal(ok.outputTokens, '18,500');
  assert.equal(ok.tokens, '1,200 / 18,500');
  assert.equal(ok.reasoningTokens, '9,200');

  const big = show(anthropic, { outcome: 'truncated', usage: { inputTokens: 999, outputTokens: 1_234_567, reasoningTokens: 0 } });
  assert.equal(big.inputTokens, '999');
  assert.equal(big.outputTokens, '1,234,567');
  assert.equal(big.reasoningTokens, '0');

  const failed = show(anthropic, { outcome: 'api_failed', failure: 'timeout', retries: 2 });
  assert.equal(failed.inputTokens, '—');
  assert.equal(failed.outputTokens, '—');
  assert.equal(failed.tokens, '—');
  assert.equal(failed.reasoningTokens, '—');

  // 실패했어도 과금된 사용량이 있으면 보인다
  const billed = show(anthropic, {
    outcome: 'api_failed',
    failure: 'server_error',
    usage: { inputTokens: 1_000, outputTokens: 0, reasoningTokens: null },
  });
  assert.equal(billed.inputTokens, '1,000');
  assert.equal(billed.outputTokens, '0');
  assert.equal(billed.tokens, '1,000 / 0');

  // 응답이 왔으면 사용량 0도 숫자로 (api_failed만 —)
  const zero = show(anthropic, { outcome: 'refused', usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 } });
  assert.equal(zero.tokens, '0 / 0');
});

test('그중 추론: null이면 —', () => {
  assert.equal(show(anthropic, { outcome: 'ok', usage: { inputTokens: 1, outputTokens: 2, reasoningTokens: null } }).reasoningTokens, '—');
});

test('비용: 소수 2자리, 0보다 크고 0.01 미만이면 <$0.01, 0이면 $0.00', () => {
  const cost = (totalUsd: number) =>
    show(anthropic, { outcome: 'ok' }, (r) => {
      r.cost.totalUsd = totalUsd;
    }).cost;
  assert.equal(cost(0), '$0.00');
  assert.equal(cost(0.000001), '<$0.01');
  assert.equal(cost(0.005), '<$0.01'); // 반올림하면 $0.01이지만 0.01 미만
  assert.equal(cost(0.009999), '<$0.01');
  assert.equal(cost(0.01), '$0.01');
  assert.equal(cost(0.4685), '$0.47');
  assert.equal(cost(3), '$3.00');
  // api_failed(과금 없음)도 정가 계산값 그대로
  assert.equal(show(anthropic, { outcome: 'api_failed' }).cost, '$0.00');
});

test('걸린 시간: 마지막 시도의 latencyMs, 초 단위 반올림, 60초부터 m분 s초, api_failed면 —', () => {
  const duration = (latencyMs: number) => show(anthropic, { outcome: 'ok', latencyMs }).duration;
  assert.equal(duration(0), '0초');
  assert.equal(duration(499), '0초');
  assert.equal(duration(48_000), '48초');
  assert.equal(duration(59_499), '59초');
  assert.equal(duration(59_500), '1분 0초'); // 반올림해서 60초
  assert.equal(duration(60_000), '1분 0초');
  assert.equal(duration(60_499), '1분 0초');
  assert.equal(duration(61_000), '1분 1초');
  assert.equal(duration(214_000), '3분 34초');
  assert.equal(duration(1_200_000), '20분 0초');
  // 재시도·백오프는 빼고 마지막 시도만 (ADR-021)
  assert.equal(show(anthropic, { outcome: 'ok', retries: 2, latencyMs: 30_000 }).duration, '30초');
  assert.equal(show(anthropic, { outcome: 'api_failed', failure: 'timeout', latencyMs: 30_000 }).duration, '—');
});

test('재시도: attempts.length - 1', () => {
  assert.equal(show(anthropic, { outcome: 'ok' }).retries, '0');
  assert.equal(show(anthropic, { outcome: 'ok', retries: 2 }).retries, '2');
  assert.equal(show(anthropic, { outcome: 'api_failed', retries: 2 }).retries, '2');
});

test('에러 수: consoleErrors + pageErrors, validation 없으면 —', () => {
  assert.equal(show(anthropic, { outcome: 'ok', validation: { consoleErrors: ['a'], pageErrors: ['b', 'c'] } }).errorCount, '3');
  assert.equal(show(anthropic, { outcome: 'ok' }).errorCount, '0');
  assert.equal(show(anthropic, { outcome: 'ok', validation: null }).errorCount, '—');
  assert.equal(show(anthropic, { outcome: 'no_html' }).errorCount, '—');
});

test('조건 검사: judgeRequests 판정을 라벨로, validation 없으면 —', () => {
  const check = (url: string) =>
    show(anthropic, { outcome: 'ok', validation: { externalRequests: [{ url, resourceType: 'script' }] } }).requestCheck;
  assert.equal(check(THREE_PINNED_URL), '정상');
  assert.equal(check(THREE_UNPINNED_URL), '지시 미준수');
  assert.equal(check(LIBRARY_URL), '위반');
  assert.equal(show(anthropic, { outcome: 'ok', validation: null }).requestCheck, '—');
  assert.equal(show(anthropic, { outcome: 'truncated' }).requestCheck, '—');
});

test('three.js 버전: 고정 버전(중복 제거·요청 순서·쉼표), 미고정만 있으면 미고정, three 요청 없으면 —', () => {
  const version = (...urls: string[]) =>
    show(anthropic, {
      outcome: 'ok',
      validation: { externalRequests: urls.map((url) => ({ url, resourceType: 'script' })) },
    }).threeVersion;
  assert.equal(
    version(THREE_PINNED_URL, 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/controls/OrbitControls.js'),
    '0.170.0',
  );
  assert.equal(version('https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'), 'r128');
  assert.equal(version(THREE_PINNED_URL, 'https://unpkg.com/three@0.160.1/examples/jsm/Addons.js'), '0.170.0, 0.160.1');
  assert.equal(version('https://esm.sh/three@0.169.0', THREE_PINNED_URL), '0.169.0, 0.170.0');
  assert.equal(version(THREE_UNPINNED_URL), '미고정');
  assert.equal(version(THREE_UNPINNED_URL, 'https://cdn.jsdelivr.net/npm/three/build/three.module.js'), '미고정');
  assert.equal(version(THREE_UNPINNED_URL, THREE_PINNED_URL), '0.170.0'); // 고정 버전이 있으면 그것을
  assert.equal(version(LIBRARY_URL), '—');
  assert.equal(version(), '—');
  assert.equal(show(anthropic, { outcome: 'ok', validation: null }).threeVersion, '—');
});

/* ───────── 판정 ───────── */

test('요구사항 판정: ✓ 충족 · △ 부분 충족 · ✗ 미충족, 판정 없음 → 판정 전, 결과물 없음 → —', () => {
  assert.deepEqual(REQUIREMENT_LABEL, { scene: '장면', seasonCycle: '계절 순환', seasonLook: '계절 모습', seasonLabel: '계절 이름' });

  const judged = show(anthropic, {
    outcome: 'ok',
    judgment: { requirements: { scene: 'pass', seasonCycle: 'partial', seasonLook: 'fail', seasonLabel: 'pass' }, note: '겨울이 늦다' },
  });
  assert.deepEqual(judged.requirements, [
    { key: 'scene', label: '장면', mark: 'pass', text: '✓ 충족' },
    { key: 'seasonCycle', label: '계절 순환', mark: 'partial', text: '△ 부분 충족' },
    { key: 'seasonLook', label: '계절 모습', mark: 'fail', text: '✗ 미충족' },
    { key: 'seasonLabel', label: '계절 이름', mark: 'pass', text: '✓ 충족' },
  ]);
  assert.equal(judged.note, '겨울이 늦다');

  const pending = show(anthropic, { outcome: 'ok' });
  assert.deepEqual(
    pending.requirements.map((r) => [r.label, r.mark, r.text]),
    [
      ['장면', null, '판정 전'],
      ['계절 순환', null, '판정 전'],
      ['계절 모습', null, '판정 전'],
      ['계절 이름', null, '판정 전'],
    ],
  );
  assert.equal(pending.note, null);
  // 검증 전이어도 결과물이 있으면 판정 전
  assert.ok(show(anthropic, { outcome: 'ok', validation: null }).requirements.every((r) => r.text === '판정 전'));

  for (const spec of [{ outcome: 'no_html' }, { outcome: 'api_failed' }] as const) {
    const d = show(anthropic, spec);
    assert.ok(d.requirements.every((r) => r.text === '—' && r.mark === null), spec.outcome);
    assert.equal(d.note, null);
  }
  // 결과물이 없는데 판정 파일이 남아 있어도(check:results가 막는 상태) —
  const stray = buildResult(anthropic, { outcome: 'ok', judgment: {} }).judgment;
  const d = displayModel(entry(anthropic, { outcome: 'truncated' }, undefined, stray));
  assert.ok(d.requirements.every((r) => r.text === '—'));
  assert.equal(d.note, null);
});

/* ───────── 각주 표시 ───────── */

test('출력 토큰 †는 생성 도구가 Codex CLI인 행, 그중 추론 ‡는 회사가 Google인 행', () => {
  const o = show(openai, { outcome: 'ok' });
  const g = show(google, { outcome: 'ok' });
  const a = show(anthropic, { outcome: 'ok' });
  assert.deepEqual([o.outputTokensMark, o.reasoningTokensMark], ['†', '']);
  assert.deepEqual([g.outputTokensMark, g.reasoningTokensMark], ['', '‡']);
  assert.deepEqual([a.outputTokensMark, a.reasoningTokensMark], ['', '']);
  assert.equal(show(openai, null).outputTokensMark, '†'); // 행 기준 (생성 전도)
});

/* ───────── 그 밖 ───────── */

test('ModelDisplay는 JSON으로 그대로 옮길 수 있다 (사이트가 빌드 때 HTML에 넣는다)', () => {
  for (const c of STATUS_CASES) {
    const d = show(c.model, c.result);
    assert.deepEqual(JSON.parse(JSON.stringify(d)), d, c.label);
    assert.equal(d.status.label, c.label);
    assert.equal(d.hasOutput, c.result?.outcome === 'ok');
  }
});

test('fillCount: {N}을 모델 수로 모두 치환', () => {
  assert.equal(fillCount('모델 {N}개', 8), '모델 8개');
  assert.equal(fillCount('지금까지 {N}개 모델이 참여했고, {N}개 모두', 12), '지금까지 12개 모델이 참여했고, 12개 모두');
  assert.equal(fillCount('season-tree-v1', 3), 'season-tree-v1');
  assert.equal(fillCount('모델 {N}개', 0), '모델 0개');
});

test('결과물 iframe sandbox는 allow-scripts 하나뿐 (ADR-009)', () => {
  assert.equal(RESULT_IFRAME_SANDBOX, 'allow-scripts');
  assert.ok(!RESULT_IFRAME_SANDBOX.includes('allow-same-origin'));
});

test('barrel(@opb/core)에서 results·display·sandbox를 가져올 수 있다', () => {
  assert.equal(core.RESULT_IFRAME_SANDBOX, 'allow-scripts');
  for (const fn of [core.loadResults, core.checkResults, core.displayModel, core.statusOf, core.missingOutputReason, core.fillCount]) {
    assert.equal(typeof fn, 'function');
  }
  assert.deepEqual(core.STATUS_LEGEND, STATUS_LEGEND);
});
