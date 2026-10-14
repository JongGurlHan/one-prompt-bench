import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import { TEST_BASE, buildSite } from './support/build.ts';
import { EXPECTED_REGENERATION, makeResultsTabDataRoot } from './support/results-data.ts';
import { serveDist, type StaticServer } from './support/static-server.ts';

/* ────────────────────────────────────────────────────────────
 * 좁은 화면 브라우저 테스트 (docs/UI_GUIDE.md "공통 레이아웃" — 휴대폰 폭 < 768px)
 * 네 탭을 375px로 열어 페이지가 가로로 넘치지 않는지, 표는 컨테이너 안에서만 가로로 스크롤되는지 본다.
 * 표의 열은 숨기지 않는다. dist는 base 경로 아래 로컬 서버로 띄우고, 외부 요청(Google Fonts)은 route로 막는다.
 * ──────────────────────────────────────────────────────────── */

const PHONE = { width: 375, height: 800 };
const DESKTOP = { width: 1280, height: 800 };

/** 탭 주소 · 그 탭의 표 컨테이너 수 */
const TABS = [
  { rel: '', tables: 0 },
  { rel: 'compare/', tables: 3 },
  { rel: 'prompt/', tables: 1 },
  { rel: 'intro/', tables: 0 },
] as const;

const TABLE_WRAP = 'div[role="region"]:has(> table)';

let browser: Browser;
let server: StaticServer;

before(async () => {
  // 모든 상태 라벨이 있는 데이터 (비교표의 행·배지·각주 기호가 다 나온다)
  server = await serveDist((await buildSite(await makeResultsTabDataRoot())).outDir, TEST_BASE);
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await server?.close();
});

async function withPage(rel: string, viewport: { width: number; height: number }, check: (page: Page) => Promise<void>) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const external: string[] = [];
  const pageErrors: string[] = [];
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(`${server.origin}/`)) return route.continue();
    external.push(url);
    return route.abort();
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  try {
    await page.goto(server.url(rel), { waitUntil: 'load' });
    await check(page);
    assert.deepEqual(pageErrors, []);
    for (const url of external) assert.match(url, /^https:\/\/fonts\.(googleapis|gstatic)\.com\//, url);
  } finally {
    await context.close();
  }
}

async function box(page: Page, selector: string) {
  const b = await page.locator(selector).first().boundingBox();
  assert.ok(b, `${selector} has a box`);
  return { top: b.y, bottom: b.y + b.height, left: b.x, right: b.x + b.width, width: b.width };
}

for (const { rel, tables } of TABS) {
  test(`375px에서 /${rel}는 가로로 넘치지 않고, 표(${tables}개)는 컨테이너 안에서만 가로로 스크롤된다`, async () => {
    await withPage(rel, PHONE, async (page) => {
      const doc = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
      assert.equal(doc.innerWidth, PHONE.width);
      assert.ok(doc.scrollWidth <= PHONE.width, `/${rel} scrollWidth ${doc.scrollWidth}`);

      // 본문 좌우 여백 16px
      const main = await page.evaluate(() => {
        const s = getComputedStyle(document.querySelector('main')!);
        return [s.paddingLeft, s.paddingRight];
      });
      assert.deepEqual(main, ['16px', '16px']);

      // 헤더(사이트 이름·부제·탭)는 화면 안에서 줄바꿈된다
      for (const selector of ['header nav', 'header nav a:last-child']) {
        const b = await box(page, selector);
        assert.ok(b.left >= 0 && b.right <= PHONE.width, `${selector} ${b.left}..${b.right}`);
      }

      const wraps = page.locator(TABLE_WRAP);
      assert.equal(await wraps.count(), tables);
      for (const wrap of await wraps.all()) {
        const size = await wrap.evaluate((el) => {
          const table = el.querySelector('table')!;
          const hidden = [...table.querySelectorAll('th, td')].filter((c) => getComputedStyle(c).display === 'none').length;
          return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, overflowX: getComputedStyle(el).overflowX, hidden };
        });
        assert.ok(size.scrollWidth > size.clientWidth, `table scrolls inside its container (${size.scrollWidth} > ${size.clientWidth})`);
        assert.equal(size.overflowX, 'auto');
        assert.equal(size.hidden, 0, '열을 숨기지 않는다');
        const b = await wrap.boundingBox();
        assert.ok(b && b.x >= 0 && b.x + b.width <= PHONE.width, 'container stays inside the page');

        // 끝까지 스크롤해도 페이지는 넘치지 않는다
        await wrap.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      }
    });
  });
}

test('375px 결과 탭: 재생성 안내 박스가 보이는 모델을 골라도 페이지와 안내 박스가 가로로 넘치지 않는다', async () => {
  await withPage('', PHONE, async (page) => {
    const notice = page.locator('[data-field="regeneration"]');
    assert.ok(!(await notice.isVisible()), '첫 선택 모델은 다시 생성하지 않았다');
    for (const slug of Object.keys(EXPECTED_REGENERATION)) {
      await page.locator('select[data-field="model-select"]').selectOption(slug);
      assert.ok(await notice.isVisible(), slug);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${slug}: page scrollWidth`);
      const b = await box(page, '[data-field="regeneration"]');
      assert.ok(b.left >= 16 - 1 && b.right <= PHONE.width - 16 + 1, `${slug}: notice ${b.left}..${b.right}`);
      const fits = await notice.evaluate((el) => [el, ...el.querySelectorAll('*')].every((e) => e.scrollWidth <= e.clientWidth || e.clientWidth === 0));
      assert.ok(fits, `${slug}: 줄이 안내 박스 밖으로 넘치지 않는다`);
    }
  });
});

test('375px 프롬프트 탭: 원문 카드와 생성 조건 카드가 한 열로 쌓인다', async () => {
  await withPage('prompt/', PHONE, async (page) => {
    const source = await box(page, '[data-field="prompt-card"]');
    const conditions = await box(page, 'section[aria-labelledby="conditions-title"]');
    assert.ok(conditions.top >= source.bottom, '생성 조건은 원문 아래');
    assert.equal(Math.round(conditions.width), Math.round(source.width), '두 카드의 폭이 같다');
    assert.ok(source.width >= PHONE.width - 2 * 16 - 1);
  });
});

test('소개 탭 제목은 넓은 화면 44px, 375px에서는 줄바꿈되는 더 작은 크기이고 화면을 넘지 않는다', async () => {
  const h1 = (page: Page) =>
    page.locator('h1').evaluate((el) => ({
      fontSize: parseFloat(getComputedStyle(el).fontSize),
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      lines: Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)),
    }));
  await withPage('intro/', DESKTOP, async (page) => {
    assert.equal((await h1(page)).fontSize, 44);
  });
  await withPage('intro/', PHONE, async (page) => {
    const title = await h1(page);
    assert.ok(title.fontSize < 44, `font-size ${title.fontSize}`);
    assert.ok(title.scrollWidth <= title.clientWidth, 'h1 does not overflow');
    assert.ok(title.lines >= 2, `title wraps (${title.lines} lines)`);
  });
});
