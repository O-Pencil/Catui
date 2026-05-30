/**
 * [WHO]: ensureTool(), ToolManager class
 * [FROM]: Depends on chalk, child_process, extract-zip, node:fs, node:os, node:path
 * [TO]: Consumed by core/tools/grep.ts, core/tools/find.ts, modes/interactive/interactive-mode.ts
 * [HERE]: core/platform/utils/tools-manager.ts - external tool installation and management
 */
import chalk from "chalk";
import { spawnSync } from "child_process";
import extractZip from "extract-zip";
import {
  chmodSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
} from "fs";
import { arch, platform } from "os";
import { join } from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { APP_NAME, getBinDir } from "../../../config.js";

const TOOLS_DIR = getBinDir();

// Cache for tool availability checks to avoid repeated filesystem checks
const toolCheckCache = new Map<string, string | null>();
const toolEnsureInFlight = new Map<string, Promise<string | undefined>>();

const DEFAULT_NETWORK_TIMEOUT_MS = 120000; /** Timeout for tools download (API + file). Default 120s (2 minutes). Override with NANOPENCIL_TOOLS_DOWNLOAD_TIMEOUT_MS (e.g. 300000 for very slow networks). */
/** Timeout for tools download (API + file). Override with NANOPENCIL_TOOLS_DOWNLOAD_TIMEOUT_MS (e.g. 120000 for very slow networks). */
function getNetworkTimeoutMs(): number {
  const env = process.env.NANOPENCIL_TOOLS_DOWNLOAD_TIMEOUT_MS;
  if (env === undefined || env === "") return DEFAULT_NETWORK_TIMEOUT_MS;
  const n = Number.parseInt(env, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_NETWORK_TIMEOUT_MS;
}

function isOfflineModeEnabled(): boolean {
  const value = process.env.NANOPENCIL_OFFLINE;
  if (!value) return false;
  return (
    value === "1" ||
    value.toLowerCase() === "true" ||
    value.toLowerCase() === "yes"
  );
}

interface ToolConfig {
  name: string;
  repo: string; // GitHub repo (e.g., "sharkdp/fd")
  binaryName: string; // Name of the binary inside the archive
  tagPrefix: string; // Prefix for tags (e.g., "v" for v1.0.0, "" for 1.0.0)
  getAssetName: (
    version: string,
    plat: string,
    architecture: string,
  ) => string | null;
}

const TOOLS: Record<string, ToolConfig> = {
  fd: {
    name: "fd",
    repo: "sharkdp/fd",
    binaryName: "fd",
    tagPrefix: "v",
    getAssetName: (version, plat, architecture) => {
      if (plat === "darwin") {
        const archStr = architecture === "arm64" ? "aarch64" : "x86_64";
        return `fd-v${version}-${archStr}-apple-darwin.tar.gz`;
      } else if (plat === "linux") {
        const archStr = architecture === "arm64" ? "aarch64" : "x86_64";
        return `fd-v${version}-${archStr}-unknown-linux-gnu.tar.gz`;
      } else if (plat === "win32") {
        const archStr = architecture === "arm64" ? "aarch64" : "x86_64";
        return `fd-v${version}-${archStr}-pc-windows-msvc.zip`;
      }
      return null;
    },
  },
  rg: {
    name: "ripgrep",
    repo: "BurntSushi/ripgrep",
    binaryName: "rg",
    tagPrefix: "",
    getAssetName: (version, plat, architecture) => {
      if (plat === "darwin") {
        const archStr = architecture === "arm64" ? "aarch64" : "x86_64";
        return `ripgrep-${version}-${archStr}-apple-darwin.tar.gz`;
      } else if (plat === "linux") {
        if (architecture === "arm64") {
          return `ripgrep-${version}-aarch64-unknown-linux-gnu.tar.gz`;
        }
        return `ripgrep-${version}-x86_64-unknown-linux-musl.tar.gz`;
      } else if (plat === "win32") {
        const archStr = architecture === "arm64" ? "aarch64" : "x86_64";
        return `ripgrep-${version}-${archStr}-pc-windows-msvc.zip`;
      }
      return null;
    },
  },
};

// Check if a command exists in PATH by trying to run it
function commandExists(cmd: string): boolean {
  try {
    const result = spawnSync(cmd, ["--version"], { stdio: "pipe" });
    // Check for ENOENT error (command not found)
    return result.error === undefined || result.error === null;
  } catch {
    return false;
  }
}

// Get the path to a tool (system-wide or in our tools dir)
export function getToolPath(tool: "fd" | "rg"): string | null {
  const config = TOOLS[tool];
  if (!config) return null;

  // Check cache first
  if (toolCheckCache.has(tool)) {
    return toolCheckCache.get(tool) ?? null;
  }

  // Check our tools directory first
  const localPath = join(
    TOOLS_DIR,
    config.binaryName + (platform() === "win32" ? ".exe" : ""),
  );
  if (existsSync(localPath)) {
    toolCheckCache.set(tool, localPath);
    return localPath;
  }

  // Check system PATH - if found, just return the command name (it's in PATH)
  if (commandExists(config.binaryName)) {
    toolCheckCache.set(tool, config.binaryName);
    return config.binaryName;
  }

  // Cache the negative result
  toolCheckCache.set(tool, null);
  return null;
}

export function hasTool(tool: "fd" | "rg"): boolean {
  return getToolPath(tool) !== null;
}

// Fetch latest release version from GitHub
async function getLatestVersion(repo: string): Promise<string> {
  const timeoutMs = getNetworkTimeoutMs();
  const response = await fetch(
    `https://api.github.com/repos/${repo}/releases/latest`,
    {
      headers: { "User-Agent": `${APP_NAME}-coding-agent` },
      signal: AbortSignal.timeout(timeoutMs),
    },
  );

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status}`);
  }

  const data = (await response.json()) as { tag_name: string };
  return data.tag_name.replace(/^v/, "");
}

// Download a file from URL
async function downloadFile(url: string, dest: string): Promise<void> {
  const timeoutMs = getNetworkTimeoutMs();
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`Failed to download: ${response.status}`);
  }

  if (!response.body) {
    throw new Error("No response body");
  }

  const fileStream = createWriteStream(dest);
  await pipeline(
    Readable.fromWeb(response.body as ReadableStream<Uint8Array>),
    fileStream,
  );
}

function findBinaryRecursively(
  rootDir: string,
  binaryFileName: string,
): string | null {
  const stack: string[] = [rootDir];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    if (!currentDir) continue;

    const entries = readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isFile() && entry.name === binaryFileName) {
        return fullPath;
      }
      if (entry.isDirectory()) {
        stack.push(fullPath);
      }
    }
  }

  return null;
}

// Download and install a tool
async function downloadTool(tool: "fd" | "rg"): Promise<string> {
  const config = TOOLS[tool];
  if (!config) throw new Error(`Unknown tool: ${tool}`);

  const plat = platform();
  const architecture = arch();

  // Get latest version
  const version = await getLatestVersion(config.repo);

  // Get asset name for this platform
  const assetName = config.getAssetName(version, plat, architecture);
  if (!assetName) {
    throw new Error(`Unsupported platform: ${plat}/${architecture}`);
  }

  // Create tools directory
  mkdirSync(TOOLS_DIR, { recursive: true });

  const downloadUrl = `https://github.com/${config.repo}/releases/download/${config.tagPrefix}${version}/${assetName}`;
  const archivePath = join(TOOLS_DIR, assetName);
  const binaryExt = plat === "win32" ? ".exe" : "";
  const binaryPath = join(TOOLS_DIR, config.binaryName + binaryExt);

  // Download
  await downloadFile(downloadUrl, archivePath);

  // Extract into a unique temp directory. fd and rg downloads can run concurrently
  // during startup, so sharing a fixed directory causes races.
  const extractDir = join(
    TOOLS_DIR,
    `extract_tmp_${config.binaryName}_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
  );
  mkdirSync(extractDir, { recursive: true });

  try {
    if (assetName.endsWith(".tar.gz")) {
      const extractResult = spawnSync(
        "tar",
        ["xzf", archivePath, "-C", extractDir],
        { stdio: "pipe" },
      );
      if (extractResult.error || extractResult.status !== 0) {
        const errMsg =
          extractResult.error?.message ??
          extractResult.stderr?.toString().trim() ??
          "unknown error";
        throw new Error(`Failed to extract ${assetName}: ${errMsg}`);
      }
    } else if (assetName.endsWith(".zip")) {
      await extractZip(archivePath, { dir: extractDir });
    } else {
      throw new Error(`Unsupported archive format: ${assetName}`);
    }

    // Find the binary in extracted files. Some archives contain files directly
    // at root, others nest under a versioned subdirectory.
    const binaryFileName = config.binaryName + binaryExt;
    const extractedDir = join(
      extractDir,
      assetName.replace(/\.(tar\.gz|zip)$/, ""),
    );
    const extractedBinaryCandidates = [
      join(extractedDir, binaryFileName),
      join(extractDir, binaryFileName),
    ];
    let extractedBinary = extractedBinaryCandidates.find((candidate) =>
      existsSync(candidate),
    );

    if (!extractedBinary) {
      extractedBinary =
        findBinaryRecursively(extractDir, binaryFileName) ?? undefined;
    }

    if (extractedBinary) {
      renameSync(extractedBinary, binaryPath);
    } else {
      throw new Error(
        `Binary not found in archive: expected ${binaryFileName} under ${extractDir}`,
      );
    }

    // Make executable (Unix only)
    if (plat !== "win32") {
      chmodSync(binaryPath, 0o755);
    }
  } finally {
    // Cleanup
    rmSync(archivePath, { force: true });
    rmSync(extractDir, { recursive: true, force: true });
  }

  return binaryPath;
}

// Termux package names for tools
const TERMUX_PACKAGES: Record<string, string> = {
  fd: "fd",
  rg: "ripgrep",
};

// Ensure a tool is available, downloading if necessary
// Returns the path to the tool, or null if unavailable
export async function ensureTool(
  tool: "fd" | "rg",
  silent: boolean = false,
): Promise<string | undefined> {
  const existingPath = getToolPath(tool);
  if (existingPath) {
    return existingPath;
  }

  const inFlight = toolEnsureInFlight.get(tool);
  if (inFlight) {
    return inFlight;
  }

  const config = TOOLS[tool];
  if (!config) return undefined;

  if (isOfflineModeEnabled()) {
    if (!silent) {
      console.log(
        chalk.yellow(
          `${config.name} not found. Offline mode enabled, skipping download.`,
        ),
      );
    }
    return undefined;
  }

  // On Android/Termux, Linux binaries don't work due to Bionic libc incompatibility.
  // Users must install via pkg.
  if (platform() === "android") {
    const pkgName = TERMUX_PACKAGES[tool] ?? tool;
    if (!silent) {
      console.log(
        chalk.yellow(
          `${config.name} not found. Install with: pkg install ${pkgName}`,
        ),
      );
    }
    return undefined;
  }

  // Tool not found - download it
  if (!silent) {
    console.log(chalk.dim(`${config.name} not found. Downloading...`));
  }

  const ensurePromise = (async () => {
    try {
      const path = await downloadTool(tool);
      // Update cache after successful download
      toolCheckCache.set(tool, path);
      if (!silent) {
        console.log(chalk.dim(`${config.name} installed to ${path}`));
      }
      return path;
    } catch (e) {
      if (!silent) {
        console.log(
          chalk.yellow(
            `Failed to download ${config.name}: ${e instanceof Error ? e.message : e}`,
          ),
        );
      }
      return undefined;
    } finally {
      toolEnsureInFlight.delete(tool);
    }
  })();

  toolEnsureInFlight.set(tool, ensurePromise);
  return ensurePromise;
}

export function prewarmTool(tool: "fd" | "rg"): void {
  void ensureTool(tool, true);
}

/**
 * Clear the tool check cache. Useful for forcing a re-check of tool availability.
 */
export function clearToolCheckCache(): void {
  toolCheckCache.clear();
  toolEnsureInFlight.clear();
}

/**
 * Get tool check cache stats (for debugging)
 */
export function getToolCheckCacheStats(): {
  size: number;
  inFlight: string[];
  entries: Array<{ tool: string; path: string | null }>;
} {
  return {
    size: toolCheckCache.size,
    inFlight: Array.from(toolEnsureInFlight.keys()),
    entries: Array.from(toolCheckCache.entries()).map(([tool, path]) => ({
      tool,
      path,
    })),
  };
}
