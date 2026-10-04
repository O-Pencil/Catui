/**
 * [WHO]: Provides verify-structure CLI enforcing the two AGENTS.md quality
 *        rules that the rest of the repo's tooling cannot catch:
 *          1. Single TypeScript file size ≤ 800 lines
 *          2. Every source file in core/modes/extensions/packages carries a
 *             P3 header (`/**` block with `[WHO]` / `[FROM]` / `[TO]` /
 *             `[HERE]` markers) so map and terrain stay isomorphic.
 * [FROM]: Depends on node:fs/path only.
 * [TO]: Consumed by CI (quality.yml) and local `npm run verify:all`.
 * [HERE]: scripts/verify-structure.ts - structural invariant guard.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

// AGENTS.md "Each source file header: `[WHO]` `[FROM]` `[TO]` `[HERE]`" —
// measured as a single P3 comment block in the first 60 lines that contains
// at least three of the four markers. Auto-generated files and tests are
// exempt (tests live in `test/` not the SOURCE_ROOTS above; generated files
// are exempt via SIZE_EXEMPT_SUFFIXES).
const P3_REQUIRED_MARKERS = ["[WHO]", "[FROM]", "[TO]", "[HERE]"];
const P3_MIN_MARKERS_FOUND = 3;
const P3_SCAN_HEADER_LINES = 60;

interface Violation {
	file: string;
	kind: "size" | "p3-header";
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

function checkSize(repoPath: string, text: string, violations: Violation[]): void {
	if (isSizeExempt("", repoPath)) return;
	const lines = countLines(text);
	if (lines > MAX_FILE_LINES) {
		violations.push({
			file: repoPath,
			kind: "size",
			message: `${lines} lines > ${MAX_FILE_LINES} (AGENTS.md: single file lines limit). Split or add a justified exception.`,
		});
	}
}

function checkP3Header(repoPath: string, text: string, violations: Violation[]): void {
	if (isSizeExempt("", repoPath)) return;
	// Take just the first P3_SCAN_HEADER_LINES lines.
	const head = text.split("\n", P3_SCAN_HEADER_LINES).join("\n");
	// Find the first JSDoc block.
	const blockMatch = head.match(/\/\*\*[\s\S]*?\*\//);
	if (!blockMatch) {
		violations.push({
			file: repoPath,
			kind: "p3-header",
			message: `missing P3 JSDoc header (/** ... */) in first ${P3_SCAN_HEADER_LINES} lines. AGENTS.md: each source file needs P3 with [WHO]/[FROM]/[TO]/[HERE].`,
		});
		return;
	}
	const block = blockMatch[0];
	let hits = 0;
	for (const marker of P3_REQUIRED_MARKERS) {
		if (block.includes(marker)) hits++;
	}
	if (hits < P3_MIN_MARKERS_FOUND) {
		const found = P3_REQUIRED_MARKERS.filter((m) => block.includes(m));
		violations.push({
			file: repoPath,
			kind: "p3-header",
			message: `P3 header is missing markers (found ${hits}/${P3_REQUIRED_MARKERS.length}: ${found.join(", ") || "none"}). Need at least ${P3_MIN_MARKERS_FOUND} of ${P3_REQUIRED_MARKERS.join(" / ")}.`,
		});
	}
}

function toRepoPath(abs: string): string {
	const rel = abs.startsWith(REPO) ? abs.slice(REPO.length) : abs;
	return rel.replace(/^[/\\]/, "");
}

function main(): void {
	// Default: report-only (exit 0) so the script can land as a baseline
	// without breaking CI. Once the existing violations have been triaged,
	// pass `--strict` to make this an actual gate. The strict mode is
	// available now; CI opts in once the team is ready to enforce.
	const strict = process.argv.includes("--strict");

	const files = SOURCE_ROOTS.flatMap((root) => walk(join(REPO, root)));
	const violations: Violation[] = [];
	let scanned = 0;
	for (const file of files) {
		const repoPath = toRepoPath(file);
		let text: string;
		try {
			text = readFileSync(file, "utf8");
		} catch {
			continue;
		}
		scanned++;
		checkSize(repoPath, text, violations);
		checkP3Header(repoPath, text, violations);
	}

	const sizeCount = violations.filter((v) => v.kind === "size").length;
	const p3Count = violations.filter((v) => v.kind === "p3-header").length;

	if (violations.length === 0) {
		console.log(
			`verify-structure passed (${scanned} TypeScript files scanned; max ${MAX_FILE_LINES} lines; P3 header required)`,
		);
		return;
	}

	console.log(
		`verify-structure report: ${violations.length} violation(s) across ${scanned} files (${strict ? "STRICT" : "advisory"})`,
	);
	console.log(`  - size > ${MAX_FILE_LINES} lines: ${sizeCount}`);
	console.log(`  - missing P3 header:        ${p3Count}`);
	const shown = violations.slice(0, 30);
	for (const v of shown) {
		console.error(`- [${v.kind}] ${v.file}: ${v.message}`);
	}
	if (violations.length > shown.length) {
		console.error(`... and ${violations.length - shown.length} more`);
	}

	if (strict) {
		process.exit(1);
	}
}

main();
