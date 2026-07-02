/**
 * [WHO]: NO_OUTPUT_BUILTINS set + isNoOutputBuiltin() check
 * [FROM]: None (pure data + tiny helper)
 * [TO]: Imported by rewrite.ts (planCommand) and filters.ts (classifyCommand) to short-circuit shell builtins whose stdout is empty or session-only.
 * [HERE]: extensions/builtin/token-save/no-output-builtins.ts - extracted to break the rewrite.ts <-> filters.ts import cycle (each imports the other).
 *
 * Background: routing cd / pwd / export / unset etc. through capture mode runs the filter for nothing — the filter receives a near-empty input, computes savedTokens ≈ 0, and writes a 'filtered savedTokens=0' history record that dilutes the user's /tokensave summary. We classify them as passthrough at planning time so both the filter path and the history mode reflect reality.
 *
 * Aliases (cd=, ll=cd …) are not resolved here, but plain builtins cover the common cases. Commands like `set -e`, `trap '…' ERR`, etc. are also shell builtins; `which`, `type`, `command -v` similarly produce short one-line outputs that aren't worth filtering.
 */

export const NO_OUTPUT_BUILTINS = new Set<string>([
	"cd", "pwd", "pushd", "popd", "dirs",
	"export", "unset", "set", "shopt", "setopt", "unsetopt",
	"umask", "ulimit", "limit",
	"alias", "unalias", "hash",
	"history",
	"type", "command", "which", "whence",
	"declare", "typeset", "local", "readonly",
	"source", ".", // POSIX dot — runs a file in the current shell, output is whatever the file prints
]);

export function isNoOutputBuiltin(normalizedFirstToken: string): boolean {
	const token = normalizedFirstToken.split(/\s+/)[0];
	return NO_OUTPUT_BUILTINS.has(token);
}