/**
 * [WHO]: offerCodexSetup presents one-time connection setup and explicit repair
 * [FROM]: Extension UI context contract and local plugin installer
 * [TO]: /bridge start and /bridge setup
 * [HERE]: extensions/optional/session-bridge/setup/onboarding.ts - user-directed setup
 */
import type { ExtensionContext } from "../../../../core/extensions-host/types.js";
import { prepareCodexPlugin } from "./installer.js";

export async function offerCodexSetup(ctx: ExtensionContext, force = false,
  prepare = prepareCodexPlugin, stillCurrent = () => true): Promise<void> {
  try {
    const plan = await prepare();
    if (!stillCurrent()) return;
    if (plan.installed && !force) return;
    if (!ctx.hasUI) {
      ctx.ui.notify("To connect Codex, run /bridge setup in interactive Catui and confirm installation.", "info");
      return;
    }
    const approved = await ctx.ui.confirm("Connect Codex",
      "Install or update Catui Bridge in Codex? This adds a local plugin so Codex can read progress and send feedback to sessions you enable. No account keys or file paths to copy.");
    if (!approved || !stillCurrent()) {
      if (stillCurrent()) ctx.ui.notify("Setup skipped. You can connect later with /bridge setup.", "info");
      return;
    }
    ctx.ui.notify("Installing Catui Bridge in Codex…", "info");
    await plan.install();
    if (stillCurrent()) ctx.ui.notify("Catui Bridge installed. Open a new Codex chat to load it, then ask Codex to connect to this Catui session. If tools are missing, restart Codex once. Use /bridge status for the exact session prompt.", "info");
  } catch (error) {
    if (stillCurrent()) ctx.ui.notify(error instanceof Error ? error.message : "Connection setup failed. Retry /bridge setup.", "error");
  }
}
