import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 15_000,
    // Each DB test file boots its own PGlite (WASM Postgres); unbounded thread
    // parallelism starves them into 15s timeouts on full-suite runs.
    maxWorkers: 4,
    minWorkers: 1,
  },
});
