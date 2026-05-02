import assert from "node:assert/strict";
import test from "node:test";

import { reportDiagnostic as reportCoreDiagnostic } from "../utils/diagnostics.js";
import { reportDiagnostic as reportMemDiagnostic } from "../packages/mem-core/src/diagnostics.js";
import { reportDiagnostic as reportSoulDiagnostic } from "../packages/soul-core/src/diagnostics.js";

type EnvSnapshot = {
	NODE_ENV?: string;
	NANOPENCIL_DEBUG?: string;
	npm_lifecycle_event?: string;
};

function snapshotEnv(): EnvSnapshot {
	return {
		NODE_ENV: process.env.NODE_ENV,
		NANOPENCIL_DEBUG: process.env.NANOPENCIL_DEBUG,
		npm_lifecycle_event: process.env.npm_lifecycle_event,
	};
}

function restoreEnv(snapshot: EnvSnapshot): void {
	for (const key of Object.keys(snapshot) as Array<keyof EnvSnapshot>) {
		const value = snapshot[key];
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
}

function clearDevEnv(): EnvSnapshot {
	const snapshot = snapshotEnv();
	delete process.env.NODE_ENV;
	delete process.env.NANOPENCIL_DEBUG;
	delete process.env.npm_lifecycle_event;
	return snapshot;
}

test("diagnostics stay silent unless dev/debug mode is explicit", () => {
	const env = clearDevEnv();
	const originalWarn = console.warn;
	const lines: string[] = [];
	console.warn = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };

	try {
		reportCoreDiagnostic({
			source: "test.core",
			severity: "warning",
			category: "fallback",
			message: "core warning",
		});
		reportMemDiagnostic({
			source: "test.mem",
			severity: "warning",
			category: "fallback",
			message: "mem warning",
		});
		reportSoulDiagnostic({
			source: "test.soul",
			severity: "warning",
			category: "fallback",
			message: "soul warning",
		});
	} finally {
		console.warn = originalWarn;
		restoreEnv(env);
	}

	assert.deepEqual(lines, []);
});

test("diagnostics print when NANOPENCIL_DEBUG is enabled", () => {
	const env = clearDevEnv();
	process.env.NANOPENCIL_DEBUG = "1";
	const originalWarn = console.warn;
	const lines: string[] = [];
	console.warn = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };

	try {
		reportCoreDiagnostic({
			source: "test.core",
			severity: "warning",
			category: "fallback",
			message: "debug-visible warning",
		});
	} finally {
		console.warn = originalWarn;
		restoreEnv(env);
	}

	assert.equal(lines.length, 1);
	assert.match(lines[0] ?? "", /\[test\.core\] debug-visible warning/);
});
