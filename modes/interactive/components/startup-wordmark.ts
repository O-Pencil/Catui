/**
 * [WHO]: StartupWordmarkComponent, renderStartupWordmark — terminal-native welcome lines
 * [FROM]: Depends on @catui/tui width helpers and interactive theme
 * [TO]: Consumed by controllers/chat-renderer.ts
 * [HERE]: modes/interactive/components/startup-wordmark.ts — fixed brand dot grid
 */
import { type Component, truncateToWidth } from "@catui/tui";
import { theme } from "../theme/theme.js";

const cat = [
  "1000000001", "1100000011", "1110000111", "1111111111", "1111111111",
  "1101111011", "1101111011", "1111001111", "0111111110", "0011111100",
];
const glyphs = [
  ["0011111100", "0111111110", "1110000000", "1100000000", "1100000000", "1100000000", "1100000000", "1110000000", "0111111110", "0011111100"],
  cat.slice().reverse().map(row => [...row].reverse().join("")),
  ["1111111111", "1111111111", "0000110000", "0000110000", "0000110000", "0000110000", "0000110000", "0000110000", "0000110000", "0000110000"],
  cat,
  ["0111111110", "0111111110", "0000110000", "0000110000", "0000110000", "0000110000", "0000110000", "0000110000", "0111111110", "0111111110"],
];

export class StartupWordmarkComponent implements Component {
  constructor(private readonly version: string, private readonly model: string) {}

  invalidate(): void { /* Width and theme are resolved on every render. */ }

  render(width: number): string[] {
    return renderStartupWordmark(width, this.version, this.model);
  }
}

export function renderStartupWordmark(width: number, version: string, model: string): string[] {
  const bits = [[0, 1, 2, 6], [3, 4, 5, 7]];
  const logo = width < 64 ? [theme.fg("accent", "  CATUI")] : Array.from({ length: 5 }, (_, row) =>
    theme.fg("accent", "  " + glyphs.map(glyph => Array.from({ length: 10 }, (_, x) => {
      let mask = 0;
      for (let dx = 0; dx < 2; dx++) {
        for (let dy = 0; dy < 4; dy++) {
          if (glyph[Math.floor((row * 4 + dy) / 2)][x] === "1") mask |= 1 << bits[dx][dy];
        }
      }
      return mask ? String.fromCodePoint(0x2800 + mask) : " ";
    }).join("")).join("   ")),
  );
  return [...logo, "", truncateToWidth(theme.fg("dim", `  v${version}  ·  ${model}`), width)];
}
