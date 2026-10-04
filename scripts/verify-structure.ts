/**
 * [WHO]: Provides verify-structure CLI enforcing the AGENTS.md file-size rule
 *        (single TypeScript file ≤ 800 lines), ratcheted against
 *        .dev-docs/structure-baseline.json so the limit can only tighten.
 * [FROM]: Depends on node:fs/path and scripts/lib/dip-baseline.ts.
 * [TO]: Consumed by CI (quality.yml, ci.yml) and local `npm run verify:all`.
 * [HERE]: scripts/verify-structure.ts - file-size invariant guard.
 *
 * P3 header conformance is NOT checked here. verify-dip.ts owns it, because
 * this script's old header check accepted a block found anywhere in the first
 * 60 lines and accepted 3-of-4 markers, which cleared 34 files whose P3 sits
 * behind a descriptive JSDoc — exactly the buried case that does not gatekeep.
 * One rule, one owner, one ratchet.
 *
 * Exit codes:
 *   0 = No size violation outside the baseline
 *   1 = A file outside the baseline exceeds the limit
 *
 * Flags:
 *   --update-baseline  rewrite the shared baseline from current state
 *   --allow-grow       permit that rewrite to add entries (refused by default)
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { partitionByBaseline, saveBaseline } from "./lib/dip-baseline.js";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const SOURCE_ROOTS = ["cli", "core", "modes", "extensions", "packages", "scripts"];

// AGENTS.md "Single file lines: ~800 max (split or justify exceptions)" — the
// limit is hard, not soft. Auto-generated `.generated.ts` files and the
// sub-package `test/` workspaces are exempt.
const MAX_FILE_LINES = 800;
const SIZE_EXEMPT_SUFFIXES = [".generated.ts"];
const SIZE_EXEMPT_PATH_PREFIXES = [
	"core/lib/ai/test/",
	"core/lib/agent-core/test/",
	"core/lib/tui/test/",
];

interface Violation {
	key: string;
	repoPath: string;
	lines: number;
	message: string;
}

function isSizeExempt(absPath: string, repoPath: string): boolean {
	if (SIZE_EXEMPT_SUFFIXES.some((suffix) => repoPath.endsWith(suffix))) return true;
	if (SIZE_EXEMPT_PATH_PREFIXES.some((prefix) => repoPath.startsWith(prefix))) return true;
	return false;
}

function walk(dir: string, out: string[] = []): string[] {
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return out;
	}
	for (const entry of entries) {
		if (
			entry === "node_modules" ||
			entry === "dist" ||
			entry === ".git" ||
			entry === ".baseline-out" ||
			entry === ".tmp" ||
			entry === ".worktrees"
		) {
			continue;
		}
		const abs = join(dir, entry);
		let st;
		try {
			st = statSync(abs);
		} catch {
			continue;
		}
		if (st.isDirectory()) {
			walk(abs, out);
		} else if (st.isFile() && extname(entry) === ".ts") {
			out.push(abs);
		}
	}
	return out;
}

function countLines(text: string): number {
	if (text.length === 0) return 0;
	let count = 1;
	for (let i = 0; i < text.length; i++) {
		if (text.charCodeAt(i) === 10) count++;
	}
	return count;
}

function toRepoPath(abs: string): string {
	return relative(REPO, abs).replace(/^[/\\]/, "");
}

function main(): void {
	const updateBaseline = process.argv.includes("--update-baseline");
	const allowGrow = process.argv.includes("--allow-grow");

	const files = SOURCE_ROOTS.flatMap((root) => walk(join(REPO, root)));
	const violations: Violation[] = [];
	let scanned = 0;
	for (const file of files) {
		const repoPath = toRepoPath(file);
		if (isSizeExempt("", repoPath)) continue;
		let text: string;
		try {
			text = readFileSync(file, "utf8");
		} catch {
			continue;
		}
		scanned++;
		const lines = countLines(text);
		if (lines > MAX_FILE_LINES) {
			violations.push({
				key: `SIZE-OVER-LIMIT:${repoPath}`,
				repoPath,
				lines,
				message: `${lines} lines > ${MAX_FILE_LINES} (AGENTS.md: single file lines limit). Split it, or record a justified exception.`,
			});
		}
	}

	if (updateBaseline) {
		const written = saveBaseline(
			violations.map((v) => v.key),
			["SIZE-OVER-LIMIT:"],
			allowGrow,
		);
		console.log(`📌 Baseline written by verify-structure: ${written} total known violation(s)`);
		return;
	}

	const { known, fresh } = partitionByBaseline(violations);
	const freshKeys = new Set(fresh.map((f) => f.key));
	const freshViolations = violations.filter((v) => freshKeys.has(v.key));

	console.log(`verify-structure: ${scanned} TypeScript files scanned, ${violations.length} over ${MAX_FILE_LINES} lines`);
	if (known.length > 0) {
		console.log(`📌 ${known.length} known oversize file(s) tracked in the baseline (debt, not a regression)`);
	}

	if (freshViolations.length === 0) {
		console.log(`✅ no file outside the baseline exceeds ${MAX_FILE_LINES} lines`);
		return;
	}

	for (const v of freshViolations) {
		console.error(`- [SIZE-OVER-LIMIT] ${v.repoPath}: ${v.message}`);
	}
	console.error(`\n${freshViolations.length} new oversize file(s). Split them, or extend the baseline deliberately.`);
	process.exit(1);
}

main();
