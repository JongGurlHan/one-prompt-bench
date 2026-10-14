import { z } from 'zod';

/* ────────────────────────────────────────────────────────────
 * 저장되는 데이터의 모양(단일 출처). 런타임 타입도 여기서 infer.
 *  - models.json            : 사람이 관리하는 모델 레지스트리
 *  - results/<slug>/meta.json : 생성·검증 1회의 기록
 * ──────────────────────────────────────────────────────────── */

export const ProviderSchema = z.enum(['openai', 'anthropic', 'google']);
export type Provider = z.infer<typeof ProviderSchema>;

/** 결과물을 만든 생성 도구. 구독 CLI 2개와 무료 티어 API 1개 */
export const GeneratorToolSchema = z.enum(['claude-code', 'codex-cli', 'gemini-api']);
export type GeneratorTool = z.infer<typeof GeneratorToolSchema>;

/** provider가 생성 도구를 정한다. '생성 전' 모델의 도구도 표시해야 해서 레지스트리와 별도로 둔다 (표시 이름은 display.ts) */
export const GENERATOR_BY_PROVIDER: Readonly<Record<Provider, GeneratorTool>> = {
  anthropic: 'claude-code',
  openai: 'codex-cli',
  google: 'gemini-api',
};

const Slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'kebab-case slug');
const Sha256 = z.string().regex(/^[a-f0-9]{64}$/, 'sha256 hex');
const NonNegInt = z.number().int().nonnegative();
const Timestamp = z.iso.datetime({ offset: true });

/* ───────── 모델 레지스트리 (models.json) ───────── */

/** 횟수 상한 (ADR-032): 생성본은 첫 생성 포함 총 3회, 수정본은 2회 */
export const MAX_GENERATIONS = 3;
export const MAX_REPAIRS = 2;

/**
 * 버린 결과물 하나 (ADR-032). 화면에 나무가 그려지지 않는 등의 이유로 버리고 다음 단계로 넘어간 기록이다.
 * results/는 --force가 비우므로 사람이 관리하는 레지스트리에 남긴다. 순서·횟수 규칙은 check:results(results.ts)
 */
export const DiscardedSchema = z.object({
  made: z.enum(['generation', 'repair']), // 버린 결과물을 만든 방법: 생성본 · 수정본
  reason: z.enum(['blank_screen', 'continued_output']), // 나무가 그려지지 않음 · 도구가 이어 쓴 응답을 잘못 기록(ADR-029)
  next: z.enum(['regenerate', 'repair']), // 다음에 한 일: 다시 생성 · 수정 요청
  at: z.iso.date(),
  // 버린 결과물을 처음 커밋한 커밋의 전체 해시. 커밋하기 전에 버렸으면 null (ADR-029 Sonnet만)
  commit: z.string().regex(/^[a-f0-9]{40}$/, '40-char lowercase hex commit hash').nullable(),
});
export type Discarded = z.infer<typeof DiscardedSchema>;

export const ModelEntrySchema = z.object({
  slug: Slug, // 결과 폴더명이자 URL 경로: results/<slug>/
  provider: ProviderSchema,
  modelId: z.string().min(1), // 생성 도구에 보내는 모델 문자열
  displayName: z.string().min(1),
  releasedAt: z.iso.date(), // 목록 정렬 기준(최신순)
  pricing: z.object({
    inputPer1M: z.number().nonnegative(), // USD
    outputPer1M: z.number().nonnegative(), // USD, 추론 토큰도 이 단가로 계산
    asOf: z.iso.date(),
    sourceUrl: z.url(),
  }),
  // 버린 결과물, 오래된 것부터. 없으면 첫 생성 결과물을 그대로 공개한 모델 (빈 배열은 모호해서 받지 않는다)
  discarded: z.array(DiscardedSchema).min(1).optional(),
});
export type ModelEntry = z.infer<typeof ModelEntrySchema>;

export const ModelRegistrySchema = z.array(ModelEntrySchema).superRefine((models, ctx) => {
  const seen = new Set<string>();
  models.forEach((m, i) => {
    if (seen.has(m.slug)) {
      ctx.addIssue({ code: 'custom', message: `duplicate slug: ${m.slug}`, path: [i, 'slug'] });
    }
    seen.add(m.slug);
  });
});

/* ───────── 공통 조각 ───────── */

/**
 * 도구마다 추론 토큰을 출력 토큰에 포함해서 주기도, 별도 필드로 주기도 한다.
 * 어댑터가 아래 의미로 정규화한다.
 */
export const UsageSchema = z
  .object({
    inputTokens: NonNegInt,
    outputTokens: NonNegInt, // 출력 단가로 과금되는 전체(추론 포함)
    reasoningTokens: NonNegInt.nullable(), // outputTokens 중 추론분, 미제공이면 null
  })
  .refine((u) => u.reasoningTokens === null || u.reasoningTokens <= u.outputTokens, {
    message: 'reasoningTokens must be a subset of outputTokens',
  });
export type Usage = z.infer<typeof UsageSchema>;

export const StopReasonSchema = z.enum(['end', 'max_tokens', 'refusal', 'other']);
export type StopReason = z.infer<typeof StopReasonSchema>;

export const FailureKindSchema = z.enum([
  // 기술적 실패 → 재시도 대상 (정의는 adapter.ts의 RETRYABLE_FAILURES 한 곳)
  'timeout',
  'rate_limited',
  'server_error',
  'network',
  // 구독(Claude Pro, ChatGPT Plus)의 5시간·주간 한도 초과. 몇 시간 뒤에야 풀리므로 바로 재시도하지 않고
  // 기록만 남긴다. 한도가 풀린 뒤 다시 실행하면 '실패한 것만 다시' 규칙으로 이 모델만 돌아간다
  'usage_limit',
  // 재시도해도 결과가 같거나 비용만 드는 실패
  'auth',
  'bad_request',
  'blocked',
  'unknown',
]);
export type FailureKind = z.infer<typeof FailureKindSchema>;

/* ───────── 도구 호출 1회 (CLI 프로세스 또는 SDK 요청) ───────── */

export const AttemptSchema = z.object({
  n: z.number().int().positive(),
  startedAt: Timestamp,
  latencyMs: NonNegInt, // 요청 시작 ~ 마지막 청크
  firstTokenMs: NonNegInt.nullable(), // 첫 본문 텍스트 청크까지(스트리밍). 스트리밍이 아닌 CLI는 null
  result: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('response'),
      stopReason: StopReasonSchema,
      rawStopReason: z.string().nullable(), // 도구가 준 원문 값, 디버깅용
      resolvedModelId: z.string().nullable(), // 응답에 찍힌 실제 스냅샷 ID
      requestId: z.string().nullable(),
      usage: UsageSchema,
    }),
    z.object({
      type: z.literal('error'),
      kind: FailureKindSchema,
      httpStatus: z.number().int().nullable(),
      message: z.string(),
      usage: UsageSchema.nullable(), // 실패했어도 과금된 경우만
    }),
  ]),
});
export type Attempt = z.infer<typeof AttemptSchema>;

/* ───────── 결과물 ───────── */

export const OutcomeSchema = z.enum([
  'ok', // HTML 추출 성공
  'no_html', // 응답은 왔지만 HTML이 없음 → 품질 결과로 기록, 재시도 X
  'truncated', // max_tokens 도달 → 모델의 결과로 기록, 재시도 X (상한은 모든 모델 공통으로 넉넉히)
  'refused', // 모델이 거부
  'api_failed', // 기술적 실패 재시도 소진 또는 재시도 불가 오류
]);
export type Outcome = z.infer<typeof OutcomeSchema>;

export const OutputSchema = z.object({
  path: z.string().min(1), // 레포 기준: results/<slug>/index.html
  bytes: NonNegInt,
  sha256: Sha256,
  extraction: z.enum(['fenced_block', 'raw_document']), // ```html 블록에서 꺼냈는지, 응답 전체가 문서였는지
});

/* ───────── Playwright 검증 ───────── */

export const ValidationSchema = z.object({
  checkedAt: Timestamp,
  // MVP 범위: 열림, 에러, 외부 주소, 스크린샷만. 로딩 시간·빈 화면 판정·FPS는 다음 버전 후보
  environment: z.object({
    browser: z.string(),
    browserVersion: z.string(),
  }),
  loaded: z.boolean(),
  consoleErrors: z.array(z.string()),
  pageErrors: z.array(z.string()), // 실행 중 처리되지 않은 오류
  // 'three.js만 허용' 조건 확인용. 판정은 저장하지 않고 request-rules.ts가 이 목록에서 계산한다
  externalRequests: z.array(z.object({ url: z.url(), resourceType: z.string().min(1) })),
  // 정해진 시점에 찍은 스크린샷(Playwright JPEG). 사계절 나무는 계절 중간(5·15·25·35초)에 4장
  screenshots: z.array(
    z.object({ label: z.string().min(1), atMs: NonNegInt, path: z.string().regex(/\.jpg$/, 'screenshots are JPEG (.jpg)') }),
  ),
});
export type Validation = z.infer<typeof ValidationSchema>;

/* ───────── meta.json ───────── */

const RESPONSE_OUTCOMES: ReadonlySet<Outcome> = new Set(['ok', 'no_html', 'truncated', 'refused']);
const usd = z.number().nonnegative();

export const GenerationRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    // 표시명·출시일·가격은 레지스트리에서 slug로 조인 (중복 저장 안 함)
    modelSlug: Slug,
    // 실제로 보낸 값. 레지스트리가 나중에 바뀌어도 기록은 사실 그대로 남도록 스냅샷
    modelId: z.string().min(1),
    prompt: z.object({ id: Slug, version: z.string().min(1), sha256: Sha256 }),
    params: z.object({
      reasoningEffort: z.literal('high'),
      // null = 상한을 지정할 수 없는 도구(Codex CLI)라 도구 기본값으로 생성. 숫자를 지어내 기록하지 않는다
      maxOutputTokens: z.number().int().positive().nullable(),
    }),
    runtime: z.object({
      gitCommit: z.string().regex(/^[a-f0-9]{7,40}$/),
      nodeVersion: z.string().min(1),
      generator: z.object({
        tool: GeneratorToolSchema,
        version: z.string().min(1), // CLI 버전 또는 SDK 패키지 버전
        // 실제 호출 조건 공개용: CLI는 명령줄, SDK는 설정 JSON. user 프롬프트·비밀값은 넣지 않고 시스템 프롬프트는 자리표시
        invocation: z.string().min(1),
      }),
    }),
    startedAt: Timestamp,
    finishedAt: Timestamp,
    attempts: z.array(AttemptSchema).min(1),
    outcome: OutcomeSchema,
    // 모델 응답 원문. no_html·refused·truncated일 때 실제로 뭐라고 했는지 확인용
    responseTextPath: z.string().min(1).nullable(),
    output: OutputSchema.nullable(),
    usageTotal: UsageSchema, // 과금된 모든 시도의 합
    cost: z.object({
      inputUsd: usd,
      outputUsd: usd,
      totalUsd: usd,
      pricingAsOf: z.iso.date(), // 어느 시점 가격표로 계산했는지
    }),
    validation: ValidationSchema.nullable(), // 생성 직후엔 null, 검증 단계가 채움
  })
  .superRefine((r, ctx) => {
    const issue = (message: string, path: (string | number)[]) =>
      ctx.addIssue({ code: 'custom', message, path });

    // 시도 번호는 1..k 연속
    r.attempts.forEach((a, i) => {
      if (a.n !== i + 1) issue(`attempt n must be ${i + 1}`, ['attempts', i, 'n']);
    });

    if (Date.parse(r.finishedAt) < Date.parse(r.startedAt)) {
      issue('finishedAt is before startedAt', ['finishedAt']);
    }

    // outcome ↔ 마지막 시도 ↔ output 일관성
    const last = r.attempts[r.attempts.length - 1]!;
    if (r.outcome === 'api_failed') {
      if (last.result.type !== 'error') issue('api_failed requires last attempt to be an error', ['outcome']);
      if (r.output !== null) issue('api_failed must not have output', ['output']);
      if (r.responseTextPath !== null) issue('api_failed must not have responseTextPath', ['responseTextPath']);
    } else if (RESPONSE_OUTCOMES.has(r.outcome)) {
      if (last.result.type !== 'response') issue(`${r.outcome} requires last attempt to be a response`, ['outcome']);
      if (r.responseTextPath === null) issue(`${r.outcome} requires responseTextPath`, ['responseTextPath']);
    }
    if (r.outcome === 'ok' && r.output === null) issue('ok requires output', ['output']);
    if (r.validation !== null && r.output === null) issue('validation without output', ['validation']);

    // usageTotal = 시도별 usage 합 (집계 버그를 저장 시점에 잡기 위함)
    const sum = { inputTokens: 0, outputTokens: 0 };
    for (const a of r.attempts) {
      if (a.result.usage) {
        sum.inputTokens += a.result.usage.inputTokens;
        sum.outputTokens += a.result.usage.outputTokens;
      }
    }
    if (sum.inputTokens !== r.usageTotal.inputTokens || sum.outputTokens !== r.usageTotal.outputTokens) {
      issue(
        `usageTotal (${r.usageTotal.inputTokens}/${r.usageTotal.outputTokens}) != sum of attempts (${sum.inputTokens}/${sum.outputTokens})`,
        ['usageTotal'],
      );
    }

    if (Math.abs(r.cost.inputUsd + r.cost.outputUsd - r.cost.totalUsd) > 1e-6) {
      issue('cost.totalUsd != inputUsd + outputUsd', ['cost', 'totalUsd']);
    }
  });
export type GenerationRecord = z.infer<typeof GenerationRecordSchema>;

/* ───────── judgment.json (사람이 쓰는 판정) ─────────
 * 위치: results/<slug>/judgment.json  (자동 기록인 meta.json과 분리)
 * --force로 결과물을 새로 만들면 폴더가 비워지면서 예전 판정도 함께 지워진다.
 * 그래도 혹시 남아 있으면 outputSha256이 meta.json의 결과물과 달라서 check:results가 배포를 막는다.
 * 판정 기준표: prompts/season-tree-v1.judging.md
 */

export const MarkSchema = z.enum(['pass', 'partial', 'fail']); // ✓ 충족 · △ 부분 충족 · ✗ 미충족
export type Mark = z.infer<typeof MarkSchema>;

export const JudgmentSchema = z.object({
  schemaVersion: z.literal(1),
  modelSlug: Slug,
  prompt: z.object({ id: Slug, version: z.string().min(1) }),
  outputSha256: Sha256, // 어떤 결과물을 보고 판정했는지
  judgedAt: Timestamp,
  // season-tree-v1의 요구사항 4개
  requirements: z.object({
    scene: MarkSchema, // 장면: 3D 언덕 위 나무, 하늘·땅도 계절에 따라 변함
    seasonCycle: MarkSchema, // 계절 순환: 스크린샷 4장이 차례로 봄·여름·가을·겨울, 한 바퀴 뒤 반복
    seasonLook: MarkSchema, // 계절 모습: 네 계절 특징 + 부드러운 전환
    seasonLabel: MarkSchema, // 계절 이름 표시
  }),
  // 한 줄 메모. 사이트의 '모델별 관찰 코멘트'로 그대로 쓴다. 선택 — 없으면 null (키는 늘 있다, 2026-10-14 사용자 결정)
  note: z.string().trim().min(1).max(200).nullable(),
});
export type Judgment = z.infer<typeof JudgmentSchema>;
