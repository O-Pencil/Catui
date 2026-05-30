/**
 * [WHO]: sanitizeSurrogates function - removes unpaired Unicode surrogate characters
 * [FROM]: No external dependencies
 * [TO]: Consumed by AI providers for JSON-safe text
 * [HERE]: core/lib/ai/src/utils/sanitize-unicode.ts - Unicode sanitization utility
 *
 * Unpaired surrogates cause JSON serialization errors in many API providers.
 * Valid emoji with properly paired surrogates are preserved.
 */
/**
 * [WHO]: sanitizeSurrogates
 * [FROM]: No external dependencies
 * [TO]: Consumed by core/lib/ai/src/index.ts
 * [HERE]: core/lib/ai/src/utils/sanitize-unicode.ts -
 */

export function sanitizeSurrogates(text: string): string {
	// Replace unpaired high surrogates (0xD800-0xDBFF not followed by low surrogate)
	// Replace unpaired low surrogates (0xDC00-0xDFFF not preceded by high surrogate)
	return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}
