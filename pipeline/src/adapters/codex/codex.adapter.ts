import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ClassifiedError, GenerationRequest, ProviderAdapter, ProviderResponse, Usage } from '@opb/core';
import { cliEnv, withTempDir, type RunCli } from '../../system/cli.js';
import type { CodexCommand } from './codex.bin.js';
import { CodexCallError, classifyCodexError, type CodexEvent, type CodexOutput } from './codex.errors.js';

/* ────────────────────────────────────────────────────────────
 * Codex CLI 어댑터 (ARCHITECTURE "Codex CLI"). 프로세스 1회 + 정규화 + 에러 분류만.
 * 재시도·타임아웃은 Runner 책임이라 받은 signal을 실행 함수에 넘기기만 한다 (ADR-004).
 * - Codex는 에이전트라 읽기 전용 샌드박스·빈 작업 폴더(work/)에서 실행해 답을 텍스트로 받는다 (ADR-006).
 *   매 시도 임시 폴더 하나에 work/·instructions.md·last-message.txt를 따로 두고, work/에는 아무것도 두지 않는다.
 * - user 프롬프트는 stdin(마지막 인자 `-`), 시스템 프롬프트는 instructions.md → model_instructions_file (ADR-005).
 * - 덧붙는 환경·모드 안내는 -c include_*=false로 끈다 (ADR-027). 웹 검색 도구도 끈다 (ADR-028). 출력 상한은 지정할 수 없다 (ADR-007).
 * ⚠ 입력 토큰 규모·추론 강도 적용·모델의 도구 시도·실제 에러 문구는 Codex smoke 원본 출력으로 확인한다.
 * ──────────────────────────────────────────────────────────── */

const TEMP_PREFIX = 'opb-codex-';
const WORK_DIR = 'work';
const INSTRUCTIONS_FILE = 'instructions.md';
const LAST_MESSAGE_FILE = 'last-message.txt';
const USER_PLACEHOLDER = '<user prompt>';

/** 기록(invocation)에 쓰는 자리표시. 실제 임시 폴더 경로에는 사용자 폴더가 들어 있다 */
const PLACEHOLDER_PATHS: CodexPaths = {
  work: `<tmp>/${WORK_DIR}`,
  instructions: `<tmp>/${INSTRUCTIONS_FILE}`,
  lastMessage: `<tmp>/${LAST_MESSAGE_FILE}`,
};

const EFFORT: Record<GenerationRequest['reasoningEffort'], string> = { high: 'high' };

/** 어댑터가 성공으로 본 응답의 rawStopReason. 이벤트에 모델이 멈춘 이유가 없다 */
const COMPLETED = 'turn.completed';

interface CodexPaths {
  /** 빈 작업 폴더 (-C, 프로세스 cwd) */
  work: string;
  /** req.system (model_instructions_file) */
  instructions: string;
  /** 마지막 메시지 (-o) */
  lastMessage: string;
}

export interface CodexAdapterOptions {
  /** 실행 명령 (resolveCodexCommand — Windows npm 설치는 node + codex.js) */
  command: CodexCommand;
  /** codex --version의 숫자 (readCodexVersion) */
  version: string;
  /** 자식 환경의 바탕. cliEnv가 API 키·Claude Code 세션 변수를 지운다 (CODEX_HOME은 인증이라 남는다) */
  env: Readonly<Record<string, string | undefined>>;
}

export class CodexAdapter implements ProviderAdapter {
  readonly provider = 'openai' as const;
  readonly generator: ProviderAdapter['generator'];
  readonly supportsMaxOutputTokens = false;
  private readonly command: CodexCommand;
  private readonly env: Readonly<Record<string, string | undefined>>;

  constructor(
    private readonly run: RunCli,
    opts: CodexAdapterOptions,
  ) {
    this.generator = { tool: 'codex-cli', version: opts.version };
    this.command = opts.command;
    this.env = opts.env;
  }

  /** 예: `codex exec --model … -o <tmp>/last-message.txt -C <tmp>/work -c … - (stdin: <user prompt>)` */
  describeInvocation(req: GenerationRequest): string {
    const command = ['codex', ...codexArgs(req, PLACEHOLDER_PATHS)].map(display);
    return `${command.join(' ')} (stdin: ${USER_PLACEHOLDER})`;
  }

  async generate(req: GenerationRequest, signal: AbortSignal): Promise<ProviderResponse> {
    assertNoOutputLimit(req); // 임시 폴더를 만들기 전에
    const { result, lastMessage } = await withTempDir(TEMP_PREFIX, async (tmp) => {
      const paths: CodexPaths = {
        work: path.join(tmp, WORK_DIR),
        instructions: path.join(tmp, INSTRUCTIONS_FILE),
        lastMessage: path.join(tmp, LAST_MESSAGE_FILE),
      };
      const args = codexArgs(req, paths);
      await mkdir(paths.work);
      await writeFile(paths.instructions, req.system, 'utf8'); // ADR-005: 내용 그대로
      const result = await this.run({
        bin: this.command.bin,
        args: [...this.command.prefixArgs, ...args],
        stdin: req.user,
        cwd: paths.work,
        env: cliEnv(this.env),
        signal,
      });
      // 임시 폴더가 지워지기 전에 읽는다. Codex는 턴이 완료됐을 때만 쓴다
      return { result, lastMessage: await readIfExists(paths.lastMessage) };
    });

    const output = parseOutput(result.stdout);
    const completed = output.events.findLast((e) => e.type === COMPLETED);
    const ok = result.exitCode === 0 && output.invalidLines.length === 0 && completed !== undefined && lastMessage !== null;
    if (!ok) throw new CodexCallError(result, output, lastMessage !== null);

    return {
      text: lastMessage,
      stopReason: 'other',
      rawStopReason: COMPLETED,
      usage: normalizeUsage(completed.usage),
      resolvedModelId: null, // 이벤트에 없다
      requestId: null,
      firstTokenMs: null, // 스트리밍이 아닌 CLI (DATA "정규화 규칙")
    };
  }

  classifyError(err: unknown): ClassifiedError {
    return classifyCodexError(err);
  }
}

/** 인자 배열 (prefixArgs 뒤). describeInvocation도 이 함수를 써서 기록이 실제 호출과 어긋나지 않게 한다 */
function codexArgs(req: GenerationRequest, paths: CodexPaths): string[] {
  assertNoOutputLimit(req);
  return [
    'exec',
    '--model',
    req.modelId,
    '--sandbox',
    'read-only', // 응답 대신 파일을 쓰지 못하게
    '--skip-git-repo-check',
    '--ephemeral',
    '--ignore-user-config', // $CODEX_HOME/config.toml만 무시한다. 인증은 CODEX_HOME 그대로
    '--ignore-rules',
    '--json',
    '-o',
    paths.lastMessage,
    '-C',
    paths.work,
    ...config('model_reasoning_effort', EFFORT[req.reasoningEffort]),
    ...config('model_instructions_file', toSlash(paths.instructions)),
    // ADR-027: 실행 환경 정보·앱·작업 방식 안내·사용자 스킬 목록을 끈다. 샌드박스 안내와 도구 정의는 남는다
    ...config('include_environment_context', false),
    ...config('include_apps_instructions', false),
    ...config('include_collaboration_mode_instructions', false),
    ...config('skills.include_instructions', false),
    // ADR-028: 웹 검색 도구를 끈다 (기본 cached는 서버 쪽 도구라 read-only 샌드박스로 막히지 않는다)
    ...config('web_search', 'disabled'),
    '-', // 프롬프트는 stdin에서
  ];
}

/** Codex는 출력 상한을 지정할 수 없다. 상한을 기록하고 상한 없이 부르면 기록이 거짓이 된다 (정상 경로는 maxOutputTokensFor가 null을 준다) */
function assertNoOutputLimit(req: GenerationRequest): void {
  if (req.maxOutputTokens !== null) {
    throw new Error(`Codex CLI는 출력 상한을 지정할 수 없습니다: maxOutputTokens는 null이어야 합니다 (받은 값 ${req.maxOutputTokens})`);
  }
}

/**
 * `-c key=value`. 값은 TOML로 읽힌다: 문자열은 큰따옴표(JSON 문자열 이스케이프는 TOML 기본 문자열에서도 같은 뜻), 불리언은 따옴표 없이.
 * 경로는 toSlash로 먼저 바꿔 Windows 역슬래시가 이스케이프로 읽히지 않게 한다.
 */
function config(key: string, value: string | boolean): [string, string] {
  return ['-c', `${key}=${typeof value === 'string' ? JSON.stringify(value) : String(value)}`];
}

/** 업스트림 테스트와 같은 방식: 경로 구분자를 슬래시로 (Windows도 슬래시 경로를 읽는다) */
function toSlash(p: string): string {
  return p.replaceAll('\\', '/');
}

/** 기록용 명령줄 표기: ARCHITECTURE의 명령 모양 그대로, 빈 문자열·공백이 든 인자만 큰따옴표로 */
function display(arg: string): string {
  return arg === '' || /\s/.test(arg) ? JSON.stringify(arg) : arg;
}

async function readIfExists(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8');
  } catch (err) {
    if (isRecord(err) && err.code === 'ENOENT') return null;
    throw err;
  }
}

/** stdout: 줄마다 이벤트 JSON 객체 하나. 빈 줄은 건너뛰고, 객체가 아닌 줄은 따로 모은다 */
function parseOutput(stdout: string): CodexOutput {
  const events: CodexEvent[] = [];
  const invalidLines: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      value = undefined;
    }
    if (isRecord(value) && !Array.isArray(value)) events.push(value);
    else invalidLines.push(line.trim());
  }
  return { events, invalidLines };
}

/**
 * 마지막 turn.completed의 usage → core Usage. 스레드 누적 합계라 더하지 않는다.
 * input_tokens에는 캐시 읽기·쓰기분이 이미 들어 있고(더하지 않는다), output_tokens에는 추론분이 들어 있다.
 * 필드가 없거나 토큰 수가 아닌 값이면 0(추론은 null). 추론 > 출력이면(포함 전제가 깨짐) 추론은 null.
 */
export function normalizeUsage(u: unknown): Usage {
  const usage = isRecord(u) ? u : {};
  const outputTokens = count(usage.output_tokens);
  const reasoning = usage.reasoning_output_tokens;
  return {
    inputTokens: count(usage.input_tokens),
    outputTokens,
    reasoningTokens: isCount(reasoning) && reasoning <= outputTokens ? reasoning : null,
  };
}

const isCount = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
const count = (n: unknown) => (isCount(n) ? n : 0);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
