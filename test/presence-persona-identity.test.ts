/**
 * [WHO]: Tests for loadPersonaIdentity + persona-locked presence system prompt
 * [FROM]: Depends on extensions/builtin/presence, node:test, node:fs
 * [TO]: Run via `node --test --import tsx test/presence-persona-identity.test.ts`
 * [HERE]: test/presence-persona-identity.test.ts — stage 1 unit tests
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
		personaLinesMatchLocale: (lines: readonly string[], locale: "en" | "zh") => boolean;
		getFallbackOpeningLines: (locale?: "en" | "zh") => string[];
		getFallbackIdleLines: (locale?: "en" | "zh") => string[];
		buildPresenceSystemPrompt: (
			locale: "en" | "zh",
			soulHints: unknown,
			kind: "opening" | "idle",
		) => string;
	};
};

const SAMPLE_CATUI = `# Vex

做事一针见血，说话带刺但句句在理。

## Identity

你叫 Vex。一个技术极强但嘴上不饶人的搭档。

- 语气像一个被拉去救火三次的老工程师
- 嘲讽是你的母语，但能力是你说话的底气

## Tone

默认语气：冷、快、准。

- 短句优先
- 反问句是好朋友
- 用户犯蠢时直接指出

## Working Style

- 先动手再说话
- 多个方案时直接推荐最优解

## Example Interactions

用户：帮我加个功能
你：什么功能。说清楚。

## Presence

### Opening Lines

- 又来了。说吧。
- 有事说事。
`;

describe("loadPersonaIdentity", () => {
	let originalEnv: string | undefined;
	let tmpDir: string;

	before(() => {
		originalEnv = process.env.NANO_PERSONA_DIR;
		tmpDir = mkdtempSync(join(tmpdir(), "catui-persona-"));
	});

	after(() => {
		if (originalEnv === undefined) {
			delete process.env.NANO_PERSONA_DIR;
		} else {
			process.env.NANO_PERSONA_DIR = originalEnv;
		}
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns empty string when NANO_PERSONA_DIR is unset", () => {
		delete process.env.NANO_PERSONA_DIR;
		assert.equal(__testUtils.loadPersonaIdentity(), "");
	});

	it("returns empty string when CATUI.md is missing", () => {
		process.env.NANO_PERSONA_DIR = join(tmpDir, "nonexistent");
		assert.equal(__testUtils.loadPersonaIdentity(), "");
	});

	it("returns empty string when persona has no Identity/Tone/Working Style sections", () => {
		const personaDir = join(tmpDir, "minimal");
		mkdirSync(personaDir, { recursive: true });
		writeFileSync(
			join(personaDir, "CATUI.md"),
			"# Minimal\n\nJust a name. No sections.\n",
			"utf-8",
		);
		process.env.NANO_PERSONA_DIR = personaDir;
		assert.equal(__testUtils.loadPersonaIdentity(), "");
	});

	it("extracts Identity/Tone/Working Style blocks in order", () => {
		const personaDir = join(tmpDir, "vex");
		mkdirSync(personaDir, { recursive: true });
		writeFileSync(join(personaDir, "CATUI.md"), SAMPLE_CATUI, "utf-8");
		process.env.NANO_PERSONA_DIR = personaDir;

		const out = __testUtils.loadPersonaIdentity();
		assert.ok(out.includes("## Identity"), "should include Identity heading");
		assert.ok(out.includes("## Tone"), "should include Tone heading");
		assert.ok(out.includes("## Working Style"), "should include Working Style heading");
		assert.ok(out.includes("Vex"), "should include content body");
	});

	it("does NOT include Example Interactions content", () => {
		const personaDir = join(tmpDir, "vex");
		mkdirSync(personaDir, { recursive: true });
		writeFileSync(join(personaDir, "CATUI.md"), SAMPLE_CATUI, "utf-8");
		process.env.NANO_PERSONA_DIR = personaDir;

		const out = __testUtils.loadPersonaIdentity();
		assert.ok(!out.includes("什么功能。说清楚"), "should not leak Example Interactions dialogue");
	});

	it("does NOT include Presence section (handled separately by getPersonaPresenceLines)", () => {
		const personaDir = join(tmpDir, "vex");
		mkdirSync(personaDir, { recursive: true });
		writeFileSync(join(personaDir, "CATUI.md"), SAMPLE_CATUI, "utf-8");
		process.env.NANO_PERSONA_DIR = personaDir;

		const out = __testUtils.loadPersonaIdentity();
		assert.ok(!out.includes("## Presence"), "Presence block should not be in identity output");
		assert.ok(!out.includes("Opening Lines"), "Opening Lines should not be in identity output");
	});

	it("truncates output when persona identity exceeds max chars", () => {
		const huge = "## Identity\n" + "x".repeat(2000) + "\n\n## Tone\nshort\n";
		const personaDir = join(tmpDir, "huge");
		mkdirSync(personaDir, { recursive: true });
		writeFileSync(join(personaDir, "CATUI.md"), huge, "utf-8");
		process.env.NANO_PERSONA_DIR = personaDir;

		const out = __testUtils.loadPersonaIdentity();
		assert.ok(out.length <= 1300, `expected truncation, got length ${out.length}`);
		assert.ok(out.endsWith("…"), "truncated output should end with ellipsis");
	});
});

describe("personaLinesMatchLocale", () => {
	it("returns true for Chinese-heavy lines on zh locale", () => {
		assert.equal(
			__testUtils.personaLinesMatchLocale(["又来了。说吧。", "有事说事。"], "zh"),
			true,
		);
	});

	it("returns false for Chinese-only lines on en locale", () => {
		assert.equal(
			__testUtils.personaLinesMatchLocale(["又来了。说吧。", "有事说事。"], "en"),
			false,
		);
	});

	it("returns true for Latin-heavy lines on en locale", () => {
		assert.equal(
			__testUtils.personaLinesMatchLocale(["Hey, ready when you are.", "Sure."], "en"),
			true,
		);
	});

	it("returns false for Latin-only lines on zh locale", () => {
		assert.equal(
			__testUtils.personaLinesMatchLocale(["Hey, ready when you are.", "Sure."], "zh"),
			false,
		);
	});

	it("returns false for empty line list", () => {
		assert.equal(__testUtils.personaLinesMatchLocale([], "en"), false);
		assert.equal(__testUtils.personaLinesMatchLocale([], "zh"), false);
	});
});

describe("getFallbackOpeningLines / getFallbackIdleLines locale match", () => {
	let originalEnv: string | undefined;
	let tmpDir: string;

	before(() => {
		originalEnv = process.env.NANO_PERSONA_DIR;
		tmpDir = mkdtempSync(join(tmpdir(), "catui-fallback-"));
	});

	after(() => {
		if (originalEnv === undefined) delete process.env.NANO_PERSONA_DIR;
		else process.env.NANO_PERSONA_DIR = originalEnv;
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("falls through to i18n when persona is Chinese-only and locale is en", () => {
		const personaDir = join(tmpDir, "vex");
		mkdirSync(personaDir, { recursive: true });
		writeFileSync(join(personaDir, "CATUI.md"), SAMPLE_CATUI, "utf-8");
		process.env.NANO_PERSONA_DIR = personaDir;

		const out = __testUtils.getFallbackOpeningLines("en");
		assert.ok(out.length > 0);
		const hasChinese = out.some((l) => /[一-鿿]/.test(l));
		assert.equal(hasChinese, false, `en fallback should not contain Chinese, got: ${out.join(" | ")}`);
	});

	it("uses persona lines when persona is Chinese-only and locale is zh", () => {
		const personaDir = join(tmpDir, "vex");
		mkdirSync(personaDir, { recursive: true });
		writeFileSync(join(personaDir, "CATUI.md"), SAMPLE_CATUI, "utf-8");
		process.env.NANO_PERSONA_DIR = personaDir;

		const out = __testUtils.getFallbackOpeningLines("zh");
		assert.ok(out.some((l) => l.includes("说")), "should include Chinese persona line");
	});
});
