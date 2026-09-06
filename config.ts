/**
 * [WHO]: Config path getters (getAgentDir, getModelsPath, getRemotePublicDir, etc.), APP_NAME, VERSION
 * [FROM]: Depends on node:fs, node:os, node:path, node:url
 * [TO]: Consumed by main.ts, index.ts, migrations.ts, cli/args.ts, core/model-registry.ts, core/platform/keybindings.ts, core/skills.ts, core/package-manager.ts, core/soul-integration.ts, catui-defaults.ts, utils/changelog.ts, modes/remote/remote-server.ts, and all extension entry points
 * [HERE]: config.ts - configuration path discovery and constants
 */
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

// =============================================================================
// Package Detection
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Detect if we're running as a Bun compiled binary.
 * Bun binaries have import.meta.url containing "$bunfs", "~BUN", or "%7EBUN" (Bun's virtual filesystem path)
 */
export const isBunBinary =
	import.meta.url.includes("$bunfs") || import.meta.url.includes("~BUN") || import.meta.url.includes("%7EBUN");

/** Detect if Bun is the runtime (compiled binary or bun run) */
export const isBunRuntime = !!process.versions.bun;

// =============================================================================
// Install Method Detection
// =============================================================================

export type InstallMethod = "bun-binary" | "npm" | "pnpm" | "yarn" | "bun" | "unknown";

export function detectInstallMethod(): InstallMethod {
	if (isBunBinary) {
		return "bun-binary";
	}

	const resolvedPath = `${__dirname}\0${process.execPath || ""}`.toLowerCase();

	if (resolvedPath.includes("/pnpm/") || resolvedPath.includes("/.pnpm/") || resolvedPath.includes("\\pnpm\\")) {
		return "pnpm";
	}
	if (resolvedPath.includes("/yarn/") || resolvedPath.includes("/.yarn/") || resolvedPath.includes("\\yarn\\")) {
		return "yarn";
	}
	if (isBunRuntime) {
		return "bun";
	}
	if (resolvedPath.includes("/npm/") || resolvedPath.includes("/node_modules/") || resolvedPath.includes("\\npm\\")) {
		return "npm";
	}

	return "unknown";
}

export function getUpdateInstruction(packageName: string): string {
	const method = detectInstallMethod();
	switch (method) {
		case "bun-binary":
			return `Download from: https://github.com/O-Catui/Catui/releases/latest`;
		case "pnpm":
			return `Run: pnpm install -g ${packageName}`;
		case "yarn":
			return `Run: yarn global add ${packageName}`;
		case "bun":
			return `Run: bun install -g ${packageName}`;
		case "npm":
			return `Run: npm install -g ${packageName}`;
		default:
			return `Run: npm install -g ${packageName}`;
	}
}

// =============================================================================
// Package Asset Paths (shipped with executable)
// =============================================================================

/**
 * Get the base directory for resolving package assets (themes, package.json, README.md, CHANGELOG.md).
 * - For Bun binary: returns the directory containing the executable
 * - For Node.js (dist/): returns __dirname (the dist/ directory)
 * - For tsx (src/): returns parent directory (the package root)
 */
export function getPackageDir(): string {
	// Allow override via environment variable (useful for Nix/Guix where store paths tokenize poorly)
	const envDir = process.env.CATUI_PACKAGE_DIR;
	if (envDir) {
		if (envDir === "~") return homedir();
		if (envDir.startsWith("~/")) return homedir() + envDir.slice(1);
		return envDir;
	}

	if (isBunBinary) {
		// Bun binary: process.execPath points to the compiled executable
		return dirname(process.execPath);
	}
	// Node.js: walk up from __dirname until we find package.json
	let dir = __dirname;
	while (dir !== dirname(dir)) {
		if (existsSync(join(dir, "package.json"))) {
			return dir;
		}
		dir = dirname(dir);
	}
	// Fallback (shouldn't happen)
	return __dirname;
}

/**
 * Get path to built-in themes directory (shipped with package)
 * - For Bun binary: theme/ next to executable
 * - For Node.js (dist/): dist/modes/interactive/theme/
 * - For tsx (src/): src/modes/interactive/theme/
 * - For flat structure (catui-agent dev): modes/interactive/theme/
 */
export function getThemesDir(): string {
	if (isBunBinary) {
		return join(dirname(process.execPath), "theme");
	}
	// Theme is in modes/interactive/theme/ relative to src/ or dist/ or root
	const packageDir = getPackageDir();
	const themesPath = join(packageDir, "modes", "interactive", "theme");
	if (existsSync(themesPath)) {
		return themesPath; // Flat structure (dev mode with tsx)
	}
	const srcOrDist = existsSync(join(packageDir, "src")) ? "src" : "dist";
	return join(packageDir, srcOrDist, "modes", "interactive", "theme");
}

/**
 * Get path to HTML export template directory (shipped with package)
 * - For Bun binary: export-html/ next to executable
 * - For Node.js (dist/): dist/core/export-html/
 * - For tsx (src/): src/core/export-html/
 * - For flat structure (catui-agent dev): core/export-html/
 */
export function getExportTemplateDir(): string {
	if (isBunBinary) {
		return join(dirname(process.execPath), "export-html");
	}
	const packageDir = getPackageDir();
	const exportPath = join(packageDir, "core", "export-html");
	if (existsSync(exportPath)) {
		return exportPath; // Flat structure (dev mode with tsx)
	}
	const srcOrDist = existsSync(join(packageDir, "src")) ? "src" : "dist";
	return join(packageDir, srcOrDist, "core", "export-html");
}

/**
 * Get path to the remote serve mode's static web UI directory
 * - For Bun binary: public/ next to executable
 * - For Node.js (dist/): dist/modes/remote/public/
 * - For tsx (src/): modes/remote/public/
 */
export function getRemotePublicDir(): string {
	if (isBunBinary) {
		return join(dirname(process.execPath), "public");
	}
	const packageDir = getPackageDir();
	const publicPath = join(packageDir, "modes", "remote", "public");
	if (existsSync(publicPath)) {
		return publicPath; // Flat structure (dev mode with tsx)
	}
	return join(packageDir, "dist", "modes", "remote", "public");
}

/** Get path to package.json */
export function getPackageJsonPath(): string {
	return join(getPackageDir(), "package.json");
}

/** Get path to README.md */
export function getReadmePath(): string {
	return resolve(join(getPackageDir(), "README.md"));
}

/** Get path to docs directory */
export function getDocsPath(): string {
	return resolve(join(getPackageDir(), "docs"));
}

/** Get path to examples directory */
export function getExamplesPath(): string {
	return resolve(join(getPackageDir(), "examples"));
}

/** Get path to CHANGELOG.md */
export function getChangelogPath(): string {
	return resolve(join(getPackageDir(), "CHANGELOG.md"));
}

// =============================================================================
// App Config (from package.json catuiConfig)
// =============================================================================

const pkg = JSON.parse(readFileSync(getPackageJsonPath(), "utf-8"));

export const APP_NAME: string = pkg.catuiConfig?.name || "catui";
/** Config dir: ~/.catui for Catui. Fallback remains legacy-compatible when package metadata is absent. */
export const CONFIG_DIR_NAME: string =
	pkg.catuiConfig?.configDir ?? (pkg.name === "@catui/agent" ? ".catui" : ".catui");
export const VERSION: string = pkg.version;
/** npm package name, used for version checking and update prompts (e.g., @catui/agent) */
export const PACKAGE_NAME: string = pkg.name || "@catui/agent";

// e.g., CATUI_CODING_AGENT_DIR
export const ENV_AGENT_DIR = `${APP_NAME.toUpperCase()}_CODING_AGENT_DIR`;
const LEGACY_ENV_AGENT_DIR = "NANOPENCIL_CODING_AGENT_DIR";

const DEFAULT_SHARE_VIEWER_URL = "https://catui.dev/session/";

/** Get the share viewer URL for a gist ID */
export function getShareViewerUrl(gistId: string): string {
	const baseUrl = process.env.CATUI_SHARE_VIEWER_URL || DEFAULT_SHARE_VIEWER_URL;
	return `${baseUrl}#${gistId}`;
}

// =============================================================================
// User Config Paths (~/.catui/agents/default/*)
// =============================================================================

/** Get the agent config directory (e.g., ~/.catui/agents/default/) */
export function getAgentDir(): string {
	return resolveAgentDirContext().path;
}

/** Get path to user's custom themes directory */
export function getCustomThemesDir(): string {
	return join(getAgentDir(), "themes");
}

/** Get path to models.json */
export function getModelsPath(): string {
	return join(getAgentDir(), "models.json");
}

/** Get path to auth.json */
export function getAuthPath(): string {
	return join(getAgentDir(), "auth.json");
}

/** Get path to settings.json */
export function getSettingsPath(): string {
	return join(getAgentDir(), "settings.json");
}

/** Get path to tools directory */
export function getToolsDir(): string {
	return join(getAgentDir(), "tools");
}

/** Get path to managed binaries directory (fd, rg) */
export function getBinDir(): string {
	return join(getAgentDir(), "bin");
}

/** Get path to prompt templates directory */
export function getPromptsDir(): string {
	return join(getAgentDir(), "prompts");
}

/** Get path to sessions directory */
export function getSessionsDir(): string {
	return join(getAgentDir(), "sessions");
}

/** Get path to debug log file */
export function getDebugLogPath(): string {
	return join(getAgentDir(), `${APP_NAME}-debug.log`);
}

// =============================================================================
// Global Workspace Directories (browser-workspace, link-world-workspace)
// =============================================================================

function expandHomePath(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return homedir() + path.slice(1);
	return path;
}

/** Get the root Catui config directory (e.g., ~/.catui/) */
export function getConfigRoot(): string {
	const envDir = process.env[ENV_AGENT_DIR] ?? process.env[LEGACY_ENV_AGENT_DIR];
	if (envDir) {
		// ENV_AGENT_DIR points to the agent subdir (e.g., ~/.catui/agents/default)
		// We need the parent for workspace dirs
		const resolvedEnv = expandHomePath(envDir);
		// Strip /agent suffix if present
		if (resolvedEnv.endsWith("/agent") || resolvedEnv.endsWith("\\agent")) {
			return dirname(resolvedEnv);
		}
		return dirname(resolvedEnv);
	}
	return join(homedir(), CONFIG_DIR_NAME);
}

// =============================================================================
// Multi-Agent: CATUI_HOME & AgentDirContext support (N2)
// =============================================================================

/**
 * Regex for a valid agent <id>.
 * ASCII slug: lowercase alphanumeric start, then [a-z0-9._-], max 64 chars.
 * Design doc §4.1.
 */
const AGENT_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/**
 * Validate an agent id. Returns the id if valid, throws otherwise.
 */
function validateAgentId(id: string): string {
	if (!AGENT_ID_RE.test(id)) {
		throw new Error(
			`Invalid agent id "${id}". Must match ${AGENT_ID_RE.source} (lowercase ASCII slug, max 64 chars).`,
		);
	}
	return id;
}

/**
 * Resolve the Catui ecosystem root directory.
 * Priority: CATUI_HOME > CATUIS_HOME > NANOPENCIL_HOME > ~/.catui
 *
 * CATUI_HOME is canonical. CATUIS_HOME and NANOPENCIL_HOME are compatibility aliases.
 */
export function getCatuiHome(): string {
	const envCatuiHome = process.env.CATUI_HOME;
	if (envCatuiHome) {
		return expandHomePath(envCatuiHome);
	}

	// Compat aliases
	const envCatsHome = process.env.CATUIS_HOME;
	if (envCatsHome) {
		return expandHomePath(envCatsHome);
	}

	const envNanoPencilHome = process.env.NANOPENCIL_HOME;
	if (envNanoPencilHome) {
		return expandHomePath(envNanoPencilHome);
	}

	return join(homedir(), ".catui");
}

/** Catui agents root (e.g., ~/.catui/agents/) */
export function getCatuiAgentsDir(): string {
	const envCatuiAgents = process.env.CATUI_AGENTS_DIR;
	if (envCatuiAgents) {
		return expandHomePath(envCatuiAgents);
	}

	const envAgents = process.env.CATUIS_AGENTS_DIR;
	if (envAgents) {
		return expandHomePath(envAgents);
	}
	const envPencilsAgents = process.env.PENCILS_AGENTS_DIR;
	if (envPencilsAgents) {
		return expandHomePath(envPencilsAgents);
	}
	return join(getCatuiHome(), "agents");
}

/**
 * Resolve an agent directory context for a given agent id.
 * If no id is provided, returns the legacy single-agent context.
 *
 * Resolution order for per-agent path:
 * 1. CATUI_CODING_AGENT_DIR env (single-agent override)
 * 2. NANOPENCIL_CODING_AGENT_DIR env (legacy single-agent override)
 * 3. CATUI_AGENTS_DIR/<id> env (per-agent root override)
 * 4. CATUIS_AGENTS_DIR/<id> env (legacy per-agent root override)
 * 5. PENCILS_AGENTS_DIR/<id> env (legacy per-agent root override)
 * 6. ~/.catui/agents/<id> (default)
 */
export function resolveAgentDirContext(agentId?: string) {
	const id = agentId || "default";

	validateAgentId(id);

	// 1. Check single-agent env override first
	const envDir = process.env[ENV_AGENT_DIR] ?? process.env[LEGACY_ENV_AGENT_DIR];
	if (envDir && id === "default") {
		const resolvedEnv = expandHomePath(envDir);
		return { id, path: resolvedEnv };
	}

	// 2. Check explicit per-agent env override
	const envAgentsDir = process.env.CATUI_AGENTS_DIR ?? process.env.CATUIS_AGENTS_DIR ?? process.env.PENCILS_AGENTS_DIR;
	if (envAgentsDir) {
		const base = expandHomePath(envAgentsDir);
		return { id, path: join(base, id) };
	}

	// 3. Default multi-agent path under CATUI_HOME
	return { id, path: join(getCatuiHome(), "agents", id) };
}

/** Get path to global browser-workspace directory (e.g., ~/.catui/workspaces/browser-workspace) */
export function getBrowserWorkspaceDir(): string {
	return join(getConfigRoot(), "workspaces", "browser-workspace");
}

/** Get path to global link-world-workspace directory (e.g., ~/.catui/workspaces/link-world-workspace) */
export function getLinkWorldWorkspaceDir(): string {
	return join(getConfigRoot(), "workspaces", "link-world-workspace");
}
