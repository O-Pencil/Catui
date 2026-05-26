/**
 * [WHO]: recapExtension — registers /recap command and the ※ recap message renderer
 * [FROM]: Depends on core/extensions/types, ./recap-renderer, ./recap-synthesizer, ./recap-extractor, ./recap-types
 * [TO]: Auto-loaded by builtin-extensions.ts as a default extension
 * [HERE]: extensions/defaults/recap/index.ts - on-demand situational recap; Free (deterministic, zero-token) by default, Smart (LLM-polished) via --smart
 */
import type { ExtensionAPI, ExtensionCommandContext } from "../../../core/extensions/types.js";
import { extractFreeRecap, formatFreeRecap } from "./recap-extractor.js";
import { createRecapRenderer } from "./recap-renderer.js";
import { hasMeaningfulActivity, synthesizeSmartRecap } from "./recap-synthesizer.js";
import { RECAP_DEFAULTS, RECAP_MESSAGE_TYPE, type RecapEntry } from "./recap-types.js";

const RECAP_TIMEOUT_MS = 30_000;

function emitFreeRecap(ctx: ExtensionCommandContext, api: ExtensionAPI): void {
	const entries = ctx.sessionManager.getEntries();
	const recap = extractFreeRecap(entries);
	const entry: RecapEntry = {
		source: "free",
		trigger: "manual",
		triggeredAt: Date.now(),
	};
	api.sendMessage<RecapEntry>({
		customType: RECAP_MESSAGE_TYPE,
		content: formatFreeRecap(recap),
		display: true,
		details: entry,
	});
}

async function handleRecapCommand(args: string, ctx: ExtensionCommandContext, api: ExtensionAPI): Promise<void> {
	const trimmed = args.trim();
	// Default is Free: real-session evaluation showed Free's deterministic
	// goal/next clauses are on par with Smart, and the zero-token / zero-wait
	// path is a better fit for "appears at the end of the turn" UX. Smart is
	// kept as an explicit opt-in for users who want LLM-polished facts.
	const wantSmart = trimmed === "--smart";
	const wantFree = trimmed === "" || trimmed === "--free";
	if (!wantFree && !wantSmart) {
		ctx.ui.notify(
			`Unknown /recap argument: ${trimmed}. Use /recap (Free, default) or /recap --smart (LLM-polished, costs tokens).`,
			"warning",
		);
		return;
	}

	// Pre-check before any further work so an empty session doesn't flash a
	// misleading "Synthesizing…" message before the no-activity reply.
	if (!hasMeaningfulActivity(ctx)) {
		ctx.ui.notify("Nothing to recap yet — start the conversation and try again.", "info");
		return;
	}

	if (wantFree) {
		// Deterministic path: zero LLM, zero wait, immediate render. Useful as
		// a quality baseline against Smart and as a hard-zero-cost fallback.
		emitFreeRecap(ctx, api);
		return;
	}

	if (!ctx.model) {
		ctx.ui.notify("Recap unavailable: no model is currently selected.", "warning");
		return;
	}

	ctx.ui.notify("Synthesizing recap…", "info");

	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		const result = await Promise.race([
			synthesizeSmartRecap(ctx, RECAP_DEFAULTS, "manual"),
			new Promise<{ kind: "timeout" }>((resolve) =>
				(timeout = setTimeout(() => resolve({ kind: "timeout" }), RECAP_TIMEOUT_MS)),
			),
		]);

		if (result.kind === "timeout") {
			ctx.ui.notify("Recap timed out after 30s.", "warning");
			return;
		}
		if (result.kind === "empty_session") {
			ctx.ui.notify("Nothing to recap yet — start the conversation and try again.", "info");
			return;
		}
		if (result.kind === "budget_blocked") {
			ctx.ui.notify(result.reason, "warning");
			return;
		}
		if (result.kind === "no_model") {
			ctx.ui.notify("Recap unavailable: no model is currently selected.", "warning");
			return;
		}
		if (result.kind === "no_response") {
			ctx.ui.notify("Recap unavailable: model returned no usable text (check API key).", "warning");
			return;
		}

		const entry: RecapEntry = {
			source: "smart",
			trigger: "manual",
			triggeredAt: Date.now(),
			usage: result.completion.usage,
		};

		api.sendMessage<RecapEntry>({
			customType: RECAP_MESSAGE_TYPE,
			content: result.completion.text.trim(),
			display: true,
			details: entry,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		ctx.ui.notify(`Recap error: ${message}`, "error");
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}

export default async function recapExtension(api: ExtensionAPI): Promise<void> {
	api.registerMessageRenderer(RECAP_MESSAGE_TYPE, createRecapRenderer());

	api.registerCommand("recap", {
		description: "Show a brief situational recap of the current task (goal, key facts, next decision). Free by default; add --smart for LLM-polished synthesis (costs tokens).",
		handler: (args, ctx) => handleRecapCommand(args, ctx, api),
	});
}
