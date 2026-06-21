/**
 * [WHO]: Text, TextProps
 * [FROM]: Depends on ../types.js for tui-next node contracts
 * [TO]: Consumed by core/lib/tui/src/next/index.ts and legacy adapter tests
 * [HERE]: core/lib/tui/src/next/components/Text.ts - CC-style text primitive
 */

import type { NextChild, TextNode } from "../types.js";

export interface TextProps {
	/**
	 * This property mirrors Claude-Code's Ink Text `wrap` prop shape for the
	 * next-engine bridge. The first slice only needs truncation safety.
	 */
	readonly wrap?: TextNode["wrap"];
	readonly children?: NextChild;
}

export function Text(props: TextProps): TextNode {
	return {
		type: "text",
		children: props.children,
		wrap: props.wrap,
	};
}

