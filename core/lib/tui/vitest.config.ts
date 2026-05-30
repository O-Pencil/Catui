/**
 * [WHO]: Extension interface
 * [FROM]: Depends on vitest/config
 * [TO]: Not imported - vitest configuration file, consumed by vitest CLI 
 * [HERE]: ./core/lib/tui/vitest.config.ts -
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["test/wrap-ansi.test.ts"],
	},
});
