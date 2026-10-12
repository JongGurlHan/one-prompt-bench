import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { defaultRepoRoot, loadConfig, redactSecrets } from '../src/config/config.js';

// 레포의 .env는 읽지 않는다. 임시 디렉토리의 가짜 .env만 쓴다
async function tmpRepo(envText?: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'opb-config-'));
  if (envText !== undefined) await writeFile(path.join(root, '.env'), envText, 'utf8');
  return root;
}

test('loadConfig: .env를 dotenv.parse로 읽고 process.env는 바꾸지 않는다', async () => {
  const name = 'OPB_TEST_ONLY_KEY_7f3a';
  const root = await tmpRepo(`GEMINI_API_KEY=fake-key-123456789\n# 주석\n${name}="quoted value"\n`);
  const before = { ...process.env };

  const config = await loadConfig(root);

  assert.equal(config.repoRoot, root);
  assert.equal(config.dotenv.GEMINI_API_KEY, 'fake-key-123456789');
  assert.equal(config.dotenv[name], 'quoted value');
  assert.equal(process.env[name], undefined, '.env 값이 process.env로 새면 자식 프로세스에 키가 넘어간다');
  assert.deepEqual({ ...process.env }, before);
});

test('loadConfig: .env가 없으면 빈 설정', async () => {
  const root = await tmpRepo();
  const config = await loadConfig(root);
  assert.deepEqual(config, { repoRoot: root, dotenv: {} });
});

test('defaultRepoRoot: 패키지 위치에서 계산한 레포 루트 (pipeline·packages/core가 있는 곳)', () => {
  const root = defaultRepoRoot();
  assert.ok(path.isAbsolute(root));
  assert.ok(existsSync(path.join(root, 'pipeline', 'package.json')));
  assert.ok(existsSync(path.join(root, 'packages', 'core', 'package.json')));
});

test('redactSecrets: .env 값(8자 이상)을 가리고, 짧은 값은 그대로 둔다', () => {
  const config = { repoRoot: '/r', dotenv: { GEMINI_API_KEY: 'AIzaFakeKey123456', SHORT: 'abc', EMPTY: '' } };
  assert.equal(
    redactSecrets('request failed: key=AIzaFakeKey123456 (abc) again AIzaFakeKey123456', config),
    'request failed: key=*** (abc) again ***',
  );
});
