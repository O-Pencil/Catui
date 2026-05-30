import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "../core/extensions-host/types.js";
import planExtension from "../extensions/builtin/plan/index.js";
import { createExitPlanModeTool } from "../extensions/builtin/plan/exit-plan-mode-tool.js";
import {
	getPlan,
	getPlanFilePath,
	getPlanSessionState,
	getPlansDirectory,
	resetPlansDirectoryCache,
	writePlan,
} from "../extensions/builtin/plan/plan-file-manager.js";
import { shouldAllowToolCall } from "../extensions/builtin/plan/plan-permissions.js";
import {
	getPlanModeExitInstructions,
	getPlanModeInstructions,
	getPlanModeReentryInstructions,
} from "../extensions/builtin/plan/plan-workflow-prompt.js";

function createTempProject() {
	const cwd = mkdtempSync(join(tmpdir(), "nanopencil-plan-"));
	resetPlansDirectoryCache();
	getPlansDirectory(".plans", cwd);
	return cwd;
}

function cleanup(cwd: string) {
	rmSync(cwd, { recursive: true, force: true });
	resetPlansDirectoryCache();
}

function createSessionManager(sessionId = "session-1") {
	const entries: any[] = [];
	return {
		getSessionId: () => sessionId,
		getEntries: () => entries,
		getBranch: () => entries,
		getSessionFile: () => undefined,
		getSessionDir: () => "",
		getCwd: () => "",
		getLeafId: () => null,
		getLeafEntry: () => undefined,
		getEntry: () => undefined,
		getLabel: () => undefined,
		getHeader: () => ({}),
		getTree: () => [],
		getSessionName: () => undefined,
	};
}

function createCommandHarness(cwd: string) {
	const bus = {};
	const commands = new Map<string, any>();
	const sentMessages: string[] = [];
	const appended: Array<{ customType: string; data: unknown }> = [];
	const sessionManager = createSessionManager();
	const notifications: string[] = [];
	const statuses = new Map<string, string | undefined>();
	const widgets = new Map<string, string[] | undefined>();

	const api = {
		cwd,
		events: bus,
		registerCommand: (name: string, command: any) => commands.set(name, command),
		registerTool: () => {},
		on: () => {},
		getActiveTools: () => [],
		sendUserMessage: (content: string) => sentMessages.push(content),
		appendEntry: (customType: string, data: unknown) => appended.push({ customType, data }),
	} as unknown as ExtensionAPI;

	const ctx = {
		cwd,
		hasUI: true,
		sessionManager,
		getSettings: () => ({ plansDirectory: ".plans" }),
		ui: {
			notify: (message: string) => notifications.push(message),
			setStatus: (key: string, text: string | undefined) => statuses.set(key, text),
			setWidget: (key: string, content: string[] | undefined) => widgets.set(key, content),
			select: async () => undefined,
			editor: async (_title: string, prefill = "") => `${prefill}\nupdated`,
			openExternalEditor: async () => false,
		},
	} as unknown as ExtensionCommandContext;

	return { api, ctx, commands, sentMessages, appended, notifications, statuses, widgets, bus };
}

test("plan command enters plan mode without querying for bare /plan", async () => {
	const cwd = createTempProject();
	try {
		const harness = createCommandHarness(cwd);
		await planExtension(harness.api);

		await harness.commands.get("plan").handler("", harness.ctx);

		const state = getPlanSessionState(harness.bus, "session-1", []);
		assert.equal(state.state.mode, "plan");
		assert.equal(state.state.prePlanMode, "default");
		assert.deepEqual(harness.sentMessages, []);
		assert.equal(harness.statuses.get("plan"), "Plan mode");
		assert.ok(harness.widgets.get("plan-mode")?.[0].includes("PLAN MODE"));
	} finally {
		cleanup(cwd);
	}
});

test("plan command sends the provided description as follow-up", async () => {
	const cwd = createTempProject();
	try {
		const harness = createCommandHarness(cwd);
		await planExtension(harness.api);

		await harness.commands.get("plan").handler("refactor auth flow", harness.ctx);

		assert.deepEqual(harness.sentMessages, ["refactor auth flow"]);
	} finally {
		cleanup(cwd);
	}
});

test("plan command exposes and routes root action completions", async () => {
	const cwd = createTempProject();
	try {
		const harness = createCommandHarness(cwd);
		await planExtension(harness.api);

		const plan = harness.commands.get("plan");
		assert.ok(plan);
		assert.deepEqual(plan.getArgumentCompletions?.("val")?.map((item: { value: string }) => item.value), ["validate"]);
		assert.deepEqual(plan.getArgumentCompletions?.("app")?.map((item: { value: string }) => item.value), ["approve"]);

		await plan.handler("validate", harness.ctx);
		assert.match(harness.notifications.at(-1) ?? "", /No plan found/);

		await plan.handler("approve", harness.ctx);
		assert.match(harness.notifications.at(-1) ?? "", /No pending plan approval requests/);
	} finally {
		cleanup(cwd);
	}
});

test("plan file path is stable and settings directory must stay inside project", () => {
	const cwd = createTempProject();
	try {
		const bus = {};
		const first = getPlanFilePath(bus);
		const second = getPlanFilePath(bus);
		assert.equal(first, second);
		assert.ok(first.startsWith(join(cwd, ".plans")));

		resetPlansDirectoryCache();
		const outside = getPlansDirectory("../outside", cwd);
		assert.ok(!outside.startsWith(cwd));
	} finally {
		cleanup(cwd);
	}
});

test("plan permissions allow reads and exact plan file writes only", () => {
	const cwd = createTempProject();
	try {
		const planFilePath = join(cwd, ".plans", "steady-plan.md");

		assert.equal(shouldAllowToolCall({ toolName: "read", toolCallId: "1", input: { path: "src.ts" } }, planFilePath, cwd).allowed, true);
		assert.equal(shouldAllowToolCall({ toolName: "write", toolCallId: "2", input: { path: planFilePath } }, planFilePath, cwd).allowed, true);
		assert.equal(shouldAllowToolCall({ toolName: "write", toolCallId: "3", input: { path: "steady-plan.md" } }, planFilePath, cwd).allowed, false);
		assert.equal(shouldAllowToolCall({ toolName: "write", toolCallId: "4", input: { path: "src.ts" } }, planFilePath, cwd).allowed, false);
		assert.equal(shouldAllowToolCall({ toolName: "bash", toolCallId: "5", input: { command: "git status --short" } }, planFilePath, cwd).allowed, true);
		assert.equal(shouldAllowToolCall({ toolName: "bash", toolCallId: "6", input: { command: "npm install" } }, planFilePath, cwd).allowed, false);
		assert.equal(shouldAllowToolCall({ toolName: "mcpWrite", toolCallId: "7", input: {} }, planFilePath, cwd).allowed, false);
	} finally {
		cleanup(cwd);
	}
});

test("ExitPlanMode requires approval and restores previous mode", async () => {
	const cwd = createTempProject();
	try {
		const bus = {};
		const sessionState = getPlanSessionState(bus, "session-1", []);
		sessionState.state.mode = "plan";
		sessionState.state.prePlanMode = "acceptEdits";
		await writePlan(bus, [
			"# Context",
			"Need to improve plan mode.",
			"# Approach",
			"Use existing extension hooks.",
			"# Files",
			"Update plan extension.",
			"# Verification",
			"Run tests.",
		].join("\n\n"));

		const appended: unknown[] = [];
		const tool = createExitPlanModeTool(
			{
				events: bus,
				appendEntry: (_customType: string, data: unknown) => appended.push(data),
			} as unknown as ExtensionAPI,
			() => sessionState,
			() => false,
		);
		const cleared: Array<[string, string[] | undefined]> = [];
		const ctx = {
			cwd,
			hasUI: true,
			getSettings: () => ({ plansDirectory: ".plans" }),
			ui: {
				select: async () => "Execute plan",
				notify: () => {},
				setStatus: () => {},
				setWidget: (key: string, value: string[] | undefined) => cleared.push([key, value]),
			},
		} as unknown as ExtensionContext;

		const result = await tool.execute("exit", {}, undefined, undefined, ctx);

		assert.equal(sessionState.state.mode, "acceptEdits");
		assert.equal(sessionState.state.needsPlanModeExitAttachment, true);
		assert.match(result.content[0].text, /Approved Plan/);
		assert.deepEqual(cleared, [["plan-mode", undefined]]);
		assert.ok(appended.length > 0);
	} finally {
		cleanup(cwd);
	}
});

test("ExitPlanMode rejection aborts current run and keeps plan mode", async () => {
	const cwd = createTempProject();
	try {
		const bus = {};
		const sessionState = getPlanSessionState(bus, "session-1", []);
		sessionState.state.mode = "plan";
		sessionState.state.prePlanMode = "acceptEdits";
		await writePlan(bus, [
			"# Context",
			"Need to improve plan mode.",
			"# Approach",
			"Use existing extension hooks.",
			"# Files",
			"Update plan extension.",
			"# Verification",
			"Run tests.",
		].join("\n\n"));

		const tool = createExitPlanModeTool(
			{
				events: bus,
				appendEntry: () => {},
			} as unknown as ExtensionAPI,
			() => sessionState,
			() => false,
		);

		let aborted = false;
		const ctx = {
			cwd,
			hasUI: true,
			abort: () => {
				aborted = true;
			},
			getSettings: () => ({ plansDirectory: ".plans" }),
			ui: {
				select: async () => "Keep planning",
				notify: () => {},
				setStatus: () => {},
				setWidget: () => {},
			},
		} as unknown as ExtensionContext;

		await assert.rejects(
			tool.execute("exit", {}, undefined, undefined, ctx),
			/User rejected exiting plan mode/,
		);
		assert.equal(aborted, true);
		assert.equal(sessionState.state.mode, "plan");
	} finally {
		cleanup(cwd);
	}
});

test("plan command supports manual /plan exit approval flow", async () => {
	const cwd = createTempProject();
	try {
		const harness = createCommandHarness(cwd);
		harness.ctx.ui.select = async () => "Execute plan";
		await planExtension(harness.api);

		await harness.commands.get("plan").handler("", harness.ctx);
		await writePlan(harness.bus, [
			"# Context",
			"Manual exit from plan mode.",
			"# Approach",
			"Use /plan exit.",
			"# Files",
			"Plan extension.",
			"# Verification",
			"Run tests.",
		].join("\n\n"));

		await harness.commands.get("plan").handler("exit", harness.ctx);

		const state = getPlanSessionState(harness.bus, "session-1", []);
		assert.equal(state.state.mode, "default");
	} finally {
		cleanup(cwd);
	}
});

test("plan workflow prompts include reentry and exit attachment text", () => {
	const sessionState = getPlanSessionState({}, "session-1", []);
	const prompt = getPlanModeInstructions(sessionState, "/tmp/plan.md", null, "full");
	assert.match(prompt, /Plan mode is active/);
	assert.match(prompt, /Phase 1: Initial Understanding/);
	assert.match(prompt, /Phase 5: Call ExitPlanMode/);
	assert.match(prompt, /Do NOT ask about plan approval/);

	assert.match(getPlanModeReentryInstructions("/tmp/plan.md"), /returning to plan mode/);
	assert.match(getPlanModeExitInstructions("/tmp/plan.md", true), /Exited Plan Mode/);
});
