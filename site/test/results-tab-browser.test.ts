import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { displayModel, loadResults, type ModelDisplay } from '@opb/core';
import { chromium, type Browser, type Page } from 'playwright';
import { TEST_BASE, buildSite } from './support/build.ts';
import {
  EXPECTED_ERROR_COUNT,
  EXPECTED_REASON,
  FAIL_MARK_NOTE,
  FIRST_WITH_OUTPUT,
  NEWEST,
  RESPONSE_TEXT,
  makeNoOutputDataRoot,
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
let displays: Map<string, ModelDisplay>;

before(async () => {
  const root = await makeResultsTabDataRoot();
  displays = new Map((await loadResults(root)).map((e) => [e.model.slug, displayModel(e)]));
  server = await serveDist((await buildSite(root)).outDir, TEST_BASE);
  noOutputServer = await serveDist((await buildSite(await makeNoOutputDataRoot())).outDir, TEST_BASE);
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await server?.close();
  await noOutputServer?.close();
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

/** 결과 탭을 연다. prepare는 page.goto 전에 부른다 (route 추가 등) */
async function openTab(at: StaticServer = server, prepare?: (page: Page) => Promise<void>): Promise<Tab> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
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

/** 카드 값이 그 모델의 displayModel 결과와 같다 */
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
