import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkResults, GenerationRecordSchema, judgeRequests, type Validation } from '@opb/core';
import { FAKE_JPEG, makeDataRoot, patchJson, writeResult, type FakeResult } from '@opb/core/testing';
import type { Page } from 'playwright';
import { SCREENSHOT_SCHEDULE, validateResult, type ValidateOptions } from '../src/validation/validate-result.js';
import { snapshot } from './batch-fakes.js';

/* ────────────────────────────────────────────────────────────
 * Playwright 검증기 — 실제 headless Chromium으로 로컬 픽스처 HTML(test/fixtures/validation/)을 연다.
 * 데이터는 OS 임시 디렉토리(@opb/core/testing)에 만들고, 로컬 서버(127.0.0.1)가 아닌 요청은 전부
 * page.route로 가로챈다(가짜 응답·응답 없음·abort). 실제 네트워크에 닿는 요청은 없다.
 * ──────────────────────────────────────────────────────────── */

const FIXTURES = fileURLToPath(new URL('./fixtures/validation/', import.meta.url));
const SLUG = 'gemini-a';
const NOW = new Date('2026-10-12T12:00:00.000Z');
/** 실제 시점(5·15·25·35초) 대신 100·200·300·400ms. 라벨은 그대로 */
const SHORT_SCHEDULE = SCREENSHOT_SCHEDULE.map((s, i) => ({ label: s.label, atMs: (i + 1) * 100 }));

const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';
const IMAGE_URL = 'https://example.com/textures/bark.png';
const FONT_URL = 'https://fonts.gstatic.com/s/fixture/v1/fixture.woff2';
const HANG_URL = 'https://cdn.example.com/never-answers.js';
/** 1×1 투명 PNG */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

type Fake = { contentType: string; body: string | Buffer } | 'hang';

interface Offline {
  /** ValidateOptions.preparePage로 넘긴다 */
  prepare: (page: Page) => Promise<void>;
  /** 가로챈 외부 요청 URL (순서대로) */
  intercepted: string[];
  /** iframe 안을 포함한 모든 콘솔 메시지 텍스트 (픽스처가 남기는 확인용 로그) */
  consoleLines: string[];
}

/**
 * 로컬 서버가 아닌 요청을 전부 가로챈다: fakes에 있으면 가짜 응답(CORS 허용 — 샌드박스 iframe은 출처가 opaque),
 * 'hang'이면 응답하지 않음(브라우저를 닫을 때 끊긴다), 그 밖은 abort.
 */
function offline(fakes: Record<string, Fake> = {}): Offline {
  const o: Offline = {
    intercepted: [],
    consoleLines: [],
    prepare: async (page) => {
      page.on('console', (msg) => void o.consoleLines.push(msg.text()));
      await page.route('**/*', async (route) => {
        const url = route.request().url();
        if (new URL(url).hostname === '127.0.0.1') return route.continue();
        o.intercepted.push(url);
        const fake = fakes[url];
        if (fake === 'hang') return;
        if (fake === undefined) return route.abort('internetdisconnected');
        return route.fulfill({
          status: 200,
          contentType: fake.contentType,
          headers: { 'access-control-allow-origin': '*' },
          body: fake.body,
        });
      });
    },
  };
  return o;
}

function options(net: Offline, extra: Partial<ValidateOptions> = {}): ValidateOptions {
  return { schedule: SHORT_SCHEDULE, loadTimeoutMs: 10_000, now: () => NOW, preparePage: net.prepare, ...extra };
}

/** 픽스처 HTML을 index.html로 가진 ok 기록 (sha256은 빌더가 픽스처 바이트로 계산). 기본은 검증 전 */
async function fixtureResult(fixture: string, spec: Partial<Extract<FakeResult, { outcome: 'ok' }>> = {}) {
  const root = await makeDataRoot();
  const html = await readFile(path.join(FIXTURES, fixture));
  await writeResult(root, SLUG, { outcome: 'ok', html, validation: null, ...spec });
  return { root, dir: path.join(root, 'results', SLUG) };
}

async function readRawMeta(dir: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(dir, 'meta.json'), 'utf8')) as Record<string, unknown>;
}

function withoutValidation(meta: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...meta };
  delete rest.validation;
  return rest;
}

/** JPEG의 SOF 마커에서 크기를 읽는다 (변환 라이브러리 없이) */
function jpegSize(buf: Buffer): { width: number; height: number } {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) throw new Error(`JPEG marker expected at ${i}`);
    const marker = buf[i + 1]!;
    const length = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + length;
  }
  throw new Error('no SOF marker');
}

async function assertScreenshots(dir: string, v: Validation): Promise<void> {
  assert.deepEqual(
    v.screenshots,
    SHORT_SCHEDULE.map((s) => ({ label: s.label, atMs: s.atMs, path: `results/${SLUG}/${s.label}.jpg` })),
  );
  for (const s of SHORT_SCHEDULE) {
    const buf = await readFile(path.join(dir, `${s.label}.jpg`));
    assert.deepEqual([...buf.subarray(0, 3)], [0xff, 0xd8, 0xff], `${s.label}.jpg is JPEG`);
    assert.deepEqual(jpegSize(buf), { width: 1280, height: 800 }, `${s.label}.jpg는 iframe 영역(1280×800)`);
  }
}

/* ───────── 정상 페이지 ───────── */

test('정상 페이지: loaded true·에러 0·외부 요청 0, 스크린샷 4장(JPEG 1280×800), meta.json은 validation만 바뀐다', async () => {
  const { root, dir } = await fixtureResult('ok.html');
  const before = await readRawMeta(dir);
  const filesBefore = await snapshot(dir);
  const net = offline();

  const v = await validateResult(root, SLUG, options(net));

  assert.equal(v.loaded, true);
  assert.deepEqual(v.consoleErrors, []);
  assert.deepEqual(v.pageErrors, []);
  assert.deepEqual(v.externalRequests, []);
  assert.deepEqual(net.intercepted, []);
  assert.equal(v.environment.browser, 'chromium');
  assert.match(v.environment.browserVersion, /^\d+\.\d+/);
  assert.equal(v.checkedAt, NOW.toISOString());
  assert.ok(net.consoleLines.includes('fixture ok: drawn'), 'iframe 안의 스크립트가 실행됐다');
  await assertScreenshots(dir, v);

  // meta.json: validation만 바뀌고 나머지 필드·순서는 그대로, 스키마 통과
  const after = await readRawMeta(dir);
  assert.deepEqual(Object.keys(after), Object.keys(before));
  assert.deepEqual(withoutValidation(after), withoutValidation(before));
  assert.deepEqual(after.validation, JSON.parse(JSON.stringify(v)));
  assert.equal(GenerationRecordSchema.safeParse(after).success, true);

  // 다른 파일은 그대로, 스크린샷 4장이 새로 생겼다 → check:results 통과
  const filesAfter = (await snapshot(dir))!;
  for (const name of ['index.html', 'response.txt']) assert.equal(filesAfter[name], filesBefore![name], name);
  assert.deepEqual(Object.keys(filesAfter).sort(), [
    'autumn.jpg',
    'index.html',
    'meta.json',
    'response.txt',
    'spring.jpg',
    'summer.jpg',
    'winter.jpg',
  ]);
  assert.deepEqual(await checkResults(root), []);
});

/* ───────── iframe 안의 에러 ───────── */

test('iframe 안의 console.error는 consoleErrors, 잡히지 않은 예외·Promise 거부는 pageErrors (log·warn은 세지 않는다)', async () => {
  const { root } = await fixtureResult('errors.html');

  const v = await validateResult(root, SLUG, options(offline()));

  assert.equal(v.loaded, true);
  assert.deepEqual(v.consoleErrors, ['fixture console error 1', 'fixture console error 2']);
  assert.deepEqual(
    [...v.pageErrors].sort(),
    ['fixture uncaught at load', 'fixture uncaught in timer', 'fixture unhandled rejection'].sort(),
  );
  assert.deepEqual(v.externalRequests, []);
});

/* ───────── 외부 요청 ───────── */

test('외부 script·image·font 요청을 순서대로 기록하고(data:·blob:·로컬 제외), core judgeRequests가 위반으로 판정한다', async () => {
  const { root } = await fixtureResult('external.html');
  const net = offline({
    [THREE_URL]: { contentType: 'text/javascript', body: "export const REVISION = '170';\n" },
    [IMAGE_URL]: { contentType: 'image/png', body: PNG },
    [FONT_URL]: { contentType: 'font/woff2', body: Buffer.from('not a real font') },
  });

  const v = await validateResult(root, SLUG, options(net));

  assert.ok(net.consoleLines.includes('fixture three revision 170'), 'three.js 가짜 응답을 받아 모듈이 실행됐다');
  assert.ok(net.consoleLines.includes('fixture external: done'), 'blob: 요청까지 끝났다');
  assert.deepEqual(v.externalRequests, [
    { url: THREE_URL, resourceType: 'script' },
    { url: IMAGE_URL, resourceType: 'image' },
    { url: FONT_URL, resourceType: 'font' },
  ]);
  assert.deepEqual(net.intercepted, [THREE_URL, IMAGE_URL, FONT_URL], '외부 요청은 전부 가로챘다');

  const report = judgeRequests(v.externalRequests);
  assert.equal(report.verdict, 'violation');
  assert.deepEqual(
    report.items.map((i) => i.kind),
    ['three', 'image', 'other'],
  );
});

/* ───────── load가 오지 않는 페이지 ───────── */

test('load가 제한 시간 안에 오지 않으면 loaded false, 그 시점부터 스크린샷 4장은 그대로 찍는다', async () => {
  const { root, dir } = await fixtureResult('hang.html');
  const net = offline({ [HANG_URL]: 'hang' });

  const started = performance.now();
  const v = await validateResult(root, SLUG, options(net, { loadTimeoutMs: 800 }));
  const elapsed = performance.now() - started;

  assert.equal(v.loaded, false);
  assert.ok(elapsed >= 800 + 400, `제한 시간(800ms) 뒤를 0초로 마지막 스크린샷(400ms)까지 기다렸다: ${elapsed}ms`);
  assert.deepEqual(v.externalRequests, [{ url: HANG_URL, resourceType: 'script' }]);
  await assertScreenshots(dir, v);
  assert.deepEqual(await checkResults(root), []);
});

/* ───────── WebGL ───────── */

test('headless Chromium의 샌드박스 iframe 안에서 WebGL 컨텍스트가 만들어진다', async (t) => {
  const { root } = await fixtureResult('webgl.html');
  const net = offline();

  const v = await validateResult(root, SLUG, options(net));

  const line = net.consoleLines.find((l) => l.startsWith('fixture webgl: '));
  assert.ok(line, `WebGL 픽스처가 결과를 남기지 않았다: ${JSON.stringify(net.consoleLines)}`);
  assert.match(line, /^fixture webgl: webgl[12] \| /);
  t.diagnostic(`${line} (chromium ${v.environment.browserVersion})`);
  assert.deepEqual(v.consoleErrors, []);
  assert.deepEqual(v.pageErrors, []);
  assert.equal(v.loaded, true);
});

/* ───────── 재검증 ───────── */

test('재검증: 스크린샷·validation을 덮어쓰고 judgment.json·index.html·response.txt는 그대로', async () => {
  // 이미 검증된 기록(가짜 JPEG 4장)과 판정이 있는 결과
  const { root, dir } = await fixtureResult('ok.html', { validation: {}, judgment: {} });
  const before = (await snapshot(dir))!;
  const metaBefore = await readRawMeta(dir);
  assert.ok(before['judgment.json']);

  const v = await validateResult(root, SLUG, options(offline()));

  const after = (await snapshot(dir))!;
  for (const name of ['judgment.json', 'index.html', 'response.txt']) assert.equal(after[name], before[name], name);
  for (const s of SHORT_SCHEDULE) {
    const buf = await readFile(path.join(dir, `${s.label}.jpg`));
    assert.notDeepEqual(buf, FAKE_JPEG, `${s.label}.jpg를 덮어썼다`);
  }
  await assertScreenshots(dir, v);
  const metaAfter = await readRawMeta(dir);
  assert.deepEqual(withoutValidation(metaAfter), withoutValidation(metaBefore));
  assert.notDeepEqual(metaAfter.validation, metaBefore.validation);
  assert.equal((metaAfter.validation as Validation).checkedAt, NOW.toISOString());
  assert.deepEqual(await checkResults(root), []);
});

/* ───────── 대상이 아닌 slug ───────── */

test('outcome이 ok가 아니거나 기록이 없거나 깨졌으면 브라우저를 띄우지 않고 이유를 담아 throw, 파일은 그대로', async () => {
  const root = await makeDataRoot();
  await writeResult(root, 'claude-a', { outcome: 'no_html' });
  await writeResult(root, 'claude-b', { outcome: 'api_failed', failure: 'usage_limit' });
  await writeResult(root, 'gpt-a', { outcome: 'ok' });
  await patchJson<Record<string, unknown>>(root, 'results/gpt-a/meta.json', (m) => {
    m.outcome = 'great';
  });
  const dirsBefore = await Promise.all(['claude-a', 'claude-b', 'gpt-a'].map((s) => snapshot(path.join(root, 'results', s))));

  let prepared = 0;
  const opts: ValidateOptions = { ...options(offline()), preparePage: async () => void prepared++ };

  await assert.rejects(validateResult(root, 'claude-a', opts), /no_html/);
  await assert.rejects(validateResult(root, 'claude-b', opts), /api_failed/);
  await assert.rejects(validateResult(root, 'gpt-a', opts), /meta\.json.*스키마/);
  await assert.rejects(validateResult(root, 'gemini-a', opts), /meta\.json/); // 생성 전 (폴더 없음)
  await assert.rejects(validateResult(root, '../gpt-a', opts), /slug/);

  assert.equal(prepared, 0, '브라우저를 띄우지 않았다');
  assert.deepEqual(
    await Promise.all(['claude-a', 'claude-b', 'gpt-a'].map((s) => snapshot(path.join(root, 'results', s)))),
    dirsBefore,
  );
  assert.deepEqual((await readdir(path.join(root, 'results'))).sort(), ['claude-a', 'claude-b', 'gpt-a']);
});

test('meta.json의 modelSlug가 폴더 이름과 다르면 throw하고 파일은 그대로', async () => {
  const root = await makeDataRoot();
  await writeResult(root, 'gpt-a', { outcome: 'ok', validation: null });
  await patchJson<Record<string, unknown>>(root, 'results/gpt-a/meta.json', (m) => {
    m.modelSlug = 'claude-a';
  });
  const before = await snapshot(path.join(root, 'results', 'gpt-a'));

  await assert.rejects(validateResult(root, 'gpt-a', options(offline())), /modelSlug/);

  assert.deepEqual(await snapshot(path.join(root, 'results', 'gpt-a')), before);
});

test('SCREENSHOT_SCHEDULE: iframe load 기준 5·15·25·35초에 spring·summer·autumn·winter', () => {
  assert.deepEqual(SCREENSHOT_SCHEDULE, [
    { label: 'spring', atMs: 5_000 },
    { label: 'summer', atMs: 15_000 },
    { label: 'autumn', atMs: 25_000 },
    { label: 'winter', atMs: 35_000 },
  ]);
});
