/**
 * [WHO]: Provides InfoCommandHandlersController + InfoCommandHandlersContext — interactive
 *        display/info command bodies (/export, /share, /copy, /status, /usage, /name, /session,
 *        /changelog, /hotkeys, render-debug, easter eggs, /resources)
 * [FROM]: Depends on injected host capability closures + @catui/tui components; no InteractiveMode reference
 * [TO]: Consumed by modes/interactive/interactive-mode.ts (held as `this.infoCommands`; wired into
 *       SlashDispatcherController commands port, keybinding actions, welcome-banner hints)
 * [HERE]: modes/interactive/controllers/info-command-handlers.ts — P7 C-3a slice 4/4 (extracted from
 *         InteractiveMode command-handler block; behavior-preserving move)
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn, spawnSync } from "child_process";
import { Markdown, Spacer, Text, visibleWidth, type CachedContainer, type Container, type EditorAction, type EditorComponent, type MarkdownTheme, type TUI } from "@catui/tui";
import type { AgentSession } from "../../../core/runtime/agent-session.js";
import type { SessionManager } from "../../../core/session/session-manager.js";
import type { AppAction, KeybindingsManager } from "../../../core/platform/keybindings.js";
import { getDebugLogPath, getShareViewerUrl } from "../../../config.js";
import { getChangelogPath, parseChangelog } from "../../../utils/changelog.js";
import { copyToClipboard } from "../../utils/clipboard.js";
import { formatAgentLoopStatusLines } from "../agent-loop-status.js";
import { ArminComponent } from "../components/armin.js";
import { BorderedLoader } from "../components/bordered-loader.js";
import { DaxnutsComponent } from "../components/daxnuts.js";
import { DynamicBorder } from "../components/dynamic-border.js";
import { renderContextProgressBar, type FooterComponent } from "../components/footer.js";
import { appKey, editorKey } from "../components/keybinding-hints.js";
import { RawText } from "../components/raw-text.js";
import type { FooterDataProvider } from "../footer-data-provider.js";
import { theme } from "../theme/theme.js";

/** Host capabilities needed by the display/info command handlers. */
export interface InfoCommandHandlersContext {
  readonly session: AgentSession;
  readonly sessionManager: SessionManager;
  readonly ui: TUI;
  readonly version: string;
  readonly footerDataProvider: FooterDataProvider;
  readonly chatContainer: CachedContainer;
  readonly editorContainer: Container;
  /** Currently mounted editor component (may be swapped by the editor adapter). */
  readonly editor: EditorComponent;
  readonly keybindings: KeybindingsManager;
  showStatus(message: string): void;
  showError(errorMessage: string): void;
  showWarning(warningMessage: string): void;
  remountEditorShell(): void;
  updateTerminalTitle(): void;
  getMarkdownThemeWithSettings(): MarkdownTheme;
  showLoadedResources(options?: {
    extensionPaths?: string[];
    force?: boolean;
    showDiagnosticsWhenQuiet?: boolean;
  }): void;
}

export class InfoCommandHandlersController {
  constructor(private readonly ctx: InfoCommandHandlersContext) {}

  async handleExportCommand(text: string): Promise<void> {
    const parts = text.split(/\s+/);
    const outputPath = parts.length > 1 ? parts[1] : undefined;

    try {
      const filePath = await this.ctx.session.exportToHtml(outputPath);
      this.ctx.showStatus(`Session exported to: ${filePath}`);
    } catch (error: unknown) {
      this.ctx.showError(
        `Failed to export session: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  async handleShareCommand(): Promise<void> {
    // Check if gh is available and logged in
    try {
      const authResult = spawnSync("gh", ["auth", "status"], {
        encoding: "utf-8",
      });
      if (authResult.status !== 0) {
        this.ctx.showError(
          "GitHub CLI is not logged in. Run 'gh auth login' first.",
        );
        return;
      }
    } catch {
      this.ctx.showError(
        "GitHub CLI (gh) is not installed. Install it from https://cli.github.com/",
      );
      return;
    }

    // Export to a temp file
    const tmpFile = path.join(os.tmpdir(), "session.html");
    try {
      await this.ctx.session.exportToHtml(tmpFile);
    } catch (error: unknown) {
      this.ctx.showError(
        `Failed to export session: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      return;
    }

    // Show cancellable loader, replacing the editor
    const loader = new BorderedLoader(this.ctx.ui, theme, "Creating gist...");
    this.ctx.editorContainer.clear();
    this.ctx.editorContainer.addChild(loader);
    this.ctx.ui.setFocus(loader);
    this.ctx.ui.requestRender();

    const restoreEditor = () => {
      loader.dispose();
      this.ctx.remountEditorShell();
      this.ctx.ui.setFocus(this.ctx.editor);
      try {
        fs.unlinkSync(tmpFile);
      } catch {
        // Ignore cleanup errors
      }
    };

    // Create a secret gist asynchronously
    let proc: ReturnType<typeof spawn> | null = null;

    loader.onAbort = () => {
      proc?.kill();
      restoreEditor();
      this.ctx.showStatus("Share cancelled");
    };

    try {
      const result = await new Promise<{
        stdout: string;
        stderr: string;
        code: number | null;
      }>((resolve) => {
        proc = spawn("gh", ["gist", "create", "--public=false", tmpFile]);
        let stdout = "";
        let stderr = "";
        proc.stdout?.on("data", (data) => {
          stdout += data.toString();
        });
        proc.stderr?.on("data", (data) => {
          stderr += data.toString();
        });
        proc.on("close", (code) => resolve({ stdout, stderr, code }));
      });

      if (loader.signal.aborted) return;

      restoreEditor();

      if (result.code !== 0) {
        const errorMsg = result.stderr?.trim() || "Unknown error";
        this.ctx.showError(`Failed to create gist: ${errorMsg}`);
        return;
      }

      // Extract gist ID from the URL returned by gh
      // gh returns something like: https://gist.github.com/username/GIST_ID
      const gistUrl = result.stdout?.trim();
      const gistId = gistUrl?.split("/").pop();
      if (!gistId) {
        this.ctx.showError("Failed to parse gist ID from gh output");
        return;
      }

      // Create the preview URL
      const previewUrl = getShareViewerUrl(gistId);
      this.ctx.showStatus(`Share URL: ${previewUrl}\nGist: ${gistUrl}`);
    } catch (error: unknown) {
      if (!loader.signal.aborted) {
        restoreEditor();
        this.ctx.showError(
          `Failed to create gist: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    }
  }

  handleCopyCommand(): void {
    const text = this.ctx.session.getLastAssistantText();
    if (!text) {
      this.ctx.showError("No agent messages to copy yet.");
      return;
    }

    try {
      copyToClipboard(text);
      this.ctx.showStatus("Copied last agent message to clipboard");
    } catch (error) {
      this.ctx.showError(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Handle /status command - show agent status card (Codex-style)
   */
  async handleStatusCommand(): Promise<void> {
    const state = this.ctx.session.state;
    const sessionMgr = this.ctx.sessionManager;

    // Helper to pad a line to fit within the card width
    const padLine = (text: string, cardWidth: number): string => {
      // Calculate padding needed (account for │ borders on both sides)
      const contentWidth = cardWidth - 2;
      const textLen = visibleWidth(text);
      const pad = Math.max(0, contentWidth - textLen);
      return text + " ".repeat(pad);
    };

    // Build status card lines
    const lines: string[] = [];
    const width = Math.min(this.ctx.ui.terminal.columns || 80, 73);

    // Top border with title
    const titleLeft = `  >_ Catui (v${this.ctx.version})  `;
    const titlePad = Math.max(0, width - titleLeft.length - 1);
    lines.push(theme.fg("border", `╭${"─".repeat(Math.max(1, width - 2))}╮`));
    lines.push(theme.fg("border", `│`) + theme.bold(titleLeft) + " ".repeat(titlePad) + theme.fg("border", `│`));
    lines.push(theme.fg("border", `│`) + " ".repeat(Math.max(1, width - 2)) + theme.fg("border", `│`));

    // Model info
    const modelId = state.model?.id || "no-model";
    const thinkingLevel = state.thinkingLevel || "off";
    const reasoning = state.model?.reasoning ? `reasoning ${thinkingLevel}` : "";
    const modelLine = `  Model:                ${modelId}${reasoning ? ` (${reasoning})` : ""}`;
    lines.push(theme.fg("border", `│`) + padLine(modelLine, width) + theme.fg("border", `│`));
    const loopLine = `  Agent loop:           ${this.ctx.session.agentLoopFramework}`;
    lines.push(theme.fg("border", `│`) + padLine(loopLine, width) + theme.fg("border", `│`));
    for (const line of formatAgentLoopStatusLines(state.lastResult)) {
      lines.push(theme.fg("border", `│`) + padLine(`  ${line}`, width) + theme.fg("border", `│`));
    }

    // Directory (with git branch if available)
    let cwd = this.ctx.session.cwd;
    const home = process.env.HOME || process.env.USERPROFILE;
    if (home && cwd.startsWith(home)) {
      cwd = `~${cwd.slice(home.length)}`;
    }
    const branch = this.ctx.footerDataProvider.getGitBranch();
    const dirLine = `  Directory:            ${cwd}${branch ? ` (${branch})` : ""}`;
    lines.push(theme.fg("border", `│`) + padLine(dirLine, width) + theme.fg("border", `│`));

    // AGENTS.md check
    const agentsMdPath = path.join(this.ctx.session.cwd, "AGENTS.md");
    const agentsMdExists = fs.existsSync(agentsMdPath);
    const agentsMdLine = `  AGENTS.md:            ${agentsMdExists ? "AGENTS.md" : "not found"}`;
    lines.push(theme.fg("border", `│`) + padLine(agentsMdLine, width) + theme.fg("border", `│`));

    // Session info
    const sessionId = sessionMgr.getSessionId();
    const sessionName = sessionMgr.getSessionName();
    const sessionLine = `  Session:              ${sessionName || sessionId.slice(0, 8)}...`;
    lines.push(theme.fg("border", `│`) + padLine(sessionLine, width) + theme.fg("border", `│`));

    // Account info (from auth storage)
    const authStorage = this.ctx.session.modelRegistry.authStorage;
    const providers = authStorage.list();
    let accountInfo = "Not logged in";
    if (providers.length > 0) {
      const loggedProviders = providers.map((p) => {
        const cred = authStorage.get(p);
        if (cred?.type === "oauth") {
          return `${p} (OAuth)`;
        }
        return `${p} (API key)`;
      });
      accountInfo = loggedProviders.join(", ");
    }
    const accountLine = `  Account:              ${accountInfo}`;
    lines.push(theme.fg("border", `│`) + padLine(accountLine, width) + theme.fg("border", `│`));

    lines.push(theme.fg("border", `│`) + " ".repeat(Math.max(1, width - 2)) + theme.fg("border", `│`));

    // Token usage summary (similar to footer)
    let totalInput = 0;
    let totalOutput = 0;
    let totalCost = 0;
    let requestCount = 0;

    for (const entry of sessionMgr.getBranch()) {
      if (entry.type === "message" && entry.message.role === "assistant") {
        totalInput += entry.message.usage.input;
        totalOutput += entry.message.usage.output;
        totalCost += entry.message.usage.cost.total;
        requestCount++;
      }
    }

    const fmt = (n: number) => n.toLocaleString();
    const fmtCost = (n: number) => `$${n.toFixed(4)}`;

    // Usage stats
    lines.push(theme.fg("border", `│`) + theme.bold(theme.fg("accent", "  ═══ Session Usage ═══")) + " ".repeat(Math.max(1, width - 23)) + theme.fg("border", `│`));
    lines.push(theme.fg("border", `│`) + " ".repeat(Math.max(1, width - 2)) + theme.fg("border", `│`));

    const requestsLine = `  Requests:             ${requestCount}`;
    lines.push(theme.fg("border", `│`) + padLine(requestsLine, width) + theme.fg("border", `│`));

    const inputLine = `  Input tokens:         ${fmt(totalInput)}`;
    lines.push(theme.fg("border", `│`) + padLine(inputLine, width) + theme.fg("border", `│`));

    const outputLine = `  Output tokens:        ${fmt(totalOutput)}`;
    lines.push(theme.fg("border", `│`) + padLine(outputLine, width) + theme.fg("border", `│`));

    const costLine = `  Cost:                 ${fmtCost(totalCost)}`;
    lines.push(theme.fg("border", `│`) + padLine(costLine, width) + theme.fg("border", `│`));

    // Context usage with progress bar
    const contextUsage = this.ctx.session.getContextUsage();
    const contextWindow = contextUsage?.contextWindow ?? state.model?.contextWindow ?? 0;
    const contextPercent = contextUsage?.percent ?? 0;
    const contextTokens = contextUsage?.tokens ?? 0;

    const bar = renderContextProgressBar(contextPercent);

    const contextLine = `  Context:              ${bar} ${contextPercent.toFixed(1)}% (${fmt(contextTokens)}/${fmt(contextWindow)})`;
    lines.push(theme.fg("border", `│`) + padLine(contextLine, width) + theme.fg("border", `│`));

    // Bottom border
    lines.push(theme.fg("border", `╰${"─".repeat(Math.max(1, width - 2))}╯`));

    // Display in chat - use RawText to preserve our pre-formatted ANSI card layout
    this.ctx.chatContainer.addChild(new Spacer(1));
    this.ctx.chatContainer.addChild(new RawText(lines.join("\n")));

    this.ctx.ui.requestRender();
  }

  /**
   * Handle /usage command - show token usage statistics
   */
  async handleUsageCommand(): Promise<void> {
    // Group usage by model
    const modelUsage = new Map<
      string,
      {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
        totalTokens: number;
        cost: number;
        requestCount: number;
      }
    >();

    let totalInput = 0;
    let totalOutput = 0;
    let totalCacheRead = 0;
    let totalCacheWrite = 0;
    let totalCost = 0;
    let totalTokens = 0;
    let requestCount = 0;

    // Aggregate usage by model (current branch only)
    for (const entry of this.ctx.sessionManager.getBranch()) {
      if (entry.type === "message" && entry.message.role === "assistant") {
        const msg = entry.message;
        const modelId = msg.model || "unknown";
        const msgTokens =
          msg.usage.totalTokens ||
          msg.usage.input + msg.usage.output + msg.usage.cacheRead + msg.usage.cacheWrite;

        if (!modelUsage.has(modelId)) {
          modelUsage.set(modelId, {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: 0,
            requestCount: 0,
          });
        }

        const stats = modelUsage.get(modelId)!;
        stats.input += msg.usage.input;
        stats.output += msg.usage.output;
        stats.cacheRead += msg.usage.cacheRead;
        stats.cacheWrite += msg.usage.cacheWrite;
        stats.totalTokens += msgTokens;
        stats.cost += msg.usage.cost.total;
        stats.requestCount++;

        totalInput += msg.usage.input;
        totalOutput += msg.usage.output;
        totalCacheRead += msg.usage.cacheRead;
        totalCacheWrite += msg.usage.cacheWrite;
        totalTokens += msgTokens;
        totalCost += msg.usage.cost.total;
        requestCount++;
      }
    }

    // Get context usage
    const contextUsage = this.ctx.session.getContextUsage();
    const contextWindow = contextUsage?.contextWindow ?? 0;

    // Format numbers
    const fmt = (n: number) => n.toLocaleString();
    const fmtCost = (n: number) => `$${n.toFixed(4)}`;

    // Build output
    const lines: string[] = [];
    lines.push(theme.bold(theme.fg("accent", "═══ Token Usage ═══")));
    lines.push("");

    // Show usage by model
    if (modelUsage.size > 0) {
      for (const [modelId, stats] of modelUsage) {
        lines.push(theme.fg("accent", `┌─ ${modelId} ─`));
        lines.push("");
        lines.push(`│ Requests:   ${stats.requestCount}`);
        lines.push(`│ Input:     ${fmt(stats.input)} tokens`);
        lines.push(`│ Output:    ${fmt(stats.output)} tokens`);
        lines.push(`│ Cache:     ${fmt(stats.cacheRead + stats.cacheWrite)} tokens`);
        lines.push(`│ Total:     ${fmt(stats.totalTokens)} tokens`);
        lines.push(`│ Cost:      ${fmtCost(stats.cost)}`);
        lines.push(theme.fg("accent", `└${"─".repeat(Math.min(50, modelId.length + 4))}`));
        lines.push("");
      }
    }

    // Total
    lines.push(theme.bold("  ─────────── Total ───────────"));
    lines.push(`  Requests:     ${requestCount}`);
    lines.push(`  Input:       ${fmt(totalInput)} tokens`);
    lines.push(`  Output:      ${fmt(totalOutput)} tokens`);
    lines.push(`  Cache:       ${fmt(totalCacheRead + totalCacheWrite)} tokens`);
    lines.push(`  Total:       ${fmt(totalTokens)} tokens`);
    lines.push(`  Cost:        ${fmtCost(totalCost)}`);
    lines.push("");
    const contextPercentStr =
      contextUsage?.percent != null
        ? `${contextUsage.percent.toFixed(1)}%`
        : "?";
    lines.push(`  Context:     ${contextPercentStr} / ${fmt(contextWindow)} tokens`);

    // Show current model info
    const state = this.ctx.session.state;
    if (state.model) {
      lines.push(`  Current:     ${state.model.id}`);
    }

    lines.push("");
    lines.push(theme.fg("dim", "  Tip: Use /settings → Terminal → Show token stats to toggle footer display"));

    // Display in chat
    for (const line of lines) {
      this.ctx.chatContainer.addChild(new Spacer(1));
      this.ctx.chatContainer.addChild(new Text(line, 1, 0));
    }
  }

  handleNameCommand(text: string): void {
    const name = text.replace(/^\/name\s*/, "").trim();
    if (!name) {
      const currentName = this.ctx.sessionManager.getSessionName();
      if (currentName) {
        this.ctx.chatContainer.addChild(new Spacer(1));
        this.ctx.chatContainer.addChild(
          new Text(theme.fg("dim", `Session name: ${currentName}`), 1, 0),
        );
      } else {
        this.ctx.showWarning("Usage: /name <name>");
      }
      this.ctx.ui.requestRender();
      return;
    }

    this.ctx.sessionManager.appendSessionInfo(name);
    this.ctx.updateTerminalTitle();
    this.ctx.chatContainer.addChild(new Spacer(1));
    this.ctx.chatContainer.addChild(
      new Text(theme.fg("dim", `Session name set: ${name}`), 1, 0),
    );
    this.ctx.ui.requestRender();
  }

  handleSessionCommand(): void {
    const stats = this.ctx.session.getSessionStats();
    const sessionName = this.ctx.sessionManager.getSessionName();

    let info = `${theme.bold("Session Info")}\n\n`;
    if (sessionName) {
      info += `${theme.fg("dim", "Name:")} ${sessionName}\n`;
    }
    info += `${theme.fg("dim", "File:")} ${stats.sessionFile ?? "In-memory"}\n`;
    info += `${theme.fg("dim", "ID:")} ${stats.sessionId}\n\n`;
    info += `${theme.bold("Messages")}\n`;
    info += `${theme.fg("dim", "User:")} ${stats.userMessages}\n`;
    info += `${theme.fg("dim", "Assistant:")} ${stats.assistantMessages}\n`;
    info += `${theme.fg("dim", "Tool Calls:")} ${stats.toolCalls}\n`;
    info += `${theme.fg("dim", "Tool Results:")} ${stats.toolResults}\n`;
    info += `${theme.fg("dim", "Total:")} ${stats.totalMessages}\n\n`;
    info += `${theme.bold("Tokens")}\n`;
    info += `${theme.fg("dim", "Input:")} ${stats.tokens.input.toLocaleString()}\n`;
    info += `${theme.fg("dim", "Output:")} ${stats.tokens.output.toLocaleString()}\n`;
    if (stats.tokens.cacheRead > 0) {
      info += `${theme.fg("dim", "Cache Read:")} ${stats.tokens.cacheRead.toLocaleString()}\n`;
    }
    if (stats.tokens.cacheWrite > 0) {
      info += `${theme.fg("dim", "Cache Write:")} ${stats.tokens.cacheWrite.toLocaleString()}\n`;
    }
    info += `${theme.fg("dim", "Total:")} ${stats.tokens.total.toLocaleString()}\n`;

    if (stats.cost > 0) {
      info += `\n${theme.bold("Cost")}\n`;
      info += `${theme.fg("dim", "Total:")} ${stats.cost.toFixed(4)}`;
    }

    this.ctx.chatContainer.addChild(new Spacer(1));
    this.ctx.chatContainer.addChild(new Text(info, 1, 0));
    this.ctx.ui.requestRender();
  }

  handleChangelogCommand(): void {
    const changelogPath = getChangelogPath();
    const allEntries = parseChangelog(changelogPath);

    const changelogMarkdown =
      allEntries.length > 0
        ? allEntries
            .reverse()
            .map((e) => e.content)
            .join("\n\n")
        : "No changelog entries found.";

    this.ctx.chatContainer.addChild(new Spacer(1));
    this.ctx.chatContainer.addChild(new DynamicBorder());
    this.ctx.chatContainer.addChild(
      new Text(theme.bold(theme.fg("accent", "What's New")), 1, 0),
    );
    this.ctx.chatContainer.addChild(new Spacer(1));
    this.ctx.chatContainer.addChild(
      new Markdown(
        changelogMarkdown,
        1,
        1,
        this.ctx.getMarkdownThemeWithSettings(),
      ),
    );
    this.ctx.chatContainer.addChild(new DynamicBorder());
    this.ctx.ui.requestRender();
  }

  /**
   * Capitalize keybinding for display (e.g., "ctrl+c" -> "Ctrl+C").
   */
  private capitalizeKey(key: string): string {
    return key
      .split("/")
      .map((k) =>
        k
          .split("+")
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join("+"),
      )
      .join("/");
  }

  /**
   * Get capitalized display string for an app keybinding action.
   */
  getAppKeyDisplay(action: AppAction): string {
    return this.capitalizeKey(appKey(this.ctx.keybindings, action));
  }

  /**
   * Get capitalized display string for an editor keybinding action.
   */
  private getEditorKeyDisplay(action: EditorAction): string {
    return this.capitalizeKey(editorKey(action));
  }

  handleHotkeysCommand(): void {
    // Navigation keybindings
    const cursorWordLeft = this.getEditorKeyDisplay("cursorWordLeft");
    const cursorWordRight = this.getEditorKeyDisplay("cursorWordRight");
    const cursorLineStart = this.getEditorKeyDisplay("cursorLineStart");
    const cursorLineEnd = this.getEditorKeyDisplay("cursorLineEnd");
    const jumpForward = this.getEditorKeyDisplay("jumpForward");
    const jumpBackward = this.getEditorKeyDisplay("jumpBackward");
    const pageUp = this.getEditorKeyDisplay("pageUp");
    const pageDown = this.getEditorKeyDisplay("pageDown");

    // Editing keybindings
    const submit = this.getEditorKeyDisplay("submit");
    const newLine = this.getEditorKeyDisplay("newLine");
    const deleteWordBackward = this.getEditorKeyDisplay("deleteWordBackward");
    const deleteWordForward = this.getEditorKeyDisplay("deleteWordForward");
    const deleteToLineStart = this.getEditorKeyDisplay("deleteToLineStart");
    const deleteToLineEnd = this.getEditorKeyDisplay("deleteToLineEnd");
    const yank = this.getEditorKeyDisplay("yank");
    const yankPop = this.getEditorKeyDisplay("yankPop");
    const undo = this.getEditorKeyDisplay("undo");
    const tab = this.getEditorKeyDisplay("tab");

    // App keybindings
    const interrupt = this.getAppKeyDisplay("interrupt");
    const showResources = this.getAppKeyDisplay("showResources");
    const clear = this.getAppKeyDisplay("clear");
    const exit = this.getAppKeyDisplay("exit");
    const suspend = this.getAppKeyDisplay("suspend");
    const cycleThinkingLevel = this.getAppKeyDisplay("cycleThinkingLevel");
    const cycleModelForward = this.getAppKeyDisplay("cycleModelForward");
    const selectModel = this.getAppKeyDisplay("selectModel");
    const selectProviderThenModel = this.getAppKeyDisplay(
      "selectProviderThenModel",
    );
    const expandTools = this.getAppKeyDisplay("expandTools");
    const toggleThinking = this.getAppKeyDisplay("toggleThinking");
    const externalEditor = this.getAppKeyDisplay("externalEditor");
    const followUp = this.getAppKeyDisplay("followUp");
    const dequeue = this.getAppKeyDisplay("dequeue");

    let hotkeys = `
**Navigation**
| Key | Action |
|-----|--------|
| \`Arrow keys\` | Move cursor / browse history (Up when empty) |
| \`${cursorWordLeft}\` / \`${cursorWordRight}\` | Move by word |
| \`${cursorLineStart}\` | Start of line |
| \`${cursorLineEnd}\` | End of line |
| \`${jumpForward}\` | Jump forward to character |
| \`${jumpBackward}\` | Jump backward to character |
| \`${pageUp}\` / \`${pageDown}\` | Scroll by page |

**Editing**
| Key | Action |
|-----|--------|
| \`${submit}\` | Send message |
| \`${newLine}\` | New line${process.platform === "win32" ? " (Ctrl+Enter on Windows Terminal)" : ""} |
| \`${deleteWordBackward}\` | Delete word backwards |
| \`${deleteWordForward}\` | Delete word forwards |
| \`${deleteToLineStart}\` | Delete to start of line |
| \`${deleteToLineEnd}\` | Delete to end of line |
| \`${yank}\` | Paste the most-recently-deleted text |
| \`${yankPop}\` | Cycle through the deleted text after pasting |
| \`${undo}\` | Undo |

**Other**
| Key | Action |
|-----|--------|
| \`${tab}\` | Path completion / accept autocomplete |
| \`${interrupt}\` | Cancel autocomplete / abort streaming |
| \`${showResources}\` | Show context/skills/extensions |
| \`${clear}\` | Clear editor (first) / exit (second) |
| \`${exit}\` | Exit (when editor is empty) |
| \`${suspend}\` | Suspend to background |
| \`${cycleThinkingLevel}\` | Cycle thinking level |
| \`${cycleModelForward}\` | Cycle models |
| \`${selectModel}\` | Open model selector |
| \`${selectProviderThenModel}\` | Select provider then model |
| \`${expandTools}\` | Toggle tool output expansion |
| \`${toggleThinking}\` | Toggle thinking block visibility |
| \`${externalEditor}\` | Edit message in external editor |
| \`${followUp}\` | Queue follow-up message |
| \`${dequeue}\` | Restore queued messages |
| \`Ctrl+V\` | Paste image from clipboard |
| \`/\` | Slash commands |
| \`!\` | Run bash command |
| \`!!\` | Run bash command (excluded from context) |
`;

    // Add extension-registered shortcuts
    const extensionRunner = this.ctx.session.extensionRunner;
    if (extensionRunner) {
      const shortcuts = extensionRunner.getShortcuts(
        this.ctx.keybindings.getEffectiveConfig(),
      );
      if (shortcuts.size > 0) {
        hotkeys += `
**Extensions**
| Key | Action |
|-----|--------|
`;
        for (const [key, shortcut] of shortcuts) {
          const description = shortcut.description ?? shortcut.extensionPath;
          const keyDisplay = key.replace(/\b\w/g, (c) => c.toUpperCase());
          hotkeys += `| \`${keyDisplay}\` | ${description} |\n`;
        }
      }
    }

    this.ctx.chatContainer.addChild(new Spacer(1));
    this.ctx.chatContainer.addChild(new DynamicBorder());
    this.ctx.chatContainer.addChild(
      new Text(theme.bold(theme.fg("accent", "Keyboard Shortcuts")), 1, 0),
    );
    this.ctx.chatContainer.addChild(new Spacer(1));
    this.ctx.chatContainer.addChild(
      new Markdown(hotkeys.trim(), 1, 1, this.ctx.getMarkdownThemeWithSettings()),
    );
    this.ctx.chatContainer.addChild(new DynamicBorder());
    this.ctx.ui.requestRender();
  }

  handleRenderDebugCommand(): void {
    const width = this.ctx.ui.terminal.columns;
    const height = this.ctx.ui.terminal.rows;
    const allLines = this.ctx.ui.render(width);

    const debugLogPath = getDebugLogPath();
    const debugData = [
      `Debug output at ${new Date().toISOString()}`,
      `Terminal: ${width}x${height}`,
      `Total lines: ${allLines.length}`,
      "",
      "=== All rendered lines with visible widths ===",
      ...allLines.map((line, idx) => {
        const vw = visibleWidth(line);
        const escaped = JSON.stringify(line);
        return `[${idx}] (w=${vw}) ${escaped}`;
      }),
      "",
      "=== Agent messages (JSONL) ===",
      ...this.ctx.session.messages.map((msg) => JSON.stringify(msg)),
      "",
    ].join("\n");

    fs.mkdirSync(path.dirname(debugLogPath), { recursive: true });
    fs.writeFileSync(debugLogPath, debugData);

    this.ctx.chatContainer.addChild(new Spacer(1));
    this.ctx.chatContainer.addChild(
      new Text(
        `${theme.fg("accent", "✓ Debug log written")}\n${theme.fg("muted", debugLogPath)}`,
        1,
        1,
      ),
    );
    this.ctx.ui.requestRender();
  }

  handleArminSaysHi(): void {
    this.ctx.chatContainer.addChild(new Spacer(1));
    this.ctx.chatContainer.addChild(new ArminComponent(this.ctx.ui));
    this.ctx.ui.requestRender();
  }

  handleShowResourcesCommand(): void {
    const runner = this.ctx.session.extensionRunner;
    this.ctx.showLoadedResources({
      extensionPaths: runner?.getExtensionPaths() ?? [],
      force: true,
      showDiagnosticsWhenQuiet: true,
    });
    this.ctx.ui.requestRender();
  }

  handleDaxnuts(): void {
    this.ctx.chatContainer.addChild(new Spacer(1));
    this.ctx.chatContainer.addChild(new DaxnutsComponent(this.ctx.ui));
    this.ctx.ui.requestRender();
  }
}
