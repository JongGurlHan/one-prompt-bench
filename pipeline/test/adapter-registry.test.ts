import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_MAX_OUTPUT_TOKENS, type GenerationRequest } from '@opb/core';
import { GeminiAdapter, type GeminiClient } from '../src/adapters/gemini/gemini.adapter.js';
import { readGeminiSdkVersion } from '../src/adapters/gemini/gemini.client.js';
import { RAW_STREAM_FILE } from '../src/adapters/gemini/gemini.recorder.js';
import { createAdapterRegistry, registeredTools } from '../src/adapters/registry.js';
import { fakeClient, loadChunks } from './gemini-fakes.js';

const req: GenerationRequest = {
  modelId: 'gemini-3.8-flash',
  system: '사용자의 요청에 답하세요.\n',
  user: '나무',
  reasoningEffort: 'high',
  maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
};

test('레지스트리에는 gemini-api·claude-code가 등록돼 있다 (codex-cli는 phase 4)', () => {
  const registry = createAdapterRegistry();
  assert.deepEqual([...registeredTools(registry)].sort(), ['claude-code', 'gemini-api']);
  assert.equal(registry['codex-cli'], undefined);
  assert.equal(typeof registry['claude-code']?.preflight, 'function', 'claude auth status 점검');
  assert.equal(typeof registry['claude-code']?.createRecorder, 'function', 'smoke 원본 출력 기록기');
});

test('레지스트리를 만들 때는 어댑터·클라이언트를 만들지 않는다 (키가 없어도 된다)', () => {
  assert.doesNotThrow(() => createAdapterRegistry());
});

test('gemini-api: 설정의 GEMINI_API_KEY로 클라이언트를 만들고, wrapClient가 감싼 클라이언트를 어댑터가 쓴다', async () => {
  const fake = fakeClient([{ chunks: await loadChunks('ok') }]);
  let wrapped: GeminiClient | undefined;

  const adapter = createAdapterRegistry()['gemini-api']!.create(
    { repoRoot: '/r', dotenv: { GEMINI_API_KEY: 'fake-key-not-real-000000' } },
    {
      wrapClient: (real) => {
        wrapped = real;
        return fake; // 실제 SDK 클라이언트 대신 가짜 → 네트워크 없음
      },
    },
  );

  assert.ok(adapter instanceof GeminiAdapter);
  assert.equal(typeof wrapped?.generateContentStream, 'function', '래퍼는 실제 클라이언트를 받는다');
  assert.deepEqual(adapter.generator, { tool: 'gemini-api', version: readGeminiSdkVersion() });

  const res = await adapter.generate(req, new AbortController().signal);
  assert.equal(fake.params.length, 1);
  assert.ok(res.text.length > 0);
});

test('gemini-api: GEMINI_API_KEY가 없거나 비어 있으면 만들지 않는다', () => {
  const entry = createAdapterRegistry()['gemini-api']!;
  assert.throws(() => entry.create({ repoRoot: '/r', dotenv: {} }), /GEMINI_API_KEY/);
  assert.throws(() => entry.create({ repoRoot: '/r', dotenv: { GEMINI_API_KEY: '   ' } }), /GEMINI_API_KEY/);
});

test('gemini-api: smoke 기록 래퍼(createRecorder)를 wrapClient로 넘기면 어댑터가 받은 청크가 기록된다', async () => {
  const chunks = await loadChunks('ok');
  const fake = fakeClient([{ chunks }]);
  const entry = createAdapterRegistry()['gemini-api']!;
  const recorder = entry.createRecorder!((text) => text);

  const adapter = entry.create(
    { repoRoot: '/r', dotenv: { GEMINI_API_KEY: 'fake-key-not-real-000000' } },
    { wrapClient: () => recorder.wrap(fake) }, // 실제 SDK 클라이언트 대신 가짜를 기록 래퍼로 감싼다
  );
  await adapter.generate(req, new AbortController().signal);

  const [file] = recorder.files();
  assert.equal(file?.name, RAW_STREAM_FILE);
  assert.equal(file?.content.split('\n').filter(Boolean).length, chunks.length);
});
