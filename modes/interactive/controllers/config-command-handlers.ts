/**
 * [WHO]: Provides ConfigCommandHandlersController + ConfigCommandHandlersContext — interactive
 *        runtime-config command bodies (/agent-loop, /mcp, /language)
 * [FROM]: Depends on injected host capability closures + mcp-config + i18n; no InteractiveMode reference
 * [TO]: Consumed by modes/interactive/interactive-mode.ts (held as `this.configCommands`; wired into
 *       SlashDispatcherController commands port)
 * [HERE]: modes/interactive/controllers/config-command-handlers.ts — P7 C-3a slice 3/4 (extracted from
 *         InteractiveMode command-handler block; behavior-preserving move)
 */
import { Spacer, Text, type CachedContainer, type TUI } from "@catui/tui";
import type { AgentSession } from "../../../core/runtime/agent-session.js";
import { listMCPServers, setMCPServerEnabled } from "../../../core/mcp/mcp-config.js";
import type { FooterComponent } from "../components/footer.js";
import { theme } from "../theme/theme.js";

/** Host capabilities needed by the runtime-config command handlers. */
export interface ConfigCommandHandlersContext {
  readonly session: AgentSession;
  readonly chatContainer: CachedContainer;
  readonly ui: TUI;
  readonly footer: FooterComponent;
  showStatus(message: string): void;
  showError(errorMessage: string): void;
}

export class ConfigCommandHandlersController {
  constructor(private readonly ctx: ConfigCommandHandlersContext) {}

  handleAgentLoopCommand(text: string): void {
    const arg = text.slice("/agent-loop".length).trim().toLowerCase();
    const choices = ["standard", "weak-model-compatible"] as const;
    const normalized =
      arg === "high-intelligence" ? "standard" :
      arg === "low-intelligence" || arg === "structured-adaptive" ? "weak-model-compatible" :
      arg;

    if (!arg) {
      this.ctx.showStatus(
        `Agent loop: ${this.ctx.session.agentLoopFramework} (available: ${choices.join(", ")})`,
      );
      return;
    }

    if (!choices.includes(normalized as any)) {
      this.ctx.showError(
        `Unknown agent loop framework: ${arg}\nAvailable: ${choices.join(", ")}`,
      );
      return;
    }

    this.ctx.session.setAgentLoopFramework(normalized as any);
    this.ctx.footer.invalidate();
    this.ctx.showStatus(`Agent loop framework: ${this.ctx.session.agentLoopFramework}`);
  }

  async handleMcpCommand(text: string): Promise<void> {
    const parts = text.trim().split(/\s+/);
    const action = (parts[1] || "list").toLowerCase();
    const target = parts[2];

    if (action === "list") {
      const servers = listMCPServers();
      this.ctx.chatContainer.addChild(new Spacer(1));
      if (servers.length === 0) {
        this.ctx.chatContainer.addChild(
          new Text(theme.fg("dim", "No MCP servers configured."), 1, 0),
        );
      } else {
        const lines = [
          theme.bold("MCP Servers"),
          "",
          ...servers.map((s) => {
            const status = s.enabled === false ? "disabled" : "enabled";
            return `- ${s.id} (${s.name}) [${status}]`;
          }),
          "",
          theme.fg("dim", "Use: /mcp enable <id> or /mcp disable <id>"),
        ];
        this.ctx.chatContainer.addChild(new Text(lines.join("\n"), 1, 0));
      }
      this.ctx.ui.requestRender();
      return;
    }

    if (action === "status" || action === "tools") {
      const runtimeTools = this.ctx.session
        .getAllTools()
        .filter((t) => t.name.startsWith("mcp_"));
      this.ctx.chatContainer.addChild(new Spacer(1));
      if (runtimeTools.length === 0) {
        this.ctx.chatContainer.addChild(
          new Text(
            [
              theme.bold("MCP Runtime Status"),
              "",
              "No MCP tools are currently registered in this session.",
              theme.fg("dim", "Tip: run /reload and check startup logs for MCP errors."),
            ].join("\n"),
            1,
            0,
          ),
        );
      } else {
        const lines = [
          theme.bold("MCP Runtime Status"),
          "",
          `Registered MCP tools: ${runtimeTools.length}`,
          ...runtimeTools.slice(0, 30).map((t) => `- ${t.name}`),
        ];
        if (runtimeTools.length > 30) {
          lines.push(theme.fg("dim", `...and ${runtimeTools.length - 30} more`));
        }
        this.ctx.chatContainer.addChild(new Text(lines.join("\n"), 1, 0));
      }
      this.ctx.ui.requestRender();
      return;
    }

    if ((action === "enable" || action === "disable") && target) {
      setMCPServerEnabled(target, action === "enable");
      this.ctx.chatContainer.addChild(new Spacer(1));
      this.ctx.chatContainer.addChild(
        new Text(
          `${target} ${action === "enable" ? "enabled" : "disabled"}. Run /reload to apply changes.`,
          1,
          0,
        ),
      );
      this.ctx.ui.requestRender();
      return;
    }

    this.ctx.chatContainer.addChild(new Spacer(1));
    this.ctx.chatContainer.addChild(
      new Text("Usage: /mcp [list|status|tools|enable <id>|disable <id>]", 1, 0),
    );
    this.ctx.ui.requestRender();
  }

  async handleLanguageCommand(text: string): Promise<void> {
    const { setLocale, getLocale, AVAILABLE_LOCALES, LOCALE_NAMES } = await import(
      "../../../core/platform/i18n/index.js"
    );
    const currentLocale = getLocale();

    // Parse command
    const parts = text.split(" ");
    const targetLocale = parts[1]?.toLowerCase();

    if (!targetLocale) {
      // Show current language and options
      this.ctx.chatContainer.addChild(new Spacer(1));
      this.ctx.chatContainer.addChild(
        new Text(
          theme.fg("accent", `Current language: ${LOCALE_NAMES[currentLocale]}`),
          1,
          0,
        ),
      );
      this.ctx.chatContainer.addChild(new Text("Available languages:", 1, 0));
      for (const locale of AVAILABLE_LOCALES) {
        const marker = locale === currentLocale ? " ●" : "";
        this.ctx.chatContainer.addChild(
          new Text(`  /language ${locale} - ${LOCALE_NAMES[locale]}${marker}`, 1, 0),
        );
      }
      this.ctx.ui.requestRender();
      return;
    }

    // Validate locale
    const locale = targetLocale as (typeof AVAILABLE_LOCALES)[number];
    if (!AVAILABLE_LOCALES.includes(locale)) {
      this.ctx.chatContainer.addChild(new Spacer(1));
      this.ctx.chatContainer.addChild(
        new Text(
          theme.fg("error", `Unknown language: ${targetLocale}`),
          1,
          0,
        ),
      );
      this.ctx.chatContainer.addChild(new Text("Available: " + AVAILABLE_LOCALES.join(", "), 1, 0));
      this.ctx.ui.requestRender();
      return;
    }

    // Set locale
    setLocale(locale);

    // Show confirmation
    this.ctx.chatContainer.addChild(new Spacer(1));
    this.ctx.chatContainer.addChild(
      new Text(
        theme.fg("success", `Language changed to: ${LOCALE_NAMES[locale]}`),
        1,
        0,
      ),
    );
    this.ctx.chatContainer.addChild(
      new Text("Restart Catui for full effect.", 1, 0),
    );
    this.ctx.ui.requestRender();
  }
}
