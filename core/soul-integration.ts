/**
 * [WHO]: isSoulEnabled(), toSoulContext(), createSoulManager()
 * [FROM]: Depends on runtime/sdk, node:path, node:fs, node:url, node:os, node:module
 * [TO]: Consumed by core/runtime/agent-session.ts
 * [HERE]: core/soul-integration.ts - bridges Soul and NanoPencil
 */
import type { CreateAgentSessionOptions } from "./runtime/sdk.js";
import { join, resolve } from "node:path";
import { getAgentDir } from "../config.js";
import { defaultAgentDirContext, type AgentDirContext } from "./agent-dir/agent-dir-context.js";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname } from "node:path";
import { createRequire } from "node:module";
import { homedir } from "node:os";

// Use any for runtime-loaded SoulManager to avoid type resolution issues
type SoulManagerType = any;

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function getBundledSoulCandidates(): string[] {
  return [
    // Published package runtime: dist/core -> dist/packages/soul-core
    join(__dirname, "..", "packages", "soul-core"),
    // Legacy/runtime fallback
    join(__dirname, "packages", "soul-core"),
    // Dev workspace runtime
    join(process.cwd(), "packages", "soul-core", "dist"),
  ];
}

function resolveBundledSoulEntry(): string | undefined {
  for (const dir of getBundledSoulCandidates()) {
    const entry = join(dir, "index.js");
    if (existsSync(entry)) return entry;
  }
  return undefined;
}

/**
 * Default Soul configuration for NanoPencil
 * @param agentDir Optional agent directory. If omitted, uses getAgentDir().
 */
export function getSoulConfig(agentDir?: string) {
  const envSoulDir = process.env.SOUL_DIR;
  const baseAgentDir = agentDir ?? getAgentDir();
  let soulDir = join(baseAgentDir, "soul");

  if (envSoulDir && envSoulDir.trim()) {
    const trimmed = envSoulDir.trim();
    // Support common tilde forms for macOS/Linux.
    if (trimmed === "~") soulDir = homedir();
    else if (trimmed.startsWith("~/")) soulDir = join(homedir(), trimmed.slice(2));
    else if (trimmed.startsWith("~")) soulDir = join(homedir(), trimmed.slice(1));
    else soulDir = resolve(trimmed);
  }

  return {
    soulDir,
    evolution: {
      natural: 10,
      reflection: 100,
      feedback: 1,
      crisis: 5,
    },
    personalityLimits: {
      maxDelta: 0.05,
      min: 0.1,
      max: 0.9,
    },
    valueLimits: {
      maxDelta: 0.1,
      min: 0.05,
      max: 0.5,
    },
    speakingStyleLimits: {
      maxDelta: 0.05,
      min: 0.1,
      max: 0.9,
    },
    memoryRetention: {
      successes: 500,
      failures: 500,
      patterns: 200,
      decisions: 1000,
    },
  };
}

/**
 * Create a SoulManager instance for NanoPencil
 * Returns null if nanosoul is not installed
 * @param agentDir Optional agent directory. If omitted, uses getAgentDir().
 */
export async function createSoulManager(agentDir?: string): Promise<SoulManagerType | null> {
  // Try bundled package first
  const bundledEntry = resolveBundledSoulEntry();
  if (bundledEntry) {
    try {
      // Windows ESM requires file:// URL for absolute paths
      const bundledUrl = pathToFileURL(bundledEntry).href;
      const { SoulManager: SM } = await import(bundledUrl);
      return new SM({
        config: getSoulConfig(agentDir),
      });
    } catch {
      // Continue to node_modules fallback
    }
  }

  // Fall back to node_modules - try @pencil-agent/soul-core first, then @pencil-agent/soul (legacy), then nanosoul
  try {
    // @ts-ignore - runtime dynamic import
    const { SoulManager: SM } = await import("@pencil-agent/soul-core");
    return new SM({
      config: getSoulConfig(agentDir),
    });
  } catch {
    try {
      // @ts-ignore - runtime dynamic import for backwards compatibility
      const { SoulManager: SM } = await import("@pencil-agent/soul");
      return new SM({
        config: getSoulConfig(agentDir),
      });
    } catch {
      try {
        // @ts-ignore - runtime dynamic import for backwards compatibility
        const { SoulManager: SM } = await import("nanosoul");
        return new SM({
          config: getSoulConfig(agentDir),
        });
      } catch {
        // Neither package available
        return null;
      }
    }
  }
}

/**
 * Check if Soul is available
 */
export function isSoulAvailable(): boolean {
  // Check bundled version first
  if (resolveBundledSoulEntry()) return true;

  // Fall back to checking node_modules - try soul-core first, then soul (legacy), then nanosoul
  try {
    require.resolve("@pencil-agent/soul-core");
    return true;
  } catch {
    try {
      require.resolve("@pencil-agent/soul");
      return true;
    } catch {
      try {
        require.resolve("nanosoul");
        return true;
      } catch {
        return false;
      }
    }
  }
}

/**
 * Convert NanoPencil context to Soul InteractionContext
 */
export function toSoulContext(
  project: string,
  tags: string[],
  complexity: number,
  toolUsage: Record<string, number>,
  userFeedback?: { rating?: number; comment?: string },
): any {
  return {
    project,
    tags,
    complexity,
    toolUsage,
    userFeedback: userFeedback
      ? {
          rating: userFeedback.rating || 5,
          comment: userFeedback.comment,
        }
      : undefined,
    timestamp: new Date(),
  };
}

/**
 * Check if Soul should be enabled based on options
 */
export function isSoulEnabled(options: CreateAgentSessionOptions): boolean {
  // Soul is enabled by default in NanoPencil 1.3+
  // Can be disabled with --disable-soul flag
  return options.enableSoul !== false;
}

/**
 * Extract rich context from recent session messages for Soul injection.
 * Scans tool calls for tool usage counts and infers tags from file extensions and tool names.
 */
export function extractSessionContext(
  messages: Array<{ role: string; content: any }>,
  cwd: string,
): { tags: string[]; complexity: number; toolUsage: Record<string, number> } {
  const toolUsage: Record<string, number> = {};
  const fileExtensions = new Set<string>();
  let totalToolCalls = 0;
  let userMessageCount = 0;

  // Scan recent messages (last 30 to keep it fast)
  const recent = messages.slice(-30);

  for (const msg of recent) {
    if (msg.role === "user") {
      userMessageCount++;
    }
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === "toolCall") {
          const name: string = block.toolName || block.name || "unknown";
          toolUsage[name] = (toolUsage[name] || 0) + 1;
          totalToolCalls++;

          // Extract file extensions from tool arguments
          const args = block.args || block.input;
          if (args) {
            const filePath: string | undefined =
              args.file_path || args.filePath || args.path || args.pattern;
            if (typeof filePath === "string") {
              const extMatch = filePath.match(/\.([a-zA-Z0-9]+)$/);
              if (extMatch) fileExtensions.add(extMatch[1].toLowerCase());
            }
          }
        }
      }
    }
  }

  // Derive tags from file extensions
  const extTagMap: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    py: "python", rs: "rust", go: "golang", java: "java",
    css: "styling", scss: "styling", html: "web",
    json: "config", yaml: "config", yml: "config", toml: "config",
    md: "documentation", sql: "database", prisma: "database",
    test: "testing", spec: "testing",
    sh: "scripting", bash: "scripting",
  };
  const tags = new Set<string>();
  for (const ext of fileExtensions) {
    if (extTagMap[ext]) tags.add(extTagMap[ext]);
  }

  // Infer tags from tool usage patterns
  if (toolUsage["bash"] && toolUsage["bash"] > 2) tags.add("shell-heavy");
  if (toolUsage["edit"] && toolUsage["edit"] > 3) tags.add("refactor");
  if (toolUsage["write"]) tags.add("feature");
  if (toolUsage["grep"] || toolUsage["find"]) tags.add("exploration");

  // Estimate complexity: 0-1 based on message count + tool calls + file diversity
  const complexity = Math.min(
    1,
    (userMessageCount * 0.1 + totalToolCalls * 0.03 + fileExtensions.size * 0.08),
  );

  return {
    tags: Array.from(tags),
    complexity: Math.round(complexity * 100) / 100,
    toolUsage,
  };
}
