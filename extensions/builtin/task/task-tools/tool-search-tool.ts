/**
 * [WHO]: ToolSearch tool - discovers tools by keyword search
 * [FROM]: Claude Code ToolSearchTool + prompt.ts (1:1 port)
 * [TO]: Consumed by task extension via registerTool()
 * [HERE]: extensions/builtin/task/task-tools/tool-search-tool.ts
 */

import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";
import type { AgentToolResult } from "@pencil-agent/agent-core";
import type { ExtensionContext } from "../../../../core/extensions-host/types.js";

// ============================================================================
// Constants
// ============================================================================

const TOOL_SEARCH_TOOL_NAME = "ToolSearch";

// ============================================================================
// Schema
// ============================================================================

const toolSearchSchema = Type.Object({
	query: Type.String({
		description:
			'Query to find deferred tools. Use "select:<tool_name>" for direct selection, or keywords to search.',
	}),
	max_results: Type.Optional(
		Type.Number({
			description: "Maximum number of results to return (default: 5)",
			default: 5,
		}),
	),
});

export type ToolSearchInput = Static<typeof toolSearchSchema>;

// ============================================================================
// Prompt (copied verbatim from CC prompt.ts getPrompt())
// ============================================================================

const PROMPT_HEAD = `Fetches full schema definitions for deferred tools so they can be called.

`;

const PROMPT_LOCATION_HINT = `Deferred tools appear by name in tool search results.

`;

const PROMPT_TAIL = ` Until fetched, only the name is known — there is no parameter schema, so the tool cannot be invoked. This tool takes a query, matches it against the deferred tool list, and returns the matched tools' complete JSONSchema definitions inside a <functions> block. Once a tool's schema appears in that result, it is callable exactly like any tool defined at the top of the prompt.

Result format: each matched tool appears as one <function>{"description": "...", "name": "...", "parameters": {...}}</function> line inside the <functions> block — the same encoding as the tool list at the top of this prompt.

Query forms:
- "select:Read,Edit,Grep" — fetch these exact tools by name
- "notebook jupyter" — keyword search, up to max_results best matches
- "+slack send" — require "slack" in the name, rank by remaining terms`;

const TOOL_SEARCH_PROMPT = PROMPT_HEAD + PROMPT_LOCATION_HINT + PROMPT_TAIL;

// ============================================================================
// Utilities
// ============================================================================

/**
 * Escape a string for use in a RegExp.
 * Ported from CC utils/stringUtils.ts escapeRegExp.
 */
function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ============================================================================
// Name parsing
// ============================================================================

/**
 * Parse tool name into searchable parts.
 * Handles both MCP tools (mcp__server__action) and regular tools (CamelCase).
 * Ported from CC ToolSearchTool.ts parseToolName.
 */
function parseToolName(name: string): { parts: string[]; full: string; isMcp: boolean } {
	// Check if it's an MCP tool
	if (name.startsWith("mcp__")) {
		const withoutPrefix = name.replace(/^mcp__/, "").toLowerCase();
		const parts = withoutPrefix.split("__").flatMap(p => p.split("_"));
		return {
			parts: parts.filter(Boolean),
			full: withoutPrefix.replace(/__/g, " ").replace(/_/g, " "),
			isMcp: true,
		};
	}

	// Regular tool - split by CamelCase and underscores
	const parts = name
		.replace(/([a-z])([A-Z])/g, "$1 $2") // CamelCase to spaces
		.replace(/_/g, " ")
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean);

	return {
		parts,
		full: parts.join(" "),
		isMcp: false,
	};
}

// ============================================================================
// Keyword search with scoring
// ============================================================================

/**
 * Pre-compile word-boundary regexes for all search terms.
 * Called once per search instead of tools×terms×2 times.
 * Ported from CC ToolSearchTool.ts compileTermPatterns.
 */
function compileTermPatterns(terms: string[]): Map<string, RegExp> {
	const patterns = new Map<string, RegExp>();
	for (const term of terms) {
		if (!patterns.has(term)) {
			patterns.set(term, new RegExp(`\\b${escapeRegExp(term)}\\b`));
		}
	}
	return patterns;
}

/**
 * Keyword-based search over tool names and descriptions.
 * Handles both MCP tools (mcp__server__action) and regular tools (CamelCase).
 *
 * Ported from CC ToolSearchTool.ts searchToolsWithKeywords.
 *
 * Scoring weights (matching CC exactly):
 * - Name exact part: 10 (12 for MCP)
 * - Name substring: 5 (6 for MCP)
 * - Full name fallback: 3
 * - searchHint match: 4
 * - Description word-boundary match: 2
 */
function searchToolsWithKeywords(
	query: string,
	allTools: Array<{ name: string; description: string; searchHint?: string }>,
	maxResults: number,
): string[] {
	const queryLower = query.toLowerCase().trim();

	// Fast path: if query matches a tool name exactly, return it directly.
	// Handles models using a bare tool name instead of select: prefix (seen
	// from subagents/post-compaction). Checks deferred first, then falls back
	// to the full tool set -- selecting an already-loaded tool is a harmless
	// no-op that lets the model proceed without retry churn.
	const exactMatch = allTools.find(t => t.name.toLowerCase() === queryLower);
	if (exactMatch) return [exactMatch.name];

	// If query looks like an MCP tool prefix (mcp__server), find matching tools.
	// Handles models searching by server name with mcp__ prefix.
	if (queryLower.startsWith("mcp__") && queryLower.length > 5) {
		const prefixMatches = allTools
			.filter(t => t.name.toLowerCase().startsWith(queryLower))
			.slice(0, maxResults)
			.map(t => t.name);
		if (prefixMatches.length > 0) return prefixMatches;
	}

	const queryTerms = queryLower.split(/\s+/).filter(term => term.length > 0);

	// Partition into required (+prefixed) and optional terms
	const requiredTerms: string[] = [];
	const optionalTerms: string[] = [];
	for (const term of queryTerms) {
		if (term.startsWith("+") && term.length > 1) {
			requiredTerms.push(term.slice(1));
		} else {
			optionalTerms.push(term);
		}
	}

	const allScoringTerms = requiredTerms.length > 0 ? [...requiredTerms, ...optionalTerms] : queryTerms;
	const termPatterns = compileTermPatterns(allScoringTerms);

	// Pre-filter to tools matching ALL required terms in name or description
	let candidateTools = allTools;
	if (requiredTerms.length > 0) {
		candidateTools = allTools.filter(tool => {
			const parsed = parseToolName(tool.name);
			const descNormalized = tool.description.toLowerCase();
			const hintNormalized = tool.searchHint?.toLowerCase() ?? "";
			return requiredTerms.every(term => {
				const pattern = termPatterns.get(term)!;
				return (
					parsed.parts.includes(term) ||
					parsed.parts.some(part => part.includes(term)) ||
					pattern.test(descNormalized) ||
					(hintNormalized && pattern.test(hintNormalized))
				);
			});
		});
	}

	// Score each candidate
	const scored = candidateTools.map(tool => {
		const parsed = parseToolName(tool.name);
		const descNormalized = tool.description.toLowerCase();
		const hintNormalized = tool.searchHint?.toLowerCase() ?? "";

		let score = 0;
		for (const term of allScoringTerms) {
			const pattern = termPatterns.get(term)!;

			// Exact part match (high weight for MCP server names, tool name parts)
			if (parsed.parts.includes(term)) {
				score += parsed.isMcp ? 12 : 10;
			} else if (parsed.parts.some(part => part.includes(term))) {
				score += parsed.isMcp ? 6 : 5;
			}

			// Full name fallback (for edge cases)
			if (parsed.full.includes(term) && score === 0) {
				score += 3;
			}

			// searchHint match -- curated capability phrase, higher signal than prompt
			if (hintNormalized && pattern.test(hintNormalized)) {
				score += 4;
			}

			// Description match - use word boundary to avoid false positives
			if (pattern.test(descNormalized)) {
				score += 2;
			}
		}

		return { name: tool.name, score };
	});

	return scored
		.filter(item => item.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, maxResults)
		.map(item => item.name);
}

// ============================================================================
// Tool definition
// ============================================================================

/**
 * @param getAllTools - function returning all available tools (from ExtensionAPI.getAllTools)
 */
export function createToolSearchTool(
	getAllTools: () => Array<{ name: string; description: string; parameters: unknown; searchHint?: string }>,
) {
	return {
		name: TOOL_SEARCH_TOOL_NAME,
		label: "Search Tools",
		description:
			"Discover available tools by keyword search or direct selection. Use select:<tool_name> for direct selection, or keywords to search tool names and descriptions.",
		parameters: toolSearchSchema,

		guidance: TOOL_SEARCH_PROMPT,

		async execute(
			_toolCallId: string,
			params: ToolSearchInput,
			_signal: AbortSignal | undefined,
			_onUpdate: undefined,
			_ctx: ExtensionContext,
		): Promise<AgentToolResult<unknown>> {
			try {
				const allTools = getAllTools();
				const { query, max_results = 5 } = params;

				// select: prefix — direct tool selection.
				// Supports comma-separated multi-select: `select:A,B,C`.
				// If a name isn't in the deferred set but IS in the full tool set,
				// we still return it -- the tool is already loaded, so "selecting" it
				// is a harmless no-op that lets the model proceed without retry churn.
				const selectMatch = query.match(/^select:(.+)$/i);
				if (selectMatch) {
					const requested = selectMatch[1]!
						.split(",")
						.map(s => s.trim())
						.filter(Boolean);

					const found: string[] = [];
					const missing: string[] = [];
					for (const toolName of requested) {
						const tool = allTools.find(t => t.name.toLowerCase() === toolName.toLowerCase());
						if (tool) {
							if (!found.includes(tool.name)) found.push(tool.name);
						} else {
							missing.push(toolName);
						}
					}

					if (found.length === 0) {
						return {
							content: [{ type: "text", text: `No matching tools found for: ${missing.join(", ")}` }],
							details: { matches: [], query, total_deferred_tools: allTools.length },
						};
					}

					let text = `Selected tools: ${found.join(", ")}`;
					if (missing.length > 0) {
						text += `\nNot found: ${missing.join(", ")}`;
					}

					return {
						content: [{ type: "text", text }],
						details: { matches: found, query, total_deferred_tools: allTools.length },
					};
				}

				// Keyword search
				const matches = searchToolsWithKeywords(query, allTools, max_results);

				if (matches.length === 0) {
					return {
						content: [{ type: "text", text: `No matching deferred tools found` }],
						details: { matches: [], query, total_deferred_tools: allTools.length },
					};
				}

				// Build result with tool details (returns tool reference info for schema injection)
				const resultLines = matches.map(name => {
					const tool = allTools.find(t => t.name === name);
					return tool ? `- ${name}: ${tool.description}` : `- ${name}`;
				});

				return {
					content: [{ type: "text", text: resultLines.join("\n") }],
					details: { matches, query, total_deferred_tools: allTools.length },
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Error: ${message}` }],
					details: { matches: [], query: params.query, error: message },
				};
			}
		},
	};
}
