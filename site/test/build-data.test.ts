import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FAKE_MODELS, makeDataRoot, patchJson, writeResult } from '@opb/core/testing';
import { SiteBuildError, buildSite } from './support/build.ts';
import { element, elements, text } from './support/html.ts';

/* 데이터 루트의 상태에 따른 빌드 성공·실패 (DATA.md "사이트 빌드의 데이터 검사") */

test('결과가 하나도 없는 데이터 루트로도 빌드된다', async () => {
  const site = await buildSite(await makeDataRoot());

  assert.ok(site.has('index.html'));
  assert.deepEqual(site.files.filter((f) => f.startsWith('r/') || f.startsWith('view/')), []);

  const html = await site.readText('index.html');
  assert.equal(text(element(html, 'h1').inner), '사계절이 바뀌는 3D 나무');
  assert.ok(elements(element(html, 'main').inner, 'li').some((li) => text(li.inner) === `모델 ${FAKE_MODELS.length}개`));
});

test('스키마를 통과하지 못한 meta.json·judgment.json이 있으면 빌드가 실패하고 파일 경로를 보여 준다', async () => {
  const root = await makeDataRoot();
  await writeResult(root, 'gemini-a', { outcome: 'ok' });
  await writeResult(root, 'claude-a', { outcome: 'ok', judgment: {} });
  await patchJson<{ outcome: string }>(root, 'results/gemini-a/meta.json', (m) => {
    m.outcome = 'exploded';
  });
  await patchJson<{ requirements: { scene: string } }>(root, 'results/claude-a/judgment.json', (j) => {
    j.requirements.scene = 'great';
  });

  await assert.rejects(buildSite(root), (err: unknown) => {
    assert.ok(err instanceof SiteBuildError, String(err));
    assert.ok(err.log.includes('results/gemini-a/meta.json'), err.log);
    assert.ok(err.log.includes('results/claude-a/judgment.json'), err.log);
    return true;
  });
});

test('models.json이 스키마를 통과하지 못하면 빌드가 실패한다', async () => {
  const root = await makeDataRoot();
  await patchJson<{ slug: string }[]>(root, 'models.json', (models) => {
    models[0]!.slug = 'Not A Slug';
  });

  await assert.rejects(buildSite(root), (err: unknown) => {
    assert.ok(err instanceof SiteBuildError, String(err));
    assert.ok(err.log.includes('models.json'), err.log);
    return true;
  });
});
