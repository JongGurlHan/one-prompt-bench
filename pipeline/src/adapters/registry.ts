import type { GeneratorTool, ProviderAdapter } from '@opb/core';
import { GEMINI_API_KEY, type AppConfig } from '../config/config.js';
import type { PreflightCheck } from '../generation/preflight.js';
import { runCli, type RunCli } from '../system/cli.js';
import { ClaudeCodeAdapter } from './claude-code/claude-code.adapter.js';
import { readClaudeVersion, resolveClaudeBin } from './claude-code/claude-code.bin.js';
import { claudeAuthPreflight } from './claude-code/claude-code.preflight.js';
import { createCliRecorder } from './cli-recorder.js';
import { CodexAdapter } from './codex/codex.adapter.js';
import { readCodexVersion, resolveCodexCommand, type CodexCommand } from './codex/codex.bin.js';
import { codexLoginPreflight } from './codex/codex.preflight.js';
import { GeminiAdapter, type GeminiClient } from './gemini/gemini.adapter.js';
import { createGeminiClient, readGeminiSdkVersion } from './gemini/gemini.client.js';
import { createGeminiRecorder } from './gemini/gemini.recorder.js';
import type { RawRecorder, Redact } from './raw-recorder.js';

/* ────────────────────────────────────────────────────────────
 * 생성 도구(GeneratorTool)별 어댑터 레지스트리 (ADAPTERS 토큰).
 * 레지스트리를 만들 때는 아무것도 만들거나 실행하지 않는다. 어댑터는 preflight를 통과한 뒤 실제로 필요할 때 create()로 만든다.
 * gemini-api(phase 1)·claude-code(phase 3)·codex-cli(phase 4) 등록.
 * ──────────────────────────────────────────────────────────── */

export interface CreateAdapterOptions<Client> {
  /**
   * 어댑터에 주입하는 클라이언트(SDK 클라이언트·프로세스 실행 함수)를 감싼다. smoke가 원본 출력을 기록할 때 쓴다.
   * 메서드 표기: 도구별 AdapterEntry<Client>를 AdapterEntry<unknown>으로 한데 다룰 수 있게 한다(smoke는 같은 항목의 기록기로 감싼다)
   */
  wrapClient?(client: Client): Client;
}

export interface AdapterEntry<Client = unknown> {
  /** 도구별 점검 (claude auth status·codex login status). 대상 모델에 이 도구가 있을 때만 부른다 */
  preflight?(): Promise<PreflightCheck[]>;
  /** 설정(.env)에서 필요한 값을 꺼내 어댑터를 만든다 */
  create(config: AppConfig, options?: CreateAdapterOptions<Client>): ProviderAdapter;
  /**
   * smoke용 원본 출력 기록기. smoke는 create(config, { wrapClient: (c) => recorder.wrap(c) })로 어댑터를 만들고,
   * Runner가 끝난 뒤 recorder.files()를 저장 폴더에 쓴다. CLI 도구는 공용 기록기(createCliRecorder)로 프로세스 실행 함수를 감싸 stdout·stderr를 낸다
   */
  createRecorder?(redact: Redact): RawRecorder<Client>;
}

/** 도구마다 주입하는 클라이언트 모양이 다르다 */
export interface AdapterRegistry {
  readonly 'gemini-api'?: AdapterEntry<GeminiClient>;
  readonly 'claude-code'?: AdapterEntry<RunCli>;
  readonly 'codex-cli'?: AdapterEntry<RunCli>;
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

/** claude-code 항목의 주입점. 테스트는 가짜로 바꾼다 (기본값은 실제 구현 — 실제 claude를 띄운다) */
export interface ClaudeCodeEntryDeps {
  /** 생성·로그인 점검 실행 함수 */
  runCli: RunCli;
  /** claude 실행 파일 경로 (PATH 탐색, Windows는 shim 옆 claude.exe). 못 찾으면 throw */
  resolveBin(): string;
  /** 동기. `<bin> --version`의 앞 숫자. 못 읽으면 throw */
  readVersion(bin: string): string;
  /** 자식 환경의 바탕 (cliEnv가 API 키·Claude Code 세션 변수를 지운다) */
  env(): Readonly<Record<string, string | undefined>>;
}

/** 만들 때는 아무것도 실행하지 않는다. PATH 탐색·버전 읽기는 create(), 로그인 점검은 preflight()에서 */
export function createClaudeCodeEntry(overrides: Partial<ClaudeCodeEntryDeps> = {}): AdapterEntry<RunCli> {
  const env = overrides.env ?? (() => process.env);
  const deps: ClaudeCodeEntryDeps = {
    runCli,
    resolveBin: () => resolveClaudeBin({ env: env() }),
    readVersion: (bin) => readClaudeVersion(bin, env()),
    ...overrides,
    env,
  };
  return {
    preflight: () => claudeAuthPreflight({ runCli: deps.runCli, resolveBin: () => deps.resolveBin(), env: deps.env() }),
    // .env(config)는 쓰지 않는다 — 구독 로그인으로 실행하고, 자식 환경에 .env 값을 넣지 않는다
    create(_config, options) {
      const bin = deps.resolveBin();
      const version = deps.readVersion(bin); // 여기서 실패하면 모델을 부르지 않는다
      const run = options?.wrapClient ? options.wrapClient(deps.runCli) : deps.runCli;
      return new ClaudeCodeAdapter(run, { bin, version, env: deps.env() });
    },
    createRecorder: (redact) => createCliRecorder(redact),
  };
}

/** codex-cli 항목의 주입점. 테스트는 가짜로 바꾼다 (기본값은 실제 구현 — 실제 codex를 띄운다) */
export interface CodexEntryDeps {
  /** 생성·로그인 점검 실행 함수 */
  runCli: RunCli;
  /** 실행 명령 (PATH 탐색, Windows npm 설치는 node + shim 옆 codex.js). 못 찾으면 throw */
  resolveCommand(): CodexCommand;
  /** 동기. `codex --version`의 숫자. 못 읽으면 throw */
  readVersion(command: CodexCommand): string;
  /** 자식 환경의 바탕 (cliEnv가 API 키·Claude Code 세션 변수를 지운다. CODEX_HOME은 인증이라 그대로) */
  env(): Readonly<Record<string, string | undefined>>;
}

/** 만들 때는 아무것도 실행하지 않는다. 실행 명령 찾기·버전 읽기는 create(), 로그인 점검은 preflight()에서 */
export function createCodexEntry(overrides: Partial<CodexEntryDeps> = {}): AdapterEntry<RunCli> {
  const env = overrides.env ?? (() => process.env);
  const deps: CodexEntryDeps = {
    runCli,
    resolveCommand: () => resolveCodexCommand({ env: env() }),
    readVersion: (command) => readCodexVersion(command, env()),
    ...overrides,
    env,
  };
  return {
    preflight: () =>
      codexLoginPreflight({ runCli: deps.runCli, resolveCommand: () => deps.resolveCommand(), env: deps.env() }),
    // .env(config)는 쓰지 않는다 — ChatGPT 로그인으로 실행하고, 자식 환경에 .env 값을 넣지 않는다
    create(_config, options) {
      const command = deps.resolveCommand();
      const version = deps.readVersion(command); // 여기서 실패하면 모델을 부르지 않는다
      const run = options?.wrapClient ? options.wrapClient(deps.runCli) : deps.runCli;
      return new CodexAdapter(run, { command, version, env: deps.env() });
    },
    createRecorder: (redact) => createCliRecorder(redact),
  };
}

export function createAdapterRegistry(): AdapterRegistry {
  return { 'gemini-api': geminiEntry, 'claude-code': createClaudeCodeEntry(), 'codex-cli': createCodexEntry() };
}
