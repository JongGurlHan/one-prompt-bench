import type { ModelDisplay, RegenerationNotice, RequirementDisplay } from '@opb/core';
import { RECORD_CARD, resultFrameTitle, runCardMeta } from './copy.ts';
import { responseTextSrc, resultSrc, viewHref } from './paths.ts';

/* ────────────────────────────────────────────────────────────
 * 결과 탭에서 모델을 고르면 바뀌는 값 (빌드 때 만든다)
 * 첫 선택 모델은 이 값으로 HTML을 그리고, 모델 전부의 값은 JSON으로 페이지에 넣어
 * 클라이언트 스크립트가 그대로 옮겨 쓴다 — 라벨·포맷을 클라이언트에서 다시 계산하지 않는다.
 * 표시 값은 전부 core displayModel 결과다.
 * ──────────────────────────────────────────────────────────── */

export type RecordKey = keyof typeof RECORD_CARD.rows;
export const RECORD_KEYS = Object.keys(RECORD_CARD.rows) as RecordKey[];

export interface ResultView {
  slug: string;
  displayName: string;
  /** 실행 카드 머리의 보조 줄 */
  runMeta: string;
  /** 실행할 결과물. 없으면 null */
  output: {
    /** 샌드박스 iframe의 src (결과물 사본) */
    src: string;
    frameTitle: string;
    /** "새 창에서 열기" 래퍼 페이지 */
    viewHref: string;
  } | null;
  /** 결과물이 없을 때. 있으면 null */
  missing: {
    reason: string;
    /** 응답 원문 카드에 불러올 원문 사본. 원문을 보여 주지 않는 라벨이면 null */
    responseTextSrc: string | null;
  } | null;
  /** 실행 카드 위 재생성 안내 박스 (ADR-032). 버린 결과물이 없으면 null */
  regeneration: RegenerationNotice | null;
  requirements: RequirementDisplay[];
  note: string | null;
  record: Record<RecordKey, string>;
}

export function resultView(d: ModelDisplay): ResultView {
  return {
    slug: d.slug,
    displayName: d.displayName,
    runMeta: runCardMeta(d.company, d.generator, d.releasedAt),
    output: d.hasOutput ? { src: resultSrc(d.slug), frameTitle: resultFrameTitle(d.displayName), viewHref: viewHref(d.slug) } : null,
    missing: d.missingOutput
      ? { reason: d.missingOutput.text, responseTextSrc: d.missingOutput.showResponseText ? responseTextSrc(d.slug) : null }
      : null,
    regeneration: d.regeneration,
    requirements: d.requirements,
    note: d.note,
    record: {
      status: d.status.label,
      requestCheck: d.requestCheck,
      errorCount: d.errorCount,
      tokens: d.tokens,
      cost: d.cost,
      duration: d.duration,
    },
  };
}

/** 첫 선택 (ADR-025): 목록 순서에서 결과물이 있는 첫 모델, 하나도 없으면 맨 위 모델. 모델이 없으면 undefined */
export function initialSelection<T extends { hasOutput: boolean }>(models: readonly T[]): T | undefined {
  return models.find((m) => m.hasOutput) ?? models[0];
}

/** <script type="application/json">에 넣을 JSON. '<'를 이스케이프해 </script>로 끝나지 않게 한다 */
export const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');
