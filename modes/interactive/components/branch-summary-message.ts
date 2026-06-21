/**
 * [WHO]: BranchSummaryMessageComponent
 * [FROM]: Depends on @catui/tui, ../theme/theme.js, ./keybinding-hints.js
 * [TO]: Consumed by modes/interactive/components/index.ts
 * [HERE]: modes/interactive/components/branch-summary-message.ts - branch summary display
 */

import {
	Box,
	type Component,
	createNextComponent,
	Markdown,
	type MarkdownTheme,
	NextLegacy,
	Spacer,
	Text,
} from "@catui/tui";
import type { BranchSummaryMessage } from "../../../core/messages.js";
import { getMarkdownTheme, theme } from "../theme/theme.js";
import { editorKey } from "./keybinding-hints.js";

/**
 * Component that renders a branch summary message with collapsed/expanded state.
 * Uses same background color as custom messages for visual consistency.
 */
export class BranchSummaryMessageComponent extends Box {
	private nextContent: Component;
	private expanded = false;
	private message: BranchSummaryMessage;
	private markdownTheme: MarkdownTheme;

	constructor(message: BranchSummaryMessage, markdownTheme: MarkdownTheme = getMarkdownTheme()) {
		super(1, 1, (t) => theme.bg("customMessageBg", t));
		this.nextContent = createNextComponent(
			NextLegacy({
				component: {
					render: (width: number) => this.renderLegacy(width),
					invalidate: () => this.invalidateLegacy(),
				},
			}),
		);
		this.message = message;
		this.markdownTheme = markdownTheme;
		this.updateDisplay();
	}

	private renderLegacy(width: number): string[] {
		return super.render(width);
	}

	private invalidateLegacy(): void {
		super.invalidate();
	}

	override render(width: number): string[] {
		return this.nextContent.render(width);
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		this.updateDisplay();
	}

	override invalidate(): void {
		super.invalidate();
		this.updateDisplay();
	}

	private updateDisplay(): void {
		this.clear();

		const label = theme.fg("customMessageLabel", `\x1b[1m[branch]\x1b[22m`);
		this.addChild(new Text(label, 0, 0));
		this.addChild(new Spacer(1));

		if (this.expanded) {
			const header = "**Branch Summary**\n\n";
			this.addChild(
				new Markdown(header + this.message.summary, 0, 0, this.markdownTheme, {
					color: (text: string) => theme.fg("customMessageText", text),
				}),
			);
		} else {
			this.addChild(
				new Text(
					theme.fg("customMessageText", "Branch summary (") +
						theme.fg("dim", editorKey("expandTools")) +
						theme.fg("customMessageText", " to expand)"),
					0,
					0,
				),
			);
		}
	}
}
