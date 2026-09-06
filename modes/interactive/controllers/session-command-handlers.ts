/**
 * [WHO]: Provides SessionCommandHandlersController + SessionCommandHandlersContext — interactive
 *        command bodies that mutate session/UI state (/reload, /clear, /compact, !bash, extension check)
 * [FROM]: Depends on injected host capability closures + @catui/tui components; no InteractiveMode reference
 * [TO]: Consumed by modes/interactive/interactive-mode.ts (held as `this.sessionCommands`; wired into
 *       SlashDispatcherController commands port, input-submit bash port, compaction queue checks)
 * [HERE]: modes/interactive/controllers/session-command-handlers.ts — P7 C-3a slice 1/4 (extracted from
 *         InteractiveMode command-handler block; behavior-preserving move)
 */
import type { AgentMessage } from "@catui/agent-core";
import { Spacer, Text, type CachedContainer, type Component, type Container, type EditorComponent, type TUI } from "@catui/tui";
import type { AgentSession } from "../../../core/runtime/agent-session.js";
import type { CompactionResult } from "../../../core/session/compaction/index.js";
import type { SessionManager } from "../../../core/session/session-manager.js";
import type { SettingsManager } from "../../../core/platform/config/settings-manager.js";
import type { ExtensionRunner } from "../../../core/extensions-host/index.js";
import { createCompactionSummaryMessage } from "../../../core/messages.js";
import type { TruncationResult } from "../../../core/tools/truncate.js";
import type { KeybindingsManager } from "../../../core/platform/keybindings.js";
import { appKey } from "../components/keybinding-hints.js";
import { BashExecutionComponent } from "../components/bash-execution.js";
import { BorderedLoader } from "../components/bordered-loader.js";
import { CatuiLoader } from "../components/catui-loader.js";
import type { CustomEditor } from "../components/custom-editor.js";
import type { FooterComponent } from "../components/footer.js";
import type { ImagePipelineController } from "./image-pipeline-controller.js";
import type { InteractiveState } from "../state/interactive-state.js";
import { setRegisteredThemes, setTheme, theme } from "../theme/theme.js";

/** Host capabilities needed by the session-mutating command handlers. */
export interface SessionCommandHandlersContext {
  /** Live agent session (streaming/compacting checks, reload, bash execution). */
  readonly session: AgentSession;
  readonly sessionManager: SessionManager;
  readonly settingsManager: SettingsManager;
  /** Consolidated render/turn UI state (loading animation, queues, streaming slots). */
  readonly state: InteractiveState;
  readonly ui: TUI;
  /** Currently mounted editor component (may be swapped by the editor adapter). */
  readonly editor: EditorComponent;
  readonly defaultEditor: CustomEditor;
  readonly editorContainer: Container;
  readonly chatContainer: CachedContainer;
  readonly pendingMessagesContainer: Container;
  readonly statusContainer: Container;
  readonly footer: FooterComponent;
  readonly keybindings: KeybindingsManager;
  readonly imagePipeline: ImagePipelineController;
  /** fd executable path, resolved lazily after construction. */
  readonly fdPath: string | undefined;
  /** Pending bash components (host reassigns the array on flush — always read through the getter). */
  readonly pendingBashComponents: BashExecutionComponent[];
  /** Currently mounted bash execution component (created/consumed by !bash handling). */
  bashComponent: BashExecutionComponent | undefined;

  showStatus(message: string): void;
  showError(errorMessage: string): void;
  showWarning(warningMessage: string): void;
  resetExtensionUI(): void;
  remountEditorShell(): void;
  setupAutocomplete(fdPath: string | undefined): void;
  setupExtensionShortcuts(extensionRunner: ExtensionRunner): void;
  rebuildChatFromMessages(): void;
  showLoadedResources(options?: {
    extensionPaths?: string[];
    force?: boolean;
    showDiagnosticsWhenQuiet?: boolean;
  }): void;
  addMessageToChat(message: AgentMessage, options?: { populateHistory?: boolean }): void;
  clearStatusTimers(): void;
  flushCompactionQueue(options?: { willRetry?: boolean }): Promise<void>;
}

export class SessionCommandHandlersController {
  constructor(private readonly ctx: SessionCommandHandlersContext) {}

  isExtensionCommand(text: string): boolean {
    if (!text.startsWith("/")) return false;

    const extensionRunner = this.ctx.session.extensionRunner;
    if (!extensionRunner) return false;

    const spaceIndex = text.indexOf(" ");
    const commandName =
      spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
    return !!extensionRunner.getCommand(commandName);
  }

  async handleReloadCommand(): Promise<void> {
    if (this.ctx.session.isStreaming) {
      this.ctx.showWarning(
        "Wait for the current response to finish before reloading.",
      );
      return;
    }
    if (this.ctx.session.isCompacting) {
      this.ctx.showWarning("Wait for compaction to finish before reloading.");
      return;
    }

    this.ctx.resetExtensionUI();

    const loader = new BorderedLoader(
      this.ctx.ui,
      theme,
      "Reloading extensions, skills, prompts, themes...",
      {
        cancellable: false,
      },
    );
    const previousEditor = this.ctx.editor;
    this.ctx.editorContainer.clear();
    this.ctx.editorContainer.addChild(loader);
    this.ctx.ui.setFocus(loader);
    this.ctx.ui.requestRender();

    const dismissLoader = (_editor: Component) => {
      loader.dispose();
      this.ctx.remountEditorShell();
      this.ctx.ui.setFocus(this.ctx.editor);
      this.ctx.ui.requestRender();
    };

    try {
      await this.ctx.session.reload();
      setRegisteredThemes(this.ctx.session.resourceLoader.getThemes().themes);
      this.ctx.state.hideThinkingBlock = this.ctx.settingsManager.getHideThinkingBlock();
      const themeName = this.ctx.settingsManager.getTheme();
      const themeResult = themeName
        ? setTheme(themeName, true)
        : { success: true };
      if (!themeResult.success) {
        this.ctx.showError(
          `Failed to load theme "${themeName}": ${themeResult.error}\nFell back to dark theme.`,
        );
      }
      const editorPaddingX = this.ctx.settingsManager.getEditorPaddingX();
      const autocompleteMaxVisible =
        this.ctx.settingsManager.getAutocompleteMaxVisible();
      this.ctx.defaultEditor.setPaddingX(editorPaddingX);
      this.ctx.defaultEditor.setAutocompleteMaxVisible(autocompleteMaxVisible);
      if (this.ctx.editor !== this.ctx.defaultEditor) {
        this.ctx.editor.setPaddingX?.(editorPaddingX);
        this.ctx.editor.setAutocompleteMaxVisible?.(autocompleteMaxVisible);
      }
      this.ctx.ui.setShowHardwareCursor(
        this.ctx.settingsManager.getShowHardwareCursor(),
      );
      this.ctx.ui.setClearOnShrink(this.ctx.settingsManager.getClearOnShrink());
      this.ctx.setupAutocomplete(this.ctx.fdPath);
      const runner = this.ctx.session.extensionRunner;
      if (runner) {
        this.ctx.setupExtensionShortcuts(runner);
      }
      this.ctx.rebuildChatFromMessages();
      dismissLoader(this.ctx.editor as Component);
      this.ctx.showLoadedResources({
        extensionPaths: runner?.getExtensionPaths() ?? [],
        force: false,
        showDiagnosticsWhenQuiet: true,
      });
      const modelsJsonError = this.ctx.session.modelRegistry.getError();
      if (modelsJsonError) {
        this.ctx.showError(`models.json error: ${modelsJsonError}`);
      }
      this.ctx.showStatus("Reloaded extensions, skills, prompts, themes");
    } catch (error) {
      dismissLoader(previousEditor as Component);
      this.ctx.showError(
        `Reload failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async handleClearCommand(): Promise<void> {
    // Stop loading animation
    if (this.ctx.state.loadingAnimation) {
      (this.ctx.state.loadingAnimation as CatuiLoader).stop();
      this.ctx.state.loadingAnimation = undefined;
    }
    this.ctx.statusContainer.clear();

    // New session via session (emits extension session events)
    await this.ctx.session.newSession();

    // Clear UI state
    this.ctx.clearStatusTimers();
    this.ctx.chatContainer.clear();
    this.ctx.pendingMessagesContainer.clear();
    this.ctx.state.compactionQueuedMessages = [];
    this.ctx.state.streamingComponent = undefined;
    this.ctx.state.streamingMessage = undefined;
    this.ctx.state.pendingTools.clear();
    this.ctx.imagePipeline.clearAttachments();

    this.ctx.chatContainer.addChild(new Spacer(1));
    this.ctx.chatContainer.addChild(
      new Text(`${theme.fg("accent", "✓ New session started")}`, 1, 1),
    );
    this.ctx.ui.requestRender();
  }

  async handleBashCommand(
    command: string,
    excludeFromContext = false,
  ): Promise<void> {
    const extensionRunner = this.ctx.session.extensionRunner;

    // Emit user_bash event to let extensions intercept
    const eventResult = extensionRunner
      ? await extensionRunner.emitUserBash({
          type: "user_bash",
          command,
          excludeFromContext,
          cwd: this.ctx.session.cwd,
        })
      : undefined;

    // If extension returned a full result, use it directly
    if (eventResult?.result) {
      const result = eventResult.result;

      // Create UI component for display
      this.ctx.bashComponent = new BashExecutionComponent(
        command,
        this.ctx.ui,
        excludeFromContext,
      );
      if (this.ctx.session.isStreaming) {
        this.ctx.pendingMessagesContainer.addChild(this.ctx.bashComponent);
        this.ctx.pendingBashComponents.push(this.ctx.bashComponent);
      } else {
        this.ctx.chatContainer.addChild(this.ctx.bashComponent);
      }

      // Show output and complete
      if (result.output) {
        this.ctx.bashComponent.appendOutput(result.output);
      }
      this.ctx.bashComponent.setComplete(
        result.exitCode,
        result.cancelled,
        result.truncated
          ? ({ truncated: true, content: result.output } as TruncationResult)
          : undefined,
        result.fullOutputPath,
      );

      // Record the result in session
      this.ctx.session.recordBashResult(command, result, { excludeFromContext });
      this.ctx.bashComponent = undefined;
      this.ctx.ui.requestRender();
      return;
    }

    // Normal execution path (possibly with custom operations)
    const isDeferred = this.ctx.session.isStreaming;
    this.ctx.bashComponent = new BashExecutionComponent(
      command,
      this.ctx.ui,
      excludeFromContext,
    );

    if (isDeferred) {
      // Show in pending area when agent is streaming
      this.ctx.pendingMessagesContainer.addChild(this.ctx.bashComponent);
      this.ctx.pendingBashComponents.push(this.ctx.bashComponent);
    } else {
      // Show in chat immediately when agent is idle
      this.ctx.chatContainer.addChild(this.ctx.bashComponent);
    }
    this.ctx.ui.requestRender();

    try {
      const result = await this.ctx.session.executeBash(
        command,
        (chunk) => {
          if (this.ctx.bashComponent) {
            this.ctx.bashComponent.appendOutput(chunk);
            this.ctx.ui.requestRender();
          }
        },
        { excludeFromContext, operations: eventResult?.operations },
      );

      if (this.ctx.bashComponent) {
        this.ctx.bashComponent.setComplete(
          result.exitCode,
          result.cancelled,
          result.truncated
            ? ({ truncated: true, content: result.output } as TruncationResult)
            : undefined,
          result.fullOutputPath,
        );
      }
    } catch (error) {
      if (this.ctx.bashComponent) {
        this.ctx.bashComponent.setComplete(undefined, false);
      }
      this.ctx.showError(
        `Bash command failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }

    this.ctx.bashComponent = undefined;
    this.ctx.ui.requestRender();
  }

  async handleCompactCommand(
    customInstructions?: string,
  ): Promise<void> {
    const entries = this.ctx.sessionManager.getEntries();
    const messageCount = entries.filter((e) => e.type === "message").length;

    if (messageCount < 2) {
      this.ctx.showWarning("Nothing to compact (no messages yet)");
      return;
    }

    await this.executeCompaction(customInstructions, false);
  }

  private async executeCompaction(
    customInstructions?: string,
    isAuto = false,
  ): Promise<CompactionResult | undefined> {
    // Stop loading animation
    if (this.ctx.state.loadingAnimation) {
      (this.ctx.state.loadingAnimation as CatuiLoader).stop();
      this.ctx.state.loadingAnimation = undefined;
    }
    this.ctx.statusContainer.clear();

    // Set up escape handler during compaction
    const originalOnEscape = this.ctx.defaultEditor.onEscape;
    this.ctx.defaultEditor.onEscape = () => {
      this.ctx.session.abortCompaction();
    };

    // Show compacting status
    this.ctx.chatContainer.addChild(new Spacer(1));
    const cancelHint = `(${appKey(this.ctx.keybindings, "interrupt")} to cancel)`;
    const label = isAuto
      ? `Auto-compacting context... ${cancelHint}`
      : `Compacting context... ${cancelHint}`;
    const compactingLoader = new CatuiLoader(this.ctx.ui, theme, label);
    this.ctx.statusContainer.addChild(compactingLoader);
    this.ctx.ui.requestRender();

    let result: CompactionResult | undefined;

    try {
      result = await this.ctx.session.compact(customInstructions);

      // Rebuild UI
      this.ctx.rebuildChatFromMessages();

      // Add compaction component at bottom so user sees it without scrolling
      const msg = createCompactionSummaryMessage(
        result.summary,
        result.tokensBefore,
        new Date().toISOString(),
      );
      this.ctx.addMessageToChat(msg);

      this.ctx.footer.invalidate();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message === "Compaction cancelled" ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        this.ctx.showError("Compaction cancelled");
      } else {
        this.ctx.showError(`Compaction failed: ${message}`);
      }
    } finally {
      (compactingLoader as CatuiLoader).stop();
      this.ctx.statusContainer.clear();
      this.ctx.defaultEditor.onEscape = originalOnEscape;
    }
    void this.ctx.flushCompactionQueue({ willRetry: false });
    return result;
  }
}
