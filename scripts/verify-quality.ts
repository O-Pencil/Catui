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
const IMPORT_RE = /\b(?:import|export)\s+(?:type\s+)?(?:[^'"`]*?\s+from\s+)?["']([^"']+)["']/g;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

interface ImportEdge {
  from: string;
  specifier: string;
  to?: string;
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
  const text = readFileSync(fileAbs, "utf8");
  const from = toRepoPath(fileAbs);
  const edges: ImportEdge[] = [];
  for (const re of [IMPORT_RE, DYNAMIC_IMPORT_RE]) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
      const specifier = match[1];
      edges.push({ from, specifier, to: resolveImport(fileAbs, specifier) });
    }
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
    !from.startsWith("packages/mem-core/") &&
    !isAllowedRuntimeVirtualModule
  ) {
    violations.push({
      file: from,
      message: `Internal modules must not import the root SDK barrel (${specifier}); use a local contract module instead.`,
    });
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

function main(): void {
  const files = SOURCE_ROOTS.flatMap((root) => {
    try {
      return walk(join(REPO, root));
    } catch {
      return [];
    }
  });
  const violations: Violation[] = [];
  for (const file of files) {
    for (const edge of readEdges(file)) {
      checkEdge(edge, violations);
    }
  }

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
