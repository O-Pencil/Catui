/**
 * [WHO]: Footer cache hit-rate rendering tests
 * [FROM]: modes/interactive/components/footer.ts
 * [TO]: npm test focused footer cache verification
 * [HERE]: test/footer-cache-hit-rate.test.ts - interactive footer usage display regression
 */

import assert from "node:assert/strict";
import test from "node:test";
import { FooterComponent } from "../modes/interactive/components/footer.js";
import { initTheme } from "../modes/interactive/theme/theme.js";

initTheme("dark");

function stripAnsi(value: string): string {
	return value.replace(/\x1b\[[0-9;]*m/g, "");
}

function createFooter(): FooterComponent {
	const branch = [
		{
			type: "message",
			message: {
				role: "assistant",
				usage: {
					input: 600,
					output: 120,
					cacheRead: 400,
					cacheWrite: 50,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
			},
		},
	];
	const session = {
		cwd: "/tmp/catui",
		state: {
			model: { id: "test-model", contextWindow: 8192 },
			thinkingLevel: "off",
		},
		sessionManager: {
			getBranch: () => branch,
			getSessionName: () => "",
		},
		getContextUsage: () => ({
			tokens: 1000,
			contextWindow: 8192,
			percent: 12.2,
		}),
		modelRegistry: {
			isUsingOAuth: () => false,
		},
	};
	const footerData = {
		getGitBranch: () => null,
		getExtensionStatuses: () => new Map<string, string>(),
		getAvailableProviderCount: () => 1,
		onBranchChange: () => () => {},
	};
	return new FooterComponent(session as any, footerData, true);
}

test("interactive footer shows cache hit-rate percentage without a label when cache usage exists", () => {
	const footer = createFooter();
	const line = stripAnsi(footer.render(120)[0] ?? "");
	assert.match(line, /(?:^|\s)40%(?:\s|$)/);
	assert.doesNotMatch(line, /cache/i);
});
