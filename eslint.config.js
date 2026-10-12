import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['**/node_modules/', '**/dist/', 'docs/', 'scripts/', 'phases/']),
  {
    files: ['packages/**/*.ts', 'pipeline/**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
  },
  {
    // check-samples는 불변식이 실제로 잡히는지 보려고 스키마 밖의 값을 일부러 만든다
    files: ['packages/core/scripts/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
