/**
 * [WHO]: Verifies bundled persona asset contracts
 * [FROM]: Depends on node:assert, node:fs/promises, node:test
 * [TO]: Run by persona asset regression checks
 * [HERE]: test/persona-assets.test.ts - coverage for shipped assets/personas entries
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
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

test("Athena ships as the scientific persona without duplicating CATAIL", async () => {
	const personaUrl = new URL("../assets/personas/athena/CATUI.md", import.meta.url);
	const content = await readFile(personaUrl, "utf8");

	assert.match(content, /^# Athena/m);
	assert.match(content, /从橄榄枝下拾起问题，以智慧与证据把未知编织成可辩护的知识。/);
	assert.match(content, /scientific research persona/i);
	assert.match(content, /## Scientific Temperament/);
	assert.match(content, /## CATAIL Contract/);
	assert.match(content, /default research-to-publication Skill/i);
	assert.match(content, /ordinary coding/i);
	assert.match(content, /## Presence/);
	assert.match(content, /Never fabricate citations, data, results, metrics/i);
	assert.equal(
		existsSync(fileURLToPath(new URL("../assets/personas/athena/skills/catail/SKILL.md", import.meta.url))),
		false,
		"Athena must consume the global CATAIL Skill rather than ship a divergent copy.",
	);
});
