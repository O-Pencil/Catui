/**
 * export-html Extension
 *
 * Provides HTML export functionality for sessions.
 * This extension registers the /export command.
 */
/**
 * [WHO]: exportSessionToHtml, exportFromFile, type ToolHtmlRenderer, type ExportOptions, ExtExportOptions
 * [FROM]: Depends on node:path, node:url, ../../../core/session/session-manager.js, ../../../config.js, ../../../modes/interactive/theme/theme.js
 * [TO]: Loaded by core/extensions-host/loader.ts as extension entry point
 * [HERE]: extensions/optional/export-html/index.ts -
 */


import type { AgentState } from "@pencil-agent/agent-core";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "../../../core/extensions-host/types.js";
import { SessionManager } from "../../../core/session/session-manager.js";
import { APP_NAME, getExportTemplateDir } from "../../../config.js";
import { getResolvedThemeColors, getThemeExportColors } from "../../../modes/interactive/theme/theme.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXPORT_COMMAND_COMPLETIONS = [
	{
		value: "./nanopencil-session.html",
		label: "./nanopencil-session.html",
		description: "Choose the output file for this session export",
	},
];

// Re-export core functions for use by AgentSession
export { exportSessionToHtml, exportFromFile, type ToolHtmlRenderer, type ExportOptions } from "../../../core/export-html/index.js";

/**
 * Parse a color string to RGB values.
 */
function parseColor(color: string): { r: number; g: number; b: number } | undefined {
	const hexMatch = color.match(/^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/);
	if (hexMatch) {
		return {
			r: Number.parseInt(hexMatch[1], 16),
			g: Number.parseInt(hexMatch[2], 16),
			b: Number.parseInt(hexMatch[3], 16),
		};
	}
	const rgbMatch = color.match(/^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
	if (rgbMatch) {
		return {
			r: Number.parseInt(rgbMatch[1], 10),
			g: Number.parseInt(rgbMatch[2], 10),
			b: Number.parseInt(rgbMatch[3], 10),
		};
	}
	return undefined;
}

/**
 * Calculate relative luminance of a color.
 */
function getLuminance(r: number, g: number, b: number): number {
	const toLinear = (c: number) => {
		const s = c / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/**
 * Adjust color brightness.
 */
function adjustBrightness(color: string, factor: number): string {
	const parsed = parseColor(color);
	if (!parsed) return color;
	const adjust = (c: number) => Math.min(255, Math.max(0, Math.round(c * factor)));
	return `rgb(${adjust(parsed.r)}, ${adjust(parsed.g)}, ${adjust(parsed.b)})`;
}

/**
 * Derive export background colors from a base color.
 */
function deriveExportColors(baseColor: string): { pageBg: string; cardBg: string; infoBg: string } {
	const parsed = parseColor(baseColor);
	if (!parsed) {
		return {
			pageBg: "rgb(24, 24, 30)",
			cardBg: "rgb(30, 30, 36)",
			infoBg: "rgb(60, 55, 40)",
		};
	}

	const luminance = getLuminance(parsed.r, parsed.g, parsed.b);
	const isLight = luminance > 0.5;

	if (isLight) {
		return {
			pageBg: adjustBrightness(baseColor, 0.96),
			cardBg: baseColor,
			infoBg: `rgb(${Math.min(255, parsed.r + 10)}, ${Math.min(255, parsed.g + 5)}, ${Math.max(0, parsed.b - 20)})`,
		};
	}
	return {
		pageBg: adjustBrightness(baseColor, 0.7),
		cardBg: adjustBrightness(baseColor, 0.85),
		infoBg: `rgb(${Math.min(255, parsed.r + 20)}, ${Math.min(255, parsed.g + 15)}, ${parsed.b})`,
	};
}

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import type { SessionEntry } from "../../../core/session/session-manager.js";
import type { ToolInfo } from "../../../core/extensions-host/types.js";

interface SessionData {
	header: ReturnType<SessionManager["getHeader"]>;
	entries: ReturnType<SessionManager["getEntries"]>;
	leafId: string | null;
	systemPrompt?: string;
	tools?: ToolInfo[];
	renderedTools?: Record<string, { callHtml?: string; resultHtml?: string }>;
}

interface RenderedToolHtml {
	callHtml?: string;
	resultHtml?: string;
}

export interface ExtExportOptions {
	outputPath?: string;
	themeName?: string;
	toolRenderer?: {
		renderCall(toolName: string, args: unknown): string | undefined;
		renderResult(
			toolName: string,
			result: Array<{ type: string; text?: string; data?: string; mimeType?: string }>,
			details: unknown,
			isError: boolean,
		): string | undefined;
	};
}

/**
 * Generate CSS custom property declarations from theme colors.
 */
function generateThemeVars(themeName?: string): string {
	const colors = getResolvedThemeColors(themeName);
	const lines: string[] = [];
	for (const [key, value] of Object.entries(colors)) {
		lines.push(`--${key}: ${value};`);
	}

	const themeExport = getThemeExportColors(themeName);
	const userMessageBg = colors.userMessageBg || "#343541";
	const derivedColors = deriveExportColors(userMessageBg);

	lines.push(`--exportPageBg: ${themeExport.pageBg ?? derivedColors.pageBg};`);
	lines.push(`--exportCardBg: ${themeExport.cardBg ?? derivedColors.cardBg};`);
	lines.push(`--exportInfoBg: ${themeExport.infoBg ?? derivedColors.infoBg};`);

	return lines.join("\n      ");
}

/**
 * Core HTML generation logic shared by both export functions.
 */
function generateHtml(sessionData: SessionData, themeName?: string): string {
	const templateDir = getExportTemplateDir();
	const template = readFileSync(join(templateDir, "template.html"), "utf-8");
	const templateCss = readFileSync(join(templateDir, "template.css"), "utf-8");
	const templateJs = readFileSync(join(templateDir, "template.js"), "utf-8");
	const markedJs = readFileSync(join(templateDir, "vendor", "marked.min.js"), "utf-8");
	const hljsJs = readFileSync(join(templateDir, "vendor", "highlight.min.js"), "utf-8");

	const themeVars = generateThemeVars(themeName);
	const colors = getResolvedThemeColors(themeName);
	const exportColors = deriveExportColors(colors.userMessageBg || "#343541");
	const bodyBg = exportColors.pageBg;
	const containerBg = exportColors.cardBg;
	const infoBg = exportColors.infoBg;

	const sessionDataBase64 = Buffer.from(JSON.stringify(sessionData)).toString("base64");

	const css = templateCss
		.replace("{{THEME_VARS}}", themeVars)
		.replace("{{BODY_BG}}", bodyBg)
		.replace("{{CONTAINER_BG}}", containerBg)
		.replace("{{INFO_BG}}", infoBg);

	return template
		.replace("{{CSS}}", css)
		.replace("{{JS}}", templateJs)
		.replace("{{SESSION_DATA}}", sessionDataBase64)
		.replace("{{MARKED_JS}}", markedJs)
		.replace("{{HIGHLIGHT_JS}}", hljsJs);
}

const BUILTIN_TOOLS = new Set(["bash", "read", "write", "edit", "ls", "find", "grep"]);

/**
 * Pre-render custom tools to HTML using their TUI renderers.
 */
function preRenderCustomTools(
	entries: SessionEntry[],
	toolRenderer: NonNullable<ExtExportOptions["toolRenderer"]>,
): Record<string, RenderedToolHtml> {
	const renderedTools: Record<string, RenderedToolHtml> = {};

	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const msg = entry.message;

		if (msg.role === "assistant" && Array.isArray(msg.content)) {
			for (const block of msg.content) {
				if (block.type === "toolCall" && !BUILTIN_TOOLS.has(block.name)) {
					const callHtml = toolRenderer.renderCall(block.name, block.arguments);
					if (callHtml) {
						renderedTools[block.id] = { callHtml };
					}
				}
			}
		}

		if (msg.role === "toolResult" && msg.toolCallId) {
			const toolName = msg.toolName || "";
			const existing = renderedTools[msg.toolCallId];
			if (existing || !BUILTIN_TOOLS.has(toolName)) {
				const resultHtml = toolRenderer.renderResult(
					toolName,
					msg.content,
					msg.details,
					msg.isError || false,
				);
				if (resultHtml) {
					renderedTools[msg.toolCallId] = {
						...existing,
						resultHtml,
					};
				}
			}
		}
	}

	return renderedTools;
}

/**
 * Export session to HTML.
 */
export async function extExportSessionToHtml(
	sm: SessionManager,
	state?: AgentState,
	options?: ExtExportOptions | string,
): Promise<string> {
	const opts: ExtExportOptions = typeof options === "string" ? { outputPath: options } : options || {};

	const sessionFile = sm.getSessionFile();
	if (!sessionFile) {
		throw new Error("Cannot export in-memory session to HTML");
	}
	if (!existsSync(sessionFile)) {
		throw new Error("Nothing to export yet - start a conversation first");
	}

	const entries = sm.getEntries();

	let renderedTools: Record<string, RenderedToolHtml> | undefined;
	if (opts.toolRenderer) {
		renderedTools = preRenderCustomTools(entries, opts.toolRenderer);
		if (Object.keys(renderedTools).length === 0) {
			renderedTools = undefined;
		}
	}

	const sessionData: SessionData = {
		header: sm.getHeader(),
		entries,
		leafId: sm.getLeafId(),
		systemPrompt: state?.systemPrompt,
		tools: state?.tools?.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })),
		renderedTools,
	};

	const html = generateHtml(sessionData, opts.themeName);

	let outputPath = opts.outputPath;
	if (!outputPath) {
		const sessionBasename = basename(sessionFile, ".jsonl");
		outputPath = `${APP_NAME}-session-${sessionBasename}.html`;
	}

	writeFileSync(outputPath, html, "utf8");
	return outputPath;
}

/**
 * Export session file to HTML (standalone).
 */
export async function extExportFromFile(inputPath: string, options?: ExtExportOptions | string): Promise<string> {
	const opts: ExtExportOptions = typeof options === "string" ? { outputPath: options } : options || {};

	if (!existsSync(inputPath)) {
		throw new Error(`File not found: ${inputPath}`);
	}

	const sm = SessionManager.open(inputPath);

	const sessionData: SessionData = {
		header: sm.getHeader(),
		entries: sm.getEntries(),
		leafId: sm.getLeafId(),
		systemPrompt: undefined,
		tools: undefined,
	};

	const html = generateHtml(sessionData, opts.themeName);

	let outputPath = opts.outputPath;
	if (!outputPath) {
		const inputBasename = basename(inputPath, ".jsonl");
		outputPath = `${APP_NAME}-session-${inputBasename}.html`;
	}

	writeFileSync(outputPath, html, "utf8");
	return outputPath;
}

/**
 * Extension factory function
 */
export default async function exportHtmlExtension(api: ExtensionAPI) {
	// Register /export command
	api.registerCommand("export", {
		description: "Save this session as a shareable HTML file",
		getArgumentCompletions: (argumentPrefix, context) => {
			if (context && context.tokenIndex > 0) return null;
			const prefix = argumentPrefix.trim().toLowerCase();
			const values = EXPORT_COMMAND_COMPLETIONS.filter((item) => item.value.startsWith(prefix));
			return values.length > 0 ? values : null;
		},
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			// Get session manager from context
			const sessionManager = ctx.sessionManager;
			if (!sessionManager) {
				throw new Error("Session manager not available");
			}
			const outputPath = args.trim() || undefined;

			// Pass undefined for state since we don't have access to it here.
			const filePath = await extExportSessionToHtml(
				sessionManager as unknown as SessionManager,
				undefined,
				outputPath,
			);

			console.error(`Session exported to: ${filePath}`);
		},
	});

}
