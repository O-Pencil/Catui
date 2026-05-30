/**
 * [WHO]: Verifies SettingsManager support for agent loop framework defaults
 * [FROM]: Depends on SettingsManager
 * [TO]: Consumed by root Vitest suite
 * [HERE]: test/settings-agent-loop.test.ts - regression coverage for settings-level loop selection
 */
import { describe, expect, it } from "vitest";
import { SettingsManager } from "../core/platform/config/settings-manager.js";

describe("SettingsManager agentLoopFramework", () => {
	it("normalizes current and earlier experimental values", () => {
		expect(SettingsManager.inMemory({ agentLoopFramework: "standard" }).getAgentLoopFramework()).toBe(
			"standard",
		);
		expect(SettingsManager.inMemory({ agentLoopFramework: "weak-model-compatible" }).getAgentLoopFramework()).toBe(
			"weak-model-compatible",
		);
		expect(SettingsManager.inMemory({ agentLoopFramework: "high-intelligence" }).getAgentLoopFramework()).toBe(
			"standard",
		);
		expect(SettingsManager.inMemory({ agentLoopFramework: "low-intelligence" }).getAgentLoopFramework()).toBe(
			"weak-model-compatible",
		);
		expect(SettingsManager.inMemory({ agentLoopFramework: "structured-adaptive" }).getAgentLoopFramework()).toBe(
			"weak-model-compatible",
		);
	});

	it("can persist and clear the global loop override", () => {
		const settings = SettingsManager.inMemory();

		expect(settings.getAgentLoopFramework()).toBeUndefined();

		settings.setAgentLoopFramework("weak-model-compatible");
		expect(settings.getAgentLoopFramework()).toBe("weak-model-compatible");
		expect(settings.getGlobalSettings().agentLoopFramework).toBe("weak-model-compatible");

		settings.setAgentLoopFramework(undefined);
		expect(settings.getAgentLoopFramework()).toBeUndefined();
		expect(settings.getGlobalSettings().agentLoopFramework).toBeUndefined();
	});

	it("exposes aggregate tool-result budget defaults and overrides", () => {
		expect(SettingsManager.inMemory().getAgentLoopSettings().maxToolResultBatchSizeChars).toBe(200_000);
		expect(
			SettingsManager.inMemory({
				agentLoop: { maxToolResultBatchSizeChars: 123_456 },
			}).getAgentLoopSettings().maxToolResultBatchSizeChars,
		).toBe(123_456);
		expect(
			SettingsManager.inMemory({
				agentLoop: { maxToolResultBatchSizeChars: -1 },
			}).getAgentLoopSettings().maxToolResultBatchSizeChars,
		).toBe(200_000);
	});
});
