/**
 * [WHO]: REGISTRY (internal, ordered), BuiltinExtension, builtInExtensions, getBuiltinExtensionPaths()
 * [FROM]: Depends on node:fs, node:path, process.env, node:module
 * [TO]: Consumed by main.ts, core/runtime/sdk.ts, test files
 * [HERE]: builtin-extensions.ts - the single ordered built-in extension registry for Catui
 *
 * One ordered list drives both the public metadata projection and the load path resolution, so
 * `defaultEnabled` is the loading decision rather than a second, independent declaration.
 */

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

export type BuiltinExtensionRiskLevel = "passive" | "command" | "tool" | "background" | "write-capable";
export type BuiltinExtensionTestContract = "lifecycle" | "external-process" | "resource-discovery" | "write-guard";

/** Public metadata projection. Load location is internal; see {@link BuiltinRegistration}. */
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

/** Where a built-in's entry point lives. */
type BuiltinEntryRoot = "builtin" | "optional";

/**
 * Ordinary entries resolve `extensions/<entryRoot>/<id>/index.{js,ts}`. The two gated cases carry
 * their own resolver, so they must not pretend to have an ordinary entry location.
 */
type BuiltinActivation =
	| { activation?: "browser-env"; entryRoot: BuiltinEntryRoot }
	| { activation: "nanomem"; entryRoot?: undefined };

type BuiltinRegistration = BuiltinExtension & BuiltinActivation & {
	/** Why this entry sits here or is gated here. Load-order entries need a reason. */
	note?: string;
};

/**
 * The single ordered source of truth for built-in extensions.
 *
 * Array order IS load order, and `defaultEnabled` IS the loading decision:
 * an entry loads when it is default-enabled, or when its activation switch is on.
 * `builtInExtensions` and `getBuiltinExtensionPaths()` are both derived from this list, so a new
 * extension cannot be registered in one and forgotten in the other.
 *
 * Order carries behavior, not cosmetics:
 * - diagnostics precedes sal, and sal precedes nanomem, so turn-context producers publish before
 *   consumers read. See core/runtime/turn-context.
 * - next-step precedes presence so its rule text lands before presence content in the merged
 *   system prompt (core/extensions-host/runner.ts:emitBeforeAgentStart joins appendSystemPrompt in
 *   registration order). Reordering requires re-verifying test/next-step-injection.test.ts.
 */
const REGISTRY: readonly BuiltinRegistration[] = [
	{ id: "local-model-enhancement", entryRoot: "optional", category: "optional", defaultEnabled: false, riskLevel: "tool", requiresUI: false, startsTimers: false, writesWorkspace: false, externalProcess: false, testContracts: ["lifecycle"], testFiles: ["test/local-model-enhancement.test.ts"] },
	{ id: "session-bridge", entryRoot: "optional", category: "optional", defaultEnabled: true, riskLevel: "command", requiresUI: false, startsTimers: false, writesWorkspace: false, externalProcess: true, testContracts: ["lifecycle", "external-process"], testFiles: ["test/session-bridge.test.ts", "test/session-bridge-setup.test.ts"] },
	{ id: "typesafe", entryRoot: "builtin", category: "default", defaultEnabled: true, riskLevel: "passive", requiresUI: false, startsTimers: false, writesWorkspace: false, externalProcess: false, resourceDiscovery: true, testContracts: ["resource-discovery"], testFiles: ["test/typesafe-extension.test.ts"] },
	{ id: "diagnostics", entryRoot: "builtin", category: "default", defaultEnabled: true, riskLevel: "background", requiresUI: false, startsTimers: true, writesWorkspace: false, externalProcess: false, testContracts: ["lifecycle"], testFiles: ["test/diagnostic-buffer-throttle.test.ts", "test/diagnostics-runtime.test.ts"], note: "Subscribes to diagnostic:event before producer extensions publish failures." },
	{ id: "sal", entryRoot: "builtin", category: "default", defaultEnabled: true, riskLevel: "background", requiresUI: false, startsTimers: false, writesWorkspace: false, externalProcess: false, testContracts: ["lifecycle"], testFiles: ["test/sal-lifecycle.test.ts"], note: "Turn-context producer; must load before nanomem, its consumer." },
	{ id: "nanomem", activation: "nanomem", category: "package", defaultEnabled: true, riskLevel: "background", requiresUI: false, startsTimers: false, writesWorkspace: false, externalProcess: false, testContracts: ["lifecycle"], testFiles: ["packages/mem-core/test/extension-commands.test.ts"], note: "Ships as a package and keeps its own four-step fallback chain." },
	{ id: "link-world", entryRoot: "builtin", category: "default", defaultEnabled: true, riskLevel: "tool", requiresUI: false, startsTimers: false, writesWorkspace: false, externalProcess: true, resourceDiscovery: true, testContracts: ["external-process", "resource-discovery"], testFiles: ["test/link-world-extension-registration.test.ts"] },
	{ id: "browser", entryRoot: "builtin", activation: "browser-env", category: "optional", defaultEnabled: false, riskLevel: "tool", requiresUI: false, startsTimers: false, writesWorkspace: false, externalProcess: true, resourceDiscovery: true, testContracts: ["external-process", "resource-discovery"], testFiles: ["test/browser-extension-registration.test.ts"], note: "Opt-in since P6/EV03; enable via --extension, config, or CATUI_ENABLE_BROWSER_EXTENSION." },
	{ id: "security-audit", entryRoot: "builtin", category: "default", defaultEnabled: true, riskLevel: "tool", requiresUI: false, startsTimers: false, writesWorkspace: false, externalProcess: false },
	{ id: "next-step", entryRoot: "builtin", category: "default", defaultEnabled: true, riskLevel: "passive", requiresUI: false, startsTimers: false, writesWorkspace: false, externalProcess: false, testContracts: ["lifecycle"], testFiles: ["test/next-step-injection.test.ts"], note: "Must precede presence for merged prompt order." },
	{ id: "presence", entryRoot: "builtin", category: "default", defaultEnabled: true, riskLevel: "background", requiresUI: true, startsTimers: true, writesWorkspace: false, externalProcess: false, testContracts: ["lifecycle"], testFiles: ["test/presence-opening.test.ts", "test/presence-locale.test.ts"] },
	{ id: "ask-user-question", entryRoot: "builtin", category: "default", defaultEnabled: true, riskLevel: "tool", requiresUI: true, startsTimers: false, writesWorkspace: false, externalProcess: false },
	{ id: "teach", entryRoot: "builtin", category: "default", defaultEnabled: true, riskLevel: "tool", requiresUI: false, startsTimers: false, writesWorkspace: true, externalProcess: false },
	{ id: "grub", entryRoot: "builtin", category: "default", defaultEnabled: true, riskLevel: "background", requiresUI: false, startsTimers: false, writesWorkspace: false, externalProcess: true, testContracts: ["lifecycle", "external-process"], testFiles: ["test/grub-controller.test.ts", "test/goal-grub-lifecycle.test.ts"] },
	{ id: "context-management", entryRoot: "builtin", category: "default", defaultEnabled: true, riskLevel: "tool", requiresUI: false, startsTimers: false, writesWorkspace: false, externalProcess: false, testContracts: ["lifecycle"], testFiles: ["test/context-management.test.ts", "test/context-window.test.ts"] },
	{ id: "goal", entryRoot: "builtin", category: "default", defaultEnabled: true, riskLevel: "background", requiresUI: false, startsTimers: false, writesWorkspace: false, externalProcess: false, testContracts: ["lifecycle"], testFiles: ["test/goal-controller.test.ts", "test/goal-grub-lifecycle.test.ts"] },
	{ id: "loop", entryRoot: "builtin", category: "default", defaultEnabled: true, riskLevel: "background", requiresUI: false, startsTimers: true, writesWorkspace: false, externalProcess: false, testContracts: ["lifecycle"], testFiles: ["test/loop-lifecycle.test.ts"] },
	{ id: "plan", entryRoot: "builtin", category: "default", defaultEnabled: true, riskLevel: "tool", requiresUI: false, startsTimers: false, writesWorkspace: false, externalProcess: false },
	{ id: "discipline", entryRoot: "builtin", category: "default", defaultEnabled: true, riskLevel: "tool", requiresUI: false, startsTimers: false, writesWorkspace: false, externalProcess: false, resourceDiscovery: true, testContracts: ["resource-discovery"], testFiles: ["test/discipline-extension.test.ts", "test/extension-smoke.test.ts"] },
	{ id: "subagent", entryRoot: "builtin", category: "default", defaultEnabled: true, riskLevel: "tool", requiresUI: false, startsTimers: false, writesWorkspace: false, externalProcess: true, testContracts: ["external-process"], testFiles: ["test/subagent-parser.test.ts", "test/worktree-manager.test.ts"] },
	{ id: "team", entryRoot: "builtin", category: "default", defaultEnabled: true, riskLevel: "background", requiresUI: false, startsTimers: false, writesWorkspace: false, externalProcess: true, testContracts: ["lifecycle", "external-process"], testFiles: ["test/team-runtime.test.ts"] },
	{ id: "idle-think", entryRoot: "builtin", category: "default", defaultEnabled: true, riskLevel: "background", requiresUI: true, startsTimers: true, writesWorkspace: false, externalProcess: true, testContracts: ["lifecycle", "external-process"], testFiles: ["test/idle-think-runtime.test.ts", "test/extension-smoke.test.ts"], note: "Default-loaded but disabled by its own behavior setting; load order is not activation." },
	{ id: "btw", entryRoot: "builtin", category: "default", defaultEnabled: true, riskLevel: "command", requiresUI: false, startsTimers: false, writesWorkspace: false, externalProcess: false },
	{ id: "recap", entryRoot: "builtin", category: "default", defaultEnabled: true, riskLevel: "command", requiresUI: false, startsTimers: false, writesWorkspace: false, externalProcess: false },
	{ id: "debug", entryRoot: "builtin", category: "default", defaultEnabled: true, riskLevel: "command", requiresUI: false, startsTimers: false, writesWorkspace: false, externalProcess: false },
	{ id: "mcp", entryRoot: "builtin", category: "default", defaultEnabled: true, riskLevel: "command", requiresUI: false, startsTimers: false, writesWorkspace: false, externalProcess: true, resourceDiscovery: true, testContracts: ["external-process", "resource-discovery"], testFiles: ["test/resource-discovery-contract.test.ts"] },
	{ id: "task", entryRoot: "builtin", category: "default", defaultEnabled: true, riskLevel: "tool", requiresUI: false, startsTimers: false, writesWorkspace: true, externalProcess: false },
	{ id: "lsp", entryRoot: "builtin", category: "default", defaultEnabled: true, riskLevel: "tool", requiresUI: false, startsTimers: false, writesWorkspace: false, externalProcess: true },
	{ id: "insights", entryRoot: "builtin", category: "default", defaultEnabled: true, riskLevel: "command", requiresUI: false, startsTimers: false, writesWorkspace: true, externalProcess: false },
	{ id: "notebook", entryRoot: "builtin", category: "default", defaultEnabled: true, riskLevel: "write-capable", requiresUI: false, startsTimers: false, writesWorkspace: true, externalProcess: false },
	{ id: "skill-tool", entryRoot: "builtin", category: "default", defaultEnabled: true, riskLevel: "tool", requiresUI: false, startsTimers: false, writesWorkspace: false, externalProcess: false },
	{ id: "catpaw", entryRoot: "builtin", category: "default", defaultEnabled: true, riskLevel: "passive", requiresUI: false, startsTimers: false, writesWorkspace: false, externalProcess: false, resourceDiscovery: true },
	{ id: "humanizer", entryRoot: "builtin", category: "default", defaultEnabled: true, riskLevel: "passive", requiresUI: false, startsTimers: false, writesWorkspace: false, externalProcess: false, resourceDiscovery: true, testContracts: ["resource-discovery"], testFiles: ["test/humanizer-extension.test.ts"] },
	{ id: "catail", entryRoot: "builtin", category: "default", defaultEnabled: true, riskLevel: "passive", requiresUI: false, startsTimers: false, writesWorkspace: false, externalProcess: false, resourceDiscovery: true, testContracts: ["resource-discovery"], testFiles: ["test/catail-extension.test.ts"] },
	{ id: "evolution", entryRoot: "optional", category: "optional", defaultEnabled: true, riskLevel: "background", requiresUI: false, startsTimers: false, writesWorkspace: false, externalProcess: true, testContracts: ["lifecycle", "external-process"], testFiles: ["test/evolution-store.test.ts", "test/evolution-extension.test.ts", "test/source-evolution.test.ts"], note: "Product-approved optional source loaded by default." },
	{ id: "simplify", entryRoot: "optional", category: "optional", defaultEnabled: false, riskLevel: "write-capable", requiresUI: false, startsTimers: false, writesWorkspace: true, externalProcess: true, testContracts: ["external-process", "write-guard"], testFiles: ["test/simplify-extension.test.ts"] },
	{ id: "export-html", entryRoot: "optional", category: "optional", defaultEnabled: false, riskLevel: "write-capable", requiresUI: false, startsTimers: false, writesWorkspace: true, externalProcess: false, testContracts: ["write-guard"], testFiles: ["test/extension-smoke.test.ts", "test/export-html-branch-navigation.test.ts"] },
];

/** Public metadata view. Same order as {@link REGISTRY}, minus internal load fields. */
export const builtInExtensions: readonly BuiltinExtension[] = REGISTRY.map(
	({ entryRoot: _entryRoot, activation: _activation, note: _note, ...metadata }) => metadata,
);

function isBrowserExtensionEnvEnabled(): boolean {
	const value = process.env.CATUI_ENABLE_BROWSER_EXTENSION?.trim().toLowerCase();
	return value === "1" || value === "true" || value === "yes" || value === "on";
}


/**
 * Resolve one ordinary entry: prefer the compiled `index.js` emitted into dist, then fall
 * back to the TypeScript source for in-repo execution. Returns undefined when neither
 * exists so a missing optional resource degrades exactly as before.
 */
function resolveOrdinaryEntry(root: BuiltinEntryRoot, dir: string): string | undefined {
	const base = join(__dirname, "extensions", root, dir);
	const compiled = join(base, "index.js");
	if (existsSync(compiled)) return compiled;
	const source = join(base, "index.ts");
	if (existsSync(source)) return source;
	return undefined;
}

/**
 * NanoMem ships as a package rather than an extension directory, so it keeps its own
 * precedence chain: dist bundle, workspace source, then node_modules resolution.
 */
function resolveNanomemEntry(): string | undefined {
	const bundled = join(__dirname, "packages", "mem-core", "extension.js");
	if (existsSync(bundled)) return bundled;

	const workspaceSource = join(__dirname, "packages", "mem-core", "src", "extension.ts");
	if (existsSync(workspaceSource)) return workspaceSource;

	try {
		const resolved = require.resolve("catui-mem/extension.js");
		if (existsSync(resolved)) return resolved;
	} catch {
		// Fall through to the package-root lookup below.
	}

	const packageRoot = findPackageRoot(__dirname);
	if (!packageRoot) return undefined;
	const nodeModulesCandidate = join(packageRoot, "node_modules", "catui-mem", "dist", "extension.js");
	return existsSync(nodeModulesCandidate) ? nodeModulesCandidate : undefined;
}

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
 * Resolve the default-loaded built-in extensions from {@link REGISTRY}, in registry order.
 *
 * An entry loads when `defaultEnabled` is true, or when its activation switch is on. That is the
 * only loading rule: there is no second list that can disagree with the metadata.
 *
 * Default-loaded from `extensions/builtin/`: the discipline, tool and passive skills
 * (typesafe, discipline, skill-tool, catpaw, humanizer, catail), memory (nanomem),
 * internet access (link-world), MCP, security-audit, and the interactive surfaces
 * (presence, idle-think, ask-user-question).
 *
 * Opt-in, enabled via configuration or `--extension`:
 * - Simplify (code simplification) - extensions/optional/simplify/
 * - export-html (HTML export) - extensions/optional/export-html/
 * - Browser harness (CDP automation) - extensions/builtin/browser/ (opt-in since P6/EV03; source stays
 *   under builtin/ until the Q2 physical/package opt-in decision moves it to extensions/optional/ or a package)
 *
 * Product-approved optional source loaded by default:
 * - Evolution (controlled self-evolution) - extensions/optional/evolution/
 *
 * An entry whose compiled `index.js` and TypeScript `index.ts` are both absent is
 * skipped, so a missing optional resource degrades to "not loaded" rather than throwing.
 */
export function getBuiltinExtensionPaths(): string[] {
	const paths: string[] = [];
	for (const entry of REGISTRY) {
		if (!isEntryActivated(entry)) continue;
		const resolved = entry.activation === "nanomem"
			? resolveNanomemEntry()
			: resolveOrdinaryEntry(entry.entryRoot, entry.id);
		if (resolved) paths.push(resolved);
	}
	return paths;
}

function isEntryActivated(entry: BuiltinRegistration): boolean {
	if (entry.activation === "browser-env") return isBrowserExtensionEnvEnabled();
	return entry.defaultEnabled;
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
