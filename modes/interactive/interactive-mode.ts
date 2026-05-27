/**
 * [WHO]: InteractiveMode class, runInteractiveMode()
 * [FROM]: Depends on agent-core, ai, tui, core/* (session, model, config, tools)
 * [TO]: Consumed by modes/index.ts
 * [HERE]: modes/interactive/interactive-mode.ts - TUI orchestration hub
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentMessage, ThinkingLevel } from "@pencil-agent/agent-core";
import {
  type AssistantMessage,
  getOAuthProviders,
  type ImageContent,
  type Message,
  type Model,
  type OAuthProvider,
  type TextContent,
} from "@pencil-agent/ai";
import type {
  AutocompleteItem,
  EditorAction,
  EditorComponent,
  EditorTheme,
  KeyId,
  MarkdownTheme,
  OverlayHandle,
  OverlayOptions,
  SlashCommand,
} from "@pencil-agent/tui";
import {
  CombinedAutocompleteProvider,
  type Component,
  Container,
  fuzzyFilter,
  Loader,
  Markdown,
  matchesKey,
  ProcessTerminal,
  Spacer,
  Text,
  TruncatedText,
  TUI,
  visibleWidth,
} from "@pencil-agent/tui";
import { spawn, spawnSync } from "child_process";
import {
  APP_NAME,
  getAuthPath,
  getDebugLogPath,
  getModelsPath,
  getShareViewerUrl,
  getUpdateInstruction,
  PACKAGE_NAME,
  VERSION,
} from "../../config.js";
import {
  type CustomProtocolProviderId,
  getCustomProtocolProviderBaseUrl,
  getCustomProtocolProviderDefinition,
  getCustomProtocolProviderModelName,
  isCustomProtocolProvider,
  saveCustomProtocolProviderApiKey,
  saveCustomProtocolProviderConfig,
} from "../../core/custom-providers.js";
import {
  type AgentSession,
  type AgentSessionEvent,
  CycleModelError,
  parseSkillBlock,
  type PromptOptions,
} from "../../core/runtime/agent-session.js";
import type { CompactionResult } from "../../core/session/compaction/index.js";
import type {
  ExtensionRunner,
  ExtensionUIContext,
  ExtensionUIDialogOptions,
  ExtensionWidgetOptions,
} from "../../core/extensions/index.js";
import {
  FooterDataProvider,
  type ReadonlyFooterDataProvider,
} from "../../core/footer-data-provider.js";
import { type AppAction, KeybindingsManager } from "../../core/keybindings.js";
import { createCompactionSummaryMessage } from "../../core/messages.js";
import { listMCPServers, setMCPServerEnabled } from "../../core/mcp/mcp-config.js";
import { resolveModelScope } from "../../core/model-resolver.js";
import type { ResourceDiagnostic } from "../../core/config/resource-loader.js";
import {
  type SessionContext,
  SessionManager,
} from "../../core/session/session-manager.js";
import {
  BUILTIN_SLASH_COMMANDS,
  getExtensionBackedBuiltinCommandNames,
  formatSlashCommandDescription,
  getLocalizedCommands,
  inferSlashCommandCategory,
} from "../../core/slash-commands.js";
import { t } from "../../core/i18n/index.js";
import {
  getActivePersonaId,
  getPersonaDir,
  getPersonaMcpConfigPath,
  getPersonaMemoryDir,
  getPersonaSoulDir,
  listPersonas,
  setActivePersonaId,
  toAbsolutePath,
} from "../../core/persona/persona-manager.js";
import type { TruncationResult } from "../../core/tools/truncate.js";
import {
  NANOPENCIL_ALI_TOKEN_PLAN_ANTHROPIC_PROVIDER,
  NANOPENCIL_ALI_TOKEN_PLAN_OPENAI_PROVIDER,
  NANOPENCIL_WHATS_NEW,
} from "../../nanopencil-defaults.js";
import { getChangelogPath, parseChangelog } from "../../utils/changelog.js";
import { copyToClipboard } from "../utils/clipboard.js";
import {
  extensionForImageMimeType,
  readClipboardImage,
} from "../utils/clipboard-image.js";
import {
  ensureTool,
  getToolPath,
  prewarmTool,
} from "../../core/utils/tools-manager.js";
import { printTimings, time } from "../../core/timings.js";
import { detectSupportedImageMimeTypeFromFile } from "../../utils/mime.js";
import { formatDimensionNote, resizeImage } from "../utils/image-resize.js";
import { ArminComponent } from "./components/armin.js";
import { AttachmentsBarComponent } from "./components/attachments-bar.js";
import { AssistantMessageComponent } from "./components/assistant-message.js";
import { promptForApiKey } from "./components/apikey-input.js";
import { BashExecutionComponent } from "./components/bash-execution.js";
import { BorderedLoader } from "./components/bordered-loader.js";
import { BuddyPetComponent, type BuddyState } from "./components/buddy/pet-sprites.js";
import { EditorBuddyLayout } from "./components/editor-buddy-layout.js";
import { BranchSummaryMessageComponent } from "./components/branch-summary-message.js";
import { PencilLoader } from "./components/pencil-loader.js";
import { CompactionSummaryMessageComponent } from "./components/compaction-summary-message.js";
import { CustomEditor } from "./components/custom-editor.js";
import { CustomMessageComponent } from "./components/custom-message.js";
import { DaxnutsComponent } from "./components/daxnuts.js";
import { DynamicBorder } from "./components/dynamic-border.js";
import { ExtensionEditorComponent } from "./components/extension-editor.js";
import { ExtensionInputComponent } from "./components/extension-input.js";
import { ExtensionSelectorComponent } from "./components/extension-selector.js";
import { FooterComponent, renderContextProgressBar } from "./components/footer.js";
import {
  appKey,
  appKeyHint,
  editorKey,
  keyHint,
  rawKeyHint,
} from "./components/keybinding-hints.js";
import { LoginDialogComponent } from "./components/login-dialog.js";
import { ModelSelectorComponent } from "./components/model-selector.js";
import {
  OAuthSelectorComponent,
  type ProviderSelectorItem,
} from "./components/oauth-selector.js";
import { formatSoulStats } from "./components/soul-stats.js";
import { formatMemoryStats } from "./components/memory-stats.js";
import { ProviderSelectorComponent } from "./components/provider-selector.js";
import { ScopedModelsSelectorComponent } from "./components/scoped-models-selector.js";
import { SessionSelectorComponent } from "./components/session-selector.js";
import { SettingsSelectorComponent } from "./components/settings-selector.js";
import { SkillInvocationMessageComponent } from "./components/skill-invocation-message.js";
import { ToolExecutionComponent } from "./components/tool-execution.js";
import { TreeSelectorComponent } from "./components/tree-selector.js";
import { UserMessageComponent } from "./components/user-message.js";
import { UserMessageSelectorComponent } from "./components/user-message-selector.js";
import { RawText } from "./components/raw-text.js";
import {
  getAvailableThemes,
  getAvailableThemesWithPaths,
  getEditorTheme,
  getMarkdownTheme,
  getThemeByName,
  initTheme,
  onThemeChange,
  setRegisteredThemes,
  setTheme,
  setThemeInstance,
  Theme,
  type ThemeColor,
  theme,
} from "./theme/theme.js";

/** Interface for components that can be expanded/collapsed */
interface Expandable {
  setExpanded(expanded: boolean): void;
}

function isExpandable(obj: unknown): obj is Expandable {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "setExpanded" in obj &&
    typeof obj.setExpanded === "function"
  );
}

function spawnNpm(args: string[]) {
  if (process.platform === "win32") {
    // On Windows, use shell mode with a single string to avoid DEP0190 warning.
    // We quote arguments that contain spaces.
    const fullCommand = ["npm", ...args]
      .map((arg) => (arg.includes(" ") ? `"${arg}"` : arg))
      .join(" ");

    return spawn(fullCommand, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
      shell: true,
    });
  }

  return spawn("npm", args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
}

type CompactionQueuedMessage = {
  text: string;
  mode: "steer" | "followUp";
};

/**
 * Options for InteractiveMode initialization.
 */
export interface InteractiveModeOptions {
  /** Providers that were migrated to auth.json (shows warning) */
  migratedProviders?: string[];
  /** Warning message if session model couldn't be restored */
  modelFallbackMessage?: string;
  /** Initial message to send on startup (can include @file content) */
  initialMessage?: string;
  /** Images to attach to the initial message */
  initialImages?: ImageContent[];
  /** Additional messages to send after the initial message */
  initialMessages?: string[];
  /** Force verbose startup (overrides quietStartup setting) */
  verbose?: boolean;
}

export class InteractiveMode {
  private static clipboardImageSeq = 0;
  private clipboardImageFiles: string[] = [];
  /** Ensures Enter cannot submit before an async clipboard read finishes populating attachments. */
  private clipboardPastePromise: Promise<void> = Promise.resolve();
  private session: AgentSession;
  private ui: TUI;
  private chatContainer: Container;
  private pendingMessagesContainer: Container;
  private statusContainer: Container;
  private defaultEditor: CustomEditor;
  private editor: EditorComponent;
  private autocompleteProvider: CombinedAutocompleteProvider | undefined;
  private fdPath: string | undefined;
  private startupToolsPrewarmed = false;
  private editorContainer: Container;
  private footer: FooterComponent;
  private buddyPet: BuddyPetComponent | null = null;
  private buddyPetSpecies: number | null = null;
  private buddyPetResetTimer: ReturnType<typeof setTimeout> | undefined;
  private footerDataProvider: FooterDataProvider;
  private keybindings: KeybindingsManager;
  private version: string;
  private isInitialized = false;
  private onInputCallback?: (text: string) => void;
  private loadingAnimation: Component | undefined = undefined;
  private pendingWorkingMessage: string | undefined = undefined;
  private readonly defaultWorkingMessage = "Working...";
  private workingMessageOverride: string | undefined = undefined;
  private agentRunStartMs: number | undefined = undefined;
  private agentRunTimer: ReturnType<typeof setInterval> | undefined = undefined;
  private welcomeBannerTimer: ReturnType<typeof setInterval> | undefined =
    undefined;

  private lastSigintTime = 0;
  private lastEscapeTime = 0;

  // Status line tracking (for mutating immediately-sequential status updates)
  private lastStatusSpacer: Spacer | undefined = undefined;
  private lastStatusText: Text | undefined = undefined;

  // Streaming message tracking
  private streamingComponent: AssistantMessageComponent | undefined = undefined;
  private streamingMessage: AssistantMessage | undefined = undefined;
  private customStreamComponents = new Map<string, CustomMessageComponent>();

  // Tool execution tracking: toolCallId -> component
  private pendingTools = new Map<string, ToolExecutionComponent>();

  // Tool output expansion state
  private toolOutputExpanded = false;

  // Thinking block visibility state
  private hideThinkingBlock = false;

  // Skill commands: command name -> skill file path
  private skillCommands = new Map<string, string>();

  // Agent subscription unsubscribe function
  private unsubscribe?: () => void;

  // Track if editor is in bash mode (text starts with !)
  private isBashMode = false;

  // Track current bash execution component
  private bashComponent: BashExecutionComponent | undefined = undefined;

  // Track pending bash components (shown in pending area, moved to chat on submit)
  private pendingBashComponents: BashExecutionComponent[] = [];

  // Auto-compaction state
  private autoCompactionLoader: Component | undefined = undefined;
  private autoCompactionEscapeHandler?: () => void;

  // Auto-retry state
  private retryLoader: Component | undefined = undefined;
  private retryEscapeHandler?: () => void;

  // Messages queued while compaction is running
  private compactionQueuedMessages: CompactionQueuedMessage[] = [];
  // User messages rendered optimistically before Agent emits message_start
  private optimisticUserMessages: Array<{ text: string }> = [];

  // Shutdown state
  private shutdownRequested = false;

  // Extension UI state
  private extensionSelector: ExtensionSelectorComponent | undefined = undefined;
  private extensionInput: ExtensionInputComponent | undefined = undefined;
  private extensionEditor: ExtensionEditorComponent | undefined = undefined;
  private extensionTerminalInputUnsubscribers = new Set<() => void>();

  // Extension widgets (components rendered above/below the editor)
  private extensionWidgetsAbove = new Map<
    string,
    Component & { dispose?(): void }
  >();
  private extensionWidgetsBelow = new Map<
    string,
    Component & { dispose?(): void }
  >();
  private widgetContainerAbove!: Container;
  private widgetContainerBelow!: Container;
  /** Pet column next to the input (right side, compact coding-agent style). */
  private buddySlot!: Container;
  private editorBuddyLayout!: EditorBuddyLayout;

  // Custom footer from extension (undefined = use built-in footer)
  private customFooter: (Component & { dispose?(): void }) | undefined =
    undefined;

  // Header container that holds the built-in or custom header
  private headerContainer: Container;

  // Built-in header (logo + keybinding hints + changelog)
  private builtInHeader: Component | undefined = undefined;

  // Custom header from extension (undefined = use built-in header)
  private customHeader: (Component & { dispose?(): void }) | undefined =
    undefined;

  // Attachments state (bytes = in-memory clipboard payload for reliable inline images)
  private attachments: { path: string; mimeType?: string; bytes?: Uint8Array }[] =
    [];
  private selectedAttachmentIndex: number = -1;
  private attachmentsContainer: Container | undefined = undefined;
  private attachmentsBar: AttachmentsBarComponent | undefined = undefined;

  // Convenience accessors
  private get agent() {
    return this.session.agent;
  }
  private get sessionManager() {
    return this.session.sessionManager;
  }
  private get settingsManager() {
    return this.session.settingsManager;
  }

  constructor(
    session: AgentSession,
    private options: InteractiveModeOptions = {},
  ) {
    this.session = session;
    this.version = VERSION;
    this.ui = new TUI(
      new ProcessTerminal(),
      this.settingsManager.getShowHardwareCursor(),
    );
    this.ui.setClearOnShrink(this.settingsManager.getClearOnShrink());
    this.headerContainer = new Container();
    this.chatContainer = new Container();
    this.pendingMessagesContainer = new Container();
    this.statusContainer = new Container();
    this.widgetContainerAbove = new Container();
    this.widgetContainerBelow = new Container();
    this.keybindings = KeybindingsManager.create();
    const editorPaddingX = this.settingsManager.getEditorPaddingX();
    const autocompleteMaxVisible =
      this.settingsManager.getAutocompleteMaxVisible();
    this.defaultEditor = new CustomEditor(
      this.ui,
      getEditorTheme(),
      this.keybindings,
      {
        paddingX: editorPaddingX,
        autocompleteMaxVisible,
      },
    );
    this.editor = this.defaultEditor;
    this.editorContainer = new Container();
    this.attachmentsContainer = new Container();
    this.buddySlot = new Container();
    this.editorBuddyLayout = new EditorBuddyLayout(
      () => this.editor as Component,
      this.buddySlot,
    );
    this.editorContainer.addChild(this.attachmentsContainer);
    this.editorContainer.addChild(this.editorBuddyLayout);
    this.footerDataProvider = new FooterDataProvider(session.cwd);
    this.footer = new FooterComponent(session, this.footerDataProvider, this.settingsManager.getShowTokenStats());
    this.footer.setAutoCompactEnabled(session.autoCompactionEnabled);
    this.syncBuddyPet();

    // Load hide thinking block setting
    this.hideThinkingBlock = this.settingsManager.getHideThinkingBlock();

    // Register themes from resource loader and initialize
    setRegisteredThemes(this.session.resourceLoader.getThemes().themes);
    initTheme(this.settingsManager.getTheme(), true);
    this.session.setSlashCommandExecutor((text) =>
      this.executeBuiltinSlashCommand(text, { clearEditor: false }),
    );
  }

  private setupAutocomplete(fdPath: string | undefined): void {
    // Define commands for autocomplete with localized descriptions
    const localizedCommands = getLocalizedCommands(t);
    const slashCommands: SlashCommand[] = localizedCommands.map(
      (command) => ({
        name: command.name,
        description: formatSlashCommandDescription(
          command.description,
          command.category,
          t,
        ),
      }),
    );

    const modelCommand = slashCommands.find(
      (command) => command.name === "model",
    );
    if (modelCommand) {
      modelCommand.getArgumentCompletions = (
        prefix: string,
      ): AutocompleteItem[] | null => {
        // Get available models (scoped or from registry)
        const models =
          this.session.scopedModels.length > 0
            ? this.session.scopedModels.map((s) => s.model)
            : this.session.modelRegistry.getAvailable();

        if (models.length === 0) return null;

        // Create items with provider/id format
        const items = models.map((m) => ({
          id: m.id,
          provider: m.provider,
          label: `${m.provider}/${m.id}`,
        }));

        // Fuzzy filter by model ID + provider (allows cross-token model/provider matching)
        const filtered = fuzzyFilter(
          items,
          prefix,
          (item) => `${item.id} ${item.provider}`,
        );

        if (filtered.length === 0) return null;

        return filtered.map((item) => ({
          value: item.label,
          label: item.id,
          description: item.provider,
        }));
      };
    }

    const thinkingCommand = slashCommands.find(
      (command) => command.name === "thinking",
    );
    if (thinkingCommand) {
      thinkingCommand.getArgumentCompletions = (
        prefix: string,
      ): AutocompleteItem[] | null => {
        const lowerPrefix = prefix.trim().toLowerCase();
        const levels = this.session.getAvailableThinkingLevels();
        const matches = levels.filter((level) => level.startsWith(lowerPrefix));
        if (matches.length === 0) return null;
        return matches.map((level) => ({ value: level, label: level }));
      };
    }

    // Convert prompt templates to SlashCommand format for autocomplete
    const templateCommands: SlashCommand[] = this.session.promptTemplates.map(
      (cmd) => ({
        name: cmd.name,
        description: formatSlashCommandDescription(
          cmd.description,
          inferSlashCommandCategory(cmd.name, "prompt"),
          t,
        ),
      }),
    );

    // Convert extension commands to SlashCommand format. Some discoverable
    // built-ins are implemented by default extensions; merge their argument
    // completions into the built-in entry instead of showing duplicates.
    const builtinCommandNames = new Set(slashCommands.map((c) => c.name));
    const extensionBackedBuiltinNames = getExtensionBackedBuiltinCommandNames();
    const reservedCommandNames = new Set(
      [...builtinCommandNames].filter(
        (name) => !extensionBackedBuiltinNames.has(name),
      ),
    );
    const registeredExtensionCommands =
      this.session.extensionRunner?.getRegisteredCommands(
        reservedCommandNames,
      ) ?? [];
    const extensionCommandByName = new Map(
      registeredExtensionCommands.map((command) => [command.name, command]),
    );
    for (const command of slashCommands) {
      if (!extensionBackedBuiltinNames.has(command.name)) continue;
      const extensionCommand = extensionCommandByName.get(command.name);
      if (extensionCommand?.getArgumentCompletions) {
        command.getArgumentCompletions =
          extensionCommand.getArgumentCompletions;
      }
    }
    const extensionCommands: SlashCommand[] = registeredExtensionCommands
      .filter((cmd) => !builtinCommandNames.has(cmd.name))
      .map((cmd) => ({
      name: cmd.name,
      description: formatSlashCommandDescription(
        cmd.description ?? "(extension command)",
        inferSlashCommandCategory(cmd.name, "extension"),
        t,
      ),
      getArgumentCompletions: cmd.getArgumentCompletions,
    }));

    // Build skill commands from session.skills (if enabled)
    this.skillCommands.clear();
    const skillCommandList: SlashCommand[] = [];
    if (this.settingsManager.getEnableSkillCommands()) {
      for (const skill of this.session.resourceLoader.getSkills().skills) {
        const commandName = `skill:${skill.name}`;
        this.skillCommands.set(commandName, skill.filePath);
        skillCommandList.push({
          name: commandName,
          description: formatSlashCommandDescription(
            skill.description,
            inferSlashCommandCategory(skill.name, "skill"),
            t,
          ),
        });
      }
    }

    // Setup autocomplete
    this.autocompleteProvider = new CombinedAutocompleteProvider(
      [
        ...slashCommands,
        ...templateCommands,
        ...extensionCommands,
        ...skillCommandList,
      ],
      this.session.cwd,
      fdPath,
    );
    this.defaultEditor.setAutocompleteProvider(this.autocompleteProvider);
    if (this.editor !== this.defaultEditor) {
      this.editor.setAutocompleteProvider?.(this.autocompleteProvider);
    }
  }

  private prewarmStartupTools(): void {
    if (this.startupToolsPrewarmed) return;
    this.startupToolsPrewarmed = true;

    time("interactive.tools.prewarm.start");
    prewarmTool("fd");
    prewarmTool("rg");

    void Promise.all([ensureTool("fd", true), ensureTool("rg", true)])
      .then(([fdPath]) => {
        const resolvedFdPath = fdPath ?? getToolPath("fd") ?? undefined;
        if (!resolvedFdPath || resolvedFdPath === this.fdPath) return;
        this.fdPath = resolvedFdPath;
        this.setupAutocomplete(this.fdPath);
      })
      .finally(() => {
        time("interactive.tools.prewarm.end");
      });
  }

  async init(): Promise<void> {
    if (this.isInitialized) return;
    time("interactive.init.start");

    // Clean up stale clipboard image files from previous sessions
    this.cleanupStaleClipboardFiles();

    // Do not show changelog on startup; version check will prompt to update CLI when newer version exists
    this.fdPath = getToolPath("fd") ?? undefined;

    // Add header container as first child
    this.ui.addChild(this.headerContainer);

    // Add header with keybindings from config (unless silenced)
    if (this.options.verbose || !this.settingsManager.getQuietStartup()) {
      const logo =
        theme.bold(theme.fg("accent", APP_NAME)) +
        theme.fg("dim", ` v${this.version}`);
      const whatsNewLine =
        APP_NAME === "nanopencil"
          ? `${theme.fg("dim", NANOPENCIL_WHATS_NEW)}\n`
          : "";

      // Build startup instructions using keybinding hint helpers
      const kb = this.keybindings;
      const hint = (action: AppAction, desc: string) =>
        appKeyHint(kb, action, desc);

      const instructions = [
        hint("interrupt", "to interrupt"),
        hint("clear", "to clear"),
        rawKeyHint(`${appKey(kb, "clear")} twice`, "to exit"),
        hint("exit", "to exit (empty)"),
        hint("suspend", "to suspend"),
        keyHint("deleteToLineEnd", "to delete to end"),
        hint("cycleThinkingLevel", "to cycle thinking level"),
        rawKeyHint(
          `${appKey(kb, "cycleModelForward")}/${appKey(kb, "cycleModelBackward")}`,
          "to cycle models",
        ),
        hint("selectModel", "to select model"),
        hint("selectProviderThenModel", "to select provider then model"),
        hint("expandTools", "to expand tools"),
        hint("toggleThinking", "to expand thinking"),
        hint("externalEditor", "for external editor"),
        rawKeyHint("/", "for commands"),
        rawKeyHint("!", "to run bash"),
        rawKeyHint("!!", "to run bash (no context)"),
        hint("followUp", "to queue follow-up"),
        hint("dequeue", "to edit all queued messages"),
        hint("pasteImage", "to paste image"),
        rawKeyHint("drop files", "to attach"),
      ].join("\n");
      this.builtInHeader = new Text(
        `${logo}\n${whatsNewLine}${instructions}`,
        1,
        0,
      );

      // Setup UI layout
      this.headerContainer.addChild(new Spacer(1));
      this.headerContainer.addChild(this.builtInHeader);
      this.headerContainer.addChild(new Spacer(1));
    } else {
      // Minimal header when silenced
      this.builtInHeader = new Text("", 0, 0);
      this.headerContainer.addChild(this.builtInHeader);
    }

    this.ui.addChild(this.chatContainer);
    this.ui.addChild(this.pendingMessagesContainer);
    this.ui.addChild(this.statusContainer);
    this.renderWidgets(); // Initialize with default spacer
    this.ui.addChild(this.widgetContainerAbove);
    this.ui.addChild(this.editorContainer);
    this.ui.addChild(this.widgetContainerBelow);
    this.ui.addChild(this.footer);
    this.ui.setFocus(this.editor);

    this.setupKeyHandlers();
    this.setupEditorSubmitHandler();

    // If current session is tagged with a persona, apply it before loading extensions.
    await this.applyPersonaFromSessionIfAny();

    // Initialize extensions first so resources are shown before messages
    await this.initExtensions();

    // Render initial messages AFTER showing loaded resources
    this.renderInitialMessages();

    // Start the UI
    this.ui.start();
    time("interactive.ui.start");
    this.isInitialized = true;
    this.prewarmStartupTools();

    // Set terminal title
    this.updateTerminalTitle();

    // Subscribe to agent events
    this.subscribeToAgent();
    this.chatContainer.clear();
    this.renderInitialMessages();
    await this.session.extensionRunner?.emit({ type: "session_ready" });

    // Set up theme file watcher
    onThemeChange(() => {
      this.ui.invalidate();
      this.updateEditorBorderColor();
      this.ui.requestRender();
    });

    // Set up git branch watcher (uses provider instead of footer)
    this.footerDataProvider.onBranchChange(() => {
      this.ui.requestRender();
    });

    // Initialize available provider count for footer display
    await this.updateAvailableProviderCount();
    time("interactive.firstInput.ready");
    printTimings();
  }

  /**
   * Update terminal title with session name and cwd.
   */
  private updateTerminalTitle(): void {
    const cwdBasename = path.basename(this.session.cwd);
    const sessionName = this.sessionManager.getSessionName();
    if (sessionName) {
      this.ui.terminal.setTitle(`✎ - ${sessionName} - ${cwdBasename}`);
    } else {
      this.ui.terminal.setTitle(`✎ - ${cwdBasename}`);
    }
  }

  /**
   * Run the interactive mode. This is the main entry point.
   * Initializes the UI, shows warnings, processes initial messages, and starts the interactive loop.
   */
  async run(): Promise<void> {
    await this.init();

    // Register signal handlers so that terminal-close (SIGHUP) and kill (SIGTERM)
    // trigger graceful shutdown instead of instant death. This ensures extension
    // cleanup (e.g. SAL eval flush) completes before the process exits.
    const signalShutdown = () => { void this.shutdown(); };
    process.once("SIGHUP", signalShutdown);
    process.once("SIGTERM", signalShutdown);

    // Check for auto-update on startup (if enabled)
    await this.checkAutoUpdateOnStartup();

    // Start version check asynchronously (for notification only, if auto-update is not enabled)
    const autoUpdate = this.settingsManager.getAutoUpdate();
    if (autoUpdate !== "always") {
      this.checkForNewVersion().then((newVersion) => {
        if (newVersion) {
          this.showNewVersionNotification(newVersion);
        }
      });
    }

    // Show startup warnings
    const {
      migratedProviders,
      modelFallbackMessage,
      initialMessage,
      initialImages,
      initialMessages,
    } = this.options;

    if (migratedProviders && migratedProviders.length > 0) {
      this.showWarning(
        `Migrated credentials to auth.json: ${migratedProviders.join(", ")}`,
      );
    }

    const modelsJsonError = this.session.modelRegistry.getError();
    if (modelsJsonError) {
      this.showError(`models.json error: ${modelsJsonError}`);
    }

    if (modelFallbackMessage) {
      this.showWarning(modelFallbackMessage);
    }

    // Process initial messages
    if (initialMessage) {
      try {
        await this.session.prompt(initialMessage, { images: initialImages });
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error occurred";
        this.showError(errorMessage);
      }
    }

    if (initialMessages) {
      for (const message of initialMessages) {
        try {
          await this.session.prompt(message);
        } catch (error: unknown) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error occurred";
          this.showError(errorMessage);
        }
      }
    }

    // Main interactive loop
    while (true) {
      const userInput = await this.getUserInput();
      try {
        await this.session.prompt(userInput);
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error occurred";
        this.showError(errorMessage);
      }
    }
  }

  /**
   * Check npm registry for a newer version.
   */
  private async checkForNewVersion(): Promise<string | undefined> {
    if (process.env.NANOPENCIL_SKIP_VERSION_CHECK || process.env.NANOPENCIL_OFFLINE)
      return undefined;

    try {
      const response = await fetch(
        `https://registry.npmjs.org/${encodeURIComponent(PACKAGE_NAME)}`,
        {
          signal: AbortSignal.timeout(10000),
        },
      );
      if (!response.ok) return undefined;

      const data = (await response.json()) as {
        "dist-tags"?: { latest?: string };
        version?: string;
      };
      const latestVersion = data["dist-tags"]?.latest ?? data.version;

      // Only return latestVersion if it's actually newer than current version
      if (latestVersion && this.compareVersion(latestVersion, this.version) > 0) {
        return latestVersion;
      }

      return undefined;
    } catch {
      return undefined;
    }
  }

  private getMarkdownThemeWithSettings(): MarkdownTheme {
    return {
      ...getMarkdownTheme(),
      codeBlockIndent: this.settingsManager.getCodeBlockIndent(),
    };
  }

  // =========================================================================
  // Extension System
  // =========================================================================

  private formatDisplayPath(p: string): string {
    const home = os.homedir();
    let result = p;

    // Replace home directory with ~
    if (result.startsWith(home)) {
      result = `~${result.slice(home.length)}`;
    }

    return result;
  }

  /**
   * Get a short path relative to the package root for display.
   */
  private getShortPath(fullPath: string, source: string): string {
    // For npm packages, show path relative to node_modules/pkg/
    const npmMatch = fullPath.match(
      /node_modules\/(@?[^/]+(?:\/[^/]+)?)\/(.*)/,
    );
    if (npmMatch && source.startsWith("npm:")) {
      return npmMatch[2];
    }

    // For git packages, show path relative to repo root
    const gitMatch = fullPath.match(/git\/[^/]+\/[^/]+\/(.*)/);
    if (gitMatch && source.startsWith("git:")) {
      return gitMatch[1];
    }

    // For local/auto, just use formatDisplayPath
    return this.formatDisplayPath(fullPath);
  }

  private getDisplaySourceInfo(
    source: string,
    scope: string,
  ): { label: string; scopeLabel?: string; color: "accent" | "muted" } {
    if (source === "local") {
      if (scope === "user") {
        return { label: "user", color: "muted" };
      }
      if (scope === "project") {
        return { label: "project", color: "muted" };
      }
      if (scope === "temporary") {
        return { label: "path", scopeLabel: "temp", color: "muted" };
      }
      return { label: "path", color: "muted" };
    }

    if (source === "cli") {
      return {
        label: "path",
        scopeLabel: scope === "temporary" ? "temp" : undefined,
        color: "muted",
      };
    }

    const scopeLabel =
      scope === "user"
        ? "user"
        : scope === "project"
          ? "project"
          : scope === "temporary"
            ? "temp"
            : undefined;
    return { label: source, scopeLabel, color: "accent" };
  }

  private getScopeGroup(
    source: string,
    scope: string,
  ): "user" | "project" | "path" {
    if (source === "cli" || scope === "temporary") return "path";
    if (scope === "user") return "user";
    if (scope === "project") return "project";
    return "path";
  }

  private isPackageSource(source: string): boolean {
    return source.startsWith("npm:") || source.startsWith("git:");
  }

  private buildScopeGroups(
    paths: string[],
    metadata: Map<string, { source: string; scope: string; origin: string }>,
  ): Array<{
    scope: "user" | "project" | "path";
    paths: string[];
    packages: Map<string, string[]>;
  }> {
    const groups: Record<
      "user" | "project" | "path",
      {
        scope: "user" | "project" | "path";
        paths: string[];
        packages: Map<string, string[]>;
      }
    > = {
      user: { scope: "user", paths: [], packages: new Map() },
      project: { scope: "project", paths: [], packages: new Map() },
      path: { scope: "path", paths: [], packages: new Map() },
    };

    for (const p of paths) {
      const meta = this.findMetadata(p, metadata);
      const source = meta?.source ?? "local";
      const scope = meta?.scope ?? "project";
      const groupKey = this.getScopeGroup(source, scope);
      const group = groups[groupKey];

      if (this.isPackageSource(source)) {
        const list = group.packages.get(source) ?? [];
        list.push(p);
        group.packages.set(source, list);
      } else {
        group.paths.push(p);
      }
    }

    return [groups.project, groups.user, groups.path].filter(
      (group) => group.paths.length > 0 || group.packages.size > 0,
    );
  }

  private formatScopeGroups(
    groups: Array<{
      scope: "user" | "project" | "path";
      paths: string[];
      packages: Map<string, string[]>;
    }>,
    options: {
      formatPath: (p: string) => string;
      formatPackagePath: (p: string, source: string) => string;
    },
  ): string {
    const lines: string[] = [];

    for (const group of groups) {
      lines.push(`  ${theme.fg("accent", group.scope)}`);

      const sortedPaths = [...group.paths].sort((a, b) => a.localeCompare(b));
      for (const p of sortedPaths) {
        lines.push(theme.fg("dim", `    ${options.formatPath(p)}`));
      }

      const sortedPackages = Array.from(group.packages.entries()).sort(
        ([a], [b]) => a.localeCompare(b),
      );
      for (const [source, paths] of sortedPackages) {
        lines.push(`    ${theme.fg("mdLink", source)}`);
        const sortedPackagePaths = [...paths].sort((a, b) =>
          a.localeCompare(b),
        );
        for (const p of sortedPackagePaths) {
          lines.push(
            theme.fg("dim", `      ${options.formatPackagePath(p, source)}`),
          );
        }
      }
    }

    return lines.join("\n");
  }

  /**
   * Find metadata for a path, checking parent directories if exact match fails.
   * Package manager stores metadata for directories, but we display file paths.
   */
  private findMetadata(
    p: string,
    metadata: Map<string, { source: string; scope: string; origin: string }>,
  ): { source: string; scope: string; origin: string } | undefined {
    // Try exact match first
    const exact = metadata.get(p);
    if (exact) return exact;

    // Try parent directories (package manager stores directory paths)
    let current = p;
    while (current.includes("/")) {
      current = current.substring(0, current.lastIndexOf("/"));
      const parent = metadata.get(current);
      if (parent) return parent;
    }

    return undefined;
  }

  /**
   * Format a path with its source/scope info from metadata.
   */
  private formatPathWithSource(
    p: string,
    metadata: Map<string, { source: string; scope: string; origin: string }>,
  ): string {
    const meta = this.findMetadata(p, metadata);
    if (meta) {
      const shortPath = this.getShortPath(p, meta.source);
      const { label, scopeLabel } = this.getDisplaySourceInfo(
        meta.source,
        meta.scope,
      );
      const labelText = scopeLabel ? `${label} (${scopeLabel})` : label;
      return `${labelText} ${shortPath}`;
    }
    return this.formatDisplayPath(p);
  }

  /**
   * Format resource diagnostics with nice collision display using metadata.
   */
  private formatDiagnostics(
    diagnostics: readonly ResourceDiagnostic[],
    metadata: Map<string, { source: string; scope: string; origin: string }>,
  ): string {
    const lines: string[] = [];

    // Group collision diagnostics by name
    const collisions = new Map<string, ResourceDiagnostic[]>();
    const otherDiagnostics: ResourceDiagnostic[] = [];

    for (const d of diagnostics) {
      if (d.type === "collision" && d.collision) {
        const list = collisions.get(d.collision.name) ?? [];
        list.push(d);
        collisions.set(d.collision.name, list);
      } else {
        otherDiagnostics.push(d);
      }
    }

    // Format collision diagnostics grouped by name
    for (const [name, collisionList] of collisions) {
      const first = collisionList[0]?.collision;
      if (!first) continue;
      lines.push(theme.fg("warning", `  "${name}" collision:`));
      // Show winner
      lines.push(
        theme.fg(
          "dim",
          `    ${theme.fg("success", "✓")} ${this.formatPathWithSource(first.winnerPath, metadata)}`,
        ),
      );
      // Show all losers
      for (const d of collisionList) {
        if (d.collision) {
          lines.push(
            theme.fg(
              "dim",
              `    ${theme.fg("warning", "✗")} ${this.formatPathWithSource(d.collision.loserPath, metadata)} (skipped)`,
            ),
          );
        }
      }
    }

    // Format other diagnostics (skill name collisions, parse errors, etc.)
    for (const d of otherDiagnostics) {
      if (d.path) {
        // Use metadata-aware formatting for paths
        const sourceInfo = this.formatPathWithSource(d.path, metadata);
        lines.push(
          theme.fg(d.type === "error" ? "error" : "warning", `  ${sourceInfo}`),
        );
        lines.push(
          theme.fg(
            d.type === "error" ? "error" : "warning",
            `    ${d.message}`,
          ),
        );
      } else {
        lines.push(
          theme.fg(d.type === "error" ? "error" : "warning", `  ${d.message}`),
        );
      }
    }

    return lines.join("\n");
  }

  private showLoadedResources(options?: {
    extensionPaths?: string[];
    force?: boolean;
    showDiagnosticsWhenQuiet?: boolean;
  }): void {
    const showListing =
      options?.force ||
      this.options.verbose ||
      !this.settingsManager.getQuietStartup();
    const showDiagnostics =
      showListing || options?.showDiagnosticsWhenQuiet === true;
    if (!showListing && !showDiagnostics) {
      return;
    }

    const metadata = this.session.resourceLoader.getPathMetadata();
    const sectionHeader = (name: string, color: ThemeColor = "mdHeading") =>
      theme.fg(color, `[${name}]`);

    const skillsResult = this.session.resourceLoader.getSkills();
    const promptsResult = this.session.resourceLoader.getPrompts();
    const themesResult = this.session.resourceLoader.getThemes();

    if (showListing) {
      const contextFiles =
        this.session.resourceLoader.getAgentsFiles().agentsFiles;
      if (contextFiles.length > 0) {
        this.chatContainer.addChild(new Spacer(1));
        const contextList = contextFiles
          .map((f) => theme.fg("dim", `  ${this.formatDisplayPath(f.path)}`))
          .join("\n");
        this.chatContainer.addChild(
          new Text(`${sectionHeader("Context")}\n${contextList}`, 0, 0),
        );
        this.chatContainer.addChild(new Spacer(1));
      }

      const skills = skillsResult.skills;
      if (skills.length > 0) {
        const skillPaths = skills.map((s) => s.filePath);
        const groups = this.buildScopeGroups(skillPaths, metadata);
        const skillList = this.formatScopeGroups(groups, {
          formatPath: (p) => this.formatDisplayPath(p),
          formatPackagePath: (p, source) => this.getShortPath(p, source),
        });
        this.chatContainer.addChild(
          new Text(`${sectionHeader("Skills")}\n${skillList}`, 0, 0),
        );
        this.chatContainer.addChild(new Spacer(1));
      }

      const templates = this.session.promptTemplates;
      if (templates.length > 0) {
        const templatePaths = templates.map((t) => t.filePath);
        const groups = this.buildScopeGroups(templatePaths, metadata);
        const templateByPath = new Map(templates.map((t) => [t.filePath, t]));
        const templateList = this.formatScopeGroups(groups, {
          formatPath: (p) => {
            const template = templateByPath.get(p);
            return template ? `/${template.name}` : this.formatDisplayPath(p);
          },
          formatPackagePath: (p) => {
            const template = templateByPath.get(p);
            return template ? `/${template.name}` : this.formatDisplayPath(p);
          },
        });
        this.chatContainer.addChild(
          new Text(`${sectionHeader("Prompts")}\n${templateList}`, 0, 0),
        );
        this.chatContainer.addChild(new Spacer(1));
      }

      const extensionPaths = options?.extensionPaths ?? [];
      if (extensionPaths.length > 0) {
        const groups = this.buildScopeGroups(extensionPaths, metadata);
        const extList = this.formatScopeGroups(groups, {
          formatPath: (p) => this.formatDisplayPath(p),
          formatPackagePath: (p, source) => this.getShortPath(p, source),
        });
        this.chatContainer.addChild(
          new Text(
            `${sectionHeader("Extensions", "mdHeading")}\n${extList}`,
            0,
            0,
          ),
        );
        this.chatContainer.addChild(new Spacer(1));
      }

      // Show loaded themes (excluding built-in)
      const loadedThemes = themesResult.themes;
      const customThemes = loadedThemes.filter((t) => t.sourcePath);
      if (customThemes.length > 0) {
        const themePaths = customThemes.map((t) => t.sourcePath!);
        const groups = this.buildScopeGroups(themePaths, metadata);
        const themeList = this.formatScopeGroups(groups, {
          formatPath: (p) => this.formatDisplayPath(p),
          formatPackagePath: (p, source) => this.getShortPath(p, source),
        });
        this.chatContainer.addChild(
          new Text(`${sectionHeader("Themes")}\n${themeList}`, 0, 0),
        );
        this.chatContainer.addChild(new Spacer(1));
      }
    }

    if (showDiagnostics) {
      const skillDiagnostics = skillsResult.diagnostics;
      if (skillDiagnostics.length > 0) {
        const warningLines = this.formatDiagnostics(skillDiagnostics, metadata);
        this.chatContainer.addChild(
          new Text(
            `${theme.fg("warning", "[Skill conflicts]")}\n${warningLines}`,
            0,
            0,
          ),
        );
        this.chatContainer.addChild(new Spacer(1));
      }

      const promptDiagnostics = promptsResult.diagnostics;
      if (promptDiagnostics.length > 0) {
        const warningLines = this.formatDiagnostics(
          promptDiagnostics,
          metadata,
        );
        this.chatContainer.addChild(
          new Text(
            `${theme.fg("warning", "[Prompt conflicts]")}\n${warningLines}`,
            0,
            0,
          ),
        );
        this.chatContainer.addChild(new Spacer(1));
      }

      const extensionDiagnostics: ResourceDiagnostic[] = [];
      const extensionErrors =
        this.session.resourceLoader.getExtensions().errors;
      if (extensionErrors.length > 0) {
        for (const error of extensionErrors) {
          extensionDiagnostics.push({
            type: "error",
            message: error.error,
            path: error.path,
          });
        }
      }

      const commandDiagnostics =
        this.session.extensionRunner?.getCommandDiagnostics() ?? [];
      extensionDiagnostics.push(...commandDiagnostics);

      const shortcutDiagnostics =
        this.session.extensionRunner?.getShortcutDiagnostics() ?? [];
      extensionDiagnostics.push(...shortcutDiagnostics);

      if (extensionDiagnostics.length > 0) {
        const warningLines = this.formatDiagnostics(
          extensionDiagnostics,
          metadata,
        );
        this.chatContainer.addChild(
          new Text(
            `${theme.fg("warning", "[Extension issues]")}\n${warningLines}`,
            0,
            0,
          ),
        );
        this.chatContainer.addChild(new Spacer(1));
      }

      const themeDiagnostics = themesResult.diagnostics;
      if (themeDiagnostics.length > 0) {
        const warningLines = this.formatDiagnostics(themeDiagnostics, metadata);
        this.chatContainer.addChild(
          new Text(
            `${theme.fg("warning", "[Theme conflicts]")}\n${warningLines}`,
            0,
            0,
          ),
        );
        this.chatContainer.addChild(new Spacer(1));
      }
    }
  }

  /**
   * Initialize the extension system with TUI-based UI context.
   */
  private async initExtensions(): Promise<void> {
    const uiContext = this.createExtensionUIContext();
    await this.session.bindExtensions({
      uiContext,
      commandContextActions: {
        waitForIdle: () => this.session.agent.waitForIdle(),
        newSession: async (options) => {
          if (this.loadingAnimation) {
            (this.loadingAnimation as PencilLoader).stop();
            this.loadingAnimation = undefined;
          }
          this.statusContainer.clear();

          // Delegate to AgentSession (handles setup + agent state sync)
          const success = await this.session.newSession(options);
          if (!success) {
            return { cancelled: true };
          }

          // Clear UI state
          this.chatContainer.clear();
          this.pendingMessagesContainer.clear();
          this.compactionQueuedMessages = [];
          this.streamingComponent = undefined;
          this.streamingMessage = undefined;
          this.pendingTools.clear();

          // Render any messages added via setup, or show empty session
          this.renderInitialMessages();

          return { cancelled: false };
        },
        fork: async (entryId) => {
          const result = await this.session.fork(entryId);
          if (result.cancelled) {
            return { cancelled: true };
          }

          this.chatContainer.clear();
          this.addSessionNavigationBanner("Forked session");
          this.renderInitialMessages();
          this.editor.setText(result.selectedText);
          this.showStatus("Forked to new session");

          return { cancelled: false };
        },
        navigateTree: async (targetId, options) => {
          const result = await this.session.navigateTree(targetId, {
            summarize: options?.summarize,
            customInstructions: options?.customInstructions,
            replaceInstructions: options?.replaceInstructions,
            label: options?.label,
          });
          if (result.cancelled) {
            return { cancelled: true };
          }

          this.chatContainer.clear();
          this.addSessionNavigationBanner("Navigated session tree");
          this.renderInitialMessages();
          if (result.editorText && !this.editor.getText().trim()) {
            this.editor.setText(result.editorText);
          }
          this.showStatus("Navigated to selected point");

          return { cancelled: false };
        },
        switchSession: async (sessionPath) => {
          await this.handleResumeSession(sessionPath);
          return { cancelled: false };
        },
        reload: async () => {
          await this.handleReloadCommand();
        },
      },
      shutdownHandler: () => {
        this.shutdownRequested = true;
        if (!this.session.isStreaming) {
          void this.shutdown();
        }
      },
      onError: (error) => {
        this.showExtensionError(error.extensionPath, error.error, error.stack);
      },
    });

    setRegisteredThemes(this.session.resourceLoader.getThemes().themes);
    this.setupAutocomplete(this.fdPath);

    const extensionRunner = this.session.extensionRunner;
    if (!extensionRunner) {
      this.showLoadedResources({ extensionPaths: [], force: false });
      return;
    }

    this.setupExtensionShortcuts(extensionRunner);
    this.showLoadedResources({
      extensionPaths: extensionRunner.getExtensionPaths(),
      force: false,
    });
  }

  /**
   * Get a registered tool definition by name (for custom rendering).
   */
  private getRegisteredToolDefinition(toolName: string) {
    const tools = this.session.extensionRunner?.getAllRegisteredTools() ?? [];
    const registeredTool = tools.find((t) => t.definition.name === toolName);
    return registeredTool?.definition;
  }

  /**
   * Set up keyboard shortcuts registered by extensions.
   */
  private setupExtensionShortcuts(extensionRunner: ExtensionRunner): void {
    const shortcuts = extensionRunner.getShortcuts(
      this.keybindings.getEffectiveConfig(),
    );
    if (shortcuts.size === 0) return;

    // Reuse the runner's canonical ExtensionContext — the UI context and core
    // bindings were already attached via session.bindExtensions(), so this
    // returns a fully-wired context that stays in sync with model/session state.
    this.defaultEditor.onExtensionShortcut = (data: string) => {
      for (const [shortcutStr, shortcut] of shortcuts) {
        // Cast to KeyId - extension shortcuts use the same format
        if (matchesKey(data, shortcutStr as KeyId)) {
          // Run handler async, don't block input
          Promise.resolve(shortcut.handler(extensionRunner.createContext())).catch((err) => {
            this.showError(
              `Shortcut handler error: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
          return true;
        }
      }
      return false;
    };
  }

  /**
   * Set extension status text in the footer.
   */
  private setExtensionStatus(key: string, text: string | undefined): void {
    this.footerDataProvider.setExtensionStatus(key, text);
    this.ui.requestRender();
  }

  /**
   * Set an extension widget (string array or custom component).
   */
  private setExtensionWidget(
    key: string,
    content:
      | string[]
      | ((tui: TUI, thm: Theme) => Component & { dispose?(): void })
      | undefined,
    options?: ExtensionWidgetOptions,
  ): void {
    const placement = options?.placement ?? "aboveEditor";
    const removeExisting = (
      map: Map<string, Component & { dispose?(): void }>,
    ) => {
      const existing = map.get(key);
      if (existing?.dispose) existing.dispose();
      map.delete(key);
    };

    removeExisting(this.extensionWidgetsAbove);
    removeExisting(this.extensionWidgetsBelow);

    if (content === undefined) {
      this.renderWidgets();
      return;
    }

    let component: Component & { dispose?(): void };

    if (Array.isArray(content)) {
      // Wrap string array in a Container with Text components
      const container = new Container();
      for (const line of content.slice(0, InteractiveMode.MAX_WIDGET_LINES)) {
        container.addChild(new Text(line, 1, 0));
      }
      if (content.length > InteractiveMode.MAX_WIDGET_LINES) {
        container.addChild(
          new Text(theme.fg("muted", "... (widget truncated)"), 1, 0),
        );
      }
      component = container;
    } else {
      // Factory function - create component
      component = content(this.ui, theme);
    }

    const targetMap =
      placement === "belowEditor"
        ? this.extensionWidgetsBelow
        : this.extensionWidgetsAbove;
    targetMap.set(key, component);
    this.renderWidgets();
  }

  private clearExtensionWidgets(): void {
    for (const widget of this.extensionWidgetsAbove.values()) {
      widget.dispose?.();
    }
    for (const widget of this.extensionWidgetsBelow.values()) {
      widget.dispose?.();
    }
    this.extensionWidgetsAbove.clear();
    this.extensionWidgetsBelow.clear();
    this.renderWidgets();
  }

  private formatElapsedSeconds(ms: number): string {
    return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
  }

  private buildWorkingMessage(): string {
    const baseMessage = this.workingMessageOverride || this.defaultWorkingMessage;
    const interruptHint = `${appKey(this.keybindings, "interrupt")} to interrupt`;
    const elapsed =
      this.agentRunStartMs !== undefined
        ? this.formatElapsedSeconds(Date.now() - this.agentRunStartMs)
        : undefined;
    return elapsed
      ? `${baseMessage} (${elapsed}, ${interruptHint})`
      : `${baseMessage} (${interruptHint})`;
  }

  private updateWorkingMessage(options?: { resetStallTimer?: boolean }): void {
    if (!this.loadingAnimation) return;
    (this.loadingAnimation as PencilLoader).setMessage(
      this.buildWorkingMessage(),
      options,
    );
  }

  private stopAgentRunTimer(): void {
    if (this.agentRunTimer) {
      clearInterval(this.agentRunTimer);
      this.agentRunTimer = undefined;
    }
  }

  private stopWelcomeBannerTimer(): void {
    if (this.welcomeBannerTimer) {
      clearInterval(this.welcomeBannerTimer);
      this.welcomeBannerTimer = undefined;
    }
  }

  private startAgentRunTimer(): void {
    this.stopAgentRunTimer();
    this.agentRunStartMs = Date.now();
    this.agentRunTimer = setInterval(() => {
      if (!this.loadingAnimation || this.agentRunStartMs === undefined) {
        this.stopAgentRunTimer();
        return;
      }
      // Keep stall detection meaningful while still showing live elapsed time.
      this.updateWorkingMessage({ resetStallTimer: false });
    }, 100);
  }

  private resetExtensionUI(): void {
    if (this.extensionSelector) {
      this.hideExtensionSelector();
    }
    if (this.extensionInput) {
      this.hideExtensionInput();
    }
    if (this.extensionEditor) {
      this.hideExtensionEditor();
    }
    this.ui.hideOverlay();
    this.clearExtensionTerminalInputListeners();
    this.setExtensionFooter(undefined);
    this.setExtensionHeader(undefined);
    this.clearExtensionWidgets();
    this.footerDataProvider.clearExtensionStatuses();
    this.footer.invalidate();
    this.setCustomEditorComponent(undefined);
    this.defaultEditor.onExtensionShortcut = undefined;
    this.updateTerminalTitle();
    if (this.loadingAnimation) {
      this.workingMessageOverride = undefined;
      this.updateWorkingMessage();
    }
  }

  // Maximum total widget lines to prevent viewport overflow
  private static readonly MAX_WIDGET_LINES = 10;

  /**
   * Render all extension widgets to the widget container.
   */
  private renderWidgets(): void {
    if (!this.widgetContainerAbove || !this.widgetContainerBelow) return;
    this.renderWidgetContainer(
      this.widgetContainerAbove,
      this.extensionWidgetsAbove,
      true,
      true,
    );
    this.renderWidgetContainer(
      this.widgetContainerBelow,
      this.extensionWidgetsBelow,
      false,
      false,
    );
    this.ui.requestRender();
  }

  private renderWidgetContainer(
    container: Container,
    widgets: Map<string, Component & { dispose?(): void }>,
    spacerWhenEmpty: boolean,
    leadingSpacer: boolean,
  ): void {
    container.clear();

    if (widgets.size === 0) {
      if (spacerWhenEmpty) {
        container.addChild(new Spacer(1));
      }
      return;
    }

    if (leadingSpacer) {
      container.addChild(new Spacer(1));
    }
    for (const component of widgets.values()) {
      container.addChild(component);
    }
  }

  private clearBuddyPetResetTimer(): void {
    if (this.buddyPetResetTimer) {
      clearTimeout(this.buddyPetResetTimer);
      this.buddyPetResetTimer = undefined;
    }
  }

  private syncBuddyPet(): void {
    const enabled = this.settingsManager.getBuddyEnabled();
    const species = this.settingsManager.getBuddySpecies();

    if (!enabled) {
      this.clearBuddyPetResetTimer();
      this.buddyPet?.dispose();
      this.buddyPet = null;
      this.buddyPetSpecies = null;
      this.buddySlot.clear();
      this.renderWidgets();
      return;
    }

    if (!this.buddyPet || this.buddyPetSpecies !== species) {
      this.clearBuddyPetResetTimer();
      this.buddyPet?.dispose();
      this.buddyPet = new BuddyPetComponent(this.ui, species);
      this.buddyPetSpecies = species;
      this.buddyPet.setState("idle");
      this.buddyPet.setSpeechBubble("");
    }

    this.buddySlot.clear();
    this.buddySlot.addChild(this.buddyPet);
    this.renderWidgets();
  }

  /**
   * Restore attachments bar (if any) + editor row with optional buddy column.
   */
  private remountEditorShell(): void {
    this.editorContainer.clear();
    if (this.attachments.length > 0 && this.attachmentsContainer) {
      this.editorContainer.addChild(this.attachmentsContainer);
    }
    this.editorContainer.addChild(this.editorBuddyLayout);
  }

  private setBuddyPetState(
    state: BuddyState,
    speechBubble = "",
    options?: { resetTo?: BuddyState; afterMs?: number },
  ): void {
    if (!this.buddyPet) return;

    this.clearBuddyPetResetTimer();
    this.buddyPet.setState(state);
    this.buddyPet.setSpeechBubble(speechBubble);

    if (options?.resetTo) {
      this.buddyPetResetTimer = setTimeout(() => {
        if (!this.buddyPet) return;
        this.buddyPet.setState(options.resetTo ?? "idle");
        this.buddyPet.setSpeechBubble("");
        this.buddyPetResetTimer = undefined;
        this.ui.requestRender();
      }, options.afterMs ?? 1500);
    }

    this.ui.requestRender();
  }

  /**
   * Set a custom footer component, or restore the built-in footer.
   */
  private setExtensionFooter(
    factory:
      | ((
          tui: TUI,
          thm: Theme,
          footerData: ReadonlyFooterDataProvider,
        ) => Component & { dispose?(): void })
      | undefined,
  ): void {
    // Dispose existing custom footer
    if (this.customFooter?.dispose) {
      this.customFooter.dispose();
    }

    // Remove current footer from UI
    if (this.customFooter) {
      this.ui.removeChild(this.customFooter);
    } else {
      this.ui.removeChild(this.footer);
    }

    if (factory) {
      // Create and add custom footer, passing the data provider
      this.customFooter = factory(this.ui, theme, this.footerDataProvider);
      this.ui.addChild(this.customFooter);
    } else {
      // Restore built-in footer
      this.customFooter = undefined;
      this.ui.addChild(this.footer);
    }

    this.ui.requestRender();
  }

  /**
   * Set a custom header component, or restore the built-in header.
   */
  private setExtensionHeader(
    factory:
      | ((tui: TUI, thm: Theme) => Component & { dispose?(): void })
      | undefined,
  ): void {
    // Header may not be initialized yet if called during early initialization
    if (!this.builtInHeader) {
      return;
    }

    // Dispose existing custom header
    if (this.customHeader?.dispose) {
      this.customHeader.dispose();
    }

    // Find the index of the current header in the header container
    const currentHeader = this.customHeader || this.builtInHeader;
    const index = this.headerContainer.children.indexOf(currentHeader);

    if (factory) {
      // Create and add custom header
      this.customHeader = factory(this.ui, theme);
      if (index !== -1) {
        this.headerContainer.children[index] = this.customHeader;
      } else {
        // If not found (e.g. builtInHeader was never added), add at the top
        this.headerContainer.children.unshift(this.customHeader);
      }
    } else {
      // Restore built-in header
      this.customHeader = undefined;
      if (index !== -1) {
        this.headerContainer.children[index] = this.builtInHeader;
      }
    }

    this.ui.requestRender();
  }

  private addExtensionTerminalInputListener(
    handler: (data: string) => { consume?: boolean; data?: string } | undefined,
  ): () => void {
    const unsubscribe = this.ui.addInputListener(handler);
    this.extensionTerminalInputUnsubscribers.add(unsubscribe);
    return () => {
      unsubscribe();
      this.extensionTerminalInputUnsubscribers.delete(unsubscribe);
    };
  }

  private clearExtensionTerminalInputListeners(): void {
    for (const unsubscribe of this.extensionTerminalInputUnsubscribers) {
      unsubscribe();
    }
    this.extensionTerminalInputUnsubscribers.clear();
  }

  /**
   * Create the ExtensionUIContext for extensions.
   */
  private createExtensionUIContext(): ExtensionUIContext {
    return {
      select: (title, options, opts) =>
        this.showExtensionSelector(title, options, opts),
      confirm: (title, message, opts) =>
        this.showExtensionConfirm(title, message, opts),
      input: (title, placeholder, opts) =>
        this.showExtensionInput(title, placeholder, opts),
      notify: (message, type) => this.showExtensionNotify(message, type),
      onTerminalInput: (handler) =>
        this.addExtensionTerminalInputListener(handler),
      setStatus: (key, text) => this.setExtensionStatus(key, text),
      setWorkingMessage: (message) => {
        this.workingMessageOverride = message || undefined;
        if (this.loadingAnimation) {
          this.updateWorkingMessage();
        } else {
          // Queue message for when loadingAnimation is created (handles agent_start race)
          this.pendingWorkingMessage = message;
        }
      },
      setWidget: (key, content, options) =>
        this.setExtensionWidget(key, content, options),
      setFooter: (factory) => this.setExtensionFooter(factory),
      setHeader: (factory) => this.setExtensionHeader(factory),
      setTitle: (title) => this.ui.terminal.setTitle(title),
      custom: (factory, options) => this.showExtensionCustom(factory, options),
      pasteToEditor: (text) =>
        this.editor.handleInput(`\x1b[200~${text}\x1b[201~`),
      setEditorText: (text) => this.editor.setText(text),
      getEditorText: () => this.editor.getText(),
      editor: (title, prefill) => this.showExtensionEditor(title, prefill),
      openExternalEditor: (filePath) => this.openExistingFileInExternalEditor(filePath),
      setEditorComponent: (factory) => this.setCustomEditorComponent(factory),
      get theme() {
        return theme;
      },
      getAllThemes: () => getAvailableThemesWithPaths(),
      getTheme: (name) => getThemeByName(name),
      setTheme: (themeOrName) => {
        if (themeOrName instanceof Theme) {
          setThemeInstance(themeOrName);
          this.ui.requestRender();
          return { success: true };
        }
        const result = setTheme(themeOrName, true);
        if (result.success) {
          if (this.settingsManager.getTheme() !== themeOrName) {
            this.settingsManager.setTheme(themeOrName);
          }
          this.ui.requestRender();
        }
        return result;
      },
      getToolsExpanded: () => this.toolOutputExpanded,
      setToolsExpanded: (expanded) => this.setToolsExpanded(expanded),
    };
  }

  /**
   * Show a selector for extensions.
   */
  private showExtensionSelector(
    title: string,
    options: string[],
    opts?: ExtensionUIDialogOptions,
  ): Promise<string | undefined> {
    return new Promise((resolve) => {
      if (opts?.signal?.aborted) {
        resolve(undefined);
        return;
      }

      const onAbort = () => {
        this.hideExtensionSelector();
        resolve(undefined);
      };
      opts?.signal?.addEventListener("abort", onAbort, { once: true });

      this.dismissActiveExtensionPrompt(false);
      this.extensionSelector = new ExtensionSelectorComponent(
        title,
        options,
        (option) => {
          opts?.signal?.removeEventListener("abort", onAbort);
          this.hideExtensionSelector();
          resolve(option);
        },
        () => {
          opts?.signal?.removeEventListener("abort", onAbort);
          this.hideExtensionSelector();
          resolve(undefined);
        },
        {
          tui: this.ui,
          timeout: opts?.timeout,
        },
      );

      this.editorContainer.clear();
      this.editorContainer.addChild(this.extensionSelector);
      this.ui.setFocus(this.extensionSelector);
      this.ui.requestRender();
    });
  }

  /**
   * Hide the extension selector.
   */
  private hideExtensionSelector(): void {
    this.dismissExtensionSelector();
    this.ui.requestRender();
  }

  /**
   * Show a confirmation dialog for extensions.
   */
  private async showExtensionConfirm(
    title: string,
    message: string,
    opts?: ExtensionUIDialogOptions,
  ): Promise<boolean> {
    const result = await this.showExtensionSelector(
      `${title}\n${message}`,
      ["Yes", "No"],
      opts,
    );
    return result === "Yes";
  }

  /**
   * Show a text input for extensions.
   */
  private showExtensionInput(
    title: string,
    placeholder?: string,
    opts?: ExtensionUIDialogOptions,
  ): Promise<string | undefined> {
    return new Promise((resolve) => {
      if (opts?.signal?.aborted) {
        resolve(undefined);
        return;
      }

      const onAbort = () => {
        this.hideExtensionInput();
        resolve(undefined);
      };
      opts?.signal?.addEventListener("abort", onAbort, { once: true });

      this.dismissActiveExtensionPrompt(false);
      this.extensionInput = new ExtensionInputComponent(
        title,
        placeholder,
        (value) => {
          opts?.signal?.removeEventListener("abort", onAbort);
          this.hideExtensionInput();
          resolve(value);
        },
        () => {
          opts?.signal?.removeEventListener("abort", onAbort);
          this.hideExtensionInput();
          resolve(undefined);
        },
        {
          tui: this.ui,
          timeout: opts?.timeout,
          initialValue: opts?.initialValue,
        },
      );

      this.editorContainer.clear();
      this.editorContainer.addChild(this.extensionInput);
      this.ui.setFocus(this.extensionInput);
      this.ui.requestRender();
    });
  }

  /**
   * Hide the extension input.
   */
  private hideExtensionInput(): void {
    this.dismissExtensionInput();
    this.ui.requestRender();
  }

  /**
   * Show a multi-line editor for extensions (with Ctrl+G support).
   */
  private showExtensionEditor(
    title: string,
    prefill?: string,
  ): Promise<string | undefined> {
    return new Promise((resolve) => {
      this.dismissActiveExtensionPrompt(false);
      this.extensionEditor = new ExtensionEditorComponent(
        this.ui,
        this.keybindings,
        title,
        prefill,
        (value) => {
          this.hideExtensionEditor();
          resolve(value);
        },
        () => {
          this.hideExtensionEditor();
          resolve(undefined);
        },
      );

      this.editorContainer.clear();
      this.editorContainer.addChild(this.extensionEditor);
      this.ui.setFocus(this.extensionEditor);
      this.ui.requestRender();
    });
  }

  /**
   * Hide the extension editor.
   */
  private hideExtensionEditor(): void {
    this.dismissExtensionEditor();
    this.ui.requestRender();
  }

  /**
   * Set a custom editor component from an extension.
   * Pass undefined to restore the default editor.
   */
  private setCustomEditorComponent(
    factory:
      | ((
          tui: TUI,
          theme: EditorTheme,
          keybindings: KeybindingsManager,
        ) => EditorComponent)
      | undefined,
  ): void {
    // Save text from current editor before switching
    const currentText = this.editor.getText();

    this.editorContainer.clear();

    if (factory) {
      // Create the custom editor with tui, theme, and keybindings
      const newEditor = factory(this.ui, getEditorTheme(), this.keybindings);

      // Wire up callbacks from the default editor
      newEditor.onSubmit = this.defaultEditor.onSubmit;
      newEditor.onChange = this.defaultEditor.onChange;

      // Copy text from previous editor
      newEditor.setText(currentText);

      // Copy appearance settings if supported
      if (newEditor.borderColor !== undefined) {
        newEditor.borderColor = this.defaultEditor.borderColor;
      }
      if (newEditor.setPaddingX !== undefined) {
        newEditor.setPaddingX(this.defaultEditor.getPaddingX());
      }

      // Set autocomplete if supported
      if (newEditor.setAutocompleteProvider && this.autocompleteProvider) {
        newEditor.setAutocompleteProvider(this.autocompleteProvider);
      }

      // If extending CustomEditor, copy app-level handlers
      // Use duck typing since instanceof fails across jiti module boundaries
      const customEditor = newEditor as unknown as Record<string, unknown>;
      if (
        "actionHandlers" in customEditor &&
        customEditor.actionHandlers instanceof Map
      ) {
        customEditor.onEscape = () => this.defaultEditor.onEscape?.();
        customEditor.onCtrlD = () => this.defaultEditor.onCtrlD?.();
        customEditor.onPasteImage = () => this.defaultEditor.onPasteImage?.();
        customEditor.onExtensionShortcut = (data: string) =>
          this.defaultEditor.onExtensionShortcut?.(data);
        // Copy action handlers (clear, suspend, model switching, etc.)
        for (const [action, handler] of this.defaultEditor.actionHandlers) {
          (customEditor.actionHandlers as Map<string, () => void>).set(
            action,
            handler,
          );
        }
      }

      this.editor = newEditor;
    } else {
      // Restore default editor with text from custom editor
      this.defaultEditor.setText(currentText);
      this.editor = this.defaultEditor;
    }

    this.remountEditorShell();
    this.ui.setFocus(this.editor as Component);
    this.ui.requestRender();
  }

  /**
   * Show a notification for extensions.
   */
  private showExtensionNotify(
    message: string,
    type?: "info" | "warning" | "error",
  ): void {
    if (type === "error") {
      this.showError(message);
    } else if (type === "warning") {
      this.showWarning(message);
    } else {
      this.showStatus(message);
    }
  }

  private shouldRenderToolTrace(toolName: string): boolean {
    if (toolName.startsWith("nanomem_")) {
      return this.settingsManager.getShowMemoryTrace();
    }
    return this.settingsManager.getShowWorkingTrace();
  }

  private hasActiveExtensionPrompt(): boolean {
    return !!(
      this.extensionSelector ||
      this.extensionInput ||
      this.extensionEditor
    );
  }

  private restoreEditorFocusIfPossible(): void {
    if (this.hasActiveExtensionPrompt()) {
      return;
    }

    if (this.editorContainer.children.includes(this.editorBuddyLayout)) {
      this.ui.setFocus(this.editor as Component);
    }
  }

  private dismissActiveExtensionPrompt(restoreEditorFocus = true): void {
    if (this.extensionSelector) {
      this.extensionSelector.dispose();
      this.extensionSelector = undefined;
    }

    if (this.extensionInput) {
      this.extensionInput.dispose();
      this.extensionInput = undefined;
    }

    if (this.extensionEditor) {
      this.extensionEditor = undefined;
    }

    this.remountEditorShell();

    if (restoreEditorFocus) {
      this.restoreEditorFocusIfPossible();
    }
  }

  private dismissExtensionSelector(restoreEditorFocus = true): void {
    const selector = this.extensionSelector;
    if (!selector) {
      return;
    }

    this.extensionSelector = undefined;
    selector.dispose();

    if (this.editorContainer.children.includes(selector)) {
      this.remountEditorShell();
    }

    if (restoreEditorFocus) {
      this.restoreEditorFocusIfPossible();
    }
  }

  private dismissExtensionInput(restoreEditorFocus = true): void {
    const input = this.extensionInput;
    if (!input) {
      return;
    }

    this.extensionInput = undefined;
    input.dispose();

    if (this.editorContainer.children.includes(input)) {
      this.remountEditorShell();
    }

    if (restoreEditorFocus) {
      this.restoreEditorFocusIfPossible();
    }
  }

  private dismissExtensionEditor(restoreEditorFocus = true): void {
    const extensionEditor = this.extensionEditor;
    if (!extensionEditor) {
      return;
    }

    this.extensionEditor = undefined;

    if (this.editorContainer.children.includes(extensionEditor)) {
      this.remountEditorShell();
    }

    if (restoreEditorFocus) {
      this.restoreEditorFocusIfPossible();
    }
  }

  /** Show a custom component with keyboard focus. Overlay mode renders on top of existing content. */
  private async showExtensionCustom<T>(
    factory: (
      tui: TUI,
      theme: Theme,
      keybindings: KeybindingsManager,
      done: (result: T) => void,
    ) =>
      | (Component & { dispose?(): void })
      | Promise<Component & { dispose?(): void }>,
    options?: {
      overlay?: boolean;
      overlayOptions?: OverlayOptions | (() => OverlayOptions);
      onHandle?: (handle: OverlayHandle) => void;
    },
  ): Promise<T> {
    const savedText = this.editor.getText();
    const isOverlay = options?.overlay ?? false;

    const restoreEditor = () => {
      this.remountEditorShell();
      this.editor.setText(savedText);
      this.ui.setFocus(this.editor);
      this.ui.requestRender();
    };

    return new Promise((resolve, reject) => {
      let component: Component & { dispose?(): void };
      let closed = false;

      const close = (result: T) => {
        if (closed) return;
        closed = true;
        if (isOverlay) this.ui.hideOverlay();
        else restoreEditor();
        // Note: both branches above already call requestRender
        resolve(result);
        try {
          component?.dispose?.();
        } catch {
          /* ignore dispose errors */
        }
      };

      Promise.resolve(factory(this.ui, theme, this.keybindings, close))
        .then((c) => {
          if (closed) return;
          component = c;
          if (isOverlay) {
            // Resolve overlay options - can be static or dynamic function
            const resolveOptions = (): OverlayOptions | undefined => {
              if (options?.overlayOptions) {
                const opts =
                  typeof options.overlayOptions === "function"
                    ? options.overlayOptions()
                    : options.overlayOptions;
                return opts;
              }
              // Fallback: use component's width property if available
              const w = (component as { width?: number }).width;
              return w ? { width: w } : undefined;
            };
            const handle = this.ui.showOverlay(component, resolveOptions());
            // Expose handle to caller for visibility control
            options?.onHandle?.(handle);
          } else {
            this.editorContainer.clear();
            this.editorContainer.addChild(component);
            this.ui.setFocus(component);
            this.ui.requestRender();
          }
        })
        .catch((err) => {
          if (closed) return;
          if (!isOverlay) restoreEditor();
          reject(err);
        });
    });
  }

  /**
   * Show an extension error in the UI.
   */
  private showExtensionError(
    extensionPath: string,
    error: string,
    stack?: string,
  ): void {
    const errorMsg = `Extension "${extensionPath}" error: ${error}`;
    const errorText = new Text(theme.fg("error", errorMsg), 1, 0);
    this.chatContainer.addChild(errorText);
    if (stack) {
      // Show stack trace in dim color, indented
      const stackLines = stack
        .split("\n")
        .slice(1) // Skip first line (duplicates error message)
        .map((line) => theme.fg("dim", `  ${line.trim()}`))
        .join("\n");
      if (stackLines) {
        this.chatContainer.addChild(new Text(stackLines, 1, 0));
      }
    }
    this.ui.requestRender();
  }

  // =========================================================================
  // Key Handlers
  // =========================================================================

  private setupKeyHandlers(): void {
    // Set up handlers on defaultEditor - they use this.editor for text access
    // so they work correctly regardless of which editor is active
    this.defaultEditor.onEscape = () => {
      if (this.loadingAnimation) {
        this.restoreQueuedMessagesToEditor({ abort: true });
      } else if (this.session.isStreaming) {
        this.agent.abort();
      } else if (this.session.isBashRunning) {
        this.session.abortBash();
      } else if (this.isBashMode) {
        this.editor.setText("");
        this.isBashMode = false;
        this.updateEditorBorderColor();
      } else if (!this.editor.getText().trim()) {
        // Double-escape with empty editor triggers /tree, /fork, or nothing based on setting
        const action = this.settingsManager.getDoubleEscapeAction();
        if (action !== "none") {
          const now = Date.now();
          if (now - this.lastEscapeTime < 500) {
            if (action === "tree") {
              this.showTreeSelector();
            } else {
              this.showUserMessageSelector();
            }
            this.lastEscapeTime = 0;
          } else {
            this.lastEscapeTime = now;
          }
        }
      }
    };

    // Register app action handlers
    this.defaultEditor.onAction("clear", () => this.handleCtrlC());
    this.defaultEditor.onAction("showResources", () =>
      this.handleShowResourcesCommand(),
    );
    this.defaultEditor.onCtrlD = () => this.handleCtrlD();
    this.defaultEditor.onAction("suspend", () => this.handleCtrlZ());
    this.defaultEditor.onAction("cycleThinkingLevel", () =>
      this.cycleThinkingLevel(),
    );
    this.defaultEditor.onAction("cycleModelForward", () =>
      this.cycleModel("forward"),
    );
    this.defaultEditor.onAction("cycleModelBackward", () =>
      this.cycleModel("backward"),
    );

    // Global debug handler on TUI (works regardless of focus)
    this.ui.onDebug = () => this.handleRenderDebugCommand();
    this.defaultEditor.onAction("selectModel", () =>
      this.showProviderThenModelSelector(),
    );
    this.defaultEditor.onAction("selectProviderThenModel", () =>
      this.showProviderThenModelSelector(),
    );
    this.defaultEditor.onAction("expandTools", () =>
      this.toggleToolOutputExpansion(),
    );
    this.defaultEditor.onAction("toggleThinking", () =>
      this.toggleThinkingBlockVisibility(),
    );
    this.defaultEditor.onAction("externalEditor", () =>
      this.openExternalEditor(),
    );
    this.defaultEditor.onAction("followUp", () => this.handleFollowUp());
    this.defaultEditor.onAction("dequeue", () => this.handleDequeue());
    this.defaultEditor.onAction("newSession", () => this.handleClearCommand());
    this.defaultEditor.onAction("tree", () => this.showTreeSelector());
    this.defaultEditor.onAction("fork", () => this.showUserMessageSelector());
    this.defaultEditor.onAction("resume", () => this.showSessionSelector());

    this.defaultEditor.onChange = (text: string) => {
      const wasBashMode = this.isBashMode;
      this.isBashMode = text.trimStart().startsWith("!");
      if (wasBashMode !== this.isBashMode) {
        this.updateEditorBorderColor();
      }
    };

    // Handle clipboard image paste (triggered on Ctrl+V)
    this.defaultEditor.onPasteImage = () => {
      this.handleClipboardImagePaste();
    };

    // Handle attachment navigation keys (arrow keys, delete)
    this.defaultEditor.onAttachmentKey = (data: string) => {
      return this.handleAttachmentKeyNavigation(data);
    };
  }

  private handleClipboardImagePaste(): void {
    this.enqueueClipboardPaste(() => this.loadClipboardImageIntoAttachments());
  }

  /**
   * Chain clipboard work so rapid Enter after paste still waits for attachment registration.
   */
  private enqueueClipboardPaste(task: () => Promise<void>): void {
    this.clipboardPastePromise = this.clipboardPastePromise
      .catch(() => undefined)
      .then(() => task())
      .catch(() => undefined);
  }

  private async loadClipboardImageIntoAttachments(): Promise<void> {
    try {
      const image = await readClipboardImage();
      if (!image) {
        return;
      }

      // Save to project root for cleanup tracking and optional tool reads.
      const ext = extensionForImageMimeType(image.mimeType) ?? "png";
      const seq = ++InteractiveMode.clipboardImageSeq;
      const fileName = `_np_clipboard_image_${seq}.${ext}`;
      const filePath = path.join(this.session.cwd, fileName);
      fs.writeFileSync(filePath, Buffer.from(image.bytes));

      this.clipboardImageFiles.push(filePath);
      // Keep a copy of bytes so submit uses memory (avoids races with disk/cleanup).
      this.attachments.push({
        path: filePath,
        mimeType: image.mimeType,
        bytes: Uint8Array.from(image.bytes),
      });
      this.updateAttachmentsBar();

      // Show success feedback to user
      const sizeKB = Math.round(image.bytes.length / 1024);
      this.showStatus(`Image pasted (${sizeKB} KB). Press Enter to send, ↑↓ Del to manage.`);
      this.ui.requestRender();
    } catch (error: unknown) {
      // Show user feedback for clipboard errors
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      this.showStatus(`Clipboard paste failed: ${errorMessage}`);
      this.ui.requestRender();
    }
  }

  private updateAttachmentsBar(): void {
    if (!this.attachmentsContainer) return;

    this.attachmentsContainer.clear();

    if (this.attachments.length === 0) {
      this.attachmentsBar = undefined;
      this.editorContainer.removeChild(this.attachmentsContainer);
      return;
    }

    // Ensure attachmentsContainer is placed before the editor in the layout
    if (!this.editorContainer.children.includes(this.attachmentsContainer)) {
      const editorIdx = this.editorContainer.children.indexOf(
        this.editorBuddyLayout,
      );
      if (editorIdx >= 0) {
        this.editorContainer.children.splice(
          editorIdx,
          0,
          this.attachmentsContainer,
        );
      } else {
        this.editorContainer.addChild(this.attachmentsContainer);
      }
    }

    const themeName = this.settingsManager.getTheme();
    const theme = getThemeByName(themeName || "dark") ?? getThemeByName("dark")!;
    this.attachmentsBar = new AttachmentsBarComponent(
      this.attachments,
      this.selectedAttachmentIndex,
      theme,
    );
    this.attachmentsContainer.addChild(this.attachmentsBar);
  }

  private deleteAttachment(index: number): void {
    if (index < 0 || index >= this.attachments.length) return;

    // Remove the attachment file
    const attachment = this.attachments[index];
    try {
      fs.unlinkSync(attachment.path);
    } catch {
      // Ignore file deletion errors
    }

    this.attachments.splice(index, 1);
    if (this.selectedAttachmentIndex >= this.attachments.length) {
      this.selectedAttachmentIndex = this.attachments.length - 1;
    }
    this.updateAttachmentsBar();
    this.ui.requestRender();
  }

  private handleAttachmentKeyNavigation(data: string): boolean {
    if (this.attachments.length === 0) return false;

    // Only intercept up/down arrows when multiple attachments need navigation.
    // With a single attachment, let the editor handle arrows for history browsing.
    if (this.attachments.length > 1) {
      if (matchesKey(data, "up")) {
        if (this.selectedAttachmentIndex < 0) {
          this.selectedAttachmentIndex = 0;
        } else if (this.selectedAttachmentIndex > 0) {
          this.selectedAttachmentIndex--;
        }
        this.updateAttachmentsBar();
        this.ui.requestRender();
        return true;
      }

      if (matchesKey(data, "down")) {
        if (this.selectedAttachmentIndex < 0) {
          this.selectedAttachmentIndex = 0;
        } else if (this.selectedAttachmentIndex < this.attachments.length - 1) {
          this.selectedAttachmentIndex++;
        }
        this.updateAttachmentsBar();
        this.ui.requestRender();
        return true;
      }
    }

    // Delete/backspace only removes attachment when one is explicitly selected
    if (
      this.selectedAttachmentIndex >= 0 &&
      (matchesKey(data, "delete") || matchesKey(data, "backspace"))
    ) {
      this.deleteAttachment(this.selectedAttachmentIndex);
      return true;
    }

    return false;
  }

  /**
   * Convert attachment files to ImageContent array for sending to the model.
   * Prefers in-memory bytes (clipboard) then falls back to disk read.
   */
  private async processAttachmentFiles(
    attachments: { path: string; mimeType?: string; bytes?: Uint8Array }[],
  ): Promise<ImageContent[]> {
    const supportedMime = new Set([
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
    ]);
    const normalizedMime = (raw?: string): string | null => {
      if (!raw) return null;
      const base = raw.split(";")[0]?.trim().toLowerCase() ?? "";
      return supportedMime.has(base) ? base : null;
    };

    const result: ImageContent[] = [];
    for (const attachment of attachments) {
      try {
        let mimeType = normalizedMime(attachment.mimeType);
        let base64Content: string;

        if (attachment.bytes && attachment.bytes.length > 0) {
          base64Content = Buffer.from(attachment.bytes).toString("base64");
          if (!mimeType) {
            mimeType = fs.existsSync(attachment.path)
              ? await detectSupportedImageMimeTypeFromFile(attachment.path)
              : null;
          }
        } else {
          if (!fs.existsSync(attachment.path)) continue;
          mimeType =
            mimeType ??
            (await detectSupportedImageMimeTypeFromFile(attachment.path));
          if (!mimeType) continue;
          base64Content = fs.readFileSync(attachment.path).toString("base64");
        }

        if (!mimeType) continue;

        const resized = await resizeImage({
          type: "image",
          data: base64Content,
          mimeType,
        });
        result.push({
          type: "image",
          mimeType: resized.mimeType,
          data: resized.data,
        });
      } catch (error: unknown) {
        // Skip unreadable attachment files but log the error for debugging
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        console.warn(`[Attachments] Skipped unreadable file ${attachment.path}: ${errorMessage}`);
      }
    }
    return result;
  }

  /**
   * Extract image file paths from text, read them as base64 ImageContent,
   * and return the cleaned text with image references plus the image array.
   */
  private async extractImagesFromText(
    text: string,
  ): Promise<{ text: string; images: ImageContent[] }> {
    const images: ImageContent[] = [];
    const tmpDir = os.tmpdir();

    // Match clipboard-pasted image paths (nanopencil-clipboard-UUID.ext)
    const clipboardImagePattern = new RegExp(
      `${tmpDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[/\\\\]nanopencil-clipboard-[a-f0-9-]+\\.(?:png|jpg|jpeg|gif|webp)`,
      "gi",
    );

    const matches = text.match(clipboardImagePattern);
    if (!matches) {
      return { text, images };
    }

    let cleanedText = text;
    for (const filePath of matches) {
      try {
        if (!fs.existsSync(filePath)) continue;

        const mimeType =
          await detectSupportedImageMimeTypeFromFile(filePath);
        if (!mimeType) continue;

        const content = fs.readFileSync(filePath);
        const base64Content = content.toString("base64");

        const resized = await resizeImage({
          type: "image",
          data: base64Content,
          mimeType,
        });
        const dimensionNote = formatDimensionNote(resized);

        images.push({
          type: "image",
          mimeType: resized.mimeType,
          data: resized.data,
        });

        // Replace file path in text with a reference
        const ref = dimensionNote
          ? `[image: ${path.basename(filePath)}] ${dimensionNote}`
          : `[image: ${path.basename(filePath)}]`;
        cleanedText = cleanedText.replace(filePath, ref);
      } catch {
        // Skip files that can't be read
      }
    }

    return { text: cleanedText, images };
  }

  private setupEditorSubmitHandler(): void {
    this.defaultEditor.onSubmit = async (text: string) => {
      text = text.trim();
      if (!text) return;

      await this.clipboardPastePromise;

      if (await this.executeBuiltinSlashCommand(text)) {
        return;
      }
      // Check for /persona command - support both standalone and mixed with other text
      // e.g., "Hello /persona use coder" should still trigger persona switch
      const personaMatch = text.match(/\s+\/persona\b/);
      if (personaMatch) {
        // Persona command is embedded in the message (e.g., "Hello /persona use coder")
        // Extract the persona command part and also process the rest as user message
        const personaCmd = text.slice(personaMatch.index! + 1);
        const remainingText = text.slice(0, personaMatch.index!).trim();

        this.editor.setText("");
        await this.handlePersonaCommand(personaCmd);

        // Also process the remaining text as user message
        if (remainingText) {
          await this.promptAfterRender(remainingText);
        }
        return;
      }
      if (text === "/persona" || text.startsWith("/persona ")) {
        this.editor.setText("");
        await this.handlePersonaCommand(text);
        return;
      }
      if (text === "/memory") {
        this.handleMemoryCommand();
        this.editor.setText("");
        return;
      }
      if (text === "/arminsayshi") {
        this.handleArminSaysHi();
        this.editor.setText("");
        return;
      }
      if (text === "/resume") {
        this.showSessionSelector();
        this.editor.setText("");
        return;
      }
      if (text === "/quit") {
        this.editor.setText("");
        await this.shutdown();
        return;
      }

      // Handle bash command (! for normal, !! for excluded from context)
      if (text.startsWith("!")) {
        const isExcluded = text.startsWith("!!");
        const command = isExcluded
          ? text.slice(2).trim()
          : text.slice(1).trim();
        if (command) {
          if (this.session.isBashRunning) {
            this.showWarning(
              "A bash command is already running. Press Esc to cancel it first.",
            );
            this.editor.setText(text);
            return;
          }
          this.editor.addToHistory?.(text);
          await this.handleBashCommand(command, isExcluded);
          this.isBashMode = false;
          this.updateEditorBorderColor();
          return;
        }
      }

      // Queue input during compaction (extension commands execute immediately)
      if (this.session.isCompacting) {
        if (this.isExtensionCommand(text)) {
          this.editor.addToHistory?.(text);
          this.editor.setText("");
          await this.promptAfterRender(text);
        } else {
          this.queueCompactionMessage(text, "steer");
        }
        return;
      }

      // If streaming, use prompt() with steer behavior
      // This handles extension commands (execute immediately), prompt template expansion, and queueing
      if (this.session.isStreaming) {
        this.editor.addToHistory?.(text);
        this.editor.setText("");

        // Display user's message in chat BEFORE processing (including extension commands like /plan)
        // This ensures users can see what they typed, even if it's a slash command
        const displayContent: (TextContent | ImageContent)[] = [
          { type: "text", text: text },
        ];
        this.optimisticUserMessages.push({ text: text });
        this.addMessageToChat({
          role: "user",
          content: displayContent,
          timestamp: Date.now(),
        } as AgentMessage);
        this.ui.requestRender();

        const steerResult = await this.extractImagesFromText(text);
        const steerImages = steerResult.images;
        let steerAttachmentPaths: string[] = [];
        if (this.attachments.length > 0) {
          const pendingAttachments = this.attachments.splice(0);
          this.selectedAttachmentIndex = -1;
          // Reset the sequence counter when all attachments are sent
          InteractiveMode.clipboardImageSeq = 0;
          this.updateAttachmentsBar();
          this.ui.requestRender();
          steerAttachmentPaths = pendingAttachments.map((a) => a.path);
        }
        // Drop images if model doesn't support them
        const steerModel = this.session.model;
        if (
          (steerImages.length > 0 || steerAttachmentPaths.length > 0) &&
          steerModel &&
          !steerModel.input.includes("image")
        ) {
          steerImages.length = 0;
          steerAttachmentPaths = [];
          // Suggest vision variant for GLM models
          let suggestion = "";
          if (steerModel.id === "glm-5" || steerModel.id === "glm-5-turbo") {
            suggestion = " Try glm-5v-turbo for image support.";
          } else if (steerModel.id === "glm-4.5" || steerModel.id === "glm-4.5-air") {
            suggestion = " Try glm-4.5v for image support.";
          }
          this.showStatus(`Images dropped: ${steerModel.name} does not support images.${suggestion}`);
          this.ui.requestRender();
        }
        let steerPromptText = steerResult.text;
        if (steerAttachmentPaths.length > 0) {
          const cwd = this.session.cwd;
          const refs = steerAttachmentPaths
            .map((p) => `@${path.relative(cwd, p).replace(/\\/g, "/")}`)
            .join(" ");
          steerPromptText = refs + "  " + steerPromptText;
        }
        await this.promptAfterRender(steerPromptText, {
          streamingBehavior: "steer",
          images: steerImages.length > 0 ? steerImages : undefined,
        });
        this.updatePendingMessagesDisplay();
        this.ui.requestRender();
        return;
      }

      // Normal message submission
      // First, move any pending bash components to chat
      this.flushPendingBashComponents();

      if (this.onInputCallback) {
        this.onInputCallback(text);
        this.editor.addToHistory?.(text);
        return;
      }

      this.editor.addToHistory?.(text);
      this.editor.setText("");

      // Extract images from clipboard-pasted file paths in the text
      const { text: processedText, images } =
        await this.extractImagesFromText(text);

      // Collect and clear pending attachments upfront (ensures cleanup even on error).
      // Clipboard images are read as inline base64 AND saved to disk. The inline
      // base64 is sent directly in the user message so the model sees the image
      // regardless of whether it uses the `read` tool or not.
      if (this.attachments.length > 0) {
        const pendingAttachments = this.attachments.splice(0);
        this.selectedAttachmentIndex = -1;
        // Reset the sequence counter when all attachments are sent
        InteractiveMode.clipboardImageSeq = 0;
        this.updateAttachmentsBar();
        this.ui.requestRender();
        const inlineImages = await this.processAttachmentFiles(pendingAttachments);
        images.push(...inlineImages);
      }

      // Check model image support; warn and drop images if not supported
      if (images.length > 0) {
        const currentModel = this.session.model;
        if (currentModel && !currentModel.input.includes("image")) {
          // Suggest vision variant for GLM models
          let suggestion = "";
          if (currentModel.id === "glm-5" || currentModel.id === "glm-5-turbo") {
            suggestion = " Try using glm-5v-turbo for image support.";
          } else if (currentModel.id === "glm-4.5" || currentModel.id === "glm-4.5-air") {
            suggestion = " Try using glm-4.5v for image support.";
          }
          this.showWarning(
            `Model "${currentModel.name}" does not support image input. Images have been removed from this message.${suggestion}`,
          );
          images.length = 0;
        }
      }

      if (!processedText.startsWith("/")) {
        const displayContent: (TextContent | ImageContent)[] = [
          { type: "text", text: processedText },
        ];
        if (images.length > 0) {
          displayContent.push(...images);
        }
        this.optimisticUserMessages.push({ text: processedText });
        this.addMessageToChat({
          role: "user",
          content: displayContent,
          timestamp: Date.now(),
        } as AgentMessage);
        this.ui.requestRender();
      }
      try {
        // Clear persona switch flag - interview should now run normally for subsequent messages
        delete process.env.NANOPENCIL_JUST_SWITCHED_PERSONA;
        await this.promptAfterRender(processedText, {
          images: images.length > 0 ? images : undefined,
        });
      } catch (error: unknown) {
        if (
          !text.startsWith("/") &&
          this.optimisticUserMessages.length > 0 &&
          this.optimisticUserMessages[0]?.text === processedText
        ) {
          this.optimisticUserMessages.shift();
        }
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error occurred";
        this.showError(errorMessage);
      }
      this.updatePendingMessagesDisplay();
      this.ui.requestRender();

      // Clean up temporary clipboard image files from project root
      this.cleanupClipboardImages();
    };
  }

  private async executeBuiltinSlashCommand(
    text: string,
    options?: { clearEditor?: boolean },
  ): Promise<boolean> {
    if (!text.startsWith("/")) return false;

    const clearEditor = options?.clearEditor ?? true;
    const clear = () => {
      if (clearEditor) {
        this.editor.setText("");
      }
    };

    if (text === "/settings") {
      this.showSettingsSelector();
      clear();
      return true;
    }
    if (text === "/apikey") {
      await this.handleApiKeyCommand();
      clear();
      return true;
    }
    if (text === "/scoped-models") {
      clear();
      await this.showModelsSelector();
      return true;
    }
    if (text === "/model" || text.startsWith("/model ")) {
      const searchTerm = text.startsWith("/model ")
        ? text.slice(7).trim()
        : undefined;
      clear();
      await this.handleModelCommand(searchTerm);
      return true;
    }
    if (text === "/thinking" || text.startsWith("/thinking ")) {
      this.handleThinkingCommand(text);
      clear();
      return true;
    }
    if (text === "/agent-loop" || text.startsWith("/agent-loop ")) {
      this.handleAgentLoopCommand(text);
      clear();
      return true;
    }
    if (text === "/mcp" || text.startsWith("/mcp ")) {
      await this.handleMcpCommand(text);
      clear();
      return true;
    }
    if (text.startsWith("/export")) {
      await this.handleExportCommand(text);
      clear();
      return true;
    }
    if (text === "/share") {
      await this.handleShareCommand();
      clear();
      return true;
    }
    if (text === "/copy") {
      this.handleCopyCommand();
      clear();
      return true;
    }
    if (text === "/status") {
      await this.handleStatusCommand();
      clear();
      return true;
    }
    if (text === "/usage") {
      await this.handleUsageCommand();
      clear();
      return true;
    }
    if (text === "/name" || text.startsWith("/name ")) {
      this.handleNameCommand(text);
      clear();
      return true;
    }
    if (text === "/session") {
      this.handleSessionCommand();
      clear();
      return true;
    }
    if (text === "/changelog") {
      this.handleChangelogCommand();
      clear();
      return true;
    }
    if (text === "/hotkeys") {
      this.handleHotkeysCommand();
      clear();
      return true;
    }
    if (text === "/resources") {
      this.handleShowResourcesCommand();
      clear();
      return true;
    }
    if (text === "/fork") {
      this.showUserMessageSelector();
      clear();
      return true;
    }
    if (text === "/tree") {
      this.showTreeSelector();
      clear();
      return true;
    }
    if (text === "/login" || text.startsWith("/login ")) {
      await this.handleLoginCommand(text);
      clear();
      return true;
    }
    if (text === "/logout") {
      this.showOAuthSelector("logout");
      clear();
      return true;
    }
    if (text === "/new") {
      clear();
      await this.handleClearCommand();
      return true;
    }
    if (text === "/update") {
      this.handleUpdateCommand();
      clear();
      return true;
    }
    if (text === "/reinstall") {
      this.handleReinstallCommand();
      clear();
      return true;
    }
    if (text === "/compact" || text.startsWith("/compact ")) {
      const customInstructions = text.startsWith("/compact ")
        ? text.slice(9).trim()
        : undefined;
      clear();
      await this.handleCompactCommand(customInstructions);
      return true;
    }
    if (text === "/reload") {
      clear();
      await this.handleReloadCommand();
      return true;
    }
    if (text === "/language" || text.startsWith("/language ")) {
      await this.handleLanguageCommand(text);
      clear();
      return true;
    }
    if (text === "/soul") {
      this.handleSoulCommand();
      clear();
      return true;
    }
    if (text === "/persona" || text.startsWith("/persona ")) {
      clear();
      await this.handlePersonaCommand(text);
      return true;
    }
    if (text === "/memory") {
      this.handleMemoryCommand();
      clear();
      return true;
    }
    if (text === "/arminsayshi") {
      this.handleArminSaysHi();
      clear();
      return true;
    }
    if (text === "/resume") {
      this.showSessionSelector();
      clear();
      return true;
    }
    if (text === "/quit") {
      clear();
      await this.shutdown();
      return true;
    }

    return false;
  }

  private cleanupStaleClipboardFiles(): void {
    try {
      const cwd = this.session.cwd;

      // Clean legacy clipboard files from older implementations.
      for (const entry of fs.readdirSync(cwd)) {
        if (
          /^_clipboard_\d+\.\w+$/.test(entry) ||
          /^_np_clipboard_image_\d+\.\w+$/.test(entry)
        ) {
          try { fs.unlinkSync(path.join(cwd, entry)); } catch { /* best-effort */ }
        }
      }
    } catch {
      // Ignore errors during cleanup
    }
  }

  private cleanupClipboardImages(): void {
    for (const filePath of this.clipboardImageFiles) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch {
        // Best-effort cleanup
      }
    }
    this.clipboardImageFiles = [];
  }

  private subscribeToAgent(): void {
    this.unsubscribe = this.session.subscribe(async (event) => {
      await this.handleEvent(event);
    });
  }

  private addSessionNavigationBanner(label: string): void {
    const sessionName = this.sessionManager.getSessionName();
    const sessionId = this.sessionManager.getSessionId();
    const namePart = sessionName ? ` "${sessionName}"` : "";
    const line = theme.fg(
      "dim",
      `↪ ${label} → session${namePart} (${sessionId})`,
    );
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(new Text(line, 1, 1));
    this.chatContainer.addChild(new Spacer(1));
  }

  private async handleEvent(event: AgentSessionEvent): Promise<void> {
    if (!this.isInitialized) {
      await this.init();
    }

    this.footer.invalidate();

    switch (event.type) {
      case "agent_start":
        // Restore main escape handler if retry handler is still active
        // (retry success event fires later, but we need main handler now)
        if (this.retryEscapeHandler) {
          this.defaultEditor.onEscape = this.retryEscapeHandler;
          this.retryEscapeHandler = undefined;
        }
        if (this.retryLoader) {
          (this.retryLoader as PencilLoader).stop();
          this.retryLoader = undefined;
        }
        if (this.loadingAnimation) {
          (this.loadingAnimation as PencilLoader).stop();
        }
        this.statusContainer.clear();
        this.loadingAnimation = new PencilLoader(
          this.ui,
          theme,
          this.defaultWorkingMessage,
          this.sessionManager.getSessionId(),
        );
        this.statusContainer.addChild(this.loadingAnimation);
        this.setBuddyPetState("working", "Working...");
        // Apply any pending working message queued before loader existed
        if (this.pendingWorkingMessage !== undefined) {
          this.workingMessageOverride = this.pendingWorkingMessage || undefined;
          this.pendingWorkingMessage = undefined;
        }
        this.startAgentRunTimer();
        this.updateWorkingMessage({ resetStallTimer: false });
        this.restoreEditorFocusIfPossible();
        this.ui.requestRender();
        break;

      case "message_start":
        if (event.message.role === "custom") {
          this.addMessageToChat(event.message);
          this.ui.requestRender();
        } else if (event.message.role === "user") {
          const textContent = this.getUserMessageText(event.message);
          if (
            this.optimisticUserMessages.length > 0 &&
            this.optimisticUserMessages[0]?.text === textContent
          ) {
            this.optimisticUserMessages.shift();
            this.updatePendingMessagesDisplay();
            this.ui.requestRender();
            break;
          }
          this.addMessageToChat(event.message);
          this.updatePendingMessagesDisplay();
          this.ui.requestRender();
        } else if (event.message.role === "assistant") {
          this.streamingComponent = new AssistantMessageComponent(
            undefined,
            this.hideThinkingBlock,
            this.getMarkdownThemeWithSettings(),
          );
          this.streamingMessage = event.message;
          this.chatContainer.addChild(this.streamingComponent);
          this.streamingComponent.updateContent(this.streamingMessage);
          this.ui.requestRender();
        }
        break;

      case "message_update":
        if (this.streamingComponent && event.message.role === "assistant") {
          // Reset stall timer on new output - spinner should not show as stuck
          if (this.loadingAnimation) {
            (this.loadingAnimation as PencilLoader).resetStallTimer();
          }
          this.streamingMessage = event.message;
          this.streamingComponent.updateContent(this.streamingMessage);

          for (const content of this.streamingMessage.content) {
            if (content.type === "toolCall") {
              if (!this.shouldRenderToolTrace(content.name)) {
                continue;
              }
              if (!this.pendingTools.has(content.id)) {
                this.chatContainer.addChild(new Text("", 0, 0));
                const component = new ToolExecutionComponent(
                  content.name,
                  content.arguments,
                  {
                    showImages: this.settingsManager.getShowImages(),
                  },
                  this.getRegisteredToolDefinition(content.name),
                  this.ui,
                );
                component.setExpanded(this.toolOutputExpanded);
                this.chatContainer.addChild(component);
                this.pendingTools.set(content.id, component);
              } else {
                const component = this.pendingTools.get(content.id);
                if (component) {
                  component.updateArgs(content.arguments);
                }
              }
            }
          }
          this.ui.requestRender();
        }
        break;

      case "message_end":
        if (event.message.role === "user") break;
        if (this.streamingComponent && event.message.role === "assistant") {
          this.streamingMessage = event.message;
          let errorMessage: string | undefined;
          if (this.streamingMessage.stopReason === "aborted") {
            const retryAttempt = this.session.retryAttempt;
            errorMessage =
              retryAttempt > 0
                ? `Aborted after ${retryAttempt} retry attempt${retryAttempt > 1 ? "s" : ""}`
                : "Operation aborted";
            this.streamingMessage.errorMessage = errorMessage;
          }
          this.streamingComponent.updateContent(this.streamingMessage);

          if (
            this.streamingMessage.stopReason === "aborted" ||
            this.streamingMessage.stopReason === "error"
          ) {
            if (!errorMessage) {
              errorMessage = this.streamingMessage.errorMessage || "Error";
            }
            for (const [, component] of this.pendingTools.entries()) {
              component.updateResult({
                content: [{ type: "text", text: errorMessage }],
                isError: true,
              });
            }
            this.pendingTools.clear();
          } else {
            // Args are now complete - trigger diff computation for edit tools
            for (const [, component] of this.pendingTools.entries()) {
              component.setArgsComplete();
            }
          }
          this.streamingComponent = undefined;
          this.streamingMessage = undefined;
          this.footer.invalidate();
        }
        this.ui.requestRender();
        break;

      case "tool_execution_start": {
        if (!this.shouldRenderToolTrace(event.toolName)) {
          break;
        }
        if (!this.pendingTools.has(event.toolCallId)) {
          const component = new ToolExecutionComponent(
            event.toolName,
            event.args,
            {
              showImages: this.settingsManager.getShowImages(),
            },
            this.getRegisteredToolDefinition(event.toolName),
            this.ui,
          );
          component.setExpanded(this.toolOutputExpanded);
          this.chatContainer.addChild(component);
          this.pendingTools.set(event.toolCallId, component);
          this.ui.requestRender();
        }
        break;
      }

      case "tool_execution_update": {
        const component = this.pendingTools.get(event.toolCallId);
        if (component) {
          component.updateResult(
            { ...event.partialResult, isError: false },
            true,
          );
          this.ui.requestRender();
        }
        break;
      }

      case "tool_execution_end": {
        const component = this.pendingTools.get(event.toolCallId);
        if (component) {
          component.updateResult({ ...event.result, isError: event.isError });
          this.pendingTools.delete(event.toolCallId);
          this.ui.requestRender();
        }
        break;
      }

      case "agent_end":
        const finalElapsed =
          this.agentRunStartMs !== undefined
            ? this.formatElapsedSeconds(Date.now() - this.agentRunStartMs)
            : undefined;
        this.stopAgentRunTimer();
        this.agentRunStartMs = undefined;
        this.workingMessageOverride = undefined;
        if (this.loadingAnimation) {
          (this.loadingAnimation as PencilLoader).stop();
          this.loadingAnimation = undefined;
          this.statusContainer.clear();
        }
        if (this.streamingComponent) {
          this.chatContainer.removeChild(this.streamingComponent);
          this.streamingComponent = undefined;
          this.streamingMessage = undefined;
        }
        this.pendingTools.clear();
        this.setBuddyPetState("happy", "Done!", {
          resetTo: "idle",
          afterMs: 1800,
        });
        if (finalElapsed) {
          this.showStatus(`Completed in ${finalElapsed}`);
        }

        await this.checkShutdownRequested();

        this.restoreEditorFocusIfPossible();
        this.ui.requestRender();
        break;

      case "auto_compaction_start": {
        // Keep editor active; submissions are queued during compaction.
        // Set up escape to abort auto-compaction
        this.autoCompactionEscapeHandler = this.defaultEditor.onEscape;
        this.defaultEditor.onEscape = () => {
          this.session.abortCompaction();
        };
        // Show compacting indicator with reason
        this.statusContainer.clear();
        const reasonText =
          event.reason === "overflow" ? "Context overflow detected, " : "";
        this.autoCompactionLoader = new PencilLoader(
          this.ui,
          theme,
          `${reasonText}Auto-compacting... (${appKey(this.keybindings, "interrupt")} to cancel)`,
        );
        this.statusContainer.addChild(this.autoCompactionLoader);
        this.ui.requestRender();
        break;
      }

      case "auto_compaction_end": {
        // Restore escape handler
        if (this.autoCompactionEscapeHandler) {
          this.defaultEditor.onEscape = this.autoCompactionEscapeHandler;
          this.autoCompactionEscapeHandler = undefined;
        }
        // Stop loader
        if (this.autoCompactionLoader) {
          (this.autoCompactionLoader as PencilLoader).stop();
          this.autoCompactionLoader = undefined;
          this.statusContainer.clear();
        }
        // Handle result
        if (event.aborted) {
          this.showStatus("Auto-compaction cancelled");
        } else if (event.result) {
          // Rebuild chat to show compacted state
          this.chatContainer.clear();
          this.rebuildChatFromMessages();
          // Add compaction component at bottom so user sees it without scrolling
          this.addMessageToChat({
            role: "compactionSummary",
            tokensBefore: event.result.tokensBefore,
            summary: event.result.summary,
            timestamp: Date.now(),
          });
          this.footer.invalidate();
        } else if (event.errorMessage) {
          // Compaction failed (e.g., quota exceeded, API error)
          this.chatContainer.addChild(new Spacer(1));
          this.chatContainer.addChild(
            new Text(theme.fg("error", event.errorMessage), 1, 0),
          );
        }
        void this.flushCompactionQueue({ willRetry: event.willRetry });
        this.ui.requestRender();
        break;
      }

      case "auto_retry_start": {
        // Set up escape to abort retry
        this.retryEscapeHandler = this.defaultEditor.onEscape;
        this.defaultEditor.onEscape = () => {
          this.session.abortRetry();
        };
        // Show retry indicator
        this.statusContainer.clear();
        const delaySeconds = Math.round(event.delayMs / 1000);
        this.retryLoader = new PencilLoader(
          this.ui,
          theme,
          `Retrying (${event.attempt}/${event.maxAttempts}) in ${delaySeconds}s... (${appKey(this.keybindings, "interrupt")} to cancel)`,
        );
        this.statusContainer.addChild(this.retryLoader);
        this.ui.requestRender();
        break;
      }

      case "auto_retry_end": {
        // Restore escape handler
        if (this.retryEscapeHandler) {
          this.defaultEditor.onEscape = this.retryEscapeHandler;
          this.retryEscapeHandler = undefined;
        }
        // Stop loader
        if (this.retryLoader) {
          (this.retryLoader as PencilLoader).stop();
          this.retryLoader = undefined;
          this.statusContainer.clear();
        }
        // Show error only on final failure (success shows normal response)
        if (!event.success) {
          this.showError(
            `Retry failed after ${event.attempt} attempts: ${event.finalError || "Unknown error"}`,
          );
        }
        this.ui.requestRender();
        break;
      }
    }
  }

  /** Extract text content from a user message */
  private getUserMessageText(message: Message): string {
    if (message.role !== "user") return "";
    const textBlocks =
      typeof message.content === "string"
        ? [{ type: "text", text: message.content }]
        : message.content.filter((c: { type: string }) => c.type === "text");
    return textBlocks.map((c) => (c as { text: string }).text).join("");
  }

  /**
   * Show a status message in the chat.
   *
   * If multiple status messages are emitted back-to-back (without anything else being added to the chat),
   * we update the previous status line instead of appending new ones to avoid log spam.
   */
  private showStatus(message: string): void {
    const children = this.chatContainer.children;
    const last =
      children.length > 0 ? children[children.length - 1] : undefined;
    const secondLast =
      children.length > 1 ? children[children.length - 2] : undefined;

    if (
      last &&
      secondLast &&
      last === this.lastStatusText &&
      secondLast === this.lastStatusSpacer
    ) {
      this.lastStatusText.setText(theme.fg("dim", message));
      this.ui.requestRender();
      return;
    }

    const spacer = new Spacer(1);
    const text = new Text(theme.fg("dim", message), 1, 0);
    this.chatContainer.addChild(spacer);
    this.chatContainer.addChild(text);
    this.lastStatusSpacer = spacer;
    this.lastStatusText = text;
    this.ui.requestRender();
  }

  private addMessageToChat(
    message: AgentMessage,
    options?: { populateHistory?: boolean },
  ): void {
    switch (message.role) {
      case "bashExecution": {
        const component = new BashExecutionComponent(
          message.command,
          this.ui,
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
        this.chatContainer.addChild(component);
        break;
      }
      case "custom": {
        if (message.display) {
          const details =
            typeof message.details === "object" && message.details !== null
              ? (message.details as { streamKey?: string; replace?: boolean })
              : undefined;
          if (details?.replace && details.streamKey) {
            const existing = this.customStreamComponents.get(details.streamKey);
            if (existing) {
              existing.updateMessage(message);
              this.ui.requestRender();
              break;
            }
          }
          const renderer = this.session.extensionRunner?.getMessageRenderer(
            message.customType,
          );
          const component = new CustomMessageComponent(
            message,
            renderer,
            this.getMarkdownThemeWithSettings(),
          );
          component.setExpanded(this.toolOutputExpanded);
          this.chatContainer.addChild(component);
          if (details?.streamKey) {
            this.customStreamComponents.set(details.streamKey, component);
          }
        }
        break;
      }
      case "compactionSummary": {
        this.chatContainer.addChild(new Spacer(1));
        const component = new CompactionSummaryMessageComponent(
          message,
          this.getMarkdownThemeWithSettings(),
        );
        component.setExpanded(this.toolOutputExpanded);
        this.chatContainer.addChild(component);
        break;
      }
      case "branchSummary": {
        this.chatContainer.addChild(new Spacer(1));
        const component = new BranchSummaryMessageComponent(
          message,
          this.getMarkdownThemeWithSettings(),
        );
        component.setExpanded(this.toolOutputExpanded);
        this.chatContainer.addChild(component);
        break;
      }
      case "user": {
        const textContent = this.getUserMessageText(message);
        if (textContent) {
          const skillBlock = parseSkillBlock(textContent);
          if (skillBlock) {
            // Render skill block (collapsible)
            this.chatContainer.addChild(new Spacer(1));
            const component = new SkillInvocationMessageComponent(
              skillBlock,
              this.getMarkdownThemeWithSettings(),
            );
            component.setExpanded(this.toolOutputExpanded);
            this.chatContainer.addChild(component);
            // Render user message separately if present
            if (skillBlock.userMessage) {
              const userComponent = new UserMessageComponent(
                skillBlock.userMessage,
                this.getMarkdownThemeWithSettings(),
              );
              this.chatContainer.addChild(userComponent);
            }
          } else {
            const userComponent = new UserMessageComponent(
              textContent,
              this.getMarkdownThemeWithSettings(),
            );
            this.chatContainer.addChild(userComponent);
          }
          if (options?.populateHistory) {
            this.editor.addToHistory?.(textContent);
          }
        }
        break;
      }
      case "assistant": {
        const assistantComponent = new AssistantMessageComponent(
          message,
          this.hideThinkingBlock,
          this.getMarkdownThemeWithSettings(),
        );
        this.chatContainer.addChild(assistantComponent);
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
    options: { updateFooter?: boolean; populateHistory?: boolean } = {},
  ): void {
    this.pendingTools.clear();
    this.customStreamComponents.clear();

    if (options.updateFooter) {
      this.footer.invalidate();
      this.updateEditorBorderColor();
    }

    for (const message of sessionContext.messages) {
      // Assistant messages need special handling for tool calls
      if (message.role === "assistant") {
        this.addMessageToChat(message);
        // Render tool call components
        for (const content of message.content) {
          if (content.type === "toolCall") {
            const component = new ToolExecutionComponent(
              content.name,
              content.arguments,
              { showImages: this.settingsManager.getShowImages() },
              this.getRegisteredToolDefinition(content.name),
              this.ui,
            );
            component.setExpanded(this.toolOutputExpanded);
            this.chatContainer.addChild(component);

            if (
              message.stopReason === "aborted" ||
              message.stopReason === "error"
            ) {
              let errorMessage: string;
              if (message.stopReason === "aborted") {
                const retryAttempt = this.session.retryAttempt;
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
              this.pendingTools.set(content.id, component);
            }
          }
        }
      } else if (message.role === "toolResult") {
        // Match tool results to pending tool components
        const component = this.pendingTools.get(message.toolCallId);
        if (component) {
          component.updateResult(message);
          this.pendingTools.delete(message.toolCallId);
        }
      } else {
        // All other messages use standard rendering
        this.addMessageToChat(message, options);
      }
    }

    this.pendingTools.clear();
    this.ui.requestRender();
  }

  renderInitialMessages(): void {
    this.stopWelcomeBannerTimer();

    // Get aligned messages and entries from session context
    const context = this.sessionManager.buildSessionContext();
    this.renderSessionContext(context, {
      updateFooter: true,
      populateHistory: true,
    });

    // Show welcome when session has no messages
    if (context.messages.length === 0) {
      this.chatContainer.addChild(new Spacer(1));
      if (APP_NAME === "nanopencil") {
        const cwd = this.session.cwd;
        const model = this.session.model;
        const modelLine =
          model?.name ??
          (model?.provider ? `${model.provider}` : "DashScope · Ollama");
        const buildAsciiLines = (frame: number) => {
          const blink = frame % 8 === 5;
          const leftStar = frame % 4 < 2 ? "*" : ".";
          const rightStar = frame % 4 >= 2 ? "*" : ".";
          const lines = [
            `             ${leftStar}     ,MMM8&&&.            ${rightStar}`,
            "                  MMMM88&&&&&    .",
            "                 MMMM88&&&&&&&",
            "     *           MMM88&&&&&&&&",
            "                 MMM88&&&&&&&&",
            "                 'MMM88&&&&&&'",
            `                   'MMM8&&&'      ${rightStar}    _`,
            "          |\\___/|                      \\\\",
            "          )     (    |\\_/|              ||    '",
            blink
              ? '         =\\     /=   )- - \'._.-""""-.  //'
              : '         =\\     /=   )a a \'._.-""""-.  //',
            "           )===(    =\\T_= /    ~  ~  \\//",
            "          /     \\     `\"`\\   ~   / ~  /",
            "          |     |         |~   \\ |  ~/",
            "         /       \\         \\  ~/- \\ ~\\",
            "         \\       /         || |  // /`",
            "     _/\\_/\\_   _/_/\\_/\\_/\\_((_|\\((_//\\_/\\_/\\_",
            "  |  |  |  |( (  |  |  |  |  |  |  |  |  |  |",
            "  |  |  |  | ) ) |  |  |  |  |  |  |  |  |  |",
            "  |  |  |  |(_(  |  |  |  |  |  |  |  |  |  |",
            "  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |",
            "  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |",
          ];
          const width = Math.max(...lines.map((line) => line.length));
          return lines.map((line) => line.padEnd(width));
        };
        const renderAscii = (frame: number) =>
          buildAsciiLines(frame)
            .map((line) =>
              theme.fg(
                "accent",
                line.slice(0, Math.max(1, this.ui.terminal.columns || 80)),
              ),
            )
            .join("\n");
        const titleLine = theme.bold(
          theme.fg("accent", `nano-pencil v${this.version}`),
        );
        const subtitleLine = theme.fg("dim", modelLine);
        const cwdLine = theme.fg("dim", cwd);
        const hintLine = theme.fg("dim", "  /model to switch model");
        const showResourcesKey = this.getAppKeyDisplay("showResources");
        const resourcesHint = this.settingsManager.getQuietStartup()
          ? theme.fg(
              "dim",
              `  ${showResourcesKey} to show context/skills/extensions`,
            )
          : "";
        const sep = theme.fg(
          "borderMuted",
          "─".repeat(Math.max(40, this.ui.terminal.columns || 80)),
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
        this.chatContainer.addChild(bannerText);
        let frame = 0;
        this.welcomeBannerTimer = setInterval(() => {
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
          this.ui.requestRender();
          if (frame >= 16) {
            this.stopWelcomeBannerTimer();
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
        this.chatContainer.addChild(
          new Text(`${theme.fg("accent", asciiArt)}\n${tagline}`, 0, 0),
        );
      }
      this.chatContainer.addChild(new Spacer(1));
    }

    // Show compaction info if session was compacted
    const allEntries = this.sessionManager.getEntries();
    const compactionCount = allEntries.filter(
      (e) => e.type === "compaction",
    ).length;
    if (compactionCount > 0) {
      const times =
        compactionCount === 1 ? "1 time" : `${compactionCount} times`;
      this.showStatus(`Session compacted ${times}`);
    }

    // Force full re-render to reset viewport state after rebuilding chat.
    // Without this, maxLinesRendered retains the old value and the viewport
    // may point past the actual content end after compaction or session switch.
    this.ui.requestRender(true);
  }

  async getUserInput(): Promise<string> {
    return new Promise((resolve) => {
      this.onInputCallback = (text: string) => {
        this.onInputCallback = undefined;
        resolve(text);
      };
    });
  }

  private rebuildChatFromMessages(): void {
    this.chatContainer.clear();
    const context = this.sessionManager.buildSessionContext();
    this.renderSessionContext(context);
    // Re-add optimistic user messages not yet persisted to session.
    // Cleared by chatContainer.clear() above but absent from buildSessionContext().
    for (const msg of this.optimisticUserMessages) {
      this.addMessageToChat({
        role: "user",
        content: [{ type: "text", text: msg.text }],
        timestamp: Date.now(),
      } as AgentMessage);
    }
    // Force full re-render to reset maxLinesRendered, which tracks the
    // terminal working area. After a clear+rebuild, content may be shorter
    // than the previous working area, causing the viewport to point past
    // the actual content end.
    this.ui.requestRender(true);
  }

  // =========================================================================
  // Key handlers
  // =========================================================================

  private handleCtrlC(): void {
    const now = Date.now();
    if (now - this.lastSigintTime < 500) {
      void this.shutdown();
    } else {
      this.clearEditor();
      this.lastSigintTime = now;
    }
  }

  private handleCtrlD(): void {
    // Only called when editor is empty (enforced by CustomEditor)
    void this.shutdown();
  }

  /**
   * Gracefully shutdown the agent.
   * Emits shutdown event to extensions (with timeout guard), then exits.
   */
  private isShuttingDown = false;

  private async shutdown(): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    // Emit shutdown event to extensions with a timeout guard.
    // Extensions (e.g. SAL eval sink) may need to flush HTTP requests,
    // but we must not hang indefinitely if a handler stalls.
    const extensionRunner = this.session.extensionRunner;
    if (extensionRunner?.hasHandlers("session_shutdown")) {
      const SHUTDOWN_TIMEOUT_MS = 5000;
      await Promise.race([
        extensionRunner.emit({ type: "session_shutdown" }),
        new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS)),
      ]);
    }

    // Clean up any clipboard image files before exit
    this.cleanupClipboardImages();

    // Wait for any pending renders to complete
    // requestRender() uses process.nextTick(), so we wait one tick
    await new Promise((resolve) => process.nextTick(resolve));

    // Drain any in-flight Kitty key release events before stopping.
    // This prevents escape sequences from leaking to the parent shell over slow SSH.
    await this.ui.terminal.drainInput(1000);

    this.stop();

    // Print session resume hint before exit
    const sessionId = this.sessionManager.getSessionId();
    const cwd = this.session.cwd;
    console.log(`\nResume this session with: nanopencil --session ${sessionId} --cwd "${cwd}"`);

    process.exit(0);
  }

  /**
   * Check if shutdown was requested and perform shutdown if so.
   */
  private async checkShutdownRequested(): Promise<void> {
    if (!this.shutdownRequested) return;
    await this.shutdown();
  }

  private handleCtrlZ(): void {
    // Set up handler to restore TUI when resumed
    process.once("SIGCONT", () => {
      this.ui.start();
      this.ui.requestRender(true);
    });

    // Stop the TUI (restore terminal to normal mode)
    this.ui.stop();

    // Send SIGTSTP to process group (pid=0 means all processes in group)
    process.kill(0, "SIGTSTP");
  }

  private async handleFollowUp(): Promise<void> {
    const text = (
      this.editor.getExpandedText?.() ?? this.editor.getText()
    ).trim();
    if (!text) return;

    // Queue input during compaction (extension commands execute immediately)
    if (this.session.isCompacting) {
      if (this.isExtensionCommand(text)) {
        this.editor.addToHistory?.(text);
        this.editor.setText("");
        await this.promptAfterRender(text);
      } else {
        this.queueCompactionMessage(text, "followUp");
      }
      return;
    }

    // Alt+Enter queues a follow-up message (waits until agent finishes)
    // This handles extension commands (execute immediately), prompt template expansion, and queueing
    if (this.session.isStreaming) {
      this.editor.addToHistory?.(text);
      this.editor.setText("");
      await this.promptAfterRender(text, { streamingBehavior: "followUp" });
      this.updatePendingMessagesDisplay();
      this.ui.requestRender();
    }
    // If not streaming, Alt+Enter acts like regular Enter (trigger onSubmit)
    else if (this.editor.onSubmit) {
      this.editor.onSubmit(text);
    }
  }

  private handleDequeue(): void {
    const restored = this.restoreQueuedMessagesToEditor();
    if (restored === 0) {
      this.showStatus("No queued messages to restore");
    } else {
      this.showStatus(
        `Restored ${restored} queued message${restored > 1 ? "s" : ""} to editor`,
      );
    }
  }

  private async promptAfterRender(
    text: string,
    options?: PromptOptions,
  ): Promise<void> {
    const renderAwareUi = this.ui as TUI & {
      awaitRender?: () => Promise<void>;
    };
    if (typeof renderAwareUi.awaitRender === "function") {
      await renderAwareUi.awaitRender();
    } else {
      await new Promise<void>((resolve) => process.nextTick(resolve));
    }
    await this.session.prompt(text, options);
  }

  private updateEditorBorderColor(): void {
    if (this.isBashMode) {
      this.editor.borderColor = theme.getBashModeBorderColor();
    } else {
      const level = this.session.thinkingLevel || "off";
      this.editor.borderColor = theme.getThinkingBorderColor(level);
    }
    this.ui.requestRender();
  }

  private cycleThinkingLevel(): void {
    const newLevel = this.session.cycleThinkingLevel();
    if (newLevel === undefined) {
      this.showStatus("Current model does not support thinking");
    } else {
      this.footer.invalidate();
      this.updateEditorBorderColor();
      this.showStatus(`Thinking level: ${newLevel}`);
    }
  }

  private handleThinkingCommand(text: string): void {
    const arg = text.slice("/thinking".length).trim().toLowerCase();
    const levels = this.session.getAvailableThinkingLevels();

    if (!arg) {
      this.showStatus(
        `Thinking level: ${this.session.thinkingLevel} (available: ${levels.join(", ")})`,
      );
      return;
    }

    if (!levels.includes(arg as ThinkingLevel)) {
      this.showStatus(`Unknown thinking level: ${arg} (available: ${levels.join(", ")})`);
      return;
    }

    this.session.setThinkingLevel(arg as ThinkingLevel);
    this.footer.invalidate();
    this.updateEditorBorderColor();
    this.showStatus(`Thinking level: ${this.session.thinkingLevel}`);
  }

  private handleAgentLoopCommand(text: string): void {
    const arg = text.slice("/agent-loop".length).trim().toLowerCase();
    const choices = ["standard", "weak-model-compatible"] as const;
    const normalized =
      arg === "high-intelligence" ? "standard" :
      arg === "low-intelligence" || arg === "structured-adaptive" ? "weak-model-compatible" :
      arg;

    if (!arg) {
      this.showStatus(
        `Agent loop: ${this.session.agentLoopFramework} (available: ${choices.join(", ")})`,
      );
      return;
    }

    if (!choices.includes(normalized as any)) {
      this.showError(
        `Unknown agent loop framework: ${arg}\nAvailable: ${choices.join(", ")}`,
      );
      return;
    }

    this.session.setAgentLoopFramework(normalized as any);
    this.footer.invalidate();
    this.showStatus(`Agent loop framework: ${this.session.agentLoopFramework}`);
  }

  private async cycleModel(direction: "forward" | "backward"): Promise<void> {
    try {
      const result = await this.session.cycleModel(direction);
      if (result === undefined) {
        const msg =
          this.session.scopedModels.length > 0
            ? "Only one model in scope"
            : "Only one model available";
        this.showStatus(msg);
      } else {
        this.footer.invalidate();
        this.updateEditorBorderColor();
        const thinkingStr =
          result.model.reasoning && result.thinkingLevel !== "off"
            ? ` (thinking: ${result.thinkingLevel})`
            : "";
        this.showStatus(
          `Switched to ${result.model.name || result.model.id}${thinkingStr}`,
        );
      }
    } catch (error) {
      // Check if this is an OAuth provider that needs re-login
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Check for CycleModelError with provider info
      if (error instanceof CycleModelError && error.provider) {
        const cred = this.session.modelRegistry.authStorage.get(error.provider);
        if (cred?.type === "oauth" || error.code === "oauth_expired") {
          this.showError(`${errorMsg}\nUse /login ${error.provider} to re-authenticate.`);
        } else {
          this.showError(errorMsg);
        }
      } else {
        this.showError(errorMsg);
      }
    }
  }

  private toggleToolOutputExpansion(): void {
    this.setToolsExpanded(!this.toolOutputExpanded);
  }

  private setToolsExpanded(expanded: boolean): void {
    this.toolOutputExpanded = expanded;
    for (const child of this.chatContainer.children) {
      if (isExpandable(child)) {
        child.setExpanded(expanded);
      }
    }
    this.ui.requestRender();
  }

  private toggleThinkingBlockVisibility(): void {
    this.hideThinkingBlock = !this.hideThinkingBlock;
    this.settingsManager.setHideThinkingBlock(this.hideThinkingBlock);

    // Rebuild chat from session messages
    this.chatContainer.clear();
    this.rebuildChatFromMessages();

    // If streaming, re-add the streaming component with updated visibility and re-render
    if (this.streamingComponent && this.streamingMessage) {
      this.streamingComponent.setHideThinkingBlock(this.hideThinkingBlock);
      this.streamingComponent.updateContent(this.streamingMessage);
      this.chatContainer.addChild(this.streamingComponent);
    }

    this.showStatus(
      `Thinking blocks: ${this.hideThinkingBlock ? "hidden" : "visible"}`,
    );
  }

  private openExternalEditor(): void {
    // Determine editor (respect $VISUAL, then $EDITOR)
    const editorCmd = process.env.VISUAL || process.env.EDITOR;
    if (!editorCmd) {
      this.showWarning(
        "No editor configured. Set $VISUAL or $EDITOR environment variable.",
      );
      return;
    }

    const currentText =
      this.editor.getExpandedText?.() ?? this.editor.getText();
    const tmpFile = path.join(os.tmpdir(), `nanopencil-editor-${Date.now()}.nanopencil.md`);

    try {
      // Write current content to temp file
      fs.writeFileSync(tmpFile, currentText, "utf-8");

      // Stop TUI to release terminal
      this.ui.stop();

      // Split by space to support editor arguments (e.g., "code --wait")
      const [editor, ...editorArgs] = editorCmd.split(" ");

      // Spawn editor synchronously with inherited stdio for interactive editing
      const result = spawnSync(editor, [...editorArgs, tmpFile], {
        stdio: "inherit",
      });

      // On successful exit (status 0), replace editor content
      if (result.status === 0) {
        const newContent = fs.readFileSync(tmpFile, "utf-8").replace(/\n$/, "");
        this.editor.setText(newContent);
      }
      // On non-zero exit, keep original text (no action needed)
    } finally {
      // Clean up temp file
      try {
        fs.unlinkSync(tmpFile);
      } catch {
        // Ignore cleanup errors
      }

      // Restart TUI
      this.ui.start();
      // Force full re-render since external editor uses alternate screen
      this.ui.requestRender(true);
    }
  }

  private async openExistingFileInExternalEditor(filePath: string): Promise<boolean> {
    const editorCmd = process.env.VISUAL || process.env.EDITOR;
    if (!editorCmd) {
      this.showWarning(
        "No editor configured. Set $VISUAL or $EDITOR environment variable.",
      );
      return false;
    }

    try {
      this.ui.stop();
      const [editor, ...editorArgs] = editorCmd.split(" ");
      const result = spawnSync(editor, [...editorArgs, filePath], {
        stdio: "inherit",
      });
      return result.status === 0;
    } finally {
      this.ui.start();
      this.ui.requestRender(true);
    }
  }

  // =========================================================================
  // UI helpers
  // =========================================================================

  clearEditor(): void {
    this.editor.setText("");
    this.ui.requestRender();
  }

  showError(errorMessage: string): void {
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(
      new Text(theme.fg("error", `Error: ${errorMessage}`), 1, 0),
    );
    this.setBuddyPetState("error", "Oops...", {
      resetTo: "idle",
      afterMs: 2200,
    });
    this.ui.requestRender();
  }

  showWarning(warningMessage: string): void {
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(
      new Text(theme.fg("warning", `Warning: ${warningMessage}`), 1, 0),
    );
    this.setBuddyPetState("error", "Careful.", {
      resetTo: "idle",
      afterMs: 1800,
    });
    this.ui.requestRender();
  }

  showNewVersionNotification(newVersion: string): void {
    const action = theme.fg("accent", getUpdateInstruction(PACKAGE_NAME));
    const updateInstruction =
      theme.fg("muted", `New version ${newVersion} is available. `) + action;

    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(
      new DynamicBorder((text) => theme.fg("warning", text)),
    );
    this.chatContainer.addChild(
      new Text(
        `${theme.bold(theme.fg("warning", "Update Available"))}\n${updateInstruction}`,
        1,
        0,
      ),
    );
    this.chatContainer.addChild(
      new DynamicBorder((text) => theme.fg("warning", text)),
    );
    this.ui.requestRender();
  }

  /**
   * Get all queued messages (read-only).
   * Combines session queue and compaction queue.
   */
  private getAllQueuedMessages(): { steering: string[]; followUp: string[] } {
    return {
      steering: [
        ...this.session.getSteeringMessages(),
        ...this.compactionQueuedMessages
          .filter((msg) => msg.mode === "steer")
          .map((msg) => msg.text),
      ],
      followUp: [
        ...this.session.getFollowUpMessages(),
        ...this.compactionQueuedMessages
          .filter((msg) => msg.mode === "followUp")
          .map((msg) => msg.text),
      ],
    };
  }

  /**
   * Clear all queued messages and return their contents.
   * Clears both session queue and compaction queue.
   */
  private clearAllQueues(): { steering: string[]; followUp: string[] } {
    const { steering, followUp } = this.session.clearQueue();
    const compactionSteering = this.compactionQueuedMessages
      .filter((msg) => msg.mode === "steer")
      .map((msg) => msg.text);
    const compactionFollowUp = this.compactionQueuedMessages
      .filter((msg) => msg.mode === "followUp")
      .map((msg) => msg.text);
    this.compactionQueuedMessages = [];
    return {
      steering: [...steering, ...compactionSteering],
      followUp: [...followUp, ...compactionFollowUp],
    };
  }

  private updatePendingMessagesDisplay(): void {
    this.pendingMessagesContainer.clear();
    const { steering: steeringMessages, followUp: followUpMessages } =
      this.getAllQueuedMessages();
    if (steeringMessages.length > 0 || followUpMessages.length > 0) {
      this.pendingMessagesContainer.addChild(new Spacer(1));
      for (const message of steeringMessages) {
        const text = theme.fg("dim", `Steering: ${message}`);
        this.pendingMessagesContainer.addChild(new TruncatedText(text, 1, 0));
      }
      for (const message of followUpMessages) {
        const text = theme.fg("dim", `Follow-up: ${message}`);
        this.pendingMessagesContainer.addChild(new TruncatedText(text, 1, 0));
      }
      const dequeueHint = this.getAppKeyDisplay("dequeue");
      const hintText = theme.fg(
        "dim",
        `↳ ${dequeueHint} to edit all queued messages`,
      );
      this.pendingMessagesContainer.addChild(new TruncatedText(hintText, 1, 0));
    }
  }

  private restoreQueuedMessagesToEditor(options?: {
    abort?: boolean;
    currentText?: string;
  }): number {
    const { steering, followUp } = this.clearAllQueues();
    const allQueued = [...steering, ...followUp];
    if (allQueued.length === 0) {
      this.updatePendingMessagesDisplay();
      if (options?.abort) {
        this.agent.abort();
      }
      return 0;
    }
    const queuedText = allQueued.join("\n\n");
    const currentText = options?.currentText ?? this.editor.getText();
    const combinedText = [queuedText, currentText]
      .filter((t) => t.trim())
      .join("\n\n");
    this.editor.setText(combinedText);
    this.updatePendingMessagesDisplay();
    if (options?.abort) {
      this.agent.abort();
    }
    return allQueued.length;
  }

  private queueCompactionMessage(
    text: string,
    mode: "steer" | "followUp",
  ): void {
    this.compactionQueuedMessages.push({ text, mode });
    this.editor.addToHistory?.(text);
    this.editor.setText("");
    this.updatePendingMessagesDisplay();
    this.showStatus("Queued message for after compaction");
  }

  private isExtensionCommand(text: string): boolean {
    if (!text.startsWith("/")) return false;

    const extensionRunner = this.session.extensionRunner;
    if (!extensionRunner) return false;

    const spaceIndex = text.indexOf(" ");
    const commandName =
      spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
    return !!extensionRunner.getCommand(commandName);
  }

  private async flushCompactionQueue(options?: {
    willRetry?: boolean;
  }): Promise<void> {
    if (this.compactionQueuedMessages.length === 0) {
      return;
    }

    const queuedMessages = [...this.compactionQueuedMessages];
    this.compactionQueuedMessages = [];
    this.updatePendingMessagesDisplay();

    const restoreQueue = (error: unknown) => {
      this.session.clearQueue();
      this.compactionQueuedMessages = queuedMessages;
      this.updatePendingMessagesDisplay();
      this.showError(
        `Failed to send queued message${queuedMessages.length > 1 ? "s" : ""}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    };

    try {
      if (options?.willRetry) {
        // When retry is pending, queue messages for the retry turn
        for (const message of queuedMessages) {
          if (this.isExtensionCommand(message.text)) {
            await this.promptAfterRender(message.text);
          } else if (message.mode === "followUp") {
            await this.session.followUp(message.text);
          } else {
            await this.session.steer(message.text);
          }
        }
        this.updatePendingMessagesDisplay();
        return;
      }

      // Find first non-extension-command message to use as prompt
      const firstPromptIndex = queuedMessages.findIndex(
        (message) => !this.isExtensionCommand(message.text),
      );
      if (firstPromptIndex === -1) {
        // All extension commands - execute them all
        for (const message of queuedMessages) {
          await this.promptAfterRender(message.text);
        }
        return;
      }

      // Execute any extension commands before the first prompt
      const preCommands = queuedMessages.slice(0, firstPromptIndex);
      const firstPrompt = queuedMessages[firstPromptIndex];
      const rest = queuedMessages.slice(firstPromptIndex + 1);

      for (const message of preCommands) {
        await this.promptAfterRender(message.text);
      }

      // Send first prompt (starts streaming)
      const promptPromise = this
        .promptAfterRender(firstPrompt.text)
        .catch((error) => {
          restoreQueue(error);
        });

      // Queue remaining messages
      for (const message of rest) {
        if (this.isExtensionCommand(message.text)) {
          await this.promptAfterRender(message.text);
        } else if (message.mode === "followUp") {
          await this.session.followUp(message.text);
        } else {
          await this.session.steer(message.text);
        }
      }
      this.updatePendingMessagesDisplay();
      void promptPromise;
    } catch (error) {
      restoreQueue(error);
    }
  }

  /** Move pending bash components from pending area to chat */
  private flushPendingBashComponents(): void {
    for (const component of this.pendingBashComponents) {
      this.pendingMessagesContainer.removeChild(component);
      this.chatContainer.addChild(component);
    }
    this.pendingBashComponents = [];
  }

  // =========================================================================
  // Selectors
  // =========================================================================

  /**
   * Shows a selector component in place of the editor.
   * @param create Factory that receives a `done` callback and returns the component and focus target
   */
  private showSelector(
    create: (done: () => void) => { component: Component; focus: Component },
  ): void {
    const done = () => {
      this.remountEditorShell();
      this.ui.setFocus(this.editor);
    };
    const { component, focus } = create(done);
    this.editorContainer.clear();
    this.editorContainer.addChild(component);
    this.ui.setFocus(focus);
    this.ui.requestRender();
  }

  private showSettingsSelector(): void {
    this.showSelector((done) => {
      const selector = new SettingsSelectorComponent(
        {
          autoCompact: this.session.autoCompactionEnabled,
          showImages: this.settingsManager.getShowImages(),
          autoResizeImages: this.settingsManager.getImageAutoResize(),
          blockImages: this.settingsManager.getBlockImages(),
          enableSkillCommands: this.settingsManager.getEnableSkillCommands(),
          steeringMode: this.session.steeringMode,
          followUpMode: this.session.followUpMode,
          transport: this.settingsManager.getTransport(),
          agentLoopFramework:
            this.settingsManager.getAgentLoopFramework() ?? "model-default",
          thinkingLevel: this.session.thinkingLevel,
          availableThinkingLevels: this.session.getAvailableThinkingLevels(),
          currentTheme: this.settingsManager.getTheme() || "dark",
          availableThemes: getAvailableThemes(),
          hideThinkingBlock: this.hideThinkingBlock,
          collapseChangelog: this.settingsManager.getCollapseChangelog(),
          doubleEscapeAction: this.settingsManager.getDoubleEscapeAction(),
          showHardwareCursor: this.settingsManager.getShowHardwareCursor(),
          editorPaddingX: this.settingsManager.getEditorPaddingX(),
          autocompleteMaxVisible:
            this.settingsManager.getAutocompleteMaxVisible(),
          quietStartup: this.settingsManager.getQuietStartup(),
          clearOnShrink: this.settingsManager.getClearOnShrink(),
          showTokenStats: this.settingsManager.getShowTokenStats(),
          buddyEnabled: this.settingsManager.getBuddyEnabled(),
          buddySpecies: this.settingsManager.getBuddySpecies(),
          showWorkingTrace: this.settingsManager.getShowWorkingTrace(),
          showMemoryTrace: this.settingsManager.getShowMemoryTrace(),
          presenceEnabled: this.settingsManager.getPresenceEnabled(),
        },
        {
          onAutoCompactChange: (enabled) => {
            this.session.setAutoCompactionEnabled(enabled);
            this.footer.setAutoCompactEnabled(enabled);
          },
          onShowImagesChange: (enabled) => {
            this.settingsManager.setShowImages(enabled);
            for (const child of this.chatContainer.children) {
              if (child instanceof ToolExecutionComponent) {
                child.setShowImages(enabled);
              }
            }
          },
          onAutoResizeImagesChange: (enabled) => {
            this.settingsManager.setImageAutoResize(enabled);
          },
          onBlockImagesChange: (blocked) => {
            this.settingsManager.setBlockImages(blocked);
          },
          onEnableSkillCommandsChange: (enabled) => {
            this.settingsManager.setEnableSkillCommands(enabled);
            this.setupAutocomplete(this.fdPath);
          },
          onSteeringModeChange: (mode) => {
            this.session.setSteeringMode(mode);
          },
          onFollowUpModeChange: (mode) => {
            this.session.setFollowUpMode(mode);
          },
          onTransportChange: (transport) => {
            this.settingsManager.setTransport(transport);
            this.session.agent.setTransport(transport);
          },
          onAgentLoopFrameworkChange: (framework) => {
            const value = framework === "model-default" ? undefined : framework;
            this.settingsManager.setAgentLoopFramework(value);
            this.session.setAgentLoopFramework(value as any);
            this.footer.invalidate();
            this.showStatus(`Agent loop: ${this.session.agentLoopFramework}`);
          },
          onThinkingLevelChange: (level) => {
            this.session.setThinkingLevel(level);
            this.footer.invalidate();
            this.updateEditorBorderColor();
          },
          onThemeChange: (themeName) => {
            const result = setTheme(themeName, true);
            this.settingsManager.setTheme(themeName);
            this.ui.invalidate();
            if (!result.success) {
              this.showError(
                `Failed to load theme "${themeName}": ${result.error}\nFell back to dark theme.`,
              );
            }
          },
          onThemePreview: (themeName) => {
            const result = setTheme(themeName, true);
            if (result.success) {
              this.ui.invalidate();
              this.ui.requestRender();
            }
          },
          onHideThinkingBlockChange: (hidden) => {
            this.hideThinkingBlock = hidden;
            this.settingsManager.setHideThinkingBlock(hidden);
            for (const child of this.chatContainer.children) {
              if (child instanceof AssistantMessageComponent) {
                child.setHideThinkingBlock(hidden);
              }
            }
            this.chatContainer.clear();
            this.rebuildChatFromMessages();
          },
          onCollapseChangelogChange: (collapsed) => {
            this.settingsManager.setCollapseChangelog(collapsed);
          },
          onQuietStartupChange: (enabled) => {
            this.settingsManager.setQuietStartup(enabled);
          },
          onShowWorkingTraceChange: (enabled) => {
            this.settingsManager.setShowWorkingTrace(enabled);
          },
          onShowMemoryTraceChange: (enabled) => {
            this.settingsManager.setShowMemoryTrace(enabled);
          },
          onDoubleEscapeActionChange: (action) => {
            this.settingsManager.setDoubleEscapeAction(action);
          },
          onShowHardwareCursorChange: (enabled) => {
            this.settingsManager.setShowHardwareCursor(enabled);
            this.ui.setShowHardwareCursor(enabled);
          },
          onEditorPaddingXChange: (padding) => {
            this.settingsManager.setEditorPaddingX(padding);
            this.defaultEditor.setPaddingX(padding);
            if (
              this.editor !== this.defaultEditor &&
              this.editor.setPaddingX !== undefined
            ) {
              this.editor.setPaddingX(padding);
            }
          },
          onAutocompleteMaxVisibleChange: (maxVisible) => {
            this.settingsManager.setAutocompleteMaxVisible(maxVisible);
            this.defaultEditor.setAutocompleteMaxVisible(maxVisible);
            if (
              this.editor !== this.defaultEditor &&
              this.editor.setAutocompleteMaxVisible !== undefined
            ) {
              this.editor.setAutocompleteMaxVisible(maxVisible);
            }
          },
          onClearOnShrinkChange: (enabled) => {
            this.settingsManager.setClearOnShrink(enabled);
            this.ui.setClearOnShrink(enabled);
          },
          onShowTokenStatsChange: (enabled) => {
            this.settingsManager.setShowTokenStats(enabled);
            this.footer.setShowTokenStats(enabled);
            this.ui.requestRender();
          },
          onBuddyEnabledChange: (enabled) => {
            this.settingsManager.setBuddyEnabled(enabled);
            this.syncBuddyPet();
          },
          onBuddySpeciesChange: (species) => {
            this.settingsManager.setBuddySpecies(species);
            this.syncBuddyPet();
          },
          onPresenceEnabledChange: (enabled) => {
            this.settingsManager.setPresenceEnabled(enabled);
          },
          onCancel: () => {
            done();
            this.ui.requestRender();
          },
        },
      );
      return { component: selector, focus: selector.getSettingsList() };
    });
  }

  private async handleModelCommand(searchTerm?: string): Promise<void> {
    if (!searchTerm) {
      this.showProviderThenModelSelector();
      return;
    }

    const model = await this.findExactModelMatch(searchTerm);
    if (model) {
      try {
        await this.session.setModel(model);
        this.footer.invalidate();
        this.updateEditorBorderColor();
        this.showStatus(`Model: ${model.id}`);
        this.checkDaxnutsEasterEgg(model);
      } catch (error) {
        this.showError(error instanceof Error ? error.message : String(error));
      }
      return;
    }

    this.showModelSelector(searchTerm);
  }

  /**
   * Handle /apikey command - allow user to update API key for current provider
   */
  private async handleApiKeyCommand(): Promise<void> {
    await this.handleProviderCredentialsCommand();
  }

  private getStoredApiKey(provider: string): string | undefined {
    const credential = this.session.modelRegistry.authStorage.get(provider);
    return credential?.type === "api_key" ? credential.key : undefined;
  }

  private resolveProviderId(input: string): string | undefined {
    const normalized = input.trim().toLowerCase();
    if (!normalized) return undefined;

    const providerMap = new Map<string, string>();
    for (const model of this.session.modelRegistry.getAll()) {
      providerMap.set(model.provider.toLowerCase(), model.provider);
    }
    for (const provider of getOAuthProviders()) {
      providerMap.set(provider.id.toLowerCase(), provider.id);
    }

    return providerMap.get(normalized);
  }

  private async promptForProviderApiKey(
    provider: string,
    options: { title?: string } = {},
  ): Promise<boolean> {
    const currentApiKey = this.getStoredApiKey(provider);
    const title = options.title ?? `Update API key for ${provider}`;
    const apiKey = await this.showExtensionInput(title, "API key", {
      initialValue: currentApiKey,
    });
    if (apiKey === undefined) {
      this.showStatus("Configuration cancelled");
      return false;
    }

    const trimmedApiKey = apiKey.trim();
    if (!trimmedApiKey) {
      this.showStatus("Configuration cancelled");
      return false;
    }

    this.session.modelRegistry.authStorage.set(provider, {
      type: "api_key",
      key: trimmedApiKey,
    });
    if (provider === NANOPENCIL_ALI_TOKEN_PLAN_OPENAI_PROVIDER) {
      this.session.modelRegistry.authStorage.set(
        NANOPENCIL_ALI_TOKEN_PLAN_ANTHROPIC_PROVIDER,
        {
          type: "api_key",
          key: trimmedApiKey,
        },
      );
    } else if (provider === NANOPENCIL_ALI_TOKEN_PLAN_ANTHROPIC_PROVIDER) {
      this.session.modelRegistry.authStorage.set(
        NANOPENCIL_ALI_TOKEN_PLAN_OPENAI_PROVIDER,
        {
          type: "api_key",
          key: trimmedApiKey,
        },
      );
    }
    this.session.modelRegistry.refresh();
    this.showStatus(`Updated API key for ${provider}`);
    return true;
  }

  private async handleLoginCommand(text: string): Promise<void> {
    const rawProvider = text.startsWith("/login ") ? text.slice(7).trim() : "";
    if (!rawProvider) {
      this.showOAuthSelector("login");
      return;
    }

    const providerId = this.resolveProviderId(rawProvider);
    if (!providerId) {
      this.showError(`Unknown provider: ${rawProvider}`);
      return;
    }

    const oauthProvider = getOAuthProviders().find((provider) => provider.id === providerId);
    if (oauthProvider) {
      await this.showLoginDialog(oauthProvider.id);
      return;
    }

    await this.promptForProviderApiKey(providerId, {
      title: `Set API key for ${providerId}`,
    });
  }

  private async handleProviderCredentialsCommand(): Promise<void> {
    const currentModel = this.session.model;

    // No model selected — let user pick a provider first
    if (!currentModel) {
      this.session.modelRegistry.refresh();
      const allModels = this.session.modelRegistry.getAll();
      const providers = [...new Set(allModels.map((m) => m.provider))].sort();
      if (providers.length === 0) {
        this.showStatus("No providers available");
        return;
      }
      this.showSelector((done) => {
        const selector = new ProviderSelectorComponent(
          providers,
          undefined,
          (provider) => {
            done();
            void (async () => {
              await this.promptForProviderApiKey(provider, {
                title: `Set API key for ${provider}`,
              });
              this.session.modelRegistry.refresh();
              this.showModelSelector(undefined, provider);
            })();
          },
          () => {
            done();
            this.ui.requestRender();
          },
        );
        return { component: selector, focus: selector };
      });
      return;
    }

    const provider = currentModel.provider;

    try {
      if (isCustomProtocolProvider(provider)) {
        const updated = await this.configureCustomProtocolProvider(provider, {
          force: true,
        });
        if (!updated) {
          this.showStatus("Configuration cancelled");
        }
        return;
      }

      await this.promptForProviderApiKey(provider);
    } catch (error) {
      this.showError(error instanceof Error ? error.message : String(error));
    }
  }

  private async ensureProviderConfiguredForSelection(
    model: Model<any>,
  ): Promise<boolean> {
    if (isCustomProtocolProvider(model.provider)) {
      return this.configureCustomProtocolProvider(model.provider);
    }

    // For standard providers: prompt for API key if none is stored and provider doesn't use OAuth
    const hasKey = await this.session.modelRegistry.getApiKey(model);
    if (!hasKey && !this.session.modelRegistry.isUsingOAuth(model)) {
      return this.promptForProviderApiKey(model.provider, {
        title: `API key for ${model.provider}`,
      });
    }

    return true;
  }

  private async configureCustomProtocolProvider(
    provider: CustomProtocolProviderId,
    options: { force?: boolean } = {},
  ): Promise<boolean> {
    const definition = getCustomProtocolProviderDefinition(provider);
    const modelsPath = getModelsPath();
    const authStorage = this.session.modelRegistry.authStorage;
    const currentBaseUrl =
      getCustomProtocolProviderBaseUrl(modelsPath, provider) ??
      definition.defaultBaseUrl;
    const currentModelName =
      getCustomProtocolProviderModelName(modelsPath, provider) ??
      "custom-model";
    const currentApiKey = this.getStoredApiKey(provider) ?? "";
    const hasExistingApiKey = authStorage.has(provider);

    if (
      !options.force &&
      hasExistingApiKey &&
      currentBaseUrl.trim() &&
      currentModelName.trim()
    ) {
      return true;
    }

    const baseUrl = await this.showExtensionInput(
      `${definition.label} base URL`,
      definition.defaultBaseUrl,
      { initialValue: currentBaseUrl },
    );
    if (baseUrl === undefined) {
      return false;
    }

    const trimmedBaseUrl = baseUrl.trim();
    if (!trimmedBaseUrl) {
      this.showError("Base URL cannot be empty.");
      return false;
    }

    const apiKeyInput = await this.showExtensionInput(
      `${definition.label} API key`,
      hasExistingApiKey && options.force
        ? "Leave empty to keep the current API key"
        : "API key",
      { initialValue: currentApiKey },
    );
    if (apiKeyInput === undefined) {
      return false;
    }

    const trimmedApiKey = apiKeyInput.trim();
    if (!trimmedApiKey && !hasExistingApiKey) {
      this.showError("API key cannot be empty.");
      return false;
    }

    const modelNameInput = await this.showExtensionInput(
      `${definition.label} model name`,
      "Model name",
      { initialValue: currentModelName },
    );
    if (modelNameInput === undefined) {
      return false;
    }

    const trimmedModelName = modelNameInput.trim();
    if (!trimmedModelName) {
      this.showError("Model name cannot be empty.");
      return false;
    }

    saveCustomProtocolProviderConfig(modelsPath, provider, {
      baseUrl: trimmedBaseUrl,
      modelName: trimmedModelName,
    });
    if (trimmedApiKey) {
      saveCustomProtocolProviderApiKey(authStorage, provider, trimmedApiKey);
    }

    this.session.modelRegistry.refresh();
    await this.refreshCurrentModelForProvider(provider, trimmedModelName);
    this.showStatus(`Saved ${definition.label} configuration`);
    return true;
  }

  private async refreshCurrentModelForProvider(
    provider: string,
    preferredModelId?: string,
  ): Promise<void> {
    const currentModel = this.session.model;
    if (!currentModel || currentModel.provider !== provider) {
      return;
    }

    const updatedModel =
      (preferredModelId
        ? this.session.modelRegistry.find(currentModel.provider, preferredModelId)
        : undefined) ??
      this.session.modelRegistry.find(currentModel.provider, currentModel.id);
    if (!updatedModel) {
      return;
    }

    await this.session.setModel(updatedModel);
    this.footer.invalidate();
    this.updateEditorBorderColor();
  }

  private async selectConfiguredCustomProvider(
    provider: CustomProtocolProviderId,
  ): Promise<void> {
    this.session.modelRegistry.refresh();
    const modelName = getCustomProtocolProviderModelName(getModelsPath(), provider);
    if (!modelName) {
      this.showError(`No model configured for ${provider}`);
      return;
    }

    const model = this.session.modelRegistry.find(provider, modelName);
    if (!model) {
      this.showError(`Configured model not found for ${provider}`);
      return;
    }

    await this.session.setModel(model);
    this.footer.invalidate();
    this.updateEditorBorderColor();
    this.showStatus(`Model: ${model.id}`);
    this.checkDaxnutsEasterEgg(model);
  }

  private async handleProviderSelectionFromSelector(
    provider: string,
    done: () => void,
  ): Promise<void> {
    done();
    this.ui.requestRender();

    if (!isCustomProtocolProvider(provider)) {
      this.showModelSelector(undefined, provider);
      return;
    }

    try {
      const configured = await this.configureCustomProtocolProvider(provider, {
        force: true,
      });
      if (!configured) {
        this.showStatus("Configuration cancelled");
        return;
      }

      await this.selectConfiguredCustomProvider(provider);
    } catch (error) {
      this.showError(error instanceof Error ? error.message : String(error));
    }
  }


  private async findExactModelMatch(
    searchTerm: string,
  ): Promise<Model<any> | undefined> {
    const term = searchTerm.trim();
    if (!term) return undefined;

    let targetProvider: string | undefined;
    let targetModelId = "";

    if (term.includes("/")) {
      const parts = term.split("/", 2);
      targetProvider = parts[0]?.trim().toLowerCase();
      targetModelId = parts[1]?.trim().toLowerCase() ?? "";
    } else {
      targetModelId = term.toLowerCase();
    }

    if (!targetModelId) return undefined;

    const models = await this.getModelCandidates();
    const exactMatches = models.filter((item) => {
      const idMatch = item.id.toLowerCase() === targetModelId;
      const providerMatch =
        !targetProvider || item.provider.toLowerCase() === targetProvider;
      return idMatch && providerMatch;
    });

    return exactMatches.length === 1 ? exactMatches[0] : undefined;
  }

  private async getModelCandidates(): Promise<Model<any>[]> {
    if (this.session.scopedModels.length > 0) {
      return this.session.scopedModels.map((scoped) => scoped.model);
    }

    this.session.modelRegistry.refresh();
    try {
      // Use getAll() so all providers (including Qianfan, Fangzhou) appear in /model selector;
      // user can configure key when selecting a model without auth
      return this.session.modelRegistry.getAll();
    } catch {
      return [];
    }
  }

  /** Update the footer's available provider count from current model candidates */
  private async updateAvailableProviderCount(): Promise<void> {
    const models = await this.getModelCandidates();
    const uniqueProviders = new Set(models.map((m) => m.provider));
    this.footerDataProvider.setAvailableProviderCount(uniqueProviders.size);
  }

  private showModelSelector(
    initialSearchInput?: string,
    filterByProvider?: string,
  ): void {
    this.showSelector((done) => {
      const selector = new ModelSelectorComponent(
        this.ui,
        this.session.model,
        this.settingsManager,
        this.session.modelRegistry,
        this.session.scopedModels,
        (model) => this.ensureProviderConfiguredForSelection(model),
        async (model) => {
          try {
            await this.session.setModel(model);
            this.footer.invalidate();
            this.updateEditorBorderColor();
            done();
            this.showStatus(`Model: ${model.id}`);
            this.checkDaxnutsEasterEgg(model);
          } catch (error) {
            done();
            // Check if this is an OAuth provider that needs re-login
            const errorMsg = error instanceof Error ? error.message : String(error);

            // Check for CycleModelError with provider info
            if (error instanceof CycleModelError && error.provider) {
              this.showError(`${errorMsg}\nUse /login ${error.provider} to re-authenticate.`);
            } else {
              this.showError(errorMsg);
            }
          }
        },
        () => {
          done();
          this.ui.requestRender();
        },
        initialSearchInput,
        filterByProvider,
        () => {
          void (async () => {
            done();
            const modelId = await this.showExtensionInput(
              "Add OpenRouter model",
              "Model id (e.g. x-ai/grok-4.20)",
            );
            if (!modelId?.trim()) {
              this.showModelSelector(initialSearchInput, filterByProvider);
              return;
            }
            const nameInput = await this.showExtensionInput(
              "Display name (optional)",
              "Leave empty to use model id",
              { initialValue: modelId.trim() },
            );
            if (nameInput === undefined) {
              this.showModelSelector(initialSearchInput, filterByProvider);
              return;
            }
            try {
              this.session.modelRegistry.appendOpenRouterModel(modelId.trim(), {
                name: nameInput.trim() || undefined,
              });
              this.showStatus(`Added OpenRouter model ${modelId.trim()}`);
            } catch (error) {
              this.showError(
                error instanceof Error ? error.message : String(error),
              );
            }
            this.showModelSelector(initialSearchInput, filterByProvider);
          })();
        },
      );
      return { component: selector, focus: selector };
    });
  }

  private async showProviderThenModelSelector(): Promise<void> {
    // Use getAll() so all providers (Qianfan, Fangzhou, etc.) appear; user can configure key when selecting
    this.session.modelRegistry.refresh();
    const allModels = this.session.modelRegistry.getAll();
    const providers = [...new Set(allModels.map((m) => m.provider))].sort();
    if (providers.length === 0) {
      this.showStatus("No providers available");
      return;
    }
    if (providers.length === 1) {
      this.showModelSelector(undefined, providers[0]);
      return;
    }
    this.showSelector((done) => {
      const selector = new ProviderSelectorComponent(
        providers,
        this.session.model?.provider,
        (provider) => {
          void this.handleProviderSelectionFromSelector(provider, done);
        },
        () => {
          done();
          this.ui.requestRender();
        },
      );
      return { component: selector, focus: selector };
    });
  }

  private async showModelsSelector(): Promise<void> {
    // Get all available models
    this.session.modelRegistry.refresh();
    const allModels = this.session.modelRegistry.getAvailable();

    if (allModels.length === 0) {
      this.showStatus("No models available");
      return;
    }

    // Check if session has scoped models (from previous session-only changes or CLI --models)
    const sessionScopedModels = this.session.scopedModels;
    const hasSessionScope = sessionScopedModels.length > 0;

    // Build enabled model IDs from session state or settings
    const enabledModelIds = new Set<string>();
    let hasFilter = false;

    if (hasSessionScope) {
      // Use current session's scoped models
      for (const sm of sessionScopedModels) {
        enabledModelIds.add(`${sm.model.provider}/${sm.model.id}`);
      }
      hasFilter = true;
    } else {
      // Fall back to settings
      const patterns = this.settingsManager.getEnabledModels();
      if (patterns !== undefined && patterns.length > 0) {
        hasFilter = true;
        const scopedModels = await resolveModelScope(
          patterns,
          this.session.modelRegistry,
        );
        for (const sm of scopedModels) {
          enabledModelIds.add(`${sm.model.provider}/${sm.model.id}`);
        }
      }
    }

    // Track current enabled state (session-only until persisted)
    const currentEnabledIds = new Set(enabledModelIds);
    let currentHasFilter = hasFilter;

    // Helper to update session's scoped models (session-only, no persist)
    const updateSessionModels = async (enabledIds: Set<string>) => {
      if (enabledIds.size > 0 && enabledIds.size < allModels.length) {
        // Use current session thinking level, not settings default
        const currentThinkingLevel = this.session.thinkingLevel;
        const newScopedModels = await resolveModelScope(
          Array.from(enabledIds),
          this.session.modelRegistry,
        );
        this.session.setScopedModels(
          newScopedModels.map((sm) => ({
            model: sm.model,
            thinkingLevel: sm.thinkingLevel ?? currentThinkingLevel,
          })),
        );
      } else {
        // All enabled or none enabled = no filter
        this.session.setScopedModels([]);
      }
      await this.updateAvailableProviderCount();
      this.ui.requestRender();
    };

    this.showSelector((done) => {
      const selector = new ScopedModelsSelectorComponent(
        {
          allModels,
          enabledModelIds: currentEnabledIds,
          hasEnabledModelsFilter: currentHasFilter,
        },
        {
          onModelToggle: async (modelId, enabled) => {
            if (enabled) {
              currentEnabledIds.add(modelId);
            } else {
              currentEnabledIds.delete(modelId);
            }
            currentHasFilter = true;
            await updateSessionModels(currentEnabledIds);
          },
          onEnableAll: async (allModelIds) => {
            currentEnabledIds.clear();
            for (const id of allModelIds) {
              currentEnabledIds.add(id);
            }
            currentHasFilter = false;
            await updateSessionModels(currentEnabledIds);
          },
          onClearAll: async () => {
            currentEnabledIds.clear();
            currentHasFilter = true;
            await updateSessionModels(currentEnabledIds);
          },
          onToggleProvider: async (_provider, modelIds, enabled) => {
            for (const id of modelIds) {
              if (enabled) {
                currentEnabledIds.add(id);
              } else {
                currentEnabledIds.delete(id);
              }
            }
            currentHasFilter = true;
            await updateSessionModels(currentEnabledIds);
          },
          onPersist: (enabledIds) => {
            // Persist to settings
            const newPatterns =
              enabledIds.length === allModels.length
                ? undefined // All enabled = clear filter
                : enabledIds;
            this.settingsManager.setEnabledModels(newPatterns);
            this.showStatus("Model selection saved to settings");
          },
          onCancel: () => {
            done();
            this.ui.requestRender();
          },
        },
      );
      return { component: selector, focus: selector };
    });
  }

  private showUserMessageSelector(): void {
    const userMessages = this.session.getUserMessagesForForking();

    if (userMessages.length === 0) {
      this.showStatus("No messages to fork from");
      return;
    }

    this.showSelector((done) => {
      const selector = new UserMessageSelectorComponent(
        userMessages.map((m) => ({ id: m.entryId, text: m.text })),
        async (entryId) => {
          const result = await this.session.fork(entryId);
          if (result.cancelled) {
            // Extension cancelled the fork
            done();
            this.ui.requestRender();
            return;
          }

          this.chatContainer.clear();
          this.addSessionNavigationBanner("Branched session");
          this.renderInitialMessages();
          this.editor.setText(result.selectedText);
          done();
          this.showStatus("Branched to new session");
        },
        () => {
          done();
          this.ui.requestRender();
        },
      );
      return { component: selector, focus: selector.getMessageList() };
    });
  }

  private showTreeSelector(initialSelectedId?: string): void {
    const tree = this.sessionManager.getTree();
    const realLeafId = this.sessionManager.getLeafId();

    if (tree.length === 0) {
      this.showStatus("No entries in session");
      return;
    }

    this.showSelector((done) => {
      const selector = new TreeSelectorComponent(
        tree,
        realLeafId,
        this.ui.terminal.rows,
        async (entryId) => {
          // Selecting the current leaf is a no-op (already there)
          if (entryId === realLeafId) {
            done();
            this.showStatus("Already at this point");
            return;
          }

          // Ask about summarization
          done(); // Close selector first

          // Loop until user makes a complete choice or cancels to tree
          let wantsSummary = false;
          let customInstructions: string | undefined;

          while (true) {
            const summaryChoice = await this.showExtensionSelector(
              "Summarize branch?",
              ["No summary", "Summarize", "Summarize with custom prompt"],
            );

            if (summaryChoice === undefined) {
              // User pressed escape - re-show tree selector with same selection
              this.showTreeSelector(entryId);
              return;
            }

            wantsSummary = summaryChoice !== "No summary";

            if (summaryChoice === "Summarize with custom prompt") {
              customInstructions = await this.showExtensionEditor(
                "Custom summarization instructions",
              );
              if (customInstructions === undefined) {
                // User cancelled - loop back to summary selector
                continue;
              }
            }

            // User made a complete choice
            break;
          }

          // Set up escape handler and loader if summarizing
          let summaryLoader: Component | undefined;
          const originalOnEscape = this.defaultEditor.onEscape;

          if (wantsSummary) {
            this.defaultEditor.onEscape = () => {
              this.session.abortBranchSummary();
            };
            this.chatContainer.addChild(new Spacer(1));
            summaryLoader = new PencilLoader(
              this.ui,
              theme,
              `Summarizing branch... (${appKey(this.keybindings, "interrupt")} to cancel)`,
            );
            this.statusContainer.addChild(summaryLoader);
            this.ui.requestRender();
          }

          try {
            const result = await this.session.navigateTree(entryId, {
              summarize: wantsSummary,
              customInstructions,
            });

            if (result.aborted) {
              // Summarization aborted - re-show tree selector with same selection
              this.showStatus("Branch summarization cancelled");
              this.showTreeSelector(entryId);
              return;
            }
            if (result.cancelled) {
              this.showStatus("Navigation cancelled");
              return;
            }

            // Update UI
            this.chatContainer.clear();
            this.addSessionNavigationBanner("Navigated session tree");
            this.renderInitialMessages();
            if (result.editorText && !this.editor.getText().trim()) {
              this.editor.setText(result.editorText);
            }
            this.showStatus("Navigated to selected point");
          } catch (error) {
            this.showError(
              error instanceof Error ? error.message : String(error),
            );
          } finally {
            if (summaryLoader) {
              (summaryLoader as PencilLoader).stop();
              this.statusContainer.clear();
            }
            this.defaultEditor.onEscape = originalOnEscape;
          }
        },
        () => {
          done();
          this.ui.requestRender();
        },
        (entryId, label) => {
          this.sessionManager.appendLabelChange(entryId, label);
          this.ui.requestRender();
        },
        initialSelectedId,
      );
      return { component: selector, focus: selector };
    });
  }

  private showSessionSelector(): void {
    this.showSelector((done) => {
      const selector = new SessionSelectorComponent(
        (onProgress) =>
          SessionManager.list(
            this.sessionManager.getCwd(),
            this.sessionManager.getSessionDir(),
            onProgress,
          ),
        SessionManager.listAll,
        async (sessionPath) => {
          done();
          await this.handleResumeSession(sessionPath);
        },
        () => {
          done();
          this.ui.requestRender();
        },
        () => {
          void this.shutdown();
        },
        () => this.ui.requestRender(),
        {
          renameSession: async (
            sessionFilePath: string,
            nextName: string | undefined,
          ) => {
            const next = (nextName ?? "").trim();
            if (!next) return;
            const mgr = SessionManager.open(sessionFilePath);
            mgr.appendSessionInfo(next);
          },
          showRenameHint: true,
          keybindings: this.keybindings,
        },

        this.sessionManager.getSessionFile(),
      );
      return { component: selector, focus: selector };
    });
  }

  private async handleResumeSession(sessionPath: string): Promise<void> {
    // Stop loading animation
    if (this.loadingAnimation) {
      (this.loadingAnimation as PencilLoader).stop();
      this.loadingAnimation = undefined;
    }
    this.statusContainer.clear();

    // Clear UI state
    this.pendingMessagesContainer.clear();
    this.compactionQueuedMessages = [];
    this.streamingComponent = undefined;
    this.streamingMessage = undefined;
    this.pendingTools.clear();

    // Switch session via AgentSession (emits extension session events)
    await this.session.switchSession(sessionPath);

    // Clear and re-render the chat
    this.chatContainer.clear();
    this.addSessionNavigationBanner("Resumed session");
    this.renderInitialMessages();
    this.showStatus("Resumed session");
  }

  private async showOAuthSelector(mode: "login" | "logout"): Promise<void> {
    const providers = this.getLoginSelectorProviders(mode);
    if (providers.length === 0) {
      this.showStatus(
        mode === "login"
          ? "No providers available."
          : "No providers logged in. Use /login first.",
      );
      return;
    }

    this.showSelector((done) => {
      const selector = new OAuthSelectorComponent(
        mode,
        providers,
        async (providerId: string) => {
          done();

          if (mode === "login") {
            const oauthProvider = getOAuthProviders().find(
              (p) => p.id === providerId,
            );
            if (oauthProvider) {
              await this.showLoginDialog(providerId);
            } else {
              await this.promptForProviderApiKey(providerId, {
                title: `Set API key for ${providerId}`,
              });
            }
          } else {
            // Logout flow
            const providerInfo = getOAuthProviders().find(
              (p) => p.id === providerId,
            );
            const providerName = providerInfo?.name || providerId;

            try {
              this.session.modelRegistry.authStorage.logout(providerId);
              this.session.modelRegistry.refresh();
              await this.updateAvailableProviderCount();
              this.showStatus(`Logged out of ${providerName}`);
            } catch (error: unknown) {
              this.showError(
                `Logout failed: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          }
        },
        () => {
          done();
          this.ui.requestRender();
        },
        {
          title:
            mode === "login"
              ? "Select provider to login or configure:"
              : "Select provider to logout:",
        },
      );
      return { component: selector, focus: selector };
    });
  }

  private getLoginSelectorProviders(
    mode: "login" | "logout",
  ): ProviderSelectorItem[] {
    const oauthProviders: ProviderSelectorItem[] = getOAuthProviders().map(
      (provider) => ({
        id: provider.id,
        name: provider.name,
        authType: "oauth",
        loggedIn:
          this.session.modelRegistry.authStorage.get(provider.id)?.type ===
          "oauth",
      }),
    );

    if (mode === "logout") {
      return oauthProviders.filter((provider) => provider.loggedIn);
    }

    const items = [...oauthProviders];
    const providerIds = new Set(items.map((provider) => provider.id));
    const apiKeyProviders = [
      { id: "openrouter", name: "OpenRouter" },
    ];

    for (const provider of apiKeyProviders) {
      if (providerIds.has(provider.id)) continue;
      items.push({
        id: provider.id,
        name: provider.name,
        authType: "api_key",
        loggedIn: !!this.getStoredApiKey(provider.id),
      });
    }

    return items;
  }

  private async showLoginDialog(providerId: string): Promise<void> {
    const providerInfo = getOAuthProviders().find((p) => p.id === providerId);
    const providerName = providerInfo?.name || providerId;

    // Providers that use callback servers (can paste redirect URL)
    const usesCallbackServer = providerInfo?.usesCallbackServer ?? false;

    // Create login dialog component
    const dialog = new LoginDialogComponent(
      this.ui,
      providerId,
      (_success, _message) => {
        // Completion handled below
      },
    );

    // Show dialog in editor container
    this.editorContainer.clear();
    this.editorContainer.addChild(dialog);
    this.ui.setFocus(dialog);
    this.ui.requestRender();

    // Promise for manual code input (racing with callback server)
    let manualCodeResolve: ((code: string) => void) | undefined;
    let manualCodeReject: ((err: Error) => void) | undefined;
    const manualCodePromise = new Promise<string>((resolve, reject) => {
      manualCodeResolve = resolve;
      manualCodeReject = reject;
    });

    // Restore editor helper
    const restoreEditor = () => {
      this.remountEditorShell();
      this.ui.setFocus(this.editor);
      this.ui.requestRender();
    };

    try {
      await this.session.modelRegistry.authStorage.login(
        providerId as OAuthProvider,
        {
          onAuth: (info: { url: string; instructions?: string }) => {
            dialog.showAuth(info.url, info.instructions);

            if (usesCallbackServer) {
              // Show input for manual paste, racing with callback
              dialog
                .showManualInput(
                  "Paste redirect URL below, or complete login in browser:",
                )
                .then((value) => {
                  if (value && manualCodeResolve) {
                    manualCodeResolve(value);
                    manualCodeResolve = undefined;
                  }
                })
                .catch(() => {
                  if (manualCodeReject) {
                    manualCodeReject(new Error("Login cancelled"));
                    manualCodeReject = undefined;
                  }
                });
            } else if (providerId === "github-copilot") {
              // GitHub Copilot polls after onAuth
              dialog.showWaiting("Waiting for browser authentication...");
            }
            // For Anthropic: onPrompt is called immediately after
          },

          onPrompt: async (prompt: {
            message: string;
            placeholder?: string;
          }) => {
            return dialog.showPrompt(prompt.message, prompt.placeholder);
          },

          onProgress: (message: string) => {
            dialog.showProgress(message);
          },

          onManualCodeInput: () => manualCodePromise,

          signal: dialog.signal,
        },
      );

      // Success
      restoreEditor();
      this.session.modelRegistry.refresh();
      await this.updateAvailableProviderCount();
      this.showStatus(
        `Logged in to ${providerName}. Credentials saved to ${getAuthPath()}`,
      );
    } catch (error: unknown) {
      restoreEditor();
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (errorMsg !== "Login cancelled") {
        this.showError(`Failed to login to ${providerName}: ${errorMsg}`);
      }
    }
  }

  // =========================================================================
  // Command handlers
  // =========================================================================

  private async handleReloadCommand(): Promise<void> {
    if (this.session.isStreaming) {
      this.showWarning(
        "Wait for the current response to finish before reloading.",
      );
      return;
    }
    if (this.session.isCompacting) {
      this.showWarning("Wait for compaction to finish before reloading.");
      return;
    }

    this.resetExtensionUI();

    const loader = new BorderedLoader(
      this.ui,
      theme,
      "Reloading extensions, skills, prompts, themes...",
      {
        cancellable: false,
      },
    );
    const previousEditor = this.editor;
    this.editorContainer.clear();
    this.editorContainer.addChild(loader);
    this.ui.setFocus(loader);
    this.ui.requestRender();

    const dismissLoader = (_editor: Component) => {
      loader.dispose();
      this.remountEditorShell();
      this.ui.setFocus(this.editor);
      this.ui.requestRender();
    };

    try {
      await this.session.reload();
      setRegisteredThemes(this.session.resourceLoader.getThemes().themes);
      this.hideThinkingBlock = this.settingsManager.getHideThinkingBlock();
      const themeName = this.settingsManager.getTheme();
      const themeResult = themeName
        ? setTheme(themeName, true)
        : { success: true };
      if (!themeResult.success) {
        this.showError(
          `Failed to load theme "${themeName}": ${themeResult.error}\nFell back to dark theme.`,
        );
      }
      const editorPaddingX = this.settingsManager.getEditorPaddingX();
      const autocompleteMaxVisible =
        this.settingsManager.getAutocompleteMaxVisible();
      this.defaultEditor.setPaddingX(editorPaddingX);
      this.defaultEditor.setAutocompleteMaxVisible(autocompleteMaxVisible);
      if (this.editor !== this.defaultEditor) {
        this.editor.setPaddingX?.(editorPaddingX);
        this.editor.setAutocompleteMaxVisible?.(autocompleteMaxVisible);
      }
      this.ui.setShowHardwareCursor(
        this.settingsManager.getShowHardwareCursor(),
      );
      this.ui.setClearOnShrink(this.settingsManager.getClearOnShrink());
      this.setupAutocomplete(this.fdPath);
      const runner = this.session.extensionRunner;
      if (runner) {
        this.setupExtensionShortcuts(runner);
      }
      this.rebuildChatFromMessages();
      dismissLoader(this.editor as Component);
      this.showLoadedResources({
        extensionPaths: runner?.getExtensionPaths() ?? [],
        force: false,
        showDiagnosticsWhenQuiet: true,
      });
      const modelsJsonError = this.session.modelRegistry.getError();
      if (modelsJsonError) {
        this.showError(`models.json error: ${modelsJsonError}`);
      }
      this.showStatus("Reloaded extensions, skills, prompts, themes");
    } catch (error) {
      dismissLoader(previousEditor as Component);
      this.showError(
        `Reload failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async handleExportCommand(text: string): Promise<void> {
    const parts = text.split(/\s+/);
    const outputPath = parts.length > 1 ? parts[1] : undefined;

    try {
      const filePath = await this.session.exportToHtml(outputPath);
      this.showStatus(`Session exported to: ${filePath}`);
    } catch (error: unknown) {
      this.showError(
        `Failed to export session: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  private async handleShareCommand(): Promise<void> {
    // Check if gh is available and logged in
    try {
      const authResult = spawnSync("gh", ["auth", "status"], {
        encoding: "utf-8",
      });
      if (authResult.status !== 0) {
        this.showError(
          "GitHub CLI is not logged in. Run 'gh auth login' first.",
        );
        return;
      }
    } catch {
      this.showError(
        "GitHub CLI (gh) is not installed. Install it from https://cli.github.com/",
      );
      return;
    }

    // Export to a temp file
    const tmpFile = path.join(os.tmpdir(), "session.html");
    try {
      await this.session.exportToHtml(tmpFile);
    } catch (error: unknown) {
      this.showError(
        `Failed to export session: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      return;
    }

    // Show cancellable loader, replacing the editor
    const loader = new BorderedLoader(this.ui, theme, "Creating gist...");
    this.editorContainer.clear();
    this.editorContainer.addChild(loader);
    this.ui.setFocus(loader);
    this.ui.requestRender();

    const restoreEditor = () => {
      loader.dispose();
      this.remountEditorShell();
      this.ui.setFocus(this.editor);
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
      this.showStatus("Share cancelled");
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
        this.showError(`Failed to create gist: ${errorMsg}`);
        return;
      }

      // Extract gist ID from the URL returned by gh
      // gh returns something like: https://gist.github.com/username/GIST_ID
      const gistUrl = result.stdout?.trim();
      const gistId = gistUrl?.split("/").pop();
      if (!gistId) {
        this.showError("Failed to parse gist ID from gh output");
        return;
      }

      // Create the preview URL
      const previewUrl = getShareViewerUrl(gistId);
      this.showStatus(`Share URL: ${previewUrl}\nGist: ${gistUrl}`);
    } catch (error: unknown) {
      if (!loader.signal.aborted) {
        restoreEditor();
        this.showError(
          `Failed to create gist: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    }
  }

  private handleCopyCommand(): void {
    const text = this.session.getLastAssistantText();
    if (!text) {
      this.showError("No agent messages to copy yet.");
      return;
    }

    try {
      copyToClipboard(text);
      this.showStatus("Copied last agent message to clipboard");
    } catch (error) {
      this.showError(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Handle /status command - show agent status card (Codex-style)
   */
  private async handleStatusCommand(): Promise<void> {
    const state = this.session.state;
    const sessionMgr = this.sessionManager;

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
    const width = Math.min(this.ui.terminal.columns || 80, 73);

    // Top border with title
    const titleLeft = `  >_ NanoPencil (v${this.version})  `;
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
    const loopLine = `  Agent loop:           ${this.session.agentLoopFramework}`;
    lines.push(theme.fg("border", `│`) + padLine(loopLine, width) + theme.fg("border", `│`));

    // Directory (with git branch if available)
    let cwd = this.session.cwd;
    const home = process.env.HOME || process.env.USERPROFILE;
    if (home && cwd.startsWith(home)) {
      cwd = `~${cwd.slice(home.length)}`;
    }
    const branch = this.footerDataProvider.getGitBranch();
    const dirLine = `  Directory:            ${cwd}${branch ? ` (${branch})` : ""}`;
    lines.push(theme.fg("border", `│`) + padLine(dirLine, width) + theme.fg("border", `│`));

    // AGENTS.md check
    const agentsMdPath = path.join(this.session.cwd, "AGENTS.md");
    const agentsMdExists = fs.existsSync(agentsMdPath);
    const agentsMdLine = `  AGENTS.md:            ${agentsMdExists ? "AGENTS.md" : "not found"}`;
    lines.push(theme.fg("border", `│`) + padLine(agentsMdLine, width) + theme.fg("border", `│`));

    // Session info
    const sessionId = sessionMgr.getSessionId();
    const sessionName = sessionMgr.getSessionName();
    const sessionLine = `  Session:              ${sessionName || sessionId.slice(0, 8)}...`;
    lines.push(theme.fg("border", `│`) + padLine(sessionLine, width) + theme.fg("border", `│`));

    // Account info (from auth storage)
    const authStorage = this.session.modelRegistry.authStorage;
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
    const contextUsage = this.session.getContextUsage();
    const contextWindow = contextUsage?.contextWindow ?? state.model?.contextWindow ?? 0;
    const contextPercent = contextUsage?.percent ?? 0;
    const contextTokens = contextUsage?.tokens ?? 0;

    const bar = renderContextProgressBar(contextPercent);

    const contextLine = `  Context:              ${bar} ${contextPercent.toFixed(1)}% (${fmt(contextTokens)}/${fmt(contextWindow)})`;
    lines.push(theme.fg("border", `│`) + padLine(contextLine, width) + theme.fg("border", `│`));

    // Bottom border
    lines.push(theme.fg("border", `╰${"─".repeat(Math.max(1, width - 2))}╯`));

    // Display in chat - use RawText to preserve our pre-formatted ANSI card layout
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(new RawText(lines.join("\n")));

    this.ui.requestRender();
  }

  /**
   * Handle /usage command - show token usage statistics
   */
  private async handleUsageCommand(): Promise<void> {
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
    for (const entry of this.sessionManager.getBranch()) {
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
    const contextUsage = this.session.getContextUsage();
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
    const state = this.session.state;
    if (state.model) {
      lines.push(`  Current:     ${state.model.id}`);
    }

    lines.push("");
    lines.push(theme.fg("dim", "  Tip: Use /settings → Terminal → Show token stats to toggle footer display"));

    // Display in chat
    for (const line of lines) {
      this.chatContainer.addChild(new Spacer(1));
      this.chatContainer.addChild(new Text(line, 1, 0));
    }
  }

  private handleNameCommand(text: string): void {
    const name = text.replace(/^\/name\s*/, "").trim();
    if (!name) {
      const currentName = this.sessionManager.getSessionName();
      if (currentName) {
        this.chatContainer.addChild(new Spacer(1));
        this.chatContainer.addChild(
          new Text(theme.fg("dim", `Session name: ${currentName}`), 1, 0),
        );
      } else {
        this.showWarning("Usage: /name <name>");
      }
      this.ui.requestRender();
      return;
    }

    this.sessionManager.appendSessionInfo(name);
    this.updateTerminalTitle();
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(
      new Text(theme.fg("dim", `Session name set: ${name}`), 1, 0),
    );
    this.ui.requestRender();
  }

  private handleSessionCommand(): void {
    const stats = this.session.getSessionStats();
    const sessionName = this.sessionManager.getSessionName();

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

    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(new Text(info, 1, 0));
    this.ui.requestRender();
  }

  private handleChangelogCommand(): void {
    const changelogPath = getChangelogPath();
    const allEntries = parseChangelog(changelogPath);

    const changelogMarkdown =
      allEntries.length > 0
        ? allEntries
            .reverse()
            .map((e) => e.content)
            .join("\n\n")
        : "No changelog entries found.";

    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(new DynamicBorder());
    this.chatContainer.addChild(
      new Text(theme.bold(theme.fg("accent", "What's New")), 1, 0),
    );
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(
      new Markdown(
        changelogMarkdown,
        1,
        1,
        this.getMarkdownThemeWithSettings(),
      ),
    );
    this.chatContainer.addChild(new DynamicBorder());
    this.ui.requestRender();
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
  private getAppKeyDisplay(action: AppAction): string {
    return this.capitalizeKey(appKey(this.keybindings, action));
  }

  /**
   * Get capitalized display string for an editor keybinding action.
   */
  private getEditorKeyDisplay(action: EditorAction): string {
    return this.capitalizeKey(editorKey(action));
  }

  private handleHotkeysCommand(): void {
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
    const extensionRunner = this.session.extensionRunner;
    if (extensionRunner) {
      const shortcuts = extensionRunner.getShortcuts(
        this.keybindings.getEffectiveConfig(),
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

    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(new DynamicBorder());
    this.chatContainer.addChild(
      new Text(theme.bold(theme.fg("accent", "Keyboard Shortcuts")), 1, 0),
    );
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(
      new Markdown(hotkeys.trim(), 1, 1, this.getMarkdownThemeWithSettings()),
    );
    this.chatContainer.addChild(new DynamicBorder());
    this.ui.requestRender();
  }

  private async handleClearCommand(): Promise<void> {
    // Stop loading animation
    if (this.loadingAnimation) {
      (this.loadingAnimation as PencilLoader).stop();
      this.loadingAnimation = undefined;
    }
    this.statusContainer.clear();

    // New session via session (emits extension session events)
    await this.session.newSession();

    // Clear UI state
    this.chatContainer.clear();
    this.pendingMessagesContainer.clear();
    this.compactionQueuedMessages = [];
    this.streamingComponent = undefined;
    this.streamingMessage = undefined;
    this.pendingTools.clear();

    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(
      new Text(`${theme.fg("accent", "✓ New session started")}`, 1, 1),
    );
    this.ui.requestRender();
  }

  private handleRenderDebugCommand(): void {
    const width = this.ui.terminal.columns;
    const height = this.ui.terminal.rows;
    const allLines = this.ui.render(width);

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
      ...this.session.messages.map((msg) => JSON.stringify(msg)),
      "",
    ].join("\n");

    fs.mkdirSync(path.dirname(debugLogPath), { recursive: true });
    fs.writeFileSync(debugLogPath, debugData);

    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(
      new Text(
        `${theme.fg("accent", "✓ Debug log written")}\n${theme.fg("muted", debugLogPath)}`,
        1,
        1,
      ),
    );
    this.ui.requestRender();
  }

  private handleArminSaysHi(): void {
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(new ArminComponent(this.ui));
    this.ui.requestRender();
  }

  private handleShowResourcesCommand(): void {
    const runner = this.session.extensionRunner;
    this.showLoadedResources({
      extensionPaths: runner?.getExtensionPaths() ?? [],
      force: true,
      showDiagnosticsWhenQuiet: true,
    });
    this.ui.requestRender();
  }

  private handleDaxnuts(): void {
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(new DaxnutsComponent(this.ui));
    this.ui.requestRender();
  }

  private checkDaxnutsEasterEgg(model: { provider: string; id: string }): void {
    if (
      model.provider === "opencode" &&
      model.id.toLowerCase().includes("kimi-k2.5")
    ) {
      this.handleDaxnuts();
    }
  }

  private async handleBashCommand(
    command: string,
    excludeFromContext = false,
  ): Promise<void> {
    const extensionRunner = this.session.extensionRunner;

    // Emit user_bash event to let extensions intercept
    const eventResult = extensionRunner
      ? await extensionRunner.emitUserBash({
          type: "user_bash",
          command,
          excludeFromContext,
          cwd: this.session.cwd,
        })
      : undefined;

    // If extension returned a full result, use it directly
    if (eventResult?.result) {
      const result = eventResult.result;

      // Create UI component for display
      this.bashComponent = new BashExecutionComponent(
        command,
        this.ui,
        excludeFromContext,
      );
      if (this.session.isStreaming) {
        this.pendingMessagesContainer.addChild(this.bashComponent);
        this.pendingBashComponents.push(this.bashComponent);
      } else {
        this.chatContainer.addChild(this.bashComponent);
      }

      // Show output and complete
      if (result.output) {
        this.bashComponent.appendOutput(result.output);
      }
      this.bashComponent.setComplete(
        result.exitCode,
        result.cancelled,
        result.truncated
          ? ({ truncated: true, content: result.output } as TruncationResult)
          : undefined,
        result.fullOutputPath,
      );

      // Record the result in session
      this.session.recordBashResult(command, result, { excludeFromContext });
      this.bashComponent = undefined;
      this.ui.requestRender();
      return;
    }

    // Normal execution path (possibly with custom operations)
    const isDeferred = this.session.isStreaming;
    this.bashComponent = new BashExecutionComponent(
      command,
      this.ui,
      excludeFromContext,
    );

    if (isDeferred) {
      // Show in pending area when agent is streaming
      this.pendingMessagesContainer.addChild(this.bashComponent);
      this.pendingBashComponents.push(this.bashComponent);
    } else {
      // Show in chat immediately when agent is idle
      this.chatContainer.addChild(this.bashComponent);
    }
    this.ui.requestRender();

    try {
      const result = await this.session.executeBash(
        command,
        (chunk) => {
          if (this.bashComponent) {
            this.bashComponent.appendOutput(chunk);
            this.ui.requestRender();
          }
        },
        { excludeFromContext, operations: eventResult?.operations },
      );

      if (this.bashComponent) {
        this.bashComponent.setComplete(
          result.exitCode,
          result.cancelled,
          result.truncated
            ? ({ truncated: true, content: result.output } as TruncationResult)
            : undefined,
          result.fullOutputPath,
        );
      }
    } catch (error) {
      if (this.bashComponent) {
        this.bashComponent.setComplete(undefined, false);
      }
      this.showError(
        `Bash command failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }

    this.bashComponent = undefined;
    this.ui.requestRender();
  }

  private async handleCompactCommand(
    customInstructions?: string,
  ): Promise<void> {
    const entries = this.sessionManager.getEntries();
    const messageCount = entries.filter((e) => e.type === "message").length;

    if (messageCount < 2) {
      this.showWarning("Nothing to compact (no messages yet)");
      return;
    }

    await this.executeCompaction(customInstructions, false);
  }

  private async executeCompaction(
    customInstructions?: string,
    isAuto = false,
  ): Promise<CompactionResult | undefined> {
    // Stop loading animation
    if (this.loadingAnimation) {
      (this.loadingAnimation as PencilLoader).stop();
      this.loadingAnimation = undefined;
    }
    this.statusContainer.clear();

    // Set up escape handler during compaction
    const originalOnEscape = this.defaultEditor.onEscape;
    this.defaultEditor.onEscape = () => {
      this.session.abortCompaction();
    };

    // Show compacting status
    this.chatContainer.addChild(new Spacer(1));
    const cancelHint = `(${appKey(this.keybindings, "interrupt")} to cancel)`;
    const label = isAuto
      ? `Auto-compacting context... ${cancelHint}`
      : `Compacting context... ${cancelHint}`;
    const compactingLoader = new PencilLoader(this.ui, theme, label);
    this.statusContainer.addChild(compactingLoader);
    this.ui.requestRender();

    let result: CompactionResult | undefined;

    try {
      result = await this.session.compact(customInstructions);

      // Rebuild UI
      this.rebuildChatFromMessages();

      // Add compaction component at bottom so user sees it without scrolling
      const msg = createCompactionSummaryMessage(
        result.summary,
        result.tokensBefore,
        new Date().toISOString(),
      );
      this.addMessageToChat(msg);

      this.footer.invalidate();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message === "Compaction cancelled" ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        this.showError("Compaction cancelled");
      } else {
        this.showError(`Compaction failed: ${message}`);
      }
    } finally {
      (compactingLoader as PencilLoader).stop();
      this.statusContainer.clear();
      this.defaultEditor.onEscape = originalOnEscape;
    }
    void this.flushCompactionQueue({ willRetry: false });
    return result;
  }

  stop(): void {
    this.stopWelcomeBannerTimer();
    this.clearBuddyPetResetTimer();
    this.buddyPet?.dispose();
    this.buddyPet = null;
    if (this.loadingAnimation) {
      (this.loadingAnimation as PencilLoader).stop();
      this.loadingAnimation = undefined;
    }
    this.clearExtensionTerminalInputListeners();
    this.footer.dispose();
    this.footerDataProvider.dispose();
    if (this.unsubscribe) {
      this.unsubscribe();
    }
    if (this.isInitialized) {
      this.ui.stop();
      this.isInitialized = false;
    }
  }

  /**
   * If session is tagged with a persona, apply it to env + active persona file,
   * then reload session runtime so Pencil/Soul/NanoMem/Skills/MCP can be re-wired.
   */
  private async applyPersonaFromSessionIfAny(): Promise<void> {
    const entries = this.session.sessionManager.getEntries();
    const personaEntries = entries.filter(
      (e: any) => e.type === "custom" && e.customType === "persona",
    );
    if (personaEntries.length === 0) return;

    const last = personaEntries[personaEntries.length - 1] as any;
    const personaId: unknown = last?.data?.personaId ?? last?.data?.id;
    if (typeof personaId !== "string" || !personaId.trim()) return;

    const currentActive = getActivePersonaId();
    if (currentActive === personaId) {
      return;
    }

    setActivePersonaId(personaId);
    process.env.NANOMEM_MEMORY_DIR = toAbsolutePath(
      getPersonaMemoryDir(personaId),
    );
    process.env.SOUL_DIR = toAbsolutePath(getPersonaSoulDir(personaId));
    process.env.MCP_CONFIG_PATH = toAbsolutePath(
      getPersonaMcpConfigPath(personaId),
    );

    if (!this.session.isStreaming && !this.session.isCompacting) {
      await this.session.reload();
    }
  }

  private handleSoulCommand(): void {
    const soulManager = (this.session as any)._soulManager;
    if (!soulManager) {
      this.chatContainer.addChild(new Spacer(1));
      this.chatContainer.addChild(
        new Text(theme.fg("warning", "⚠️  Soul Not Enabled"), 1, 0),
      );
      this.chatContainer.addChild(
        new Text(
          theme.fg(
            "dim",
            "Soul (AI personality system) is not enabled. Please use NanoPencil 1.3.0 or later.",
          ),
          1,
          0,
        ),
      );
      this.ui.requestRender();
      return;
    }

    const stats = formatSoulStats(soulManager, { compact: false });

    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(new Text(stats, 1, 0));
    this.ui.requestRender();
  }

  private async handlePersonaCommand(text: string): Promise<void> {
    const parts = text.trim().split(/\s+/);
    const action = (parts[1] ?? "list").toLowerCase();
    const personaArg = parts[2];

    if (action === "list") {
      const personas = listPersonas();
      const active = getActivePersonaId();
      const lines: string[] = [];
      lines.push(theme.bold("Personas"));
      lines.push("");
      if (personas.length === 0) {
        lines.push(theme.fg("dim", `No personas found under ${this.session.agentDir}/personas/`));
      } else {
        for (const id of personas) {
          const marker = active === id ? "*" : " ";
          lines.push(`${marker} - ${id}`);
        }
      }
      lines.push("");
      lines.push(theme.fg("dim", "Use: /persona use <personaId>"));

      this.chatContainer.addChild(new Spacer(1));
      this.chatContainer.addChild(new Text(lines.join("\n"), 1, 0));
      this.ui.requestRender();
      return;
    }

    if (action !== "use") {
      this.chatContainer.addChild(new Spacer(1));
      this.chatContainer.addChild(
        new Text(
          theme.fg(
            "dim",
            "Usage:\n- /persona list\n- /persona use <personaId>",
          ),
          1,
          0,
        ),
      );
      this.ui.requestRender();
      return;
    }

    const personaId = personaArg ? personaArg.trim() : "";
    if (!personaId) {
      this.showError("Missing personaId. Use: /persona use <personaId>");
      return;
    }

    const personaDir = getPersonaDir(personaId);
    if (!fs.existsSync(personaDir)) {
      this.showError(`Persona not found: ${personaId}\nExpected: ${personaDir}`);
      return;
    }

    // Fork from the latest user message in current branch
    const branch = this.session.sessionManager.getBranch();
    let forkFromEntryId: string | undefined;
    for (let i = branch.length - 1; i >= 0; i--) {
      const e: any = branch[i];
      if (e?.type === "message" && e?.message?.role === "user") {
        forkFromEntryId = e.id;
        break;
      }
    }

    if (!forkFromEntryId) {
      this.showError("No user message found in the current session branch.");
      return;
    }

    const result = await this.session.fork(forkFromEntryId);
    if (result.cancelled) return;

    // Tag this new branch with personaId for later resume.
    this.session.sessionManager.appendCustomEntry("persona", { personaId });

    // Apply persona-specific env before reload so extensions/system prompt use it.
    setActivePersonaId(personaId);
    process.env.NANOMEM_MEMORY_DIR = toAbsolutePath(
      getPersonaMemoryDir(personaId),
    );
    process.env.SOUL_DIR = toAbsolutePath(getPersonaSoulDir(personaId));
    process.env.MCP_CONFIG_PATH = toAbsolutePath(
      getPersonaMcpConfigPath(personaId),
    );

    // Set flag to skip interview on first message after persona switch
    process.env.NANOPENCIL_JUST_SWITCHED_PERSONA = "true";

    await this.handleReloadCommand();
    this.showStatus(`Persona switched to: ${personaId}`);
  }

  private handleMemoryCommand(): void {
    const lines: string[] = [];
    lines.push(theme.fg("accent", "📚 Project Memory - NanoMem"));
    lines.push("");
    lines.push(theme.fg("dim", `Storage: ${this.session.agentDir}/memory/`));
    lines.push(theme.fg("dim", "  - knowledge.json  (project knowledge)"));
    lines.push(theme.fg("dim", "  - lessons.json    (lessons learned)"));
    lines.push(theme.fg("dim", "  - preferences.json (user preferences)"));
    lines.push(theme.fg("dim", "  - patterns.json    (behavior patterns)"));
    lines.push(theme.fg("dim", "  - facets.json     (patterns/struggles)"));
    lines.push("");
    lines.push(
      theme.fg("dim", "💡 Tip: NanoMem automatically extracts and remembers project knowledge from conversations"),
    );
    lines.push(theme.fg("dim", "   - Remembers API endpoints, configuration options"));
    lines.push(theme.fg("dim", "   - Learns error patterns and solutions"));
    lines.push(theme.fg("dim", "   - Recognizes user preferences and coding style"));

    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(new Text(lines.join("\n"), 1, 0));
    this.ui.requestRender();
  }

  private async handleMcpCommand(text: string): Promise<void> {
    const parts = text.trim().split(/\s+/);
    const action = (parts[1] || "list").toLowerCase();
    const target = parts[2];

    if (action === "list") {
      const servers = listMCPServers();
      this.chatContainer.addChild(new Spacer(1));
      if (servers.length === 0) {
        this.chatContainer.addChild(
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
        this.chatContainer.addChild(new Text(lines.join("\n"), 1, 0));
      }
      this.ui.requestRender();
      return;
    }

    if (action === "status" || action === "tools") {
      const runtimeTools = this.session
        .getAllTools()
        .filter((t) => t.name.startsWith("mcp_"));
      this.chatContainer.addChild(new Spacer(1));
      if (runtimeTools.length === 0) {
        this.chatContainer.addChild(
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
        this.chatContainer.addChild(new Text(lines.join("\n"), 1, 0));
      }
      this.ui.requestRender();
      return;
    }

    if ((action === "enable" || action === "disable") && target) {
      setMCPServerEnabled(target, action === "enable");
      this.chatContainer.addChild(new Spacer(1));
      this.chatContainer.addChild(
        new Text(
          `${target} ${action === "enable" ? "enabled" : "disabled"}. Run /reload to apply changes.`,
          1,
          0,
        ),
      );
      this.ui.requestRender();
      return;
    }

    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(
      new Text("Usage: /mcp [list|status|tools|enable <id>|disable <id>]", 1, 0),
    );
    this.ui.requestRender();
  }

  private async handleLanguageCommand(text: string): Promise<void> {
    const { setLocale, getLocale, AVAILABLE_LOCALES, LOCALE_NAMES } = await import(
      "../../core/i18n/index.js"
    );
    const currentLocale = getLocale();

    // Parse command
    const parts = text.split(" ");
    const targetLocale = parts[1]?.toLowerCase();

    if (!targetLocale) {
      // Show current language and options
      this.chatContainer.addChild(new Spacer(1));
      this.chatContainer.addChild(
        new Text(
          theme.fg("accent", `Current language: ${LOCALE_NAMES[currentLocale]}`),
          1,
          0,
        ),
      );
      this.chatContainer.addChild(new Text("Available languages:", 1, 0));
      for (const locale of AVAILABLE_LOCALES) {
        const marker = locale === currentLocale ? " ●" : "";
        this.chatContainer.addChild(
          new Text(`  /language ${locale} - ${LOCALE_NAMES[locale]}${marker}`, 1, 0),
        );
      }
      this.ui.requestRender();
      return;
    }

    // Validate locale
    const locale = targetLocale as (typeof AVAILABLE_LOCALES)[number];
    if (!AVAILABLE_LOCALES.includes(locale)) {
      this.chatContainer.addChild(new Spacer(1));
      this.chatContainer.addChild(
        new Text(
          theme.fg("error", `Unknown language: ${targetLocale}`),
          1,
          0,
        ),
      );
      this.chatContainer.addChild(new Text("Available: " + AVAILABLE_LOCALES.join(", "), 1, 0));
      this.ui.requestRender();
      return;
    }

    // Set locale
    setLocale(locale);

    // Show confirmation
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(
      new Text(
        theme.fg("success", `Language changed to: ${LOCALE_NAMES[locale]}`),
        1,
        0,
      ),
    );
    this.chatContainer.addChild(
      new Text("Restart NanoPencil for full effect.", 1, 0),
    );
    this.ui.requestRender();
  }

  private async handleUpdateCommand(): Promise<void> {
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(
      new Text(theme.fg("accent", "🔍 Checking for updates..."), 1, 0),
    );
    this.ui.requestRender();

    try {
      const response = await fetch(
        "https://registry.npmjs.org/@pencil-agent/nano-pencil",
        {
          signal: AbortSignal.timeout(10000),
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to check for updates: ${response.status}`);
      }

      const data = (await response.json()) as {
        "dist-tags": { latest?: string };
        homepage?: string;
      };

      const latestVersion = data["dist-tags"]?.latest ?? "unknown";
      const currentVersion = VERSION;
      const versionComparison = latestVersion !== "unknown" ? this.compareVersion(latestVersion, currentVersion) : 0;

      const lines: string[] = [];
      lines.push(theme.fg("accent", "📦 NanoPencil Update Checker"));
      lines.push("");
      lines.push(`Current version: ${theme.fg("dim", currentVersion)}`);
      lines.push(
        `Latest version:  ${theme.fg(
          versionComparison > 0 ? "success" : "dim",
          latestVersion,
        )}`,
      );
      lines.push("");

      if (latestVersion !== "unknown" && versionComparison > 0) {
        lines.push(theme.fg("success", `✨ New version ${latestVersion} available!`));
        lines.push("");

        this.chatContainer.addChild(new Spacer(1));
        this.chatContainer.addChild(new Text(lines.join("\n"), 1, 0));
        this.ui.requestRender();

        // Show interactive update options
        await this.showUpdateOptions(latestVersion);
        return;
      } else if (latestVersion !== "unknown" && versionComparison < 0) {
        lines.push(theme.fg("success", "✨ You're ahead!"));
        lines.push("");
        lines.push(
          theme.fg(
            "dim",
            "You're running a pre-release or newer version than published on npm.",
          ),
        );
      } else {
        lines.push(theme.fg("success", "✨ Up to date!"));
        lines.push("");
        lines.push(
          theme.fg("dim", "You're running the latest version of NanoPencil."),
        );
      }

      this.chatContainer.addChild(new Spacer(1));
      this.chatContainer.addChild(new Text(lines.join("\n"), 1, 0));
    } catch (error) {
      this.chatContainer.addChild(new Spacer(1));
      this.chatContainer.addChild(
        new Text(
          theme.fg(
            "warning",
            `⚠️  Failed to check for updates: ${error instanceof Error ? error.message : "Unknown error"}`,
          ),
          1,
          0,
        ),
      );
      this.chatContainer.addChild(
        new Text(
          theme.fg(
            "dim",
            "Visit https://www.npmjs.com/package/@pencil-agent/nano-pencil to check manually",
          ),
          1,
          0,
        ),
      );
    }

    this.ui.requestRender();
  }

  /**
   * Show interactive update options when a new version is available.
   */
  private async showUpdateOptions(latestVersion: string): Promise<void> {
    const autoUpdate = this.settingsManager.getAutoUpdate();
    const skippedVersion = this.settingsManager.getSkippedVersion();

    // If user has already skipped this version, offer options to clear it
    if (skippedVersion === latestVersion) {
      const title = `${theme.fg("accent", "Update Skipped")}\n\n${theme.fg("dim", `You previously chose to skip version ${latestVersion}.`)}\n${theme.fg("dim", `Current: ${VERSION}`)}\n${theme.fg("success", `Latest:  ${latestVersion}`)}\n\n${theme.fg("dim", "What would you like to do?")}`;

      const skipOptions = [
        "1. Update now",
        "2. Clear skip and enable auto-update",
        "3. Continue without updating",
      ];

      const skipChoice = await this.showExtensionSelector(title, skipOptions);

      if (!skipChoice) {
        this.chatContainer.addChild(
          new Text(theme.fg("dim", "Returning to chat..."), 1, 0),
        );
        this.ui.requestRender();
        return;
      }

      if (skipChoice.includes("Update now")) {
        await this.performUpdate(latestVersion);
        return;
      } else if (skipChoice.includes("Clear skip")) {
        this.settingsManager.setSkippedVersion(undefined);
        this.settingsManager.setAutoUpdate("always");
        this.chatContainer.addChild(new Spacer(1));
        this.chatContainer.addChild(
          new Text(
            theme.fg("success", "✅ Skip cleared! Auto-update enabled. NanoPencil will check for updates on startup."),
            1,
            0,
          ),
        );
        this.ui.requestRender();
        // Proceed with update
        await this.performUpdate(latestVersion);
        return;
      }
      // Continue without updating
      this.chatContainer.addChild(
        new Text(theme.fg("dim", "Continuing without update..."), 1, 0),
      );
      this.ui.requestRender();
      return;
    }

    // Build title with version info
    const title = `${theme.fg("accent", "Update Available")}\n\n${theme.fg("dim", `Current: ${VERSION}`)}\n${theme.fg("success", `Latest:  ${latestVersion}`)}`;

    // Build options list with consistent numbering
    const options: string[] = [];
    options.push("1. Update now and restart");
    options.push("2. Exit and I'll update manually");
    options.push("3. Skip this version");

    // Add auto-update toggle option
    if (autoUpdate !== "always") {
      options.push("4. Enable auto-update");
    } else {
      options.push("4. Disable auto-update");
    }

    // Add status subtitle
    const subtitle = autoUpdate === "always"
      ? `\n\n${theme.fg("success", "● Auto-update is enabled")}`
      : `\n\n${theme.fg("dim", "○ Auto-update is disabled")}`;

    const choice = await this.showExtensionSelector(title + subtitle, options);

    if (!choice) {
      // User cancelled, return to chat
      this.chatContainer.addChild(
        new Text(theme.fg("dim", "Returning to chat..."), 1, 0),
      );
      this.ui.requestRender();
      return;
    }

    if (choice.includes("Update now")) {
      await this.performUpdate(latestVersion);
    } else if (choice.includes("Exit")) {
      this.chatContainer.addChild(new Spacer(1));
      this.chatContainer.addChild(
        new Text(
          theme.fg("accent", "👋 Exiting. Run this command to update:"),
          1,
          0,
        ),
      );
      this.chatContainer.addChild(
        new Text(
          theme.fg("dim", `  npm install -g ${PACKAGE_NAME}@latest`),
          1,
          0,
        ),
      );
      this.ui.requestRender();
      await new Promise((resolve) => setTimeout(resolve, 2000));
      process.exit(0);
    } else if (choice.includes("Skip")) {
      this.settingsManager.setSkippedVersion(latestVersion);
      this.chatContainer.addChild(new Spacer(1));
      this.chatContainer.addChild(
        new Text(
          theme.fg("dim", `⏭️  Skipped version ${latestVersion}. You won't be prompted for this version again.`),
          1,
          0,
        ),
      );
      this.chatContainer.addChild(
        new Text(
          theme.fg("dim", "   You can clear this skip later from settings."),
          1,
          0,
        ),
      );
      this.ui.requestRender();
    } else if (choice.includes("Enable auto-update")) {
      this.settingsManager.setAutoUpdate("always");
      this.chatContainer.addChild(new Spacer(1));
      this.chatContainer.addChild(
        new Text(
          theme.fg("success", "✅ Auto-update enabled! NanoPencil will check for updates on startup."),
          1,
          0,
        ),
      );
      this.ui.requestRender();
      // Proceed with update after enabling auto-update
      await this.performUpdate(latestVersion);
    } else if (choice.includes("Disable auto-update")) {
      this.settingsManager.setAutoUpdate("prompt");
      this.chatContainer.addChild(new Spacer(1));
      this.chatContainer.addChild(
        new Text(
          theme.fg("dim", "✅ Auto-update disabled. You'll be prompted when updates are available."),
          1,
          0,
        ),
      );
      this.ui.requestRender();
    }
  }

  /**
   * Handle /reinstall command - force clean reinstall.
   */
  private handleReinstallCommand(): void {
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(
      new Text(theme.fg("accent", "🔄 Force Reinstalling NanoPencil..."), 1, 0),
    );
    this.chatContainer.addChild(
      new Text(
        theme.fg("dim", "This will uninstall and reinstall with cache cleared."),
        1,
        0,
      ),
    );
    this.ui.requestRender();

    // Step 1: Uninstall
    const uninstall = spawnNpm(["uninstall", "-g", PACKAGE_NAME]);

    uninstall.on("close", (code) => {
      if (code !== 0) {
        this.chatContainer.addChild(
          new Text(theme.fg("warning", `⚠️  Uninstall failed (exit code ${code}), continuing anyway...`), 1, 0),
        );
        this.ui.requestRender();
      }

      // Step 2: Clear cache
      this.chatContainer.addChild(
        new Text(theme.fg("dim", "🧹 Clearing npm cache..."), 1, 0),
      );
      this.ui.requestRender();

      const cacheClean = spawnNpm(["cache", "clean", "--force"]);

      cacheClean.on("close", () => {
        // Step 3: Reinstall
        this.chatContainer.addChild(
          new Text(theme.fg("dim", "📦 Installing latest version..."), 1, 0),
        );
        this.ui.requestRender();

        const install = spawnNpm(["install", "-g", "--force", `${PACKAGE_NAME}@latest`]);

        install.on("close", (installCode) => {
          if (installCode === 0) {
            this.chatContainer.addChild(
              new Text(theme.fg("success", "✅ NanoPencil reinstalled successfully!"), 1, 0),
            );
            this.chatContainer.addChild(
              new Text(theme.fg("accent", "Press 'R' to restart NanoPencil"), 1, 0),
            );
            this.ui.requestRender();

            // Wait for R to restart
            const waitForRestart = async () => {
              const key = await this.waitForKeyPress(["r", "R", "q", "Q", "\x03"] as const);
              if (key === "r" || key === "R") {
                this.restartNanoPencil();
              } else {
                process.exit(0);
              }
            };
            waitForRestart();
          } else {
            this.chatContainer.addChild(
              new Text(theme.fg("warning", `⚠️  Reinstall failed (exit code ${installCode})`), 1, 0),
            );
            this.chatContainer.addChild(
              new Text(
                theme.fg("dim", "Try running manually: npm uninstall -g @pencil-agent/nano-pencil && npm install -g @pencil-agent/nano-pencil"),
                1,
                0,
              ),
            );
            this.ui.requestRender();
          }
        });

        install.on("error", (err) => {
          this.chatContainer.addChild(
            new Text(theme.fg("warning", `⚠️  Install failed: ${err.message}`), 1, 0),
          );
          this.ui.requestRender();
        });
      });
    });

    uninstall.on("error", (err) => {
      this.chatContainer.addChild(
        new Text(theme.fg("warning", `⚠️  Uninstall failed: ${err.message}`), 1, 0),
      );
      this.ui.requestRender();
    });
  }

  /**
   * Perform the actual npm install update.
   */
  private async performUpdate(latestVersion: string, retryCount = 0): Promise<void> {
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(
      new Text(theme.fg("accent", "🔄 Updating NanoPencil..."), 1, 0),
    );
    this.ui.requestRender();

    return new Promise((resolve) => {
      const child = spawnNpm(["install", "-g", "--force", `${PACKAGE_NAME}@latest`]);

      let errorOutput = "";

      child.stderr?.on("data", (data: Buffer) => {
        errorOutput += data.toString();
      });

      child.on("close", async (code) => {
        if (code === 0) {
          this.chatContainer.addChild(
            new Text(
              theme.fg("success", `✅ Successfully updated to version ${latestVersion}!`),
              1,
              0,
            ),
          );
          this.chatContainer.addChild(new Spacer(1));
          this.chatContainer.addChild(
            new Text(
              theme.fg("accent", "Press 'R' to restart or Ctrl+C to exit manually"),
              1,
              0,
            ),
          );

          this.ui.requestRender();

          // Wait for user to press R to restart
          const waitForRestart = async () => {
            const key = await this.waitForKeyPress(["r", "R", "q", "Q", "\x03"] as const);
            if (key === "r" || key === "R") {
              this.chatContainer.addChild(
                new Text(
                  theme.fg("dim", "🔄 Restarting NanoPencil..."),
                  1,
                  0,
                ),
              );
              this.ui.requestRender();
              // Use the improved restart method
              this.restartNanoPencil();
            } else {
              process.exit(0);
            }
          };

          waitForRestart().then(() => resolve());
        } else {
          this.chatContainer.addChild(
            new Text(
              theme.fg("warning", `⚠️  Update failed (exit code ${code})`),
              1,
              0,
            ),
          );
          this.chatContainer.addChild(
            new Text(
              theme.fg("dim", "This may be a network issue or permissions problem."),
              1,
              0,
            ),
          );
          this.ui.requestRender();
          resolve();

          // Offer retry option
          this.showRetryOptions(latestVersion, retryCount);
        }
      });

      child.on("error", async (err) => {
        this.chatContainer.addChild(
          new Text(
            theme.fg("warning", `⚠️  Failed to run npm: ${err.message}`),
            1,
            0,
          ),
        );
        this.chatContainer.addChild(
          new Text(
            theme.fg("dim", "Make sure npm is installed and in your PATH."),
            1,
            0,
          ),
        );
        this.ui.requestRender();
        resolve();

        // Offer retry option
        this.showRetryOptions(latestVersion, retryCount);
      });
    });
  }

  /**
   * Show retry options after a failed update attempt.
   */
  private async showRetryOptions(latestVersion: string, retryCount: number): Promise<void> {
    await new Promise((r) => setTimeout(r, 500));

    const options: string[] = ["1. Try again", "2. Exit and update manually"];
    const choice = await this.showExtensionSelector(
      `${theme.fg("accent", "Update Failed")}\n\n${theme.fg("dim", "What would you like to do?")}`,
      options,
    );

    if (choice?.includes("Try again")) {
      if (retryCount < 3) {
        await this.performUpdate(latestVersion, retryCount + 1);
      } else {
        this.chatContainer.addChild(
          new Text(
            theme.fg("dim", "Multiple retry attempts failed. Please try updating manually."),
            1,
            0,
          ),
        );
        this.chatContainer.addChild(
          new Text(
            theme.fg("dim", `  npm install -g ${PACKAGE_NAME}@latest`),
            1,
            0,
          ),
        );
        this.ui.requestRender();
      }
    } else {
      this.chatContainer.addChild(new Spacer(1));
      this.chatContainer.addChild(
        new Text(
          theme.fg("accent", "👋 Exiting. Run this command to update:"),
          1,
          0,
        ),
      );
      this.chatContainer.addChild(
        new Text(
          theme.fg("dim", `  npm install -g ${PACKAGE_NAME}@latest`),
          1,
          0,
        ),
      );
      this.ui.requestRender();
      await new Promise((resolve) => setTimeout(resolve, 2000));
      process.exit(0);
    }
  }

  /**
   * Wait for a specific key press from user.
   * Falls back to selector UI if TTY is not available.
   */
  private async waitForKeyPress<T extends readonly string[]>(keys: T): Promise<T[number] | "\x03" | null> {
    // Check if we're in a TTY environment
    if (!process.stdin.isTTY) {
      // Fall back to selector UI
      const options = keys
        .filter((k) => k !== "\x03")
        .map((k) => `Press '${k}'`);
      options.push("Cancel");

      const choice = await this.showExtensionSelector(
        theme.fg("accent", "Restart Options"),
        options,
      );

      if (!choice || choice.includes("Cancel")) {
        return "\x03";
      }

      const selectedKey = keys.find((k) => choice.includes(k));
      return (selectedKey as T[number]) ?? "\x03";
    }

    return new Promise((resolve) => {
      const stdin = process.stdin;
      const originalRawMode = stdin.isRaw;

      const cleanup = () => {
        try {
          if (stdin.isTTY) {
            stdin.setRawMode(originalRawMode);
          }
        } catch {
          // Ignore errors when restoring raw mode
        }
        stdin.pause();
        stdin.removeListener("data", onData);
      };

      const onData = (data: Buffer) => {
        const key = data.toString();
        // Check for Ctrl+C or matching keys
        if (key === "\x03" || keys.includes(key as T[number])) {
          cleanup();
          resolve(key === "\x03" ? "\x03" : (key as T[number]));
        }
      };

      try {
        stdin.setRawMode(true);
        stdin.resume();
        stdin.on("data", onData);
      } catch (err) {
        cleanup();
        resolve(null);
      }
    });
  }

  /**
   * Restart NanoPencil by spawning a new process.
   * Tries to detect the correct command to restart.
   */
  private restartNanoPencil(): void {
    // Try to detect how NanoPencil was launched
    const execArgv = process.argv;
    const cmd = execArgv[0]; // e.g., /usr/local/bin/nanopencil or node
    const args = execArgv.slice(1);

    // Check if running as global CLI (nanopencil) or via node (node dist/cli.js)
    const isGlobalCli = cmd.includes("nanopencil");

    if (isGlobalCli) {
      // Running as global CLI command
      spawn(cmd, args, {
        detached: true,
        stdio: "ignore",
      }).unref();
    } else {
      // Running via node (development or bundled)
      spawn(process.execPath, execArgv.slice(1), {
        detached: true,
        stdio: "ignore",
      }).unref();
    }

    process.exit(0);
  }

  /**
   * Compare two version strings (semver style).
   * Returns: 1 if v1 > v2, -1 if v1 < v2, 0 if equal
   */
  private compareVersion(v1: string, v2: string): number {
    const parts1 = v1.split(".").map(Number);
    const parts2 = v2.split(".").map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] ?? 0;
      const p2 = parts2[i] ?? 0;
      if (p1 > p2) return 1;
      if (p1 < p2) return -1;
    }
    return 0;
  }

  /**
   * Check for updates on startup if auto-update is enabled.
   */
  private async checkAutoUpdateOnStartup(): Promise<void> {
    const autoUpdate = this.settingsManager.getAutoUpdate();
    if (autoUpdate !== "always") {
      return;
    }

    try {
      const response = await fetch(
        "https://registry.npmjs.org/@pencil-agent/nano-pencil",
        {
          signal: AbortSignal.timeout(5000), // Shorter timeout for startup
        },
      );

      if (!response.ok) {
        return;
      }

      const data = (await response.json()) as {
        "dist-tags": { latest?: string };
      };

      const latestVersion = data["dist-tags"]?.latest;
      if (!latestVersion) {
        return;
      }

      const currentVersion = VERSION;
      const skippedVersion = this.settingsManager.getSkippedVersion();

      // Skip if already skipped this version
      if (skippedVersion === latestVersion) {
        return;
      }

      // Compare versions properly
      if (this.compareVersion(latestVersion, currentVersion) > 0) {
        // Show confirmation dialog before auto-update
        const title = `${theme.fg("accent", "📦 Update Available")}\n\n${theme.fg("dim", `Current: ${currentVersion}`)}\n${theme.fg("success", `Latest:  ${latestVersion}`)}\n\n${theme.fg("dim", "A new version is available. Would you like to update now?")}`;

        const options = [
          "1. Update now and restart",
          "2. Skip this version",
          "3. Continue without updating",
        ];

        const choice = await this.showExtensionSelector(title, options);

        if (!choice) {
          // User cancelled, continue without update
          return;
        }

        if (choice.includes("Update now")) {
          // Perform update
          await this.performUpdate(latestVersion);
        } else if (choice.includes("Skip")) {
          // Skip this version
          this.settingsManager.setSkippedVersion(latestVersion);
          this.chatContainer.addChild(new Spacer(1));
          this.chatContainer.addChild(
            new Text(
              theme.fg("dim", `⏭️  Skipped version ${latestVersion}. You won't be prompted again.`),
              1,
              0,
            ),
          );
          this.ui.requestRender();
        } else if (choice.includes("Continue")) {
          // Continue without updating
          this.chatContainer.addChild(new Spacer(1));
          this.chatContainer.addChild(
            new Text(theme.fg("dim", "Continuing without update..."), 1, 0),
          );
          this.ui.requestRender();
        }
      }
    } catch {
      // Silently fail on startup check - don't block user
    }
  }
}
