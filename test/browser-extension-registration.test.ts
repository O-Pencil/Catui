import test from "node:test";
import assert from "node:assert/strict";
import { getBuiltinExtensionPaths } from "../builtin-extensions.ts";

test("builtin extensions include browser harness", () => {
	const paths = getBuiltinExtensionPaths();
	assert.ok(
		paths.some((entry) => entry.includes("extensions") && entry.includes("defaults") && entry.includes("browser")),
		`Expected browser extension in builtin paths, got: ${paths.join(", ")}`,
	);
});
