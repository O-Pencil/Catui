/**
 * [WHO]: UserMessageComponent
 * [FROM]: Depends on @catui/tui, ../theme/theme.js
 * [TO]: Consumed by modes/interactive/components/index.ts
 * [HERE]: modes/interactive/components/user-message.ts - user message display component
 */

import { type Component, createNextComponent, Markdown, type MarkdownTheme, NextLegacy, Spacer } from "@catui/tui";
import { getMarkdownTheme, theme } from "../theme/theme.js";

/**
 * Component that renders a user message
 */
export class UserMessageComponent implements Component {
	private spacer = createNextComponent(NextLegacy({ component: new Spacer(1) }));
	private message: Component;

	constructor(text: string, markdownTheme: MarkdownTheme = getMarkdownTheme()) {
		this.message = createNextComponent(
			NextLegacy({
				component: new Markdown(text, 1, 1, markdownTheme, {
					bgColor: (text: string) => theme.bg("userMessageBg", text),
					color: (text: string) => theme.fg("userMessageText", text),
				}),
			}),
		);
	}

	invalidate(): void {
		this.spacer.invalidate();
		this.message.invalidate();
	}

	render(width: number): string[] {
		return [
			...this.spacer.render(width),
			...this.message.render(width),
		];
	}
}
