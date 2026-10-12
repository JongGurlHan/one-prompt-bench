import type { RawFile, RawRecorder, Redact } from '../raw-recorder.js';
import type { GeminiChunk, GeminiClient } from './gemini.adapter.js';
import { redactGeminiKeys } from './gemini.errors.js';

/* ────────────────────────────────────────────────────────────
 * smoke용 Gemini 기록 래퍼. GeminiClient.generateContentStream만 감싼다.
 *   raw-stream.jsonl : SDK가 내준 청크를 받은 순서대로 한 줄에 하나 — test/fixtures/gemini/stream-*.jsonl과 같은 형식
 *   raw-error.json   : 요청·스트림이 던진 에러의 이름·메시지·status·본문 — fixture error-*.json의 {status, body}를 포함
 * 청크·에러는 바꾸거나 삼키지 않고 그대로 넘긴다. 기록은 메모리에만 하고 파일은 files()로 내준다.
 * ──────────────────────────────────────────────────────────── */

export const RAW_STREAM_FILE = 'raw-stream.jsonl';
export const RAW_ERROR_FILE = 'raw-error.json';

interface RawError {
  status: number | null; // HTTP 상태 (SDK ApiError.status)
  body: unknown; // message 안의 응답 본문 JSON(google.rpc.Status). 없으면 null
  name: string | null;
  message: string;
  stage: 'request' | 'stream'; // 응답 전 실패 / 스트림 도중 실패
  chunksBeforeError: number;
  cause: { name: string; message: string; code?: string }[];
}

/**
 * redact: .env 값처럼 정확히 아는 비밀값을 가린다(두 파일 모두).
 * raw-error.json은 key=…·AIza… 모양도 가린다. 청크에는 적용하지 않는다 — 생성된 코드의 `key=` 같은 내용이 바뀌지 않게.
 */
export function createGeminiRecorder(redact: Redact): RawRecorder<GeminiClient> {
  let lines: string[] | null = null; // null = 스트림이 열린 적 없음
  let error: RawError | null = null;

  return {
    wrap(client) {
      return {
        async generateContentStream(params) {
          let stream: AsyncIterable<GeminiChunk>;
          try {
            stream = await client.generateContentStream(params);
          } catch (err) {
            error = describeError(err, 'request', 0);
            throw err;
          }
          const received = (lines ??= []);
          return (async function* () {
            let count = 0;
            try {
              for await (const chunk of stream) {
                received.push(serialize(chunk));
                count++;
                yield chunk;
              }
            } catch (err) {
              error = describeError(err, 'stream', count);
              throw err;
            }
          })();
        },
      };
    },

    files() {
      const files: RawFile[] = [];
      if (lines !== null) {
        files.push({ name: RAW_STREAM_FILE, content: lines.map((line) => `${redact(line)}\n`).join('') });
      }
      if (error !== null) {
        files.push({ name: RAW_ERROR_FILE, content: `${redact(redactGeminiKeys(JSON.stringify(error, null, 2)))}\n` });
      }
      return files;
    },
  };
}

/** 기록이 실패해도 호출 결과는 바뀌지 않게 던지지 않는다 */
function serialize(chunk: GeminiChunk): string {
  try {
    return JSON.stringify(chunk);
  } catch (err) {
    return JSON.stringify({ unserializableChunk: String(err) });
  }
}

function describeError(err: unknown, stage: RawError['stage'], chunksBeforeError: number): RawError {
  const message = err instanceof Error ? err.message : String(err);
  const status = isRecord(err) && Number.isInteger(err.status) ? (err.status as number) : null;
  return {
    status,
    body: bodyOf(message),
    name: err instanceof Error ? err.name : null,
    message,
    stage,
    chunksBeforeError,
    cause: causeChain(err),
  };
}

/** SDK ApiError의 message는 본문 JSON 그대로이거나 `got status: … <본문 JSON>`이다. 줄이지 않고 전부 남긴다 */
function bodyOf(message: string): unknown {
  const start = message.indexOf('{');
  if (start < 0) return null;
  try {
    return JSON.parse(message.slice(start)) as unknown;
  } catch {
    return null;
  }
}

/** fetch 실패는 TypeError('fetch failed') 안에 실제 소켓 오류가 있다 */
function causeChain(err: unknown): RawError['cause'] {
  const chain: RawError['cause'] = [];
  const seen = new Set<unknown>([err]);
  for (let c = isRecord(err) ? err.cause : undefined; c !== undefined && chain.length < 5 && !seen.has(c); ) {
    seen.add(c);
    const code = isRecord(c) && typeof c.code === 'string' ? c.code : undefined;
    chain.push({
      name: c instanceof Error ? c.name : typeof c,
      message: c instanceof Error ? c.message : String(c),
      ...(code === undefined ? {} : { code }),
    });
    c = isRecord(c) ? c.cause : undefined;
  }
  return chain;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
