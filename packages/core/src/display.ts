import { judgeRequests, pinnedThreeVersion, type ExternalRequest, type Verdict } from './request-rules.js';
import { REPAIR_NOT_IMPLEMENTED, type ResultEntry } from './results.js';
import {
  GENERATOR_BY_PROVIDER,
  type Discarded,
  type FailureKind,
  type GenerationRecord,
  type GeneratorTool,
  type Judgment,
  type Mark,
  type ModelEntry,
  type Provider,
} from './schema.js';

/* ────────────────────────────────────────────────────────────
 * 사이트 표시 규칙 (단일 출처, docs/DATA.md "표시 규칙")
 * 문구는 docs/COPY.md 그대로다. pipeline·site에서 라벨·포맷을 다시 만들지 않는다.
 * ──────────────────────────────────────────────────────────── */

export type StatusLabel =
  | '정상'
  | '지시 미준수'
  | '위반'
  | '잘림'
  | 'HTML 없음'
  | '거부'
  | '한도 초과'
  | '생성 실패'
  | '생성 전'
  | '검증 전';

/** 배지 색 계열 (값은 docs/UI_GUIDE.md "상태 배지") */
export type BadgeTone = 'green' | 'yellow' | 'red' | 'purple' | 'blue' | 'gray';

export interface StatusBadge {
  label: StatusLabel;
  tone: BadgeTone;
}

/** 범례용: COPY "공통" 상태 라벨 순서 */
export const STATUS_LEGEND: readonly StatusLabel[] = [
  '정상',
  '지시 미준수',
  '위반',
  '잘림',
  'HTML 없음',
  '거부',
  '한도 초과',
  '생성 실패',
  '생성 전',
  '검증 전',
];

export const STATUS_TONE: Readonly<Record<StatusLabel, BadgeTone>> = {
  정상: 'green',
  '지시 미준수': 'yellow',
  위반: 'red',
  잘림: 'purple',
  'HTML 없음': 'purple',
  거부: 'purple',
  '한도 초과': 'blue',
  '생성 실패': 'blue',
  '생성 전': 'gray',
  '검증 전': 'gray',
};

export const PROVIDER_LABEL: Readonly<Record<Provider, string>> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
};

export const GENERATOR_LABEL: Readonly<Record<GeneratorTool, string>> = {
  'claude-code': 'Claude Code',
  'codex-cli': 'Codex CLI',
  'gemini-api': 'Gemini API',
};

/** 조건 검사 판정 라벨 */
export const VERDICT_LABEL: Readonly<Record<Verdict, StatusLabel>> = {
  ok: '정상',
  instruction_miss: '지시 미준수',
  violation: '위반',
};

/** "생성 실패" 이유에 덧붙이는 에러 종류 표시 (usage_limit은 "한도 초과" 라벨이라 없음) */
export const FAILURE_KIND_LABEL: Readonly<Record<Exclude<FailureKind, 'usage_limit'>, string>> = {
  timeout: '시간 초과',
  rate_limited: '요청 한도',
  server_error: '서버 오류',
  network: '네트워크 오류',
  auth: '인증 오류',
  bad_request: '잘못된 요청',
  blocked: '차단됨',
  unknown: '알 수 없는 오류',
};

export type RequirementKey = keyof Judgment['requirements'];

/** 요구사항 4개의 표시 순서와 이름 */
export const REQUIREMENT_LABEL: Readonly<Record<RequirementKey, string>> = {
  scene: '장면',
  seasonCycle: '계절 순환',
  seasonLook: '계절 모습',
  seasonLabel: '계절 이름',
};

export const MARK_LABEL: Readonly<Record<Mark, string>> = {
  pass: '✓ 충족',
  partial: '△ 부분 충족',
  fail: '✗ 미충족',
};
export const NOT_JUDGED = '판정 전';
/** 값이 없을 때 */
export const NO_VALUE = '—';
const THREE_UNPINNED_LABEL = '미고정';

/* ───────── 상태 라벨 ───────── */

/** DATA "상태 라벨" 표를 위에서부터 처음 맞는 것 */
export function statusOf(record: GenerationRecord | null): StatusBadge {
  return badge(statusLabelOf(record));
}

function statusLabelOf(record: GenerationRecord | null): StatusLabel {
  if (record === null) return '생성 전';
  switch (record.outcome) {
    case 'api_failed':
      return lastFailureKind(record) === 'usage_limit' ? '한도 초과' : '생성 실패';
    case 'refused':
      return '거부';
    case 'truncated':
      return '잘림';
    case 'no_html':
      return 'HTML 없음';
    case 'ok':
      return record.validation === null ? '검증 전' : VERDICT_LABEL[judgeRequests(record.validation.externalRequests).verdict];
  }
}

const badge = (label: StatusLabel): StatusBadge => ({ label, tone: STATUS_TONE[label] });

/* ───────── 결과물이 없을 때의 이유 (COPY "결과 탭" → "결과물이 없을 때") ───────── */

export interface MissingOutputReason {
  text: string;
  /** 실행 카드 아래에 응답 원문(response.txt) 카드를 둘지 */
  showResponseText: boolean;
}

const MISSING_OUTPUT_REASON: Readonly<Partial<Record<StatusLabel, MissingOutputReason>>> = {
  '생성 전': { text: '아직 생성하지 않았어요.', showResponseText: false },
  '한도 초과': { text: '구독 사용 한도에 걸려 생성하지 못했어요. 한도가 풀리면 다시 생성해요.', showResponseText: false },
  '생성 실패': { text: '기술적인 문제로 생성하지 못했어요.', showResponseText: false },
  거부: { text: '모델이 요청을 거부했어요.', showResponseText: true },
  잘림: { text: '출력 상한에 닿아 응답이 중간에 끊겼어요.', showResponseText: true },
  'HTML 없음': { text: '응답에서 실행할 HTML 문서를 찾지 못했어요.', showResponseText: true },
};

/** 결과물이 있으면 null. "생성 실패"는 마지막 시도의 에러 종류 표시를 괄호로 덧붙인다 */
export function missingOutputReason(record: GenerationRecord | null): MissingOutputReason | null {
  if (record?.output) return null;
  const label = statusLabelOf(record);
  const reason = MISSING_OUTPUT_REASON[label];
  if (!reason) return null;
  if (label === '생성 실패' && record) {
    const kind = lastFailureKind(record);
    if (kind && kind !== 'usage_limit') return { ...reason, text: `${reason.text} (${FAILURE_KIND_LABEL[kind]})` };
  }
  return { ...reason };
}

function lastFailureKind(record: GenerationRecord): FailureKind | null {
  const last = record.attempts[record.attempts.length - 1]!.result;
  return last.type === 'error' ? last.kind : null;
}

/* ───────── 생성 횟수·재생성 안내 (COPY "결과 탭" → "다시 생성하거나 고친 결과물", ADR-032) ───────── */

/** 결과 탭 안내 박스: 첫 줄 + 버린 결과물마다 한 줄(오래된 것부터) */
export interface RegenerationNotice {
  title: string;
  lines: string[];
}

/** 버린 생성본의 "이유와 한 일" (다음에 한 일이 다시 생성일 때). 수정 요청 문구는 --repair와 함께 더한다 */
const REGENERATE_REASON: Readonly<Record<Discarded['reason'], string>> = {
  blank_screen: '화면에 나무가 그려지지 않아 다시 생성했어요.',
  continued_output: '생성 도구가 출력 상한을 넘겨 이어 쓴 응답을 잘못 기록해서, 그 기록을 버리고 다시 생성했어요.',
};
const UNCOMMITTED = '(기록은 남아 있지 않아요)';
const commitText = (commit: string | null) => (commit === null ? UNCOMMITTED : `(커밋 ${commit.slice(0, 7)})`);

/** 생성 횟수 = 버린 생성본 + 공개 결과물(지금은 항상 생성본) */
const generationsOf = (model: ModelEntry) => (model.discarded ?? []).filter((d) => d.made === 'generation').length + 1;

/**
 * 버린 결과물이 없으면 null. 수정 요청 항목(made·next가 repair)은 아직 문구가 없어서 throw한다
 * (check:results도 같은 이유로 막는다 — 수정 요청은 필요해질 때 만든다, ADR-032)
 */
export function regenerationNotice(model: ModelEntry): RegenerationNotice | null {
  const discarded = model.discarded ?? [];
  if (discarded.length === 0) return null;
  const lines = discarded.map((d, i) => {
    if (d.made !== 'generation' || d.next !== 'regenerate') {
      throw new Error(`${model.slug}.discarded.${i}: ${REPAIR_NOT_IMPLEMENTED}`);
    }
    return `${i + 1}번째 생성: ${REGENERATE_REASON[d.reason]} ${commitText(d.commit)}`;
  });
  return { title: `${generationsOf(model)}번째로 생성한 결과물이에요.`, lines };
}

/* ───────── 모델 한 행의 표시 값 ───────── */

export interface RequirementDisplay {
  key: RequirementKey;
  label: string;
  /** null = 판정 전 또는 결과물 없음 */
  mark: Mark | null;
  /** ✓ 충족 · △ 부분 충족 · ✗ 미충족 · 판정 전 · — */
  text: string;
}

/** 결과 탭·비교표가 쓰는 표시 값 전부. 값은 표시할 문자열이고 없으면 '—'. JSON으로 그대로 옮길 수 있다 */
export interface ModelDisplay {
  slug: string;
  displayName: string;
  /** 회사: Anthropic · OpenAI · Google */
  company: string;
  /** 생성 도구: Claude Code · Codex CLI · Gemini API (생성 전이어도 provider로 정해진다) */
  generator: string;
  /** 출시일 YYYY-MM-DD */
  releasedAt: string;
  status: StatusBadge;
  /** 실행할 결과물(index.html)이 있는지 */
  hasOutput: boolean;
  /** 결과물이 없을 때 실행 영역에 보일 이유. 결과물이 있으면 null */
  missingOutput: MissingOutputReason | null;
  /** 조건 검사: 정상 · 지시 미준수 · 위반 */
  requestCheck: string;
  /** 0.170.0 · r170 · "0.170.0, 0.160.1" · 미고정 */
  threeVersion: string;
  errorCount: string;
  /** 40.3 KB */
  fileSize: string;
  inputTokens: string;
  outputTokens: string;
  /** 결과 탭 "토큰 (입력 / 출력)": 1,200 / 18,500 */
  tokens: string;
  reasoningTokens: string;
  /** 입력 토큰 옆 각주 기호: 생성 도구가 Claude Code 또는 Codex CLI인 행이면 § (ADR-030). 비교표에만 쓴다 */
  inputTokensMark: '' | '§';
  /** 출력 토큰 옆 각주 기호: 생성 도구가 Codex CLI인 행이면 † */
  outputTokensMark: '' | '†';
  /** 그중 추론 옆 각주 기호: 회사가 Google인 행이면 ‡ */
  reasoningTokensMark: '' | '‡';
  /** $0.47 · <$0.01 */
  cost: string;
  /** 걸린 시간: 3분 34초 · 48초 */
  duration: string;
  retries: string;
  /** 생성 횟수: 3회 (버린 생성본 + 공개 결과물). meta.json이 없거나 api_failed면 — */
  generationCount: string;
  /** 생성 횟수 옆 각주 기호: 버린 결과물이 있는 모델이면 ¶ (ADR-032) */
  generationCountMark: '' | '¶';
  /** 결과 탭 안내 박스. 버린 결과물이 없으면 null */
  regeneration: RegenerationNotice | null;
  /** 요구사항 4개 (REQUIREMENT_LABEL 순서) */
  requirements: RequirementDisplay[];
  /** 판정 메모. 판정이 없거나 결과물이 없으면 null */
  note: string | null;
}

export function displayModel(entry: ResultEntry): ModelDisplay {
  const { model, record } = entry;
  const tool = GENERATOR_BY_PROVIDER[model.provider];
  const hasOutput = record?.output != null;
  const judgment = hasOutput ? entry.judgment : null;
  const validation = record?.validation ?? null;

  // api_failed이고 과금된 사용량이 없으면 토큰은 — (응답이 온 기록은 0도 숫자로)
  const usage =
    record === null ||
    (record.outcome === 'api_failed' && record.usageTotal.inputTokens === 0 && record.usageTotal.outputTokens === 0)
      ? null
      : record.usageTotal;
  const inputTokens = usage ? formatInt(usage.inputTokens) : NO_VALUE;
  const outputTokens = usage ? formatInt(usage.outputTokens) : NO_VALUE;

  return {
    slug: model.slug,
    displayName: model.displayName,
    company: PROVIDER_LABEL[model.provider],
    generator: GENERATOR_LABEL[tool],
    releasedAt: model.releasedAt,
    status: statusOf(record),
    hasOutput,
    missingOutput: missingOutputReason(record),
    requestCheck: validation ? VERDICT_LABEL[judgeRequests(validation.externalRequests).verdict] : NO_VALUE,
    threeVersion: validation ? threeVersionOf(validation.externalRequests) : NO_VALUE,
    errorCount: validation ? String(validation.consoleErrors.length + validation.pageErrors.length) : NO_VALUE,
    fileSize: record?.output ? formatKb(record.output.bytes) : NO_VALUE,
    inputTokens,
    outputTokens,
    tokens: usage ? `${inputTokens} / ${outputTokens}` : NO_VALUE,
    reasoningTokens: usage && usage.reasoningTokens !== null ? formatInt(usage.reasoningTokens) : NO_VALUE,
    inputTokensMark: tool === 'claude-code' || tool === 'codex-cli' ? '§' : '',
    outputTokensMark: tool === 'codex-cli' ? '†' : '',
    reasoningTokensMark: model.provider === 'google' ? '‡' : '',
    cost: record ? formatUsd(record.cost.totalUsd) : NO_VALUE,
    duration: record && record.outcome !== 'api_failed' ? formatDuration(record.attempts.at(-1)!.latencyMs) : NO_VALUE,
    retries: record ? String(record.attempts.length - 1) : NO_VALUE,
    // 응답이 오지 않은 기록(api_failed)은 표본이 아니라 횟수가 없다 (ADR-032, 2026-10-14 사용자 결정)
    generationCount: record && record.outcome !== 'api_failed' ? `${generationsOf(model)}회` : NO_VALUE,
    generationCountMark: model.discarded && model.discarded.length > 0 ? '¶' : '',
    regeneration: regenerationNotice(model),
    requirements: (Object.keys(REQUIREMENT_LABEL) as RequirementKey[]).map((key) => {
      const mark = judgment ? judgment.requirements[key] : null;
      return {
        key,
        label: REQUIREMENT_LABEL[key],
        mark,
        text: mark ? MARK_LABEL[mark] : hasOutput ? NOT_JUDGED : NO_VALUE,
      };
    }),
    note: judgment ? judgment.note : null,
  };
}

/** 문구의 {N}을 모델 수로 바꾼다 (COPY: 모델 수는 하드코딩하지 않는다) */
export function fillCount(text: string, n: number): string {
  return text.replaceAll('{N}', String(n));
}

/* ───────── 포맷 ───────── */

/** kind가 three(고정)인 요청의 버전, 중복 없이 요청 순서대로. 미고정만 있으면 "미고정", three 요청이 없으면 — */
function threeVersionOf(requests: readonly ExternalRequest[]): string {
  const { items } = judgeRequests(requests);
  const versions = [
    ...new Set(items.filter((i) => i.kind === 'three').map((i) => pinnedThreeVersion(i.url) ?? '')),
  ].filter(Boolean);
  if (versions.length > 0) return versions.join(', ');
  return items.some((i) => i.kind === 'three_unpinned') ? THREE_UNPINNED_LABEL : NO_VALUE;
}

const intFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
/** 천 단위 쉼표 정수: 토큰 수, 프롬프트 탭 "생성 조건"의 출력 상한 (65,536) */
export const formatInt = (n: number) => intFormat.format(n);

/** 1024 기준 소수 1자리 KB */
const formatKb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

/** 소수 2자리 달러. 0보다 크고 0.01 미만이면 <$0.01 */
const formatUsd = (usd: number) => (usd > 0 && usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`);

/** 초 단위로 반올림해서 60초 미만은 "48초", 이상은 "3분 34초" */
function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}초` : `${Math.floor(s / 60)}분 ${s % 60}초`;
}
