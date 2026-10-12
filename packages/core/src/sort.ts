import type { ModelEntry } from './schema.js';

/**
 * 사이트 목록 정렬 규칙 (단일 출처)
 *  1) 출시일 최신순
 *  2) 출시일이 같으면 표시 이름 알파벳순 (숫자는 크기순: GPT-6 < GPT-10)
 * 등록순은 쓰지 않는다.
 */
export function sortByRelease<T extends Pick<ModelEntry, 'releasedAt' | 'displayName'>>(models: readonly T[]): T[] {
  return [...models].sort(
    (a, b) =>
      b.releasedAt.localeCompare(a.releasedAt) ||
      a.displayName.localeCompare(b.displayName, 'en', { numeric: true, sensitivity: 'base' }),
  );
}
