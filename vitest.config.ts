import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
    // Tests mutate the shared process.env (SKILLPKG_HOME fake home) and vitest
    // reuses worker processes across files, so files must not run concurrently.
    fileParallelism: false,
    setupFiles: ['tests/setup.ts'],
  },
});
