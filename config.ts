/**
 * [WHO]: Config path getters (getAgentDir, getModelsPath, etc.), APP_NAME, VERSION
 * [FROM]: Depends on node:fs, node:os, node:path, node:url
 * [TO]: Consumed by main.ts, index.ts, migrations.ts, cli/args.ts, core/model-registry.ts, core/keybindings.ts, core/skills.ts, core/package-manager.ts, core/soul-integration.ts, nanopencil-defaults.ts, utils/changelog.ts, and all extension entry points
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
			return `Download from: https://github.com/O-Pencil/nanoPencil/releases/latest`;
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
	const envDir = process.env.NANOPENCIL_PACKAGE_DIR;
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
 * - For flat structure (nano-pencil dev): modes/interactive/theme/
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
 * - For flat structure (nano-pencil dev): core/export-html/
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
// App Config (from package.json nanopencilConfig)
// =============================================================================

const pkg = JSON.parse(readFileSync(getPackageJsonPath(), "utf-8"));

export const APP_NAME: string = pkg.nanopencilConfig?.name || "nanopencil";
/** Config dir: ~/.nanopencil for nanopencil. Fallback by package name when nanopencilConfig missing. */
export const CONFIG_DIR_NAME: string =
	pkg.nanopencilConfig?.configDir ?? (pkg.name === "@pencil-agent/nano-pencil" ? ".nanopencil" : ".nanopencil");
export const VERSION: string = pkg.version;
/** npm package name, used for version checking and update prompts (e.g., @pencil-agent/nano-pencil) */
export const PACKAGE_NAME: string = pkg.name || "@pencil-agent/nano-pencil";

// e.g., NANOPENCIL_CODING_AGENT_DIR
export const ENV_AGENT_DIR = `${APP_NAME.toUpperCase()}_CODING_AGENT_DIR`;

const DEFAULT_SHARE_VIEWER_URL = "https://nanopencil.dev/session/";

/** Get the share viewer URL for a gist ID */
export function getShareViewerUrl(gistId: string): string {
	const baseUrl = process.env.NANOPENCIL_SHARE_VIEWER_URL || DEFAULT_SHARE_VIEWER_URL;
	return `${baseUrl}#${gistId}`;
}

// =============================================================================
// User Config Paths (~/.nanopencil/agent/*)
// =============================================================================

/** Get the agent config directory (e.g., ~/.nanopencil/agent/) */
export function getAgentDir(): string {
	const envDir = process.env[ENV_AGENT_DIR];
	if (envDir) {
		// Expand tilde to home directory
		if (envDir === "~") return homedir();
		if (envDir.startsWith("~/")) return homedir() + envDir.slice(1);
		return envDir;
	}
	return join(homedir(), CONFIG_DIR_NAME, "agent");
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

/** Get the root nanopencil config directory (e.g., ~/.nanopencil/) */
export function getConfigRoot(): string {
	const envDir = process.env[ENV_AGENT_DIR];
	if (envDir) {
		// ENV_AGENT_DIR points to the agent subdir (e.g., ~/.nanopencil/agent)
		// We need the parent for workspace dirs
		if (envDir === "~") return homedir();
		if (envDir.startsWith("~/")) return homedir() + envDir.slice(1);
		// Strip /agent suffix if present
		if (envDir.endsWith("/agent") || envDir.endsWith("\\agent")) {
			return dirname(envDir);
		}
		return dirname(envDir);
	}
	return join(homedir(), CONFIG_DIR_NAME);
}

/** Get path to global browser-workspace directory (e.g., ~/.nanopencil/browser-workspace) */
export function getBrowserWorkspaceDir(): string {
	return join(getConfigRoot(), "browser-workspace");
}

/** Get path to global link-world-workspace directory (e.g., ~/.nanopencil/link-world-workspace) */
export function getLinkWorldWorkspaceDir(): string {
	return join(getConfigRoot(), "link-world-workspace");
}
