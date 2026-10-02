/**
 * [WHO]: Private bridge discovery directory and descriptor lifecycle
 * [FROM]: Node filesystem, OS and path primitives
 * [TO]: Bridge HTTP server; companion MCP client reads the same private descriptors
 * [HERE]: extensions/optional/session-bridge/registry.ts - owner-only discovery
 */
import { lstat, mkdir, open, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BridgeDescriptor } from "./contracts.js";

export function registryDirectory(): string {
  return process.env.CATUI_BRIDGE_DIR || join(homedir(), ".catui", "bridges");
}
export async function ensurePrivateDirectory(directory: string): Promise<void> {
  if (process.platform === "win32") throw new Error("Session bridge requires POSIX file permissions");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o077)) {
    throw new Error("Bridge registry must be an owner-only directory (0700)");
  }
}
export async function publishDescriptor(directory: string, descriptor: BridgeDescriptor): Promise<() => Promise<void>> {
  await ensurePrivateDirectory(directory);
  const file = join(directory, `${descriptor.bridgeId}.json`);
  const handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(JSON.stringify(descriptor)); }
  catch (error) { await unlink(file).catch(() => {}); throw error; }
  finally { await handle.close(); }
  return async () => { await unlink(file).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; }); };
}
