import type { GeneratorTool, ProviderAdapter } from '@opb/core';
import { GEMINI_API_KEY, type AppConfig } from '../config/config.js';
import type { PreflightCheck } from '../generation/preflight.js';
import { GeminiAdapter, type GeminiClient } from './gemini/gemini.adapter.js';
import { createGeminiClient, readGeminiSdkVersion } from './gemini/gemini.client.js';
import { createGeminiRecorder } from './gemini/gemini.recorder.js';
import type { RawRecorder, Redact } from './raw-recorder.js';

/* ────────────────────────────────────────────────────────────
 * 생성 도구(GeneratorTool)별 어댑터 레지스트리 (ADAPTERS 토큰).
 * 레지스트리를 만들 때는 아무것도 만들지 않는다. 어댑터는 preflight를 통과한 뒤 실제로 필요할 때 create()로 만든다.
 * phase 1은 gemini-api만 등록. claude-code·codex-cli는 phase 3·4가 등록한다.
 * ──────────────────────────────────────────────────────────── */

export interface CreateAdapterOptions<Client> {
  /**
   * 어댑터에 주입하는 클라이언트(SDK 클라이언트·프로세스 실행 함수)를 감싼다. smoke가 원본 출력을 기록할 때 쓴다.
   * 메서드 표기: 도구별 AdapterEntry<Client>를 AdapterEntry<unknown>으로 한데 다룰 수 있게 한다(smoke는 같은 항목의 기록기로 감싼다)
   */
  wrapClient?(client: Client): Client;
}

export interface AdapterEntry<Client = unknown> {
  /** 도구별 점검 (예: phase 3의 claude auth status). 대상 모델에 이 도구가 있을 때만 부른다 */
  preflight?(): Promise<PreflightCheck[]>;
  /** 설정(.env)에서 필요한 값을 꺼내 어댑터를 만든다 */
  create(config: AppConfig, options?: CreateAdapterOptions<Client>): ProviderAdapter;
  /**
   * smoke용 원본 출력 기록기. smoke는 create(config, { wrapClient: (c) => recorder.wrap(c) })로 어댑터를 만들고,
   * Runner가 끝난 뒤 recorder.files()를 저장 폴더에 쓴다. CLI 도구(phase 3·4)는 프로세스 실행 함수를 감싸 stdout·stderr를 낸다
   */
  createRecorder?(redact: Redact): RawRecorder<Client>;
}

/** 도구마다 주입하는 클라이언트 모양이 다르다 */
export interface AdapterRegistry {
  readonly 'gemini-api'?: AdapterEntry<GeminiClient>;
  readonly 'claude-code'?: AdapterEntry; // phase 3
  readonly 'codex-cli'?: AdapterEntry; // phase 4
}

export function registeredTools(registry: AdapterRegistry): Set<GeneratorTool> {
  return new Set(
    (Object.keys(registry) as GeneratorTool[]).filter((tool) => registry[tool] !== undefined),
  );
}

const geminiEntry: AdapterEntry<GeminiClient> = {
  create(config, options) {
    const key = config.dotenv[GEMINI_API_KEY]?.trim();
    if (!key) throw new Error(`.env에 ${GEMINI_API_KEY}가 없습니다`);
    const client = createGeminiClient(key);
    return new GeminiAdapter(options?.wrapClient ? options.wrapClient(client) : client, {
      sdkVersion: readGeminiSdkVersion(),
    });
  },
  createRecorder: (redact) => createGeminiRecorder(redact),
};

export function createAdapterRegistry(): AdapterRegistry {
  return { 'gemini-api': geminiEntry };
}
