import type { APIRoute, GetStaticPaths } from 'astro';
import { rawFileResponse, rawFileSlugs } from '../../../lib/data.ts';

// 응답 원문 사본 /r/<slug>/response.txt — results/<slug>/response.txt 바이트 그대로 (개발 서버도 같은 주소)
export const getStaticPaths = (async () =>
  (await rawFileSlugs('response.txt')).map((slug) => ({ params: { slug } }))) satisfies GetStaticPaths;

export const GET: APIRoute = ({ params }) => rawFileResponse(params.slug, 'response.txt');
