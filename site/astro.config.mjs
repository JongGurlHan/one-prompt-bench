import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';

// 기본 데이터 루트(레포 루트). OPB_DATA_ROOT와 견줘 실제로 고르는 곳은 src/lib/data.ts 한 곳이다
const repoRoot = fileURLToPath(new URL('../', import.meta.url));

export default defineConfig({
  output: 'static',
  // GitHub Pages 프로젝트 경로: 배포 워크플로가 SITE_URL·SITE_BASE를 채운다
  site: process.env.SITE_URL || undefined,
  base: normalizeBase(process.env.SITE_BASE),
  vite: {
    define: { __OPB_REPO_ROOT__: JSON.stringify(repoRoot) },
  },
});

/** '/<레포 이름>/' 꼴로 맞춘다(BASE_URL이 늘 '/'로 끝나게). 없거나 비면 '/' */
function normalizeBase(value) {
  const trimmed = (value ?? '').trim().replace(/^\/+|\/+$/g, '');
  return trimmed ? `/${trimmed}/` : '/';
}
