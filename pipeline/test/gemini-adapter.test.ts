import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FinishReason, ThinkingLevel, type Part } from '@google/genai';
import { GENERATOR_BY_PROVIDER, UsageSchema, type GenerationRequest } from '@opb/core';
import { GeminiAdapter, type GeminiChunk } from '../src/adapters/gemini/gemini.adapter.js';
import { readGeminiSdkVersion } from '../src/adapters/gemini/gemini.client.js';
import { fakeClient, loadChunks, type FakeClock } from './gemini-fakes.js';

const req: GenerationRequest = {
  modelId: 'gemini-3.8-flash',
  system: '사용자의 요청에 답하세요.\n',
  user: '사계절이 바뀌는 3D 나무를 단일 HTML로 만들어 주세요.\n',
  reasoningEffort: 'high',
  maxOutputTokens: 65_536,
};

async function generateFrom(chunks: GeminiChunk[], clock?: FakeClock) {
  const client = fakeClient([{ chunks }], clock);
  const adapter = new GeminiAdapter(client, { sdkVersion: '2.28.0', clock: clock && (() => clock.now) });
  return adapter.generate(req, new AbortController().signal);
}

/** candidates[0]에 parts와 finishReason만 둔 청크 */
const chunk = (parts: Part[], finishReason?: FinishReason): GeminiChunk => ({
  candidates: [{ content: { role: 'model', parts }, index: 0, ...(finishReason ? { finishReason } : {}) }],
});

/* ───────── 어댑터 정체 ───────── */

test('generator는 gemini-api + SDK 버전, provider google, 출력 상한 지정 가능', () => {
  const adapter = new GeminiAdapter(fakeClient([]), { sdkVersion: '2.28.0' });
  assert.equal(adapter.provider, 'google');
  assert.deepEqual(adapter.generator, { tool: 'gemini-api', version: '2.28.0' });
  assert.equal(GENERATOR_BY_PROVIDER[adapter.provider], adapter.generator.tool);
  assert.equal(adapter.supportsMaxOutputTokens, true);
});

test('readGeminiSdkVersion: 설치된 @google/genai의 package.json version', () => {
  assert.match(readGeminiSdkVersion(), /^\d+\.\d+\.\d+(?:-[\w.]+)?$/);
});

/* ───────── 요청 파라미터 ───────── */

test('요청: 모델·user 그대로·systemInstruction·thinking HIGH·상한·abortSignal을 SDK에 넘긴다', async () => {
  const client = fakeClient([{ chunks: await loadChunks('ok') }]);
  const adapter = new GeminiAdapter(client, { sdkVersion: '2.28.0' });
  const ac = new AbortController();
  await adapter.generate(req, ac.signal);

  assert.equal(client.params.length, 1, '어댑터는 호출을 1회만 한다 (재시도는 Runner)');
  const [p] = client.params;
  assert.equal(p?.model, 'gemini-3.8-flash');
  assert.equal(p?.contents, req.user);
  const { abortSignal, ...config } = p?.config ?? {};
  assert.equal(abortSignal, ac.signal);
  assert.deepEqual(config, {
    systemInstruction: req.system,
    thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
    maxOutputTokens: 65_536,
  });
});

test('요청: maxOutputTokens가 null이면 config에서 빠진다', async () => {
  const client = fakeClient([{ chunks: await loadChunks('ok') }]);
  await new GeminiAdapter(client, { sdkVersion: '2.28.0' }).generate(
    { ...req, maxOutputTokens: null },
    new AbortController().signal,
  );
  const config = client.params[0]?.config ?? {};
  assert.ok(!('maxOutputTokens' in config));
  assert.equal(config.systemInstruction, req.system);
});

/* ───────── describeInvocation ───────── */

test('describeInvocation: SDK 설정 JSON (모델·thinking·상한·스트리밍), system은 자리표시, user·키 없음', () => {
  const adapter = new GeminiAdapter(fakeClient([]), { sdkVersion: '2.28.0' });
  const s = adapter.describeInvocation(req);
  const inv = JSON.parse(s) as Record<string, unknown> & { config: Record<string, unknown> };

  assert.equal(inv.model, 'gemini-3.8-flash');
  assert.equal(inv.stream, true);
  assert.deepEqual(inv.config.thinkingConfig, { thinkingLevel: 'HIGH' });
  assert.equal(inv.config.maxOutputTokens, 65_536);
  assert.equal(inv.config.systemInstruction, '<system prompt>');

  assert.ok(!s.includes(req.user.trim()), 'user 프롬프트가 들어가면 안 된다');
  assert.ok(!s.includes(req.system.trim()), '시스템 프롬프트 내용은 자리표시로 둔다');
  assert.doesNotMatch(s, /api[_-]?key|AIza|abortSignal/i);

  const noLimit = JSON.parse(adapter.describeInvocation({ ...req, maxOutputTokens: null })) as typeof inv;
  assert.ok(!('maxOutputTokens' in noLimit.config), '상한을 보내지 않으면 기록에도 없다');
});

/* ───────── 본문과 thought 분리 ───────── */

test('본문: thought part를 빼고 텍스트 part를 받은 순서대로 이어 붙인다 (fixture ok)', async () => {
  const res = await generateFrom(await loadChunks('ok'));
  assert.equal(
    res.text,
    'Here is the complete page.\n\n```html\n<!DOCTYPE html>\n<html lang="en">\n' +
      '<head><meta charset="utf-8"><title>Four Seasons Tree</title></head>\n' +
      '<body>\n<script type="module">\n' +
      "import * as THREE from 'https://unpkg.com/three@0.170.0/build/three.module.js';\n" +
      '</script>\n</body>\n</html>\n```\n',
  );
  assert.ok(!res.text.includes('Planning the scene'));
});

test('본문: 한 청크 안에 thought와 텍스트가 섞여도 thought만 빠지고, 텍스트가 없는 part는 무시한다', async () => {
  const res = await generateFrom([
    chunk([{ text: 'think-1', thought: true }, { text: 'A' }, { thoughtSignature: 'c2ln' }, { text: 'think-2', thought: true }]),
    chunk([{ text: 'B', thought: false }, { inlineData: { mimeType: 'image/png', data: '' } }, { text: 'C' }], FinishReason.STOP),
  ]);
  assert.equal(res.text, 'ABC');
});

/* ───────── 사용량 ───────── */

test('사용량: 마지막 usageMetadata 기준, output = candidates + thoughts, 캐시분은 promptTokenCount에 이미 포함', async () => {
  const res = await generateFrom(await loadChunks('ok'));
  // promptTokenCount 412(캐시 128 포함) / candidates 5230 + thoughts 3150
  assert.deepEqual(res.usage, { inputTokens: 412, outputTokens: 8380, reasoningTokens: 3150 });
  UsageSchema.parse(res.usage);
});

test('사용량: MAX_TOKENS fixture는 출력+thought가 상한과 같다', async () => {
  const res = await generateFrom(await loadChunks('max-tokens'));
  assert.deepEqual(res.usage, { inputTokens: 412, outputTokens: 65_536, reasoningTokens: 4536 });
  UsageSchema.parse(res.usage);
});

test('사용량: usageMetadata가 없으면 0·null, thoughtsTokenCount만 없으면 reasoning null', async () => {
  const none = await generateFrom(await loadChunks('no-usage'));
  assert.deepEqual(none.usage, { inputTokens: 0, outputTokens: 0, reasoningTokens: null });
  UsageSchema.parse(none.usage);

  const blocked = await generateFrom(await loadChunks('prompt-blocked'));
  assert.deepEqual(blocked.usage, { inputTokens: 412, outputTokens: 0, reasoningTokens: null });
  UsageSchema.parse(blocked.usage);
});

test('사용량: 도구 실행 결과 입력(toolUsePromptTokenCount)은 더하고, usage 없는 뒤 청크는 앞의 값을 지우지 않는다', async () => {
  const res = await generateFrom([
    {
      ...chunk([{ text: 'x' }]),
      usageMetadata: { promptTokenCount: 100, toolUsePromptTokenCount: 30, candidatesTokenCount: 5, thoughtsTokenCount: 0 },
    },
    chunk([{ text: 'y' }], FinishReason.STOP),
  ]);
  assert.deepEqual(res.usage, { inputTokens: 130, outputTokens: 5, reasoningTokens: 0 });
  UsageSchema.parse(res.usage);
});

/* ───────── stopReason ───────── */

test('stopReason: fixture별 매핑과 원문', async () => {
  const cases: [string, string, string | null][] = [
    ['ok', 'end', 'STOP'],
    ['no-usage', 'end', 'STOP'],
    ['max-tokens', 'max_tokens', 'MAX_TOKENS'],
    ['safety', 'refusal', 'SAFETY'],
    ['prompt-blocked', 'refusal', 'PROHIBITED_CONTENT'], // candidates 없이 promptFeedback.blockReason
  ];
  for (const [name, stopReason, raw] of cases) {
    const res = await generateFrom(await loadChunks(name));
    assert.equal(res.stopReason, stopReason, name);
    assert.equal(res.rawStopReason, raw, name);
  }
});

test('stopReason: 안전·정책 계열은 refusal, 잘림 계열은 max_tokens, 그 밖·모르는 값은 other, 없으면 other/null', async () => {
  const cases: [FinishReason | undefined, string][] = [
    [FinishReason.PROHIBITED_CONTENT, 'refusal'],
    [FinishReason.BLOCKLIST, 'refusal'],
    [FinishReason.SPII, 'refusal'],
    [FinishReason.RECITATION, 'refusal'],
    [FinishReason.CONTINUATION, 'max_tokens'], // 요청당 토큰 한도에 걸려 미완성 (SDK 주석)
    [FinishReason.OTHER, 'other'],
    [FinishReason.LANGUAGE, 'other'],
    [FinishReason.MALFORMED_FUNCTION_CALL, 'other'],
    ['SOMETHING_NEW' as FinishReason, 'other'],
    [undefined, 'other'],
  ];
  for (const [finishReason, stopReason] of cases) {
    const res = await generateFrom([chunk([{ text: 'x' }], finishReason)]);
    assert.equal(res.stopReason, stopReason, String(finishReason));
    assert.equal(res.rawStopReason, finishReason ?? null);
  }
});

/* ───────── 응답 메타 ───────── */

test('resolvedModelId = modelVersion, requestId = responseId, 없으면 null', async () => {
  const ok = await generateFrom(await loadChunks('ok'));
  assert.equal(ok.resolvedModelId, 'gemini-3.8-flash');
  assert.equal(ok.requestId, 'syn-resp-0001');

  const none = await generateFrom(await loadChunks('no-usage'));
  assert.equal(none.resolvedModelId, null);
  assert.equal(none.requestId, null);
});

/* ───────── firstTokenMs ───────── */

test('firstTokenMs: 요청 시작부터 thought가 아닌 첫 텍스트까지 (주입한 시계)', async () => {
  // 청크마다 100ms: thought(1100) → thought(1200) → 본문(1300)
  const ok = await generateFrom(await loadChunks('ok'), { now: 1000, stepMs: 100 });
  assert.equal(ok.firstTokenMs, 300);

  const first = await generateFrom(await loadChunks('no-usage'), { now: 1000, stepMs: 100 });
  assert.equal(first.firstTokenMs, 100);

  const blocked = await generateFrom(await loadChunks('prompt-blocked'), { now: 1000, stepMs: 100 });
  assert.equal(blocked.firstTokenMs, null, '본문 텍스트가 없으면 null');

  // 빈 텍스트 part는 첫 토큰이 아니다, 소수 ms는 정수로
  const empty = await generateFrom([chunk([{ text: '' }]), chunk([{ text: 'a' }], FinishReason.STOP)], { now: 0, stepMs: 0.6 });
  assert.equal(empty.firstTokenMs, 1);
});
