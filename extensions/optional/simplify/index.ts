/**
 * [WHO]: Simplify extension - Claude Code style code simplification tool
 * [FROM]: Depends on @pencil-agent/ai, @pencil-agent/tui, child_process, fs, path, core/extensions-host/types, modes/interactive/components/dynamic-border, modes/interactive/theme/theme
 * [TO]: Consumed by builtin-extensions.ts as optional extension
 * [HERE]: extensions/optional/simplify/index.ts - code simplification for NanoPencil
 *
 * Features:
 * 1. Perception layer: Scan Git Diff + read project rules + analyze code
 * 2. Decision layer: Apply refactoring patterns (guard clauses, expression folding, redundancy removal)
 * 3. Execution layer: Generate Diff and apply to files
 * 4. Validation layer: Run tests to verify, rollback on failure
 */


import { complete } from "@pencil-agent/ai/stream";
import { getModel } from "@pencil-agent/ai/models";
import { Container, Markdown, matchesKey, Text } from "@pencil-agent/tui";
import { execFileSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { isAbsolute, join, relative, resolve } from "path";
import type { ExtensionAPI, ExtensionCommandContext } from "../../../core/extensions-host/types.js";
import { DynamicBorder } from "../../../modes/interactive/components/dynamic-border.js";
import { getMarkdownTheme } from "../../../modes/interactive/theme/theme.js";

// =============================================================================
// Types
// =============================================================================

interface SimplifyResult {
	file: string;
	original: string;
	simplified: string;
	explanation: string;
}

interface SimplifyOptions {
	files?: string[];
	runTests?: boolean;
	dryRun?: boolean;
}

const SIMPLIFY_COMMAND_COMPLETIONS = [
	{ value: "--dry-run", label: "--dry-run", description: "Preview changes without writing files" },
	{ value: "--no-test", label: "--no-test", description: "Skip the verification command after applying changes" },
];

// =============================================================================
// Git Utilities
// =============================================================================

function getGitDiff(cwd: string): string {
	try {
		// Get both staged and unstaged changes
		const staged = execFileSync("git", ["diff", "--cached", "--name-only"], { cwd, encoding: "utf-8" });
		const unstaged = execFileSync("git", ["diff", "--name-only"], { cwd, encoding: "utf-8" });
		const combined = [...new Set([...staged.split("\n"), ...unstaged.split("\n")])];
		return combined.filter((f) => f.trim()).join("\n");
	} catch {
		return "";
	}
}

function getFileDiff(cwd: string, file: string): string {
	try {
		const diff = execFileSync("git", ["diff", "HEAD", "--", file], { cwd, encoding: "utf-8" });
		return diff || "";
	} catch {
		return "";
	}
}

function resolveWorkspaceFile(cwd: string, filePath: string): string | undefined {
	const fullPath = resolve(cwd, filePath);
	const rel = relative(cwd, fullPath);
	if (!rel || rel.startsWith("..") || isAbsolute(rel)) return undefined;
	return fullPath;
}

// =============================================================================
// Project Rules Loader
// =============================================================================

function loadProjectRules(cwd: string): string {
	const ruleFiles = ["AGENT.md", "CLAUDE.md", "AGENTS.md", ".cursor/rules", ".github/copilot-instructions.md"];
	const rules: string[] = [];

	for (const file of ruleFiles) {
		const path = join(cwd, file);
		if (existsSync(path)) {
			try {
				const content = readFileSync(path, "utf-8");
				rules.push(`=== ${file} ===\n${content.slice(0, 2000)}`);
			} catch {
				// ignore
			}
		}
	}

	return rules.join("\n\n");
}

// =============================================================================
// Test Runner
// =============================================================================

interface TestCommand {
	command: string;
	args: string[];
	label: string;
}

function detectTestCommand(cwd: string): TestCommand | null {
	const packageJsonPath = join(cwd, "package.json");
	if (existsSync(packageJsonPath)) {
		try {
			const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
			if (pkg.scripts?.test) {
				return { command: "npm", args: ["test"], label: "npm test" };
			}
		} catch {
			// ignore
		}
	}

	// Check for common test files
	const testPatterns = [
		{ pattern: "pytest.ini", command: "pytest", args: [], label: "pytest" },
		{ pattern: "setup.py", command: "python", args: ["-m", "pytest"], label: "python -m pytest" },
		{ pattern: "Cargo.toml", command: "cargo", args: ["test"], label: "cargo test" },
		{ pattern: "go.mod", command: "go", args: ["test", "./..."], label: "go test ./..." },
	];

	for (const { pattern, command, args, label } of testPatterns) {
		if (existsSync(join(cwd, pattern))) {
			return { command, args, label };
		}
	}

	return null;
}

function runTests(cwd: string): { success: boolean; output: string } {
	const testCmd = detectTestCommand(cwd);
	if (!testCmd) {
		return { success: true, output: "No test command detected, skipping tests" };
	}

	try {
		const output = execFileSync(testCmd.command, testCmd.args, { cwd, encoding: "utf-8", timeout: 120000 });
		return { success: true, output };
	} catch (error: unknown) {
		const err = error as { stdout?: string; stderr?: string };
		return {
			success: false,
			output: `${err.stdout || ""}\n${err.stderr || ""}`.trim(),
		};
	}
}

// =============================================================================
// Simplify Prompt
// =============================================================================

const SIMPLIFY_SYSTEM_PROMPT = `You are a code simplification expert. Your task is to refactor code to reduce cognitive load while preserving exact functionality.

CONSTRAINTS:
1. DO NOT change function signatures or external behavior
2. DO NOT add or remove functionality
3. DO NOT change the public API
4. Preserve all side effects exactly

REFACTORING PATTERNS (apply in order of priority):
1. Guard Clauses: Convert nested if-else to early returns
   - Before: if (x) { if (y) { ...long code... } }
   - After: if (!x) return; if (!y) return; ...long code...

2. Expression Folding: Simplify boolean logic
   - Before: if (x === true) -> After: if (x)
   - Before: if (!(a && b)) -> After: if (!a || !b)

3. Redundancy Removal:
   - Remove unnecessary intermediate variables
   - Remove unused private methods
   - Remove outdated comments

4. Loop Simplification:
   - Convert forEach + push to map/filter
   - Use array methods over manual iteration

OUTPUT FORMAT:
Return a JSON object with:
{
  "simplified": "the simplified code",
  "explanation": "brief explanation of changes made",
  "equivalent": true/false // whether the refactored code is functionally equivalent
}

If no simplification is needed, return:
{
  "simplified": null,
  "explanation": "Code is already simple and clean",
  "equivalent": true
}`;

function buildSimplifyUserPrompt(code: string, rules: string, diff?: string): string {
	let prompt = `Simplify the following code according to the constraints above.\n\n`;

	if (rules) {
		prompt += `PROJECT RULES (must follow):\n${rules}\n\n`;
	}

	if (diff) {
		prompt += `FOCUS AREA (prioritize changes in this diff):\n\`\`\`diff\n${diff}\n\`\`\`\n\n`;
	}

	prompt += `CODE TO SIMPLIFY:\n\`\`\`\n${code}\n\`\`\``;

	return prompt;
}

// =============================================================================
// LLM Integration
// =============================================================================

async function simplifyWithLLM(
	code: string,
	rules: string,
	diff: string | undefined,
	ctx: ExtensionCommandContext,
): Promise<{ simplified: string | null; explanation: string; equivalent: boolean }> {
	// Try to use the current model, fallback to a known good model
	let model = ctx.model;
	let apiKey = model ? await ctx.modelRegistry.getApiKey(model) : undefined;

	// If no model available, try common fallbacks
	if (!model || !apiKey) {
		// Try anthropic
		const anthropicModel = getModel("anthropic", "claude-sonnet-4-5");
		if (anthropicModel) {
			const key = await ctx.modelRegistry.getApiKey(anthropicModel);
			if (key) {
				model = anthropicModel;
				apiKey = key;
			}
		}
		// Try openai
		if (!model || !apiKey) {
			const openaiModel = getModel("openai", "gpt-4o");
			if (openaiModel) {
				const key = await ctx.modelRegistry.getApiKey(openaiModel);
				if (key) {
					model = openaiModel;
					apiKey = key;
				}
			}
		}
		// Try google
		if (!model || !apiKey) {
			const googleModel = getModel("google", "gemini-2.5-flash");
			if (googleModel) {
				const key = await ctx.modelRegistry.getApiKey(googleModel);
				if (key) {
					model = googleModel;
					apiKey = key;
				}
			}
		}
	}

	if (!model || !apiKey) {
		throw new Error("No model available for simplification");
	}

	const response = await complete(
		model,
		{
			systemPrompt: SIMPLIFY_SYSTEM_PROMPT,
			messages: [
				{
					role: "user",
					content: [{ type: "text", text: buildSimplifyUserPrompt(code, rules, diff) }],
					timestamp: Date.now(),
				},
			],
		},
		{ apiKey, maxTokens: 4096, temperature: 0.2 },
	);

	const text = response.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("");

	// Parse JSON response
	try {
		const cleaned = text
			.replace(/```json?\n?/g, "")
			.replace(/```/g, "")
			.trim();
		return JSON.parse(cleaned);
	} catch {
		// If JSON parsing fails, treat as no simplification
		return { simplified: null, explanation: "Failed to parse LLM response", equivalent: false };
	}
}

// =============================================================================
// UI Components
// =============================================================================

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

			const diffContent = `## Simplify: ${result.file}

### Explanation
${result.explanation}

### Changes
\`\`\`diff
- Original (${result.original.split("\n").length} lines)
+ Simplified (${result.simplified.split("\n").length} lines)
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
// Main Simplify Logic
// =============================================================================

async function simplifyFile(
	filePath: string,
	cwd: string,
	rules: string,
	ctx: ExtensionCommandContext,
): Promise<SimplifyResult | null> {
	const fullPath = resolveWorkspaceFile(cwd, filePath);
	if (!fullPath) {
		ctx.ui.notify(`Refusing to simplify file outside workspace: ${filePath}`, "warning");
		return null;
	}
	if (!existsSync(fullPath)) {
		ctx.ui.notify(`File not found: ${filePath}`, "warning");
		return null;
	}

	const original = readFileSync(fullPath, "utf-8");
	const diff = getFileDiff(cwd, filePath);

	ctx.ui.notify(`Analyzing: ${filePath}...`, "info");

	try {
		const result = await simplifyWithLLM(original, rules, diff, ctx);

		if (!result.simplified || !result.equivalent) {
			ctx.ui.notify(`Skipping ${filePath}: ${result.explanation}`, "info");
			return null;
		}

		return {
			file: filePath,
			original,
			simplified: result.simplified,
			explanation: result.explanation,
		};
	} catch (error) {
		ctx.ui.notify(`Error simplifying ${filePath}: ${error}`, "error");
		return null;
	}
}

async function executeSimplify(options: SimplifyOptions, ctx: ExtensionCommandContext) {
	const cwd = ctx.cwd;
	const rules = loadProjectRules(cwd);

	// Determine files to simplify
	let files = options.files || [];
	if (files.length === 0) {
		// Get files from git diff
		const diffFiles = getGitDiff(cwd);
		files = diffFiles
			.split("\n")
			.filter((f) => f.trim())
			.filter((f) => /\.(ts|tsx|js|jsx|py|go|rs|java|c|cpp|cs)$/.test(f));

		if (files.length === 0) {
			ctx.ui.notify("No changed files found. Use /simplify <file> to simplify a specific file.", "info");
			return;
		}
	}

	ctx.ui.notify(`Found ${files.length} file(s) to analyze`, "info");

	const results: SimplifyResult[] = [];
	const backups = new Map<string, string>();

	// Analyze and collect simplification suggestions
	for (const file of files) {
		const result = await simplifyFile(file, cwd, rules, ctx);
		if (result) {
			results.push(result);
		}
	}

	if (results.length === 0) {
		ctx.ui.notify("No simplifications needed. Code is already clean!", "info");
		return;
	}

	ctx.ui.notify(`Found ${results.length} simplification(s)`, "info");

	// Preview and apply each simplification
	const applied: SimplifyResult[] = [];

	for (const result of results) {
		if (options.dryRun) {
			ctx.ui.notify(`[Dry Run] Would simplify: ${result.file}`, "info");
			continue;
		}

		const action = await showSimplifyPreview(result, ctx);

		if (action === "cancel") {
			ctx.ui.notify("Simplification cancelled", "info");
			// Rollback any applied changes
			for (const [file, content] of backups) {
				const fullPath = resolveWorkspaceFile(cwd, file);
				if (fullPath) writeFileSync(fullPath, content, "utf-8");
			}
			return;
		}

		if (action === "apply") {
			// Backup original
			backups.set(result.file, result.original);

			// Apply change
			const fullPath = resolveWorkspaceFile(cwd, result.file);
			if (!fullPath) {
				ctx.ui.notify(`Refusing to write outside workspace: ${result.file}`, "error");
				continue;
			}
			writeFileSync(fullPath, result.simplified, "utf-8");
			applied.push(result);
			ctx.ui.notify(`Applied: ${result.file}`, "info");
		}
	}

	if (applied.length === 0) {
		ctx.ui.notify("No changes applied", "info");
		return;
	}

	// Run tests if enabled
	if (options.runTests) {
		ctx.ui.notify("Running tests to verify changes...", "info");
		const testResult = runTests(cwd);

		if (!testResult.success) {
			ctx.ui.notify("Tests failed! Rolling back changes...", "error");

			// Rollback all changes
			for (const [file, content] of backups) {
				const fullPath = resolveWorkspaceFile(cwd, file);
				if (fullPath) writeFileSync(fullPath, content, "utf-8");
			}

			ctx.ui.notify(
				`Rolled back ${backups.size} file(s). Test output:\n${testResult.output.slice(0, 500)}`,
				"error",
			);
			return;
		}

		ctx.ui.notify("Tests passed!", "info");
	}

	// Summary
	const totalLinesSaved = applied.reduce((sum, r) => {
		return sum + (r.original.split("\n").length - r.simplified.split("\n").length);
	}, 0);

	ctx.ui.notify(
		`Simplification complete! Applied ${applied.length} change(s), saved ~${totalLinesSaved} lines.`,
		"info",
	);
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default function simplifyExtension(api: ExtensionAPI) {
	api.registerCommand("simplify", {
		description: "Suggest smaller code changes for files you choose",
		getArgumentCompletions: (prefix, context) => {
			if (context && context.tokenIndex > 0) return null;
			const normalizedPrefix = prefix.trim().toLowerCase();
			const options = SIMPLIFY_COMMAND_COMPLETIONS.filter((item) => item.value.startsWith(normalizedPrefix));
			return options.length > 0 ? options : null;
		},
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/).filter(Boolean);
			const options: SimplifyOptions = {
				files: [],
				runTests: true,
				dryRun: false,
			};

			for (const part of parts) {
				if (part === "--dry-run") {
					options.dryRun = true;
				} else if (part === "--no-test") {
					options.runTests = false;
				} else if (!part.startsWith("--")) {
					options.files!.push(part);
				}
			}

			await executeSimplify(options, ctx);
		},
	});

	// Also register a shortcut for quick access
	api.registerShortcut("ctrl+shift+s", {
		description: "Simplify changed files",
		handler: async (ctx) => {
			const cmdCtx = ctx as ExtensionCommandContext;
			await executeSimplify({ runTests: true }, cmdCtx);
		},
	});
}

export const __testUtils = {
	getGitDiff,
	getFileDiff,
	resolveWorkspaceFile,
	detectTestCommand,
	runTests,
};
