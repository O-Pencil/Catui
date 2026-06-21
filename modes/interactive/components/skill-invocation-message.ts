/**
 * [WHO]: SkillInvocationMessageComponent
 * [FROM]: Depends on @catui/tui, ../theme/theme.js, ./keybinding-hints.js
 * [TO]: Consumed by modes/interactive/components/index.ts
 * [HERE]: modes/interactive/components/skill-invocation-message.ts - skill invocation display
 */

import { Box, type Component, createNextComponent, Markdown, type MarkdownTheme, NextLegacy, Text } from "@catui/tui";
import type { ParsedSkillBlock } from "../../../core/runtime/agent-session.js";
import { getMarkdownTheme, theme } from "../theme/theme.js";
import { editorKey } from "./keybinding-hints.js";

/**
 * Component that renders a skill invocation message with collapsed/expanded state.
 * Uses same background color as custom messages for visual consistency.
 * Only renders the skill block itself - user message is rendered separately.
 */
export class SkillInvocationMessageComponent extends Box {
	private nextContent: Component;
	private expanded = false;
	private skillBlock: ParsedSkillBlock;
	private markdownTheme: MarkdownTheme;

	constructor(skillBlock: ParsedSkillBlock, markdownTheme: MarkdownTheme = getMarkdownTheme()) {
		super(1, 1, (t) => theme.bg("customMessageBg", t));
		this.nextContent = createNextComponent(
			NextLegacy({
				component: {
					render: (width: number) => this.renderLegacy(width),
					invalidate: () => this.invalidateLegacy(),
				},
			}),
		);
		this.skillBlock = skillBlock;
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

		if (this.expanded) {
			// Expanded: label + skill name header + full content
			const label = theme.fg("customMessageLabel", `\x1b[1m[skill]\x1b[22m`);
			this.addChild(new Text(label, 0, 0));
			const header = `**${this.skillBlock.name}**\n\n`;
			this.addChild(
				new Markdown(header + this.skillBlock.content, 0, 0, this.markdownTheme, {
					color: (text: string) => theme.fg("customMessageText", text),
				}),
			);
		} else {
			// Collapsed: single line - [skill] name (hint to expand)
			const line =
				theme.fg("customMessageLabel", `\x1b[1m[skill]\x1b[22m `) +
				theme.fg("customMessageText", this.skillBlock.name) +
				theme.fg("dim", ` (${editorKey("expandTools")} to expand)`);
			this.addChild(new Text(line, 0, 0));
		}
	}
}
