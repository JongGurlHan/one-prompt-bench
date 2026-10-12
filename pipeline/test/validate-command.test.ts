import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import type { Validation } from '@opb/core';
import { makeDataRoot, makeStatusDataRoot, patchJson, writeResult } from '@opb/core/testing';
import { ValidateService } from '../src/validation/validate.service.js';
import type { Validator } from '../src/validation/validator.js';
import { snapshot } from './batch-fakes.js';

/* ────────────────────────────────────────────────────────────
 * `validate` 명령: 대상 선택·건너뜀·실패 보고·종료 코드. 브라우저 없이 가짜 검증기로 확인한다.
 * 데이터는 @opb/core/testing의 STATUS_CASES(상태 라벨마다 모델 하나)로 OS 임시 디렉토리에 만든다.
 * ──────────────────────────────────────────────────────────── */

function fakeValidation(over: Partial<Validation> = {}): Validation {
  return {
    checkedAt: '2026-10-12T12:00:00.000Z',
    environment: { browser: 'chromium', browserVersion: '0.0.0-fake' },
    loaded: true,
    consoleErrors: [],
    pageErrors: [],
    externalRequests: [],
    screenshots: [],
    ...over,
  };
}

interface Run {
  code: number;
  validated: string[];
  logs: string[];
  errors: string[];
  output: string;
}

async function run(
  root: string,
  opts: { slugs?: string[]; all?: boolean },
  validate: (slug: string) => Promise<Validation> = async () => fakeValidation(),
): Promise<Run> {
  const validated: string[] = [];
  const logs: string[] = [];
  const errors: string[] = [];
  const validator: Validator = {
    validate: async (slug) => {
      validated.push(slug);
      return validate(slug);
    },
  };
  const service = new ValidateService(root, validator, {
    log: (l) => void logs.push(l),
    error: (l) => void errors.push(l),
  });
  const code = await service.validate({ slugs: opts.slugs ?? [], all: opts.all ?? false });
  return { code, validated, logs, errors, output: [...logs, ...errors].join('\n') };
}

/** 요약표에서 slug로 시작하는 줄 */
function summaryLine(output: string, slug: string): string {
  const lines = output.split('\n');
  const start = lines.lastIndexOf('요약');
  const line = lines.slice(start).find((l) => l.startsWith(`${slug} `));
  assert.ok(line, `요약에 ${slug} 줄이 없다:\n${output}`);
  return line;
}

/* ───────── --all ───────── */

test('--all: models.json의 출시일 최신순에서 outcome ok인 모델만 검증하고, 나머지는 건너뜀(이유) → exit 0', async () => {
  const root = await makeStatusDataRoot();

  const r = await run(root, { all: true });

  assert.equal(r.code, 0, r.output);
  // STATUS_CASES 중 ok: 정상(10-07) · 지시 미준수(10-01) · 위반(09-29) · 검증 전(09-03)
  assert.deepEqual(r.validated, ['model-ok', 'model-miss', 'model-violation', 'model-unvalidated']);
  assert.match(summaryLine(r.output, 'model-truncated'), /건너뜀.*truncated/);
  assert.match(summaryLine(r.output, 'model-no-html'), /건너뜀.*no_html/);
  assert.match(summaryLine(r.output, 'model-refused'), /건너뜀.*refused/);
  assert.match(summaryLine(r.output, 'model-usage-limit'), /건너뜀.*api_failed/);
  assert.match(summaryLine(r.output, 'model-failed'), /건너뜀.*api_failed/);
  assert.match(summaryLine(r.output, 'model-pending'), /건너뜀.*meta\.json/);
  assert.match(r.output, /검증 4 · 건너뜀 6 · 실패 0/);
  assert.deepEqual(r.errors, []);
});

test('--all: 검증한 모델마다 loaded·에러 수·외부 요청 수를 요약에 보여 준다', async () => {
  const root = await makeStatusDataRoot(['정상', '위반']);

  const r = await run(root, { all: true }, async (slug) =>
    slug === 'model-ok'
      ? fakeValidation()
      : fakeValidation({
          loaded: false,
          consoleErrors: ['a', 'b'],
          pageErrors: ['c'],
          externalRequests: [
            { url: 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js', resourceType: 'script' },
            { url: 'https://example.com/a.png', resourceType: 'image' },
          ],
        }),
  );

  assert.equal(r.code, 0, r.output);
  assert.match(summaryLine(r.output, 'model-ok'), /검증\s+loaded true · 콘솔 에러 0 · 페이지 에러 0 · 외부 요청 0/);
  assert.match(
    summaryLine(r.output, 'model-violation'),
    /검증\s+loaded false · 콘솔 에러 2 · 페이지 에러 1 · 외부 요청 2/,
  );
});

test('--all: 결과가 하나도 없으면 아무것도 검증하지 않고 exit 0', async () => {
  const root = await makeDataRoot();
  const r = await run(root, { all: true });
  assert.equal(r.code, 0, r.output);
  assert.deepEqual(r.validated, []);
  assert.match(r.output, /검증 0 · 건너뜀 4 · 실패 0/);
});

test('--all: meta.json이 깨진 모델은 건드리지 않고 실패로 보고, 나머지는 계속 → exit 1', async () => {
  const root = await makeStatusDataRoot(['정상', '위반']);
  await patchJson<Record<string, unknown>>(root, 'results/model-ok/meta.json', (m) => {
    m.outcome = 'great';
  });
  const before = await snapshot(path.join(root, 'results', 'model-ok'));

  const r = await run(root, { all: true });

  assert.equal(r.code, 1);
  assert.deepEqual(r.validated, ['model-violation']);
  assert.match(summaryLine(r.output, 'model-ok'), /실패.*meta\.json.*스키마/);
  assert.deepEqual(await snapshot(path.join(root, 'results', 'model-ok')), before);
});

/* ───────── slug 직접 지정 ───────── */

test('slug 직접 지정: 준 순서대로 검증 → exit 0', async () => {
  const root = await makeStatusDataRoot();

  const r = await run(root, { slugs: ['model-violation', 'model-ok'] });

  assert.equal(r.code, 0, r.output);
  assert.deepEqual(r.validated, ['model-violation', 'model-ok']);
  assert.match(r.output, /검증 2 · 건너뜀 0 · 실패 0/);
});

test('slug 직접 지정: 모르는 slug가 하나라도 있으면 아무것도 하지 않고 exit 1', async () => {
  const root = await makeStatusDataRoot();

  const r = await run(root, { slugs: ['model-ok', 'no-such-model'] });

  assert.equal(r.code, 1);
  assert.deepEqual(r.validated, []);
  assert.match(r.output, /no-such-model/);
});

test('slug 직접 지정: outcome이 ok가 아니거나 생성 전이면 실패로 보고하고 다음 모델을 계속한 뒤 exit 1', async () => {
  const root = await makeStatusDataRoot();

  const r = await run(root, { slugs: ['model-truncated', 'model-ok', 'model-pending', 'model-usage-limit'] });

  assert.equal(r.code, 1);
  assert.deepEqual(r.validated, ['model-ok']);
  assert.match(summaryLine(r.output, 'model-truncated'), /실패.*truncated/);
  assert.match(summaryLine(r.output, 'model-pending'), /실패.*meta\.json/);
  assert.match(summaryLine(r.output, 'model-usage-limit'), /실패.*api_failed/);
  assert.match(summaryLine(r.output, 'model-ok'), /검증/);
  assert.match(r.output, /검증 1 · 건너뜀 0 · 실패 3/);
});

test('한 모델의 검증이 throw해도 다음 모델을 계속하고, 이유를 요약에 남긴 뒤 exit 1', async () => {
  const root = await makeStatusDataRoot();

  const r = await run(root, { all: true }, async (slug) => {
    if (slug === 'model-miss') throw new Error("browserType.launch: Executable doesn't exist");
    return fakeValidation();
  });

  assert.equal(r.code, 1);
  assert.deepEqual(r.validated, ['model-ok', 'model-miss', 'model-violation', 'model-unvalidated']);
  assert.match(summaryLine(r.output, 'model-miss'), /실패.*Executable doesn't exist/);
  assert.match(r.output, /검증 3 · 건너뜀 6 · 실패 1/);
});

test('models.json을 읽을 수 없으면 아무것도 하지 않고 exit 1', async () => {
  const root = await makeDataRoot();
  await writeResult(root, 'gemini-a', { outcome: 'ok' });
  await writeFile(path.join(root, 'models.json'), '{ not json', 'utf8');

  const r = await run(root, { all: true });

  assert.equal(r.code, 1);
  assert.deepEqual(r.validated, []);
  assert.match(r.output, /models\.json/);
});
