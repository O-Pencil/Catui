/**
 * [WHO]: Provides SimplifyResult, SimplifyOptions, SimplifyOutput, TestDetection, XML tag constants
 * [FROM]: Depends on no runtime modules
 * [TO]: Consumed by simplify parser, analyzer, controller, test detector, and extension entry point
 * [HERE]: extensions/optional/simplify/simplify-types.ts - local contracts for simplify extension
 */

/**
 * Result of simplifying a single file
 */
export interface SimplifyResult {
	file: string;
	original: string;
	simplified: string;
	explanation: string;
}

/**
 * Command-line options for simplify operation
 */
export interface SimplifyOptions {
	/** Specific files to simplify (if empty, uses git diff) */
	files?: string[];
	/** Run tests after applying changes */
	runTests?: boolean;
	/** Preview changes without applying */
	dryRun?: boolean;
	/** Max concurrent file analyses (default: 3) */
	concurrency?: number;
	/** Bypass cache and re-analyze */
	force?: boolean;
}

/**
 * LLM output format for simplification
 */
export interface SimplifyOutput {
	/** Simplified code, or null if no simplification needed */
	simplified: string | null;
	/** Explanation of changes made */
	explanation: string;
	/** Whether the simplification is functionally equivalent */
	equivalent: boolean;
}

/**
 * Test detection result
 */
export interface TestDetection {
	/** Test command to run, or null if none detected */
	command: string | null;
	/** Confidence level 0-1 (higher = more confident) */
	confidence: number;
	/** Whether the project is a monorepo */
	isMonorepo: boolean;
}

/**
 * XML tags for structured LLM output
 * Following the pattern from extensions/defaults/loop/
 */
export const SIMPLIFY_OUTPUT_START = "<simplify-output>";
export const SIMPLIFY_OUTPUT_END = "</simplify-output>";

/**
 * Default fallback output when parsing fails
 */
export const SIMPLIFY_FALLBACK: SimplifyOutput = {
	simplified: null,
	explanation: "Code is already simple or parsing failed",
	equivalent: true,
};
