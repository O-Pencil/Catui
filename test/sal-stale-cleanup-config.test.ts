import assert from "node:assert/strict";
import test from "node:test";
import { resolveStaleCleanupEnabled } from "../extensions/builtin/sal/index.js";

test("sal stale cleanup: defaults to disabled", () => {
	assert.equal(resolveStaleCleanupEnabled(undefined, undefined), false);
	assert.equal(resolveStaleCleanupEnabled(undefined, { cleanup_stale_runs: false }), false);
});

test("sal stale cleanup: can be enabled by credentials or env override", () => {
	assert.equal(resolveStaleCleanupEnabled(undefined, { cleanup_stale_runs: true }), true);
	assert.equal(resolveStaleCleanupEnabled("1", { cleanup_stale_runs: false }), true);
	assert.equal(resolveStaleCleanupEnabled("true", undefined), true);
});

test("sal stale cleanup: env can force-disable credentials opt-in", () => {
	assert.equal(resolveStaleCleanupEnabled("0", { cleanup_stale_runs: true }), false);
	assert.equal(resolveStaleCleanupEnabled("false", { cleanup_stale_runs: true }), false);
});
