/**
 * [WHO]: Box, Text, createNextComponent, tui-next node types
 * [FROM]: Depends on ./components and ./legacy-adapter.js
 * [TO]: Consumed by tui-next tests and future interactive migration slices
 * [HERE]: core/lib/tui/src/next/index.ts - internal tui-next barrel
 */

export { Box, type BoxProps } from "./components/Box.js";
export { NextLegacy, type LegacyProps } from "./components/Legacy.js";
export { Text, type TextProps } from "./components/Text.js";
export { createNextComponent } from "./legacy-adapter.js";
export type { BoxNode, LegacyNode, NextChild, NextNode, TextNode } from "./types.js";
