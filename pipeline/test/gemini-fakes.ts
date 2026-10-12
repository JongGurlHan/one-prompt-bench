import { readFile } from 'node:fs/promises';
import { ApiError } from '@google/genai';
import type { GeminiChunk, GeminiClient, GeminiStreamParams } from '../src/adapters/gemini/gemini.adapter.js';

/* ───────── Gemini 어댑터 테스트용 가짜 클라이언트·fixture 로더 (실제 SDK 요청 없음) ───────── */

const FIXTURES = new URL('./fixtures/gemini/', import.meta.url);

/** fixtures/gemini/stream-<name>.jsonl → 청크 배열 (한 줄 = SDK가 내주는 청크 하나) */
export async function loadChunks(name: string): Promise<GeminiChunk[]> {
  const text = await readFile(new URL(`stream-${name}.jsonl`, FIXTURES), 'utf8');
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as GeminiChunk);
}

interface ErrorFixture {
  status: number;
  body: { error: { status?: string } };
}

/**
 * fixtures/gemini/error-<name>.json → SDK가 던지는 것과 같은 ApiError.
 * 'response': 응답 상태가 실패일 때(throwErrorIfNotOK, message = 본문 JSON)
 * 'in_stream': 스트림 도중 에러 청크(message = `got status: <status>. <본문 JSON>`)
 */
export async function loadApiError(name: string, form: 'response' | 'in_stream' = 'response'): Promise<ApiError> {
  const { status, body } = JSON.parse(await readFile(new URL(`error-${name}.json`, FIXTURES), 'utf8')) as ErrorFixture;
  return apiError(status, body, form);
}

export function apiError(status: number, body: unknown, form: 'response' | 'in_stream' = 'response'): ApiError {
  const json = JSON.stringify(body);
  const rpcStatus = (body as ErrorFixture['body']).error?.status;
  return new ApiError({ status, message: form === 'response' ? json : `got status: ${rpcStatus}. ${json}` });
}

/** 호출 1회의 대본: 청크를 흘려보내거나, 요청 단계에서 실패하거나, 청크를 보낸 뒤 스트림 도중 실패 */
export interface FakeCall {
  chunks?: GeminiChunk[];
  reject?: unknown; // generateContentStream 자체가 실패 (응답 전)
  throwAfter?: unknown; // chunks를 다 보낸 뒤 스트림이 이 값으로 실패
}

/** 주입 시계. 가짜 스트림이 청크를 하나 내보내기 전에 stepMs만큼 진행한다 */
export interface FakeClock {
  now: number;
  stepMs: number;
}

export function fakeClient(
  calls: FakeCall[],
  clock?: FakeClock,
): GeminiClient & { params: GeminiStreamParams[] } {
  const params: GeminiStreamParams[] = [];
  return {
    params,
    async generateContentStream(p) {
      const call = calls[params.length];
      params.push(p);
      if (!call) throw new Error('fake client: script exhausted');
      if ('reject' in call) throw call.reject;
      return (async function* () {
        for (const chunk of call.chunks ?? []) {
          if (clock) clock.now += clock.stepMs;
          yield chunk;
        }
        if ('throwAfter' in call) throw call.throwAfter;
      })();
    },
  };
}
