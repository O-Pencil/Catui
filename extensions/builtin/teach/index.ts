/**
 * [WHO]: teachExtension - registers /teach command, teaching state machine, and renderer
 * [FROM]: Depends on core/extensions-host/types, teach-runtime.ts, teach-format.ts, teach-i18n.ts
 * [TO]: Auto-loaded by builtin-extensions.ts as a default extension
 * [HERE]: extensions/builtin/teach/index.ts - guided knowledge teaching extension
 */

import { Type, type Static } from "@sinclair/typebox";
import { Box, Container, Spacer, Text, type Component } from "@pencil-agent/tui";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	RegisteredCommand,
} from "../../../core/extensions-host/types.js";
import { formatTeachResult, formatSources } from "./teach-format.js";
import { detectTeachLocale, type TeachLocale } from "./teach-i18n.js";
import { TeachRuntime } from "./teach-runtime.js";

const TEACH_CUSTOM_TYPE = "teach";
const TEACH_VERSION = "1.0.0";

let currentLocale: TeachLocale = "en";
const runtimeByContext = new WeakMap<ExtensionCommandContext, TeachRuntime>();

const teachToolSchema = Type.Object({
	topic: Type.String({ description: "The topic to teach" }),
	action: Type.Union([Type.Literal("start"), Type.Literal("respond"), Type.Literal("status")], {
		description: "Action to perform",
	}),
	response: Type.Optional(Type.String({ description: "User's response (for respond action)" })),
});

type TeachToolInput = Static<typeof teachToolSchema>;

function getRuntime(ctx: ExtensionCommandContext): TeachRuntime {
	let runtime = runtimeByContext.get(ctx);
	if (!runtime) {
		runtime = new TeachRuntime();
		// Initialize with workspace path from context
		runtime.initialize(ctx.cwd);
		runtimeByContext.set(ctx, runtime);
	}
	return runtime;
}

export default async function teachExtension(api: ExtensionAPI): Promise<void> {
	// Detect locale from settings
	currentLocale = detectTeachLocale();

	// Register /teach command
	api.registerCommand("teach", {
		description: "Learn something new with guided, source-verified teaching",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const topic = args.trim();

			if (!topic) {
				ctx.ui.notify("Usage: /teach <topic>\n\nExample: /teach how to cook pasta", "warning");
				return;
			}

			const runtime = getRuntime(ctx);
			const result = await runtime.startTeaching(ctx, topic);

			const formatted = formatTeachResult(result);
			ctx.ui.notify(formatted, "info");
		},
	} satisfies Omit<RegisteredCommand, "name">);

	// Register teach tool for agent use
	api.registerTool({
		name: "teach",
		label: "Teach",
		description:
			"Teach the user about a topic with guided, source-verified instruction. " +
			"Use this when the user wants to learn something new. " +
			"Supports progressive teaching with analogies and source verification.",
		parameters: teachToolSchema,
		isConcurrencySafe: false,
		guidance:
			"Use the teach tool when the user wants to learn something. " +
			"Start with action='start', then use action='respond' for subsequent interactions.",

		async execute(
			_toolCallId: string,
			params: TeachToolInput,
			_signal: AbortSignal | undefined,
			_onUpdate: undefined,
			ctx: ExtensionContext,
		) {
			const runtime = getRuntime(ctx as ExtensionCommandContext);

			type TeachToolDetails = {
				result: import("./teach-types.js").TeachResult;
				state: import("./teach-types.js").TeachState | null;
				action: string;
			};

			const makeResult = (result: import("./teach-types.js").TeachResult, action: string): { content: [{ type: "text"; text: string }]; details: TeachToolDetails } => ({
				content: [{ type: "text" as const, text: formatTeachResult(result) }],
				details: { result, state: runtime.getState(), action },
			});

			switch (params.action) {
				case "start": {
					const result = await runtime.startTeaching(ctx as ExtensionCommandContext, params.topic);
					return makeResult(result, "start");
				}

				case "respond": {
					if (!params.response) {
						return makeResult({ type: "error", message: "No response provided" }, "respond");
					}
					const result = await runtime.processResponse(ctx as ExtensionCommandContext, params.response);
					return makeResult(result, "respond");
				}

				case "status": {
					const state = runtime.getState();
					if (!state) {
						return makeResult({ type: "info", message: "No active session" }, "status");
					}
					return {
						content: [
							{
								type: "text" as const,
								text: `Current topic: ${state.topic}\nPhase: ${state.phase}\nLevel: ${state.currentLevel}`,
							},
						],
						details: { result: { type: "info" as const, message: "Status retrieved" }, state, action: "status" },
					} as { content: [{ type: "text"; text: string }]; details: TeachToolDetails };
				}

				default:
					return makeResult({ type: "error", message: `Unknown action: ${params.action}` }, params.action);
			}
		},
	});

	// Register teach renderer
	api.registerMessageRenderer(TEACH_CUSTOM_TYPE, (message, _options, theme) => {
		// Extract teach-specific content
		const text =
			typeof message.content === "string"
				? message.content
				: message.content
						.filter((part): part is { type: "text"; text: string } => part.type === "text")
						.map((part) => part.text)
						.join("\n");

		const box = new Box(1, 1, (value) => theme.bg("customMessageBg", value));
		box.addChild(new Text(theme.fg("dim", text), 0, 0));

		const container = new Container();
		container.addChild(new Spacer(1));
		container.addChild(box);
		return container;
	});

	// Register resources for agent context
	api.on("resources_discover", () => {
		return {
			skillPaths: [],
		};
	});
}

export { TeachRuntime, TEACH_CUSTOM_TYPE, TEACH_VERSION };
