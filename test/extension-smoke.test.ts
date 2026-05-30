/**
 * [WHO]: Smoke tests for lightly-covered built-in and optional extensions
 * [FROM]: Depends on node:test and extension entry points
 * [TO]: Consumed by extension quality verification
 * [HERE]: test/extension-smoke.test.ts - registration-level coverage for low-blast-radius extensions
 */

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, RegisteredCommand } from "../core/extensions-host/types.js";
import { SessionManager } from "../core/session/session-manager.js";
import btwExtension from "../extensions/builtin/btw/index.js";
import disciplineExtension from "../extensions/builtin/discipline/index.js";
import debugExtension from "../extensions/builtin/debug/index.js";
import { sanitizeForLLM } from "../extensions/builtin/debug/collectors.js";
import idleThinkExtension from "../extensions/builtin/idle-think/index.js";
import recapExtension from "../extensions/builtin/recap/index.js";
import exportHtmlExtension, { extExportSessionToHtml } from "../extensions/optional/export-html/index.js";

type CapturedHandler = (event?: unknown, ctx?: unknown) => unknown;

function createRegistrationHarness() {
	const commands: string[] = [];
	const commandHandlers = new Map<string, RegisteredCommand["handler"]>();
	const renderers: string[] = [];
	const handlers: string[] = [];
	const eventHandlers = new Map<string, CapturedHandler[]>();
	const shortcuts: string[] = [];
	const tools: string[] = [];
	const agentDir = mkdtempSync(join(tmpdir(), "nanopencil-extension-smoke-"));

	const api = {
		cwd: process.cwd(),
		agentDir,
		registerCommand: (name: string, options: Omit<RegisteredCommand, "name">) => {
			commands.push(name);
			commandHandlers.set(name, options.handler);
		},
		registerMessageRenderer: (name: string) => renderers.push(name),
		registerShortcut: (key: string) => shortcuts.push(key),
		registerTool: (tool: { name: string }) => tools.push(tool.name),
		on: (event: string, handler: CapturedHandler) => {
			handlers.push(event);
			const existing = eventHandlers.get(event) ?? [];
			existing.push(handler);
			eventHandlers.set(event, existing);
		},
		sendMessage: () => {},
		events: { on: () => {}, emit: () => {} },
	} as unknown as ExtensionAPI;

	return {
		api,
		commands,
		commandHandlers,
		renderers,
		handlers,
		eventHandlers,
		shortcuts,
		tools,
		cleanup: () => rmSync(agentDir, { recursive: true, force: true }),
	};
}

test("btw/debug/recap/export-html register their user-facing commands", async () => {
	const harness = createRegistrationHarness();
	try {
		await btwExtension(harness.api);
		await debugExtension(harness.api);
		await recapExtension(harness.api);
		await exportHtmlExtension(harness.api);

		assert.ok(harness.commands.includes("btw"));
		assert.ok(harness.commands.includes("debug"));
		assert.ok(harness.commands.includes("set-locale"));
		assert.ok(harness.commands.includes("recap"));
		assert.ok(harness.commands.includes("export"));
		assert.ok(harness.renderers.includes("btw"));
		assert.ok(harness.renderers.includes("debug"));
		assert.ok(harness.renderers.includes("recap"));
	} finally {
		harness.cleanup();
	}
});

test("recap command emits a deterministic free recap without model access", async () => {
	const harness = createRegistrationHarness();
	const sentMessages: Array<{ customType: string; content: string; display: boolean; details?: { source?: string } }> = [];
	try {
		await recapExtension({
			...harness.api,
			sendMessage: (message: { customType: string; content: string; display: boolean; details?: { source?: string } }) => {
				sentMessages.push(message);
			},
		} as ExtensionAPI);
		const handler = harness.commandHandlers.get("recap");
		assert.ok(handler, "Expected recap command handler to be registered.");

		await handler("", {
			sessionManager: {
				getEntries: () => [
					{
						type: "message",
						message: {
							role: "user",
							content: "Please build a robust HTML exporter for nanoPencil sessions with real output coverage.",
						},
					},
					{
						type: "message",
						message: {
							role: "assistant",
							content: [
								{
									type: "toolCall",
									id: "tool-1",
									name: "write",
									arguments: { file_path: "core/export-html/template.html" },
								},
							],
						},
					},
				],
			},
			ui: { notify: () => {} },
		} as never);

		assert.equal(sentMessages.length, 1);
		assert.equal(sentMessages[0]?.customType, "recap");
		assert.equal(sentMessages[0]?.display, true);
		assert.equal(sentMessages[0]?.details?.source, "free");
		assert.match(sentMessages[0]?.content ?? "", /Current goal: Please build a robust HTML exporter/);
		assert.match(sentMessages[0]?.content ?? "", /files: core\/export-html\/template\.html/);
	} finally {
		harness.cleanup();
	}
});

test("recap smart path emits usage and does not leave timeout handles alive", async () => {
	const harness = createRegistrationHarness();
	const sentMessages: Array<{ customType: string; content: string; display: boolean; details?: { source?: string } }> = [];
	const notifications: string[] = [];
	try {
		await recapExtension({
			...harness.api,
			sendMessage: (message: { customType: string; content: string; display: boolean; details?: { source?: string } }) => {
				sentMessages.push(message);
			},
		} as ExtensionAPI);
		const handler = harness.commandHandlers.get("recap");
		assert.ok(handler, "Expected recap command handler to be registered.");

		await handler("--smart", {
			model: { id: "test", name: "Test", provider: "test" },
			sessionManager: {
				getEntries: () => [
					{
						type: "message",
						message: {
							role: "user",
							content: "Summarize the extension repair work and next verification step.",
						},
					},
				],
			},
			ui: { notify: (message: string) => notifications.push(message) },
			completeSimpleWithUsage: async () => ({
				text: "Current goal: repair extensions\nKey facts: smart recap tested\nNext: keep verifying",
				usage: {
					input: 10,
					output: 12,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 22,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
			}),
		} as never);

		assert.ok(notifications.includes("Synthesizing recap…"));
		assert.equal(sentMessages.length, 1);
		assert.equal(sentMessages[0]?.customType, "recap");
		assert.equal(sentMessages[0]?.details?.source, "smart");
		assert.match(sentMessages[0]?.content ?? "", /smart recap tested/);
	} finally {
		harness.cleanup();
	}
});

test("recap smart path blocks over-budget input before calling the model", async () => {
	const harness = createRegistrationHarness();
	const notifications: Array<{ message: string; level: string }> = [];
	let modelCalled = false;
	try {
		await recapExtension(harness.api);
		const handler = harness.commandHandlers.get("recap");
		assert.ok(handler, "Expected recap command handler to be registered.");

		await handler("--smart", {
			model: { id: "test", name: "Test", provider: "test" },
			sessionManager: {
				getEntries: () => [
					{
						type: "message",
						message: {
							role: "user",
							content: `Please recap this oversized context: ${"x".repeat(8000)}`,
						},
					},
				],
			},
			ui: { notify: (message: string, level: string) => notifications.push({ message, level }) },
			completeSimpleWithUsage: async () => {
				modelCalled = true;
				return undefined;
			},
		} as never);

		assert.equal(modelCalled, false);
		assert.ok(
			notifications.some(
				(notification) =>
					notification.level === "warning" &&
					/Recap input estimate \d+ tok exceeds per-call cap 1200 tok/.test(notification.message),
			),
			`Expected budget warning, got ${JSON.stringify(notifications)}`,
		);
	} finally {
		harness.cleanup();
	}
});

test("btw command validates input and emits quick model responses", async () => {
	const harness = createRegistrationHarness();
	const notifications: Array<{ message: string; level: string }> = [];
	const sentMessages: Array<{ customType: string; content: string; display: boolean }> = [];
	const completions: Array<{ systemPrompt: string; userMessage: string }> = [];
	try {
		await btwExtension({
			...harness.api,
			sendMessage: (message: { customType: string; content: string; display: boolean }) => {
				sentMessages.push(message);
			},
		} as ExtensionAPI);
		const handler = harness.commandHandlers.get("btw");
		assert.ok(handler, "Expected btw command handler to be registered.");

		const ctx = {
			sessionManager: {
				getEntries: () => [
					{
						type: "message",
						message: {
							role: "user",
							content: "We are debugging extension quality.",
						},
					},
				],
			},
			ui: {
				notify: (message: string, level: string) => notifications.push({ message, level }),
			},
			completeSimple: async (systemPrompt: string, userMessage: string) => {
				completions.push({ systemPrompt, userMessage });
				return "Use the existing extension harness.";
			},
		};

		await handler("", ctx as never);
		assert.deepEqual(notifications, [{ message: "Usage: /btw <question>", level: "warning" }]);
		assert.equal(completions.length, 0);

		await handler("what should we test next?", ctx as never);
		assert.equal(completions.length, 1);
		assert.match(completions[0]?.systemPrompt ?? "", /Do NOT use any tools/);
		assert.match(completions[0]?.userMessage ?? "", /Previous conversation:/);
		assert.match(completions[0]?.userMessage ?? "", /what should we test next\?/);
		assert.deepEqual(sentMessages, [
			{ customType: "btw", content: "Use the existing extension harness.", display: true },
		]);
	} finally {
		harness.cleanup();
	}
});

test("debug model command emits a visible no-model diagnostic instead of starting a turn", async () => {
	const harness = createRegistrationHarness();
	const sentMessages: Array<{ customType: string; content: string; display: boolean }> = [];
	const userMessages: string[] = [];
	try {
		await debugExtension({
			...harness.api,
			sendMessage: (message: { customType: string; content: string; display: boolean }) => {
				sentMessages.push(message);
			},
			sendUserMessage: (content: string) => {
				userMessages.push(content);
			},
		} as ExtensionAPI);
		const handler = harness.commandHandlers.get("debug");
		assert.ok(handler, "Expected debug command handler to be registered.");

		await handler("model", {
			model: undefined,
			getContextUsage: () => undefined,
		} as never);

		assert.equal(userMessages.length, 0);
		assert.equal(sentMessages.length, 1);
		assert.equal(sentMessages[0]?.customType, "debug");
		assert.equal(sentMessages[0]?.display, true);
		assert.match(sentMessages[0]?.content ?? "", /Collection failed: No model configured/);
	} finally {
		harness.cleanup();
	}
});

test("debug full diagnostic injection is scoped to the pending generated prompt", async () => {
	const harness = createRegistrationHarness();
	const userMessages: Array<{ content: string; options?: { deliverAs?: string } }> = [];
	try {
		await debugExtension({
			...harness.api,
			sendUserMessage: (content: string, options?: { deliverAs?: string }) => {
				userMessages.push({ content, options });
			},
		} as ExtensionAPI);
		const handler = harness.commandHandlers.get("debug");
		const beforeAgentStart = harness.eventHandlers.get("before_agent_start")?.[0];
		const agentEnd = harness.eventHandlers.get("agent_end")?.[0];
		assert.ok(handler, "Expected debug command handler to be registered.");
		assert.ok(beforeAgentStart, "Expected before_agent_start handler to be registered.");
		assert.ok(agentEnd, "Expected agent_end handler to be registered.");

		const fakePrompt = "[DEBUG:manual]\nnot generated by /debug";
		assert.equal(beforeAgentStart({ prompt: fakePrompt }), undefined);

		await handler("startup feels slow", {
			cwd: process.cwd(),
			model: {
				id: "test-model",
				name: "Test Model",
				provider: "test",
				baseUrl: "https://example.test",
				reasoning: false,
				contextWindow: 1000,
				maxTokens: 100,
			},
			sessionManager: {
				getSessionId: () => "session-1",
				getSessionFile: () => "/tmp/session.jsonl",
				getCwd: () => process.cwd(),
				getSessionName: () => "debug session",
				getEntries: () => [],
				getLeafId: () => null,
			},
			getContextUsage: () => ({ percent: 12, tokens: 120 }),
			getSettings: () => ({
				defaultProvider: "test",
				defaultModel: "test-model",
				defaultThinkingLevel: "medium",
				theme: "default",
				locale: "en",
				transport: "stdio",
				steeringMode: "auto",
				extensions: [],
				packages: [],
			}),
			isIdle: () => true,
			hasPendingMessages: () => false,
			getSystemPrompt: () => "system prompt",
			getSoulManager: () => undefined,
			ui: {
				setStatus: () => {},
				notify: () => {},
			},
		} as never);

		assert.equal(userMessages.length, 1);
		assert.equal(userMessages[0]?.options?.deliverAs, "followUp");
		const generatedPrompt = userMessages[0]?.content ?? "";
		assert.match(generatedPrompt, /^\[DEBUG:\d+\]/);
		assert.match(generatedPrompt, /User-Reported Issue: startup feels slow/);

		const injection = beforeAgentStart({ prompt: generatedPrompt }) as { appendSystemPrompt?: string } | undefined;
		assert.match(injection?.appendSystemPrompt ?? "", /diagnostic analyst/);

		agentEnd({});
		assert.equal(beforeAgentStart({ prompt: generatedPrompt }), undefined);
	} finally {
		harness.cleanup();
	}
});

test("debug sanitization redacts nested credentials before LLM analysis", () => {
	const sanitized = sanitizeForLLM({
		system: { data: { platform: "darwin" }, error: null },
		model: {
			data: {
				modelId: "test",
				modelName: "Test",
				provider: "test",
				baseUrl: "https://example.test",
				reasoning: false,
				contextWindow: 1000,
				maxTokens: 100,
				contextUsagePercent: null,
				contextTokens: null,
				apiKey: "sk-secret",
			},
			error: null,
		},
		session: { data: null, error: "skip" },
		config: {
			data: {
				defaultProvider: "test",
				defaultModel: "test",
				thinkingLevel: undefined,
				theme: "default",
				locale: "en",
				transport: undefined,
				steeringMode: undefined,
				extensionCount: 1,
				packageCount: 1,
				nested: { accessToken: "token-secret", harmless: "visible" },
			},
			error: null,
		},
		git: { data: null, error: "skip" },
		agent: { data: null, error: "skip" },
	} as never) as {
		model: { data: { apiKey: string } };
		config: { data: { nested: { accessToken: string; harmless: string } } };
	};

	assert.equal(sanitized.model.data.apiKey, "***REDACTED***");
	assert.equal(sanitized.config.data.nested.accessToken, "***REDACTED***");
	assert.equal(sanitized.config.data.nested.harmless, "visible");
});

test("discipline discovers bundled skills and injects bootstrap prompt when assets exist", async () => {
	const harness = createRegistrationHarness();
	try {
		await disciplineExtension(harness.api);
		const discover = harness.eventHandlers.get("resources_discover")?.[0];
		const beforeAgentStart = harness.eventHandlers.get("before_agent_start")?.[0];
		assert.ok(discover, "Expected resources_discover handler to be registered.");
		assert.ok(beforeAgentStart, "Expected before_agent_start handler to be registered.");

		const resources = discover() as { skillPaths?: string[] } | undefined;
		assert.equal(resources?.skillPaths?.length, 1);
		assert.match(resources?.skillPaths?.[0] ?? "", /extensions\/defaults\/discipline\/skills$/);
		assert.equal(existsSync(resources?.skillPaths?.[0] ?? ""), true);

		const prompt = beforeAgentStart() as { appendSystemPrompt?: string } | undefined;
		assert.match(prompt?.appendSystemPrompt ?? "", /nanoPencil Engineering Discipline/);
		assert.match(prompt?.appendSystemPrompt ?? "", /systematic-debugging/);
	} finally {
		harness.cleanup();
	}
});

test("export-html writes a standalone HTML file with encoded session data", async () => {
	const tmp = mkdtempSync(join(tmpdir(), "nanopencil-export-html-"));
	try {
		const sessionManager = SessionManager.create(tmp, join(tmp, "sessions"));
		sessionManager.appendMessage({
			role: "user",
			content: "Export this session as HTML.",
		} as never);

		const outputPath = join(tmp, "session.html");
		const writtenPath = await extExportSessionToHtml(sessionManager, undefined, { outputPath });
		assert.equal(writtenPath, outputPath);
		assert.equal(existsSync(outputPath), true);

		const html = readFileSync(outputPath, "utf-8");
		assert.match(html, /<div id="app">/);
		assert.match(html, /<script id="session-data" type="application\/json">/);
		assert.doesNotMatch(html, /\{\{SESSION_DATA\}\}/);

		const encoded = html.match(/<script id="session-data" type="application\/json">([^<]+)<\/script>/)?.[1];
		assert.ok(encoded, "Expected encoded session data in export HTML.");
		const decoded = JSON.parse(Buffer.from(encoded, "base64").toString("utf-8")) as {
			entries: Array<{ message?: { content?: string } }>;
		};
		assert.equal(decoded.entries[0]?.message?.content, "Export this session as HTML.");
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
});

test("export-html pre-renders custom tool call and result HTML", async () => {
	const tmp = mkdtempSync(join(tmpdir(), "nanopencil-export-html-tools-"));
	try {
		const sessionManager = SessionManager.create(tmp, join(tmp, "sessions"));
		sessionManager.appendMessage({
			role: "assistant",
			content: [
				{
					type: "toolCall",
					id: "custom-call-1",
					name: "custom_probe",
					arguments: { target: "extensions" },
				},
			],
		} as never);
		sessionManager.appendMessage({
			role: "toolResult",
			toolCallId: "custom-call-1",
			toolName: "custom_probe",
			content: [{ type: "text", text: "custom result" }],
			isError: false,
		} as never);

		const outputPath = join(tmp, "session-tools.html");
		await extExportSessionToHtml(sessionManager, undefined, {
			outputPath,
			toolRenderer: {
				renderCall: (toolName, args) => `<div>${toolName}:${(args as { target: string }).target}</div>`,
				renderResult: (toolName, result) => `<pre>${toolName}:${result[0]?.text ?? ""}</pre>`,
			},
		});

		const html = readFileSync(outputPath, "utf-8");
		const encoded = html.match(/<script id="session-data" type="application\/json">([^<]+)<\/script>/)?.[1];
		assert.ok(encoded, "Expected encoded session data in export HTML.");
		const decoded = JSON.parse(Buffer.from(encoded, "base64").toString("utf-8")) as {
			renderedTools?: Record<string, { callHtml?: string; resultHtml?: string }>;
		};
		assert.deepEqual(decoded.renderedTools?.["custom-call-1"], {
			callHtml: "<div>custom_probe:extensions</div>",
			resultHtml: "<pre>custom_probe:custom result</pre>",
		});
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
});

test("idle-think registers lifecycle hooks without starting work at load time", async () => {
	const harness = createRegistrationHarness();
	try {
		await idleThinkExtension(harness.api);

		assert.deepEqual(harness.commands, []);
		assert.ok(harness.handlers.includes("session_start"));
		assert.ok(harness.handlers.includes("session_shutdown"));
		assert.ok(harness.handlers.includes("before_agent_start"));
		assert.ok(harness.handlers.includes("agent_end"));
	} finally {
		harness.cleanup();
	}
});

test("idle-think starts interval only when enabled and clears it on shutdown", async () => {
	const harness = createRegistrationHarness();
	const originalSetInterval = globalThis.setInterval;
	const originalClearInterval = globalThis.clearInterval;
	const intervals: Array<{ id: ReturnType<typeof setInterval>; delay?: number }> = [];
	const cleared: Array<ReturnType<typeof setInterval>> = [];
	try {
		globalThis.setInterval = ((handler: TimerHandler, delay?: number) => {
			const id = { handler, delay } as unknown as ReturnType<typeof setInterval>;
			intervals.push({ id, delay });
			return id;
		}) as typeof setInterval;
		globalThis.clearInterval = ((id?: ReturnType<typeof setInterval>) => {
			if (id) cleared.push(id);
		}) as typeof clearInterval;

		await idleThinkExtension(harness.api);
		const sessionStart = harness.eventHandlers.get("session_start")?.[0];
		const sessionShutdown = harness.eventHandlers.get("session_shutdown")?.[0];
		assert.ok(sessionStart, "Expected session_start handler to be registered.");
		assert.ok(sessionShutdown, "Expected session_shutdown handler to be registered.");

		sessionStart({}, {
			hasUI: true,
			getSettings: () => ({ idleThink: { enabled: false } }),
		});
		assert.equal(intervals.length, 0);

		sessionStart({}, {
			hasUI: true,
			getSettings: () => ({ idleThink: { enabled: true } }),
		});
		assert.equal(intervals.length, 1);
		assert.equal(intervals[0]?.delay, 60_000);

		sessionShutdown();
		assert.deepEqual(cleared, [intervals[0]?.id]);
	} finally {
		globalThis.setInterval = originalSetInterval;
		globalThis.clearInterval = originalClearInterval;
		harness.cleanup();
	}
});
