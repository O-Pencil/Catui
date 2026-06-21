/**
 * [WHO]: NextChild, NextNode, NextRenderable, TextNode, BoxNode, LegacyNode
 * [FROM]: Depends on no runtime modules; defines tui-next node contracts
 * [TO]: Consumed by core/lib/tui/src/next components and legacy adapter
 * [HERE]: core/lib/tui/src/next/types.ts - internal next-engine node model
 */

export type NextChild = NextNode | string | number | boolean | null | undefined | NextChild[];

export interface NextRenderable {
	type: string;
}

export interface TextNode extends NextRenderable {
	type: "text";
	children?: NextChild;
	wrap?: "wrap" | "truncate" | "truncate-end" | "truncate-start" | "truncate-middle";
}

export interface BoxNode extends NextRenderable {
	type: "box";
	children?: NextChild;
	paddingX?: number;
	paddingY?: number;
}

export interface LegacyNode extends NextRenderable {
	type: "legacy";
	component: {
		render(width: number): string[];
		invalidate?(): void;
	};
}

export type NextNode = TextNode | BoxNode | LegacyNode;
