/**
 * [WHO]: prepareCodexPlugin builds a local installation plan for the shipped MCP client
 * [FROM]: Node filesystem/crypto/process; private bridge registry permission helpers
 * [TO]: Onboarding command and isolated installer tests
 * [HERE]: extensions/optional/session-bridge/setup/installer.ts - no startup side effects
 */
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile, rm, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { ensurePrivateDirectory, registryDirectory } from "../registry.js";

const execute = promisify(execFile);
const marketplaceName = "catui-bridge-local";
type Run = (command: string, args: string[], cwd: string) => Promise<string>;
const run: Run = async (command, args, cwd) => {
  const result = await execute(command, args, { cwd, timeout: 20000, maxBuffer: 131072, windowsHide: true });
  return result.stdout;
};
export interface SetupOptions {
  root?: string;
  source?: string;
  node?: string;
  registry?: string;
  candidates?: string[];
  run?: Run;
}

export async function prepareCodexPlugin(options: SetupOptions = {}) {
  const root = options.root ?? join(homedir(), ".catui", "codex-bridge");
  const source = options.source ?? fileURLToPath(new URL("../plugin/", import.meta.url));
  const runtime = Object.fromEntries(await Promise.all(["client.js", "server.js", "package.json"].map(async name =>
    [name, await readFile(join(source, name), "utf8")] as const)));
  const mcp = JSON.stringify({ mcpServers: { "catui-bridge": {
    command: options.node ?? process.execPath, args: ["${CODEX_PLUGIN_ROOT}/server.js"],
    env: { CATUI_BRIDGE_DIR: options.registry ?? registryDirectory() },
  } } }, null, 2);
  const metadata = { name: "catui-bridge", author: { name: "Catui" }, description: "Read progress and send authorized feedback to your current Catui session.",
    mcpServers: "./.mcp.json", interface: { displayName: "Catui Bridge", shortDescription: "Connect Codex to your running Catui session.",
      longDescription: "Discover explicitly enabled local Catui sessions, inspect progress, submit feedback with receipts and request cancellation of an identified run.",
      developerName: "Catui", category: "Productivity", capabilities: [], defaultPrompt: "Find my enabled Catui session and inspect its progress." } };
  const hash = createHash("sha256").update(JSON.stringify([runtime, mcp, metadata])).digest("hex").slice(0, 24);
  const version = `0.1.0+codex.${hash}`;
  const directory = join(root, hash);
  const marker = join(root, "installed.json");
  let installed = false;
  try { installed = JSON.parse(await readFile(marker, "utf8"))?.hash === hash; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError)) throw error; }
  const invoke = options.run ?? run;
  return {
    installed, version,
    viewUrl: `codex://plugins/catui-bridge?marketplacePath=${encodeURIComponent(join(root, ".agents/plugins/marketplace.json"))}`,
    async install() {
      await ensurePrivateDirectory(root);
      const candidates = options.candidates ?? ["codex", ...(process.platform === "darwin" ? [
        "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
        "/Applications/Codex.app/Contents/Resources/codex",
      ] : [])];
      let cli: string | undefined;
      for (const candidate of candidates) {
        try {
          const help = await invoke(candidate, ["plugin", "--help"], root);
          if (help.includes("marketplace") && help.includes("add")) { cli = candidate; break; }
        } catch { /* Try the next installed CLI location. */ }
      }
      if (!cli) throw new Error("Codex was not found or needs an update. Install/update Codex, then run /bridge setup again.");
      const stage = join(root, `setup-${randomUUID()}`);
      try {
        const plugin = join(stage, "plugins", "catui-bridge");
        await mkdir(join(plugin, ".codex-plugin"), { recursive: true, mode: 0o700 });
        const files = { ...runtime, ".mcp.json": mcp,
          ".codex-plugin/plugin.json": JSON.stringify({ ...metadata, version }, null, 2) };
        for (const [name, contents] of Object.entries(files)) await writeFile(join(plugin, name), contents, { mode: 0o600 });
        try { await rename(stage, directory); }
        catch (error) {
          if (!["EEXIST", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
          await ensurePrivateDirectory(directory);
        }
        // Codex binds a marketplace name to its root. Keep that root stable across upgrades.
        const pluginsDirectory = join(root, "plugins");
        await ensurePrivateDirectory(pluginsDirectory);
        const temporaryLink = join(pluginsDirectory, `catui-bridge-${randomUUID()}`);
        try {
          await symlink(join("..", hash, "plugins", "catui-bridge"), temporaryLink);
          await rename(temporaryLink, join(pluginsDirectory, "catui-bridge"));
        } finally { await rm(temporaryLink, { force: true }); }
        const catalogDirectory = join(root, ".agents", "plugins");
        await ensurePrivateDirectory(catalogDirectory);
        const temporaryCatalog = join(catalogDirectory, `marketplace-${randomUUID()}.json`);
        try {
          await writeFile(temporaryCatalog, JSON.stringify({
            name: marketplaceName, interface: { displayName: "Catui" }, plugins: [{ name: "catui-bridge",
              source: { source: "local", path: "./plugins/catui-bridge" },
              policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" }, category: "Productivity" }],
          }, null, 2), { mode: 0o600 });
          await rename(temporaryCatalog, join(catalogDirectory, "marketplace.json"));
        } finally { await rm(temporaryCatalog, { force: true }); }
        try {
          await invoke(cli, ["plugin", "marketplace", "add", root], root);
          await invoke(cli, ["plugin", "add", `catui-bridge@${marketplaceName}`], root);
        } catch {
          throw new Error("Codex could not install Catui Bridge. Your Catui session is still available. Update Codex and retry /bridge setup.");
        }
        const temporaryMarker = join(root, `installed-${randomUUID()}.json`);
        try {
          await writeFile(temporaryMarker, JSON.stringify({ hash, version }), { mode: 0o600 });
          await rename(temporaryMarker, marker);
        } finally { await rm(temporaryMarker, { force: true }); }
      } finally { await rm(stage, { recursive: true, force: true }); }
    },
  };
}
