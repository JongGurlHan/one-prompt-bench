import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { STATUS_LEGEND, displayModel, loadResults, type ModelDisplay, type Provider } from '@opb/core';
import { makeDataRoot } from '@opb/core/testing';
import { TEST_BASE, buildSite, type BuiltSite } from './support/build.ts';
import { element, elements, find, findAll, hasAttr, hasClass, text, urls, type Element } from './support/html.ts';
import { EXPECTED_ERROR_COUNT, EXPECTED_ORDER, EXPECTED_TONE, TAB_CASES, makeResultsTabDataRoot } from './support/results-data.ts';

/* 비교표 탭(/compare/) dist 검사: 결과 탭과 같은 데이터(상태 라벨 10개 + 판정 있음/없음), 모델 0개 데이터 (빌드는 각각 한 번) */

const PAGE = 'compare/index.html';

// docs/COPY.md "비교표 탭" 그대로
const DESCRIPTION = '모델마다 어떻게 만들어졌고, 얼마나 들었고, 프롬프트를 얼마나 지켰는지 나란히 봐요. 모델은 출시일 최신순이에요.';
const TABLES = [
  { key: 'models', title: '수록 모델', columns: ['모델', '회사', '출시일', '생성 도구', '결과', '파일 크기', 'three.js 버전'] },
  { key: 'record', title: '생성 기록', columns: ['모델', '입력 토큰', '출력 토큰', '그중 추론', '비용 (정가 기준)', '걸린 시간', '재시도'] },
  { key: 'checks', title: '요구사항과 검증', columns: ['모델', '장면', '계절 순환', '계절 모습', '계절 이름', '조건 검사', '에러 수'] },
] as const;
const NOTICE = '비용은 API 정가로 계산한 값이에요. 실제로는 구독과 무료 티어로 생성해서 청구된 금액은 없어요.';
const FOOTNOTES = [
  '† Codex CLI는 출력 상한을 지정할 수 없어 모델 기본값으로 생성했어요. 다른 모델의 출력 상한은 65,536 토큰이에요.',
  '‡ Gemini 3.8 Flash는 추론 강도가 low·medium·high 세 단계라 high가 최고 단계예요. 다른 모델은 high 위에 단계가 더 있어요.',
  '§ Claude Code와 Codex CLI는 프롬프트 밖에 도구 정의 같은 내용을 덧붙여 보내요. 입력 토큰에 이 몫이 들어 있어요(Claude Code 약 600토큰, Codex CLI 약 7,000토큰).',
];
const LEGEND = ['✓ 충족 · △ 부분 충족 · ✗ 미충족 (사람이 판정)', '조건 검사: 정상 · 지시 미준수 · 위반'];

/** 각주 기호가 붙는 칸 (DATA "값 계산·포맷": § Claude Code·Codex CLI, † Codex CLI, ‡ Google) */
const EXPECTED_MARKS: Readonly<Record<Provider, Record<'inputTokens' | 'outputTokens' | 'reasoningTokens', string>>> = {
  anthropic: { inputTokens: '§', outputTokens: '', reasoningTokens: '' },
  openai: { inputTokens: '§', outputTokens: '†', reasoningTokens: '' },
  google: { inputTokens: '', outputTokens: '', reasoningTokens: '‡' },
};

interface Built {
  site: BuiltSite;
  html: string;
  displays: Map<string, ModelDisplay>;
}

let full: Built;
let empty: Built;

async function build(dataRoot: string): Promise<Built> {
  const site = await buildSite(dataRoot);
  const displays = new Map((await loadResults(dataRoot)).map((e) => [e.model.slug, displayModel(e)]));
  return { site, html: await site.readText(PAGE), displays };
}

before(async () => {
  full = await build(await makeResultsTabDataRoot());
  empty = await build(await makeDataRoot([]));
});

/* ───────── 페이지에서 꺼내기 ───────── */

type TableKey = (typeof TABLES)[number]['key'];
const table = (html: string, key: TableKey) => find(html, 'table', hasAttr('data-table', key));
const rows = (html: string, key: TableKey) => findAll(table(html, key).inner, 'tr', hasAttr('data-slug'));
const row = (html: string, key: TableKey, slug: string) => {
  const found = rows(html, key).find((r) => r.attrs.get('data-slug') === slug);
  assert.ok(found, `no ${key} row for ${slug}`);
  return found;
};
/** 행의 칸 (모델 이름은 행 머리 th, 나머지는 td) */
const cell = (r: Element, col: string) =>
  findAll(r.inner, 'td', hasAttr('data-col', col))[0] ?? find(r.inner, 'th', hasAttr('data-col', col));
/** 위첨자(각주 기호)를 뺀 칸의 글자 */
const value = (el: Element) => text(el.inner.replace(/<sup\b[\s\S]*?<\/sup>/gi, ''));
/** 칸 안 위첨자의 글자 */
const marks = (el: Element) => elements(el.inner, 'sup').map((s) => text(s.inner)).join('');
const provider = (slug: string) => TAB_CASES.find((c) => c.model.slug === slug)!.model.provider;
const byField = (html: string, tag: string, name: string) => find(html, tag, hasAttr('data-field', name));

/* ───────── 머리·문구 ───────── */

test('비교표 탭: lang·title, 제목·설명, 표 3개의 제목과 열 이름이 COPY 그대로', () => {
  assert.equal(element(full.html, 'html').attrs.get('lang'), 'ko');
  assert.equal(text(element(full.html, 'title').inner), '비교표 — One Prompt Bench');

  const main = element(full.html, 'main').inner;
  assert.equal(text(element(main, 'h1').inner), '비교표');
  assert.equal(text(element(main, 'p').inner), DESCRIPTION);
  assert.deepEqual(elements(main, 'h2').map((h) => text(h.inner)), TABLES.map((t) => t.title));

  assert.equal(elements(main, 'table').length, 3);
  for (const t of TABLES) {
    const thead = element(table(full.html, t.key).inner, 'thead');
    const ths = elements(thead.inner, 'th');
    assert.deepEqual(ths.map((th) => text(th.inner)), t.columns, t.key);
    for (const th of ths) assert.equal(th.attrs.get('scope'), 'col', t.key);
  }
});

test('표마다 보이는 h2를 aria-labelledby로 가리키고, 컨테이너는 키보드로 스크롤되는 region이다', () => {
  for (const t of TABLES) {
    const id = table(full.html, t.key).attrs.get('aria-labelledby');
    assert.ok(id, t.key);
    assert.equal(text(find(full.html, 'h2', hasAttr('id', id)).inner), t.title);

    const wrap = findAll(full.html, 'div', hasAttr('aria-labelledby', id))[0];
    assert.ok(wrap, `${t.key}: no region container`);
    assert.equal(wrap.attrs.get('role'), 'region');
    assert.equal(wrap.attrs.get('tabindex'), '0');
    assert.equal(elements(wrap.inner, 'table').length, 1, `${t.key}: 컨테이너 안에 표 하나`);
    assert.equal(find(wrap.inner, 'table').attrs.get('data-table'), t.key);
  }
  // id는 페이지에서 하나씩
  const ids = [...full.html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, ids.join(', '));
});

test('표마다 행은 모델 수만큼 출시일 최신순이고, 모델 이름 칸은 링크 없는 행 머리다', () => {
  for (const t of TABLES) {
    const rs = rows(full.html, t.key);
    assert.deepEqual(rs.map((r) => r.attrs.get('data-slug')), EXPECTED_ORDER, t.key);
    for (const r of rs) {
      const slug = r.attrs.get('data-slug')!;
      const name = find(r.inner, 'th', hasAttr('data-col', 'displayName'));
      assert.equal(name.attrs.get('scope'), 'row');
      assert.equal(text(name.inner), full.displays.get(slug)!.displayName);
      assert.equal(elements(r.inner, 'td').length, t.columns.length - 1, `${t.key}/${slug}: 열을 숨기지 않는다`);
    }
    // 모델별 주소(딥링크)를 만들지 않는다 (ADR-019)
    assert.deepEqual(elements(table(full.html, t.key).inner, 'a'), [], t.key);
  }
});

/* ───────── 표 1 수록 모델 ───────── */

test('표 1 수록 모델: 회사·출시일·생성 도구·결과 배지·파일 크기·three.js 버전이 displayModel 값과 같다', () => {
  const labels = new Set<string>();
  for (const slug of EXPECTED_ORDER) {
    const d = full.displays.get(slug)!;
    const r = row(full.html, 'models', slug);
    assert.equal(value(cell(r, 'company')), d.company, slug);
    assert.equal(value(cell(r, 'releasedAt')), d.releasedAt, slug);
    assert.equal(value(cell(r, 'generator')), d.generator, slug);
    assert.equal(value(cell(r, 'fileSize')), d.fileSize, slug);
    assert.equal(value(cell(r, 'threeVersion')), d.threeVersion, slug);

    const badges = findAll(cell(r, 'status').inner, 'span', hasClass('badge'));
    assert.equal(badges.length, 1, slug);
    const label = text(badges[0]!.inner);
    assert.equal(label, d.status.label, slug);
    assert.equal(badges[0]!.attrs.get('data-tone'), EXPECTED_TONE[d.status.label], slug);
    labels.add(label);
  }
  assert.deepEqual([...labels].sort(), [...STATUS_LEGEND].sort(), '상태 라벨 10개가 모두 나온다');

  // 표시 예: 생성 도구는 provider로 정해지고(생성 전도), 버전·크기가 없으면 —
  assert.deepEqual(
    ['company', 'generator', 'fileSize', 'threeVersion'].map((c) => value(cell(row(full.html, 'models', 'model-pending'), c))),
    ['Google', 'Gemini API', '—', '—'],
  );
  assert.equal(value(cell(row(full.html, 'models', 'model-miss'), 'threeVersion')), '미고정');
  assert.equal(value(cell(row(full.html, 'models', 'model-ok'), 'generator')), 'Claude Code');
  assert.equal(value(cell(row(full.html, 'models', 'model-miss'), 'generator')), 'Codex CLI');
});

/* ───────── 표 2 생성 기록 ───────── */

test('표 2 생성 기록: 값은 displayModel 그대로이고, § † ‡는 해당 행의 해당 칸에만 붙는다(값이 —여도)', () => {
  for (const slug of EXPECTED_ORDER) {
    const d = full.displays.get(slug)!;
    const r = row(full.html, 'record', slug);
    for (const col of ['inputTokens', 'outputTokens', 'reasoningTokens', 'cost', 'duration', 'retries'] as const) {
      assert.equal(value(cell(r, col)), d[col], `${slug}/${col}`);
    }
    const expected = EXPECTED_MARKS[provider(slug)];
    for (const col of ['inputTokens', 'outputTokens', 'reasoningTokens'] as const) {
      assert.equal(marks(cell(r, col)), expected[col], `${slug}/${col}`);
    }
    for (const col of ['cost', 'duration', 'retries']) assert.equal(marks(cell(r, col)), '', `${slug}/${col}`);
    assert.equal(elements(r.inner, 'sup').length, Object.values(expected).filter(Boolean).length, slug);
  }

  const cells = (slug: string) =>
    ['inputTokens', 'outputTokens', 'reasoningTokens', 'cost', 'duration', 'retries'].map((c) => {
      const el = cell(row(full.html, 'record', slug), c);
      return value(el) + marks(el);
    });
  assert.deepEqual(cells('model-ok'), ['1,000§', '20,000', full.displays.get('model-ok')!.reasoningTokens, '$0.10', '3분 34초', '0']);
  // 생성 실패(Codex CLI): 토큰은 —인데 기호는 남는다
  assert.deepEqual(cells('model-failed'), ['—§', '—†', '—', '$0.00', '—', '2']);
  // 한도 초과(Claude Code)·생성 전(Google)
  assert.equal(cells('model-usage-limit')[0], '—§');
  assert.deepEqual(cells('model-pending'), ['—', '—', '—‡', '—', '—', '—']);
  assert.deepEqual(cells('model-newest'), ['—', '—', '—‡', '—', '—', '—']);
});

test('표 2 위에 비용 안내 박스, 아래에 각주 3줄(† ‡ § 순서, 기호는 위첨자)', () => {
  const notice = byField(full.html, 'p', 'notice');
  assert.equal(text(notice.inner), NOTICE);
  const recordTable = full.html.indexOf('data-table="record"');
  assert.ok(full.html.indexOf('data-field="notice"') < recordTable, '안내 박스는 표 위');

  const footnotes = byField(full.html, 'ul', 'footnotes');
  assert.ok(full.html.indexOf('data-field="footnotes"') > recordTable, '각주는 표 아래');
  const items = elements(footnotes.inner, 'li');
  assert.deepEqual(items.map((li) => text(li.inner)), FOOTNOTES);
  assert.deepEqual(items.map((li) => marks(li)), ['†', '‡', '§']);
  // "(추가, ADR-030)"은 출처 표시라 화면에 없다
  assert.ok(!full.html.includes('ADR-030'));
  assert.ok(!text(element(full.html, 'main').inner).includes('(추가'));
});

/* ───────── 표 3 요구사항과 검증 ───────── */

test('표 3 요구사항과 검증: 판정 칸은 requirements[i].text, 조건 검사·에러 수는 displayModel 값', () => {
  const keys = ['scene', 'seasonCycle', 'seasonLook', 'seasonLabel'] as const;
  for (const slug of EXPECTED_ORDER) {
    const d = full.displays.get(slug)!;
    const r = row(full.html, 'checks', slug);
    keys.forEach((key, i) => {
      const c = cell(r, key);
      assert.equal(d.requirements[i]!.key, key);
      assert.equal(value(c), d.requirements[i]!.text, `${slug}/${key}`);
      assert.equal(c.attrs.get('data-mark'), d.requirements[i]!.mark ?? 'none', `${slug}/${key}`);
    });
    assert.equal(value(cell(r, 'requestCheck')), d.requestCheck, slug);
    assert.equal(value(cell(r, 'errorCount')), d.errorCount, slug);
    assert.equal(value(cell(r, 'errorCount')), EXPECTED_ERROR_COUNT[slug], slug);
  }
  const reqs = (slug: string) => keys.map((k) => value(cell(row(full.html, 'checks', slug), k)));
  assert.deepEqual(reqs('model-ok'), ['✓ 충족', '✓ 충족', '✓ 충족', '✓ 충족']);
  assert.deepEqual(reqs('model-fail-mark'), ['△ 부분 충족', '✓ 충족', '✗ 미충족', '✓ 충족']);
  assert.deepEqual(reqs('model-violation'), ['판정 전', '판정 전', '판정 전', '판정 전']);
  assert.deepEqual(reqs('model-truncated'), ['—', '—', '—', '—']);
  assert.deepEqual(
    ['requestCheck', 'errorCount'].map((c) => value(cell(row(full.html, 'checks', 'model-fail-mark'), c))),
    ['정상', '3'],
  );
  assert.equal(value(cell(row(full.html, 'checks', 'model-violation'), 'requestCheck')), '위반');
  assert.equal(value(cell(row(full.html, 'checks', 'model-miss'), 'requestCheck')), '지시 미준수');
});

test('표 3 아래 범례 두 줄과 "판정 기준 보기" 링크(base 포함 /prompt/#judge)', () => {
  const legend = byField(full.html, 'div', 'legend');
  assert.ok(full.html.indexOf('data-field="legend"') > full.html.indexOf('data-table="checks"'), '범례는 표 3 아래');
  assert.deepEqual(elements(legend.inner, 'span').map((s) => text(s.inner)), LEGEND);
  const links = elements(legend.inner, 'a');
  assert.deepEqual(
    links.map((a) => [text(a.inner), a.attrs.get('href')]),
    [['판정 기준 보기', `${TEST_BASE}prompt/#judge`]],
  );
});

/* ───────── 헤더·결과 탭·결과물 ───────── */

test('헤더 탭은 결과·비교표 2개이고, 현재 탭에만 aria-current="page"가 있다 (결과 탭에도 비교표 링크)', async () => {
  const tabs = (html: string) =>
    elements(element(element(html, 'header').inner, 'nav').inner, 'a').map((a) => ({
      label: text(a.inner),
      href: a.attrs.get('href'),
      current: a.attrs.get('aria-current'),
    }));
  assert.deepEqual(tabs(full.html), [
    { label: '결과', href: TEST_BASE, current: undefined },
    { label: '비교표', href: `${TEST_BASE}compare/`, current: 'page' },
  ]);
  assert.deepEqual(tabs(await full.site.readText('index.html')), [
    { label: '결과', href: TEST_BASE, current: 'page' },
    { label: '비교표', href: `${TEST_BASE}compare/`, current: undefined },
  ]);
});

test('결과 탭에는 각주 기호가 없다 (각주는 비교표에만 있다)', async () => {
  const results = await full.site.readText('index.html');
  for (const mark of ['§', '†', '‡']) assert.ok(!results.includes(mark), `index.html contains ${mark}`);
});

test('비교표는 결과물을 실행하거나 직접 링크하지 않는다 (iframe·/r/ 주소 없음)', () => {
  assert.deepEqual(elements(full.html, 'iframe'), []);
  assert.ok(!full.html.includes(`${TEST_BASE}r/`));
  for (const url of urls(full.html)) assert.doesNotMatch(url, /(^|\/)r\//, url);
  for (const a of elements(full.html, 'a')) assert.doesNotMatch(a.attrs.get('href') ?? '', /view\//, a.tag);
});

/* ───────── 모델이 없을 때·문구 고정 ───────── */

test('모델이 하나도 없어도 빌드되고 표 3개는 열 머리만 있다', () => {
  assert.equal(text(element(empty.html, 'h1').inner), '비교표');
  assert.equal(elements(element(empty.html, 'main').inner, 'table').length, 3);
  for (const t of TABLES) {
    assert.deepEqual(rows(empty.html, t.key), [], t.key);
    assert.deepEqual(elements(element(table(empty.html, t.key).inner, 'thead').inner, 'th').map((th) => text(th.inner)), t.columns);
  }
  assert.deepEqual(elements(byField(empty.html, 'ul', 'footnotes').inner, 'li').map((li) => text(li.inner)), FOOTNOTES);
});

test('표의 행을 빼면 페이지는 모델 수와 관계없이 같다 (숫자를 하드코딩하지 않는다)', () => {
  const withoutRows = (html: string) => html.replace(/<tbody\b[^>]*>[\s\S]*?<\/tbody>/g, '<tbody></tbody>');
  assert.notEqual(full.displays.size, empty.displays.size);
  assert.equal(withoutRows(full.html), withoutRows(empty.html));
  assert.ok(!full.html.includes('{N}'));
});
