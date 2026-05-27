/**
 * [WHO]: btwExtension - registers /btw command and BTW message renderer
 * [FROM]: Depends on core/extensions/types
 * [TO]: Auto-loaded by builtin-extensions.ts as a default extension
 * [HERE]: extensions/defaults/btw/index.ts - quick side question without interrupting main task
 */

import { Box, Container, Spacer, Text, type Component } from "@pencil-agent/tui";
import type { ExtensionAPI, ExtensionCommandContext } from "../../../core/extensions/types.js";

const BTW_MESSAGE_TYPE = "btw";

const BTW_TIMEOUT_MS = 30_000;

const BTW_SYSTEM_PROMPT = `You are answering a quick "by the way" question inline during an active coding session.

Rules:
- Answer directly and concisely - the user is waiting
- Do NOT use any tools
- Do NOT say "I cannot" or explain limitations
- If you don't know, say so briefly
- Keep responses short (1-3 sentences unless detail is critical).`;

const MAX_TURN_CHARS = 500;

// ============================================================================
// Context building
// ============================================================================

interface SessionMessageEntry {
	type: "message";
	message: {
		role: "user" | "assistant" | "system";
		content: string | Array<{ type: "text"; text: string }>;
	};
}

function extractText(content: string | Array<{ type: "text"; text: string }>): string {
	if (typeof content === "string") return content;
	return content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n");
}

/**
 * Build conversation context from session entries for BTW question.
 * Includes last 10 message turns (user + assistant).
 */
function buildBtwContext(entries: ReadonlyArray<unknown>): string {
	const messages: string[] = [];

	for (const entry of entries) {
		const e = entry as SessionMessageEntry;
		if (e.type !== "message") continue;
		if (e.message.role === "user") {
			const text = extractText(e.message.content);
			if (text.trim()) messages.push(`User: ${text}`);
		} else if (e.message.role === "assistant") {
			const text = extractText(e.message.content);
			if (text.trim()) messages.push(`Assistant: ${text.slice(0, MAX_TURN_CHARS)}`);
		}
	}

	// Take last 10 turns (20 entries = 10 user + 10 assistant)
	const recent = messages.slice(-20);
	return recent.join("\n\n");
}

// ============================================================================
// BTW command handler
// ============================================================================

async function handleBtwCommand(args: string, ctx: ExtensionCommandContext, api: ExtensionAPI): Promise<void> {
	const question = args.trim();
	if (!question) {
		ctx.ui.notify("Usage: /btw <question>", "warning");
		return;
	}

	const contextText = buildBtwContext(ctx.sessionManager.getEntries());
	const userMessage = contextText
		? `Previous conversation:\n${contextText}\n\nUser's question: ${question}`
		: `User's question: ${question}`;

	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		const response = await Promise.race([
			ctx.completeSimple(BTW_SYSTEM_PROMPT, userMessage),
			new Promise<undefined>((resolve) => {
				timeout = setTimeout(() => resolve(undefined), BTW_TIMEOUT_MS);
			}),
		]);
		if (response) {
			api.sendMessage({
				customType: BTW_MESSAGE_TYPE,
				content: response,
				display: true,
			});
		} else {
			ctx.ui.notify("BTW: No response from model (check API key)", "warning");
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		ctx.ui.notify(`BTW error: ${message}`, "error");
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}

// ============================================================================
// Extension entry
// ============================================================================

export default async function btwExtension(api: ExtensionAPI): Promise<void> {
	// Register BTW message renderer
	api.registerMessageRenderer(BTW_MESSAGE_TYPE, (message, _options, theme): Component => {
		const text =
			typeof message.content === "string"
				? message.content
				: message.content
						.filter((part): part is { type: "text"; text: string } => part.type === "text")
						.map((part) => part.text)
						.join("\n");

		const box = new Box(1, 1, (v) => theme.bg("customMessageBg", v));
		box.addChild(new Text(theme.fg("dim", text), 0, 0));

		const container = new Container();
		container.addChild(new Spacer(1));
		container.addChild(box);
		return container;
	});

	// Register /btw command
	api.registerCommand("btw", {
		description: "Ask a quick side question while the main task keeps its place",
		handler: (args, ctx) => handleBtwCommand(args, ctx, api),
	});
}
