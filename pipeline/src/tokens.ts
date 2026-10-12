import type { RunnerDeps } from '@opb/core';

/* ────────────────────────────────────────────────────────────
 * DI 토큰 (한 곳에 모은다)
 * 생성자 주입은 항상 @Inject(TOKEN)으로 명시한다. tsx(esbuild)는 emitDecoratorMetadata를
 * 지원하지 않아 타입 기반 주입이 조용히 undefined가 된다 (ADR-003).
 * ──────────────────────────────────────────────────────────── */

/** 시계·대기. core Runner의 RunnerDeps와 같은 모양이라 그대로 넘긴다. 테스트에서는 가짜로 바꾼다. */
export type Clock = RunnerDeps;
export const CLOCK = Symbol('CLOCK');

/** 레포 루트 절대 경로 (string). 기본은 패키지 위치에서 계산 — config/config.ts defaultRepoRoot */
export const REPO_ROOT = Symbol('REPO_ROOT');

/** 생성 도구별 어댑터 레지스트리 — adapters/registry.ts AdapterRegistry */
export const ADAPTERS = Symbol('ADAPTERS');

/** git 조회 — system/git.ts GitClient */
export const GIT = Symbol('GIT');

/** 사람에게 y/N 확인 — system/confirm.ts Confirm */
export const CONFIRM = Symbol('CONFIRM');

/** 검증기 — validation/validator.ts Validator (gen의 생성 직후 검증과 validate 명령이 함께 쓴다) */
export const VALIDATOR = Symbol('VALIDATOR');

/** 사람이 읽는 출력. 실제는 console, 테스트는 수집기 */
export interface Output {
  log(line: string): void;
  error(line: string): void;
}
export const OUTPUT = Symbol('OUTPUT');
