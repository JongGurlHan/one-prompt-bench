import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { STATUS_LEGEND } from '../src/display.js';
import { makeDataRoot, makeStatusDataRoot, writeResult } from './support/testing.js';

const SCRIPT = fileURLToPath(new URL('../scripts/check-results.ts', import.meta.url));
const CORE_DIR = fileURLToPath(new URL('..', import.meta.url));

/** `tsx scripts/check-results.ts`를 OPB_DATA_ROOT=dataRoot로 실행한다 */
function run(dataRoot: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', SCRIPT], {
      cwd: CORE_DIR,
      env: { ...process.env, OPB_DATA_ROOT: dataRoot },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('이슈가 없으면 검사한 결과 폴더 수와 OK, exit 0', async () => {
  const root = await makeStatusDataRoot(STATUS_LEGEND.filter((l) => l !== '검증 전'));
  const res = await run(root);
  assert.equal(res.code, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /^OK\b.*\b8 result folders\b/m); // 생성 전·검증 전을 뺀 8개
});

test('results/가 없어도 OK (0개), exit 0', async () => {
  const root = await makeDataRoot();
  const res = await run(root);
  assert.equal(res.code, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /^OK\b.*\b0 result folders\b/m);
});

test('이슈가 있으면 "경로: 이유"를 한 줄씩 모두 출력하고 exit 1', async () => {
  const root = await makeDataRoot();
  await writeResult(root, 'gemini-a', { outcome: 'ok' });
  await writeResult(root, 'claude-b', { outcome: 'ok', validation: null });
  await writeFile(path.join(root, 'results', 'gemini-a', 'index.html'), 'edited');
  await rm(path.join(root, 'results', 'gemini-a', 'winter.jpg'));
  await mkdir(path.join(root, 'results', 'nobody'));

  const res = await run(root);
  assert.equal(res.code, 1, res.stdout + res.stderr);
  const out = res.stdout + res.stderr;
  const lines = out.split(/\r?\n/);
  for (const prefix of [
    'results/claude-b/meta.json: ',
    'results/gemini-a/index.html: ',
    'results/gemini-a/winter.jpg: ',
    'results/nobody: ',
    'results/nobody/meta.json: ',
  ]) {
    assert.ok(lines.some((l) => l.startsWith(prefix)), `missing line "${prefix}…" in\n${out}`);
  }
  assert.doesNotMatch(res.stdout, /^OK\b/m);
});
