import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { before, test } from 'node:test';
import { CURRENT_PROMPT, loadJudgingCriteria, loadPrompt, type JudgingCriteria, type PromptSpec } from '@opb/core';
import { FAKE_MODELS, makeDataRoot } from '@opb/core/testing';
import { renderPromptBody } from '../src/lib/prompt-body.ts';
import { TEST_BASE, buildSite, sitePages, type BuiltSite } from './support/build.ts';
import { decodeEntities, element, elements, find, findAll, hasAttr, hasClass, metaContent, text } from './support/html.ts';
import { TAB_CASES, makeResultsTabDataRoot } from './support/results-data.ts';

/* ────────────────────────────────────────────────────────────
 * 프롬프트 탭(/prompt/)·소개 탭(/intro/)·헤더 탭 4개 dist 검사 (빌드는 데이터마다 한 번)
 *  - full: 결과 탭 데이터(모델 12개) + 레포 prompts/ 복사본 (makeDataRoot가 복사한다)
 *  - custom: 모델 4개 + 데이터 루트의 prompts/를 테스트가 바꾼 것 → 사이트가 OPB_DATA_ROOT의 prompts/를 읽는지,
 *    원문·시스템 프롬프트·기준표의 글자를 이스케이프하는지 본다. 레포의 prompts/는 건드리지 않는다.
 * ──────────────────────────────────────────────────────────── */

const PROMPT_PAGE = 'prompt/index.html';
const INTRO_PAGE = 'intro/index.html';
const PROMPT_BASE = `${CURRENT_PROMPT.id}-${CURRENT_PROMPT.version}`;

const SITE_DESCRIPTION =
  '같은 프롬프트를 여러 AI 모델에 한 번씩 보내, 브라우저에서 바로 실행되는 3D 나무를 받았어요. 새 모델이 나오면 같은 프롬프트로 한 그루씩 더해요.';

// docs/COPY.md "공통" 탭 순서 (첫 화면은 결과 탭 /)
const PAGES = [
  { file: INTRO_PAGE, title: '소개 — One Prompt Bench', tab: '소개' },
  { file: 'index.html', title: 'One Prompt Bench', tab: '결과' },
  { file: 'compare/index.html', title: '비교표 — One Prompt Bench', tab: '비교표' },
  { file: PROMPT_PAGE, title: '프롬프트 — One Prompt Bench', tab: '프롬프트' },
] as const;
const TABS = [
  { label: '소개', href: `${TEST_BASE}intro/` },
  { label: '결과', href: TEST_BASE },
  { label: '비교표', href: `${TEST_BASE}compare/` },
  { label: '프롬프트', href: `${TEST_BASE}prompt/` },
];

// docs/COPY.md "프롬프트 탭" 그대로
const PROMPT_DESCRIPTION = '모든 모델에 아래 문장을 한 글자도 바꾸지 않고 그대로 보냈어요. 레퍼런스 이미지는 없어요.';
const CONDITIONS = [
  ['횟수', '모델마다 1회, 사람이 고치지 않음'],
  ['추론 강도', 'high (회사마다 단계 구성이 달라요, 비교표 각주 참고)'],
  ['출력 상한', '65,536 토큰 (도구별 차이는 비교표 각주 참고)'],
  ['생성 도구', 'Claude Code · Codex CLI · Gemini API'],
  ['재시도', '기술적 실패일 때만'],
  ['시스템 프롬프트', '"사용자의 요청에 답하세요." (모든 도구 같음)'],
];
const JUDGE_DESCRIPTION =
  '결과물을 한 바퀴 넘게 지켜보고, 5·15·25·35초에 찍은 스크린샷 4장을 함께 봐요. "계절마다 10초"는 스크린샷이 각각 맞는 계절인지로 판단해요.';
const CRITERIA_COLUMNS = ['요구사항', '✓ 충족', '△ 부분 충족', '✗ 미충족'];

// docs/COPY.md "소개 탭" 그대로 ({N}은 모델 수)
const INTRO = {
  label: 'AI 모델 결과물 비교',
  title: '하나의 프롬프트, 모델마다 다른 나무',
  lead: SITE_DESCRIPTION,
  actions: [
    { label: '결과 보러 가기', href: TEST_BASE, primary: true },
    { label: '비교표 보기', href: `${TEST_BASE}compare/`, primary: false },
    { label: '프롬프트 전문', href: `${TEST_BASE}prompt/`, primary: false },
  ],
  chips: (n: number) => [`모델 ${n}개`, 'season-tree-v1', '모델당 1회 생성'],
  cards: (n: number) => [
    {
      label: 'What',
      title: '같은 과제, 다른 모델',
      body: `2026년 9월 이후 출시된 OpenAI·Anthropic·Google 모델에 똑같은 프롬프트를 보냈어요. 지금까지 ${n}개 모델이 참여했고, 새 모델도 같은 조건으로 추가해요.`,
    },
    {
      label: 'How',
      title: '같은 조건, 자동 기록',
      body: '모델마다 한 번, 추론 강도 high로 만들었고 사람이 손대지 않았어요. 생성과 검증은 프로그램이 자동으로 하고, 토큰과 시간과 에러를 기록해요.',
    },
    {
      label: 'Caution',
      title: '순위가 아니라 기록',
      body: '모델마다 한 번씩만 생성해서 운이 섞여 있어요. 생성 도구마다 조건이 조금씩 다른 부분은 비교표 각주에 적었어요.',
    },
  ],
  inclusionTitle: '수록 기준',
  inclusion: '2026년 9월 1일 이후 출시된 OpenAI·Anthropic·Google 모델이 대상이에요. 새로 추가되는 모델도 이 기준을 따라요.',
  excludedTitle: '대상에서 뺀 모델',
  excluded: [
    ['Claude Mythos 5.1', '처음부터 대상에서 제외'],
    ['Claude Fable 5.1', '사용 중인 구독 플랜에서 추가 결제가 필요해 제외'],
  ],
};

/* ───────── custom 데이터의 prompts/ ───────── */

const CUSTOM_USER = [
  '첫 문단 <b>굵게</b> & "따옴표"',
  '</script><script>window.opbInjected = 1</script>',
  '',
  '- 항목 하나',
  '- 항목 `둘`',
  '- 항목 셋',
  '',
  '마지막 문단',
  '',
].join('\n');
const CUSTOM_SYSTEM = '다른 지시문 <b>& 끝</b>\n';
const CUSTOM_CELL = '표시 없음 <em>&</em>';

interface Built {
  dataRoot: string;
  site: BuiltSite;
  modelCount: number;
  prompt: PromptSpec;
  criteria: JudgingCriteria;
  page(file: string): Promise<string>;
}

let full: Built;
let custom: Built;

async function build(dataRoot: string, modelCount: number): Promise<Built> {
  const site = await buildSite(dataRoot);
  const { id, version } = CURRENT_PROMPT;
  return {
    dataRoot,
    site,
    modelCount,
    prompt: await loadPrompt(dataRoot, id, version),
    criteria: await loadJudgingCriteria(dataRoot, id, version),
    page: (file) => site.readText(file),
  };
}

before(async () => {
  full = await build(await makeResultsTabDataRoot(), TAB_CASES.length);

  const root = await makeDataRoot();
  const prompts = path.join(root, 'prompts');
  await writeFile(path.join(prompts, `${PROMPT_BASE}.md`), CUSTOM_USER);
  await writeFile(path.join(prompts, `${PROMPT_BASE}.system.md`), CUSTOM_SYSTEM);
  const judging = path.join(prompts, `${PROMPT_BASE}.judging.md`);
  const original = await readFile(judging, 'utf8');
  assert.equal(original.split('| 표시 없음 |').length, 2, 'judging.md의 "표시 없음" 칸은 하나다');
  await writeFile(judging, original.replace('| 표시 없음 |', `| ${CUSTOM_CELL} |`));
  custom = await build(root, FAKE_MODELS.length);
});

/* ───────── 페이지에서 꺼내기 ───────── */

const main = (html: string) => element(html, 'main').inner;
const byField = (html: string, tag: string, name: string) => find(html, tag, hasAttr('data-field', name));
const navTabs = (html: string) =>
  elements(element(element(html, 'header').inner, 'nav').inner, 'a').map((a) => ({
    label: text(a.inner),
    href: a.attrs.get('href'),
    current: a.attrs.get('aria-current'),
  }));
const conditionRows = (html: string) =>
  findAll(byField(html, 'dl', 'conditions').inner, 'div').map((row) => [text(element(row.inner, 'dt').inner), text(element(row.inner, 'dd').inner)]);
const criteriaTable = (html: string) => find(html, 'table', hasAttr('data-table', 'criteria'));
/** <script type="application/json" id="prompt-source">의 값 */
const promptSource = (html: string): unknown => {
  const script = find(html, 'script', hasAttr('id', 'prompt-source'));
  assert.equal(script.attrs.get('type'), 'application/json');
  return JSON.parse(script.inner);
};

/* ───────── 헤더 탭 · 제목 ───────── */

test('네 탭의 lang·<title>·meta description', async () => {
  for (const p of PAGES) {
    const html = await full.page(p.file);
    assert.equal(element(html, 'html').attrs.get('lang'), 'ko', p.file);
    assert.equal(text(element(html, 'title').inner), p.title, p.file);
    assert.equal(metaContent(html, 'description'), SITE_DESCRIPTION, p.file);
    assert.equal(metaContent(html, 'og:description'), SITE_DESCRIPTION, p.file);
  }
});

test('헤더 탭은 소개 · 결과 · 비교표 · 프롬프트 4개(base 포함)이고, 현재 탭에만 aria-current="page"가 있다', async () => {
  for (const p of PAGES) {
    const html = await full.page(p.file);
    assert.equal(element(element(html, 'header').inner, 'nav').attrs.get('aria-label'), '주요 메뉴');
    assert.deepEqual(
      navTabs(html),
      TABS.map((t) => ({ ...t, current: t.label === p.tab ? 'page' : undefined })),
      p.file,
    );
  }
  // 헤더 탭이 가리키는 페이지는 모두 있다
  for (const t of TABS) assert.ok(full.site.has(`${t.href.slice(TEST_BASE.length)}index.html`), t.href);
});

test('첫 화면(/)은 여전히 결과 탭이다', async () => {
  const html = await full.page('index.html');
  assert.equal(text(element(main(html), 'h1').inner), '사계절이 바뀌는 3D 나무');
  assert.ok(html.includes('data-results-tab'), '결과 탭의 모델 목록이 첫 화면에 있다');
  assert.equal(navTabs(html).find((t) => t.current === 'page')?.label, '결과');
});

/* ───────── 프롬프트 탭 ───────── */

test('프롬프트 탭: 제목·설명, 원문 카드의 칩 season-tree-v1과 복사 버튼', async () => {
  const html = await full.page(PROMPT_PAGE);
  assert.equal(text(element(main(html), 'h1').inner), '프롬프트');
  assert.ok(text(main(html)).includes(PROMPT_DESCRIPTION));

  const card = byField(html, 'section', 'prompt-card');
  assert.equal(text(find(card.inner, 'span', hasAttr('data-field', 'prompt-id')).inner), 'season-tree-v1');
  const buttons = elements(card.inner, 'button');
  assert.equal(buttons.length, 1);
  const button = buttons[0]!;
  assert.equal(button.attrs.get('type'), 'button');
  assert.equal(button.attrs.get('data-action'), 'copy');
  assert.equal(text(button.inner), '복사');
  assert.equal(button.attrs.get('data-copied-label'), '복사됨');
});

test('프롬프트 탭: 본문은 데이터 루트의 프롬프트 파일을 렌더링한 것이고, 복사할 원문(끝 줄바꿈 포함)은 JSON으로 넘긴다', async () => {
  const html = await full.page(PROMPT_PAGE);
  const body = byField(html, 'div', 'prompt-body');
  assert.equal(body.inner, renderPromptBody(full.prompt.user));
  assert.equal(elements(body.inner, 'p').length, 2);
  assert.equal(elements(element(body.inner, 'ul').inner, 'li').length, 4);

  assert.equal(promptSource(html), full.prompt.user);
  assert.ok(full.prompt.user.endsWith('\n'));
  assert.equal(full.prompt.user, await readFile(path.join(full.dataRoot, 'prompts', `${PROMPT_BASE}.md`), 'utf8'));
});

test('프롬프트 탭: "생성 조건" 행 6개 (출력 상한은 DEFAULT_MAX_OUTPUT_TOKENS, 시스템 프롬프트는 .system.md에서)', async () => {
  const html = await full.page(PROMPT_PAGE);
  const card = find(html, 'section', hasAttr('aria-labelledby', 'conditions-title'));
  assert.equal(text(find(card.inner, 'h2', hasAttr('id', 'conditions-title')).inner), '생성 조건');
  assert.deepEqual(conditionRows(html), CONDITIONS);
  assert.deepEqual(
    elements(byField(html, 'dl', 'conditions').inner, 'dd').map((dd) => dd.attrs.get('data-condition')),
    ['count', 'reasoning', 'outputLimit', 'generators', 'retry', 'systemPrompt'],
  );
});

test('프롬프트 탭: "판정 기준" 섹션(id="judge")의 설명과 표 — 4행, 열 이름, 칸은 .judging.md 그대로', async () => {
  const html = await full.page(PROMPT_PAGE);
  assert.equal((html.match(/\bid="judge"/g) ?? []).length, 1, 'id="judge"는 하나');
  const section = find(html, 'section', hasAttr('id', 'judge'));
  assert.equal(text(find(section.inner, 'h2', hasAttr('id', 'judge-title')).inner), '판정 기준');
  assert.equal(text(byField(section.inner, 'p', 'judge-description').inner), JUDGE_DESCRIPTION);

  const wrap = find(section.inner, 'div', hasClass('table-wrap'));
  assert.deepEqual([wrap.attrs.get('role'), wrap.attrs.get('tabindex'), wrap.attrs.get('aria-labelledby')], ['region', '0', 'judge-title']);
  const table = criteriaTable(section.inner);
  assert.equal(table.attrs.get('aria-labelledby'), 'judge-title');
  assert.deepEqual(elements(element(table.inner, 'thead').inner, 'th').map((th) => text(th.inner)), CRITERIA_COLUMNS);

  const rows = findAll(element(table.inner, 'tbody').inner, 'tr');
  assert.equal(rows.length, 4);
  assert.deepEqual(
    rows.map((r) => ({
      key: r.attrs.get('data-key'),
      label: text(find(r.inner, 'th', hasAttr('scope', 'row')).inner),
      cells: elements(r.inner, 'td').map((td) => [td.attrs.get('data-mark'), text(td.inner)]),
    })),
    full.criteria.rows.map((c) => ({
      key: c.key,
      label: c.label,
      cells: [
        ['pass', c.pass],
        ['partial', c.partial],
        ['fail', c.fail],
      ],
    })),
  );
  assert.deepEqual(
    rows.map((r) => text(find(r.inner, 'th').inner)),
    ['장면', '계절 순환', '계절 모습', '계절 이름'],
  );
});

test('프롬프트 탭: 기준표 파일의 표 위·아래 문단은 쓰지 않는다 (COPY 설명이 대신한다)', async () => {
  const html = await full.page(PROMPT_PAGE);
  assert.ok(full.criteria.intro.length > 0);
  for (const line of full.criteria.intro) assert.ok(!text(html).includes(line), line);
  assert.ok(!html.includes('약 50초'));
  assert.ok(!html.includes('judgment.json'));
});

test('프롬프트 탭은 OPB_DATA_ROOT의 prompts/를 읽고, 원문·시스템 프롬프트·기준표의 글자를 이스케이프한다', async () => {
  const html = await custom.page(PROMPT_PAGE);
  // 원문: HTML처럼 보이는 글자도 글자 그대로
  const body = byField(html, 'div', 'prompt-body');
  assert.equal(body.inner, renderPromptBody(CUSTOM_USER));
  assert.deepEqual(
    elements(body.inner, 'p').map((p) => decodeEntities(p.inner.replace(/<br>/g, '\n'))),
    ['첫 문단 <b>굵게</b> & "따옴표"\n</script><script>window.opbInjected = 1</script>', '마지막 문단'],
  );
  assert.deepEqual(
    elements(body.inner, 'li').map((li) => decodeEntities(li.inner)),
    ['항목 하나', '항목 `둘`', '항목 셋'],
  );
  assert.ok(!html.includes('<script>window.opbInjected'));
  assert.ok(!html.includes('<b>굵게</b>'));

  // 복사할 원문: </script>로 끊기지 않고 바이트 그대로
  assert.equal(promptSource(html), CUSTOM_USER);

  // 시스템 프롬프트: 끝 줄바꿈만 지우고 큰따옴표로 감싼다
  assert.deepEqual(conditionRows(html).at(-1), ['시스템 프롬프트', '"다른 지시문 <b>& 끝</b>" (모든 도구 같음)']);
  assert.ok(!html.includes('<b>& 끝</b>'));

  // 기준표: 데이터 루트의 .judging.md
  const fail = find(criteriaTable(html).inner, 'tr', hasAttr('data-key', 'seasonLabel'));
  assert.equal(text(find(fail.inner, 'td', hasAttr('data-mark', 'fail')).inner), CUSTOM_CELL);
  assert.ok(!html.includes('<em>&'));
});

/* ───────── 소개 탭 ───────── */

test('소개 탭 히어로: 작은 라벨·제목·문장, 버튼 3개(base 포함 href, 주 버튼은 "결과 보러 가기"), 칩 3개', async () => {
  const html = await full.page(INTRO_PAGE);
  const m = main(html);
  assert.equal(text(byField(m, 'p', 'eyebrow').inner), INTRO.label);
  assert.equal(elements(m, 'h1').length, 1);
  assert.equal(text(element(m, 'h1').inner), INTRO.title);
  assert.equal(text(byField(m, 'p', 'lead').inner), INTRO.lead);

  const actions = elements(byField(m, 'div', 'actions').inner, 'a');
  assert.deepEqual(
    actions.map((a) => ({
      label: text(a.inner),
      href: a.attrs.get('href'),
      primary: (a.attrs.get('class') ?? '').split(/\s+/).includes('primary'),
    })),
    INTRO.actions,
  );
  assert.deepEqual(
    elements(byField(m, 'ul', 'chips').inner, 'li').map((li) => text(li.inner)),
    INTRO.chips(full.modelCount),
  );
});

test('소개 탭 카드 3개: What / How / Caution 라벨 + h2 + 본문 ({N}은 모델 수)', async () => {
  const html = await full.page(INTRO_PAGE);
  const cards = findAll(byField(main(html), 'div', 'cards').inner, 'section', hasAttr('data-card'));
  assert.deepEqual(
    cards.map((c) => ({
      label: text(find(c.inner, 'p', hasClass('eyebrow')).inner),
      title: text(element(c.inner, 'h2').inner),
      body: text(find(c.inner, 'p', (a) => !hasClass('eyebrow')(a)).inner),
    })),
    INTRO.cards(full.modelCount),
  );
  assert.deepEqual(
    cards.map((c) => c.attrs.get('data-card')),
    ['what', 'how', 'caution'],
  );
});

test('소개 탭 수록 기준: 제목·문단과 "대상에서 뺀 모델" 2개(모델명 / 사유)', async () => {
  const html = await full.page(INTRO_PAGE);
  const section = byField(main(html), 'section', 'inclusion');
  assert.equal(text(element(section.inner, 'h2').inner), INTRO.inclusionTitle);
  assert.equal(text(element(section.inner, 'p').inner), INTRO.inclusion);
  assert.equal(text(element(section.inner, 'h3').inner), INTRO.excludedTitle);
  assert.deepEqual(
    elements(byField(section.inner, 'ul', 'excluded').inner, 'li').map((li) => [
      text(find(li.inner, 'span', hasClass('name')).inner),
      text(find(li.inner, 'span', hasClass('reason')).inner),
    ]),
    INTRO.excluded,
  );
});

test('소개 탭의 {N}은 models.json의 모델 수로 바뀌고, 모델 수 말고는 페이지가 같다 (숫자를 하드코딩하지 않는다)', async () => {
  assert.notEqual(full.modelCount, custom.modelCount);
  const pages = await Promise.all([full, custom].map(async (b) => ({ b, html: await b.page(INTRO_PAGE) })));
  for (const { b, html } of pages) {
    assert.ok(!html.includes('{N}'), 'intro contains {N}');
    assert.deepEqual(elements(byField(html, 'ul', 'chips').inner, 'li').map((li) => text(li.inner)), INTRO.chips(b.modelCount));
    assert.ok(text(html).includes(`지금까지 ${b.modelCount}개 모델이 참여했고`));
  }
  const unfill = ({ b, html }: (typeof pages)[number]) =>
    html.replaceAll(`모델 ${b.modelCount}개`, '모델 {N}개').replaceAll(`지금까지 ${b.modelCount}개`, '지금까지 {N}개');
  assert.equal(unfill(pages[0]!), unfill(pages[1]!));
  for (const f of sitePages(full.site)) assert.ok(!(await full.page(f)).includes('{N}'), `${f} contains {N}`);
});

test('소개 탭에는 순위·점수·트로피 표시가 없고, 결과물을 실행하지 않는다', async () => {
  const html = await full.page(INTRO_PAGE);
  for (const word of ['1위', '점수', '트로피', '🏆']) assert.ok(!html.includes(word), word);
  assert.deepEqual(elements(html, 'iframe'), []);
  assert.deepEqual(elements(await full.page(PROMPT_PAGE), 'iframe'), []);
});

/* ───────── 링크 대상 ───────── */

test('#앵커가 있는 내부 링크는 dist에 있는 페이지의 실제 id를 가리킨다 (비교표 "판정 기준 보기" → /prompt/#judge)', async () => {
  const anchors: string[] = [];
  for (const f of sitePages(full.site)) {
    for (const a of elements(await full.page(f), 'a')) {
      const href = a.attrs.get('href') ?? '';
      if (!href.startsWith(TEST_BASE) || !href.includes('#')) continue;
      const [pathPart, id] = href.slice(TEST_BASE.length).split('#') as [string, string];
      const target = `${pathPart}${pathPart === '' || pathPart.endsWith('/') ? 'index.html' : ''}`;
      assert.ok(full.site.has(target), `${f}: ${href} → ${target} missing`);
      const ids = [...(await full.page(target)).matchAll(/\bid="([^"]*)"/g)].map((m) => m[1]);
      assert.ok(ids.includes(id), `${f}: ${href} → no id="${id}" in ${target}`);
      anchors.push(`${f} → ${href}`);
    }
  }
  assert.ok(anchors.includes(`compare/index.html → ${TEST_BASE}prompt/#judge`), anchors.join('\n'));
});
