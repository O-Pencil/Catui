/**
 * [WHO]: Baseline dump — captures current buildPresenceSystemPrompt / buildGreetingPrompt output before refactor
 * [FROM]: Depends on presence extension internals, node:test
 * [TO]: Human-readable baseline for stage-0 evidence
 * [HERE]: test/presence-prompt-dump.test.ts — diagnostic, not a regression test
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const presenceModule = await import("../extensions/builtin/presence/index.ts");
const { __testUtils } = presenceModule as unknown as {
	__testUtils: {
		buildPresenceSystemPrompt: (
			locale: "en" | "zh",
			soulHints: unknown,
			kind: "opening" | "idle",
		) => string;
		getPersonaPresenceLines: (kind: "opening" | "idle") => string[];
	};
};

describe("baseline: presence prompt output (pre-refactor)", () => {
	it("captures system prompt with empty soul hints", () => {
		const zhOpening = __testUtils.buildPresenceSystemPrompt(
			"zh",
			{ traits: [], identityPreferences: [] },
			"opening",
		);
		const zhIdle = __testUtils.buildPresenceSystemPrompt(
			"zh",
			{ traits: [], identityPreferences: [] },
			"idle",
		);
		const enOpening = __testUtils.buildPresenceSystemPrompt(
			"en",
			{ traits: [], identityPreferences: [] },
			"opening",
		);

		// Diagnostic dump — no assertion. Use --test-reporter=spec to read this.
		// eslint-disable-next-line no-console
		console.log("\n[baseline/zh/opening]\n" + zhOpening);
		// eslint-disable-next-line no-console
		console.log("\n[baseline/zh/idle]\n" + zhIdle);
		// eslint-disable-next-line no-console
		console.log("\n[baseline/en/opening]\n" + enOpening);

		assert.ok(zhOpening.length > 0, "zh opening prompt should be non-empty");
	});

	it("captures system prompt with soul traits + identity preferences populated", () => {
		const soulHints = {
			traits: ["agreeableness:0.60", "conscientiousness:0.60", "openness:0.50"],
			identityPreferences: [
				"preferred_tone: user prefers poetic / 古典 phrasing in casual lines",
				"address_style: address user as 子时过半",
			],
		};
		const zhOpening = __testUtils.buildPresenceSystemPrompt("zh", soulHints, "opening");
		const enOpening = __testUtils.buildPresenceSystemPrompt("en", soulHints, "opening");

		// eslint-disable-next-line no-console
		console.log("\n[baseline/zh/opening + soul traits + identity]\n" + zhOpening);
		// eslint-disable-next-line no-console
		console.log("\n[baseline/en/opening + soul traits + identity]\n" + enOpening);

		assert.ok(zhOpening.includes("agreeableness"), "soul traits should be in prompt");
		assert.ok(
			zhOpening.includes("poetic") || zhOpening.includes("古典"),
			"identity preferences should be in prompt",
		);
	});

	it("captures persona presence lines from current NANO_PERSONA_DIR", () => {
		const dir = process.env.NANO_PERSONA_DIR;
		if (!dir) {
			// eslint-disable-next-line no-console
			console.log("\n[baseline/persona] NANO_PERSONA_DIR not set, skipping\n");
			return;
		}
		const opening = __testUtils.getPersonaPresenceLines("opening");
		const idle = __testUtils.getPersonaPresenceLines("idle");
		// eslint-disable-next-line no-console
		console.log(
			"\n[baseline/persona/opening from " + dir + "]\n" + opening.join("\n") + "\n",
		);
		// eslint-disable-next-line no-console
		console.log("\n[baseline/persona/idle]\n" + idle.join("\n") + "\n");
		assert.ok(Array.isArray(opening));
		assert.ok(Array.isArray(idle));
	});
});
