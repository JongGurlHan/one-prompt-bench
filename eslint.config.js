import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['**/node_modules/', '**/dist/', 'docs/', 'scripts/', 'phases/', 'site/.astro/']),
  {
    // site의 .astro 파일은 린트하지 않는다 (타입은 astro check가 본다)
    files: ['packages/**/*.ts', 'pipeline/**/*.ts', 'site/**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
  },
  {
    // check-samples는 불변식이 실제로 잡히는지 보려고 스키마 밖의 값을 일부러 만든다
    files: ['packages/core/scripts/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
