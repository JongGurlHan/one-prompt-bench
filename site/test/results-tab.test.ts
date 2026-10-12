import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { displayModel, loadResults, sortByRelease, type ModelDisplay } from '@opb/core';
import { makeDataRoot } from '@opb/core/testing';
import type { ResultView } from '../src/lib/results-view.ts';
import { TEST_BASE, buildSite, type BuiltSite } from './support/build.ts';
import { element, elements, find, findAll, hasAttr, hasClass, text } from './support/html.ts';
import {
  EXPECTED_ORDER,
  EXPECTED_REASON,
  EXPECTED_TONE,
  FAIL_MARK_NOTE,
  FIRST_WITH_OUTPUT,
  NO_OUTPUT_SLUGS,
  RESPONSE_MARK,
  RESPONSE_TEXT,
  TAB_CASES,
  makeNoOutputDataRoot,
  makeResultsTabDataRoot,
} from './support/results-data.ts';

/* 결과 탭(/) dist 검사: 모든 상태 + 판정 있음/없음 데이터, 결과물이 하나도 없는 데이터 (빌드는 각각 한 번) */

const LEGEND = ['정상', '지시 미준수', '위반', '잘림', 'HTML 없음', '거부', '한도 초과', '생성 실패', '생성 전', '검증 전'];
const REQUIREMENTS = ['장면', '계절 순환', '계절 모습', '계절 이름'];
const RECORD_LABELS = ['결과', '조건 검사', '토큰 (입력 / 출력)', '비용 (정가 기준)', '걸린 시간'];
const ALL_PASS = ['✓ 충족', '✓ 충족', '✓ 충족', '✓ 충족'];
const NOT_JUDGED = ['판정 전', '판정 전', '판정 전', '판정 전'];
const NO_OUTPUT = ['—', '—', '—', '—'];

interface Built {
  site: BuiltSite;
  html: string;
  displays: Map<string, ModelDisplay>;
}

let full: Built;
let noOutput: Built;

async function build(dataRoot: string): Promise<Built> {
  const site = await buildSite(dataRoot);
  const displays = new Map((await loadResults(dataRoot)).map((e) => [e.model.slug, displayModel(e)]));
  return { site, html: await site.readText('index.html'), displays };
}

before(async () => {
  full = await build(await makeResultsTabDataRoot());
  noOutput = await build(await makeNoOutputDataRoot());
});

/* ───────── 페이지에서 꺼내기 ───────── */

const byField = (html: string, tag: string, name: string) => find(html, tag, hasAttr('data-field', name));
const isHidden = (html: string, tag: string, name: string) => byField(html, tag, name).attrs.has('hidden');
const modelButtons = (html: string) => elements(html, 'button').filter((b) => b.attrs.has('data-slug'));
const pressed = (html: string) => modelButtons(html).filter((b) => b.attrs.get('aria-pressed') === 'true').map((b) => b.attrs.get('data-slug'));
const views = (html: string): ResultView[] => JSON.parse(find(html, 'script', hasAttr('id', 'result-views')).inner);
const view = (html: string, slug: string) => {
  const found = views(html).find((v) => v.slug === slug);
  assert.ok(found, `no view for ${slug}`);
  return found;
};
const requirementCells = (html: string) => findAll(html, 'dd', hasAttr('data-req'));
const recordCells = (html: string) => findAll(html, 'dd', hasAttr('data-record'));
const label = (slug: string) => TAB_CASES.find((c) => c.model.slug === slug)!.label;

/* ───────── 목록·범례 ───────── */

test('모델 목록은 출시일 최신순이고, 항목마다 표시명·회사 · 생성 도구·출시일·상태 배지가 맞다', () => {
  assert.deepEqual(
    sortByRelease(TAB_CASES.map((c) => c.model)).map((m) => m.slug),
    EXPECTED_ORDER,
  );
  const buttons = modelButtons(full.html);
  assert.deepEqual(buttons.map((b) => b.attrs.get('data-slug')), EXPECTED_ORDER);

  for (const button of buttons) {
    const slug = button.attrs.get('data-slug')!;
    const d = full.displays.get(slug)!;
    assert.equal(button.attrs.get('type'), 'button', slug);
    assert.equal(text(find(button.inner, 'span', hasClass('model-name')).inner), d.displayName);
    assert.equal(text(find(button.inner, 'span', hasClass('model-meta')).inner), `${d.company} · ${d.generator}`);
    assert.equal(text(find(button.inner, 'span', hasClass('model-date')).inner), d.releasedAt);

    const badge = find(button.inner, 'span', hasClass('badge'));
    assert.equal(text(badge.inner), label(slug), slug);
    assert.equal(badge.attrs.get('data-tone'), EXPECTED_TONE[label(slug)], slug);
  }
  // 회사 · 생성 도구 예시 (COPY: Anthropic · Claude Code)
  assert.equal(text(find(buttons[1]!.inner, 'span', hasClass('model-meta')).inner), 'Anthropic · Claude Code');
});

test('목록 제목·정렬 안내와 범례 상자 "상태 표시"의 배지 전부', () => {
  const aside = element(full.html, 'aside');
  assert.equal(text(element(aside.inner, 'h2').inner), '모델');
  assert.ok(text(aside.inner).includes('출시일 최신순'));

  const legend = byField(full.html, 'div', 'legend');
  assert.ok(text(legend.inner).startsWith('상태 표시'), text(legend.inner));
  const badges = findAll(legend.inner, 'span', hasClass('badge'));
  assert.deepEqual(badges.map((b) => text(b.inner)), LEGEND);
  for (const b of badges) assert.equal(b.attrs.get('data-tone'), EXPECTED_TONE[text(b.inner) as keyof typeof EXPECTED_TONE]);
});

/* ───────── 첫 선택 (ADR-025) ───────── */

test('처음에는 결과물이 있는 첫 모델이 선택돼 있고, 그 결과물 iframe 하나만 있다', () => {
  assert.notEqual(EXPECTED_ORDER[0], FIRST_WITH_OUTPUT, '맨 위 모델은 결과물이 없다');
  assert.deepEqual(pressed(full.html), [FIRST_WITH_OUTPUT]);
  for (const b of modelButtons(full.html)) assert.match(b.attrs.get('aria-pressed') ?? '', /^(true|false)$/);

  const iframes = elements(full.html, 'iframe');
  assert.equal(iframes.length, 1);
  const iframe = iframes[0]!;
  assert.equal(iframe.attrs.get('sandbox'), 'allow-scripts');
  assert.equal(iframe.attrs.get('src'), `${TEST_BASE}r/${FIRST_WITH_OUTPUT}/index.html`);
  assert.equal(iframe.attrs.get('title'), 'Model Ok 결과물');
  assert.equal(elements(byField(full.html, 'div', 'viewer').inner, 'iframe').length, 1, 'iframe은 실행 영역 안에 있다');
  assert.ok(isHidden(full.html, 'div', 'missing'));
  assert.ok(isHidden(full.html, 'section', 'response'));
});

test('실행 카드 머리: 표시명, "회사 · 도구로 생성 · 출시일 출시", 다시 시작·새 창에서 열기', () => {
  assert.equal(text(byField(full.html, 'h2', 'name').inner), 'Model Ok');
  assert.equal(text(byField(full.html, 'span', 'meta').inner), 'Anthropic · Claude Code로 생성 · 2026-10-07 출시');

  const actions = byField(full.html, 'div', 'actions');
  assert.ok(!actions.attrs.has('hidden'));
  const restart = find(actions.inner, 'button', hasAttr('data-action', 'restart'));
  assert.equal(restart.attrs.get('type'), 'button');
  assert.equal(text(restart.inner), '다시 시작');

  const open = find(actions.inner, 'a', hasAttr('data-action', 'open'));
  assert.equal(text(open.inner), '새 창에서 열기');
  assert.equal(open.attrs.get('href'), `${TEST_BASE}view/${FIRST_WITH_OUTPUT}/`);
  assert.equal(open.attrs.get('target'), '_blank');
  assert.equal(open.attrs.get('rel'), 'noopener');
});

test('첫 선택 모델의 "요구사항 판정"·"생성 기록" 카드가 HTML에 들어 있다', () => {
  const d = full.displays.get(FIRST_WITH_OUTPUT)!;
  const titles = elements(full.html, 'h3').map((h) => text(h.inner));
  for (const t of ['요구사항 판정', '생성 기록', '응답 원문']) assert.ok(titles.includes(t), `${t} in ${titles}`);

  const reqs = requirementCells(full.html);
  assert.deepEqual(elements(byField(full.html, 'dl', 'requirements').inner, 'dt').map((dt) => text(dt.inner)), REQUIREMENTS);
  assert.deepEqual(reqs.map((dd) => text(dd.inner)), ALL_PASS);
  assert.deepEqual(reqs.map((dd) => dd.attrs.get('data-mark')), ['pass', 'pass', 'pass', 'pass']);
  assert.ok(!isHidden(full.html, 'p', 'note'));
  assert.equal(text(byField(full.html, 'p', 'note').inner), '언덕 위 나무가 계절마다 자연스럽게 바뀐다');

  assert.deepEqual(elements(byField(full.html, 'dl', 'record').inner, 'dt').map((dt) => text(dt.inner)), RECORD_LABELS);
  assert.deepEqual(
    recordCells(full.html).map((dd) => text(dd.inner)),
    [d.status.label, d.requestCheck, d.tokens, d.cost, d.duration],
  );
  assert.deepEqual(recordCells(full.html).map((dd) => text(dd.inner)), ['정상', '정상', '1,000 / 20,000', '$0.10', '3분 34초']);
});

/* ───────── 클라이언트에 넘기는 모델별 값 ───────── */

test('모델별 값(JSON)은 목록 순서대로 전부 있고 displayModel 결과·COPY 문구와 같다', () => {
  assert.deepEqual(views(full.html).map((v) => v.slug), EXPECTED_ORDER);

  for (const slug of EXPECTED_ORDER) {
    const d = full.displays.get(slug)!;
    const v = view(full.html, slug);
    assert.equal(v.displayName, d.displayName);
    assert.equal(v.runMeta, `${d.company} · ${d.generator}로 생성 · ${d.releasedAt} 출시`);
    assert.deepEqual(
      v.output,
      d.hasOutput
        ? { src: `${TEST_BASE}r/${slug}/index.html`, frameTitle: `${d.displayName} 결과물`, viewHref: `${TEST_BASE}view/${slug}/` }
        : null,
      slug,
    );
    assert.deepEqual(
      v.missing,
      d.hasOutput ? null : { reason: EXPECTED_REASON[slug], responseTextSrc: RESPONSE_TEXT[slug] ? `${TEST_BASE}r/${slug}/response.txt` : null },
      slug,
    );
    assert.deepEqual(v.requirements, d.requirements, slug);
    assert.equal(v.note, d.note, slug);
    assert.deepEqual(
      v.record,
      { status: d.status.label, requestCheck: d.requestCheck, tokens: d.tokens, cost: d.cost, duration: d.duration },
      slug,
    );
  }
});

test('이유 문구는 COPY "결과물이 없을 때" 그대로이고, 원문은 거부·잘림·HTML 없음만 불러온다', () => {
  const missing = views(full.html).filter((v) => v.missing);
  assert.deepEqual(missing.map((v) => v.slug).sort(), Object.keys(EXPECTED_REASON).sort());
  for (const v of missing) assert.equal(v.missing!.reason, EXPECTED_REASON[v.slug], v.slug);
  assert.deepEqual(
    missing.filter((v) => v.missing!.responseTextSrc).map((v) => v.slug).sort(),
    Object.keys(RESPONSE_TEXT).sort(),
  );
});

test('판정 기호·판정 전·—: 판정한 모델은 기호, 판정이 없으면 판정 전, 결과물이 없으면 —', () => {
  const texts = (slug: string) => view(full.html, slug).requirements.map((r) => r.text);
  assert.deepEqual(texts('model-ok'), ALL_PASS);
  assert.deepEqual(texts('model-miss'), ['✓ 충족', '△ 부분 충족', '✓ 충족', '✓ 충족']);
  assert.deepEqual(texts('model-fail-mark'), ['△ 부분 충족', '✓ 충족', '✗ 미충족', '✓ 충족']);
  assert.equal(view(full.html, 'model-fail-mark').note, FAIL_MARK_NOTE);
  for (const slug of ['model-violation', 'model-unvalidated']) {
    assert.deepEqual(texts(slug), NOT_JUDGED, slug);
    assert.equal(view(full.html, slug).note, null, slug);
  }
  for (const slug of Object.keys(EXPECTED_REASON)) {
    assert.deepEqual(texts(slug), NO_OUTPUT, slug);
    assert.equal(view(full.html, slug).note, null, slug);
  }
});

test('생성 기록: 결과물이 없거나 생성 전이면 값이 —다', () => {
  assert.deepEqual(view(full.html, 'model-failed').record, {
    status: '생성 실패',
    requestCheck: '—',
    tokens: '—',
    cost: '$0.00',
    duration: '—',
  });
  assert.deepEqual(view(full.html, 'model-newest').record, {
    status: '생성 전',
    requestCheck: '—',
    tokens: '—',
    cost: '—',
    duration: '—',
  });
  assert.equal(view(full.html, 'model-unvalidated').record.status, '검증 전');
});

/* ───────── 원문·문구 ───────── */

test('응답 원문은 빌드 HTML에 넣지 않고, {N}은 모델 수로 바뀐다', () => {
  for (const { html } of [full, noOutput]) {
    assert.ok(!html.includes(RESPONSE_MARK), 'response.txt text leaked into index.html');
    assert.ok(!html.includes('{N}'));
  }
  assert.ok(text(element(full.html, 'main').inner).includes(`모델 ${TAB_CASES.length}개`));
  assert.ok(text(element(noOutput.html, 'main').inner).includes(`모델 ${NO_OUTPUT_SLUGS.length}개`));
  // 원문 사본은 있다 (선택할 때 fetch)
  for (const slug of Object.keys(RESPONSE_TEXT)) assert.ok(full.site.has(`r/${slug}/response.txt`), slug);
});

/* ───────── 결과물이 하나도 없을 때 ───────── */

test('결과물이 하나도 없으면 맨 위 모델이 선택되고 실행 중인 결과물이 없다', () => {
  const [top] = NO_OUTPUT_SLUGS;
  assert.deepEqual(modelButtons(noOutput.html).map((b) => b.attrs.get('data-slug')), NO_OUTPUT_SLUGS);
  assert.deepEqual(pressed(noOutput.html), [top]);

  assert.deepEqual(elements(noOutput.html, 'iframe'), []);
  assert.ok(isHidden(noOutput.html, 'div', 'actions'));
  for (const a of elements(noOutput.html, 'a')) assert.doesNotMatch(a.attrs.get('href') ?? '', /view\//, a.tag);

  assert.equal(text(byField(noOutput.html, 'h2', 'name').inner), 'Model Truncated');
  assert.ok(!isHidden(noOutput.html, 'div', 'missing'));
  assert.equal(text(byField(noOutput.html, 'p', 'reason').inner), '출력 상한에 닿아 응답이 중간에 끊겼어요.');

  // 원문 카드는 보이지만 내용은 스크립트가 불러온다
  assert.ok(!isHidden(noOutput.html, 'section', 'response'));
  assert.equal(byField(noOutput.html, 'pre', 'response-text').inner, '');
  assert.ok(isHidden(noOutput.html, 'p', 'response-error'));

  assert.deepEqual(requirementCells(noOutput.html).map((dd) => text(dd.inner)), NO_OUTPUT);
  assert.deepEqual(requirementCells(noOutput.html).map((dd) => dd.attrs.get('data-mark')), ['none', 'none', 'none', 'none']);
  assert.ok(isHidden(noOutput.html, 'p', 'note'));
  assert.deepEqual(recordCells(noOutput.html).map((dd) => text(dd.inner)), ['잘림', '—', '1,000 / 20,000', '$0.10', '3분 34초']);
});

test('모델이 하나도 없어도 빌드되고 목록·실행 카드가 없다', async () => {
  const site = await buildSite(await makeDataRoot([]));
  const html = await site.readText('index.html');
  assert.equal(text(element(html, 'h1').inner), '사계절이 바뀌는 3D 나무');
  assert.ok(text(element(html, 'main').inner).includes('모델 0개'));
  assert.deepEqual(modelButtons(html), []);
  assert.deepEqual(elements(html, 'iframe'), []);
});
