import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { before, test } from 'node:test';
import { STATUS_CASES, fakeModel, makeDataRoot, writeResult, type BuiltResult, type FakeResult } from '@opb/core/testing';
import { TEST_BASE, buildSite, sha256, sitePages, type BuiltSite } from './support/build.ts';
import { element, elements, metaContent, text, urls } from './support/html.ts';

/* 모든 상태 라벨 + 바이트가 까다로운 결과물로 빌드한 dist 검사 (빌드는 한 번) */

// CRLF·BOM·UTF-8이 아닌 바이트: 문자열로 읽었다가 다시 쓰면 sha256이 바뀐다
const BYTES_MODEL = fakeModel('model-bytes', 'openai', '2026-09-01', 'Model Bytes');
const BYTES_HTML = Buffer.concat([
  Buffer.from('﻿<!doctype html>\r\n<html><body>한글 나무\r\n', 'utf8'),
  Buffer.from([0xff, 0xfe, 0x00, 0x80]),
  Buffer.from('</body></html>', 'utf8'),
]);
const BYTES_RESPONSE = '```html\r\n<!doctype html>\r\n…\r\n```\r\n';

const CASES: { model: (typeof STATUS_CASES)[number]['model']; result: FakeResult | null }[] = [
  ...STATUS_CASES.map(({ model, result }) => ({ model, result })),
  { model: BYTES_MODEL, result: { outcome: 'ok', html: BYTES_HTML, responseText: BYTES_RESPONSE } },
];
const MODEL_COUNT = CASES.length;
const SITE_DESCRIPTION =
  '같은 프롬프트를 여러 AI 모델에 한 번씩 보내, 브라우저에서 바로 실행되는 3D 나무를 받았어요. 새 모델이 나오면 같은 프롬프트로 한 그루씩 더해요.';

let dataRoot: string;
let site: BuiltSite;
const written = new Map<string, BuiltResult>();

before(async () => {
  dataRoot = await makeDataRoot(CASES.map((c) => c.model));
  for (const c of CASES) if (c.result) written.set(c.model.slug, await writeResult(dataRoot, c.model.slug, c.result));
  site = await buildSite(dataRoot);
});

const withOutput = () => CASES.filter((c) => written.get(c.model.slug)?.record.output).map((c) => c.model);
const source = (slug: string, name: string) => readFile(path.join(dataRoot, 'results', slug, name));

test('결과물·원문 사본이 원본과 바이트까지 같고, 없는 모델은 사본도 없다', async () => {
  for (const { model } of CASES) {
    const record = written.get(model.slug)?.record ?? null;
    const html = `r/${model.slug}/index.html`;
    const response = `r/${model.slug}/response.txt`;

    if (record?.output) {
      assert.ok(site.has(html), `${html} missing`);
      const copy = await site.read(html);
      assert.equal(sha256(copy), sha256(await source(model.slug, 'index.html')), html);
      assert.equal(sha256(copy), record.output.sha256, html);
    } else {
      assert.ok(!site.has(html), `${html} should not exist`);
    }

    if (record?.responseTextPath) {
      assert.ok(site.has(response), `${response} missing`);
      assert.equal(sha256(await site.read(response)), sha256(await source(model.slug, 'response.txt')), response);
    } else {
      assert.ok(!site.has(response), `${response} should not exist`);
    }
  }
  assert.ok((await site.read(`r/${BYTES_MODEL.slug}/index.html`)).equals(BYTES_HTML));
  assert.equal((await site.readText(`r/${BYTES_MODEL.slug}/response.txt`)), BYTES_RESPONSE);
});

test('r/<slug>/에는 index.html·response.txt만 있다', () => {
  for (const f of site.files.filter((f) => f.startsWith('r/'))) {
    assert.match(f, /^r\/[a-z0-9-]+\/(index\.html|response\.txt)$/);
  }
});

test('스크린샷·meta.json·judgment.json은 dist 어디에도 없다', () => {
  // 원본 데이터에는 있다 (정상 모델의 스크린샷 4장·판정)
  assert.ok(written.get('model-ok')?.files['spring.jpg']);
  assert.ok(written.get('model-ok')?.files['judgment.json']);

  const leaked = site.files.filter((f) => /\.jpe?g$/i.test(f) || /(^|\/)(meta|judgment)\.json$/.test(f));
  assert.deepEqual(leaked, []);
});

test('모든 HTML의 iframe sandbox는 정확히 allow-scripts이고 allow-same-origin은 어디에도 없다', async () => {
  let iframes = 0;
  for (const f of site.files.filter((f) => f.endsWith('.html'))) {
    const html = await site.readText(f);
    assert.ok(!html.includes('allow-same-origin'), `${f} contains allow-same-origin`);
    for (const iframe of elements(html, 'iframe')) {
      iframes++;
      assert.equal(iframe.attrs.get('sandbox'), 'allow-scripts', `${f}: ${iframe.tag}`);
    }
  }
  assert.ok(iframes >= withOutput().length, 'every /view/ page has an iframe');
});

test('/view/<slug>/는 결과물이 있는 모델에만 생기고, 결과물 iframe 하나로 화면을 채운다', async () => {
  const views = site.files.filter((f) => f.startsWith('view/'));
  assert.deepEqual(views, withOutput().map((m) => `view/${m.slug}/index.html`).sort());

  for (const model of withOutput()) {
    const html = await site.readText(`view/${model.slug}/index.html`);
    assert.equal(element(html, 'html').attrs.get('lang'), 'ko');
    assert.equal(text(element(html, 'title').inner), `${model.displayName} — One Prompt Bench`);

    const iframes = elements(html, 'iframe');
    assert.equal(iframes.length, 1);
    const iframe = iframes[0]!;
    assert.equal(iframe.attrs.get('src'), `${TEST_BASE}r/${model.slug}/index.html`);
    assert.equal(iframe.attrs.get('title'), `${model.displayName} 결과물`);
    assert.equal(iframe.attrs.get('sandbox'), 'allow-scripts');

    // 다른 UI는 없다
    for (const name of ['header', 'nav', 'a', 'button', 'h1', 'main']) {
      assert.deepEqual(elements(html, name), [], `view/${model.slug}: <${name}>`);
    }
  }
});

test('결과물 파일로 가는 직접 링크가 없다', async () => {
  for (const f of sitePages(site)) {
    for (const a of elements(await site.readText(f), 'a')) {
      assert.doesNotMatch(a.attrs.get('href') ?? '', /(^|\/)r\//, `${f}: ${a.tag}`);
    }
  }
});

test('헤더 탭은 COPY 순서의 소개·결과·비교표·프롬프트이고 현재 탭에 aria-current="page"가 있다 (ADR-024)', async () => {
  const html = await site.readText('index.html');
  const header = element(html, 'header');
  assert.equal(text(header.inner).startsWith('One Prompt Bench 하나의 프롬프트, 모델마다 다른 나무'), true, text(header.inner));

  const nav = element(header.inner, 'nav');
  assert.equal(nav.attrs.get('aria-label'), '주요 메뉴');
  const tabs = elements(nav.inner, 'a');
  assert.deepEqual(
    tabs.map((a) => ({ label: text(a.inner), href: a.attrs.get('href'), current: a.attrs.get('aria-current') })),
    [
      { label: '소개', href: `${TEST_BASE}intro/`, current: undefined },
      { label: '결과', href: TEST_BASE, current: 'page' },
      { label: '비교표', href: `${TEST_BASE}compare/`, current: undefined },
      { label: '프롬프트', href: `${TEST_BASE}prompt/`, current: undefined },
    ],
  );
  // 헤더 탭이 가리키는 페이지는 모두 있다
  for (const a of tabs) assert.ok(site.has(`${a.attrs.get('href')!.slice(TEST_BASE.length)}index.html`), a.tag);
});

test('내부 링크·에셋은 base로 시작하고, 외부 주소는 Google Fonts뿐이다', async () => {
  for (const f of sitePages(site)) {
    const html = await site.readText(f);
    for (const url of urls(html)) {
      if (/^https?:\/\//.test(url)) {
        assert.match(url, /^https:\/\/fonts\.(googleapis|gstatic)\.com(\/|$)/, `${f}: ${url}`);
      } else {
        assert.ok(url.startsWith(TEST_BASE), `${f}: ${url} does not start with ${TEST_BASE}`);
      }
    }
  }
});

test('결과 탭: lang·title·meta description·글꼴', async () => {
  const html = await site.readText('index.html');
  assert.equal(element(html, 'html').attrs.get('lang'), 'ko');
  assert.equal(text(element(html, 'title').inner), 'One Prompt Bench');
  assert.equal(metaContent(html, 'description'), SITE_DESCRIPTION);
  assert.equal(metaContent(html, 'og:description'), SITE_DESCRIPTION);

  const fonts = elements(html, 'link').find((l) => l.attrs.get('rel') === 'stylesheet' && l.attrs.get('href')?.includes('fonts.googleapis.com'));
  const href = new URL(fonts?.attrs.get('href') ?? 'https://invalid/');
  assert.deepEqual(href.searchParams.getAll('family').sort(), ['IBM Plex Mono:wght@400;500', 'IBM Plex Sans KR:wght@400;500;600']);
  assert.equal(href.searchParams.get('display'), 'swap');
});

test('Mono 글꼴에 없는 한글은 시스템 고정폭 글꼴이 아니라 IBM Plex Sans KR로 그린다', async () => {
  const styles = await Promise.all(
    site.files.filter((f) => /\.(html|css)$/.test(f) && !f.startsWith('r/')).map((f) => site.readText(f)),
  );
  const values = styles.flatMap((s) => [...s.matchAll(/--font-mono:\s*([^;}]+)/g)].map((m) => m[1]!.trim()));
  assert.ok(values.length > 0, '--font-mono가 없다');
  for (const v of values) assert.match(v, /^["']IBM Plex Mono["'],\s*["']IBM Plex Sans KR["'],\s*monospace$/, v);
});

test('결과 탭 상단: 제목·설명·칩, {N}은 모델 수로 바뀐다', async () => {
  const html = await site.readText('index.html');
  const main = element(html, 'main').inner;
  assert.equal(text(element(main, 'h1').inner), '사계절이 바뀌는 3D 나무');
  assert.ok(
    text(main).includes('같은 프롬프트로 여러 모델이 한 번씩 만든 결과물이에요. 왼쪽에서 모델을 고르면 그 결과물 하나만 실행돼요.'),
  );
  assert.deepEqual(
    elements(element(main, 'ul').inner, 'li').map((li) => text(li.inner)),
    ['season-tree-v1', `모델 ${MODEL_COUNT}개`, '모델당 1회 생성'],
  );
  for (const f of sitePages(site)) assert.ok(!(await site.readText(f)).includes('{N}'), `${f} contains {N}`);
});

test('빌드는 데이터 루트를 한 번만 읽는다', () => {
  const lines = site.log.split(/\r?\n/).filter((l) => l.includes('[opb] data:'));
  assert.equal(lines.length, 1, site.log);
  const line = lines[0] ?? '';
  assert.ok(line.includes(`${MODEL_COUNT} models`), line);
  assert.ok(line.includes(dataRoot), line);
});
