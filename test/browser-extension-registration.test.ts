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

test("TokenSave is removed from builtin extension metadata and default paths", () => {
	const paths = getBuiltinExtensionPaths();
	assert.equal(builtInExtensions.some((extension) => extension.id === "token-save"), false);
	assert.equal(paths.some((entry) => entry.includes("token-save")), false);
});

test("browser harness is opt-in, not loaded by default (P6/EV03)", () => {
	const previous = process.env.CATUI_ENABLE_BROWSER_EXTENSION;
	try {
		delete process.env.CATUI_ENABLE_BROWSER_EXTENSION;
		const paths = getBuiltinExtensionPaths();
		assert.ok(
			!paths.some((entry) => entry.includes("browser")),
			`Expected browser to be opt-in (absent from default load paths), got: ${paths.join(", ")}`,
		);
		const browser = builtInExtensions.find((extension) => extension.id === "browser");
		assert.ok(browser, "Expected browser to remain registered in metadata.");
		assert.equal(browser?.category, "optional", "browser must be an optional capability.");
		assert.equal(browser?.defaultEnabled, false, "browser must require explicit opt-in.");
	} finally {
		if (previous === undefined) {
			delete process.env.CATUI_ENABLE_BROWSER_EXTENSION;
		} else {
			process.env.CATUI_ENABLE_BROWSER_EXTENSION = previous;
		}
	}
});

test("browser harness can be enabled for non-interactive benchmark harnesses by env", () => {
	const previous = process.env.CATUI_ENABLE_BROWSER_EXTENSION;
	try {
		process.env.CATUI_ENABLE_BROWSER_EXTENSION = "1";
		const paths = getBuiltinExtensionPaths();
		assert.ok(
			paths.some((entry) => entry.includes(`${sep}extensions${sep}builtin${sep}browser${sep}`)),
			`Expected env-enabled browser extension path, got: ${paths.join(", ")}`,
		);
	} finally {
		if (previous === undefined) {
			delete process.env.CATUI_ENABLE_BROWSER_EXTENSION;
		} else {
			process.env.CATUI_ENABLE_BROWSER_EXTENSION = previous;
		}
	}
});

test("browser keeps a lightweight slash fallback while full extension is opt-in", () => {
	const command = BUILTIN_SLASH_COMMANDS.find((entry) => entry.name === "browser");
	assert.ok(command, "Expected /browser fallback command to remain discoverable.");
	assert.equal(command?.implementation, "extension", "/browser should yield to the full browser extension when it is loaded.");
	assert.equal(command?.category, "tools", "/browser should stay grouped with tool commands.");
});

test("only product-approved optional extensions are loaded by default", () => {
	const paths = getBuiltinExtensionPaths();
	const defaultOptionalIds = new Set(["evolution"]);
	const unexpectedDefaultOptionalPaths = paths.filter((entry) =>
		entry.includes("extensions") &&
		entry.includes("optional") &&
		![...defaultOptionalIds].some((id) => entry.includes(`${sep}optional${sep}${id}${sep}`))
	);
	assert.ok(
		unexpectedDefaultOptionalPaths.length === 0,
		`Expected only approved optional extensions to load by default, got: ${unexpectedDefaultOptionalPaths.join(", ")}`,
	);
	assert.ok(
		paths.some((entry) => entry.includes(`${sep}extensions${sep}optional${sep}evolution${sep}`)),
		`Expected evolution to be default-loaded after product approval, got: ${paths.join(", ")}`,
	);
});

test("extension metadata keeps unapproved optional and write-capable extensions out of defaults", () => {
	const optionalExtensions = builtInExtensions.filter((extension) => extension.category === "optional");
	const defaultOptionalIds = new Set(["evolution"]);
	assert.ok(optionalExtensions.length > 0, "Expected optional extensions to be represented in metadata.");
	for (const extension of optionalExtensions) {
		assert.equal(extension.defaultEnabled, defaultOptionalIds.has(extension.id), `${extension.id} defaultEnabled policy mismatch.`);
	}

	const defaultEnabledOptional = builtInExtensions.filter((extension) => extension.category === "optional" && extension.defaultEnabled);
	for (const extension of defaultEnabledOptional) {
		assert.notEqual(extension.riskLevel, "write-capable", `${extension.id} is default-enabled but write-capable.`);
		assert.equal(extension.writesWorkspace, false, `${extension.id} is default-enabled but writes workspace files.`);
	}
});

test("evolution self-evolution is product-approved for default load", () => {
	const evolution = builtInExtensions.find((extension) => extension.id === "evolution");
	assert.ok(evolution, "Expected evolution metadata.");
	assert.equal(evolution?.category, "optional", "Evolution source remains under optional while default policy is explicit.");
	assert.equal(evolution?.defaultEnabled, true, "Evolution should load by default after product approval.");
	assert.equal(evolution?.riskLevel, "background");
	assert.equal(evolution?.startsTimers, false, "Default-loaded evolution must stay idle unless used.");
	assert.equal(evolution?.writesWorkspace, false, "Default-loaded evolution must not write workspace files.");
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
