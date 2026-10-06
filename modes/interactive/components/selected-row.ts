/**
 * [WHO]: renderSelectedRows — full-width selected-row treatment for mode selectors
 * [FROM]: Depends on @catui/tui ANSI width helpers and interactive theme
 * [TO]: Consumed by settings, model and extension selectors
 * [HERE]: modes/interactive/components/selected-row.ts — rendering-only selection decoration
 */
import { truncateToWidth, visibleWidth } from "@catui/tui";
import { theme } from "../theme/theme.js";

export function renderSelectedRows(lines: string[], width: number): string[] {
  return lines.map(line => {
    const plain = line.replace(/\x1b\[[0-9;]*m/g, "");
    if (!/^\s*(?:→|->|›) /.test(plain)) return line;
    const revised = truncateToWidth(line.replace(/→ |-> /, "› "), width);
    return theme.bg("selectedBg", revised + " ".repeat(Math.max(0, width - visibleWidth(revised))));
  });
}
