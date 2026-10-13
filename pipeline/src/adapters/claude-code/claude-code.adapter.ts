import type {
  ClassifiedError,
  GenerationRequest,
  ProviderAdapter,
  ProviderResponse,
  StopReason,
  Usage,
} from '@opb/core';
import { cliEnv, withTempDir, type RunCli } from '../../system/cli.js';
import { ClaudeCodeCallError, classifyClaudeCodeError, type ClaudeOutput } from './claude-code.errors.js';

/* ────────────────────────────────────────────────────────────
 * Claude Code CLI 어댑터 (ARCHITECTURE "Claude Code CLI"). 프로세스 1회 + 정규화 + 에러 분류만.
 * 재시도·타임아웃은 Runner 책임이라 받은 signal을 실행 함수에 넘기기만 한다 (ADR-004).
 * - 구독 인증을 유지하는 격리 옵션(--safe-mode 등)으로, 매번 새 빈 임시 폴더에서 실행한다 (ADR-006). --bare는 쓰지 않는다.
 * - user 프롬프트는 stdin, 시스템 프롬프트는 --system-prompt로 내용 그대로 (ADR-005).
 * ⚠ 입력 토큰 규모·max_tokens·refusal 표시는 smoke 원본 출력으로 확인한다 — 모르는 값은 stopReason other.
 * ──────────────────────────────────────────────────────────── */

/** 출력 상한(thinking 포함)을 넘기는 환경변수 */
export const MAX_OUTPUT_TOKENS_ENV = 'CLAUDE_CODE_MAX_OUTPUT_TOKENS';

const TEMP_PREFIX = 'opb-claude-';
const SYSTEM_PLACEHOLDER = '<system prompt>';
const USER_PLACEHOLDER = '<user prompt>';

const EFFORT: Record<GenerationRequest['reasoningEffort'], string> = { high: 'high' };

const STOP_REASONS: Readonly<Record<string, StopReason>> = {
  end_turn: 'end',
  max_tokens: 'max_tokens',
  refusal: 'refusal',
};

export interface ClaudeCodeAdapterOptions {
  /** 실행 파일 경로 (resolveClaudeBin — Windows는 shim이 아니라 claude.exe) */
  bin: string;
  /** claude --version의 앞 숫자 (readClaudeVersion) */
  version: string;
  /** 자식 환경의 바탕. cliEnv가 API 키·Claude Code 세션 변수를 지운다 */
  env: Readonly<Record<string, string | undefined>>;
}

export class ClaudeCodeAdapter implements ProviderAdapter {
  readonly provider = 'anthropic' as const;
  readonly generator: ProviderAdapter['generator'];
  readonly supportsMaxOutputTokens = true;
  private readonly bin: string;
  private readonly env: Readonly<Record<string, string | undefined>>;

  constructor(
    private readonly run: RunCli,
    opts: ClaudeCodeAdapterOptions,
  ) {
    this.generator = { tool: 'claude-code', version: opts.version };
    this.bin = opts.bin;
    this.env = opts.env;
  }

  /** 예: `CLAUDE_CODE_MAX_OUTPUT_TOKENS=65536 claude -p --model … --output-format json (stdin: <user prompt>)` */
  describeInvocation(req: GenerationRequest): string {
    const assignments = Object.entries(envFor(req)).map(([name, value]) => `${name}=${quote(value)}`);
    const command = ['claude', ...claudeArgs(req, SYSTEM_PLACEHOLDER)].map(quote);
    return `${[...assignments, ...command].join(' ')} (stdin: ${USER_PLACEHOLDER})`;
  }

  async generate(req: GenerationRequest, signal: AbortSignal): Promise<ProviderResponse> {
    const result = await withTempDir(TEMP_PREFIX, (cwd) =>
      this.run({
        bin: this.bin,
        args: claudeArgs(req, req.system),
        stdin: req.user,
        cwd,
        env: cliEnv(this.env, envFor(req)),
        signal,
      }),
    );

    const output = parseOutput(result.stdout);
    const ok = result.exitCode === 0 && output?.is_error === false && typeof output.result === 'string';
    if (!ok || output === null) throw new ClaudeCodeCallError(result, output, chargedUsage(output));

    const usage = normalizeUsage(output.usage);
    const stop = mapStopReason(output.stop_reason);
    return {
      text: output.result as string,
      ...stop,
      ...(continuedPastLimit(usage, req) && { stopReason: 'max_tokens' as const }),
      usage,
      resolvedModelId: resolvedModelId(output.modelUsage, req.modelId),
      requestId: null,
      firstTokenMs: null, // 스트리밍이 아닌 CLI (DATA "정규화 규칙")
    };
  }

  classifyError(err: unknown): ClassifiedError {
    return classifyClaudeCodeError(err);
  }
}

/** 인자 배열. describeInvocation도 이 함수를 써서 기록이 실제 호출과 어긋나지 않게 한다 */
function claudeArgs(req: GenerationRequest, systemPrompt: string): string[] {
  return [
    '-p',
    '--model',
    req.modelId,
    '--effort',
    EFFORT[req.reasoningEffort],
    '--tools',
    '', // 도구 없음 (빈 문자열 인자 그대로)
    '--system-prompt',
    systemPrompt, // ADR-005: system.md 내용 그대로
    '--safe-mode', // CLAUDE.md·skills·hooks·MCP 등 사용자 설정 끔, 구독 인증은 유지
    '--strict-mcp-config',
    '--no-session-persistence',
    '--output-format',
    'json',
  ];
}

/** 어댑터가 넣는 환경변수. 상한이 없으면(null) 넣지 않는다 — 부모에게서 온 값은 cliEnv가 지운다 */
function envFor(req: GenerationRequest): Record<string, string> {
  return req.maxOutputTokens === null ? {} : { [MAX_OUTPUT_TOKENS_ENV]: String(req.maxOutputTokens) };
}

/** 기록용 명령줄 인용: 빈 문자열·공백·셸 특수문자가 든 인자만 큰따옴표로 */
function quote(arg: string): string {
  return arg === '' || /[\s"'<>|&;$`\\()]/.test(arg) ? JSON.stringify(arg) : arg;
}

/** stdout 전체가 JSON 객체 하나여야 한다 (앞뒤 공백만 허용). 아니면 null */
function parseOutput(stdout: string): ClaudeOutput | null {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    return null;
  }
  return isRecord(value) && !Array.isArray(value) ? value : null;
}

/**
 * Claude Code는 출력 상한(max_tokens)에 닿으면 "Output token limit hit. Resume directly…"를 넣고 스스로 이어 쓰기를 요청한다
 * (max_output_tokens_recovery, 2.1.296 실행 파일에서 확인 — 끄는 설정은 찾지 못했다). 그러면 stop_reason은 마지막 호출의 값(end_turn)이고
 * result는 마지막 조각뿐이다. 사용량은 호출들의 합이라 출력이 요청 상한을 넘었다면 첫 호출이 상한에 닿은 것이다 → 잘림으로 본다.
 * rawStopReason은 원문 그대로 둔다 (DATA "정규화 규칙")
 */
function continuedPastLimit(usage: Usage, req: GenerationRequest): boolean {
  return req.maxOutputTokens !== null && usage.outputTokens > req.maxOutputTokens;
}

function mapStopReason(raw: unknown): Pick<ProviderResponse, 'stopReason' | 'rawStopReason'> {
  if (typeof raw !== 'string') return { stopReason: 'other', rawStopReason: null };
  return { stopReason: STOP_REASONS[raw] ?? 'other', rawStopReason: raw };
}

/**
 * usage → core Usage. 필드가 없거나 토큰 수가 아닌 값이면 0(추론은 null).
 * 입력은 캐시 생성·읽기를 포함한 합(DATA "정규화 규칙"). output_tokens에 추론분이 들어 있다고 본다(확인한 출력 모두 thinking ≤ output)
 * — 그 전제가 깨지면(thinking > output) 추론은 null로 둔다.
 */
export function normalizeUsage(u: unknown): Usage {
  const usage = isRecord(u) ? u : {};
  const outputTokens = count(usage.output_tokens);
  const thinking = isRecord(usage.output_tokens_details) ? usage.output_tokens_details.thinking_tokens : undefined;
  return {
    inputTokens: count(usage.input_tokens) + count(usage.cache_creation_input_tokens) + count(usage.cache_read_input_tokens),
    outputTokens,
    reasoningTokens: isCount(thinking) && thinking <= outputTokens ? thinking : null,
  };
}

/** 실패한 출력의 사용량. 0보다 클 때만 (과금된 경우) */
function chargedUsage(output: ClaudeOutput | null): Usage | null {
  if (output === null) return null;
  const usage = normalizeUsage(output.usage);
  return usage.inputTokens + usage.outputTokens > 0 ? usage : null;
}

/** modelUsage의 키. 여럿이면 요청한 모델(키 또는 canonicalModel)의 키, 고를 수 없으면 null — ⚠ smoke로 모델 수 확인 */
function resolvedModelId(modelUsage: unknown, requested: string): string | null {
  if (!isRecord(modelUsage)) return null;
  const ids = Object.keys(modelUsage);
  if (ids.length === 1) return ids[0]!;
  const canonical = (id: string) => {
    const entry = modelUsage[id];
    return isRecord(entry) ? entry.canonicalModel : undefined;
  };
  return ids.find((id) => id === requested || canonical(id) === requested) ?? null;
}

const isCount = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
const count = (n: unknown) => (isCount(n) ? n : 0);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
