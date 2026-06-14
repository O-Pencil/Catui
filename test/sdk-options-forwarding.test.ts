import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// These tests verify that CreateAgentSessionOptions fields are properly
// wired through to their respective subsystems. We verify this by reading
// the source code of sdk.ts and checking the forwarding patterns, since
// instantiating createAgentSession requires a full runtime setup.

const SDK_PATH = join(import.meta.dirname ?? ".", "..", "core", "runtime", "sdk.ts");
const sdkSource = readFileSync(SDK_PATH, "utf-8");

// ── CreateAgentSessionOptions interface ────────────────────────────────────

test("CreateAgentSessionOptions declares additionalSkillPaths", () => {
	assert.ok(
		sdkSource.includes("additionalSkillPaths?: string[]"),
		"additionalSkillPaths should be declared in CreateAgentSessionOptions",
	);
});

test("CreateAgentSessionOptions declares additionalAgentDirs", () => {
	assert.ok(
		sdkSource.includes("additionalAgentDirs?: string[]"),
		"additionalAgentDirs should be declared in CreateAgentSessionOptions",
	);
});

test("CreateAgentSessionOptions declares mcpConfigPath", () => {
	assert.ok(
		sdkSource.includes("mcpConfigPath?: string"),
		"mcpConfigPath should be declared in CreateAgentSessionOptions",
	);
});

test("CreateAgentSessionOptions declares debugLevel", () => {
	assert.ok(
		sdkSource.includes('debugLevel?: "off" | "basic" | "verbose"'),
		"debugLevel should be declared in CreateAgentSessionOptions",
	);
});

// ── additionalSkillPaths forwarded to DefaultResourceLoader ────────────────

test("additionalSkillPaths is forwarded to DefaultResourceLoader constructor", () => {
	// Find the non-JSDoc DefaultResourceLoader creation (the actual constructor call)
	const lines = sdkSource.split("\n");
	let inConstructor = false;
	let constructorBlock = "";
	for (const line of lines) {
		if (line.includes("resourceLoader = new DefaultResourceLoader({")) {
			inConstructor = true;
			constructorBlock = line;
			continue;
		}
		if (inConstructor) {
			constructorBlock += "\n" + line;
			if (line.includes("});")) {
				break;
			}
		}
	}
	assert.ok(inConstructor, "DefaultResourceLoader constructor call should exist");
	assert.ok(
		constructorBlock.includes("additionalSkillPaths: options.additionalSkillPaths"),
		"additionalSkillPaths should be forwarded to DefaultResourceLoader",
	);
});

// ── additionalAgentDirs forwarded to DefaultResourceLoader ─────────────────

test("additionalAgentDirs is forwarded to DefaultResourceLoader constructor", () => {
	const lines = sdkSource.split("\n");
	let inConstructor = false;
	let constructorBlock = "";
	for (const line of lines) {
		if (line.includes("resourceLoader = new DefaultResourceLoader({")) {
			inConstructor = true;
			constructorBlock = line;
			continue;
		}
		if (inConstructor) {
			constructorBlock += "\n" + line;
			if (line.includes("});")) {
				break;
			}
		}
	}
	assert.ok(inConstructor, "DefaultResourceLoader constructor call should exist");
	assert.ok(
		constructorBlock.includes("additionalAgentDirs: options.additionalAgentDirs"),
		"additionalAgentDirs should be forwarded to DefaultResourceLoader",
	);
});

// ── mcpConfigPath forwarded to MCPManager ──────────────────────────────────

test("mcpConfigPath is forwarded to MCPManager constructor", () => {
	assert.ok(
		sdkSource.includes("new MCPManager({ mcpConfigPath: options.mcpConfigPath })"),
		"mcpConfigPath should be forwarded to MCPManager",
	);
});

// ── debugLevel forwarded to AgentSession ───────────────────────────────────

test("debugLevel is forwarded to AgentSession constructor config", () => {
	assert.ok(
		sdkSource.includes("debugLevel: options.debugLevel"),
		"debugLevel should be forwarded to AgentSession",
	);
});

// ── wiring completeness: all 4 new options appear in the function body ──────

test("all 4 new SDK options are referenced in createAgentSession body", () => {
	const options = [
		"options.additionalSkillPaths",
		"options.additionalAgentDirs",
		"options.mcpConfigPath",
		"options.debugLevel",
	];

	for (const opt of options) {
		assert.ok(
			sdkSource.includes(opt),
			`${opt} should be referenced in createAgentSession`,
		);
	}
});
