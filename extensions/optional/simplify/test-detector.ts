/**
 * [WHO]: Provides detectTestCommand(), runTests(), MONOREPO_MARKERS
 * [FROM]: Depends on node fs/path/child_process and simplify TestDetection type
 * [TO]: Consumed by extensions/optional/simplify/index.ts for post-apply verification
 * [HERE]: extensions/optional/simplify/test-detector.ts - monorepo-aware test command detection and execution
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import type { TestDetection } from "./simplify-types.js";

// =============================================================================
// Monorepo Detection
// =============================================================================

/**
 * Markers that indicate a monorepo structure
 */
const MONOREPO_MARKERS = ["lerna.json", "nx.json", "turbo.json", "pnpm-workspace.yaml"];

/**
 * Check if the directory is a monorepo root
 */
function isMonorepo(cwd: string): boolean {
	return MONOREPO_MARKERS.some((marker) => existsSync(join(cwd, marker)));
}

// =============================================================================
// Test Command Detection
// =============================================================================

/**
 * Detect the appropriate test command for the project
 *
 * Detection order:
 * 1. package.json scripts.test (if not a placeholder)
 * 2. Framework-specific config files (pytest, cargo, go)
 *
 * Returns confidence level (0-1) indicating detection quality
 */
export function detectTestCommand(cwd: string): TestDetection {
	const monorepo = isMonorepo(cwd);

	// Check package.json for npm test
	const pkgPath = join(cwd, "package.json");
	if (existsSync(pkgPath)) {
		try {
			const raw = readFileSync(pkgPath, "utf-8");
			const pkg = JSON.parse(raw) as { scripts?: { test?: string } };

			// Check if test script exists and is not a placeholder
			if (pkg.scripts?.test && !isPlaceholderTest(pkg.scripts.test)) {
				return {
					command: monorepo ? "npm test" : "npm test",
					confidence: monorepo ? 0.7 : 0.9,
					isMonorepo: monorepo,
				};
			}
		} catch {
			// Ignore parse errors
		}
	}

	// Framework-specific detection
	const frameworks: Array<{ pattern: string; cmd: string; confidence: number }> = [
		{ pattern: "pytest.ini", cmd: "pytest", confidence: 0.9 },
		{ pattern: "setup.py", cmd: "python -m pytest", confidence: 0.7 },
		{ pattern: "pyproject.toml", cmd: "pytest", confidence: 0.8 },
		{ pattern: "Cargo.toml", cmd: "cargo test", confidence: 0.9 },
		{ pattern: "go.mod", cmd: "go test ./...", confidence: 0.9 },
		{ pattern: "build.gradle", cmd: "./gradlew test", confidence: 0.8 },
		{ pattern: "pom.xml", cmd: "mvn test", confidence: 0.8 },
	];

	for (const { pattern, cmd, confidence } of frameworks) {
		if (existsSync(join(cwd, pattern))) {
			return {
				command: cmd,
				confidence,
				isMonorepo: false,
			};
		}
	}

	return {
		command: null,
		confidence: 0,
		isMonorepo: monorepo,
	};
}

/**
 * Check if a test script is just a placeholder
 */
function isPlaceholderTest(script: string): boolean {
	const placeholders = ["echo", "exit 0", "no test", "no tests", "TODO"];
	const normalized = script.toLowerCase().trim();

	return placeholders.some((p) => normalized.includes(p.toLowerCase()));
}

// =============================================================================
// Test Execution
// =============================================================================

/**
 * Run tests and return result
 *
 * @param cwd - Working directory
 * @returns Success status and output
 */
export function runTests(cwd: string): { success: boolean; output: string } {
	const detection = detectTestCommand(cwd);

	if (!detection.command) {
		return {
			success: true,
			output: "No test command detected, skipping tests",
		};
	}

	try {
		const output = execSync(detection.command, {
			cwd,
			encoding: "utf-8",
			timeout: 120000, // 2 minutes
		});
		return { success: true, output };
	} catch (error: unknown) {
		const err = error as { stdout?: string; stderr?: string };
		return {
			success: false,
			output: `${err.stdout || ""}\n${err.stderr || ""}`.trim(),
		};
	}
}
