/**
 * [WHO]: Tests for persona + global memory layering in presence extension
 * [FROM]: Depends on extensions/builtin/presence/presence-memory.ts
 * [TO]: Run via `node --test --import tsx test/presence-persona-memory.test.ts`
 * [HERE]: test/presence-persona-memory.test.ts — stage 2 memory-layer tests
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const presenceMemory = await import("../extensions/builtin/presence/presence-memory.ts");
const {
	getPersonaMemoryDir,
	collectMemoryHighlights,
	collectIdentityPreferenceHighlights,
	detectLanguageFromMemory,
} = presenceMemory as unknown as {
	getPersonaMemoryDir: () => string | undefined;
	collectMemoryHighlights: (state: unknown) => Promise<{ preferences: string[]; lessons: string[] }>;
	collectIdentityPreferenceHighlights: (state: unknown) => Promise<string[]>;
	detectLanguageFromMemory: (state: unknown) => Promise<"en" | "zh" | undefined>;
};

type EngineShape = {
	getAllEntries: () => Promise<{
		knowledge: Array<Record<string, unknown>>;
		lessons: Array<Record<string, unknown>>;
		events?: Array<Record<string, unknown>>;
		preferences?: Array<Record<string, unknown>>;
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
	searchHits?: Array<Record<string, unknown>>;
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
		searchEntries: async () => opts.searchHits ?? [],
	};
}

function makeState(persona?: EngineShape, global?: EngineShape): unknown {
	return {
		memEngine: global,
		personaMemEngine: persona,
		recentlyReferencedMemories: [],
	};
}

describe("getPersonaMemoryDir", () => {
	let originalEnv: string | undefined;
	let tmpDir: string;

	before(() => {
		originalEnv = process.env.NANO_PERSONA_DIR;
		tmpDir = mkdtempSync(join(tmpdir(), "catui-pm-"));
	});

	after(() => {
		if (originalEnv === undefined) delete process.env.NANO_PERSONA_DIR;
		else process.env.NANO_PERSONA_DIR = originalEnv;
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns undefined when NANO_PERSONA_DIR is unset", () => {
		delete process.env.NANO_PERSONA_DIR;
		assert.equal(getPersonaMemoryDir(), undefined);
	});

	it("returns undefined when memory subdir does not exist", () => {
		const personaDir = join(tmpDir, "no-memory");
		mkdirSync(personaDir, { recursive: true });
		process.env.NANO_PERSONA_DIR = personaDir;
		assert.equal(getPersonaMemoryDir(), undefined);
	});

	it("returns undefined when memory subdir has no canonical files", () => {
		const personaDir = join(tmpDir, "empty-memory");
		mkdirSync(join(personaDir, "memory"), { recursive: true });
		// Create some non-canonical junk so the dir exists
		writeFileSync(join(personaDir, "memory", "scratchpad.txt"), "x", "utf-8");
		process.env.NANO_PERSONA_DIR = personaDir;
		assert.equal(getPersonaMemoryDir(), undefined);
	});

	it("returns the memory path when at least one canonical file exists", () => {
		const personaDir = join(tmpDir, "with-knowledge");
		mkdirSync(join(personaDir, "memory"), { recursive: true });
		writeFileSync(join(personaDir, "memory", "knowledge.json"), "[]", "utf-8");
		process.env.NANO_PERSONA_DIR = personaDir;
		assert.equal(getPersonaMemoryDir(), join(personaDir, "memory"));
	});
});

describe("collectMemoryHighlights — persona memory first", () => {
	it("returns persona entries when only persona is configured", async () => {
		const persona = makeEngine({
			preferences: [{ name: "voice:short", type: "preference", summary: "short sentences", tags: ["preference"] }],
		});
		const out = await collectMemoryHighlights(makeState(persona));
		assert.equal(out.preferences.length, 1);
		assert.ok(out.preferences[0].includes("voice:short"));
	});

	it("returns global entries when only global is configured", async () => {
		const global = makeEngine({
			preferences: [{ name: "global_pref", type: "preference", summary: "global thing", tags: ["preference"] }],
		});
		const out = await collectMemoryHighlights(makeState(undefined, global));
		assert.equal(out.preferences.length, 1);
		assert.ok(out.preferences[0].includes("global_pref"));
	});

	it("prefers persona entries; persona wins on name conflict", async () => {
		const persona = makeEngine({
			preferences: [{
				name: "shared_pref",
				type: "preference",
				summary: "from persona",
				tags: ["preference"],
			}],
		});
		const global = makeEngine({
			preferences: [{
				name: "shared_pref",
				type: "preference",
				summary: "from global",
				tags: ["preference"],
			}],
		});
		const out = await collectMemoryHighlights(makeState(persona, global));
		assert.equal(out.preferences.length, 1, "should dedupe by name across sources");
		assert.ok(out.preferences[0].includes("from persona"), "persona should win on conflict");
	});

	it("dedupes by name (case-insensitive) across sources", async () => {
		const persona = makeEngine({
			preferences: [{ name: "Voice:Short", type: "preference", summary: "P", tags: ["preference"] }],
		});
		const global = makeEngine({
			preferences: [{ name: "voice:short", type: "preference", summary: "G", tags: ["preference"] }],
		});
		const out = await collectMemoryHighlights(makeState(persona, global));
		assert.equal(out.preferences.length, 1);
		assert.ok(out.preferences[0].includes("P"));
	});

	it("returns entries from both sources when names differ", async () => {
		const persona = makeEngine({
			preferences: [{ name: "persona_pref", type: "preference", summary: "P1", tags: ["preference"] }],
		});
		const global = makeEngine({
			preferences: [{ name: "global_pref", type: "preference", summary: "G1", tags: ["preference"] }],
		});
		const out = await collectMemoryHighlights(makeState(persona, global));
		assert.equal(out.preferences.length, 2);
		const names = out.preferences.map((p) => p.split(":")[0]).sort();
		assert.deepEqual(names, ["global_pref", "persona_pref"]);
	});

	it("persona failure does not block global", async () => {
		const persona: EngineShape = {
			getAllEntries: async () => { throw new Error("disk full"); },
			getAllEpisodes: async () => [],
			searchEntries: async () => [],
		};
		const global = makeEngine({
			preferences: [{ name: "g1", type: "preference", summary: "still here", tags: ["preference"] }],
		});
		const out = await collectMemoryHighlights(makeState(persona, global));
		assert.equal(out.preferences.length, 1);
		assert.ok(out.preferences[0].includes("still here"));
	});

	it("returns empty arrays when neither engine is configured", async () => {
		const out = await collectMemoryHighlights(makeState(undefined, undefined));
		assert.deepEqual(out, { preferences: [], lessons: [] });
	});
});

describe("collectIdentityPreferenceHighlights — persona first + cap", () => {
	it("caps output at 5 entries across both sources", async () => {
		const persona = makeEngine({
			preferences: Array.from({ length: 5 }, (_, i) => ({
				name: `p_tone_${i}`,
				type: "preference",
				summary: `persona tone ${i}`,
				tags: ["tone", "preference"],
			})),
			knowledge: Array.from({ length: 5 }, (_, i) => ({
				name: `p_call_${i}`,
				type: "preference",
				summary: `persona address ${i}`,
				tags: ["address", "preference"],
			})),
		});
		const global = makeEngine({
			preferences: Array.from({ length: 5 }, (_, i) => ({
				name: `g_tone_${i}`,
				type: "preference",
				summary: `global tone ${i}`,
				tags: ["tone", "preference"],
			})),
		});
		const out = await collectIdentityPreferenceHighlights(makeState(persona, global));
		assert.ok(out.length <= 5, `expected cap 5, got ${out.length}`);
	});

	it("prefers persona entries when both have identity preferences", async () => {
		const persona = makeEngine({
			preferences: [{
				name: "persona_tone",
				type: "preference",
				summary: "persona-locked identity",
				tags: ["tone", "preference"],
			}],
		});
		const global = makeEngine({
			preferences: [{
				name: "global_tone",
				type: "preference",
				summary: "global-evolved preference",
				tags: ["tone", "preference"],
			}],
		});
		const out = await collectIdentityPreferenceHighlights(makeState(persona, global));
		const idx = out.findIndex((line) => line.includes("persona_tone"));
		const gIdx = out.findIndex((line) => line.includes("global_tone"));
		assert.ok(idx >= 0, "persona entry should be included");
		assert.ok(gIdx < 0 || idx < gIdx, "persona entry should appear before global entry");
	});

	it("falls through to global when persona has no identity prefs", async () => {
		const persona = makeEngine({
			preferences: [{
				name: "persona_random",
				type: "preference",
				summary: "nothing to do with identity",
				tags: ["random"],
			}],
		});
		const global = makeEngine({
			preferences: [{
				name: "global_tone",
				type: "preference",
				summary: "global tone preference",
				tags: ["tone", "preference"],
			}],
		});
		const out = await collectIdentityPreferenceHighlights(makeState(persona, global));
		assert.ok(out.some((line) => line.includes("global_tone")));
	});
});

describe("detectLanguageFromMemory — persona-first priority", () => {
	it("returns undefined when no engines are configured", async () => {
		assert.equal(await detectLanguageFromMemory(makeState(undefined, undefined)), undefined);
	});

	it("returns persona signal even when global disagrees", async () => {
		const persona = makeEngine({
			preferences: [{
				name: "lang_pref",
				type: "preference",
				summary: "user prefers 中文 Chinese",
				tags: ["language", "preference"],
			}],
		});
		const global = makeEngine({
			preferences: [{
				name: "lang_pref",
				type: "preference",
				summary: "user prefers english",
				tags: ["language", "preference"],
			}],
		});
		const result = await detectLanguageFromMemory(makeState(persona, global));
		assert.equal(result, "zh", "persona preference should win over global");
	});

	it("falls back to global when persona has no language signal", async () => {
		const persona = makeEngine({
			preferences: [{ name: "other", type: "preference", summary: "unrelated", tags: ["preference"] }],
		});
		const global = makeEngine({
			preferences: [{
				name: "lang_pref",
				type: "preference",
				summary: "user prefers english",
				tags: ["language", "preference"],
			}],
		});
		const result = await detectLanguageFromMemory(makeState(persona, global));
		assert.equal(result, "en");
	});

	it("persona tie does not override global strong signal", async () => {
		const persona = makeEngine({
			preferences: [{ name: "neutral_pref", type: "preference", summary: "neutral", tags: ["preference"] }],
		});
		const global = makeEngine({
			preferences: [{
				name: "lang_pref",
				type: "preference",
				summary: "user prefers 中文",
				tags: ["language", "preference"],
			}],
		});
		const result = await detectLanguageFromMemory(makeState(persona, global));
		assert.equal(result, "zh");
	});
});
