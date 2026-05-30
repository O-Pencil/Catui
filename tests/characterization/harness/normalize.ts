/**
 * [WHO]: Provides normalize() — scrubs volatile tokens from captured stdout before golden diff
 * [FROM]: No external dependencies (pure string transforms)
 * [TO]: Consumed by characterization.test.ts and harness/run-case.ts
 * [HERE]: tests/characterization/harness/normalize.ts — determinism normalizer for golden comparison
 */

/** A volatile substring to replace (e.g. the per-run sandbox dir) discovered at runtime. */
export interface DynamicScrub {
  /** Literal string to find (escaped before use). */
  find: string;
  /** Stable placeholder to substitute. */
  to: string;
}

const ANSI = /\[[0-9;]*m/g;
const ISO_TS = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g;
const EPOCH_MS = /\b\d{13}\b/g;
const DURATION = /\b\d+(?:\.\d+)?\s?ms\b/g;
const DURATION_S = /\b\d+(?:\.\d+)?\s?s\b/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const HEX_ID = /\b[0-9a-f]{16,}\b/gi;
const HOME = /\/(?:home|Users)\/[^/\s"']+/g;
const TMP = /\/tmp\/[A-Za-z0-9._-]+/g;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replace run-to-run volatile tokens with stable placeholders so the same
 * behavior produces byte-identical text across runs and across branches.
 */
export function normalize(raw: string, dynamic: DynamicScrub[] = []): string {
  let out = raw;
  // Dynamic scrubs first (longest, most specific — e.g. the sandbox temp dir).
  for (const { find, to } of [...dynamic].sort((a, b) => b.find.length - a.find.length)) {
    if (!find) continue;
    out = out.replace(new RegExp(escapeRegExp(find), "g"), to);
  }
  out = out
    .replace(ANSI, "")
    .replace(ISO_TS, "<TS>")
    .replace(UUID, "<UUID>")
    .replace(TMP, "<TMP>")
    .replace(HOME, "<HOME>")
    .replace(EPOCH_MS, "<EPOCH>")
    .replace(DURATION, "<MS>")
    .replace(DURATION_S, "<S>")
    .replace(HEX_ID, "<HEX>");
  // Trim trailing whitespace per line + collapse trailing blank lines.
  out = out
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+$/g, "");
  return out + "\n";
}
