import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyRequest, judgeRequests, type ExternalRequest } from '../src/request-rules.js';

const s = (url: string): ExternalRequest => ({ url, resourceType: 'script' });

test('three.js 본체·부가 모듈, 여러 CDN, 버전 고정 → 허용', () => {
  for (const url of [
    'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js',
    'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/controls/OrbitControls.js',
    'https://unpkg.com/three@0.170.0/build/three.module.js',
    'https://esm.sh/three@0.170.0',
    'https://esm.sh/v135/three@0.170.0/es2022/three.mjs',
    'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
  ]) {
    assert.equal(classifyRequest(s(url)), 'three', url);
  }
});

test('three.js인데 버전 미고정 → 지시 미준수', () => {
  for (const url of [
    'https://cdn.jsdelivr.net/npm/three/build/three.module.js',
    'https://unpkg.com/three@latest/build/three.module.js',
    'https://esm.sh/three@^0.170.0',
    'https://cdn.jsdelivr.net/npm/three@0.170/build/three.module.js',
    'https://threejs.org/build/three.module.js',
  ]) {
    assert.equal(classifyRequest(s(url)), 'three_unpinned', url);
  }
});

test('이름만 비슷한 다른 패키지나 다른 라이브러리 → 위반(library)', () => {
  assert.equal(classifyRequest(s('https://cdn.jsdelivr.net/npm/three-stdlib@2.29.0/index.js')), 'library');
  assert.equal(classifyRequest(s('https://cdn.jsdelivr.net/npm/simplex-noise@4.0.1/dist/esm/simplex-noise.js')), 'library');
  // 확장자가 .js면 fetch로 불러와도 라이브러리로 본다
  assert.equal(classifyRequest({ url: 'https://example.com/lib/gsap.min.js', resourceType: 'fetch' }), 'library');
});

test('이미지 → 위반(image), 웹폰트·스타일시트 → 참고(other)', () => {
  assert.equal(classifyRequest({ url: 'https://example.com/bark.jpg', resourceType: 'image' }), 'image');
  assert.equal(classifyRequest({ url: 'https://example.com/sky.hdr', resourceType: 'fetch' }), 'image');
  assert.equal(classifyRequest({ url: 'https://fonts.googleapis.com/css2?family=Noto+Sans+KR', resourceType: 'stylesheet' }), 'other');
  assert.equal(classifyRequest({ url: 'https://fonts.gstatic.com/s/notosanskr/v36/a.woff2', resourceType: 'font' }), 'other');
});

test('종합 판정: 위반 > 지시 미준수 > 정상', () => {
  const pinned = s('https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js');
  const unpinned = s('https://cdn.jsdelivr.net/npm/three/build/three.module.js');
  const font = { url: 'https://fonts.gstatic.com/s/x.woff2', resourceType: 'font' };
  const lib = s('https://cdn.jsdelivr.net/npm/simplex-noise@4.0.1/dist/esm/simplex-noise.js');

  assert.equal(judgeRequests([]).verdict, 'ok'); // 외부 요청 없이 직접 짠 경우도 정상
  assert.equal(judgeRequests([pinned, font]).verdict, 'ok'); // 웹폰트는 참고만
  assert.equal(judgeRequests([unpinned, font]).verdict, 'instruction_miss');
  assert.equal(judgeRequests([unpinned, lib]).verdict, 'violation');
});
