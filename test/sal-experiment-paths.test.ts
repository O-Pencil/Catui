import assert from "node:assert/strict";
import test from "node:test";
import { normalizeExperimentId, resolveSalAbEnabled, resolveSalSidecarDir } from "../extensions/builtin/sal/index.js";

test("sal experiment: normalizes experiment ids into safe path segments", () => {
	assert.equal(normalizeExperimentId(undefined), undefined);
	assert.equal(normalizeExperimentId(""), undefined);
	assert.equal(normalizeExperimentId("  image-flow-001  "), "image-flow-001");
	assert.equal(normalizeExperimentId("image flow/001"), "image-flow-001");
	assert.equal(normalizeExperimentId("***"), "run");
});

test("sal experiment: uses legacy anchor directory when no experiment id is provided", () => {
	assert.equal(resolveSalSidecarDir("/repo/project"), "/repo/project/.memory-experiments/sal/anchors");
});

test("sal experiment: exports anchors into a run-local directory when experiment id is set", () => {
	assert.equal(
		resolveSalSidecarDir("/repo/project", "image-flow-001"),
		"/repo/project/.memory-experiments/runs/image-flow-001/sal/anchors",
	);
	assert.equal(
		resolveSalSidecarDir("/repo/project", "image flow/001"),
		"/repo/project/.memory-experiments/runs/image-flow-001/sal/anchors",
	);
});

test("sal experiment: sidecar output is disabled unless flag or env enables A/B mode", () => {
	const prev = process.env.NANOPENCIL_SAL_AB;
	try {
		delete process.env.NANOPENCIL_SAL_AB;
		assert.equal(resolveSalAbEnabled(false), false);
		assert.equal(resolveSalAbEnabled(true), true);

		process.env.NANOPENCIL_SAL_AB = "1";
		assert.equal(resolveSalAbEnabled(false), true);
	} finally {
		if (prev === undefined) {
			delete process.env.NANOPENCIL_SAL_AB;
		} else {
			process.env.NANOPENCIL_SAL_AB = prev;
		}
	}
});
