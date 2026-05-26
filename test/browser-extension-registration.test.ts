/**
 * [WHO]: Verifies built-in extension registry path and risk metadata invariants
 * [FROM]: Depends on node:test, node:fs, node:path, builtin-extensions
 * [TO]: Consumed by extension registry verification commands
 * [HERE]: test/browser-extension-registration.test.ts - registry policy tests
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { builtInExtensions, getBuiltinExtensionPaths } from "../builtin-extensions.ts";

test("builtin extensions include browser harness", () => {
	const paths = getBuiltinExtensionPaths();
	assert.ok(
		paths.some((entry) => entry.includes("extensions") && entry.includes("defaults") && entry.includes("browser")),
		`Expected browser extension in builtin paths, got: ${paths.join(", ")}`,
	);
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
	const defaultDirectories = readdirSync(join(process.cwd(), "extensions", "defaults"))
		.filter((entry) => statSync(join(process.cwd(), "extensions", "defaults", entry)).isDirectory());

	for (const directory of defaultDirectories) {
		assert.ok(metadataIds.has(directory), `Missing built-in extension metadata for extensions/defaults/${directory}.`);
	}
});

test("default-enabled metadata is represented by builtin load paths", () => {
	const paths = getBuiltinExtensionPaths();
	const normalizedPathText = paths.join("\n");
	const defaultMetadata = builtInExtensions.filter((extension) => extension.category === "default" && extension.defaultEnabled);

	for (const extension of defaultMetadata) {
		const pathSegment = `${sep}extensions${sep}defaults${sep}${extension.id}${sep}`;
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
