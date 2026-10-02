/**
 * [WHO]: Published bridge onboarding, installer and default command acceptance tests
 * [FROM]: Production installer/onboarding, registry and temporary filesystem fixtures
 * [TO]: test:tools and bridge release acceptance
 * [HERE]: test/session-bridge-setup.test.ts - never changes real Codex configuration
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { prepareCodexPlugin } from "../extensions/optional/session-bridge/setup/installer.ts";
import { offerCodexSetup } from "../extensions/optional/session-bridge/setup/onboarding.ts";
import { builtInExtensions, getBuiltinExtensionPaths } from "../builtin-extensions.ts";

test("ordinary startup includes a command-only bridge with lifecycle and installer contracts", () => {
  const metadata = builtInExtensions.find(x => x.id === "session-bridge")!;
  assert.equal(metadata.defaultEnabled, true);
  assert.equal(metadata.startsTimers, false);
  assert.equal(metadata.writesWorkspace, false);
  assert.ok(metadata.testContracts?.includes("external-process"));
  assert.equal(getBuiltinExtensionPaths().filter(p => p.includes(`${sep}session-bridge${sep}`)).length, 1);
});

test("bundled client installs with argument arrays, absolute Node and a private marketplace", async t => {
  const root = await mkdtemp(join(tmpdir(), "catui setup space-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const commands: string[][] = [];
  const options = { root, node: "/Node With Spaces/node", registry: "/private/bridge path", candidates: ["/Codex App/codex"],
    run: async (command: string, args: string[]) => { commands.push([command, ...args]); return "plugin add marketplace"; } };
  const plan = await prepareCodexPlugin(options);
  assert.equal(plan.installed, false);
  assert.deepEqual(await readdir(root), [], "preparation must not create installation files");
  await plan.install();
  const catalogRoot = commands[1].at(-1)!;
  assert.deepEqual(commands[2], ["/Codex App/codex", "plugin", "add", "catui-bridge@catui-bridge-local"]);
  const catalog = JSON.parse(await readFile(join(catalogRoot, ".agents/plugins/marketplace.json"), "utf8"));
  assert.equal(catalog.plugins[0].source.path, "./plugins/catui-bridge");
  const plugin = join(catalogRoot, catalog.plugins[0].source.path);
  const manifest = JSON.parse(await readFile(join(plugin, ".codex-plugin/plugin.json"), "utf8"));
  const mcp = JSON.parse(await readFile(join(plugin, ".mcp.json"), "utf8"));
  assert.equal(manifest.version, plan.version);
  assert.equal(manifest.author.name, "Catui");
  assert.equal(mcp.mcpServers["catui-bridge"].command, "/Node With Spaces/node");
  assert.deepEqual(mcp.mcpServers["catui-bridge"].args, ["${CODEX_PLUGIN_ROOT}/server.js"]);
  assert.equal(mcp.mcpServers["catui-bridge"].env.CATUI_BRIDGE_DIR, "/private/bridge path");
  assert.equal((await prepareCodexPlugin(options)).installed, true);
  assert.equal(commands.length, 3, "preparing an existing install must not run commands");
  await plan.install(); // explicit repair remains available without deleting previous state
  const changed = await prepareCodexPlugin({ ...options, node: "/different/node" });
  assert.notEqual(changed.version, plan.version);
  assert.equal(changed.installed, false);
  await changed.install();
  assert.equal(commands[7].at(-1), catalogRoot, "upgrades must keep the marketplace root stable");
});

test("failed or missing CLI never marks setup complete, and retry succeeds", async t => {
  const root = await mkdtemp(join(tmpdir(), "catui-setup-fail-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const missing = await prepareCodexPlugin({ root, candidates: ["missing"], run: async () => { throw new Error("ENOENT"); } });
  await assert.rejects(missing.install(), /not found or needs an update/);
  let fail = true;
  const options = { root, candidates: ["codex"], run: async (_command: string, args: string[]) => {
    if (args[1] === "add" && fail) throw new Error("internal diagnostic not intended for UI");
    return "plugin add marketplace";
  } };
  await assert.rejects((await prepareCodexPlugin(options)).install(), /could not install/);
  assert.equal((await prepareCodexPlugin(options)).installed, false);
  fail = false;
  await (await prepareCodexPlugin(options)).install();
  assert.equal((await prepareCodexPlugin(options)).installed, true);
  assert.equal((await readdir(root)).some(p => p.startsWith("setup-")), false);
});

function uiFixture(approved: boolean, hasUI = true) {
  let confirmations = 0, installs = 0;
  const messages: string[] = [];
  const ctx = { hasUI, ui: { confirm: async () => { confirmations++; return approved; }, notify: (message: string) => messages.push(message) } } as any;
  const prepare = async () => ({ installed: false, version: "test", viewUrl: "codex://test", install: async () => { installs++; } });
  return { ctx, prepare, messages, counts: () => ({ confirmations, installs }) };
}

test("first start confirms installation, explains new-chat handoff and does not claim connection", async () => {
  const f = uiFixture(true);
  await offerCodexSetup(f.ctx, false, f.prepare);
  assert.deepEqual(f.counts(), { confirmations: 1, installs: 1 });
  assert.ok(f.messages.some(m => m.includes("Open a new Codex chat")));
  assert.equal(f.messages.some(m => m.includes("Connected")), false);
});

test("decline, headless and a revoked session do not install", async () => {
  for (const [approved, hasUI, current] of [[false, true, true], [true, false, true], [true, true, false]]) {
    const f = uiFixture(approved, hasUI);
    await offerCodexSetup(f.ctx, false, f.prepare, () => current);
    assert.equal(f.counts().installs, 0);
  }
});

test("repeat start skips completed setup; explicit setup repairs it", async () => {
  const f = uiFixture(true);
  const prepare = async () => ({ ...await f.prepare(), installed: true });
  await offerCodexSetup(f.ctx, false, prepare);
  assert.deepEqual(f.counts(), { confirmations: 0, installs: 0 });
  await offerCodexSetup(f.ctx, true, prepare);
  assert.deepEqual(f.counts(), { confirmations: 1, installs: 1 });
});

test("setup failures are actionable and can be retried", async () => {
  const f = uiFixture(true);
  await offerCodexSetup(f.ctx, false, async () => ({ ...await f.prepare(), install: async () => { throw new Error("Update Codex, then retry /bridge setup."); } }));
  assert.ok(f.messages.at(-1)?.includes("/bridge setup"));
});
