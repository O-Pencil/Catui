import { describe, expect, it } from "vitest";
import { transformMessages } from "../src/providers/transform-messages.js";
import type { AssistantMessage, Message, Model, ToolResultMessage, Usage } from "../src/types.js";

function makeAnthropicModel(): Model<"anthropic-messages"> {
	return {
		id: "claude-sonnet-4",
		name: "Claude Sonnet 4",
		api: "anthropic-messages",
		provider: "anthropic",
		baseUrl: "https://api.anthropic.com",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16000,
	};
}

function usage(): Usage {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function normalizeToolCallId(id: string): string {
	return id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

function makeToolCallingAssistant(stopReason: AssistantMessage["stopReason"]): AssistantMessage {
	return {
		role: "assistant",
		content: [
			{
				type: "toolCall",
				id: "call_read|opaque/provider/id",
				name: "read",
				arguments: { path: "README.md" },
			},
		],
		api: "openai-responses",
		provider: "openai",
		model: "gpt-5",
		usage: usage(),
		stopReason,
		timestamp: 2,
	};
}

function makeToolResult(): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId: "call_read|opaque/provider/id",
		toolName: "read",
		content: [{ type: "text", text: "README contents" }],
		isError: true,
		timestamp: 3,
	};
}

describe("transformMessages interrupted tool results", () => {
	it("drops tool results that only close skipped aborted assistant tool calls", () => {
		const messages: Message[] = [
			{ role: "user", content: "read the file", timestamp: 1 },
			makeToolCallingAssistant("aborted"),
			makeToolResult(),
			{ role: "user", content: "continue", timestamp: 4 },
		];

		const result = transformMessages(messages, makeAnthropicModel(), normalizeToolCallId);

		expect(result.map((message) => message.role)).toEqual(["user", "user"]);
		expect(result.some((message) => message.role === "toolResult")).toBe(false);
	});

	it("keeps matching tool results for valid assistant tool calls", () => {
		const messages: Message[] = [
			{ role: "user", content: "read the file", timestamp: 1 },
			makeToolCallingAssistant("toolUse"),
			makeToolResult(),
			{ role: "user", content: "summarize it", timestamp: 4 },
		];

		const result = transformMessages(messages, makeAnthropicModel(), normalizeToolCallId);

		expect(result.map((message) => message.role)).toEqual(["user", "assistant", "toolResult", "user"]);
		expect((result[2] as ToolResultMessage).toolCallId).toBe(normalizeToolCallId("call_read|opaque/provider/id"));
	});

	it("closes trailing assistant tool calls before replay", () => {
		const messages: Message[] = [
			{ role: "user", content: "read the file", timestamp: 1 },
			makeToolCallingAssistant("toolUse"),
		];

		const result = transformMessages(messages, makeAnthropicModel(), normalizeToolCallId);

		expect(result.map((message) => message.role)).toEqual(["user", "assistant", "toolResult"]);
		expect((result[2] as ToolResultMessage).toolCallId).toBe(normalizeToolCallId("call_read|opaque/provider/id"));
		expect((result[2] as ToolResultMessage).isError).toBe(true);
	});

	it("drops tool results that do not match any pending assistant tool call", () => {
		const messages: Message[] = [
			{ role: "user", content: "hello", timestamp: 1 },
			{
				role: "toolResult",
				toolCallId: "orphan-call",
				toolName: "read",
				content: [{ type: "text", text: "orphan output" }],
				isError: false,
				timestamp: 2,
			},
			{ role: "user", content: "continue", timestamp: 3 },
		];

		const result = transformMessages(messages, makeAnthropicModel(), normalizeToolCallId);

		expect(result.map((message) => message.role)).toEqual(["user", "user"]);
		expect(result.some((message) => message.role === "toolResult")).toBe(false);
	});

	it("drops unrelated tool results while closing the pending tool call", () => {
		const messages: Message[] = [
			{ role: "user", content: "read the file", timestamp: 1 },
			makeToolCallingAssistant("toolUse"),
			{
				...makeToolResult(),
				toolCallId: "other-call",
			},
			{ role: "user", content: "continue", timestamp: 4 },
		];

		const result = transformMessages(messages, makeAnthropicModel(), normalizeToolCallId);

		expect(result.map((message) => message.role)).toEqual(["user", "assistant", "toolResult", "user"]);
		expect((result[2] as ToolResultMessage).toolCallId).toBe(normalizeToolCallId("call_read|opaque/provider/id"));
		expect((result[2] as ToolResultMessage).isError).toBe(true);
	});

	it("drops duplicate tool results for an already closed pending tool call", () => {
		const messages: Message[] = [
			{ role: "user", content: "read the file", timestamp: 1 },
			makeToolCallingAssistant("toolUse"),
			makeToolResult(),
			{
				...makeToolResult(),
				content: [{ type: "text", text: "duplicate output" }],
				timestamp: 4,
			},
			{ role: "user", content: "summarize it", timestamp: 5 },
		];

		const result = transformMessages(messages, makeAnthropicModel(), normalizeToolCallId);

		expect(result.map((message) => message.role)).toEqual(["user", "assistant", "toolResult", "user"]);
		expect((result[2] as ToolResultMessage).content).toEqual([{ type: "text", text: "README contents" }]);
	});
});
