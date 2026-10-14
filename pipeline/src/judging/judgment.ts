import { JudgmentSchema, MarkSchema, type GenerationRecord, type Judgment, type Mark } from '@opb/core';

/* ────────────────────────────────────────────────────────────
 * 판정 기록 만들기 (순수 함수). 사람이 정하는 값은 요구사항 4개와 메모뿐이고,
 * 나머지(모델·프롬프트·결과물 sha256·판정 시각)는 meta.json과 시계에서 채운다 (ADR-013).
 * ──────────────────────────────────────────────────────────── */

export interface JudgeAnswers {
  requirements: Judgment['requirements'];
  /** null = 메모 없음 (메모는 선택) */
  note: string | null;
}

/** JudgmentSchema.parse를 지난 판정. 메모 앞뒤 공백은 스키마가 뗀다. 결과물이 없는 기록이면 던진다 */
export function buildJudgment({
  record,
  answers,
  now,
}: {
  record: GenerationRecord;
  answers: JudgeAnswers;
  now: Date;
}): Judgment {
  if (record.output === null) {
    throw new Error(`results/${record.modelSlug}: output이 없는 기록은 판정할 수 없습니다 (outcome ${record.outcome})`);
  }
  return JudgmentSchema.parse({
    schemaVersion: 1,
    modelSlug: record.modelSlug,
    prompt: { id: record.prompt.id, version: record.prompt.version },
    outputSha256: record.output.sha256,
    judgedAt: toKstIsoString(now),
    requirements: answers.requirements,
    note: answers.note,
  } satisfies Judgment);
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 한국 시간 ISO 문자열, 초 단위: 2026-10-13T19:24:23+09:00 */
export function toKstIsoString(date: Date): string {
  return `${new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 19)}+09:00`;
}

/** 대화형 입력의 짧은 표기: p = pass, a = partial, f = fail */
export const MARK_SHORTHAND: Readonly<Record<Mark, string>> = { pass: 'p', partial: 'a', fail: 'f' };

/** pass·partial·fail 또는 p·a·f (대소문자·앞뒤 공백 무시). 그 밖은 null — 기본값은 없다 */
export function parseMarkAnswer(answer: string): Mark | null {
  const a = answer.trim().toLowerCase();
  const full = MarkSchema.safeParse(a);
  if (full.success) return full.data;
  return MarkSchema.options.find((m) => MARK_SHORTHAND[m] === a) ?? null;
}

/** 메모가 있을 때의 모양 (스키마는 null = 메모 없음도 받는다) */
const NoteSchema = JudgmentSchema.shape.note.unwrap();
/** 메모 최대 길이 (JudgmentSchema에서 읽는다) */
export const NOTE_MAX = NoteSchema.maxLength ?? Infinity;

/** 메모 문자열이 스키마를 통과하면 null, 아니면 한국어 이유. 빈 메모는 이유가 된다(메모 없음은 문자열이 아니라 null) */
export function noteProblem(note: string): string | null {
  if (NoteSchema.safeParse(note).success) return null;
  const length = note.trim().length;
  if (length === 0) return '메모가 비었습니다';
  return `메모는 ${NOTE_MAX}자까지입니다 (지금 ${length}자)`;
}
