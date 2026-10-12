import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_RUN_POLICY, RETRYABLE_FAILURES, sortByRelease } from '@opb/core';

// '@opb/core'가 빌드 없이 TS 소스로 해석되는지 (tsx 실행, tsc NodeNext 양쪽)
test('@opb/core의 값을 pipeline에서 import해 쓸 수 있다', () => {
  assert.ok(RETRYABLE_FAILURES.has('timeout'));
  assert.ok(!RETRYABLE_FAILURES.has('usage_limit'));
  assert.equal(DEFAULT_RUN_POLICY.maxAttempts, 3);
  assert.deepEqual(
    sortByRelease([
      { releasedAt: '2026-01-01', displayName: 'B' },
      { releasedAt: '2026-02-01', displayName: 'A' },
    ]).map((m) => m.displayName),
    ['A', 'B'],
  );
});
