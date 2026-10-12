import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GeminiChunk, GeminiClient } from '../src/adapters/gemini/gemini.adapter.js';
import { RAW_ERROR_FILE, RAW_STREAM_FILE, createGeminiRecorder } from '../src/adapters/gemini/gemini.recorder.js';
import type { RawFile } from '../src/adapters/raw-recorder.js';
import { fakeClient, loadApiError, loadChunks, type FakeCall } from './gemini-fakes.js';

/* ───────── smoke용 Gemini 기록 래퍼: 클라이언트를 감싸 받은 청크·에러를 그대로 모은다 (실제 SDK 요청 없음) ───────── */

const params = { model: 'gemini-3.8-flash', contents: 'Hello', config: { systemInstruction: 'sys' } };
const noRedact = (text: string) => text;

/** 래퍼를 거쳐 스트림을 끝까지 읽는다. 받은 청크와 던진 에러를 돌려준다 */
async function consume(client: GeminiClient): Promise<{ chunks: GeminiChunk[]; error: unknown }> {
  const chunks: GeminiChunk[] = [];
  try {
    for await (const chunk of await client.generateContentStream(params)) chunks.push(chunk);
    return { chunks, error: undefined };
  } catch (error) {
    return { chunks, error };
  }
}

async function record(calls: FakeCall[], redact = noRedact) {
  const inner = fakeClient(calls);
  const recorder = createGeminiRecorder(redact);
  const result = await consume(recorder.wrap(inner));
  return { ...result, inner, files: recorder.files() };
}

const fileNamed = (files: RawFile[], name: string) => files.find((f) => f.name === name);

function rawError(files: RawFile[]): Record<string, unknown> {
  const file = fileNamed(files, RAW_ERROR_FILE);
  assert.ok(file, `${RAW_ERROR_FILE}가 없다`);
  return JSON.parse(file.content) as Record<string, unknown>;
}

test('정상 스트림: 청크를 받은 순서대로 한 줄에 하나씩 raw-stream.jsonl에 담고, 청크는 그대로 넘긴다', async () => {
  const chunks = await loadChunks('ok');
  const { chunks: seen, error, inner, files } = await record([{ chunks }]);

  assert.equal(error, undefined);
  assert.deepEqual(seen, chunks, '어댑터가 받는 청크가 바뀌면 안 된다');
  assert.deepEqual(inner.params, [params], '요청 인자를 그대로 넘긴다');
  assert.deepEqual(
    files.map((f) => f.name),
    [RAW_STREAM_FILE],
  );

  const content = fileNamed(files, RAW_STREAM_FILE)!.content;
  assert.ok(content.endsWith('\n'));
  const lines = content.split('\n').slice(0, -1);
  assert.equal(lines.length, chunks.length);
  assert.deepEqual(
    lines.map((line) => JSON.parse(line) as GeminiChunk),
    chunks,
  );
});

test('빈 스트림: 스트림은 열렸으므로 빈 raw-stream.jsonl을 남긴다', async () => {
  const { files } = await record([{ chunks: [] }]);
  assert.deepEqual(files, [{ name: RAW_STREAM_FILE, content: '' }]);
});

test('요청 단계 실패: 같은 에러를 다시 던지고 raw-error.json에 이름·메시지·status·본문을 남긴다 (fixture 형식 {status, body})', async () => {
  const apiErr = await loadApiError('429-rate-limit');
  const { error, files } = await record([{ reject: apiErr }]);

  assert.equal(error, apiErr, '래퍼는 에러를 바꾸거나 삼키지 않는다');
  assert.equal(fileNamed(files, RAW_STREAM_FILE), undefined, '스트림이 열리지 않았으면 raw-stream.jsonl은 없다');
  const raw = rawError(files);
  assert.equal(raw.stage, 'request');
  assert.equal(raw.chunksBeforeError, 0);
  assert.equal(raw.name, 'ApiError');
  assert.equal(raw.message, apiErr.message);
  assert.equal(raw.status, 429);
  const body = raw.body as { error: { status: string; details: unknown[] } };
  assert.equal(body.error.status, 'RESOURCE_EXHAUSTED');
  assert.equal(body.error.details.length, 3, '상세 본문(details)을 줄이지 않는다');
});

test('스트림 도중 실패: 그때까지의 청크(raw-stream.jsonl)와 에러(raw-error.json)를 함께 남긴다', async () => {
  const chunks = (await loadChunks('ok')).slice(0, 2);
  const apiErr = await loadApiError('503', 'in_stream');
  const { chunks: seen, error, files } = await record([{ chunks, throwAfter: apiErr }]);

  assert.equal(error, apiErr);
  assert.deepEqual(seen, chunks);
  assert.equal(fileNamed(files, RAW_STREAM_FILE)!.content.split('\n').filter(Boolean).length, 2);
  const raw = rawError(files);
  assert.equal(raw.stage, 'stream');
  assert.equal(raw.chunksBeforeError, 2);
  assert.equal(raw.status, 503);
  assert.equal((raw.body as { error: { status: string } }).error.status, 'UNAVAILABLE');
});

test('HTTP 상태가 없는 에러(네트워크): status·body는 null, cause 사슬을 남긴다', async () => {
  const cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), { code: 'ECONNREFUSED' });
  const { files } = await record([{ reject: new TypeError('fetch failed', { cause }) }]);

  const raw = rawError(files);
  assert.equal(raw.name, 'TypeError');
  assert.equal(raw.message, 'fetch failed');
  assert.equal(raw.status, null);
  assert.equal(raw.body, null);
  assert.deepEqual(raw.cause, [{ name: 'Error', message: 'connect ECONNREFUSED 127.0.0.1:443', code: 'ECONNREFUSED' }]);
});

test('API 키가 섞이면 가린다: 주입한 redact(.env 값)와 Google 키 모양·key= 쿼리', async () => {
  const envKey = 'fake-env-key-0123456789';
  const googleKey = `AIza${'x'.repeat(35)}`;
  const err = new Error(`request to https://example.test/v1?key=${envKey}&alt=sse failed (${googleKey})`);
  const chunk: GeminiChunk = { candidates: [{ content: { parts: [{ text: `echo ${envKey}` }] } }] };
  const redact = (text: string) => text.split(envKey).join('***');

  const { files } = await record([{ chunks: [chunk], throwAfter: err }], redact);

  const all = files.map((f) => f.content).join('\n');
  assert.doesNotMatch(all, new RegExp(envKey));
  assert.doesNotMatch(all, /AIza/);
  assert.match(fileNamed(files, RAW_STREAM_FILE)!.content, /echo \*\*\*/);
});

test('호출이 없었으면 남길 파일도 없다', () => {
  assert.deepEqual(createGeminiRecorder(noRedact).files(), []);
});
