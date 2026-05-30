/**
 * [WHO]: createRecapRenderer() — MessageRenderer for RECAP_MESSAGE_TYPE custom messages
 * [FROM]: Depends on @pencil-agent/tui (Container, Spacer, Text), ./recap-types
 * [TO]: Consumed by extensions/builtin/recap/index.ts via api.registerMessageRenderer
 * [HERE]: extensions/builtin/recap/recap-renderer.ts - low-weight italic+dim ※ recap with inline token/cost accounting badge
 */
import { Container, Spacer, Text, type Component } from "@pencil-agent/tui";
import type { MessageRenderer } from "../../../core/extensions-host/types.js";
import type { RecapEntry } from "./recap-types.js";

const REFERENCE_MARK = "※"; // U+203B — monospace-friendly meta-message glyph

function formatHeader(entry: RecapEntry): string {
	if (entry.source === "free" || !entry.usage) {
		return `${REFERENCE_MARK} recap · free`;
	}
	const { input, output, cost } = entry.usage;
	const totalCost = cost.total.toFixed(4);
	return `${REFERENCE_MARK} recap · ${input} in / ${output} out · ~$${totalCost}`;
}

function extractContentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: "text"; text: string } =>
			typeof part === "object" && part !== null && (part as { type?: unknown }).type === "text",
		)
		.map((part) => part.text)
		.join("\n");
}

/**
 * Renderer registered via `api.registerMessageRenderer("recap", …)`.
 *
 * Layout (intentionally low-visual-weight — a recap is a *hint* to keep the
 * user on track, not a celebration):
 *
 *   ※ recap · 412 in / 89 out · ~$0.0021    <- italic dim header
 *   <recap body>                              <- italic dim body
 *
 * No background block, no border — just italic gray text so it reads as
 * a quiet in-conversation note rather than a headline card.
 *
 * Body uses Text (not Markdown) so we don't have to reach into
 * modes/interactive/theme for getMarkdownTheme — extensions stay
 * mode-agnostic.
 */
export function createRecapRenderer(): MessageRenderer<RecapEntry> {
	return (message, _options, theme): Component => {
		const entry = (message.details ?? { source: "smart", trigger: "manual", triggeredAt: Date.now() }) as RecapEntry;
		const body = extractContentText(message.content);

		const container = new Container();
		container.addChild(new Spacer(1));
		container.addChild(new Text(theme.italic(theme.fg("dim", formatHeader(entry))), 0, 0));
		if (body.trim()) {
			container.addChild(new Text(theme.italic(theme.fg("dim", body)), 0, 0));
		}
		return container;
	};
}
