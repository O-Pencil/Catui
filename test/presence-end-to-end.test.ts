/**
 * [WHO]: End-to-end prompt assembly tests for presence (no live LLM required)
 * [FROM]: Depends on extensions/builtin/presence, node:test, node:fs
 * [TO]: Run via `node --test --import tsx test/presence-end-to-end.test.ts`
 * [HERE]: test/presence-end-to-end.test.ts — stage 5 e2e verification of the prompt wiring
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const presenceModule = await import("../extensions/builtin/presence/index.ts");
const { __testUtils } = presenceModule as unknown as {
	__testUtils: {
		buildPresencePromptPair: (
			state: unknown,
			locale: "en" | "zh",
			soulHints: unknown,
			kind: "opening" | "idle",
			lastUserMessage?: string,
		) => Promise<{ systemPrompt: string; userPrompt: string } | undefined>;
		loadPersonaIdentity: () => string;
	};
};

const VEX_CATUI = `# Vex

做事一针见血，说话带刺但句句在理。

## Identity

你叫 Vex。一个技术极强但嘴上不饶人的搭档。

- 语气像一个被拉去救火三次的老工程师
- 嘲讽是你的母语，但能力是你说话的底气
- 话少，但每句都有信息量

## Tone

默认语气：冷、快、准。

- 短句优先。能三个字说完的别用三十个字
- 反问句是你的好朋友
- 任何形式的 emoji（除非用户先用）

## Working Style

- 先动手再说话
- 多个方案时直接推荐最优解
- 出错了直接说原因和修复方案
`;

type EngineShape = {
	getAllEntries: () => Promise<{
		knowledge: Array<Record<string, unknown>>;
		lessons: Array<Record<string, unknown>>;
		preferences?: Array<Record<string, unknown>>;
		events?: Array<Record<string, unknown>>;
		facets?: Array<Record<string, unknown>>;
	}>;
	getAllEpisodes: () => Promise<Array<Record<string, unknown>>>;
	searchEntries: (q: string) => Promise<Array<Record<string, unknown>>>;
};

function makeEngine(opts: {
	preferences?: Array<Record<string, unknown>>;
	knowledge?: Array<Record<string, unknown>>;
	lessons?: Array<Record<string, unknown>>;
	episodes?: Array<Record<string, unknown>>;
}): EngineShape {
	return {
		getAllEntries: async () => ({
			knowledge: opts.knowledge ?? [],
			lessons: opts.lessons ?? [],
			preferences: opts.preferences,
			events: [],
			facets: [],
		}),
		getAllEpisodes: async () => opts.episodes ?? [],
		searchEntries: async () => [],
	};
}

function makeState(
	persona?: EngineShape,
	global?: EngineShape,
	recentlyReferenced: string[] = [],
): unknown {
	return {
		memEngine: global,
		personaMemEngine: persona,
		recentlyReferencedMemories: recentlyReferenced,
		recentPresenceLines: [],
	};
}

describe("presence end-to-end prompt assembly (5 contexts)", () => {
	let originalEnv: string | undefined;
	let tmpDir: string;

	before(() => {
		originalEnv = process.env.NANO_PERSONA_DIR;
		tmpDir = mkdtempSync(join(tmpdir(), "catui-e2e-"));
		const personaDir = join(tmpDir, "vex");
		mkdirSync(personaDir, { recursive: true });
		writeFileSync(join(personaDir, "CATUI.md"), VEX_CATUI, "utf-8");
		process.env.NANO_PERSONA_DIR = personaDir;
	});

	after(() => {
		if (originalEnv === undefined) delete process.env.NANO_PERSONA_DIR;
		else process.env.NANO_PERSONA_DIR = originalEnv;
		rmSync(tmpDir, { recursive: true, force: true });
	});

	// Case 1: clean opening, persona memory + global memory, no soul
	it("case 1: opening with persona+global memory, no soul, no last user", async () => {
		const persona = makeEngine({
			preferences: [{ name: "voice:short", type: "preference", summary: "短句", tags: ["preference"] }],
		});
		const global = makeEngine({
			preferences: [{
				name: "global_pref_x",
				type: "preference",
				summary: "global memory item",
				tags: ["preference"],
			}],
		});
		const soul = { traits: [], tone: undefined, identityPreferences: [] };
		const pair = await __testUtils.buildPresencePromptPair(
			makeState(persona, global),
			"zh",
			soul,
			"opening",
		);
		assert.ok(pair, "should return prompt pair");
		const { systemPrompt, userPrompt } = pair;

		// System prompt: persona-locked block
		assert.ok(systemPrompt.includes("[Persona Identity — highest priority, persona-locked]"));
		assert.ok(systemPrompt.includes("你叫 Vex"));
		assert.ok(systemPrompt.includes("短句优先"));

		// User prompt: priority labels
		assert.ok(userPrompt.includes("约束分级"));
		assert.ok(userPrompt.includes("[1] 最高优先级"));
		assert.ok(userPrompt.includes("[2] 中优先级"));
		assert.ok(userPrompt.includes("[3] 背景参考"));

		// Memory layering: persona pref surfaces
		assert.ok(userPrompt.includes("voice:short"));
		// Global pref also surfaces
		assert.ok(userPrompt.includes("global_pref_x"));

		// No soul means no [2] soul sections
		assert.ok(!userPrompt.includes("Soul 演化"));
		assert.ok(!userPrompt.includes("Soul 人格倾向"));
	});

	// Case 2: soul with conflicting identity preferences
	it("case 2: soul identity conflicts with persona — soul is de-prioritized, persona still locked", async () => {
		const persona = makeEngine({});
		const global = makeEngine({});
		const soul = {
			traits: ["agreeableness:0.85", "openness:0.92"],
			tone: "contemplative",
			identityPreferences: [
				"preferred_tone: user prefers poetic / 古典 phrasing in casual lines",
				"address_style: address user as 子时过半",
			],
		};
		const pair = await __testUtils.buildPresencePromptPair(
			makeState(persona, global),
			"zh",
			soul,
			"opening",
		);
		assert.ok(pair);
		const { systemPrompt, userPrompt } = pair;

		// Persona block still highest priority
		assert.ok(
			systemPrompt.indexOf("[Persona Identity — highest priority, persona-locked]") <
				systemPrompt.indexOf("Soul 演化偏好（中优先级"),
			"persona block should appear before soul hints",
		);

		// User prompt: soul sections are explicitly labeled [2] medium priority
		assert.ok(userPrompt.includes("Soul 演化"));
		assert.ok(userPrompt.includes("和 persona 不冲突时遵循"));
		assert.ok(userPrompt.includes("[2] Soul 人格倾向"));
		assert.ok(userPrompt.includes("中优先级参考"));
		// The classical/wen-yan preference IS present (we don't strip it) but it's
		// explicitly marked as lower priority than persona
		assert.ok(userPrompt.includes("古典"));
	});

	// Case 3: idle with last user message
	it("case 3: idle with last user message, persona memory only", async () => {
		const persona = makeEngine({
			preferences: [{ name: "no_emoji", type: "preference", summary: "no emoji", tags: ["preference"] }],
		});
		const soul = { traits: ["openness:0.5"], tone: "neutral", identityPreferences: [] };
		const pair = await __testUtils.buildPresencePromptPair(
			makeState(persona, undefined),
			"zh",
			soul,
			"idle",
			"我想 release 1.1.16 之前先 review 一遍 diff",
		);
		assert.ok(pair);
		const { userPrompt } = pair;

		assert.ok(userPrompt.includes("用户安静了几分钟"));
		assert.ok(userPrompt.includes("不要重复你之前说过的开场白"));
		assert.ok(userPrompt.includes("我想 release 1.1.16"));
		// persona memory surfaces
		assert.ok(userPrompt.includes("no_emoji"));
	});

	// Case 4: english locale
	it("case 4: english locale, persona identity surfaces, soul de-prioritized", async () => {
		const persona = makeEngine({});
		const global = makeEngine({});
		const soul = {
			traits: ["conscientiousness:0.7"],
			tone: "focused",
			identityPreferences: ["preferred_tone: classical / poetic"],
		};
		const pair = await __testUtils.buildPresencePromptPair(
			makeState(persona, global),
			"en",
			soul,
			"opening",
		);
		assert.ok(pair);
		const { systemPrompt, userPrompt } = pair;

		// English system prompt directs model to follow persona first
		assert.ok(systemPrompt.includes("Follow the persona-locked identity first"));
		assert.ok(systemPrompt.includes("Persona Identity — highest priority, persona-locked"));
		// English user prompt uses [1] [2] [3] labels
		assert.ok(userPrompt.includes("Constraint priorities (highest first)"));
		assert.ok(userPrompt.includes("[2] Soul-evolved preferences (medium priority"));
	});

	// Case 5: persona memory + global memory, name conflict — persona wins
	it("case 5: persona memory and global memory with overlapping preference name", async () => {
		const persona = makeEngine({
			preferences: [{
				name: "voice:short",
				type: "preference",
				summary: "persona override: 短句",
				tags: ["preference"],
			}],
		});
		const global = makeEngine({
			preferences: [{
				name: "voice:short",
				type: "preference",
				summary: "global fallback: 长句",
				tags: ["preference"],
			}],
		});
		const pair = await __testUtils.buildPresencePromptPair(
			makeState(persona, global),
			"zh",
			{ traits: [], identityPreferences: [] },
			"opening",
		);
		assert.ok(pair);
		const { userPrompt } = pair;
		assert.ok(userPrompt.includes("persona override: 短句"));
		assert.ok(!userPrompt.includes("global fallback: 长句"), "global should be deduped out");
	});

	// Case 6: no persona env (degraded mode) — soul-only still works without persona block
	it("case 6: degraded — no persona CATUI.md, soul-only still produces valid prompt", async () => {
		delete process.env.NANO_PERSONA_DIR;
		const persona = makeEngine({});
		const global = makeEngine({});
		const soul = {
			traits: ["openness:0.5"],
			tone: "neutral",
			identityPreferences: ["preferred_tone: classical"],
		};
		const pair = await __testUtils.buildPresencePromptPair(
			makeState(persona, global),
			"en",
			soul,
			"opening",
		);
		assert.ok(pair);
		const { systemPrompt } = pair;
		assert.ok(!systemPrompt.includes("[Persona Identity"));
		assert.ok(systemPrompt.includes("medium priority, follow when not conflicting with persona"));
		// restore for after() cleanup
		process.env.NANO_PERSONA_DIR = join(tmpDir, "vex");
	});
});
