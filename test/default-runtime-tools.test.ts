/**
 * [WHO]: Verifies default runtime tool composition with and without Bash approval
 * [FROM]: Depends on SettingsManager and createDefaultRuntimeTools
 * [TO]: Consumed by the root tool and harness-critical test gates
 * [HERE]: test/default-runtime-tools.test.ts - regression coverage for complete approval-enabled base tools
 */
import assert from "node:assert/strict";
import test from "node:test";
import { SettingsManager } from "../core/platform/config/settings-manager.js";
import { createDefaultRuntimeTools } from "../core/runtime/default-tools.js";
import type { ApprovalClient, ApprovalDecision } from "../core/tools/bash.js";

test("Bash approval preserves the complete default runtime tool registry", () => {
	const settings = SettingsManager.inMemory();
	const baseline = createDefaultRuntimeTools(process.cwd(), settings);
	const approved = createDefaultRuntimeTools(process.cwd(), settings, {
		bashApproval: { request: async () => "deny" },
	});

	assert.deepEqual(Object.keys(approved).sort(), Object.keys(baseline).sort());
	for (const required of ["read", "bash", "edit", "write", "grep", "find", "ls", "time"]) {
		assert.ok(required in approved, `missing default tool: ${required}`);
	}
});

test("approval-enabled default Bash consults the injected client before spawn", async () => {
	const decisions: ApprovalDecision[] = [];
	const approval: ApprovalClient = {
		async request(decision) {
			decisions.push(decision);
			return "deny";
		},
	};
	const tools = createDefaultRuntimeTools(process.cwd(), SettingsManager.inMemory(), { bashApproval: approval });

	const result = await tools.bash.execute("dangerous", { command: "rm -rf /tmp/catui-approval-must-not-run" });
	assert.equal(decisions.length, 1);
	assert.ok(decisions[0].reason.length > 0);
	assert.equal(result.isError, true);
});
