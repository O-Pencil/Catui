/**
 * [WHO]: Box, BoxProps
 * [FROM]: Depends on ../types.js for tui-next node contracts
 * [TO]: Consumed by core/lib/tui/src/next/index.ts and legacy adapter tests
 * [HERE]: core/lib/tui/src/next/components/Box.ts - CC-style box primitive
 */

import type { BoxNode, NextChild } from "../types.js";

export interface BoxProps {
	readonly children?: NextChild;
	readonly paddingX?: number;
	readonly paddingY?: number;
}

/**
 * Minimal Catui-owned counterpart to Claude-Code's `<Box>`.
 *
 * This intentionally preserves the prop names used by Claude-Code while the
 * full React reconciler is still isolated behind the next-engine boundary.
 */
export function Box(props: BoxProps): BoxNode {
	return {
		type: "box",
		children: props.children,
		paddingX: props.paddingX,
		paddingY: props.paddingY,
	};
}

