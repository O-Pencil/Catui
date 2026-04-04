/**
 * [WHO]: Provides extractTaggedPayload(), parseSimplifyOutput(), parseOptions()
 * [FROM]: Depends on simplify output constants and option types
 * [TO]: Consumed by simplify analyzer and extension entry point
 * [HERE]: extensions/optional/simplify/simplify-parser.ts - XML payload and command option parsing
 */

import {
	SIMPLIFY_OUTPUT_START,
	SIMPLIFY_OUTPUT_END,
	SIMPLIFY_FALLBACK,
	type SimplifyOutput,
	type SimplifyOptions,
} from "./simplify-types.js";

// =============================================================================
// XML-Tagged Payload Extraction
// =============================================================================

/**
 * Extract content between XML tags (following loop/ extension pattern)
 * Uses lastIndexOf to handle multiple occurrences (takes the last one)
 */
export function extractTaggedPayload(text: string, startTag: string, endTag: string): string | undefined {
	const startIndex = text.lastIndexOf(startTag);
	const endIndex = text.lastIndexOf(endTag);
	if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
		return undefined;
	}
	return text.slice(startIndex + startTag.length, endIndex).trim();
}

// =============================================================================
// Output Parsing with Robust Fallbacks
// =============================================================================

/**
 * Parse LLM output into SimplifyOutput with multiple fallback strategies:
 * 1. XML-tagged extraction (<simplify-output>...</simplify-output>)
 * 2. Raw JSON from markdown code blocks
 * 3. Fallback to SIMPLIFY_FALLBACK
 */
export function parseSimplifyOutput(text: string): SimplifyOutput {
	// Strategy 1: Try XML-tagged extraction
	const payload = extractTaggedPayload(text, SIMPLIFY_OUTPUT_START, SIMPLIFY_OUTPUT_END);
	if (payload) {
		try {
			const parsed = JSON.parse(payload);
			const coerced = coerceOutput(parsed);
			if (coerced) return coerced;
		} catch {
			// Fall through to next strategy
		}
	}

	// Strategy 2: Try extracting JSON from markdown code blocks
	const cleaned = text
		.replace(/```json?\n?/g, "")
		.replace(/```/g, "")
		.trim();
	try {
		const parsed = JSON.parse(cleaned);
		const coerced = coerceOutput(parsed);
		if (coerced) return coerced;
	} catch {
		// Fall through to fallback
	}

	// Strategy 3: Return fallback
	return SIMPLIFY_FALLBACK;
}

/**
 * Coerce unknown parsed value into SimplifyOutput
 * Returns null if coercion fails completely
 */
function coerceOutput(parsed: unknown): SimplifyOutput | null {
	if (!parsed || typeof parsed !== "object") return null;
	const obj = parsed as Record<string, unknown>;

	// Validate required fields
	const simplified = typeof obj.simplified === "string" ? obj.simplified : null;
	const explanation = typeof obj.explanation === "string" ? obj.explanation : "No explanation provided";
	const equivalent = obj.equivalent !== false; // Default to true

	return {
		simplified,
		explanation,
		equivalent,
	};
}

// =============================================================================
// CLI Option Parsing
// =============================================================================

/**
 * Parse command-line arguments into SimplifyOptions
 *
 * Supported flags:
 * --dry-run       Preview without applying
 * --no-test       Skip test validation
 * --concurrency=N Set parallel file limit (default: 3)
 * --force         Bypass cache
 *
 * All other arguments are treated as file paths
 */
export function parseOptions(args: string): SimplifyOptions {
	const parts = args.trim().split(/\s+/).filter(Boolean);
	const options: SimplifyOptions = {
		files: [],
		runTests: true,
		dryRun: false,
		concurrency: 3,
		force: false,
	};

	for (const part of parts) {
		if (part === "--dry-run") {
			options.dryRun = true;
		} else if (part === "--no-test") {
			options.runTests = false;
		} else if (part.startsWith("--concurrency=")) {
			const value = parseInt(part.slice("--concurrency=".length), 10);
			if (!isNaN(value) && value > 0) {
				options.concurrency = value;
			}
		} else if (part === "--force") {
			options.force = true;
		} else if (!part.startsWith("--")) {
			options.files!.push(part);
		}
	}

	return options;
}
