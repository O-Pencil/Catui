/**
 * [WHO]: Provides ChatRendererController + ChatRendererContext — transcript rendering:
 *        message→component mapping (addMessageToChat), session-context replay
 *        (renderSessionContext), initial transcript + welcome banner (renderInitialMessages),
 *        chat rebuild with optimistic-user dedupe (rebuildChatFromMessages), getUserMessageText
 * [FROM]: Depends on injected host capability closures + @catui/tui + message components;
 *         no InteractiveMode reference. Internal cross-calls go through ctx callbacks so
 *         host-side method patching (partial-mode tests) keeps intercepting them.
 * [TO]: Consumed by modes/interactive/interactive-mode.ts (held lazily as `this.chatRenderer`
 *       behind thin delegators: addMessageToChat / renderInitialMessages / rebuildChatFromMessages /
 *       getUserMessageText)
 * [HERE]: modes/interactive/controllers/chat-renderer.ts — P7 C-3c (extracted from
 *         InteractiveMode message-rendering block; behavior-preserving move)
 */
import type { AgentMessage } from "@catui/agent-core";
import type { Message } from "@catui/ai/types";
import {
  Spacer,
  Text,
  type CachedContainer,
  type EditorComponent,
  type MarkdownTheme,
  type TUI,
} from "@catui/tui";
import { APP_NAME } from "../../../config.js";
import { type AgentSession, parseSkillBlock } from "../../../core/runtime/agent-session.js";
import type { SessionContext, SessionManager } from "../../../core/session/session-manager.js";
import type { SettingsManager } from "../../../core/platform/config/settings-manager.js";
import type { AppAction } from "../../../core/platform/keybindings.js";
import type { ToolDefinition } from "../../../core/extensions-host/types.js";
import type { TruncationResult } from "../../../core/tools/truncate.js";
import { consumeMatchingVisibleUserQuery } from "../user-query-dedupe.js";
import { AssistantMessageComponent } from "../components/assistant-message.js";
import { BashExecutionComponent } from "../components/bash-execution.js";
import { BranchSummaryMessageComponent } from "../components/branch-summary-message.js";
import { CompactionSummaryMessageComponent } from "../components/compaction-summary-message.js";
import { CustomMessageComponent } from "../components/custom-message.js";
import { SkillInvocationMessageComponent } from "../components/skill-invocation-message.js";
import { ToolExecutionComponent } from "../components/tool-execution.js";
import { UserMessageComponent } from "../components/user-message.js";
import type { InteractiveState } from "../state/interactive-state.js";
import { theme } from "../theme/theme.js";

/** Host capabilities needed by transcript rendering. All members resolve dynamically. */
export interface ChatRendererContext {
  readonly session: AgentSession;
  readonly sessionManager: SessionManager;
  readonly settingsManager: SettingsManager;
  readonly state: InteractiveState;
  readonly ui: TUI;
  readonly chatContainer: CachedContainer;
  readonly footer: { invalidate(): void };
  readonly editor: EditorComponent;
  readonly version: string;

  getMarkdownThemeWithSettings(): MarkdownTheme;
  getRegisteredToolDefinition(toolName: string): ToolDefinition | undefined;
  updateEditorBorderColor(): void;
  stopWelcomeBannerTimer(): void;
  showStatus(message: string): void;
  clearStatusTimers(): void;
  getAppKeyDisplay(action: AppAction): string;
  addMessageToChat(message: AgentMessage, options?: { populateHistory?: boolean }): void;
  getUserMessageText(message: Message): string;
}

export class ChatRendererController {
  constructor(private readonly ctx: ChatRendererContext) {}

  /** Extract text content from a user message */
  getUserMessageText(message: Message): string {
    if (message.role !== "user") return "";
    const textBlocks =
      typeof message.content === "string"
        ? [{ type: "text", text: message.content }]
        : message.content.filter((c: { type: string }) => c.type === "text");
    return textBlocks.map((c) => (c as { text: string }).text).join("");
  }

  addMessageToChat(
    message: AgentMessage,
    options?: { populateHistory?: boolean },
  ): void {
    switch (message.role) {
      case "bashExecution": {
        const component = new BashExecutionComponent(
          message.command,
          this.ctx.ui,
          message.excludeFromContext,
        );
        if (message.output) {
          component.appendOutput(message.output);
        }
        component.setComplete(
          message.exitCode,
          message.cancelled,
          message.truncated
            ? ({ truncated: true } as TruncationResult)
            : undefined,
          message.fullOutputPath,
        );
        this.ctx.chatContainer.addChild(component);
        break;
      }
      case "custom": {
        if (message.display) {
          const details =
            typeof message.details === "object" && message.details !== null
              ? (message.details as { streamKey?: string; replace?: boolean })
              : undefined;
          if (details?.replace && details.streamKey) {
            const existing = this.ctx.state.customStreamComponents.get(details.streamKey);
            if (existing) {
              existing.updateMessage(message);
              this.ctx.ui.requestRender();
              break;
            }
          }
          const renderer = this.ctx.session.extensionRunner?.getMessageRenderer(
            message.customType,
          );
          const component = new CustomMessageComponent(
            message,
            renderer,
            this.ctx.getMarkdownThemeWithSettings(),
          );
          component.setExpanded(this.ctx.state.toolOutputExpanded);
          this.ctx.chatContainer.addChild(component);
          if (details?.streamKey) {
            this.ctx.state.customStreamComponents.set(details.streamKey, component);
          }
        }
        break;
      }
      case "compactionSummary": {
        this.ctx.chatContainer.addChild(new Spacer(1));
        const component = new CompactionSummaryMessageComponent(
          message,
          this.ctx.getMarkdownThemeWithSettings(),
        );
        component.setExpanded(this.ctx.state.toolOutputExpanded);
        this.ctx.chatContainer.addChild(component);
        break;
      }
      case "branchSummary": {
        this.ctx.chatContainer.addChild(new Spacer(1));
        const component = new BranchSummaryMessageComponent(
          message,
          this.ctx.getMarkdownThemeWithSettings(),
        );
        component.setExpanded(this.ctx.state.toolOutputExpanded);
        this.ctx.chatContainer.addChild(component);
        break;
      }
      case "user": {
        const textContent = this.ctx.getUserMessageText(message);
        if (textContent) {
          const skillBlock = parseSkillBlock(textContent);
          if (skillBlock) {
            // Render skill block (collapsible)
            this.ctx.chatContainer.addChild(new Spacer(1));
            const component = new SkillInvocationMessageComponent(
              skillBlock,
              this.ctx.getMarkdownThemeWithSettings(),
            );
            component.setExpanded(this.ctx.state.toolOutputExpanded);
            this.ctx.chatContainer.addChild(component);
            // Render user message separately if present
            if (skillBlock.userMessage) {
              const userComponent = new UserMessageComponent(
                skillBlock.userMessage,
                this.ctx.getMarkdownThemeWithSettings(),
              );
              this.ctx.chatContainer.addChild(userComponent);
            }
          } else {
            const userComponent = new UserMessageComponent(
              textContent,
              this.ctx.getMarkdownThemeWithSettings(),
            );
            this.ctx.chatContainer.addChild(userComponent);
          }
          if (options?.populateHistory) {
            this.ctx.editor.addToHistory?.(textContent);
          }
        }
        break;
      }
      case "assistant": {
        const assistantComponent = new AssistantMessageComponent(
          message,
          this.ctx.state.hideThinkingBlock,
          this.ctx.getMarkdownThemeWithSettings(),
        );
        this.ctx.chatContainer.addChild(assistantComponent);
        break;
      }
      case "toolResult": {
        // Tool results are rendered inline with tool calls, handled separately
        break;
      }
      default: {
        const _exhaustive: never = message;
      }
    }
  }

  /**
   * Render session context to chat. Used for initial load and rebuild after compaction.
   * @param sessionContext Session context to render
   * @param options.updateFooter Update footer state
   * @param options.populateHistory Add user messages to editor history
   */
  private renderSessionContext(
    sessionContext: SessionContext,
    options: {
      updateFooter?: boolean;
      populateHistory?: boolean;
      requestRender?: boolean;
    } = {},
  ): void {
    this.ctx.state.pendingTools.clear();
    this.ctx.state.customStreamComponents.clear();

    if (options.updateFooter) {
      this.ctx.footer.invalidate();
      this.ctx.updateEditorBorderColor();
    }

    for (const message of sessionContext.messages) {
      // Assistant messages need special handling for tool calls
      if (message.role === "assistant") {
        this.ctx.addMessageToChat(message);
        // Render tool call components
        for (const content of message.content) {
          if (content.type === "toolCall") {
            const component = new ToolExecutionComponent(
              content.name,
              content.arguments,
              { showImages: this.ctx.settingsManager.getShowImages() },
              this.ctx.getRegisteredToolDefinition(content.name),
              this.ctx.ui,
            );
            component.setExpanded(this.ctx.state.toolOutputExpanded);
            this.ctx.chatContainer.addChild(component);

            if (
              message.stopReason === "aborted" ||
              message.stopReason === "error"
            ) {
              let errorMessage: string;
              if (message.stopReason === "aborted") {
                const retryAttempt = this.ctx.session.retryAttempt;
                errorMessage =
                  retryAttempt > 0
                    ? `Aborted after ${retryAttempt} retry attempt${retryAttempt > 1 ? "s" : ""}`
                    : "Operation aborted";
              } else {
                errorMessage = message.errorMessage || "Error";
              }
              component.updateResult({
                content: [{ type: "text", text: errorMessage }],
                isError: true,
              });
            } else {
              this.ctx.state.pendingTools.set(content.id, component);
            }
          }
        }
      } else if (message.role === "toolResult") {
        // Match tool results to pending tool components
        const component = this.ctx.state.pendingTools.get(message.toolCallId);
        if (component) {
          component.updateResult(message);
          this.ctx.state.pendingTools.delete(message.toolCallId);
        }
      } else if (message.role === "custom") {
        // Custom messages are rendered in real-time via the message_start event
        // (stream-render-controller). Skip them here to avoid duplicates during
        // renderInitialMessages / session rebuilds.
      } else {
        // All other messages use standard rendering
        this.ctx.addMessageToChat(message, options);
      }
    }

    this.ctx.state.pendingTools.clear();
    if (options.requestRender !== false) {
      this.ctx.ui.requestRender();
    }
  }

  renderInitialMessages(options: { requestRender?: boolean } = {}): void {
    this.ctx.stopWelcomeBannerTimer();

    // Get aligned messages and entries from session context
    const context = this.ctx.sessionManager.buildSessionContext();
    this.renderSessionContext(context, {
      updateFooter: true,
      populateHistory: true,
      requestRender: options.requestRender,
    });

    // Show welcome when session has no messages
    if (context.messages.length === 0) {
      this.ctx.chatContainer.addChild(new Spacer(1));
      if (APP_NAME === "catui" || APP_NAME === "catui") {
        const cwd = this.ctx.session.cwd;
        const model = this.ctx.session.model;
        const modelLine =
          model?.name ??
          (model?.provider ? `${model.provider}` : "DashScope · Ollama");
        const buildAsciiLines = (_frame: number) => {
          const lines = [
            "                               ,",
            "              ,-.       _,---._ __  / \\",
            "             /  )    .-'       `./ /   \\",
            "            (  (   ,'            `/    /|",
            "             \\  `\"-             \\'\\   / |",
            "              `.              ,  \\ \\ /  |",
            "               /`.          ,'-`----Y   |",
            "              (            ;        |   '",
            "              |  ,-.    ,-'         |  /",
            "              |  | (   |CATUI@2026  | /",
            "              )  |  \\  `.___________|/",
            "              `--'   `--'",
          ];
          const width = Math.max(...lines.map((line) => line.length));
          return lines.map((line) => line.padEnd(width));
        };
        const renderAscii = (frame: number) =>
          buildAsciiLines(frame)
            .map((line) =>
              theme.fg(
                "accent",
                line.slice(0, Math.max(1, this.ctx.ui.terminal.columns || 80)),
              ),
            )
            .join("\n");
        const titleLine = theme.bold(
          theme.fg("accent", `catui-agent v${this.ctx.version}`),
        );
        const subtitleLine = theme.fg("dim", modelLine);
        const cwdLine = theme.fg("dim", cwd);
        const hintLine = theme.fg("dim", "  /model to switch model");
        const showResourcesKey = this.ctx.getAppKeyDisplay("showResources");
        const resourcesHint = this.ctx.settingsManager.getQuietStartup()
          ? theme.fg(
              "dim",
              `  ${showResourcesKey} to show context/skills/extensions`,
            )
          : "";
        const sep = theme.fg(
          "borderMuted",
          "─".repeat(Math.max(40, this.ctx.ui.terminal.columns || 80)),
        );
        const tryLine = theme.fg(
          "accent",
          '❯ Try "refactor <filepath>" or type below',
        );
        const banner = [
          renderAscii(0),
          "",
          `  ${titleLine}`,
          `  ${subtitleLine}`,
          `  ${cwdLine}`,
          "",
          hintLine,
          ...(resourcesHint ? ["", resourcesHint] : []),
          "",
          sep,
          tryLine,
        ].join("\n");
        const bannerText = new Text(banner, 0, 0);
        this.ctx.chatContainer.addChild(bannerText);
        let frame = 0;
        this.ctx.state.welcomeBannerTimer = setInterval(() => {
          frame += 1;
          bannerText.setText(
            [
              renderAscii(frame),
              "",
              `  ${titleLine}`,
              `  ${subtitleLine}`,
              `  ${cwdLine}`,
              "",
              hintLine,
              ...(resourcesHint ? ["", resourcesHint] : []),
              "",
              sep,
              tryLine,
            ].join("\n"),
          );
          this.ctx.ui.requestRender();
          if (frame >= 16) {
            this.ctx.stopWelcomeBannerTimer();
          }
        }, 220);
      } else {
        const boxName = APP_NAME.padEnd(14).slice(0, 14);
        const asciiArt = [
          "      ✎",
          "  +---------------+",
          `  |  ${boxName}  |`,
          "  +---------------+",
        ].join("\n");
        const tagline = `  ${theme.fg("dim", "AI coding agent. Type below to start.")}`;
        this.ctx.chatContainer.addChild(
          new Text(`${theme.fg("accent", asciiArt)}\n${tagline}`, 0, 0),
        );
      }
      this.ctx.chatContainer.addChild(new Spacer(1));
    }

    // Show compaction info if session was compacted
    const allEntries = this.ctx.sessionManager.getEntries();
    const compactionCount = allEntries.filter(
      (e) => e.type === "compaction",
    ).length;
    if (compactionCount > 0) {
      const times =
        compactionCount === 1 ? "1 time" : `${compactionCount} times`;
      this.ctx.showStatus(`Session compacted ${times}`);
    }

    // Force full re-render to reset viewport state after rebuilding chat.
    // Without this, maxLinesRendered retains the old value and the viewport
    // may point past the actual content end after compaction or session switch.
    if (options.requestRender !== false) {
      this.ctx.ui.requestRender(true);
    }
  }

  rebuildChatFromMessages(): void {
    this.ctx.clearStatusTimers();
    this.ctx.chatContainer.clear();
    const context = this.ctx.sessionManager.buildSessionContext();
    this.renderSessionContext(context, { requestRender: false });
    const renderedUserTexts = context.messages
      .filter((message) => message.role === "user")
      .map((message) => this.ctx.getUserMessageText(message));
    // Re-add optimistic user messages not yet persisted to session.
    // Cleared by chatContainer.clear() above but absent from buildSessionContext().
    for (const text of renderedUserTexts) {
      consumeMatchingVisibleUserQuery(this.ctx.state.optimisticUserMessages, text, {
        consumeOldestOnMismatch: true,
      });
    }
    for (const msg of this.ctx.state.optimisticUserMessages) {
      this.ctx.addMessageToChat({
        role: "user",
        content: [{ type: "text", text: msg.text }],
        timestamp: Date.now(),
      } as AgentMessage);
    }
    // Force full re-render to reset maxLinesRendered, which tracks the
    // terminal working area. After a clear+rebuild, content may be shorter
    // than the previous working area, causing the viewport to point past
    // the actual content end.
    this.ctx.ui.requestRender(true);
  }
}
