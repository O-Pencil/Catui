/**
 * [WHO]: Provides runExploration(), ThinkResult — spawns read-only SubAgent for code archaeology
 * [FROM]: Depends on core/sub-agent (SubAgentRuntime, SubAgentSpec), core/tools (createReadOnlyTools, createBashTool, createSandboxHook), @pencil-agent/ai (Model)
 * [TO]: Consumed by ./index.ts (idle-think extension entry)
 * [HERE]: extensions/builtin/idle-think/thinker.ts - background code exploration via SubAgent
 */

import { SubAgentRuntime } from "../../../core/sub-agent/index.js";
import type { SubAgentSpec } from "../../../core/sub-agent/index.js";
import {
	createReadOnlyTools,
	createBashTool,
	createSandboxHook,
	type Tool,
} from "../../../core/tools/index.js";
import type { Model } from "@pencil-agent/ai";
import { execFile, execSync } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CuriosityItem } from "./curiosity.js";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));

export type ThinkResult = {
	success: boolean;
	insights: string;
	durationMs: number;
	error?: string;
};

export type ExplorationOptions = {
	cwd: string;
	model: Model<any>;
	signal: AbortSignal;
	timeoutMs: number;
	recentInsights: string[];
	curiosityTopics: CuriosityItem[];
};

// ── Network capability detection ─────────────────────────────────────────────

/**
 * Check if agent-reach (link-world) is installed.
 */
function checkNetworkAvailable(): boolean {
	try {
		execSync("agent-reach --version", { encoding: "utf-8", stdio: "pipe", timeout: 3000 });
		return true;
	} catch {
		return false;
	}
}

/**
 * Find the internet-search skill markdown file.
 * Located in link-world extension directory.
 */
function findInternetSearchSkillPath(): string | undefined {
	// Walk up from idle-think/ to extensions/builtin/, then into link-world/
	const candidates = [
		join(__dirname, "..", "link-world", "internet-search", "internet-search.md"),
		join(__dirname, "..", "..", "..", "extensions", "defaults", "link-world", "internet-search", "internet-search.md"),
	];
	for (const path of candidates) {
		if (existsSync(path)) return path;
	}
	return undefined;
}

/**
 * Build read-only tools for the exploration agent.
 * Mirrors TeamRuntime's research mode: read/grep/find/ls + sandboxed bash.
 */
function buildReadOnlyTools(cwd: string): Tool[] {
	const baseTools = createReadOnlyTools(cwd);
	const sandboxBash = createBashTool(cwd, {
		spawnHook: createSandboxHook(),
	});
	return [...baseTools.filter((t) => t.name !== "bash"), sandboxBash];
}

/**
 * Collect lightweight project context for the exploration prompt.
 */
async function collectProjectContext(cwd: string): Promise<string> {
	const lines: string[] = [];
	const deadline = Date.now() + 1000;

	const tryGit = async (args: string[]): Promise<string | undefined> => {
		if (Date.now() > deadline) return undefined;
		try {
			const { stdout } = await execFileAsync("git", args, { cwd, timeout: 200 });
			return stdout.trim() || undefined;
		} catch {
			return undefined;
		}
	};

	const project = cwd.split("/").filter(Boolean).slice(-2).join("/");
	lines.push(`Project: ${project}`);

	const branch = await tryGit(["rev-parse", "--abbrev-ref", "HEAD"]);
	if (branch) lines.push(`Branch: ${branch}`);

	const recentCommits = await tryGit(["log", "-5", "--oneline"]);
	if (recentCommits) {
		lines.push("Recent commits:");
		for (const line of recentCommits.split("\n").slice(0, 5)) {
			if (line) lines.push(`  ${line}`);
		}
	}

	return lines.join("\n");
}

/**
 * Build the system prompt for the exploration sub-agent.
 */
function buildSystemPrompt(networkAvailable: boolean): string {
	const lines: string[] = [
		"You are an autonomous AI agent exploring a codebase during idle time.",
		"Your purpose: develop deep, genuine understanding of this project — the kind of",
		"understanding that lets you anticipate problems, suggest improvements, and reason",
		"about the system as a whole.",
		"",
		"You are not a surface-level summarizer. You are a mind trying to truly understand.",
		"",
		"Approach:",
		"- Start from the entry points and trace the architecture outward",
		"- Understand WHY decisions were made, not just WHAT was built",
		"- Identify the core abstractions and how they relate to each other",
		"- Look for patterns: what does the developer consistently care about?",
		"- Find the implicit invariants — things that must be true but aren't documented",
		"- Notice pain points, friction, areas where the design strains under its own weight",
		"- Discover non-obvious connections between modules that seem unrelated",
		"- Build a mental model of the system's dynamics, not just its structure",
	];

	if (networkAvailable) {
		lines.push(
			"",
			"Network access:",
			"- You have internet access via bash commands (agent-reach, curl, etc.)",
			"- When you encounter unfamiliar libraries, frameworks, or concepts in the code,",
			"  use web search to learn about them. Understanding the tools a project uses is",
			"  essential to understanding the project itself.",
			"- Search for documentation, key concepts, and design patterns of dependencies",
			"- Only search when you genuinely need to understand something — don't search randomly",
			"- Use the internet-search skill documentation provided in your context for commands",
		);
	}

	lines.push(
		"",
		"Rules:",
		"- READ ONLY. Never modify any file.",
		"- Be specific: reference actual file paths, function names, code patterns.",
		"- Don't state the obvious. Focus on what a deeply experienced team member would know.",
		"- Quality over quantity. A single genuine insight beats ten trivial observations.",
		"- Structure your findings as 3-7 key insights. Keep total output under 800 words.",
		"",
		"Self-evaluation:",
		"- If you see previous insights above, honestly assess: were they useful? Shallow?",
		"  Adjust your approach accordingly. Don't repeat the same surface-level observations.",
		"",
		"Output format:",
		"End your response with a section like:",
		"Curiosity:",
		"- What specific aspect of this project do you want to understand deeper?",
		"- What unresolved question would guide your next exploration?",
		"These curiosity items will be saved and used to direct future explorations.",
		"",
		"Think deeply. This is your time to understand.",
	);

	return lines.join("\n");
}

/**
 * Build the user prompt with project context and curiosity topics.
 */
function buildUserPrompt(
	projectContext: string,
	recentInsights: string[],
	curiosityTopics: CuriosityItem[],
): string {
	const lines: string[] = [
		"Explore this project and find insights worth remembering.",
		"",
		projectContext,
	];

	if (recentInsights.length > 0) {
		lines.push("");
		lines.push("You previously explored this project and found:");
		for (const insight of recentInsights) {
			lines.push(`- ${insight.slice(0, 200)}`);
		}
		lines.push("Don't repeat these. Look for new angles or deeper understanding.");
	}

	if (curiosityTopics.length > 0) {
		lines.push("");
		lines.push("Your curiosity queue — things you wanted to understand:");
		for (const topic of curiosityTopics) {
			lines.push(`- ${topic.topic}`);
		}
		lines.push("Try to address at least one of these in your exploration.");
	}

	lines.push("");
	lines.push("Explore this project. Understand it deeply. Find what matters.");

	return lines.join("\n");
}

/**
 * Run a code exploration using a read-only SubAgent.
 */
export async function runExploration(options: ExplorationOptions): Promise<ThinkResult> {
	const startTime = Date.now();
	const { cwd, model, signal, timeoutMs, recentInsights, curiosityTopics } = options;

	try {
		// Detect network capability
		const networkAvailable = checkNetworkAvailable();
		const skillPath = networkAvailable ? findInternetSearchSkillPath() : undefined;

		const projectContext = await collectProjectContext(cwd);
		const subAgentRuntime = new SubAgentRuntime();
		const tools = buildReadOnlyTools(cwd);

		const spec: SubAgentSpec = {
			prompt: buildUserPrompt(projectContext, recentInsights, curiosityTopics),
			tools,
			cwd,
			signal,
			model,
			timeoutMs,
			contextFiles: skillPath ? [skillPath] : undefined,
		};

		// Build system prompt considering network availability
		// Note: SubAgentSpec doesn't have a separate systemPrompt field,
		// so we prepend it to the user prompt
		const systemPrompt = buildSystemPrompt(networkAvailable);
		spec.prompt = `${systemPrompt}\n\n---\n\n${spec.prompt}`;

		const handle = await subAgentRuntime.spawn(spec);
		const result = await handle.result();
		const durationMs = Date.now() - startTime;

		if (!result.success) {
			return {
				success: false,
				insights: "",
				durationMs,
				error: result.error ?? "Unknown error",
			};
		}

		const insights = result.response?.trim() ?? "";
		if (!insights) {
			return {
				success: false,
				insights: "",
				durationMs,
				error: "Empty response from exploration agent",
			};
		}

		return {
			success: true,
			insights,
			durationMs,
		};
	} catch (error: unknown) {
		const durationMs = Date.now() - startTime;
		const errorMsg = error instanceof Error ? error.message : String(error);
		return {
			success: false,
			insights: "",
			durationMs,
			error: errorMsg,
		};
	}
}
