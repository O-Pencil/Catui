/**
 * [WHO]: BuiltinExtension, getBuiltinExtensionPaths(), builtInExtensions
 * [FROM]: Depends on node:fs, node:path, config
 * [TO]: Consumed by main.ts, test files
 * [HERE]: builtin-extensions.ts - built-in extension registry for Catui
 */

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

/** Built-in extension paths */
const BUNDLED_NANOMEM_EXTENSION_PACKAGES = join(__dirname, "packages", "mem-core", "extension.js");
const BUNDLED_LINK_WORLD_EXTENSION = join(__dirname, "extensions", "builtin", "link-world", "index.js");
// Browser harness is opt-in (P6/EV03): no default-load path const; enabled via --extension/config.
const BUNDLED_SECURITY_AUDIT_EXTENSION = join(__dirname, "extensions", "builtin", "security-audit", "index.js");
const BUNDLED_SOUL_EXTENSION = join(__dirname, "extensions", "builtin", "soul", "index.js");
const BUNDLED_PRESENCE_EXTENSION = join(__dirname, "extensions", "builtin", "presence", "index.js");
const BUNDLED_NEXT_STEP_EXTENSION = join(__dirname, "extensions", "builtin", "next-step", "index.js");
const BUNDLED_ASK_USER_QUESTION_EXTENSION = join(__dirname, "extensions", "builtin", "ask-user-question", "index.js");
const BUNDLED_TEACH_EXTENSION = join(__dirname, "extensions", "builtin", "teach", "index.js");
const BUNDLED_LOOP_EXTENSION = join(__dirname, "extensions", "builtin", "loop", "index.js");
const BUNDLED_PLAN_EXTENSION = join(__dirname, "extensions", "builtin", "plan", "index.js");
const BUNDLED_DISCIPLINE_EXTENSION = join(__dirname, "extensions", "builtin", "discipline", "index.js");
const BUNDLED_DIAGNOSTICS_EXTENSION = join(__dirname, "extensions", "builtin", "diagnostics", "index.js");
const BUNDLED_SAL_EXTENSION = join(__dirname, "extensions", "builtin", "sal", "index.js");
const BUNDLED_TOKEN_SAVE_EXTENSION = join(__dirname, "extensions", "builtin", "token-save", "index.js");
const BUNDLED_GRUB_EXTENSION = join(__dirname, "extensions", "builtin", "grub", "index.js");
const BUNDLED_GOAL_EXTENSION = join(__dirname, "extensions", "builtin", "goal", "index.js");
const BUNDLED_SUBAGENT_EXTENSION = join(__dirname, "extensions", "builtin", "subagent", "index.js");
const BUNDLED_TEAM_EXTENSION = join(__dirname, "extensions", "builtin", "team", "index.js");
const BUNDLED_IDLE_THINK_EXTENSION = join(__dirname, "extensions", "builtin", "idle-think", "index.js");
const BUNDLED_BTW_EXTENSION = join(__dirname, "extensions", "builtin", "btw", "index.js");
const BUNDLED_RECAP_EXTENSION = join(__dirname, "extensions", "builtin", "recap", "index.js");
const BUNDLED_DEBUG_EXTENSION = join(__dirname, "extensions", "builtin", "debug", "index.js");
const BUNDLED_MCP_EXTENSION = join(__dirname, "extensions", "builtin", "mcp", "index.js");
const BUNDLED_TASK_EXTENSION = join(__dirname, "extensions", "builtin", "task", "index.js");
const BUNDLED_LSP_EXTENSION = join(__dirname, "extensions", "builtin", "lsp", "index.js");
const BUNDLED_INSIGHTS_EXTENSION = join(__dirname, "extensions", "builtin", "insights", "index.js");
const BUNDLED_NOTEBOOK_EXTENSION = join(__dirname, "extensions", "builtin", "notebook", "index.js");
const BUNDLED_SKILL_TOOL_EXTENSION = join(__dirname, "extensions", "builtin", "skill-tool", "index.js");

export type BuiltinExtensionRiskLevel = "passive" | "command" | "tool" | "background" | "write-capable";
export type BuiltinExtensionTestContract = "lifecycle" | "external-process" | "resource-discovery" | "write-guard";

export interface BuiltinExtension {
	id: string;
	category: "default" | "optional" | "package";
	defaultEnabled: boolean;
	riskLevel: BuiltinExtensionRiskLevel;
	requiresUI: boolean;
	startsTimers: boolean;
	writesWorkspace: boolean;
	externalProcess: boolean;
	resourceDiscovery?: boolean;
	testContracts?: readonly BuiltinExtensionTestContract[];
	testFiles?: readonly string[];
}

export const builtInExtensions: readonly BuiltinExtension[] = [
	{ id: "diagnostics", category: "default", defaultEnabled: true, riskLevel: "background", requiresUI: false, startsTimers: true, writesWorkspace: false, externalProcess: false, testContracts: ["lifecycle"], testFiles: ["test/diagnostic-buffer-throttle.test.ts", "test/diagnostics-runtime.test.ts"] },
	{ id: "sal", category: "default", defaultEnabled: true, riskLevel: "background", requiresUI: false, startsTimers: false, writesWorkspace: false, externalProcess: false, testContracts: ["lifecycle"], testFiles: ["test/sal-lifecycle.test.ts"] },
	{ id: "token-save", category: "default", defaultEnabled: true, riskLevel: "tool", requiresUI: false, startsTimers: false, writesWorkspace: false, externalProcess: false },
	{ id: "nanomem", category: "package", defaultEnabled: true, riskLevel: "background", requiresUI: false, startsTimers: false, writesWorkspace: false, externalProcess: false, testContracts: ["lifecycle"], testFiles: ["packages/mem-core/test/extension-commands.test.ts"] },
	{ id: "link-world", category: "default", defaultEnabled: true, riskLevel: "tool", requiresUI: false, startsTimers: false, writesWorkspace: false, externalProcess: true, resourceDiscovery: true, testContracts: ["external-process", "resource-discovery"], testFiles: ["test/link-world-extension-registration.test.ts"] },
	{ id: "browser", category: "optional", defaultEnabled: false, riskLevel: "tool", requiresUI: false, startsTimers: false, writesWorkspace: false, externalProcess: true, resourceDiscovery: true, testContracts: ["external-process", "resource-discovery"], testFiles: ["test/browser-extension-registration.test.ts"] },
	{ id: "security-audit", category: "default", defaultEnabled: true, riskLevel: "tool", requiresUI: false, startsTimers: false, writesWorkspace: false, externalProcess: false },
	{ id: "soul", category: "default", defaultEnabled: true, riskLevel: "passive", requiresUI: false, startsTimers: false, writesWorkspace: false, externalProcess: false },
	{ id: "presence", category: "default", defaultEnabled: true, riskLevel: "background", requiresUI: true, startsTimers: true, writesWorkspace: false, externalProcess: false, testContracts: ["lifecycle"], testFiles: ["test/presence-opening.test.ts", "test/presence-locale.test.ts"] },
	{ id: "next-step", category: "default", defaultEnabled: true, riskLevel: "passive", requiresUI: false, startsTimers: false, writesWorkspace: false, externalProcess: false, testContracts: ["lifecycle"], testFiles: ["test/next-step-injection.test.ts"] },
	{ id: "ask-user-question", category: "default", defaultEnabled: true, riskLevel: "tool", requiresUI: true, startsTimers: false, writesWorkspace: false, externalProcess: false },
	{ id: "teach", category: "default", defaultEnabled: true, riskLevel: "tool", requiresUI: false, startsTimers: false, writesWorkspace: true, externalProcess: false },
	{ id: "grub", category: "default", defaultEnabled: true, riskLevel: "background", requiresUI: false, startsTimers: false, writesWorkspace: false, externalProcess: true, testContracts: ["lifecycle", "external-process"], testFiles: ["test/grub-controller.test.ts"] },
	{ id: "goal", category: "default", defaultEnabled: true, riskLevel: "background", requiresUI: false, startsTimers: false, writesWorkspace: false, externalProcess: false, testContracts: ["lifecycle"], testFiles: ["test/goal-controller.test.ts"] },
	{ id: "loop", category: "default", defaultEnabled: true, riskLevel: "background", requiresUI: false, startsTimers: true, writesWorkspace: false, externalProcess: false, testContracts: ["lifecycle"], testFiles: ["test/loop-lifecycle.test.ts"] },
	{ id: "plan", category: "default", defaultEnabled: true, riskLevel: "tool", requiresUI: false, startsTimers: false, writesWorkspace: false, externalProcess: false },
	{ id: "discipline", category: "default", defaultEnabled: true, riskLevel: "tool", requiresUI: false, startsTimers: false, writesWorkspace: false, externalProcess: false, resourceDiscovery: true, testContracts: ["resource-discovery"], testFiles: ["test/discipline-extension.test.ts", "test/extension-smoke.test.ts"] },
	{ id: "subagent", category: "default", defaultEnabled: true, riskLevel: "tool", requiresUI: false, startsTimers: false, writesWorkspace: false, externalProcess: true, testContracts: ["external-process"], testFiles: ["test/subagent-parser.test.ts", "test/worktree-manager.test.ts"] },
	{ id: "team", category: "default", defaultEnabled: true, riskLevel: "background", requiresUI: false, startsTimers: false, writesWorkspace: false, externalProcess: true, testContracts: ["lifecycle", "external-process"], testFiles: ["test/team-runtime.test.ts"] },
	{ id: "idle-think", category: "default", defaultEnabled: true, riskLevel: "background", requiresUI: true, startsTimers: true, writesWorkspace: false, externalProcess: true, testContracts: ["lifecycle", "external-process"], testFiles: ["test/idle-think-runtime.test.ts", "test/extension-smoke.test.ts"] },
	{ id: "btw", category: "default", defaultEnabled: true, riskLevel: "command", requiresUI: false, startsTimers: false, writesWorkspace: false, externalProcess: false },
	{ id: "recap", category: "default", defaultEnabled: true, riskLevel: "command", requiresUI: false, startsTimers: false, writesWorkspace: false, externalProcess: false },
	{ id: "debug", category: "default", defaultEnabled: true, riskLevel: "command", requiresUI: false, startsTimers: false, writesWorkspace: false, externalProcess: false },
	{ id: "mcp", category: "default", defaultEnabled: true, riskLevel: "command", requiresUI: false, startsTimers: false, writesWorkspace: false, externalProcess: true, resourceDiscovery: true, testContracts: ["external-process", "resource-discovery"], testFiles: ["test/resource-discovery-contract.test.ts"] },
	{ id: "task", category: "default", defaultEnabled: true, riskLevel: "tool", requiresUI: false, startsTimers: false, writesWorkspace: true, externalProcess: false },
	{ id: "lsp", category: "default", defaultEnabled: true, riskLevel: "tool", requiresUI: false, startsTimers: false, writesWorkspace: false, externalProcess: true },
	{ id: "insights", category: "default", defaultEnabled: true, riskLevel: "command", requiresUI: false, startsTimers: false, writesWorkspace: true, externalProcess: false },
	{ id: "notebook", category: "default", defaultEnabled: true, riskLevel: "write-capable", requiresUI: false, startsTimers: false, writesWorkspace: true, externalProcess: false },
	{ id: "skill-tool", category: "default", defaultEnabled: true, riskLevel: "tool", requiresUI: false, startsTimers: false, writesWorkspace: false, externalProcess: false },
	{ id: "simplify", category: "optional", defaultEnabled: false, riskLevel: "write-capable", requiresUI: false, startsTimers: false, writesWorkspace: true, externalProcess: true, testContracts: ["external-process", "write-guard"], testFiles: ["test/simplify-extension.test.ts"] },
	{ id: "export-html", category: "optional", defaultEnabled: false, riskLevel: "write-capable", requiresUI: false, startsTimers: false, writesWorkspace: true, externalProcess: false, testContracts: ["write-guard"], testFiles: ["test/extension-smoke.test.ts", "test/export-html-branch-navigation.test.ts"] },
];

/** Find package root from current module location (containing package.json with catui-agent related name) */
function findPackageRoot(startDir: string): string | null {
	let dir = startDir;
	for (let i = 0; i < 20; i++) {
		try {
			const pkgPath = join(dir, "package.json");
			if (existsSync(pkgPath)) {
				const raw = readFileSync(pkgPath, "utf-8");
				const pkg = JSON.parse(raw) as { name?: string };
				if (pkg.name === "@catui/agent" || pkg.name === "catui-agent") return dir;
			}
		} catch {
			// ignore
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

/**
 * Get the list of built-in extension paths that Catui loads by default
 *
 * Returns all default-enabled extension paths (builtin/):
 * - NanoMem (persistent memory)
 * - Soul (AI personality evolution)
 * - LinkWorld (internet search)
 * - SecurityAudit (security audit)
 * - MCP (MCP protocol adapter)
 *
 * Optional extensions need to be enabled via configuration or --extension:
 * - Simplify (code simplification) - extensions/optional/simplify/
 * - export-html (HTML export) - extensions/optional/export-html/
 * - Browser harness (CDP automation) - extensions/builtin/browser/ (opt-in since P6/EV03; source stays
 *   under builtin/ until the Q2 physical/package opt-in decision moves it to extensions/optional/ or a package)
 */
export function getBuiltinExtensionPaths(): string[] {
	const paths: string[] = [];

	// === Diagnostics extension (extension-owned issue buffer and reporting) ===
	// Loaded first so it can subscribe to diagnostic:event before producer
	// extensions such as SAL publish background failures.
	if (existsSync(BUNDLED_DIAGNOSTICS_EXTENSION)) {
		paths.push(BUNDLED_DIAGNOSTICS_EXTENSION);
	} else {
		const diagnosticsTs = join(__dirname, "extensions", "builtin", "diagnostics", "index.ts");
		if (existsSync(diagnosticsTs)) paths.push(diagnosticsTs);
	}

	// === SAL extension (Structural Anchor Localization, default-on, experimental) ===
	// Loaded ahead of NanoMem because turn-context producers must publish before
	// turn-context consumers read. SAL is a producer of structuralAnchor; NanoMem
	// is a consumer. Both speak only to core/runtime/turn-context — neither names
	// the other. Deleting this directory + this block leaves the system fully
	// functional (NanoMem's structural boost just becomes a no-op).
	if (existsSync(BUNDLED_SAL_EXTENSION)) {
		paths.push(BUNDLED_SAL_EXTENSION);
	} else {
		const salTs = join(__dirname, "extensions", "builtin", "sal", "index.ts");
		if (existsSync(salTs)) paths.push(salTs);
	}

	// === TokenSave extension (default-on command output filtering and savings analytics) ===
	if (existsSync(BUNDLED_TOKEN_SAVE_EXTENSION)) {
		paths.push(BUNDLED_TOKEN_SAVE_EXTENSION);
	} else {
		const tokenSaveTs = join(__dirname, "extensions", "builtin", "token-save", "index.ts");
		if (existsSync(tokenSaveTs)) paths.push(tokenSaveTs);
	}

	// === NanoMem extension ===
	// 1) Prefer extension bundled to dist/packages during build
	if (existsSync(BUNDLED_NANOMEM_EXTENSION_PACKAGES)) {
		paths.push(BUNDLED_NANOMEM_EXTENSION_PACKAGES);
	} else {
		// 2) Development mode: local workspace source file (preferred over node_modules to avoid conflicts)
		const memCoreTs = join(__dirname, "packages", "mem-core", "src", "extension.ts");
		if (existsSync(memCoreTs)) {
			paths.push(memCoreTs);
		} else {
			// 3) require.resolve: mem-core in node_modules during development/local install
			try {
				const extPath = require.resolve("catui-mem/extension.js");
				if (existsSync(extPath)) paths.push(extPath);
			} catch {
				// 4) Look for package root + node_modules/catui-mem/dist/extension.js
				const packageRoot = findPackageRoot(__dirname);
				if (packageRoot) {
					const candidate = join(packageRoot, "node_modules", "catui-mem", "dist", "extension.js");
					if (existsSync(candidate)) paths.push(candidate);
				}
			}
		}
	}

	// === link-world extension (built-in source, compiled to dist/extensions/builtin/link-world) ===
	if (existsSync(BUNDLED_LINK_WORLD_EXTENSION)) {
		paths.push(BUNDLED_LINK_WORLD_EXTENSION);
	} else {
		const linkWorldTs = join(__dirname, "extensions", "builtin", "link-world", "index.ts");
		if (existsSync(linkWorldTs)) paths.push(linkWorldTs);
	}

	// Browser Harness is an opt-in optional capability (P6/EV03) — not loaded by default.
	// Enable it explicitly via `--extension extensions/builtin/browser` or config `extensions:`.
	// (Physical dir stays under builtin/ pending the Q2 physical/package opt-in decision; the
	// P6 change here is registration-only and does not change package files.)

	// === Security Audit extension (built-in source, compiled to dist/extensions/builtin/security-audit) ===
	if (existsSync(BUNDLED_SECURITY_AUDIT_EXTENSION)) {
		paths.push(BUNDLED_SECURITY_AUDIT_EXTENSION);
	} else {
		const securityAuditTs = join(__dirname, "extensions", "builtin", "security-audit", "index.ts");
		if (existsSync(securityAuditTs)) paths.push(securityAuditTs);
	}

	// === Soul extension (personality evolution system) ===
	if (existsSync(BUNDLED_SOUL_EXTENSION)) {
		paths.push(BUNDLED_SOUL_EXTENSION);
	} else {
		const soulTs = join(__dirname, "extensions", "builtin", "soul", "index.ts");
		if (existsSync(soulTs)) paths.push(soulTs);
	}

	// === Next-step extension (default-on Codex-style "suggest next steps" rule injection) ===
	// Registered BEFORE presence so its rule text appears BEFORE presence content in the
	// merged system prompt — see core/extensions-host/runner.ts:emitBeforeAgentStart
	// (appendSystemPrompt accumulates in registration order via "\n\n"). If you reorder
	// this, also re-verify test/next-step-injection.test.ts "merge order".
	if (existsSync(BUNDLED_NEXT_STEP_EXTENSION)) {
		paths.push(BUNDLED_NEXT_STEP_EXTENSION);
	} else {
		const nextStepTs = join(__dirname, "extensions", "builtin", "next-step", "index.ts");
		if (existsSync(nextStepTs)) paths.push(nextStepTs);
	}

	if (existsSync(BUNDLED_PRESENCE_EXTENSION)) {
		paths.push(BUNDLED_PRESENCE_EXTENSION);
	} else {
		const presenceTs = join(__dirname, "extensions", "builtin", "presence", "index.ts");
		if (existsSync(presenceTs)) paths.push(presenceTs);
	}
	if (existsSync(BUNDLED_NEXT_STEP_EXTENSION)) {
		paths.push(BUNDLED_NEXT_STEP_EXTENSION);
	} else {
		const nextStepTs = join(__dirname, "extensions", "builtin", "next-step", "index.ts");
		if (existsSync(nextStepTs)) paths.push(nextStepTs);
	}

	// === AskUserQuestion extension (structured multiple-choice questions) ===
	// 1:1 port of Claude Code AskUserQuestion tool, replaces interview extension.
	if (existsSync(BUNDLED_ASK_USER_QUESTION_EXTENSION)) {
		paths.push(BUNDLED_ASK_USER_QUESTION_EXTENSION);
	} else {
		const askUserQuestionTs = join(__dirname, "extensions", "builtin", "ask-user-question", "index.ts");
		if (existsSync(askUserQuestionTs)) paths.push(askUserQuestionTs);
	}

	// === Teach extension (guided knowledge teaching) ===
	if (existsSync(BUNDLED_TEACH_EXTENSION)) {
		paths.push(BUNDLED_TEACH_EXTENSION);
	} else {
		const teachTs = join(__dirname, "extensions", "builtin", "teach", "index.ts");
		if (existsSync(teachTs)) paths.push(teachTs);
	}

	// === Grub extension (/grub autonomous iterative task) ===
	if (existsSync(BUNDLED_GRUB_EXTENSION)) {
		paths.push(BUNDLED_GRUB_EXTENSION);
	} else {
		const grubTs = join(__dirname, "extensions", "builtin", "grub", "index.ts");
		if (existsSync(grubTs)) paths.push(grubTs);
	}

	// === Goal extension (/goal long-running task with idle continuation) ===
	if (existsSync(BUNDLED_GOAL_EXTENSION)) {
		paths.push(BUNDLED_GOAL_EXTENSION);
	} else {
		const goalTs = join(__dirname, "extensions", "builtin", "goal", "index.ts");
		if (existsSync(goalTs)) paths.push(goalTs);
	}

	// === Loop extension (/loop recurring scheduler) ===
	if (existsSync(BUNDLED_LOOP_EXTENSION)) {
		paths.push(BUNDLED_LOOP_EXTENSION);
	} else {
		const loopTs = join(__dirname, "extensions", "builtin", "loop", "index.ts");
		if (existsSync(loopTs)) paths.push(loopTs);
	}

	// === Plan extension (/plan mode for planning before coding) ===
	if (existsSync(BUNDLED_PLAN_EXTENSION)) {
		paths.push(BUNDLED_PLAN_EXTENSION);
	} else {
		const planTs = join(__dirname, "extensions", "builtin", "plan", "index.ts");
		if (existsSync(planTs)) paths.push(planTs);
	}

	// === Discipline extension (default engineering workflow skills and bootstrap) ===
	if (existsSync(BUNDLED_DISCIPLINE_EXTENSION)) {
		paths.push(BUNDLED_DISCIPLINE_EXTENSION);
	} else {
		const disciplineTs = join(__dirname, "extensions", "builtin", "discipline", "index.ts");
		if (existsSync(disciplineTs)) paths.push(disciplineTs);
	}

	// Built-in SubAgent extension
	if (existsSync(BUNDLED_SUBAGENT_EXTENSION)) {
		paths.push(BUNDLED_SUBAGENT_EXTENSION);
	} else {
		const subagentTs = join(__dirname, "extensions", "builtin", "subagent", "index.ts");
		if (existsSync(subagentTs)) paths.push(subagentTs);
	}

	// Built-in AgentTeam extension (Phase B - persistent teammates)
	if (existsSync(BUNDLED_TEAM_EXTENSION)) {
		paths.push(BUNDLED_TEAM_EXTENSION);
	} else {
		const teamTs = join(__dirname, "extensions", "builtin", "team", "index.ts");
		if (existsSync(teamTs)) paths.push(teamTs);
	}

	// === IdleThink extension (background code exploration during idle) ===
	if (existsSync(BUNDLED_IDLE_THINK_EXTENSION)) {
		paths.push(BUNDLED_IDLE_THINK_EXTENSION);
	} else {
		const idleThinkTs = join(__dirname, "extensions", "builtin", "idle-think", "index.ts");
		if (existsSync(idleThinkTs)) paths.push(idleThinkTs);
	}

	// === BTW extension (quick side question without interrupting) ===
	if (existsSync(BUNDLED_BTW_EXTENSION)) {
		paths.push(BUNDLED_BTW_EXTENSION);
	} else {
		const btwTs = join(__dirname, "extensions", "builtin", "btw", "index.ts");
		if (existsSync(btwTs)) paths.push(btwTs);
	}

	// === Recap extension (on-demand ※ recap situational summaries) ===
	if (existsSync(BUNDLED_RECAP_EXTENSION)) {
		paths.push(BUNDLED_RECAP_EXTENSION);
	} else {
		const recapTs = join(__dirname, "extensions", "builtin", "recap", "index.ts");
		if (existsSync(recapTs)) paths.push(recapTs);
	}

	// === Debug extension (system diagnostics with three-layer analysis) ===
	if (existsSync(BUNDLED_DEBUG_EXTENSION)) {
		paths.push(BUNDLED_DEBUG_EXTENSION);
	} else {
		const debugTs = join(__dirname, "extensions", "builtin", "debug", "index.ts");
		if (existsSync(debugTs)) paths.push(debugTs);
	}

	// Built-in MCP extension
	if (existsSync(BUNDLED_MCP_EXTENSION)) {
		paths.push(BUNDLED_MCP_EXTENSION);
	} else {
		const mcpTs = join(__dirname, "extensions", "builtin", "mcp", "index.ts");
		if (existsSync(mcpTs)) paths.push(mcpTs);
	}

	// === Task extension (task management + tool discovery) ===
	if (existsSync(BUNDLED_TASK_EXTENSION)) {
		paths.push(BUNDLED_TASK_EXTENSION);
	} else {
		const taskTs = join(__dirname, "extensions", "builtin", "task", "index.ts");
		if (existsSync(taskTs)) paths.push(taskTs);
	}

	// === LSP extension (Language Server Protocol code intelligence) ===
	if (existsSync(BUNDLED_LSP_EXTENSION)) {
		paths.push(BUNDLED_LSP_EXTENSION);
	} else {
		const lspTs = join(__dirname, "extensions", "builtin", "lsp", "index.ts");
		if (existsSync(lspTs)) paths.push(lspTs);
	}

	// === Insights extension (/insights usage report) ===
	if (existsSync(BUNDLED_INSIGHTS_EXTENSION)) {
		paths.push(BUNDLED_INSIGHTS_EXTENSION);
	} else {
		const insightsTs = join(__dirname, "extensions", "builtin", "insights", "index.ts");
		if (existsSync(insightsTs)) paths.push(insightsTs);
	}

	// === Notebook extension (NotebookEdit tool for .ipynb files) ===
	if (existsSync(BUNDLED_NOTEBOOK_EXTENSION)) {
		paths.push(BUNDLED_NOTEBOOK_EXTENSION);
	} else {
		const notebookTs = join(__dirname, "extensions", "builtin", "notebook", "index.ts");
		if (existsSync(notebookTs)) paths.push(notebookTs);
	}

	// === Skill tool extension (LLM-callable skill invocation) ===
	if (existsSync(BUNDLED_SKILL_TOOL_EXTENSION)) {
		paths.push(BUNDLED_SKILL_TOOL_EXTENSION);
	} else {
		const skillToolTs = join(__dirname, "extensions", "builtin", "skill-tool", "index.ts");
		if (existsSync(skillToolTs)) paths.push(skillToolTs);
	}

	return paths;
}

/**
 * @deprecated Use getBuiltinExtensionPaths() instead
 */
export function getNanopencilDefaultExtensionPaths(): string[] {
	return getBuiltinExtensionPaths();
}

/**
 * @deprecated Use getBuiltinExtensionPaths() instead
 */
export function getCatuiDefaultExtensionPaths(): string[] {
	return getBuiltinExtensionPaths();
}
