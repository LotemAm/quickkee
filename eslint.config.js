import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default tseslint.config(
  { ignores: ['**/dist_chrome/**', '**/dist_firefox/**', '**/playwright-report/**', '**/test-results/**', '**/node_modules/**', 'plans/**', 'docs/**', 'public/**', '.claude/worktrees/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { react, 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    languageOptions: { globals: { chrome: 'readonly' } },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      // Mechanical: allow an intentional `_`/`_foo` prefix to opt out of unused-vars.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // Node-executed fixture-generator scripts (not extension runtime code) need Node globals.
    files: ['**/*.mjs'],
    languageOptions: { globals: { URL: 'readonly', Buffer: 'readonly', console: 'readonly', process: 'readonly' } },
  },
  {
    // Downgrade only: test-seam code (unit test files, e2e specs/helpers, and the
    // VITE_QK_TEST-gated test harness block in background/testCommands.ts) legitimately
    // deals with loosely-typed mocks, fixtures, and an ad-hoc wire protocol. Real
    // production code keeps this rule at 'error' via the block above.
    files: ['**/*.test.ts', 'tests/e2e/**/*.{ts,mjs}', 'src/pages/background/testCommands.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
);
