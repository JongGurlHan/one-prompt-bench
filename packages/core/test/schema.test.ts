import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GENERATOR_BY_PROVIDER, GeneratorToolSchema, ProviderSchema } from '../src/schema.js';

test('provider → 생성 도구: DATA.md 표와 같고, 모든 provider·도구가 한 번씩 쓰인다', () => {
  assert.deepEqual(GENERATOR_BY_PROVIDER, {
    anthropic: 'claude-code',
    openai: 'codex-cli',
    google: 'gemini-api',
  });
  assert.deepEqual(Object.keys(GENERATOR_BY_PROVIDER).sort(), [...ProviderSchema.options].sort());
  assert.deepEqual(Object.values(GENERATOR_BY_PROVIDER).sort(), [...GeneratorToolSchema.options].sort());
});
