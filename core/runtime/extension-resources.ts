/**
 * [WHO]: discoverExtensionResources() and source metadata construction
 * [FROM]: ExtensionRunner discovery and ResourceExtensionPaths
 * [TO]: AgentSession and regression tests
 * [HERE]: core/runtime/extension-resources.ts - extension resource discovery
 */
import { basename, dirname } from "node:path";
import type { ExtensionRunner } from "../extensions-host/index.js";
import type { ResourceExtensionPaths } from "../platform/config/resource-loader.js";

export async function discoverExtensionResources(
  runner: ExtensionRunner | undefined, cwd: string, extend: (paths: ResourceExtensionPaths) => void,
  reason: "startup" | "reload",
): Promise<void> {
  if (!runner?.hasHandlers("resources_discover")) {
    return;
  }

  const { skillPaths, promptPaths, themePaths } =
    await runner.emitResourcesDiscover(cwd, reason);

  if (
    skillPaths.length === 0 &&
    promptPaths.length === 0 &&
    themePaths.length === 0
  ) {
    return;
  }

  const extensionPaths: ResourceExtensionPaths = {
    skillPaths: buildExtensionResourcePaths(skillPaths),
    promptPaths: buildExtensionResourcePaths(promptPaths),
    themePaths: buildExtensionResourcePaths(themePaths),
  };

  extend(extensionPaths);
}

function buildExtensionResourcePaths(
  entries: Array<{ path: string; extensionPath: string }>,
): Array<{
  path: string;
  metadata: {
    source: string;
    scope: "temporary";
    origin: "top-level";
    baseDir?: string;
  };
}> {
  return entries.map((entry) => {
    const source = getExtensionSourceLabel(entry.extensionPath);
    const baseDir = entry.extensionPath.startsWith("<")
      ? undefined
      : dirname(entry.extensionPath);
    return {
      path: entry.path,
      metadata: {
        source,
        scope: "temporary",
        origin: "top-level",
        baseDir,
      },
    };
  });
}

function getExtensionSourceLabel(extensionPath: string): string {
  if (extensionPath.startsWith("<")) {
    return `extension:${extensionPath.replace(/[<>]/g, "")}`;
  }
  const base = basename(extensionPath);
  const name = base.replace(/\.(ts|js)$/, "");
  return `extension:${name}`;
}
