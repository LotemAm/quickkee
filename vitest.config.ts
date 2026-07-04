import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [],
    exclude: ['**/tests/e2e/**', '**/node_modules/**', '**/.claude/worktrees/**'],
    env: { VITE_QK_TEST: '0' },
  },
});
