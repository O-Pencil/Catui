/**
 * [WHO]: Verifies bundled persona asset contracts
 * [FROM]: Depends on node:assert, node:fs/promises, node:test
 * [TO]: Run by persona asset regression checks
 * [HERE]: test/persona-assets.test.ts - coverage for shipped assets/personas entries
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Lilith persona ships as adult dark-romance writing persona with consent boundaries", async () => {
	const content = await readFile(new URL("../assets/personas/lilith/CATUI.md", import.meta.url), "utf8");

	assert.match(content, /^# Lilith/m);
	assert.match(content, /adult/i);
	assert.match(content, /dark-romance writing/i);
	assert.match(content, /consent boundaries/i);
	assert.match(content, /adults only/i);
	assert.doesNotMatch(content, /\b(?:cock|cunt|cum|throat|hole)\b/i);
	assert.doesNotMatch(content, /sexual violence is allowed/i);
	assert.doesNotMatch(content, /no safety boundaries/i);
});
