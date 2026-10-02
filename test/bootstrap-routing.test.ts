/**
 * [WHO]: Verifies the five default bootstrap prompts stay available, bounded, and boundary-complete
 * [FROM]: Depends on node:test/assert/fs/path, the five passive extension modules, and core/skills.ts
 * [TO]: Consumed by test:runtime-owners; establishes deterministic availability and content only
 * [HERE]: test/bootstrap-routing.test.ts - S03 bootstrap dedup regression coverage
 *
 * Scope limit: these tests assert which routing constraints are present in the default prompt and
 * which are deferred to discoverable skill metadata. They do not measure real-model routing
 * effectiveness; that requires the S09 paired experiments with a provider.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import catpawExtension from "../extensions/builtin/catpaw/index.js";
import { CATAIL_BOOTSTRAP_PROMPT } from "../extensions/builtin/catail/index.js";
import disciplineExtension from "../extensions/builtin/discipline/index.js";
import typesafeExtension, { DECISION_GUIDANCE } from "../extensions/builtin/typesafe/index.js";
import { HUMANIZER_BOOTSTRAP_PROMPT } from "../extensions/builtin/humanizer/index.js";
import { loadSkillsFromDir } from "../core/skills.js";
import type { ExtensionAPI } from "../core/extensions-host/types.js";

type Bootstrap = { appendSystemPrompt?: string };

async function bootstrapOf(load: (api: ExtensionAPI) => void | Promise<void>): Promise<string> {
	let text = "";
	const api = {
		on(event: string, handler: () => Bootstrap | undefined) {
			if (event !== "before_agent_start") return;
			text = handler()?.appendSystemPrompt ?? "";
		},
	} as unknown as ExtensionAPI;
	await load(api);
	return text;
}

const BOOTSTRAP_BUDGET = 3_300;
const BASELINE_TOTAL = 4_388;

const CATPAW = join(process.cwd(), "extensions", "builtin", "catpaw");
const DISCIPLINE = join(process.cwd(), "extensions", "builtin", "discipline");
const TYPESAFE = join(process.cwd(), "extensions", "builtin", "typesafe");
const CATAIL = join(process.cwd(), "extensions", "builtin", "catail");
const HUMANIZER = join(process.cwd(), "extensions", "builtin", "humanizer");

test("five bootstraps stay within the reduced budget and the measured 25% target", async () => {
	const measured: Array<[string, string]> = [
		["typesafe", DECISION_GUIDANCE],
		["discipline", await bootstrapOf(disciplineExtension)],
		["catpaw", await bootstrapOf(catpawExtension)],
		["humanizer", HUMANIZER_BOOTSTRAP_PROMPT],
		["catail", CATAIL_BOOTSTRAP_PROMPT],
	];
	const total = measured.reduce((sum, [, text]) => sum + text.length, 0);
	assert.ok(
		total <= BOOTSTRAP_BUDGET,
		`Assembled bootstrap total ${total} exceeds the ${BOOTSTRAP_BUDGET}-char budget. Per extension: ${JSON.stringify(measured.map(([id, t]) => [id, t.length]))}`,
	);
	const reduction = (1 - total / BASELINE_TOTAL) * 100;
	assert.ok(reduction >= 25, `Expected at least 25% reduction from ${BASELINE_TOTAL}, got ${reduction.toFixed(1)}%.`);
});

test("coding tasks keep the decision loop and the discipline hard gates", async () => {
	const typesafe = DECISION_GUIDANCE;
	const discipline = await bootstrapOf(disciplineExtension);
	assert.match(typesafe, /missing evidence or intended change/i);
	assert.match(typesafe, /Stop when complete or name the concrete blocker/i);
	assert.match(discipline, /Catui Engineering Discipline/);
	for (const gate of [
		/design clarification/i,
		/root-cause investigation/i,
		/failing test first/i,
		/fresh verification evidence/i,
	]) {
		assert.match(discipline, gate);
	}
	assert.match(discipline, /User instructions still define the goal/);
});

test("discipline skill names remain listed in the bootstrap, not only in the catalog", async () => {
	const discipline = await bootstrapOf(disciplineExtension);
	for (const skill of ["interview", "systematic-debugging", "test-driven-development", "writing-plans", "handoff"]) {
		assert.ok(discipline.includes(skill), `Expected ${skill} in the discipline bootstrap.`);
	}
});

test("UI work keeps the Catpaw harness caveat and its on-demand detail file", async () => {
	const catpaw = await bootstrapOf(catpawExtension);
	assert.match(catpaw, /Claude Code \/ Cursor \/ Codex harness/);
	assert.match(catpaw, /Catui runs neither/);
	assert.match(catpaw, /surface it to the user instead of/);
	assert.match(catpaw, /CATUI\.md/);
	assert.ok(existsSync(join(CATPAW, "CATUI.md")), "CATUI.md must ship with the bundle.");
	const notes = readFileSync(join(CATPAW, "CATUI.md"), "utf8");
	assert.match(notes, /agents\/\*\.toml/);
	assert.match(notes, /does not execute them automatically/);
	// The caveat must not imply Catui installs any hook.
	assert.equal(/Catui (installs|runs) (the )?hooks?\b/i.test(notes), false);
});

test("prose work keeps the humanizer scope and fact-integrity boundary", () => {
	assert.match(HUMANIZER_BOOTSTRAP_PROMPT, /humanizer/);
	assert.match(HUMANIZER_BOOTSTRAP_PROMPT, /user-facing prose/);
	assert.match(HUMANIZER_BOOTSTRAP_PROMPT, /never invents facts or sources/);
	assert.match(HUMANIZER_BOOTSTRAP_PROMPT, /`skill` tool/);
	assert.ok(HUMANIZER_BOOTSTRAP_PROMPT.length < 1_200);
});

test("explicit and Athena-scientific CATAIL activation keeps its full boundary", () => {
	assert.match(CATAIL_BOOTSTRAP_PROMPT, /`\/skill:catail`/);
	assert.match(CATAIL_BOOTSTRAP_PROMPT, /asks to use CATAIL/);
	assert.match(CATAIL_BOOTSTRAP_PROMPT, /active persona is Athena and the request has scientific intent/i);
	assert.match(CATAIL_BOOTSTRAP_PROMPT, /ordinary coding remains Catui's default behavior/i);
	assert.match(CATAIL_BOOTSTRAP_PROMPT, /does not require a research workflow/i);
	assert.match(CATAIL_BOOTSTRAP_PROMPT, /observation, hypothesis, evidence, claim, and conclusion/i);
	assert.ok(CATAIL_BOOTSTRAP_PROMPT.length < 1_200);
});

test("removed generic routing prose is still available in discoverable skill metadata", () => {
	// TypeSafe dropped its "load agent-decision-loop / typesafe-ai" sentence from the bootstrap.
	// Both skills must still be discoverable with descriptions that state when to use them.
	const typesafeSkills = loadSkillsFromDir({ dir: join(TYPESAFE, "skills"), source: "test" });
	assert.deepEqual(typesafeSkills.skills.map((skill) => skill.name).sort(), ["agent-decision-loop", "typesafe-ai"]);
	for (const skill of typesafeSkills.skills) {
		assert.ok(skill.description.length > 0, `${skill.name} needs a description for routing.`);
	}

	// Catpaw dropped its trigger restatement; the skill description already carries it.
	const catpawSkill = readFileSync(join(CATPAW, "SKILL.md"), "utf8");
	assert.match(catpawSkill, /^name: catpaw$/m);
	assert.match(catpawSkill, /design, redesign, shape, critique, audit, polish/);
	assert.match(catpawSkill, /Not for backend-only or non-UI tasks/);

	// Humanizer dropped its trigger restatement too.
	const humanizerSkill = readFileSync(join(HUMANIZER, "SKILL.md"), "utf8");
	assert.match(humanizerSkill, /^name: humanizer$/m);
	assert.match(humanizerSkill, /Use when editing or reviewing prose/);
	assert.match(humanizerSkill, /without changing what it says/);

	// CATAIL keeps its own boundary duplicated in the skill body.
	const catailSkill = readFileSync(join(CATAIL, "SKILL.md"), "utf8");
	assert.match(catailSkill, /Outside Athena, do not activate from scientific keywords/i);
	assert.equal(loadSkillsFromDir({ dir: join(DISCIPLINE, "skills"), source: "test" }).diagnostics.filter((d) => d.type === "error").length, 0);
});

test("no bootstrap inlines a skill body or introduces a routing model call", () => {
	for (const [id, text] of [
		["typesafe", DECISION_GUIDANCE],
		["humanizer", HUMANIZER_BOOTSTRAP_PROMPT],
		["catail", CATAIL_BOOTSTRAP_PROMPT],
	] as const) {
		assert.ok(text.length < 1_600, `${id} bootstrap must stay bounded.`);
		assert.equal(/^---$/m.test(text), false, `${id} bootstrap must not embed frontmatter.`);
	}
	// Registration stays hook-only: no tool, model, or filesystem API is touched at load time.
	const registeredEvents: string[] = [];
	typesafeExtension({ on: (event: string) => registeredEvents.push(event) } as unknown as ExtensionAPI);
	assert.deepEqual(registeredEvents.sort(), ["before_agent_start", "resources_discover"]);
});
