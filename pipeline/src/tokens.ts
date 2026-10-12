import type { RunnerDeps } from '@opb/core';

/* ────────────────────────────────────────────────────────────
 * DI 토큰 (한 곳에 모은다)
 * 생성자 주입은 항상 @Inject(TOKEN)으로 명시한다. tsx(esbuild)는 emitDecoratorMetadata를
 * 지원하지 않아 타입 기반 주입이 조용히 undefined가 된다 (ADR-003).
 * ──────────────────────────────────────────────────────────── */

/** 시계·대기. core Runner의 RunnerDeps와 같은 모양이라 그대로 넘긴다. 테스트에서는 가짜로 바꾼다. */
export type Clock = RunnerDeps;
export const CLOCK = Symbol('CLOCK');
