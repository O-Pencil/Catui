/**
 * [WHO]: Provides simplifyExtension entry point for /simplify command registration and preview/apply workflow
 * [FROM]: Depends on @catui/tui, ExtensionAPI, DynamicBorder, simplify parser/analyzer/controller/test/git helpers
 * [TO]: Consumed by optional extension loader and builtin extension registry
 * [HERE]: extensions/optional/simplify/index.ts - simplify extension orchestration and UI preview surface
 */

import { Container, Markdown, matchesKey, Text } from "@catui/tui";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { ExtensionAPI, ExtensionCommandContext } from "../../../core/extensions-host/types.js";
import { DynamicBorder } from "../../../modes/interactive/components/dynamic-border.js";
import { getMarkdownTheme } from "../../../modes/interactive/theme/theme.js";
import { SimplifyController, processFilesParallel, getContentHash } from "./simplify-controller.js";
import { parseOptions } from "./simplify-parser.js";
import { simplifyWithLLM } from "./simplify-analyzer.js";
import { runTests } from "./test-detector.js";
import { getChangedFiles, getFileDiff, loadProjectRules } from "./git-utils.js";
import type { SimplifyResult, SimplifyOptions } from "./simplify-types.js";

// =============================================================================
// UI Components
// =============================================================================

/**
 * Show preview dialog for a simplification result
 * Returns user action: apply, skip, or cancel
 */
async function showSimplifyPreview(
	result: SimplifyResult,
	ctx: ExtensionCommandContext,
): Promise<"apply" | "skip" | "cancel"> {
	if (!ctx.hasUI) {
		return "apply";
	}

	return new Promise((resolve) => {
		ctx.ui.custom((_tui, theme, _kb, done) => {
			const container = new Container();
			const border = new DynamicBorder((s: string) => theme.fg("accent", s));
			const mdTheme = getMarkdownTheme();

			const originalLines = result.original.split("\n").length;
			const simplifiedLines = result.simplified.split("\n").length;
			const linesDiff = originalLines - simplifiedLines;

			const diffContent = `## Simplify: ${result.file}

### Explanation
${result.explanation}

### Changes
\`\`\`diff
- Original (${originalLines} lines)
+ Simplified (${simplifiedLines} lines, ${linesDiff > 0 ? `-${linesDiff}` : `+${Math.abs(linesDiff)}`} lines)
\`\`\`

Press **y** to apply, **n** to skip, **q** to cancel all`;

			container.addChild(border);
			container.addChild(new Text(theme.fg("accent", theme.bold("Code Simplification Preview")), 1, 0));
			container.addChild(new Markdown(diffContent, 1, 1, mdTheme));
			container.addChild(border);

			return {
				render: (width: number) => container.render(width),
				invalidate: () => container.invalidate(),
				handleInput: (data: string) => {
					if (matchesKey(data, "y")) {
						done("apply");
						resolve("apply");
					} else if (matchesKey(data, "n")) {
						done("skip");
						resolve("skip");
					} else if (matchesKey(data, "q") || matchesKey(data, "escape")) {
						done("cancel");
						resolve("cancel");
					}
				},
			};
		});
	});
}

// =============================================================================
// File Simplification
// =============================================================================

/**
 * Analyze a single file and return simplification result
 * Uses caching to skip unchanged files
 */
async function simplifyFile(
	filePath: string,
	options: SimplifyOptions,
	controller: SimplifyController,
	ctx: ExtensionCommandContext,
): Promise<SimplifyResult | null> {
	const cwd = ctx.cwd;
	const fullPath = join(cwd, filePath);

	if (!existsSync(fullPath)) {
		ctx.ui.notify(`File not found: ${filePath}`, "warning");
		return null;
	}

	const original = readFileSync(fullPath, "utf-8");
	const hash = getContentHash(original);

	// Check cache (unless --force)
	if (!options.force) {
		const cached = controller.getCached(filePath, hash);
		if (cached) {
			ctx.ui.notify(`Cache hit: ${filePath}`, "info");
			return cached;
		}
	}

	const diff = getFileDiff(cwd, filePath);
	const rules = loadProjectRules(cwd);

	ctx.ui.notify(`Analyzing: ${filePath}...`, "info");

	try {
		const result = await simplifyWithLLM(original, rules, diff, ctx);

		if (!result.simplified || !result.equivalent) {
			ctx.ui.notify(`Skipping ${filePath}: ${result.explanation}`, "info");
			return null;
		}

		const simplifyResult: SimplifyResult = {
			file: filePath,
			original,
			simplified: result.simplified,
			explanation: result.explanation,
		};

		// Cache the result
		controller.setCached(filePath, hash, simplifyResult);

		return simplifyResult;
	} catch (error) {
		ctx.ui.notify(`Error simplifying ${filePath}: ${error}`, "error");
		return null;
	}
}

// =============================================================================
// Main Execution
// =============================================================================

/**
 * Execute simplify operation with the given options
 */
async function executeSimplify(options: SimplifyOptions, ctx: ExtensionCommandContext) {
	const cwd = ctx.cwd;
	const controller = new SimplifyController();
	const concurrency = options.concurrency ?? 3;

	// Determine files to simplify
	let files = options.files?.length ? options.files : [];

	if (files.length === 0) {
		// Get files from git diff
		files = getChangedFiles(cwd).filter((f) =>
			/\.(ts|tsx|js|jsx|py|go|rs|java|c|cpp|cs)$/.test(f),
		);

		if (files.length === 0) {
			ctx.ui.notify(
				"No changed files found. Use /simplify <file> to simplify a specific file.",
				"info",
			);
			return;
		}
	}

	ctx.ui.notify(
		`Analyzing ${files.length} file(s) with concurrency=${concurrency}...`,
		"info",
	);

	// Process files concurrently with caching
	const results = await processFilesParallel(
		files,
		concurrency,
		(file) => simplifyFile(file, options, controller, ctx),
		(completed, total) => {
			ctx.ui.notify(`Progress: ${completed}/${total} files`, "info");
		},
	);

	if (results.length === 0) {
		ctx.ui.notify("No simplifications needed. Code is already clean!", "info");
		return;
	}

	ctx.ui.notify(`Found ${results.length} simplification(s)`, "info");

	// Preview and apply each simplification
	for (const result of results) {
		if (options.dryRun) {
			ctx.ui.notify(`[Dry Run] Would simplify: ${result.file}`, "info");
			continue;
		}

		const action = await showSimplifyPreview(result, ctx);

		if (action === "cancel") {
			ctx.ui.notify("Simplification cancelled. Rolling back applied changes...", "info");
			controller.rollback(cwd);
			return;
		}

		if (action === "apply") {
			// Backup and apply
			controller.backup(result.file, result.original);
			writeFileSync(join(cwd, result.file), result.simplified, "utf-8");
			controller.recordApply(result);
			ctx.ui.notify(`Applied: ${result.file}`, "info");
		}
	}

	// Check if any changes were applied
	const summary = controller.getSummary();
	if (summary.applied === 0) {
		ctx.ui.notify("No changes applied", "info");
		return;
	}

	// Run tests if enabled
	if (options.runTests) {
		ctx.ui.notify("Running tests to verify changes...", "info");
		const testResult = runTests(cwd);

		if (!testResult.success) {
			ctx.ui.notify("Tests failed! Rolling back changes...", "error");
			controller.rollback(cwd);

			ctx.ui.notify(
				`Rolled back ${summary.applied} file(s). Test output:\n${testResult.output.slice(0, 500)}`,
				"error",
			);
			return;
		}

		ctx.ui.notify("Tests passed!", "info");
	}

	// Summary
	ctx.ui.notify(
		`Simplification complete! Applied ${summary.applied} change(s), saved ~${summary.linesSaved} lines.`,
		"info",
	);
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default function simplifyExtension(pi: ExtensionAPI) {
	pi.registerCommand("simplify", {
		description: "Suggest smaller code changes",
		getArgumentCompletions: (prefix, context) => {
			if (context && context.tokenIndex > 0) return null;
			const options = [
				{ value: "--dry-run", label: "--dry-run", description: "Preview changes without writing files" },
				{ value: "--no-test", label: "--no-test", description: "Skip running tests after applying changes" },
				{ value: "--concurrency=", label: "--concurrency=", description: "Set how many file simplifications run at once" },
				{ value: "--force", label: "--force", description: "Apply suggestions even when the safety check is conservative" },
			];
			return options.filter((option) => option.value.startsWith(prefix));
		},
		handler: async (args, ctx) => {
			const options = parseOptions(args);
			await executeSimplify(options, ctx as ExtensionCommandContext);
		},
	});

	// Keyboard shortcut for quick access
	pi.registerShortcut("ctrl+shift+s", {
		description: "Simplify changed files",
		handler: async (ctx) => {
			await executeSimplify({ runTests: true }, ctx as ExtensionCommandContext);
		},
	});
}
