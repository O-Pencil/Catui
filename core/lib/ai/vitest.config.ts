/**
 * [WHO]: Extension interface
 * [FROM]: Depends on vitest/config
 * [TO]: Not imported - vitest configuration file, consumed by vitest CLI 
 * [HERE]: ./core/lib/ai/vitest.config.ts -
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000, // 30 seconds for API calls
  }
});