import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { CURRENT_PROMPT } from '@opb/core';
import { makeDataRoot } from '@opb/core/testing';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { TEST_BASE, buildSite } from './support/build.ts';
import { serveDist, type StaticServer } from './support/static-server.ts';

/* ────────────────────────────────────────────────────────────
 * 프롬프트 탭 브라우저 테스트 (playwright 라이브러리 + node:test)
 *  - 복사 버튼: 클립보드에 프롬프트 파일 원문을 바이트 그대로 쓰고, "복사됨" 2초 뒤 "복사"로 돌아온다
 *    (2초는 Playwright 시계로 앞당긴다). 클립보드가 없거나 거절되면 글자를 바꾸지 않는다.
 *    writeText에 넘긴 값은 어느 OS에서나 원문과 바이트까지 같아야 한다. 시스템 클립보드에서 다시 읽은 값은
 *    Windows의 Chromium이 줄바꿈을 CRLF로 바꿔 쓰므로(Blink SystemClipboard::WritePlainText) 그 OS의 줄바꿈으로 비교한다.
 *  - 비교표의 "판정 기준 보기" 링크가 /prompt/#judge로 이동하고 그 앵커가 있다.
 * dist는 base 경로 아래 로컬 서버로 띄우고, 외부 요청(Google Fonts)은 route로 막는다.
 * ──────────────────────────────────────────────────────────── */

let browser: Browser;
let server: StaticServer;
/** 데이터 루트의 프롬프트 파일 바이트 (사이트가 읽은 것) */
let promptBytes: Buffer;
/** 시스템 클립보드에서 다시 읽을 때 기대하는 바이트 (Windows는 Chromium이 LF를 CRLF로 바꿔 쓴다) */
const clipboardBytes = () =>
  process.platform === 'win32' ? Buffer.from(promptBytes.toString('utf8').replace(/\n/g, '\r\n'), 'utf8') : promptBytes;

before(async () => {
  const root = await makeDataRoot();
  promptBytes = await readFile(path.join(root, 'prompts', `${CURRENT_PROMPT.id}-${CURRENT_PROMPT.version}.md`));
  server = await serveDist((await buildSite(root)).outDir, TEST_BASE);
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await server?.close();
});

interface Tab {
  context: BrowserContext;
  page: Page;
  external: string[];
  pageErrors: string[];
}

/** 페이지를 연다. prepare는 page.goto 전에 부른다 (권한·init script·시계) */
async function open(rel: string, prepare?: (tab: Tab) => Promise<void>): Promise<Tab> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const tab: Tab = { context, page, external: [], pageErrors: [] };
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(`${server.origin}/`)) return route.continue();
    tab.external.push(url);
    return route.abort();
  });
  page.on('pageerror', (err) => tab.pageErrors.push(err.message));
  await prepare?.(tab);
  await page.goto(server.url(rel), { waitUntil: 'load' });
  return tab;
}

/** 닫기 전에: 페이지 에러가 없고, 막은 외부 요청은 Google Fonts뿐이다 */
async function close(tab: Tab) {
  assert.deepEqual(tab.pageErrors, []);
  for (const url of tab.external) assert.match(url, /^https:\/\/fonts\.(googleapis|gstatic)\.com\//, url);
  await tab.context.close();
}

/** 조건이 맞을 때까지 기다린다 (최대 10초) */
async function eventually(check: () => boolean | Promise<boolean>, what: string) {
  const deadline = Date.now() + 10_000;
  while (!(await check())) {
    if (Date.now() > deadline) assert.fail(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** 클립보드 권한을 주고, 실제 writeText를 그대로 부르되 넘긴 값을 window.clipboardWrites에 남긴다 */
async function allowClipboard({ context, page }: Tab) {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: server.origin });
  await page.addInitScript(() => {
    const w = window as unknown as { clipboardWrites: string[] };
    w.clipboardWrites = [];
    const writeText = Clipboard.prototype.writeText;
    Clipboard.prototype.writeText = function (this: Clipboard, data: string) {
      w.clipboardWrites.push(data);
      return writeText.call(this, data);
    };
  });
}

const clipboardWrites = (page: Page) => page.evaluate(() => (window as unknown as { clipboardWrites: string[] }).clipboardWrites);
const readClipboard = async (page: Page) => Buffer.from(await page.evaluate(() => navigator.clipboard.readText()), 'utf8');

const copyButton = (page: Page) => page.locator('button[data-action="copy"]');
const buttonText = async (page: Page) => ((await copyButton(page).textContent()) ?? '').trim();

test('복사: 클립보드에 프롬프트 파일 원문(끝 줄바꿈 포함)을 바이트 그대로 쓰고, "복사됨"이 2초 뒤 "복사"로 돌아온다', async () => {
  const tab = await open('prompt/', async (t) => {
    await allowClipboard(t);
    await t.page.clock.install();
  });
  const { page } = tab;
  assert.equal(await buttonText(page), '복사');

  await copyButton(page).click();
  await eventually(async () => (await buttonText(page)) === '복사됨', 'button shows 복사됨');

  const writes = await clipboardWrites(page);
  assert.equal(writes.length, 1);
  assert.ok(Buffer.from(writes[0]!, 'utf8').equals(promptBytes), JSON.stringify(writes[0]));
  assert.ok(writes[0]!.endsWith('\n'));
  const clipboard = await readClipboard(page);
  assert.ok(clipboard.equals(clipboardBytes()), JSON.stringify(clipboard.toString('utf8')));

  await page.clock.runFor(1_999);
  assert.equal(await buttonText(page), '복사됨');
  await page.clock.runFor(1);
  await eventually(async () => (await buttonText(page)) === '복사', 'button back to 복사');

  // 다시 눌러도 같다 (2초는 마지막 복사부터)
  await copyButton(page).click();
  await eventually(async () => (await buttonText(page)) === '복사됨', 'button shows 복사됨 again');
  await page.clock.runFor(1_000);
  await copyButton(page).click();
  await page.clock.runFor(1_500);
  assert.equal(await buttonText(page), '복사됨', '두 번째 복사부터 2초가 아직 안 됐다');
  await page.clock.runFor(500);
  await eventually(async () => (await buttonText(page)) === '복사', 'button back to 복사 after the last copy');
  await close(tab);
});

test('복사 버튼은 키보드로 누를 수 있고 포커스 링이 보인다', async () => {
  const tab = await open('prompt/', allowClipboard);
  const { page } = tab;
  const focused = () => copyButton(page).evaluate((el) => el === document.activeElement);
  for (let i = 0; i < 10 && !(await focused()); i++) await page.keyboard.press('Tab');
  assert.equal(await focused(), true, 'Tab 키로 복사 버튼에 닿는다');
  assert.deepEqual(
    await copyButton(page).evaluate((el) => {
      const s = getComputedStyle(el);
      return [s.outlineStyle, s.outlineWidth, s.outlineColor];
    }),
    ['solid', '2px', 'rgb(47, 93, 70)'], // --accent
  );

  await page.keyboard.press('Enter');
  await eventually(async () => (await buttonText(page)) === '복사됨', 'Enter copies');
  assert.deepEqual(await clipboardWrites(page), [promptBytes.toString('utf8')]);
  assert.ok((await readClipboard(page)).equals(clipboardBytes()));
  await close(tab);
});

test('클립보드 API가 없으면 눌러도 "복사"에서 바뀌지 않는다 (거짓 성공 없음)', async () => {
  const tab = await open('prompt/', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { clipboardReads: number };
      w.clipboardReads = 0;
      Object.defineProperty(Navigator.prototype, 'clipboard', {
        configurable: true,
        get() {
          w.clipboardReads++;
          return undefined;
        },
      });
    });
  });
  const { page } = tab;
  await copyButton(page).click();
  await eventually(
    () => page.evaluate(() => (window as unknown as { clipboardReads: number }).clipboardReads > 0),
    'copy handler looked for navigator.clipboard',
  );
  await page.waitForTimeout(300);
  assert.equal(await buttonText(page), '복사');
  await close(tab);
});

test('클립보드 쓰기가 거절되면 "복사"에서 바뀌지 않는다 (원문 그대로 요청은 했다)', async () => {
  const tab = await open('prompt/', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { clipboardWrites: string[] };
      w.clipboardWrites = [];
      navigator.clipboard.writeText = (data: string) => {
        w.clipboardWrites.push(data);
        return Promise.reject(new DOMException('Write permission denied.', 'NotAllowedError'));
      };
    });
  });
  const { page } = tab;
  await copyButton(page).click();
  const writes = () => page.evaluate(() => (window as unknown as { clipboardWrites: string[] }).clipboardWrites);
  await eventually(async () => (await writes()).length === 1, 'writeText called once');
  assert.ok(Buffer.from((await writes())[0]!, 'utf8').equals(promptBytes));
  await page.waitForTimeout(300);
  assert.equal(await buttonText(page), '복사');
  await close(tab);
});

test('비교표의 "판정 기준 보기"를 누르면 /prompt/#judge로 가고, 판정 기준 섹션이 화면에 보인다', async () => {
  const tab = await open('compare/');
  const { page } = tab;
  await page.getByRole('link', { name: '판정 기준 보기' }).click();
  await page.waitForURL(server.url('prompt/#judge'));

  const judge = page.locator('#judge');
  assert.equal(await judge.count(), 1);
  assert.equal(((await judge.locator('h2').textContent()) ?? '').trim(), '판정 기준');
  await eventually(async () => {
    const box = await judge.boundingBox();
    return box !== null && box.y >= 0 && box.y < 900;
  }, '#judge is scrolled into view');
  await close(tab);
});
