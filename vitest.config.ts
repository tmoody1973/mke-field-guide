import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 15_000,
    // Each DB test file boots its own PGlite (WASM Postgres) replaying all 14
    // migrations (~12s solo by Phase 4). Parallel boots starve each other AND the
    // 10s default hook timeout: at maxWorkers 4 a busy machine fails ~40 tests
    // that all pass serially (verified 2026-07-08). Two workers + a 45s hook
    // budget keeps full-suite runs honest without serializing everything.
    maxWorkers: 2,
    hookTimeout: 45_000,
  },
});
