import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("release builds use the committed model catalog without remote regeneration", async () => {
	const rawManifest: unknown = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
	assert.ok(typeof rawManifest === "object" && rawManifest !== null && "scripts" in rawManifest);
	const scripts = rawManifest.scripts;
	assert.ok(typeof scripts === "object" && scripts !== null && "build:release" in scripts);
	assert.equal(scripts["build:release"], "npm run build");
});
