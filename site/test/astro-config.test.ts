import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeBase } from '../astro.config.mjs';

/* astro.config.mjs의 base 정규화: 배포 워크플로는 configure-pages의 base_path를 SITE_BASE로 넘긴다 */

test('configure-pages의 base_path(끝 슬래시 없음)도 /<레포 이름>/ 꼴이 된다', () => {
  assert.equal(normalizeBase('/one-prompt-bench'), '/one-prompt-bench/');
  assert.equal(normalizeBase('/one-prompt-bench/'), '/one-prompt-bench/');
  assert.equal(normalizeBase('one-prompt-bench'), '/one-prompt-bench/');
  assert.equal(normalizeBase(' /one-prompt-bench '), '/one-prompt-bench/');
});

test('base_path가 비면(사용자 사이트·사용자 도메인) 또는 없으면 /', () => {
  assert.equal(normalizeBase(''), '/');
  assert.equal(normalizeBase('/'), '/');
  assert.equal(normalizeBase(undefined), '/');
});
