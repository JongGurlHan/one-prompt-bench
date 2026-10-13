import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { displayModel, loadResults, type ModelDisplay } from '@opb/core';
import { chromium, type Browser, type Page } from 'playwright';
import { TEST_BASE, buildSite } from './support/build.ts';
import {
  EXPECTED_COMMIT_HASHES,
  EXPECTED_ERROR_COUNT,
  EXPECTED_ORDER,
  EXPECTED_REASON,
  EXPECTED_REGENERATION,
  FAIL_MARK_NOTE,
  FIRST_WITH_OUTPUT,
  NEWEST,
  REGENERATED_BLANK,
  REGENERATED_CONTINUED,
  RESPONSE_TEXT,
  makeNoOutputDataRoot,
  makeRegeneratedFirstDataRoot,
  makeResultsTabDataRoot,
  runLog,
} from './support/results-data.ts';
import { serveDist, type StaticServer } from './support/static-server.ts';

/* ────────────────────────────────────────────────────────────
 * 결과 탭 브라우저 테스트 (playwright 라이브러리 + node:test)
 * 빌드한 dist를 base 경로 아래 로컬 서버로 띄운다. 외부 요청(Google Fonts 등)은 route로 막는다.
 * 테스트용 결과물은 load될 때마다 콘솔에 runLog(slug)를 남긴다 → 실행·다시 시작을 센다.
 * ──────────────────────────────────────────────────────────── */

let browser: Browser;
let server: StaticServer;
let noOutputServer: StaticServer;
let regeneratedFirstServer: StaticServer;
let displays: Map<string, ModelDisplay>;

before(async () => {
  const root = await makeResultsTabDataRoot();
  displays = new Map((await loadResults(root)).map((e) => [e.model.slug, displayModel(e)]));
  server = await serveDist((await buildSite(root)).outDir, TEST_BASE);
  noOutputServer = await serveDist((await buildSite(await makeNoOutputDataRoot())).outDir, TEST_BASE);
  regeneratedFirstServer = await serveDist((await buildSite(await makeRegeneratedFirstDataRoot())).outDir, TEST_BASE);
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await server?.close();
  await noOutputServer?.close();
  await regeneratedFirstServer?.close();
});

interface Tab {
  page: Page;
  /** 결과물이 load된 순서 (slug) */
  loads: string[];
  /** 막은 외부 요청 */
  external: string[];
  pageErrors: string[];
  close(): Promise<void>;
}

type Viewport = { width: number; height: number };
const DESKTOP: Viewport = { width: 1280, height: 900 };
/** 휴대폰 (폭 < 768px) */
const PHONE: Viewport = { width: 375, height: 800 };

/** 결과 탭을 연다. prepare는 page.goto 전에 부른다 (route 추가 등) */
async function openTab(at: StaticServer = server, prepare?: (page: Page) => Promise<void>, viewport: Viewport = DESKTOP): Promise<Tab> {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const tab: Tab = { page, loads: [], external: [], pageErrors: [], close: () => context.close() };
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(`${at.origin}/`)) return route.continue();
    tab.external.push(url);
    return route.abort();
  });
  const loadPrefix = runLog('');
  page.on('console', (msg) => {
    if (msg.text().startsWith(loadPrefix)) tab.loads.push(msg.text().slice(loadPrefix.length));
  });
  page.on('pageerror', (err) => tab.pageErrors.push(err.message));
  await prepare?.(page);
  await page.goto(at.url(), { waitUntil: 'load' });
  return tab;
}

/** 탭을 닫기 전에: 페이지 에러가 없고, 막은 외부 요청은 Google Fonts뿐이다 */
async function closeTab(tab: Tab) {
  assert.deepEqual(tab.pageErrors, []);
  for (const url of tab.external) assert.match(url, /^https:\/\/fonts\.(googleapis|gstatic)\.com\//, url);
  await tab.close();
}

/** 조건이 맞을 때까지 기다린다 (최대 10초) */
async function eventually(check: () => boolean | Promise<boolean>, what: string) {
  const deadline = Date.now() + 10_000;
  while (!(await check())) {
    if (Date.now() > deadline) assert.fail(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

const waitLoads = (tab: Tab, slug: string, n: number) =>
  eventually(() => tab.loads.filter((s) => s === slug).length >= n, `${slug} loaded ${n} times (loads: ${tab.loads})`);

const field = (page: Page, name: string) => page.locator(`[data-field="${name}"]`);
const button = (page: Page, slug: string) => page.locator(`button[data-slug="${slug}"]`);
const fieldText = async (page: Page, name: string) => ((await field(page, name).textContent()) ?? '').trim();

async function pressedSlugs(page: Page): Promise<string[]> {
  return page.locator('button[data-slug][aria-pressed="true"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-slug') ?? ''));
}

/** 실행 영역의 iframe (있으면 src·title·sandbox) */
async function frameState(page: Page) {
  return page.locator('iframe').evaluateAll((els) =>
    els.map((e) => ({ src: e.getAttribute('src'), title: e.getAttribute('title'), sandbox: e.getAttribute('sandbox') })),
  );
}

/** 재생성 안내 박스가 보이면 첫 줄·줄 목록, 숨어 있으면 null */
async function shownRegeneration(page: Page) {
  if (!(await field(page, 'regeneration').isVisible())) return null;
  return {
    title: await fieldText(page, 'regeneration-title'),
    lines: (await page.locator('[data-field="regeneration-lines"] li').allTextContents()).map((t) => t.trim()),
  };
}

/** 카드 값·재생성 안내 박스가 그 모델의 displayModel 결과와 같다 */
async function assertCards(page: Page, slug: string) {
  const d = displays.get(slug)!;
  assert.equal(await fieldText(page, 'name'), d.displayName);
  assert.equal(await fieldText(page, 'meta'), `${d.company} · ${d.generator}로 생성 · ${d.releasedAt} 출시`);
  const reqs = await page.locator('dd[data-req]').allTextContents();
  assert.deepEqual(reqs.map((t) => t.trim()), d.requirements.map((r) => r.text), slug);
  const records = await page.locator('dd[data-record]').allTextContents();
  assert.deepEqual(records.map((t) => t.trim()), [d.status.label, d.requestCheck, d.errorCount, d.tokens, d.cost, d.duration], slug);
  assert.equal(await field(page, 'note').isVisible(), d.note !== null, slug);
  if (d.note !== null) assert.equal(await fieldText(page, 'note'), d.note);
  assert.deepEqual(await shownRegeneration(page), d.regeneration, `${slug} regeneration`);
}

async function assertNothingRunning(page: Page) {
  assert.deepEqual(await frameState(page), []);
  await eventually(() => page.frames().length === 1, 'only the main frame is left');
}

/* ───────── 테스트 ───────── */

test('처음 열면 결과물이 있는 첫 모델이 실행된다', async () => {
  const tab = await openTab();
  const { page } = tab;
  await waitLoads(tab, FIRST_WITH_OUTPUT, 1);

  assert.deepEqual(await pressedSlugs(page), [FIRST_WITH_OUTPUT]);
  assert.deepEqual(await frameState(page), [
    { src: `${TEST_BASE}r/${FIRST_WITH_OUTPUT}/index.html`, title: 'Model Ok 결과물', sandbox: 'allow-scripts' },
  ]);
  await assertCards(page, FIRST_WITH_OUTPUT);
  assert.ok(await field(page, 'actions').isVisible());
  assert.ok(!(await field(page, 'missing').isVisible()));
  assert.ok(!(await field(page, 'response').isVisible()));
  assert.deepEqual(tab.loads, [FIRST_WITH_OUTPUT], '결과물은 하나만 실행된다');
  await closeTab(tab);
});

test('다른 모델을 누르면 aria-pressed·iframe src·카드 값이 바뀌고 그 결과물 하나만 실행된다', async () => {
  const tab = await openTab();
  const { page } = tab;
  await waitLoads(tab, FIRST_WITH_OUTPUT, 1);

  for (const slug of ['model-miss', 'model-violation', 'model-fail-mark', 'model-unvalidated']) {
    await button(page, slug).click();
    await waitLoads(tab, slug, 1);
    assert.deepEqual(await pressedSlugs(page), [slug]);
    const d = displays.get(slug)!;
    assert.deepEqual(await frameState(page), [{ src: `${TEST_BASE}r/${slug}/index.html`, title: `${d.displayName} 결과물`, sandbox: 'allow-scripts' }]);
    assert.equal(page.frames().length, 2, '실행 중인 결과물은 하나');
    assert.equal(await page.locator('[data-action="open"]').getAttribute('href'), `${TEST_BASE}view/${slug}/`);
    await assertCards(page, slug);
  }
  // 판정 없음 → 판정 전, 메모 줄 없음 / ✗·△와 메모
  await button(page, 'model-violation').click();
  assert.deepEqual((await page.locator('dd[data-req]').allTextContents()).map((t) => t.trim()), ['판정 전', '판정 전', '판정 전', '판정 전']);
  assert.ok(!(await field(page, 'note').isVisible()));
  await button(page, 'model-fail-mark').click();
  assert.equal(await fieldText(page, 'note'), FAIL_MARK_NOTE);
  assert.equal(await page.locator('[data-field="note"] b').count(), 0, '메모는 글자 그대로');
  await closeTab(tab);
});

test('다른 모델을 고르면 생성 기록의 에러 수 값이 바뀐다 (ADR-026)', async () => {
  const tab = await openTab();
  const { page } = tab;
  await waitLoads(tab, FIRST_WITH_OUTPUT, 1);
  const errorCount = async () => ((await page.locator('dd[data-record="errorCount"]').textContent()) ?? '').trim();
  assert.equal(await errorCount(), EXPECTED_ERROR_COUNT[FIRST_WITH_OUTPUT]);

  const seen = [await errorCount()];
  for (const slug of ['model-fail-mark', 'model-violation', 'model-unvalidated', 'model-truncated', FIRST_WITH_OUTPUT]) {
    await button(page, slug).click();
    assert.equal(await errorCount(), displays.get(slug)!.errorCount, slug);
    seen.push(await errorCount());
  }
  assert.deepEqual(seen, ['0', '3', '1', '—', '—', '0']);
  await closeTab(tab);
});

test('결과물이 없는 모델을 누르면 이유 문구가 보이고 실행 중인 결과물이 없다, 원문 카드에 response.txt가 나온다', async () => {
  const tab = await openTab();
  const { page } = tab;
  await waitLoads(tab, FIRST_WITH_OUTPUT, 1);

  for (const slug of ['model-truncated', 'model-no-html', 'model-refused']) {
    await button(page, slug).click();
    assert.deepEqual(await pressedSlugs(page), [slug]);
    await assertNothingRunning(page);
    assert.ok(await field(page, 'missing').isVisible());
    assert.equal(await fieldText(page, 'reason'), EXPECTED_REASON[slug]);
    assert.ok(!(await field(page, 'actions').isVisible()), '다시 시작·새 창에서 열기는 숨긴다');
    assert.ok(await field(page, 'response').isVisible());
    await eventually(async () => (await field(page, 'response-text').textContent()) === RESPONSE_TEXT[slug], `${slug} response text`);
    await assertCards(page, slug);
  }
  // HTML처럼 보이는 원문도 글자 그대로 나온다
  assert.equal(await page.locator('[data-field="response-text"] b').count(), 0);

  for (const slug of [NEWEST.slug, 'model-usage-limit', 'model-failed', 'model-pending']) {
    await button(page, slug).click();
    await assertNothingRunning(page);
    assert.equal(await fieldText(page, 'reason'), EXPECTED_REASON[slug]);
    assert.ok(!(await field(page, 'response').isVisible()), `${slug}: 원문 카드 없음`);
    await assertCards(page, slug);
  }

  // 다시 결과물이 있는 모델로 돌아오면 다시 실행된다
  await button(page, 'model-miss').click();
  await waitLoads(tab, 'model-miss', 1);
  assert.equal((await frameState(page)).length, 1);
  assert.ok(await field(page, 'actions').isVisible());
  assert.ok(!(await field(page, 'missing').isVisible()));
  assert.ok(!(await field(page, 'response').isVisible()));
  await closeTab(tab);
});

test('다시 시작은 같은 결과물을 처음부터 다시 불러온다', async () => {
  const tab = await openTab();
  const { page } = tab;
  await waitLoads(tab, FIRST_WITH_OUTPUT, 1);
  const before = await frameState(page);

  await page.locator('[data-action="restart"]').click();
  await waitLoads(tab, FIRST_WITH_OUTPUT, 2);
  assert.deepEqual(await frameState(page), before);

  await button(page, 'model-miss').click();
  await waitLoads(tab, 'model-miss', 1);
  await page.locator('[data-action="restart"]').click();
  await waitLoads(tab, 'model-miss', 2);
  assert.deepEqual(tab.loads, [FIRST_WITH_OUTPUT, FIRST_WITH_OUTPUT, 'model-miss', 'model-miss']);
  await closeTab(tab);
});

test('이미 고른 모델을 다시 눌러도 결과물을 다시 불러오지 않는다', async () => {
  const tab = await openTab();
  const { page } = tab;
  await waitLoads(tab, FIRST_WITH_OUTPUT, 1);
  await button(page, FIRST_WITH_OUTPUT).click();
  await button(page, 'model-miss').click(); // 다음 load가 오면 앞의 클릭이 다시 불렀는지 알 수 있다
  await waitLoads(tab, 'model-miss', 1);
  assert.deepEqual(tab.loads, [FIRST_WITH_OUTPUT, 'model-miss']);
  await closeTab(tab);
});

test('키보드(Tab·Enter/Space)만으로 모델을 고를 수 있고 포커스 링이 보인다', async () => {
  const tab = await openTab();
  const { page } = tab;
  await waitLoads(tab, FIRST_WITH_OUTPUT, 1);

  const focusedSlug = () => page.evaluate(() => document.activeElement?.getAttribute('data-slug') ?? null);
  for (let i = 0; i < 10 && (await focusedSlug()) === null; i++) await page.keyboard.press('Tab');
  assert.equal(await focusedSlug(), NEWEST.slug, '첫 모델 버튼에 Tab으로 닿는다');

  const ring = await page.evaluate(() => {
    const s = getComputedStyle(document.activeElement!);
    return { style: s.outlineStyle, width: s.outlineWidth, color: s.outlineColor };
  });
  assert.deepEqual(ring, { style: 'solid', width: '2px', color: 'rgb(47, 93, 70)' });

  await page.keyboard.press('Enter');
  assert.deepEqual(await pressedSlugs(page), [NEWEST.slug]);
  await assertNothingRunning(page);
  assert.equal(await fieldText(page, 'reason'), EXPECTED_REASON[NEWEST.slug]);

  await page.keyboard.press('Tab');
  assert.equal(await focusedSlug(), FIRST_WITH_OUTPUT);
  await page.keyboard.press('Space');
  assert.deepEqual(await pressedSlugs(page), [FIRST_WITH_OUTPUT]);
  await waitLoads(tab, FIRST_WITH_OUTPUT, 2);
  await closeTab(tab);
});

test('원문을 불러오지 못하면 그 사실을 보여 주고, 늦게 온 원문은 다른 모델의 카드에 쓰지 않는다', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const tab = await openTab(server, async (page) => {
    await page.route('**/r/model-refused/response.txt', (route) => route.fulfill({ status: 500, body: 'error' }));
    await page.route('**/r/model-no-html/response.txt', async (route) => {
      await gate;
      await route.continue();
    });
  });
  const { page } = tab;

  await button(page, 'model-refused').click();
  await eventually(() => field(page, 'response-error').isVisible(), 'load failure shown');
  assert.ok(!(await field(page, 'response-text').isVisible()));

  await button(page, 'model-no-html').click(); // 원문이 gate에서 멈춘다
  assert.ok(!(await field(page, 'response-error').isVisible()));
  await button(page, 'model-truncated').click();
  await eventually(async () => (await field(page, 'response-text').textContent()) === RESPONSE_TEXT['model-truncated'], 'truncated text');
  const late = page.waitForResponse((r) => r.url().endsWith('/r/model-no-html/response.txt'));
  release();
  await (await late).finished();
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(await field(page, 'response-text').textContent(), RESPONSE_TEXT['model-truncated']);
  assert.deepEqual(await pressedSlugs(page), ['model-truncated']);
  await closeTab(tab);
});

test('결과물이 하나도 없으면 맨 위 모델의 이유와 원문이 처음부터 보인다', async () => {
  const tab = await openTab(noOutputServer);
  const { page } = tab;
  assert.deepEqual(await pressedSlugs(page), ['model-truncated']);
  await assertNothingRunning(page);
  assert.equal(await fieldText(page, 'reason'), EXPECTED_REASON['model-truncated']);
  await eventually(async () => (await field(page, 'response-text').textContent()) === RESPONSE_TEXT['model-truncated'], 'initial response text');

  await button(page, 'model-failed').click();
  assert.equal(await fieldText(page, 'reason'), EXPECTED_REASON['model-failed']);
  assert.ok(!(await field(page, 'response').isVisible()));
  assert.deepEqual(tab.loads, []);
  await closeTab(tab);
});

/* ───────── 재생성 안내 박스 (ADR-032) ───────── */

/** 안내 박스가 실행 카드 바로 위에 있고 안내 박스 토큰(경고색 아님)으로 그려졌다. 커밋 해시만 Mono이고 링크는 없다 */
async function assertRegenerationBox(page: Page, slug: string) {
  assert.deepEqual(await shownRegeneration(page), EXPECTED_REGENERATION[slug], slug);
  const notice = await box(page, '[data-field="regeneration"]');
  const run = await box(page, 'section.run');
  assert.ok(notice.bottom <= run.top, '안내 박스는 실행 카드 위');
  assert.ok(run.top - notice.bottom <= 24, `실행 카드 바로 위 (${run.top - notice.bottom}px)`);
  assert.ok(Math.abs(notice.left - run.left) <= 1 && Math.abs(notice.right - run.right) <= 1, '실행 카드와 폭이 같다');

  const style = await field(page, 'regeneration').evaluate((el) => {
    const s = getComputedStyle(el);
    const line = el.querySelector('li');
    return {
      background: s.backgroundColor,
      color: s.color,
      radius: s.borderRadius,
      padding: s.padding,
      fontSize: s.fontSize,
      titleWeight: getComputedStyle(el.querySelector('[data-field="regeneration-title"]')!).fontWeight,
      lineSize: line ? getComputedStyle(line).fontSize : null,
      animation: s.animationName,
    };
  });
  assert.deepEqual(style, {
    background: 'rgb(233, 239, 234)', // --notice-bg
    color: 'rgb(35, 67, 47)', // --notice-text
    radius: '10px',
    padding: '12px 16px',
    fontSize: '14px',
    titleWeight: '600',
    lineSize: '13px',
    animation: 'none',
  });

  const hashes = await page
    .locator('[data-field="regeneration"] code')
    .evaluateAll((els) => els.map((e) => ({ text: e.textContent, font: getComputedStyle(e).fontFamily })));
  assert.deepEqual(hashes.map((h) => h.text), EXPECTED_COMMIT_HASHES[slug]);
  for (const h of hashes) assert.match(h.font, /^"?IBM Plex Mono"?,/, h.font);
  assert.equal(await page.locator('[data-field="regeneration"] a').count(), 0, '버린 결과물은 링크하지 않는다');
}

test('다시 생성한 모델 ↔ 아닌 모델을 버튼으로 오가면 실행 카드 위 안내 박스가 보였다 숨는다', async () => {
  const tab = await openTab();
  const { page } = tab;
  await waitLoads(tab, FIRST_WITH_OUTPUT, 1);
  assert.ok(!(await field(page, 'regeneration').isVisible()), '첫 선택 모델은 다시 생성하지 않았다');

  await button(page, REGENERATED_BLANK).click();
  await waitLoads(tab, REGENERATED_BLANK, 1);
  await assertRegenerationBox(page, REGENERATED_BLANK);

  await button(page, 'model-violation').click();
  assert.ok(!(await field(page, 'regeneration').isVisible()));
  assert.equal(await page.locator('[data-field="regeneration-lines"] li').count(), 0, '앞 모델의 줄이 남지 않는다');

  await button(page, REGENERATED_CONTINUED).click();
  await assertRegenerationBox(page, REGENERATED_CONTINUED);

  // 다시 생성한 모델끼리 바꾸면 내용이 바뀐다
  await button(page, REGENERATED_BLANK).click();
  await assertRegenerationBox(page, REGENERATED_BLANK);

  // 결과물이 없는 모델·첫 모델로 돌아가면 숨는다
  for (const slug of ['model-truncated', FIRST_WITH_OUTPUT]) {
    await button(page, slug).click();
    assert.ok(!(await field(page, 'regeneration').isVisible()), slug);
    await assertCards(page, slug);
  }
  await closeTab(tab);
});

test('첫 선택 모델이 다시 생성한 모델이면 처음부터 안내 박스가 보이고, 다른 모델을 고르면 숨는다', async () => {
  const tab = await openTab(regeneratedFirstServer);
  const { page } = tab;
  await waitLoads(tab, REGENERATED_BLANK, 1);
  assert.deepEqual(await pressedSlugs(page), [REGENERATED_BLANK]);
  await assertRegenerationBox(page, REGENERATED_BLANK);

  await button(page, 'model-violation').click();
  assert.ok(!(await field(page, 'regeneration').isVisible()));
  await button(page, REGENERATED_BLANK).click();
  await assertRegenerationBox(page, REGENERATED_BLANK);
  await closeTab(tab);
});

/* ───────── 휴대폰 (폭 < 768px): 선택기 · 범례 위치 · 설명 문구 ───────── */

const picker = (page: Page) => page.locator('select[data-field="model-select"]');
const description = (page: Page, screen: 'wide' | 'narrow') => page.locator(`[data-screen="${screen}"]`);

/** 버튼 aria-pressed와 선택기 값이 같은 모델을 가리킨다 */
async function assertSelected(page: Page, slug: string) {
  assert.deepEqual(await pressedSlugs(page), [slug]);
  assert.equal(await picker(page).inputValue(), slug);
}

async function visibleButtons(page: Page): Promise<number> {
  let n = 0;
  for (const b of await page.locator('button[data-slug]').all()) if (await b.isVisible()) n++;
  return n;
}

async function box(page: Page, selector: string) {
  const b = await page.locator(selector).boundingBox();
  assert.ok(b, `${selector} has a box`);
  return { top: b.y, bottom: b.y + b.height, left: b.x, right: b.x + b.width, width: b.width, height: b.height };
}

/** 범례 상자가 결과(실행 카드 · 보이는 원문 카드 · 아래 카드 두 개)보다 아래에 있다 */
async function assertLegendBelowResult(page: Page) {
  const legend = await box(page, '[data-field="legend"]');
  const parts = ['section.run', 'section:has(> [data-field="requirements"])', 'section:has(> [data-field="record"])'];
  if (await field(page, 'response').isVisible()) parts.push('[data-field="response"]');
  for (const selector of parts) assert.ok(legend.top >= (await box(page, selector)).bottom, `legend below ${selector}`);
}

test('휴대폰(375px): 모델 선택기가 보이고 버튼 목록은 숨는다, 설명은 "목록에서", 범례 상자는 결과 아래에 있다', async () => {
  const tab = await openTab(server, undefined, PHONE);
  const { page } = tab;
  await waitLoads(tab, FIRST_WITH_OUTPUT, 1);

  assert.ok(await picker(page).isVisible());
  assert.ok(await page.locator('label[for="model-select"]').isVisible());
  assert.equal(await visibleButtons(page), 0, '버튼 목록은 보이지 않는다');
  assert.ok(await description(page, 'narrow').isVisible());
  assert.ok(!(await description(page, 'wide').isVisible()));
  await assertSelected(page, FIRST_WITH_OUTPUT);

  // 선택기는 실행 카드 위, 범례는 결과 아래
  assert.ok((await box(page, 'select[data-field="model-select"]')).bottom <= (await box(page, 'section.run')).top);
  await assertLegendBelowResult(page);

  // 실행 영역은 본문 폭을 다 쓰고 16 / 10을 유지한다 (본문 좌우 여백 16px, 카드 테두리 1px)
  const viewer = await box(page, '[data-field="viewer"]');
  assert.ok(viewer.width >= PHONE.width - 2 * 16 - 2 - 1, `viewer width ${viewer.width}`);
  assert.ok(Math.abs(viewer.height - (viewer.width * 10) / 16) <= 1, `viewer ${viewer.width}x${viewer.height}`);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '가로로 넘치지 않는다');

  // 키보드: 헤더 탭 다음 Tab은 선택기이고(숨은 버튼은 탭 순서에 없다) 포커스 링이 보인다
  const focusedField = () => page.evaluate(() => document.activeElement?.getAttribute('data-field') ?? null);
  for (let i = 0; i < 10 && (await focusedField()) !== 'model-select'; i++) {
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute('data-slug')), false, '숨은 버튼에 포커스가 가지 않는다');
  }
  assert.equal(await focusedField(), 'model-select');
  const ring = await page.evaluate(() => {
    const s = getComputedStyle(document.activeElement!);
    return { style: s.outlineStyle, width: s.outlineWidth, color: s.outlineColor };
  });
  assert.deepEqual(ring, { style: 'solid', width: '2px', color: 'rgb(47, 93, 70)' });
  await closeTab(tab);
});

test('휴대폰: 선택기로 모델을 바꾸면 버튼과 같은 전환이 일어나고, 버튼과 선택기의 선택 상태가 같다', async () => {
  const tab = await openTab(server, undefined, PHONE);
  const { page } = tab;
  await waitLoads(tab, FIRST_WITH_OUTPUT, 1);

  for (const slug of ['model-miss', 'model-truncated', 'model-failed', 'model-violation', NEWEST.slug]) {
    await picker(page).selectOption(slug);
    await assertSelected(page, slug);
    const d = displays.get(slug)!;
    if (d.hasOutput) {
      await waitLoads(tab, slug, 1);
      assert.deepEqual(await frameState(page), [{ src: `${TEST_BASE}r/${slug}/index.html`, title: `${d.displayName} 결과물`, sandbox: 'allow-scripts' }]);
      assert.equal(page.frames().length, 2, '실행 중인 결과물은 하나');
      assert.ok(await field(page, 'actions').isVisible());
      assert.ok(!(await field(page, 'missing').isVisible()));
    } else {
      await assertNothingRunning(page);
      assert.ok(await field(page, 'missing').isVisible());
      assert.equal(await fieldText(page, 'reason'), EXPECTED_REASON[slug]);
      assert.ok(!(await page.locator('[data-action="restart"]').isVisible()), '다시 시작은 숨는다');
      assert.ok(!(await page.locator('[data-action="open"]').isVisible()), '새 창에서 열기는 숨는다');
    }
    const responseText = RESPONSE_TEXT[slug];
    assert.equal(await field(page, 'response').isVisible(), responseText !== undefined, slug);
    if (responseText !== undefined) {
      await eventually(async () => (await field(page, 'response-text').textContent()) === responseText, `${slug} response text`);
    }
    await assertCards(page, slug);
    await assertLegendBelowResult(page);
  }
  assert.deepEqual(tab.loads, [FIRST_WITH_OUTPUT, 'model-miss', 'model-violation']);
  await closeTab(tab);
});

test('휴대폰: 이미 고른 모델을 선택기에서 다시 골라도 결과물을 다시 불러오지 않는다', async () => {
  const tab = await openTab(server, undefined, PHONE);
  const { page } = tab;
  await waitLoads(tab, FIRST_WITH_OUTPUT, 1);
  await picker(page).selectOption(FIRST_WITH_OUTPUT); // 같은 값으로 change가 와도 아무것도 하지 않는다
  await assertSelected(page, FIRST_WITH_OUTPUT);
  await picker(page).selectOption('model-miss'); // 다음 load가 오면 앞의 선택이 다시 불렀는지 알 수 있다
  await waitLoads(tab, 'model-miss', 1);
  await picker(page).selectOption('model-miss');
  await picker(page).selectOption(FIRST_WITH_OUTPUT);
  await waitLoads(tab, FIRST_WITH_OUTPUT, 2);
  assert.deepEqual(tab.loads, [FIRST_WITH_OUTPUT, 'model-miss', FIRST_WITH_OUTPUT]);
  await closeTab(tab);
});

test('넓은 화면(1280px): 목록이 보이고 선택기는 숨는다, 화면 폭이 바뀌어도 두 컨트롤의 선택 상태가 같다', async () => {
  const tab = await openTab(server, undefined, { width: 1280, height: 800 });
  const { page } = tab;
  await waitLoads(tab, FIRST_WITH_OUTPUT, 1);

  assert.ok(!(await picker(page).isVisible()));
  assert.ok(!(await page.locator('label[for="model-select"]').isVisible()));
  assert.equal(await visibleButtons(page), displays.size);
  assert.ok(await description(page, 'wide').isVisible());
  assert.ok(!(await description(page, 'narrow').isVisible()));
  await assertSelected(page, FIRST_WITH_OUTPUT);

  // 데스크톱 레이아웃 그대로: 범례는 왼쪽 목록 아래 (실행 카드의 왼쪽)
  const legend = await box(page, '[data-field="legend"]');
  assert.ok(legend.right <= (await box(page, 'section.run')).left);
  assert.ok(legend.top >= (await box(page, `button[data-slug="${EXPECTED_ORDER.at(-1)}"]`)).bottom);

  // 버튼으로 고른 모델이 (숨은) 선택기에도 반영되고, 휴대폰 폭으로 줄이면 그 모델이 선택기에 보인다
  await button(page, 'model-miss').click();
  await waitLoads(tab, 'model-miss', 1);
  await assertSelected(page, 'model-miss');
  await page.setViewportSize(PHONE);
  assert.ok(await picker(page).isVisible());
  assert.equal(await visibleButtons(page), 0);
  await assertSelected(page, 'model-miss');

  // 휴대폰에서 고른 모델은 다시 넓히면 버튼 목록에 눌린 상태로 보인다
  await picker(page).selectOption('model-refused');
  await page.setViewportSize(DESKTOP);
  await assertSelected(page, 'model-refused');
  assert.ok(await button(page, 'model-refused').isVisible());
  await assertNothingRunning(page);
  assert.deepEqual(tab.loads, [FIRST_WITH_OUTPUT, 'model-miss']);
  await closeTab(tab);
});

test('휴대폰: 선택기로 다시 생성한 모델 ↔ 아닌 모델을 오가면 안내 박스가 보였다 숨고, 가로로 넘치지 않는다', async () => {
  const tab = await openTab(server, undefined, PHONE);
  const { page } = tab;
  await waitLoads(tab, FIRST_WITH_OUTPUT, 1);
  assert.ok(!(await field(page, 'regeneration').isVisible()));

  for (const slug of [REGENERATED_CONTINUED, 'model-violation', REGENERATED_BLANK, 'model-failed', REGENERATED_CONTINUED]) {
    await picker(page).selectOption(slug);
    await assertSelected(page, slug);
    await assertCards(page, slug);
    if (EXPECTED_REGENERATION[slug]) {
      await assertRegenerationBox(page, slug);
      // 선택기 아래, 실행 카드 위, 화면 안
      const notice = await box(page, '[data-field="regeneration"]');
      assert.ok((await box(page, 'select[data-field="model-select"]')).bottom <= notice.top);
      assert.ok(notice.left >= 0 && notice.right <= PHONE.width, `notice ${notice.left}..${notice.right}`);
    } else {
      assert.ok(!(await field(page, 'regeneration').isVisible()), slug);
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${slug}: 가로로 넘치지 않는다`);
    await assertLegendBelowResult(page);
  }
  await closeTab(tab);
});

test('휴대폰: 첫 선택 모델이 다시 생성한 모델이면 처음 화면에 안내 박스가 보이고 넘치지 않는다', async () => {
  const tab = await openTab(regeneratedFirstServer, undefined, PHONE);
  const { page } = tab;
  await waitLoads(tab, REGENERATED_BLANK, 1);
  await assertSelected(page, REGENERATED_BLANK);
  await assertRegenerationBox(page, REGENERATED_BLANK);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

  await picker(page).selectOption('model-violation');
  assert.ok(!(await field(page, 'regeneration').isVisible()));
  await closeTab(tab);
});
