/**
 * [WHO]: Proves the live evolution refine path redacts session evidence before it reaches a model
 * [FROM]: Depends on node:test/assert, the real refiner, and a fake completion API that records prompts
 * [TO]: Consumed by test:evolution; closes the S05.4 gap where redaction existed but was unreachable
 * [HERE]: test/evolution-refiner-redaction.test.ts - S05.4 live-path redaction coverage
 *
 * Context: `redactEvolutionEvidence` already existed in prompts.ts, but `planEvolutionCandidate`
 * fed up to 24,000 raw session characters to the model without calling it. This test exercises the
 * real exported function rather than the helper in isolation.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { planEvolutionCandidate } from "../extensions/optional/evolution/evolution-refiner.js";
import type { ExtensionCommandContext } from "../core/extensions-host/types.js";

/**
 * A distinct agent directory per call, because the refiner reserves against a daily model-call
 * budget. A single shared directory made the later tests in this file depend on how many model
 * calls the earlier ones had spent.
 */
let sequence = 0;
function freshDirs(): { cwd: string; agentDir: string } {
	sequence += 1;
	return { cwd: `/private/tmp/catui-workspace-${sequence}`, agentDir: `/private/tmp/catui-agent-${sequence}` };
}

function secretSessionText(cwd: string, agentDir: string): string {
	return [
		`user: export API_KEY="sk-proj-abcdefghijklmnopqrstuvwx"`,
		`assistant: Authorization: Bearer ghp_0123456789abcdefghijklmnopqrstuvwxyz`,
		`user: the config lives at ${cwd}/.catui/settings.json`,
		`user: agent data is under ${agentDir}`,
	].join("\n");
}

function createContext(seen: { user?: string; system?: string }, dirs: { cwd: string; agentDir: string }): ExtensionCommandContext {
	return {
		cwd: dirs.cwd,
		agentDir: dirs.agentDir,
		sessionManager: {
			getEntries: () => [
				{ type: "message", timestamp: new Date().toISOString(), message: { role: "user", content: secretSessionText(dirs.cwd, dirs.agentDir) } },
			],
		},
		completeSimple: async (system: string, user: string) => {
			seen.system = system;
			seen.user = user;
			return JSON.stringify({ artifacts: [], predictions: [] });
		},
	} as unknown as ExtensionCommandContext;
}

test("planEvolutionCandidate redacts secrets and private paths before calling the model", async () => {
	const seen: { user?: string; system?: string } = {};
	const dirs = freshDirs();
	await planEvolutionCandidate(createContext(seen, freshDirs()), "workspace", "summarize what happened");

	assert.ok(seen.user, "the refiner must have issued a completion call");
	assert.equal(/sk-proj-abcdefghijklmnopqrstuvwx/.test(seen.user!), false, "raw provider key leaked into the prompt");
	assert.equal(/ghp_0123456789abcdefghijklmnopqrstuvwxyz/.test(seen.user!), false, "raw token leaked into the prompt");
	assert.equal(seen.user!.includes(`${dirs.cwd}/.catui/settings.json`), false, "workspace path leaked into the prompt");
	assert.equal(seen.user!.includes(dirs.agentDir), false, "agent data path leaked into the prompt");
	assert.match(seen.user!, /\[REDACTED_SECRET\]/);
	assert.match(seen.user!, /\[REDACTED_PATH\]/);
});

test("redaction does not swallow the non-sensitive context the refiner needs", async () => {
	const seen: { user?: string } = {};
	await planEvolutionCandidate(createContext(seen, freshDirs()), "workspace", "summarize what happened");
	assert.match(seen.user!, /User refinement instructions/);
	assert.match(seen.user!, /Recent session trajectory/);
	assert.match(seen.user!, /summarize what happened/);
});
