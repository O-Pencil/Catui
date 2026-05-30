/**
 * [WHO]: Verifies recap renderer header accounting and content extraction behavior
 * [FROM]: Depends on node:test, node:assert, extensions/builtin/recap/recap-renderer, recap-types
 * [TO]: Guards the recap message renderer registered by extensions/builtin/recap/index.ts
 * [HERE]: test/recap-renderer.test.ts - focused rendering coverage for recap custom messages
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { Usage } from "@pencil-agent/ai";
import type { MessageRenderer } from "../core/extensions-host/types.js";
import { createRecapRenderer } from "../extensions/builtin/recap/recap-renderer.js";
import type { RecapEntry } from "../extensions/builtin/recap/recap-types.js";

const theme = {
	fg: (_name: string, text: string) => text,
	italic: (text: string) => text,
} as any;

function renderRecap(input: { content: unknown; details?: Partial<RecapEntry>; width?: number }): string {
	const renderer = createRecapRenderer() as MessageRenderer<Partial<RecapEntry>>;
	const component = renderer(
		{
			type: "custom",
			customType: "recap",
			content: input.content as any,
			details: input.details,
		} as any,
		{},
		theme,
	);
	return component.render(input.width ?? 120).join("\n");
}

function usage(overrides: Partial<Usage> = {}): Usage {
	return {
		input: 412,
		output: 89,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 501,
		cost: {
			input: 0.0008,
			output: 0.00125,
			cacheRead: 0,
			cacheWrite: 0,
			total: 0.00205,
		},
		...overrides,
		cost: {
			input: 0.0008,
			output: 0.00125,
			cacheRead: 0,
			cacheWrite: 0,
			total: 0.00205,
			...overrides.cost,
		},
	};
}

test("recap renderer shows free header without token accounting", () => {
	const output = renderRecap({
		content: "Focus on the remaining verification gap.",
		details: {
			source: "free",
			trigger: "manual",
			triggeredAt: 1700000000000,
		},
	});

	assert.match(output, /※ recap · free/);
	assert.match(output, /Focus on the remaining verification gap\./);
	assert.doesNotMatch(output, /in \/ .* out/);
	assert.doesNotMatch(output, /~\$/);
});

test("recap renderer shows smart usage and extracts text parts", () => {
	const output = renderRecap({
		content: [
			{ type: "text", text: "First recap line." },
			{ type: "image", data: "ignored" },
			{ type: "text", text: "Second recap line." },
		],
		details: {
			source: "smart",
			trigger: "manual",
			triggeredAt: 1700000000000,
			usage: usage(),
		},
	});

	assert.match(output, /※ recap · 412 in \/ 89 out · ~\$0\.0021/);
	assert.match(output, /First recap line\./);
	assert.match(output, /Second recap line\./);
	assert.doesNotMatch(output, /ignored/);
});
