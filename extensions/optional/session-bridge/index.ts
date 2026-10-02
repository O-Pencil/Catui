/**
 * [WHO]: Default /bridge command provides explicit activation and guided Codex setup
 * [FROM]: Extension API contract, local controller/transport and lazy setup module
 * [TO]: Built-in or explicitly loaded extension host; Codex communicates over loopback
 * [HERE]: extensions/optional/session-bridge/index.ts - lifecycle and explicit activation
 */
import type { ExtensionAPI, ExtensionContext, ExtensionUIContext } from "../../../core/extensions-host/types.js";
import { BridgeController } from "./controller.js";
import { startBridgeServer } from "./server.js";

function messageText(value: unknown): { role: string; text: string } {
  const message = value as { role?: string; content?: unknown };
  const content = message?.content;
  const text = typeof content === "string" ? content : Array.isArray(content)
    ? content.filter(block => block?.type === "text" && typeof block.text === "string").map(block => block.text).join("\n") : "";
  return { role: message?.role ?? "", text };
}
export default function sessionBridge(api: ExtensionAPI): void {
  let controller: BridgeController | undefined;
  let server: Awaited<ReturnType<typeof startBridgeServer>> | undefined;
  let generation = 0;
  let starting = false;
  let setupRunning = false;
  let statusUI: ExtensionUIContext | undefined;
  const setup = async (ctx: ExtensionContext, force = false) => {
    if (setupRunning) { ctx.ui.notify("Codex setup is already running.", "info"); return; }
    setupRunning = true;
    const expectedGeneration = generation;
    try {
      const { offerCodexSetup } = await import("./setup/onboarding.js");
      await offerCodexSetup(ctx, force, undefined, () => generation === expectedGeneration);
    } finally { setupRunning = false; }
  };
  const showStatus = (ctx: ExtensionContext) => {
    if (!server) { ctx.ui.notify("Bridge is off. Run /bridge start to connect Codex to this session.", "info"); return; }
    const contact = server.lastContactAt ? `Last client contact: ${server.lastContactAt}.` : "Waiting for a client. Open a new Codex chat with Catui Bridge enabled.";
    ctx.ui.notify(`${contact}\nIn Codex, say: Connect to Catui bridge ${server.bridgeId} and inspect its progress.\nUse /bridge setup to install or repair the plugin; /bridge stop to disconnect.`, "info");
  };
  const stop = async () => {
    generation++;
    controller?.revoke();
    controller = undefined;
    const previous = server;
    server = undefined;
    statusUI?.setStatus?.("catui-bridge", undefined);
    statusUI = undefined;
    await previous?.close();
  };
  api.registerCommand("bridge", {
    description: "Connect Codex to this session, install its plugin, or disconnect",
    handler: async (args, ctx) => {
      let action = args.trim();
      if (!action && ctx.hasUI) {
        const actions: Record<string, string> = { "Start connection": "start", "Set up Codex plugin": "setup", "Connection status": "status", "Stop connection": "stop" };
        const selected = await ctx.ui.select("Catui Bridge", Object.keys(actions));
        if (!selected) return;
        action = actions[selected];
      }
      action ||= "status";
      if (action === "stop") {
        await stop();
        ctx.ui.notify("Bridge stopped. Previously submitted messages may still be queued.", "info");
      } else if (action === "start") {
        if (server) { showStatus(ctx); await setup(ctx); return; }
        if (starting) { ctx.ui.notify("Bridge is starting.", "info"); return; }
        starting = true;
        const expectedGeneration = ++generation;
        const next = new BridgeController({
          sessionId: () => ctx.sessionManager.getSessionId(), isIdle: () => ctx.isIdle(),
          hasPendingMessages: () => ctx.hasPendingMessages(),
          send: (text, mode) => api.sendUserMessage(text, { deliverAs: mode }), abort: () => ctx.abort(),
        });
        try {
          const transport = await startBridgeServer(next, ctx.cwd, undefined, () => {
            if (controller === next) ctx.ui.setStatus?.("catui-bridge", "Bridge: client seen");
          });
          if (generation !== expectedGeneration || ctx.sessionManager.getSessionId() !== next.sessionId) {
            await transport.close(); return;
          }
          controller = next;
          server = transport;
          statusUI = ctx.ui;
          ctx.ui.setStatus?.("catui-bridge", "Bridge: waiting for Codex");
          ctx.ui.notify("Bridge started. Local clients can read progress, send prompts and cancel the current run. Use /bridge stop to disconnect.", "info");
          await setup(ctx);
          if (generation === expectedGeneration) showStatus(ctx);
        } catch (error) {
          ctx.ui.notify(error instanceof Error ? error.message : "Bridge startup failed", "error");
        } finally { starting = false; }
      } else if (action === "status") {
        showStatus(ctx);
      } else if (action === "setup") {
        await setup(ctx, true);
      } else ctx.ui.notify("Usage: /bridge start|setup|status|stop", "warning");
    },
  });
  api.on("session_switch", stop);
  api.on("session_fork", stop);
  api.on("session_shutdown", stop);
  api.on("agent_start", () => { controller?.event("agent_start"); });
  api.on("agent_end", () => { controller?.event("agent_end"); });
  api.on("agent_abort", () => { controller?.event("agent_abort"); });
  api.on("message_start", event => {
    const message = messageText(event.message);
    if (message.role === "user") controller?.observe(message.text);
  });
  api.on("message_end", event => {
    const message = messageText(event.message);
    if (message.role === "assistant" && message.text) controller?.event("assistant_message", message.text);
  });
}
