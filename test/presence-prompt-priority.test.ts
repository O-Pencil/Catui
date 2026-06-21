/**
 * [WHO]: Tests for buildPresenceSystemPrompt priority labeling after persona-locked refactor
 * [FROM]: Depends on extensions/builtin/presence, node:test, node:fs
 * [TO]: Run via `node --test --import tsx test/presence-prompt-priority.test.ts`
 * [HERE]: test/presence-prompt-priority.test.ts — stage 1.2 prompt structure tests
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const presenceModule = await import("../extensions/builtin/presence/index.ts");
const { __testUtils } = presenceModule as unknown as {
	__testUtils: {
		loadPersonaIdentity: () => string;
		buildPresenceSystemPrompt: (
			locale: "en" | "zh",
			soulHints: unknown,
			kind: "opening" | "idle",
		) => string;
	};
};

const VEX_CATUI = `# Vex

## Identity

你叫 Vex。一个技术极强但嘴上不饶人的搭档。

- 嘲讽是你的母语，但能力是你说话的底气

## Tone

默认语气：冷、快、准。

- 短句优先。能三个字说完的别用三十个字
- 任何形式的 emoji（除非用户先用）

## Working Style

- 先动手再说话
`;

describe("buildPresenceSystemPrompt — priority labels", () => {
	let originalEnv: string | undefined;
	let tmpDir: string;

	before(() => {
		originalEnv = process.env.NANO_PERSONA_DIR;
		tmpDir = mkdtempSync(join(tmpdir(), "catui-priority-"));
	});

	after(() => {
		if (originalEnv === undefined) delete process.env.NANO_PERSONA_DIR;
		else process.env.NANO_PERSONA_DIR = originalEnv;
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("includes persona-locked highest-priority block when persona is present", () => {
		const personaDir = join(tmpDir, "vex");
		mkdirSync(personaDir, { recursive: true });
		writeFileSync(join(personaDir, "CATUI.md"), VEX_CATUI, "utf-8");
		process.env.NANO_PERSONA_DIR = personaDir;

		const out = __testUtils.buildPresenceSystemPrompt(
			"zh",
			{ traits: [], identityPreferences: [] },
			"opening",
		);

		assert.ok(
			out.includes("highest priority, persona-locked"),
			"should mark persona block as highest priority",
		);
		assert.ok(out.includes("Vex"), "should include persona identity body");
		assert.ok(
			out.includes("先遵守 persona 锁定的人格"),
			"should explicitly state persona comes first",
		);
	});

	it("labels soul identity preferences as medium priority (中优先级)", () => {
		const personaDir = join(tmpDir, "vex");
		mkdirSync(personaDir, { recursive: true });
		writeFileSync(join(personaDir, "CATUI.md"), VEX_CATUI, "utf-8");
		process.env.NANO_PERSONA_DIR = personaDir;

		const soulHints = {
			traits: ["agreeableness:0.60"],
			identityPreferences: ["preferred_tone: poetic / 古典 phrasing"],
		};
		const out = __testUtils.buildPresenceSystemPrompt("zh", soulHints, "opening");

		assert.ok(
			out.includes("中优先级") && out.includes("Soul 演化"),
			"soul identity should be labeled medium priority",
		);
		assert.ok(
			!out.includes("必须遵守这些身份"),
			"old 'must follow' absolute language must be removed",
		);
	});

	it("soul traits use medium-priority label not 'personality tilt' as sole framing", () => {
		const personaDir = join(tmpDir, "vex");
		mkdirSync(personaDir, { recursive: true });
		writeFileSync(join(personaDir, "CATUI.md"), VEX_CATUI, "utf-8");
		process.env.NANO_PERSONA_DIR = personaDir;

		const soulHints = {
			traits: ["agreeableness:0.60", "conscientiousness:0.60"],
			identityPreferences: [],
		};
		const out = __testUtils.buildPresenceSystemPrompt("zh", soulHints, "opening");

		assert.ok(
			out.includes("Soul 人格倾向（中优先级，参考）"),
			"soul traits should be labeled medium priority in zh",
		);
	});

	it("works without persona — falls back to soul-only prompt gracefully", () => {
		delete process.env.NANO_PERSONA_DIR;

		const out = __testUtils.buildPresenceSystemPrompt(
			"en",
			{ traits: ["openness:0.5"], identityPreferences: [] },
			"opening",
		);

		assert.ok(
			!out.includes("[Persona Identity"),
			"should not include persona block when persona missing",
		);
		assert.ok(out.includes("Generate one brief, natural opening greeting"));
	});

	it("english locale uses 'Soul-evolved preferences (medium priority, follow when not conflicting with persona)'", () => {
		const personaDir = join(tmpDir, "vex");
		mkdirSync(personaDir, { recursive: true });
		writeFileSync(join(personaDir, "CATUI.md"), VEX_CATUI, "utf-8");
		process.env.NANO_PERSONA_DIR = personaDir;

		const out = __testUtils.buildPresenceSystemPrompt(
			"en",
			{ traits: [], identityPreferences: ["preferred_tone: poetic"] },
			"opening",
		);

		assert.ok(
			out.includes("medium priority, follow when not conflicting with persona"),
			"english soul-evolved label should match new copy",
		);
		assert.ok(
			out.includes("Follow the persona-locked identity first"),
			"english should direct model to follow persona first",
		);
	});

	it("idle prompts also receive persona block", () => {
		const personaDir = join(tmpDir, "vex");
		mkdirSync(personaDir, { recursive: true });
		writeFileSync(join(personaDir, "CATUI.md"), VEX_CATUI, "utf-8");
		process.env.NANO_PERSONA_DIR = personaDir;

		const out = __testUtils.buildPresenceSystemPrompt(
			"zh",
			{ traits: [], identityPreferences: [] },
			"idle",
		);

		assert.ok(out.includes("轻声、不打扰"));
		assert.ok(out.includes("persona-locked"));
	});
});
