/**
 * [WHO]: applyTomlStyleFilter() configuration-driven line filter pipeline
 * [FROM]: No runtime dependencies
 * [TO]: Consumed by TokenSave filters/tests and future project/user filter loading
 * [HERE]: extensions/defaults/token-save/toml-dsl.ts - TokenSave configuration filter DSL core
 */
export interface TomlStyleFilter {
	stripAnsi?: boolean;
	replace?: Array<{ pattern: string; with: string }>;
	matchMessage?: Array<{ pattern: string; message: string }>;
	stripLines?: string[];
	keepLines?: string[];
	truncateLine?: number;
	head?: number;
	tail?: number;
	maxLines?: number;
	emptyMessage?: string;
}

export function applyTomlStyleFilter(filter: TomlStyleFilter, raw: string): string {
	let text = filter.stripAnsi === false ? raw : raw.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");

	for (const rule of filter.replace ?? []) {
		text = text.replace(new RegExp(rule.pattern, "g"), rule.with);
	}

	for (const rule of filter.matchMessage ?? []) {
		if (new RegExp(rule.pattern, "m").test(text)) return rule.message;
	}

	let lines = text.split("\n");

	for (const pattern of filter.stripLines ?? []) {
		const regex = new RegExp(pattern);
		lines = lines.filter((line) => !regex.test(line));
	}

	if (filter.keepLines && filter.keepLines.length > 0) {
		const regexes = filter.keepLines.map((pattern) => new RegExp(pattern));
		lines = lines.filter((line) => regexes.some((regex) => regex.test(line)));
	}

	if (filter.truncateLine && filter.truncateLine > 0) {
		const maxLineLength = filter.truncateLine;
		lines = lines.map((line) => (line.length > maxLineLength ? `${line.slice(0, maxLineLength - 3)}...` : line));
	}

	if (filter.head && filter.head > 0) {
		lines = lines.slice(0, filter.head);
	}

	if (filter.tail && filter.tail > 0) {
		lines = lines.slice(-filter.tail);
	}

	if (filter.maxLines && filter.maxLines > 0) {
		lines = lines.slice(0, filter.maxLines);
	}

	const output = lines.join("\n").trimEnd();
	return output || filter.emptyMessage || "";
}
