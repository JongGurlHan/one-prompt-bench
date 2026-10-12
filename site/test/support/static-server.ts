import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

/* ────────────────────────────────────────────────────────────
 * 빌드한 dist를 base 경로 아래에 띄우는 정적 서버 (브라우저 테스트용, 127.0.0.1만)
 * GitHub Pages처럼 '/<base>/x/'는 x/index.html로 응답하고, base 밖이나 없는 파일은 404다.
 * ──────────────────────────────────────────────────────────── */

const CONTENT_TYPE: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

export interface StaticServer {
  /** http://127.0.0.1:<port> */
  origin: string;
  /** base 기준 주소: url('view/x/') → http://127.0.0.1:<port>/<base>/view/x/ */
  url(rel?: string): string;
  close(): Promise<void>;
}

export async function serveDist(outDir: string, base: string): Promise<StaticServer> {
  const root = path.resolve(outDir);
  const server = createServer((req, res) => {
    void (async () => {
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      let file: string | null = null;
      if (pathname.startsWith(base)) {
        let rel = decodeURIComponent(pathname.slice(base.length));
        if (rel === '' || rel.endsWith('/')) rel += 'index.html';
        const abs = path.resolve(root, rel);
        if (abs.startsWith(root + path.sep) && (await stat(abs).catch(() => null))?.isFile()) file = abs;
      }
      if (!file) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found');
        return;
      }
      const body = await readFile(file);
      res
        .writeHead(200, { 'Content-Type': CONTENT_TYPE[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' })
        .end(body);
    })().catch((err: unknown) => {
      res.writeHead(500).end(String(err));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin,
    url: (rel = '') => origin + base + rel.replace(/^\/+/, ''),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
