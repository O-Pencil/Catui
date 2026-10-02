/**
 * [WHO]: Tests default TypeSafe discovery, parsed skills and bounded append-only guidance
 * [FROM]: node:test, built-in registry, skill parser and TypeSafe extension
 * [TO]: Default extension acceptance suite
 * [HERE]: test/typesafe-extension.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { builtInExtensions, getBuiltinExtensionPaths } from "../builtin-extensions.js";
import { loadSkillsFromDir } from "../core/skills.js";
import type { ExtensionAPI } from "../core/extensions-host/types.js";
import typesafeExtension, { DECISION_GUIDANCE } from "../extensions/builtin/typesafe/index.js";
import { createAgentSession } from "../core/runtime/sdk.js";
import { DefaultResourceLoader } from "../core/platform/config/resource-loader.js";
import { SettingsManager } from "../core/platform/config/settings-manager.js";
import { SessionManager } from "../core/session/session-manager.js";
import { AuthStorage } from "../core/platform/config/auth-storage.js";

test("default passive extension exposes both loadable skills without tools or external calls", () => {
  const metadata = builtInExtensions.find(entry => entry.id === "typesafe")!;
  assert.equal(metadata.defaultEnabled, true);
  assert.equal(metadata.externalProcess, false);
  assert.equal(metadata.writesWorkspace, false);
  assert.ok(getBuiltinExtensionPaths().some(path => path.includes(join("builtin", "typesafe"))));
  const handlers = new Map<string, () => any>();
  // Only hook registration is available: accidental tool/network API use fails.
  typesafeExtension({ on: (name: string, handler: () => any) => handlers.set(name, handler) } as unknown as ExtensionAPI);
  assert.deepEqual([...handlers.keys()].sort(), ["before_agent_start", "resources_discover"]);
  const root = handlers.get("resources_discover")!().skillPaths[0];
  const loaded = loadSkillsFromDir({ dir: root, source: "test" });
  assert.deepEqual(loaded.skills.map(skill => skill.name).sort(), ["agent-decision-loop", "typesafe-ai"]);
  assert.equal(loaded.diagnostics.filter(item => item.type === "error").length, 0);
  const before = handlers.get("before_agent_start")!;
  assert.deepEqual(before(), { appendSystemPrompt: DECISION_GUIDANCE });
  assert.deepEqual(before(), before(), "repeated turns do not accumulate prompt state");
  assert.ok(DECISION_GUIDANCE.length < 1600);
  assert.ok(readFileSync(join(root, "..", "LICENSE"), "utf8").includes("MIT License"));
});

test("headless SDK discovers skills before its first prompt and reload; Soul stays inactive", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "catui-default-skills-"));
  const settings = SettingsManager.inMemory();
  const loader = new DefaultResourceLoader({ cwd, agentDir: cwd, settingsManager: settings,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
    extensionFactories: [typesafeExtension], systemPrompt: "Test identity.",
    agentsFilesOverride: () => ({ agentsFiles: [] }) });
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  try {
    await loader.reload();
    const result = await createAgentSession({ cwd, agentDir: cwd, resourceLoader: loader,
      settingsManager: settings, sessionManager: SessionManager.inMemory(cwd),
      authStorage: AuthStorage.create(join(cwd, "auth.json")), enableSoul: true,
      model: { id: "offline-test", name: "Offline", api: "openai-completions", provider: "catui-offline-test",
        baseUrl: "https://example.invalid", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 1024,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
      enableMCP: false, tools: [] });
    session = result.session;
    assert.equal(result.soulManager, undefined);
    assert.equal(session.soulManager, undefined);
    // Exercise preparation without an API call: model/key validation rejects afterward.
    await assert.rejects(session.prompt("/skill:agent-decision-loop inspect evidence"));
    assert.deepEqual(session.resourceLoader.getSkills().skills.map(skill => skill.name).sort(),
      ["agent-decision-loop", "typesafe-ai"]);
    await session.reload();
    assert.equal(session.resourceLoader.getSkills().skills.length, 2);
    assert.equal(session.soulManager, undefined);
    assert.equal(existsSync(join(cwd, "soul")), false);
  } finally { session?.dispose(); rmSync(cwd, { recursive: true, force: true }); }
});
