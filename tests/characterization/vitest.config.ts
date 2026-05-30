/**
 * [WHO]: Provides the vitest config for the characterization harness
 * [FROM]: Depends on vitest/config
 * [TO]: Run via `npx vitest run --config tests/characterization/vitest.config.ts`
 * [HERE]: tests/characterization/vitest.config.ts — isolated config (agent runs are slow + serial)
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/characterization/characterization.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Cassette replay mutates global.fetch + env; keep cases serial.
    fileParallelism: false,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
