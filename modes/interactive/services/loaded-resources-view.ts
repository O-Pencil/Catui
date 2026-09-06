/**
 * [WHO]: Pure loaded-resource listing formatters — formatDisplayPath, getShortPath, getDisplaySourceInfo,
 *        getScopeGroup, isPackageSource, buildScopeGroups, formatScopeGroups, findMetadata,
 *        formatPathWithSource, formatDiagnostics
 * [FROM]: Depends on node:os (homedir), ../theme/theme.js (theme),
 *         ../../../core/platform/config/resource-loader.js (ResourceDiagnostic type)
 * [TO]: Consumed by modes/interactive/interactive-mode.ts (showLoadedResources view assembly)
 * [HERE]: modes/interactive/services/loaded-resources-view.ts - zero-state resource listing formatting
 *         (P7 C-3b, extracted from InteractiveMode; no InteractiveMode/session/TUI dependency)
 */
import * as os from "node:os";
import { theme } from "../theme/theme.js";
import type { ResourceDiagnostic } from "../../../core/platform/config/resource-loader.js";

export function formatDisplayPath(p: string): string {
  const home = os.homedir();
  let result = p;

  // Replace home directory with ~
  if (result.startsWith(home)) {
    result = `~${result.slice(home.length)}`;
  }

  return result;
}

/**
 * Get a short path relative to the package root for display.
 */
export function getShortPath(fullPath: string, source: string): string {
  // For npm packages, show path relative to node_modules/pkg/
  const npmMatch = fullPath.match(
    /node_modules\/(@?[^/]+(?:\/[^/]+)?)\/(.*)/,
  );
  if (npmMatch && source.startsWith("npm:")) {
    return npmMatch[2];
  }

  // For git packages, show path relative to repo root
  const gitMatch = fullPath.match(/git\/[^/]+\/[^/]+\/(.*)/);
  if (gitMatch && source.startsWith("git:")) {
    return gitMatch[1];
  }

  // For local/auto, just use formatDisplayPath
  return formatDisplayPath(fullPath);
}

export function getDisplaySourceInfo(
  source: string,
  scope: string,
): { label: string; scopeLabel?: string; color: "accent" | "muted" } {
  if (source === "local") {
    if (scope === "user") {
      return { label: "user", color: "muted" };
    }
    if (scope === "project") {
      return { label: "project", color: "muted" };
    }
    if (scope === "temporary") {
      return { label: "path", scopeLabel: "temp", color: "muted" };
    }
    return { label: "path", color: "muted" };
  }

  if (source === "cli") {
    return {
      label: "path",
      scopeLabel: scope === "temporary" ? "temp" : undefined,
      color: "muted",
    };
  }

  const scopeLabel =
    scope === "user"
      ? "user"
      : scope === "project"
        ? "project"
        : scope === "temporary"
          ? "temp"
          : undefined;
  return { label: source, scopeLabel, color: "accent" };
}

export function getScopeGroup(
  source: string,
  scope: string,
): "user" | "project" | "path" {
  if (source === "cli" || scope === "temporary") return "path";
  if (scope === "user") return "user";
  if (scope === "project") return "project";
  return "path";
}

export function isPackageSource(source: string): boolean {
  return source.startsWith("npm:") || source.startsWith("git:");
}

export function buildScopeGroups(
  paths: string[],
  metadata: Map<string, { source: string; scope: string; origin: string }>,
): Array<{
  scope: "user" | "project" | "path";
  paths: string[];
  packages: Map<string, string[]>;
}> {
  const groups: Record<
    "user" | "project" | "path",
    {
      scope: "user" | "project" | "path";
      paths: string[];
      packages: Map<string, string[]>;
    }
  > = {
    user: { scope: "user", paths: [], packages: new Map() },
    project: { scope: "project", paths: [], packages: new Map() },
    path: { scope: "path", paths: [], packages: new Map() },
  };

  for (const p of paths) {
    const meta = findMetadata(p, metadata);
    const source = meta?.source ?? "local";
    const scope = meta?.scope ?? "project";
    const groupKey = getScopeGroup(source, scope);
    const group = groups[groupKey];

    if (isPackageSource(source)) {
      const list = group.packages.get(source) ?? [];
      list.push(p);
      group.packages.set(source, list);
    } else {
      group.paths.push(p);
    }
  }

  return [groups.project, groups.user, groups.path].filter(
    (group) => group.paths.length > 0 || group.packages.size > 0,
  );
}

export function formatScopeGroups(
  groups: Array<{
    scope: "user" | "project" | "path";
    paths: string[];
    packages: Map<string, string[]>;
  }>,
  options: {
    formatPath: (p: string) => string;
    formatPackagePath: (p: string, source: string) => string;
  },
): string {
  const lines: string[] = [];

  for (const group of groups) {
    lines.push(`  ${theme.fg("accent", group.scope)}`);

    const sortedPaths = [...group.paths].sort((a, b) => a.localeCompare(b));
    for (const p of sortedPaths) {
      lines.push(theme.fg("dim", `    ${options.formatPath(p)}`));
    }

    const sortedPackages = Array.from(group.packages.entries()).sort(
      ([a], [b]) => a.localeCompare(b),
    );
    for (const [source, paths] of sortedPackages) {
      lines.push(`    ${theme.fg("mdLink", source)}`);
      const sortedPackagePaths = [...paths].sort((a, b) =>
        a.localeCompare(b),
      );
      for (const p of sortedPackagePaths) {
        lines.push(
          theme.fg("dim", `      ${options.formatPackagePath(p, source)}`),
        );
      }
    }
  }

  return lines.join("\n");
}

/**
 * Find metadata for a path, checking parent directories if exact match fails.
 * Package manager stores metadata for directories, but we display file paths.
 */
export function findMetadata(
  p: string,
  metadata: Map<string, { source: string; scope: string; origin: string }>,
): { source: string; scope: string; origin: string } | undefined {
  // Try exact match first
  const exact = metadata.get(p);
  if (exact) return exact;

  // Try parent directories (package manager stores directory paths)
  let current = p;
  while (current.includes("/")) {
    current = current.substring(0, current.lastIndexOf("/"));
    const parent = metadata.get(current);
    if (parent) return parent;
  }

  return undefined;
}

/**
 * Format a path with its source/scope info from metadata.
 */
export function formatPathWithSource(
  p: string,
  metadata: Map<string, { source: string; scope: string; origin: string }>,
): string {
  const meta = findMetadata(p, metadata);
  if (meta) {
    const shortPath = getShortPath(p, meta.source);
    const { label, scopeLabel } = getDisplaySourceInfo(
      meta.source,
      meta.scope,
    );
    const labelText = scopeLabel ? `${label} (${scopeLabel})` : label;
    return `${labelText} ${shortPath}`;
  }
  return formatDisplayPath(p);
}

/**
 * Format resource diagnostics with nice collision display using metadata.
 */
export function formatDiagnostics(
  diagnostics: readonly ResourceDiagnostic[],
  metadata: Map<string, { source: string; scope: string; origin: string }>,
): string {
  const lines: string[] = [];

  // Group collision diagnostics by name
  const collisions = new Map<string, ResourceDiagnostic[]>();
  const otherDiagnostics: ResourceDiagnostic[] = [];

  for (const d of diagnostics) {
    if (d.type === "collision" && d.collision) {
      const list = collisions.get(d.collision.name) ?? [];
      list.push(d);
      collisions.set(d.collision.name, list);
    } else {
      otherDiagnostics.push(d);
    }
  }

  // Format collision diagnostics grouped by name
  for (const [name, collisionList] of collisions) {
    const first = collisionList[0]?.collision;
    if (!first) continue;
    lines.push(theme.fg("warning", `  "${name}" collision:`));
    // Show winner
    lines.push(
      theme.fg(
        "dim",
        `    ${theme.fg("success", "✓")} ${formatPathWithSource(first.winnerPath, metadata)}`,
      ),
    );
    // Show all losers
    for (const d of collisionList) {
      if (d.collision) {
        lines.push(
          theme.fg(
            "dim",
            `    ${theme.fg("warning", "✗")} ${formatPathWithSource(d.collision.loserPath, metadata)} (skipped)`,
          ),
        );
      }
    }
  }

  // Format other diagnostics (skill name collisions, parse errors, etc.)
  for (const d of otherDiagnostics) {
    if (d.path) {
      // Use metadata-aware formatting for paths
      const sourceInfo = formatPathWithSource(d.path, metadata);
      lines.push(
        theme.fg(d.type === "error" ? "error" : "warning", `  ${sourceInfo}`),
      );
      lines.push(
        theme.fg(
          d.type === "error" ? "error" : "warning",
          `    ${d.message}`,
        ),
      );
    } else {
      lines.push(
        theme.fg(d.type === "error" ? "error" : "warning", `  ${d.message}`),
      );
    }
  }

  return lines.join("\n");
}
