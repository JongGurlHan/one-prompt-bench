import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';
import type { GeminiClient } from './gemini.adapter.js';

const SDK_PACKAGE = '@google/genai';

/**
 * 실제 SDK 클라이언트. 키는 인자로만 받는다(.env 읽기는 설정 층). 테스트에서 호출하지 않는다 — 실제 요청이 나간다.
 */
export function createGeminiClient(apiKey: string): GeminiClient {
  // 빈 키면 SDK가 환경변수(GEMINI_API_KEY·GOOGLE_API_KEY)를 대신 쓰지 않게 여기서 멈춘다
  if (apiKey.trim() === '') throw new Error('Gemini API key is empty');
  const ai = new GoogleGenAI({
    apiKey,
    vertexai: false, // GOOGLE_GENAI_USE_VERTEXAI 같은 환경변수로 백엔드가 바뀌지 않게
    // attempts 1 = SDK 자체 재시도 없음. 재시도·백오프는 Runner 책임 (ADR-004)
    httpOptions: { retryOptions: { attempts: 1 } },
  });
  return { generateContentStream: (params) => ai.models.generateContentStream(params) };
}

/** 설치된 @google/genai의 package.json version (exports에 package.json이 없어 진입점에서 거슬러 올라가 찾는다) */
export function readGeminiSdkVersion(): string {
  let dir = path.dirname(createRequire(import.meta.url).resolve(SDK_PACKAGE));
  for (;;) {
    const file = path.join(dir, 'package.json');
    if (existsSync(file)) {
      const pkg = JSON.parse(readFileSync(file, 'utf8')) as { name?: unknown; version?: unknown };
      if (pkg.name === SDK_PACKAGE && typeof pkg.version === 'string') return pkg.version;
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`cannot find package.json of ${SDK_PACKAGE}`);
    dir = parent;
  }
}
