/**
 * [WHO]: splitShellSegments() quote-aware shell segment lexer
 * [FROM]: No runtime dependencies
 * [TO]: Consumed by token-save rewrite registry and tests
 * [HERE]: extensions/builtin/token-save/lexer.ts - conservative command boundary parser
 */
export interface ShellSegment {
	text: string;
	operator: "" | "&&" | "||" | ";" | "|";
}

export function splitShellSegments(command: string): ShellSegment[] {
	const segments: ShellSegment[] = [];
	let current = "";
	let quote: "'" | '"' | "`" | undefined;
	let escaped = false;

	for (let i = 0; i < command.length; i++) {
		const char = command[i];
		const next = command[i + 1];

		if (escaped) {
			current += char;
			escaped = false;
			continue;
		}
		if (char === "\\") {
			current += char;
			escaped = true;
			continue;
		}
		if (quote) {
			current += char;
			if (char === quote) quote = undefined;
			continue;
		}
		if (char === "'" || char === '"' || char === "`") {
			current += char;
			quote = char;
			continue;
		}

		const two = `${char}${next ?? ""}`;
		if (two === "&&" || two === "||") {
			segments.push({ text: current.trim(), operator: two });
			current = "";
			i++;
			continue;
		}
		if (char === ";" || char === "|") {
			segments.push({ text: current.trim(), operator: char });
			current = "";
			continue;
		}

		current += char;
	}

	if (current.trim() || segments.length === 0) {
		segments.push({ text: current.trim(), operator: "" });
	} else if (segments.length > 0) {
		segments[segments.length - 1].operator = "";
	}

	return segments.filter((segment) => segment.text || segment.operator);
}
