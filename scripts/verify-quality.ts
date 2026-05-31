/**
 * [WHO]: Provides verify-quality CLI for architecture boundary checks
 * [FROM]: Depends on node:fs/path/url only; no project runtime imports
 * [TO]: Consumed by CI and P2 local validation
 * [HERE]: scripts/verify-quality.ts - executable guard for refactor boundary invariants
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_ROOTS = ["cli", "core", "extensions", "modes", "packages", "scripts"];
const IMPORT_RE = /\b(?:import|export)\s+(type\s+)?(?:[^'"`]*?\s+from\s+)?["']([^"']+)["']/g;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
const BLOCK_COMMENT_RE = /\/\*[\s\S]*?\*\//g;

interface ImportEdge {
  from: string;
  specifier: string;
  to?: string;
  /** Statement-level `import type` / `export type` — erased at runtime, excluded from cycle detection. */
  typeOnly: boolean;
}

interface Violation {
  file: string;
  message: string;
}

const TEMPORARY_BOUNDARY_EXCEPTIONS = new Map<string, string>([
  [
    "core/platform/config/resource-loader.ts -> modes/interactive/theme/theme.ts",
    "Q8: existing P1 move residue; split theme resource metadata out of interactive mode before sign-off.",
  ],
  [
    "core/platform/config/resource-loader.ts -> core/runtime/event-bus.ts",
    "Q8: existing P1 move residue; extract an event-bus contract before sign-off.",
  ],
  [
    "core/platform/exec/bash-executor.ts -> core/tools/bash.ts",
    "Q8: existing P1 move residue; move shared bash execution types below tools before sign-off.",
  ],
  [
    "core/platform/exec/bash-executor.ts -> core/tools/truncate.ts",
    "Q8: existing P1 move residue; move truncation primitive below tools before sign-off.",
  ],
]);

// Published packages must not depend on the host. Tracked until the S3 dependency
// inversion lands in P3 (mem/soul depend on @pencil-agent/extension-sdk instead).
const HOST_PACKAGE = "@pencil-agent/nano-pencil";
const PUBLISHED_PACKAGE_PREFIXES = ["packages/mem-core/", "packages/soul-core/"];
const HOST_REVERSE_DEP_EXCEPTIONS = new Map<string, string>([
  // P3.2b inverted src/extension.ts onto @pencil-agent/extension-sdk — its exception is removed.
  [
    "packages/mem-core/test/extension-commands.test.ts",
    "S3: mem-core integration test creates a host AgentSession; relocate to host-side extension tests or extension-sdk fixtures. Remove after test relocation.",
  ],
]);

function toRepoPath(abs: string): string {
  return normalize(relative(REPO, abs)).replaceAll("\\", "/");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === ".git" || entry === ".baseline-out") continue;
    const abs = join(dir, entry);
    const st = statSync(abs);
    if (st.isDirectory()) {
      walk(abs, out);
    } else if (st.isFile() && extname(entry) === ".ts") {
      out.push(abs);
    }
  }
  return out;
}

function candidateTsPath(base: string): string | undefined {
  const stripped = base.replace(/\.(js|mjs|cjs)$/, ".ts");
  for (const candidate of [stripped, join(stripped, "index.ts")]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // continue
    }
  }
  return undefined;
}

function resolveImport(fromAbs: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const resolved = resolve(dirname(fromAbs), specifier);
  const ts = candidateTsPath(resolved);
  return ts ? toRepoPath(ts) : undefined;
}

function readEdges(fileAbs: string): ImportEdge[] {
  // Strip block comments first: P3 headers embed example import paths (e.g. the [TO] field)
  // that the regex would otherwise pick up as real edges (and even resolve to the file itself).
  const text = readFileSync(fileAbs, "utf8").replace(BLOCK_COMMENT_RE, "");
  const from = toRepoPath(fileAbs);
  const edges: ImportEdge[] = [];
  IMPORT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = IMPORT_RE.exec(text))) {
    const specifier = match[2];
    edges.push({ from, specifier, to: resolveImport(fileAbs, specifier), typeOnly: Boolean(match[1]) });
  }
  DYNAMIC_IMPORT_RE.lastIndex = 0;
  while ((match = DYNAMIC_IMPORT_RE.exec(text))) {
    const specifier = match[1];
    edges.push({ from, specifier, to: resolveImport(fileAbs, specifier), typeOnly: false });
  }
  return edges;
}

function startsWithAny(value: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => value.startsWith(prefix));
}

function checkEdge(edge: ImportEdge, violations: Violation[]): void {
  const { from, specifier, to } = edge;

  const isAllowedRuntimeVirtualModule =
    from === "core/extensions-host/loader.ts" && specifier === "../../index.js" && to === "index.ts";
  const exceptionKey = to ? `${from} -> ${to}` : undefined;
  const temporaryException = exceptionKey ? TEMPORARY_BOUNDARY_EXCEPTIONS.get(exceptionKey) : undefined;

  if (
    to === "index.ts" &&
    startsWithAny(from, ["core/", "modes/", "extensions/", "packages/"]) &&
    !isAllowedRuntimeVirtualModule
  ) {
    violations.push({
      file: from,
      message: `Internal modules must not import the root SDK barrel (${specifier}); use a local contract module instead.`,
    });
  }

  // Reverse-dependency guard (package-name import, so `to` is undefined): published
  // packages must not reach back into the host. Tracked exceptions carry a P3/S3 deadline.
  if (PUBLISHED_PACKAGE_PREFIXES.some((prefix) => from.startsWith(prefix)) && specifier === HOST_PACKAGE) {
    if (!HOST_REVERSE_DEP_EXCEPTIONS.has(from)) {
      violations.push({
        file: from,
        message: `Published package must not depend on the host (${specifier}); invert via @pencil-agent/extension-sdk (S3).`,
      });
    }
  }

  if (from.startsWith("core/platform/") && to) {
    const forbidden = ["core/runtime/", "core/tools/", "core/session/", "core/mcp/", "core/model/", "modes/", "extensions/"];
    if (startsWithAny(to, forbidden) && !temporaryException) {
      violations.push({
        file: from,
        message: `Platform primitives must not depend on business/UI modules (${specifier} -> ${to}).`,
      });
    }
  }

  if (from.startsWith("core/lib/") && to) {
    const forbidden = ["core/runtime/", "core/platform/", "core/tools/", "core/session/", "core/mcp/", "modes/", "extensions/"];
    if (startsWithAny(to, forbidden)) {
      violations.push({
        file: from,
        message: `core/lib packages must not import host implementation modules (${specifier} -> ${to}).`,
      });
    }
  }

  const forbiddenCycleEdges = new Map<string, string[]>([
    ["core/mcp/mcp-config.ts", ["core/mcp/mcp-client.ts"]],
    ["core/soul-integration.ts", ["core/runtime/sdk.ts"]],
    ["core/lib/ai/src/types.ts", ["core/lib/ai/src/utils/event-stream.ts"]],
  ]);
  const forbiddenTargets = forbiddenCycleEdges.get(from);
  if (to && forbiddenTargets?.includes(to)) {
    violations.push({
      file: from,
      message: `P2 cycle edge is forbidden (${specifier} -> ${to}).`,
    });
  }
}

/**
 * Generic import-cycle detection over resolved internal (.ts) edges. Replaces the
 * hardcoded forbidden-edge list as the real V2-1 "zero cycles" guard: any cycle,
 * not just the three known F04 ones, is reported. Distinct node-sets are reported once.
 */
function findCycles(edges: ImportEdge[]): Violation[] {
  const adjacency = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!edge.to || edge.typeOnly) continue; // runtime cycles only; type-only edges are erased by tsc
    let targets = adjacency.get(edge.from);
    if (!targets) {
      targets = new Set<string>();
      adjacency.set(edge.from, targets);
    }
    targets.add(edge.to);
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const stack: string[] = [];
  const seen = new Set<string>();
  const cycles: Violation[] = [];
  const MAX_REPORTED = 50;

  const dfs = (node: string): void => {
    if (cycles.length >= MAX_REPORTED) return;
    color.set(node, GRAY);
    stack.push(node);
    for (const next of adjacency.get(node) ?? []) {
      const state = color.get(next) ?? WHITE;
      if (state === GRAY) {
        const loop = stack.slice(stack.indexOf(next)).concat(next);
        const key = [...loop].sort().join("|");
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push({ file: next, message: `Import cycle: ${loop.join(" -> ")}` });
        }
      } else if (state === WHITE) {
        dfs(next);
      }
    }
    stack.pop();
    color.set(node, BLACK);
  };

  for (const node of adjacency.keys()) {
    if ((color.get(node) ?? WHITE) === WHITE) dfs(node);
  }
  return cycles;
}

function main(): void {
  const files = SOURCE_ROOTS.flatMap((root) => {
    try {
      return walk(join(REPO, root));
    } catch {
      return [];
    }
  });
  const violations: Violation[] = [];
  const allEdges: ImportEdge[] = [];
  for (const file of files) {
    const edges = readEdges(file);
    allEdges.push(...edges);
    for (const edge of edges) {
      checkEdge(edge, violations);
    }
  }
  violations.push(...findCycles(allEdges));

  if (violations.length > 0) {
    console.error(`verify-quality failed: ${violations.length} boundary violation(s)`);
    for (const violation of violations) {
      console.error(`- ${violation.file}: ${violation.message}`);
    }
    process.exit(1);
  }
  console.log(`verify-quality passed (${files.length} TypeScript files scanned)`);
}

main();
