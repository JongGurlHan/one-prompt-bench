import { readFile, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  GenerationRecordSchema,
  RESULT_IFRAME_SANDBOX,
  ValidationSchema,
  type Validation,
} from '@opb/core';
import { chromium, type Browser, type Page } from 'playwright';
import { resultDirPath } from '../generation/batch.js';
import { formatIssues } from '../generation/models.js';

/* ────────────────────────────────────────────────────────────
 * Playwright 검증기 (ARCHITECTURE "검증기", ADR-009·010).
 * results/<slug>/index.html을 사이트와 같은 샌드박스 iframe(1280×800)에 담아 로컬 서버(127.0.0.1)에서 열고,
 * 열림·콘솔 에러·페이지 에러·외부 요청·스크린샷 4장을 meta.json의 validation에 기록한다.
 * 조건 검사 판정은 저장하지 않는다(ADR-011 — request-rules가 매번 계산).
 * ──────────────────────────────────────────────────────────── */

/** iframe load를 0초로 각 계절 중간에 한 장씩 (계절마다 10초) */
export const SCREENSHOT_SCHEDULE = [
  { label: 'spring', atMs: 5_000 },
  { label: 'summer', atMs: 15_000 },
  { label: 'autumn', atMs: 25_000 },
  { label: 'winter', atMs: 35_000 },
] as const;

export const DEFAULT_LOAD_TIMEOUT_MS = 30_000;

/** 검증용 페이지의 뷰포트이자 iframe 크기 */
export const VALIDATION_VIEWPORT = { width: 1280, height: 800 } as const;

/**
 * headless Chromium의 WebGL: GPU가 없어도 소프트웨어 렌더러(SwiftShader)로 돌게 한다.
 * Chromium은 WebGL의 SwiftShader 자동 대체를 막아 가고 있고(--enable-unsafe-swiftshader로 허용),
 * Playwright 1.64는 이 플래그를 macOS에서만 기본으로 넣는다. --use-angle=swiftshader로 PC의 GPU와 관계없이
 * 같은 렌더러를 쓴다. 확인(2026-10-12, Windows, headless shell 156): webgl2 · ANGLE(SwiftShader) — WebGL 픽스처 테스트
 */
export const CHROMIUM_ARGS: readonly string[] = ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'];

export interface ValidateOptions {
  /** 스크린샷 시점. 테스트는 짧게 준다 (기본 SCREENSHOT_SCHEDULE) */
  schedule?: readonly { label: string; atMs: number }[];
  /** iframe load를 기다리는 시간 (기본 30초) */
  loadTimeoutMs?: number;
  /** 페이지를 열기 전에 부른다. 테스트가 page.route로 외부 요청을 가로챈다 */
  preparePage?: (page: Page) => Promise<void>;
  /** checkedAt */
  now?: () => Date;
}

/** 검증할 수 있는 기록: meta.json이 스키마를 통과하고 modelSlug가 폴더 이름과 같고 outcome ok(결과물 있음) */
export type ValidationTarget =
  /** raw = meta.json을 읽은 그대로의 객체 (validation만 바꿔 다시 쓴다) */
  | { kind: 'ok'; raw: Record<string, unknown> }
  /** 생성 전 (meta.json 없음) 또는 outcome이 ok가 아님 */
  | { kind: 'not_ok'; reason: string }
  /** meta.json이 JSON이 아니거나 스키마를 통과하지 못하거나 modelSlug가 다름 — 사람이 확인할 것 */
  | { kind: 'broken'; reason: string };

/** results/<slug>/meta.json을 읽어 검증 대상인지 본다. 파일은 바꾸지 않는다 */
export async function readValidationTarget(repoRoot: string, slug: string): Promise<ValidationTarget> {
  const file = path.join(resultDirPath(repoRoot, slug), 'meta.json');
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { kind: 'not_ok', reason: 'meta.json이 없습니다 (생성 전)' };
    }
    throw err;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { kind: 'broken', reason: `meta.json이 JSON이 아닙니다 (${errorMessage(err)})` };
  }
  const parsed = GenerationRecordSchema.safeParse(raw);
  if (!parsed.success) {
    return { kind: 'broken', reason: `meta.json이 스키마를 통과하지 못합니다: ${formatIssues(parsed.error)}` };
  }
  const record = parsed.data;
  if (record.modelSlug !== slug) {
    return { kind: 'broken', reason: `meta.json의 modelSlug(${record.modelSlug})가 폴더 이름(${slug})과 다릅니다` };
  }
  if (record.outcome !== 'ok' || record.output === null) {
    return { kind: 'not_ok', reason: `outcome이 ${record.outcome}입니다 (결과물이 있는 ok만 검증합니다)` };
  }
  return { kind: 'ok', raw: raw as Record<string, unknown> };
}

/**
 * results/<slug>/를 검증하고 meta.json의 validation과 스크린샷(<label>.jpg)을 쓴다. 재검증이면 덮어쓴다.
 * 다른 필드·judgment.json·index.html은 건드리지 않는다.
 * 대상이 아니면(기록 없음·outcome ok 아님·깨진 meta.json) 브라우저를 띄우지 않고 이유를 담아 throw한다.
 * 파일은 검증이 끝까지 성공한 뒤에만 쓴다 (도중에 실패하면 아무것도 바뀌지 않는다).
 */
export async function validateResult(repoRoot: string, slug: string, opts: ValidateOptions = {}): Promise<Validation> {
  const target = await readValidationTarget(repoRoot, slug);
  if (target.kind !== 'ok') throw new Error(`results/${slug}: ${target.reason}`);

  const dir = resultDirPath(repoRoot, slug);
  const html = await readFile(path.join(dir, 'index.html'));
  const schedule = opts.schedule ?? SCREENSHOT_SCHEDULE;

  const server = await startServer(slug, html);
  let browser: Browser | null = null;
  let observed: Observed;
  try {
    browser = await chromium.launch({ args: [...CHROMIUM_ARGS] });
    observed = await observe(browser, server, {
      schedule,
      loadTimeoutMs: opts.loadTimeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS,
      preparePage: opts.preparePage,
    });
  } finally {
    try {
      await browser?.close();
    } finally {
      await server.close();
    }
  }

  const relDir = path.posix.join('results', slug);
  const validation = ValidationSchema.parse({
    checkedAt: (opts.now ?? (() => new Date()))().toISOString(),
    environment: { browser: 'chromium', browserVersion: observed.browserVersion },
    loaded: observed.loaded,
    consoleErrors: observed.consoleErrors,
    pageErrors: observed.pageErrors,
    externalRequests: observed.externalRequests,
    screenshots: schedule.map((s) => ({ label: s.label, atMs: s.atMs, path: `${relDir}/${s.label}.jpg` })),
  } satisfies Validation);

  // 기존 meta.json 객체에서 validation만 바꾼다 (다른 필드·키 순서 그대로). 쓰기 전에 스키마로 검사
  const next = { ...target.raw, validation };
  const checked = GenerationRecordSchema.safeParse(next);
  if (!checked.success) {
    throw new Error(`results/${slug}: 검증 결과를 넣은 meta.json이 스키마를 통과하지 못합니다: ${formatIssues(checked.error)}`);
  }

  for (const [i, s] of schedule.entries()) await writeFile(path.join(dir, `${s.label}.jpg`), observed.screenshots[i]!);
  await writeFile(path.join(dir, 'meta.json'), JSON.stringify(next, null, 2) + '\n', 'utf8');
  return validation;
}

/* ───────── 브라우저 ───────── */

interface Observed {
  browserVersion: string;
  loaded: boolean;
  consoleErrors: string[];
  pageErrors: string[];
  externalRequests: { url: string; resourceType: string }[];
  /** schedule 순서의 JPEG 바이트 */
  screenshots: Buffer[];
}

async function observe(
  browser: Browser,
  server: LocalServer,
  opts: Required<Pick<ValidateOptions, 'schedule' | 'loadTimeoutMs'>> & Pick<ValidateOptions, 'preparePage'>,
): Promise<Observed> {
  const context = await browser.newContext({ viewport: { ...VALIDATION_VIEWPORT }, deviceScaleFactor: 1 });
  const page = await context.newPage();

  // 페이지의 이벤트는 iframe(다른 프로세스일 수 있음) 안의 것까지 들어온다 (테스트로 확인)
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const externalRequests: { url: string; resourceType: string }[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('request', (req) => {
    const url = req.url();
    if (isExternalHttp(url, server.origin)) externalRequests.push({ url, resourceType: req.resourceType() });
  });

  await opts.preparePage?.(page);

  // 검증용 페이지의 DOMContentLoaded까지만 기다린다 (page의 load는 iframe load를 기다리므로 쓰지 않는다)
  await page.goto(server.pageUrl, { waitUntil: 'domcontentloaded' });
  const loaded = await page
    .waitForFunction(`window.${LOADED_FLAG} === true`, undefined, { timeout: opts.loadTimeoutMs })
    .then(
      () => true,
      (err: unknown) => {
        if (err instanceof Error && err.name === 'TimeoutError') return false;
        throw err;
      },
    );

  // load(또는 제한 시간)를 0초로 계획한 시점마다 iframe 영역만 찍는다
  const t0 = performance.now();
  const frame = page.locator('iframe');
  const screenshots: Buffer[] = [];
  for (const s of opts.schedule) {
    const wait = t0 + s.atMs - performance.now();
    if (wait > 0) await delay(wait);
    screenshots.push(await frame.screenshot({ type: 'jpeg', quality: 80 }));
  }

  return { browserVersion: browser.version(), loaded, consoleErrors, pageErrors, externalRequests, screenshots };
}

/** 로컬 서버가 아닌 http(s) 요청 (data:·blob: 등은 넣지 않는다) */
function isExternalHttp(url: string, localOrigin: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return (u.protocol === 'http:' || u.protocol === 'https:') && u.origin !== localOrigin;
}

/* ───────── 로컬 서버: 검증용 페이지와 그 slug의 index.html만 ───────── */

const LOADED_FLAG = '__opbIframeLoaded';

interface LocalServer {
  origin: string;
  pageUrl: string;
  close(): Promise<void>;
}

/** iframe 하나를 1280×800으로 담은 검증용 페이지. sandbox 값은 사이트와 같은 core 상수 (ADR-009) */
export function validationPageHtml(resultPath: string): string {
  const { width, height } = VALIDATION_VIEWPORT;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>One Prompt Bench validation</title>
<style>html, body { margin: 0; padding: 0; overflow: hidden; } iframe { display: block; border: 0; }</style>
</head>
<body>
<iframe sandbox="${RESULT_IFRAME_SANDBOX}" src="${resultPath}" width="${width}" height="${height}" onload="window.${LOADED_FLAG} = true"></iframe>
</body>
</html>
`;
}

async function startServer(slug: string, html: Buffer): Promise<LocalServer> {
  // slug는 resultDirPath가 kebab-case로 검사했다 → 경로·HTML 속성에 그대로 넣어도 안전하다
  const resultPath = `/results/${slug}/index.html`;
  const page = Buffer.from(validationPageHtml(resultPath), 'utf8');

  const server: Server = createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    const body = req.method !== 'GET' ? null : pathname === '/' ? page : pathname === resultPath ? html : null;
    if (body === null) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(body);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;
  return {
    origin,
    pageUrl: `${origin}/`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
