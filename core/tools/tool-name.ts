/**
 * [WHO]: ToolName, parseToolName(), normalizeToolName(), BUILTIN_NAMESPACE
 * [FROM]: Pure internal naming utility with no dependencies
 * [TO]: Consumed by tool-registry.ts and orchestrator.ts
 * [HERE]: core/tools/tool-name.ts - canonical internal keys for runtime tools
 */

/** Canonical namespace for unqualified Catui tool names. */
export const BUILTIN_NAMESPACE = "functions" as const;

const MCP_NAMESPACE_PREFIX = "mcp";
const MAX_TOOL_NAME_LENGTH = 64;
const MAX_NAMESPACE_LENGTH = 32;
const MAX_LOCAL_NAME_LENGTH = 31;

export interface ToolName {
	readonly namespace: string;
	readonly localName: string;
	readonly fullName: string;
	readonly original: string;
}

export type ToolNameParseResult =
	| { ok: true; value: ToolName }
	| { ok: false; error: string };

export function parseToolName(
	name: string,
	defaultNamespace: string = BUILTIN_NAMESPACE,
): ToolNameParseResult {
	const original = name;
	const normalizedDefaultNamespace = defaultNamespace.toLowerCase();
	if (!isValidIdentifier(normalizedDefaultNamespace)) {
		return { ok: false, error: `Invalid default tool namespace "${defaultNamespace}"` };
	}

	if (name.startsWith(`${MCP_NAMESPACE_PREFIX}.`)) {
		const rest = name.slice(MCP_NAMESPACE_PREFIX.length + 1);
		const separatorIndex = rest.indexOf(".");
		if (separatorIndex <= 0 || separatorIndex === rest.length - 1) {
			return {
				ok: false,
				error: `Invalid MCP tool name "${name}" (expected "mcp.<server>.<tool>")`,
			};
		}

		const serverName = rest.slice(0, separatorIndex).toLowerCase();
		const localName = rest.slice(separatorIndex + 1).toLowerCase();
		const namespace = `${MCP_NAMESPACE_PREFIX}.${serverName}`;
		if (!isValidIdentifier(serverName)) {
			return { ok: false, error: `Invalid MCP server id in tool name "${name}"` };
		}
		if (!isValidIdentifier(localName)) {
			return { ok: false, error: `Invalid MCP tool name in "${name}"` };
		}
		return validateAndBuild({ namespace, localName, original });
	}

	const parts = name.split(".");
	if (parts.length > 2) {
		return { ok: false, error: `Tool name "${name}" has too many dots` };
	}

	const namespace = parts.length === 2 ? parts[0]?.toLowerCase() : normalizedDefaultNamespace;
	const localName = (parts.length === 2 ? parts[1] : parts[0])?.toLowerCase();
	if (!namespace || !isValidIdentifier(namespace)) {
		return { ok: false, error: `Invalid namespace in tool name "${name}"` };
	}
	if (!localName || !isValidIdentifier(localName)) {
		return { ok: false, error: `Invalid local name in tool name "${name}"` };
	}
	return validateAndBuild({ namespace, localName, original });
}

export function normalizeToolName(
	name: string,
	defaultNamespace: string = BUILTIN_NAMESPACE,
): string {
	const result = parseToolName(name, defaultNamespace);
	if (!result.ok) {
		throw new Error(result.error);
	}
	return result.value.fullName;
}

function validateAndBuild(input: {
	namespace: string;
	localName: string;
	original: string;
}): ToolNameParseResult {
	const { namespace, localName, original } = input;
	const fullName = `${namespace}.${localName}`;
	if (namespace.length > MAX_NAMESPACE_LENGTH) {
		return { ok: false, error: `Namespace too long in tool name "${original}"` };
	}
	if (localName.length > MAX_LOCAL_NAME_LENGTH) {
		return { ok: false, error: `Local name too long in tool name "${original}"` };
	}
	if (fullName.length > MAX_TOOL_NAME_LENGTH) {
		return { ok: false, error: `Tool name "${original}" is too long` };
	}
	return {
		ok: true,
		value: { namespace, localName, fullName, original },
	};
}

function isValidIdentifier(value: string): boolean {
	return /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(value);
}
