import assert from "node:assert/strict";
import test from "node:test";

import { getConfig } from "../packages/mem-core/src/config.js";
import { extractMemories, extractWork } from "../packages/mem-core/src/extraction.js";
import { subscribeDiagnostics } from "../utils/diagnostics.js";
import type { DiagnosticEvent } from "../utils/diagnostics.js";

test("NanoMem memory extraction retries non-JSON LLM output before fallback diagnostics", async () => {
	const captured: DiagnosticEvent[] = [];
	const unsubscribe = subscribeDiagnostics((event) => {
		if (event.source === "mem-core.extract") captured.push(event);
	});
	let calls = 0;

	try {
		const items = await extractMemories(
			"user: fixed a CORS issue by using an exact origin\nassistant: noted the fix",
			getConfig({ locale: "en" }),
			async () => {
				calls += 1;
				return calls === 1
					? "好的，继续做 MCP 延迟初始化！"
					: '[{"type":"lesson","name":"CORS exact origin","summary":"Credentials require exact CORS origin","detail":"Fixed CORS by using an exact origin instead of wildcard."}]';
			},
		);

		assert.equal(calls, 2);
		assert.equal(items.length, 1);
		assert.equal(items[0]?.type, "lesson");
		assert.equal(captured.length, 0);
	} finally {
		unsubscribe();
	}
});

test("NanoMem work extraction retries non-JSON LLM output before fallback diagnostics", async () => {
	const captured: DiagnosticEvent[] = [];
	const unsubscribe = subscribeDiagnostics((event) => {
		if (event.source === "mem-core.extract") captured.push(event);
	});
	let calls = 0;

	try {
		const work = await extractWork(
			"user: reduce startup latency\nassistant: implemented MCP lazy initialization and measured startup",
			getConfig({ locale: "en" }),
			async () => {
				calls += 1;
				return calls === 1
					? "好的，继续做 **MCP 延迟初始化**！"
					: '{"goal":"reduce startup latency","summary":"Implemented MCP lazy initialization","detail":"MCP startup is deferred until first tool use."}';
			},
		);

		assert.equal(calls, 2);
		assert.equal(work?.summary, "Implemented MCP lazy initialization");
		assert.equal(captured.length, 0);
	} finally {
		unsubscribe();
	}
});
