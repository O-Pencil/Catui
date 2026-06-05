/**
 * [WHO]: Verifies built-in extension registry path and risk metadata invariants
 * [FROM]: Depends on node:test, node:fs, node:path, builtin-extensions, core/slash-commands
 * [TO]: Consumed by extension registry verification commands
 * [HERE]: test/browser-extension-registration.test.ts - registry policy tests
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { builtInExtensions, getBuiltinExtensionPaths } from "../builtin-extensions.ts";
import { BUILTIN_SLASH_COMMANDS } from "../core/slash-commands.ts";

test("browser harness is opt-in, not loaded by default (P6/EV03)", () => {
	const paths = getBuiltinExtensionPaths();
	assert.ok(
		!paths.some((entry) => entry.includes("browser")),
		`Expected browser to be opt-in (absent from default load paths), got: ${paths.join(", ")}`,
	);
	const browser = builtInExtensions.find((extension) => extension.id === "browser");
	assert.ok(browser, "Expected browser to remain registered in metadata.");
	assert.equal(browser?.category, "optional", "browser must be an optional capability.");
	assert.equal(browser?.defaultEnabled, false, "browser must require explicit opt-in.");
});

test("browser keeps a lightweight slash fallback while full extension is opt-in", () => {
	const command = BUILTIN_SLASH_COMMANDS.find((entry) => entry.name === "browser");
	assert.ok(command, "Expected /browser fallback command to remain discoverable.");
	assert.equal(command?.implementation, "extension", "/browser should yield to the full browser extension when it is loaded.");
	assert.equal(command?.category, "tools", "/browser should stay grouped with tool commands.");
});

test("optional extensions are not loaded by default", () => {
	const paths = getBuiltinExtensionPaths();
	assert.ok(
		!paths.some((entry) => entry.includes("extensions") && entry.includes("optional")),
		`Expected optional extensions to require explicit opt-in, got: ${paths.join(", ")}`,
	);
});

test("extension metadata keeps optional and write-capable extensions out of defaults", () => {
	const optionalExtensions = builtInExtensions.filter((extension) => extension.category === "optional");
	assert.ok(optionalExtensions.length > 0, "Expected optional extensions to be represented in metadata.");
	for (const extension of optionalExtensions) {
		assert.equal(extension.defaultEnabled, false, `${extension.id} must require explicit opt-in.`);
	}

	const defaultEnabled = builtInExtensions.filter((extension) => extension.defaultEnabled);
	for (const extension of defaultEnabled) {
		assert.notEqual(extension.riskLevel, "write-capable", `${extension.id} is default-enabled but write-capable.`);
		assert.equal(extension.writesWorkspace, false, `${extension.id} is default-enabled but writes workspace files.`);
	}
});

test("default extension directories are represented in metadata", () => {
	const metadataIds = new Set(builtInExtensions.map((extension) => extension.id));
	const defaultDirectories = readdirSync(join(process.cwd(), "extensions", "builtin"))
		.filter((entry) => statSync(join(process.cwd(), "extensions", "builtin", entry)).isDirectory());

	for (const directory of defaultDirectories) {
		assert.ok(metadataIds.has(directory), `Missing built-in extension metadata for extensions/builtin/${directory}.`);
	}
});

test("default-enabled metadata is represented by builtin load paths", () => {
	const paths = getBuiltinExtensionPaths();
	const normalizedPathText = paths.join("\n");
	const defaultMetadata = builtInExtensions.filter((extension) => extension.category === "default" && extension.defaultEnabled);

	for (const extension of defaultMetadata) {
		const pathSegment = `${sep}extensions${sep}builtin${sep}${extension.id}${sep}`;
		assert.ok(
			normalizedPathText.includes(pathSegment),
			`Expected default-enabled extension metadata for ${extension.id} to have a matching load path. Paths: ${paths.join(", ")}`,
		);
	}
});

test("published package includes vendored browser harness Python files", () => {
	const packageJson = JSON.parse(readFileSync("package.json", "utf-8")) as { files?: string[] };
	assert.ok(
		packageJson.files?.includes("dist/**/*.py"),
		"Expected npm files whitelist to include dist/**/*.py so browser_harness is published.",
	);
});
