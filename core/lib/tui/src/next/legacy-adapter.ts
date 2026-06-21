/**
 * [WHO]: createNextComponent
 * [FROM]: Depends on ../tui.js Component, ../utils.js width helpers, ./types.js nodes
 * [TO]: Consumed by core/lib/tui/src/next/index.ts and migration tests
 * [HERE]: core/lib/tui/src/next/legacy-adapter.ts - bridges tui-next nodes to legacy Component
 */

import type { Component } from "../tui.js";
import { sliceByColumn, visibleWidth } from "../utils.js";
import type { BoxNode, LegacyNode, NextChild, NextNode, TextNode } from "./types.js";

function normalizePadding(value: number | undefined): number {
	if (value === undefined) return 0;
	return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function padOrClip(line: string, width: number): string {
	const safeWidth = Math.max(0, width);
	const clipped = visibleWidth(line) > safeWidth ? sliceByColumn(line, 0, safeWidth, true) : line;
	return clipped + " ".repeat(Math.max(0, safeWidth - visibleWidth(clipped)));
}

function flattenChildren(child: NextChild): Array<NextNode | string | number | boolean> {
	if (child === null || child === undefined) return [];
	if (Array.isArray(child)) return child.flatMap((item) => flattenChildren(item));
	return [child];
}

function renderText(node: TextNode, width: number): string[] {
	const text = flattenChildren(node.children)
		.map((child) => (typeof child === "object" ? renderNode(child, width).join("") : String(child)))
		.join("");
	return [padOrClip(text, width)];
}

function renderBox(node: BoxNode, width: number): string[] {
	const paddingX = Math.min(normalizePadding(node.paddingX), Math.max(0, Math.floor(width / 2)));
	const paddingY = normalizePadding(node.paddingY);
	const innerWidth = Math.max(0, width - paddingX * 2);
	const left = " ".repeat(paddingX);
	const right = left;

	const renderedChildren = flattenChildren(node.children).flatMap((child) => {
		if (typeof child === "object") return renderNode(child, innerWidth);
		return [padOrClip(String(child), innerWidth)];
	});

	const lines: string[] = [];
	for (let i = 0; i < paddingY; i++) lines.push(" ".repeat(width));
	for (const line of renderedChildren) {
		lines.push(padOrClip(left + line + right, width));
	}
	for (let i = 0; i < paddingY; i++) lines.push(" ".repeat(width));
	return lines;
}

function renderLegacy(node: LegacyNode, width: number): string[] {
	return node.component.render(width).map((line) => padOrClip(line, width));
}

function renderNode(node: NextNode, width: number): string[] {
	switch (node.type) {
		case "text":
			return renderText(node, width);
		case "box":
			return renderBox(node, width);
		case "legacy":
			return renderLegacy(node, width);
		default:
			return [];
	}
}

export function createNextComponent(root: NextNode): Component {
	return {
		render(width: number): string[] {
			return renderNode(root, width);
		},
		invalidate(): void {
			if (root.type === "legacy") root.component.invalidate?.();
		},
	};
}
