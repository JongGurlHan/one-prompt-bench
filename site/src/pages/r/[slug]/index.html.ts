import type { APIRoute, GetStaticPaths } from 'astro';
import { rawFileResponse, rawFileSlugs } from '../../../lib/data.ts';

// 결과물 사본 /r/<slug>/index.html — results/<slug>/index.html 바이트 그대로 (개발 서버도 같은 주소)
// 샌드박스 iframe의 src로만 쓰고 직접 링크하지 않는다 (ADR-009)
export const getStaticPaths = (async () =>
  (await rawFileSlugs('index.html')).map((slug) => ({ params: { slug } }))) satisfies GetStaticPaths;

export const GET: APIRoute = ({ params }) => rawFileResponse(params.slug, 'index.html');
