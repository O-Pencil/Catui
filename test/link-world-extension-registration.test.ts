import test from "node:test";
import assert from "node:assert/strict";
import { getBuiltinExtensionPaths } from "../builtin-extensions.ts";

test("builtin extensions include link-world", () => {
	const paths = getBuiltinExtensionPaths();
	assert.ok(
		paths.some((entry) => entry.includes("extensions") && entry.includes("defaults") && entry.includes("link-world")),
		`Expected link-world extension in builtin paths, got: ${paths.join(", ")}`,
	);
});
