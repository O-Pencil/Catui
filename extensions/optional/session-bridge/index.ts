/**
 * [WHO]: Opt-in /bridge command binds a local controller to the current Catui session
 * [FROM]: Extension API contract, local controller and transport only
 * [TO]: User-loaded extension host; companion Codex plugin communicates over loopback
 * [HERE]: extensions/optional/session-bridge/index.ts - lifecycle and explicit activation
 */
import type { ExtensionAPI } from "../../../core/extensions-host/types.js";
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
  const stop = async () => {
    generation++;
    controller?.revoke();
    controller = undefined;
    const previous = server;
    server = undefined;
    await previous?.close();
  };
  api.registerCommand("bridge", {
    description: "Start, stop or inspect authorized local same-session control",
    handler: async (args, ctx) => {
      const action = args.trim() || "status";
      if (action === "stop") {
        await stop();
        ctx.ui.notify("Bridge stopped. Previously submitted messages may still be queued.", "info");
      } else if (action === "start") {
        if (server || starting) { ctx.ui.notify("Bridge is already active or starting.", "info"); return; }
        starting = true;
        const expectedGeneration = ++generation;
        const next = new BridgeController({
          sessionId: () => ctx.sessionManager.getSessionId(), isIdle: () => ctx.isIdle(),
          hasPendingMessages: () => ctx.hasPendingMessages(),
          send: (text, mode) => api.sendUserMessage(text, { deliverAs: mode }), abort: () => ctx.abort(),
        });
        try {
          const transport = await startBridgeServer(next, ctx.cwd);
          if (generation !== expectedGeneration || ctx.sessionManager.getSessionId() !== next.sessionId) {
            await transport.close(); return;
          }
          controller = next;
          server = transport;
          ctx.ui.notify(`Bridge active: ${transport.bridgeId}. Local clients can read progress, send prompts and cancel the current run. Use /bridge stop to revoke.`, "info");
        } catch (error) {
          ctx.ui.notify(error instanceof Error ? error.message : "Bridge startup failed", "error");
        } finally { starting = false; }
      } else if (action === "status") {
        ctx.ui.notify(server ? `Bridge active: ${server.bridgeId}` : "Bridge inactive. Use /bridge start to allow local control.", "info");
      } else ctx.ui.notify("Usage: /bridge start|stop|status", "warning");
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
