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

const CWD = "/private/tmp/catui-workspace";
const AGENT_DIR = "/private/tmp/catui-agent";

const SECRET_SESSION_TEXT = [
	`user: export API_KEY="sk-proj-abcdefghijklmnopqrstuvwx"`,
	`assistant: Authorization: Bearer ghp_0123456789abcdefghijklmnopqrstuvwxyz`,
	`user: the config lives at ${CWD}/.catui/settings.json`,
	`user: agent data is under ${AGENT_DIR}`,
].join("\n");

function createContext(seen: { user?: string; system?: string }): ExtensionCommandContext {
	return {
		cwd: CWD,
		agentDir: AGENT_DIR,
		sessionManager: {
			getEntries: () => [
				{ type: "message", timestamp: new Date().toISOString(), message: { role: "user", content: SECRET_SESSION_TEXT } },
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
	await planEvolutionCandidate(createContext(seen), "workspace", "summarize what happened");

	assert.ok(seen.user, "the refiner must have issued a completion call");
	assert.equal(/sk-proj-abcdefghijklmnopqrstuvwx/.test(seen.user!), false, "raw provider key leaked into the prompt");
	assert.equal(/ghp_0123456789abcdefghijklmnopqrstuvwxyz/.test(seen.user!), false, "raw token leaked into the prompt");
	assert.equal(seen.user!.includes(`${CWD}/.catui/settings.json`), false, "workspace path leaked into the prompt");
	assert.equal(seen.user!.includes(AGENT_DIR), false, "agent data path leaked into the prompt");
	assert.match(seen.user!, /\[REDACTED_SECRET\]/);
	assert.match(seen.user!, /\[REDACTED_PATH\]/);
});

test("redaction does not swallow the non-sensitive context the refiner needs", async () => {
	const seen: { user?: string } = {};
	await planEvolutionCandidate(createContext(seen), "workspace", "summarize what happened");
	assert.match(seen.user!, /User refinement instructions/);
	assert.match(seen.user!, /Recent session trajectory/);
	assert.match(seen.user!, /summarize what happened/);
});
