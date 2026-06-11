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
import type { AgentMessage } from "@pencil-agent/agent-core";
import type {
  ImageContent,
  Message,
} from "@pencil-agent/ai/types";
import type {
  AutocompleteItem,
  EditorAction,
  EditorComponent,
  KeyId,
  MarkdownTheme,
  SlashCommand,
} from "@pencil-agent/tui";
import {
  CombinedAutocompleteProvider,
  type Component,
  CachedContainer,
  Container,
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
  getDebugLogPath,
  getShareViewerUrl,
  PACKAGE_NAME,
  VERSION,
} from "../../config.js";
import {
  type AgentSession,
  type AgentSessionEvent,
  parseSkillBlock,
  type PromptOptions,
} from "../../core/runtime/agent-session.js";
import type { CompactionResult } from "../../core/session/compaction/index.js";
import type {
  ExtensionRunner,
  ExtensionUIContext,
} from "../../core/extensions-host/index.js";
import { FooterDataProvider } from "./footer-data-provider.js";
import { type AppAction, KeybindingsManager } from "../../core/platform/keybindings.js";
import { createCompactionSummaryMessage } from "../../core/messages.js";
import { listMCPServers, setMCPServerEnabled } from "../../core/mcp/mcp-config.js";
import type { ResourceDiagnostic } from "../../core/platform/config/resource-loader.js";
import type { SessionContext } from "../../core/session/session-manager.js";
import {
  BUILTIN_SLASH_COMMANDS,
  getExtensionBackedBuiltinCommandNames,
  formatSlashCommandDescription,
  getLocalizedCommands,
  inferSlashCommandCategory,
} from "../../core/slash-commands.js";
import { t } from "../../core/platform/i18n/index.js";
import {
  getActivePersonaId,
  getPersonaDescription,
  getPersonaDir,
  getPersonaMcpConfigPath,
  getPersonaMemoryDir,
  getPersonaSoulDir,
  listPersonas,
  setActivePersonaId,
  toAbsolutePath,
} from "../../core/persona/persona-manager.js";
import type { TruncationResult } from "../../core/tools/truncate.js";
import { NANOPENCIL_WHATS_NEW } from "../../nanopencil-defaults.js";
import { getChangelogPath, parseChangelog } from "../../utils/changelog.js";
import { copyToClipboard } from "../utils/clipboard.js";
import {
  ensureTool,
  getToolPath,
  prewarmTool,
} from "../../core/platform/utils/tools-manager.js";
import { printTimings, time } from "../../core/platform/timings.js";
import { ArminComponent } from "./components/armin.js";
import { ImagePipelineController } from "./controllers/image-pipeline-controller.js";
import { SelfUpdateController } from "./controllers/self-update-controller.js";
import { InteractiveState } from "./state/interactive-state.js";
import { PersistentSurfaceRegistry } from "./controllers/extension-ui/persistent-surface-registry.js";
import { PromptHost } from "./controllers/extension-ui/prompt-host.js";
import { CustomOverlayHost } from "./controllers/extension-ui/custom-overlay-host.js";
import { EditorComponentAdapter } from "./controllers/extension-ui/editor-component-adapter.js";
import { ModelOverlayController } from "./controllers/model-overlay-controller.js";
import { AuthProviderConfigController } from "./controllers/auth-provider-config-controller.js";
import { TreeOverlayController } from "./controllers/tree-overlay-controller.js";
import { SettingsOverlayController } from "./controllers/settings-overlay-controller.js";
import { SlashDispatcherController } from "./controllers/slash-dispatcher-controller.js";
import { InputSubmitController } from "./controllers/input-submit-controller.js";
import { InterruptController } from "./controllers/interrupt-controller.js";
import { StreamRenderController } from "./controllers/stream-render-controller.js";
import { AssistantMessageComponent } from "./components/assistant-message.js";
import { BashExecutionComponent } from "./components/bash-execution.js";
import { BorderedLoader } from "./components/bordered-loader.js";
import { BuddyPetComponent, type BuddyState } from "./components/buddy/pet-sprites.js";
import { EditorBuddyLayout } from "./components/editor-buddy-layout.js";
import { BranchSummaryMessageComponent } from "./components/branch-summary-message.js";
import { PencilLoader } from "./components/pencil-loader.js";
import { NotificationQueue } from "./components/notification-queue.js";
import { PersonaSelectorComponent } from "./components/persona-selector.js";
import { CompactionSummaryMessageComponent } from "./components/compaction-summary-message.js";
import { CustomEditor } from "./components/custom-editor.js";
import { CustomMessageComponent } from "./components/custom-message.js";
import { DaxnutsComponent } from "./components/daxnuts.js";
import { DynamicBorder } from "./components/dynamic-border.js";
import { FooterComponent, renderContextProgressBar } from "./components/footer.js";
import {
  appKey,
  appKeyHint,
  editorKey,
  keyHint,
  rawKeyHint,
} from "./components/keybinding-hints.js";
import { formatSoulStats } from "./components/soul-stats.js";
import { formatMemoryStats } from "./components/memory-stats.js";
import { SkillInvocationMessageComponent } from "./components/skill-invocation-message.js";
import { ToolExecutionComponent } from "./components/tool-execution.js";
import { UserMessageComponent } from "./components/user-message.js";
import { RawText } from "./components/raw-text.js";
import {
  getAvailableThemesWithPaths,
  getEditorTheme,
  getMarkdownTheme,
  getThemeByName,
  initTheme,
  onThemeChange,
  setRegisteredThemes,
  setTheme,
  setThemeInstance,
  type ThemeColor,
  theme,
} from "./theme/theme.js";
import {
  getAgentLoopArgumentCompletions,
  getLanguageArgumentCompletions,
  getLoginArgumentCompletions,
  getMcpArgumentCompletions,
  getModelArgumentCompletions,
  getPersonaArgumentCompletions,
  getThinkingArgumentCompletions,
} from "./slash-command-arguments.js";
import { formatAgentLoopStatusLines } from "./agent-loop-status.js";

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

const _dbgLogPath = path.join(os.homedir(), ".nanopencil", "agent", "nanopencil-debug.log");
function _dbg(msg: string): void {
	fs.appendFileSync(_dbgLogPath, `[${new Date().toISOString()}] [imode] ${msg}\n`);
}

export class InteractiveMode {
  private session: AgentSession;
  private ui: TUI;
  private chatContainer: CachedContainer;
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
  private readonly catWorkingMessages = [
    "Purring…",
    "Meowing…",
    "Napping…",
    "Stretching…",
    "Zooming…",
    "Sneaking…",
    "Pouncing…",
    "Scratching…",
    "Yawning…",
    "Blinking…",
    "Kneading…",
    "Crouching…",
    "Spinning…",
    "Twitching…",
    "Hiding…",
  ];
  private catMessageIndex = Math.floor(Math.random() * 15);
  private catMessageLastSwitch = 0;

  /** Consolidated render/turn UI state (streaming, tools, loaders, run timers, status, queues). */
  private readonly state = new InteractiveState();


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

  // Shutdown state
  private shutdownRequested = false;

  // Auto-dismiss timers for status/warning messages
  private statusTimers = new Set<ReturnType<typeof setTimeout>>();

  // Priority notification queue
  private notificationQueue: NotificationQueue;

  // Extension UI state
  private extensionTerminalInputUnsubscribers = new Set<() => void>();

  private widgetContainerAbove!: Container;
  private widgetContainerBelow!: Container;
  /** Pet column next to the input (right side, compact coding-agent style). */
  private buddySlot!: Container;
  private editorBuddyLayout!: EditorBuddyLayout;

  // Header container that holds the built-in or custom header
  private headerContainer: Container;

  // Built-in header (logo + keybinding hints + changelog)
  private builtInHeader: Component | undefined = undefined;

  // Attachments state (bytes = in-memory clipboard payload for reliable inline images)
  private attachmentsContainer: Container | undefined = undefined;
  private imagePipeline!: ImagePipelineController;
  private selfUpdate!: SelfUpdateController;
  private authProviderConfig!: AuthProviderConfigController;
  private modelOverlay!: ModelOverlayController;
  private treeOverlay!: TreeOverlayController;
  private settingsOverlay!: SettingsOverlayController;
  private slashDispatcher!: SlashDispatcherController;
  private inputSubmit!: InputSubmitController;
  private interrupt!: InterruptController;
  private streamRender!: StreamRenderController;
  private surfaces!: PersistentSurfaceRegistry;
  private promptHost!: PromptHost;
  private customOverlay!: CustomOverlayHost;
  private editorAdapter!: EditorComponentAdapter;

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
    this.chatContainer = new CachedContainer();
    this.pendingMessagesContainer = new Container();
    this.statusContainer = new Container();
    this.widgetContainerAbove = new Container();
    this.widgetContainerBelow = new Container();
    this.notificationQueue = new NotificationQueue(this.ui, theme);
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
    this.imagePipeline = new ImagePipelineController({
      getCwd: () => this.session.cwd,
      requestRender: () => this.ui.requestRender(),
      showStatus: (message) => this.showStatus(message),
      getThemeName: () => this.settingsManager.getTheme(),
      isEditorCursorAtTop: () =>
        this.editor.isCursorOnFirstVisualLine?.() ??
        !this.editor.getText().includes("\n"),
      getEditorContainer: () => this.editorContainer,
      getAttachmentsContainer: () => this.attachmentsContainer,
      getEditorBuddyLayout: () => this.editorBuddyLayout,
    });
    this.selfUpdate = new SelfUpdateController({
      getChatContainer: () => this.chatContainer,
      requestRender: () => this.ui.requestRender(),
      getAutoUpdate: () => this.settingsManager.getAutoUpdate(),
      getSkippedVersion: () => this.settingsManager.getSkippedVersion(),
      setSkippedVersion: (version) => this.settingsManager.setSkippedVersion(version),
      setAutoUpdate: (mode) => this.settingsManager.setAutoUpdate(mode),
      showSelector: (title, options) => this.promptHost.selector(title, options),
    });
    this.surfaces = new PersistentSurfaceRegistry({
      requestRender: () => this.ui.requestRender(),
      getUi: () => this.ui,
      getWidgetContainerAbove: () => this.widgetContainerAbove,
      getWidgetContainerBelow: () => this.widgetContainerBelow,
      getHeaderContainer: () => this.headerContainer,
      getBuiltInHeader: () => this.builtInHeader,
      getFooter: () => this.footer,
      getFooterDataProvider: () => this.footerDataProvider,
    });
    this.promptHost = new PromptHost({
      getEditorContainer: () => this.editorContainer,
      getUi: () => this.ui,
      getEditor: () => this.editor as Component,
      getEditorBuddyLayout: () => this.editorBuddyLayout,
      getKeybindings: () => this.keybindings,
      remountEditorShell: () => this.remountEditorShell(),
    });
    this.customOverlay = new CustomOverlayHost({
      getEditor: () => this.editor,
      getUi: () => this.ui,
      getEditorContainer: () => this.editorContainer,
      getKeybindings: () => this.keybindings,
      remountEditorShell: () => this.remountEditorShell(),
    });
    this.editorAdapter = new EditorComponentAdapter({
      getEditor: () => this.editor,
      setEditor: (editor) => {
        this.editor = editor;
      },
      getDefaultEditor: () => this.defaultEditor,
      getEditorContainer: () => this.editorContainer,
      getUi: () => this.ui,
      getKeybindings: () => this.keybindings,
      getAutocompleteProvider: () => this.autocompleteProvider,
      remountEditorShell: () => this.remountEditorShell(),
    });
    this.footerDataProvider = new FooterDataProvider(session.cwd);
    this.footer = new FooterComponent(session, this.footerDataProvider, this.settingsManager.getShowTokenStats());
    this.footer.setAutoCompactEnabled(session.autoCompactionEnabled);
    this.authProviderConfig = new AuthProviderConfigController({
      modelRegistry: this.session.modelRegistry,
      surface: {
        showSelector: (create) => this.showSelector(create),
        showStatus: (message) => this.showStatus(message),
        showError: (message) => this.showError(message),
        promptInput: (title, placeholder, opts) =>
          this.promptHost.input(title, placeholder, opts),
        requestRender: () => this.ui.requestRender(),
        getUi: () => this.ui,
        getEditorContainer: () => this.editorContainer,
        getEditor: () => this.editor as Component,
        remountEditorShell: () => this.remountEditorShell(),
      },
      modelBridge: {
        getCurrentModel: () => this.session.model,
        setCurrentModel: async (model) => {
          await this.session.setModel(model);
          this.footer.invalidate();
          this.updateEditorBorderColor();
        },
        showModelSelector: (initialSearchInput, filterByProvider) =>
          this.modelOverlay.showModelSelector(initialSearchInput, filterByProvider),
        applySelectedModel: (model) => this.modelOverlay.applySelectedModel(model),
        updateAvailableProviderCount: () =>
          this.modelOverlay.updateAvailableProviderCount(),
      },
    });
    this.modelOverlay = new ModelOverlayController({
      modelSession: {
        getModel: () => this.session.model,
        setModel: (model) => this.session.setModel(model),
        cycleModel: (direction) => this.session.cycleModel(direction),
        getThinkingLevel: () => this.session.thinkingLevel,
        setThinkingLevel: (level) => this.session.setThinkingLevel(level),
        cycleThinkingLevel: () => this.session.cycleThinkingLevel(),
        getAvailableThinkingLevels: () => this.session.getAvailableThinkingLevels(),
        getScopedModels: () => this.session.scopedModels,
        setScopedModels: (models) => this.session.setScopedModels(models),
      },
      modelCatalog: {
        refresh: () => this.session.modelRegistry.refresh(),
        getAvailable: () => this.session.modelRegistry.getAvailable(),
        getAll: () => this.session.modelRegistry.getAll(),
        find: (provider, id) => this.session.modelRegistry.find(provider, id),
        appendOpenRouterModel: (id, opts) =>
          this.session.modelRegistry.appendOpenRouterModel(id, opts),
        getCredentialType: (provider) =>
          this.session.modelRegistry.authStorage.get(provider)?.type,
        getRegistry: () => this.session.modelRegistry,
      },
      modelSettings: {
        getEnabledModels: () => this.settingsManager.getEnabledModels(),
        setEnabledModels: (patterns) => this.settingsManager.setEnabledModels(patterns),
        setDefaultModelAndProvider: (provider, id) =>
          this.settingsManager.setDefaultModelAndProvider(provider, id),
      },
      providerConfig: {
        ensureProviderConfiguredForSelection: (model) =>
          this.authProviderConfig.ensureProviderConfiguredForSelection(model),
        handleProviderSelectionFromSelector: (provider, done) =>
          this.authProviderConfig.handleProviderSelectionFromSelector(provider, done),
        promptForProviderApiKey: (provider, options) =>
          this.authProviderConfig.promptForProviderApiKey(provider, options),
      },
      surface: {
        showSelector: (create) => this.showSelector(create),
        showStatus: (message) => this.showStatus(message),
        showError: (message) => this.showError(message),
        promptInput: (title, placeholder, opts) =>
          this.promptHost.input(title, placeholder, opts),
        getUi: () => this.ui,
      },
      footer: {
        invalidate: () => this.footer.invalidate(),
        setAvailableProviderCount: (count) =>
          this.footerDataProvider.setAvailableProviderCount(count),
        updateEditorBorderColor: () => this.updateEditorBorderColor(),
      },
      playDaxnuts: () => this.handleDaxnuts(),
    });
    this.treeOverlay = new TreeOverlayController({
      session: this.session,
      getSessionManager: () => this.sessionManager,
      surface: {
        showSelector: (create) => this.showSelector(create),
        showStatus: (message) => this.showStatus(message),
        showError: (message) => this.showError(message),
        requestRender: () => this.ui.requestRender(),
        getUi: () => this.ui,
        getChatContainer: () => this.chatContainer,
        getStatusContainer: () => this.statusContainer,
        clearChat: () => { this.clearStatusTimers(); this.chatContainer.clear(); },
        clearTransientSessionUi: () => {
          if (this.state.loadingAnimation) {
            (this.state.loadingAnimation as PencilLoader).stop();
            this.state.loadingAnimation = undefined;
          }
          this.statusContainer.clear();
          this.pendingMessagesContainer.clear();
          this.state.compactionQueuedMessages = [];
          this.state.streamingComponent = undefined;
          this.state.streamingMessage = undefined;
          this.state.pendingTools.clear();
          this.imagePipeline.clearAttachments();
        },
        addSessionNavigationBanner: (message) =>
          this.addSessionNavigationBanner(message),
        renderInitialMessages: () => this.renderInitialMessages(),
        getEditorText: () => this.editor.getText(),
        setEditorText: (text) => this.editor.setText(text),
        getEscapeHandler: () => this.defaultEditor.onEscape,
        setEscapeHandler: (handler) => {
          this.defaultEditor.onEscape = handler;
        },
      },
      promptHost: {
        selector: (title, options) => this.promptHost.selector(title, options),
        editor: (title, prefill) => this.promptHost.editor(title, prefill),
      },
      keybindings: this.keybindings,
      shutdown: () => this.shutdown(),
    });
    this.settingsOverlay = new SettingsOverlayController({
      session: this.session,
      settingsManager: this.settingsManager,
      surface: {
        showSelector: (create) => this.showSelector(create),
        showStatus: (message) => this.showStatus(message),
        showError: (message) => this.showError(message),
        invalidateUi: () => this.ui.invalidate(),
        requestRender: () => this.ui.requestRender(),
        setShowHardwareCursor: (enabled) =>
          this.ui.setShowHardwareCursor(enabled),
        setClearOnShrink: (enabled) => this.ui.setClearOnShrink(enabled),
      },
      footer: {
        setAutoCompactEnabled: (enabled) =>
          this.footer.setAutoCompactEnabled(enabled),
        setShowTokenStats: (enabled) => this.footer.setShowTokenStats(enabled),
        invalidate: () => this.footer.invalidate(),
      },
      editor: {
        setPaddingX: (padding) => {
          this.defaultEditor.setPaddingX(padding);
          if (
            this.editor !== this.defaultEditor &&
            this.editor.setPaddingX !== undefined
          ) {
            this.editor.setPaddingX(padding);
          }
        },
        setAutocompleteMaxVisible: (maxVisible) => {
          this.defaultEditor.setAutocompleteMaxVisible(maxVisible);
          if (
            this.editor !== this.defaultEditor &&
            this.editor.setAutocompleteMaxVisible !== undefined
          ) {
            this.editor.setAutocompleteMaxVisible(maxVisible);
          }
        },
        updateBorderColor: () => this.updateEditorBorderColor(),
      },
      render: {
        setToolImagesEnabled: (enabled) => {
          for (const child of this.chatContainer.children) {
            if (child instanceof ToolExecutionComponent) {
              child.setShowImages(enabled);
            }
          }
        },
        setAssistantThinkingHidden: (hidden) => {
          for (const child of this.chatContainer.children) {
            if (child instanceof AssistantMessageComponent) {
              child.setHideThinkingBlock(hidden);
            }
          }
          this.clearStatusTimers();
          this.chatContainer.clear();
        },
        rebuildChatFromMessages: () => this.rebuildChatFromMessages(),
      },
      getHideThinkingBlock: () => this.state.hideThinkingBlock,
      setHideThinkingBlock: (hidden) => {
        this.state.hideThinkingBlock = hidden;
      },
      rebuildAutocomplete: () => this.setupAutocomplete(this.fdPath),
      syncBuddyPet: () => this.syncBuddyPet(),
    });
    this.slashDispatcher = new SlashDispatcherController({
      clearEditor: () => this.editor.setText(""),
      settings: {
        showSettingsSelector: () => this.settingsOverlay.showSettingsSelector(),
      },
      model: {
        showScopedModelsSelector: () => this.modelOverlay.showModelsSelector(),
        handleModelCommand: (searchTerm) =>
          this.modelOverlay.handleModelCommand(searchTerm),
        handleThinkingCommand: (text) =>
          this.modelOverlay.handleThinkingCommand(text),
      },
      auth: {
        handleApiKeyCommand: () => this.authProviderConfig.handleApiKeyCommand(),
        handleLoginCommand: (text) =>
          this.authProviderConfig.handleLoginCommand(text),
        showLogoutSelector: () =>
          this.authProviderConfig.showOAuthSelector("logout"),
      },
      tree: {
        showForkSelector: () => this.treeOverlay.showForkSelector(),
        showTreeSelector: () => this.treeOverlay.showTreeSelector(),
        showSessionSelector: () => this.treeOverlay.showSessionSelector(),
      },
      selfUpdate: {
        handleUpdateCommand: () => this.selfUpdate.handleUpdateCommand(),
        handleReinstallCommand: () => this.selfUpdate.handleReinstallCommand(),
      },
      commands: {
        isExtensionCommand: (text) => this.isExtensionCommand(text),
        handleAgentLoopCommand: (text) => this.handleAgentLoopCommand(text),
        handleMcpCommand: (text) => this.handleMcpCommand(text),
        handleExportCommand: (text) => this.handleExportCommand(text),
        handleShareCommand: () => this.handleShareCommand(),
        handleCopyCommand: () => this.handleCopyCommand(),
        handleStatusCommand: () => this.handleStatusCommand(),
        handleUsageCommand: () => this.handleUsageCommand(),
        handleNameCommand: (text) => this.handleNameCommand(text),
        handleSessionCommand: () => this.handleSessionCommand(),
        handleChangelogCommand: () => this.handleChangelogCommand(),
        handleHotkeysCommand: () => this.handleHotkeysCommand(),
        handleShowResourcesCommand: () => this.handleShowResourcesCommand(),
        handleClearCommand: () => this.handleClearCommand(),
        handleCompactCommand: (customInstructions) =>
          this.handleCompactCommand(customInstructions),
        handleReloadCommand: () => this.handleReloadCommand(),
        handleLanguageCommand: (text) => this.handleLanguageCommand(text),
        handleSoulCommand: () => this.handleSoulCommand(),
        handlePersonaCommand: (text) => this.handlePersonaCommand(text),
        handleMemoryCommand: () => this.handleMemoryCommand(),
        handleArminSaysHi: () => this.handleArminSaysHi(),
        handleBrowserOptInCommand: () => this.handleBrowserOptInCommand(),
        shutdown: () => this.shutdown(),
      },
    });
    this.inputSubmit = new InputSubmitController({
      editor: {
        setText: (text) => this.editor.setText(text),
        addToHistory: (text) => this.editor.addToHistory?.(text),
        handleExternalInput: (text) => {
          if (!this.onInputCallback) return false;
          this.onInputCallback(text);
          this.editor.addToHistory?.(text);
          return true;
        },
        setBashMode: (enabled) => {
          this.isBashMode = enabled;
        },
        updateBorderColor: () => this.updateEditorBorderColor(),
      },
      slash: {
        execute: (text) => this.slashDispatcher.execute(text),
      },
      image: {
        awaitPendingPaste: () => this.imagePipeline.awaitPendingPaste(),
        extractImagesFromText: (text) =>
          this.imagePipeline.extractImagesFromText(text),
        takePendingAttachments: () => this.imagePipeline.takePendingAttachments(),
        processAttachmentFiles: (attachments) =>
          this.imagePipeline.processAttachmentFiles(attachments),
        cleanupClipboardImages: () => this.imagePipeline.cleanupClipboardImages(),
      },
      session: {
        isBashRunning: () => this.session.isBashRunning,
        isCompacting: () => this.session.isCompacting,
        isStreaming: () => this.session.isStreaming,
        getModel: () => this.session.model,
        getCwd: () => this.session.cwd,
        promptAfterRender: (text, options) =>
          this.promptAfterRender(text, options),
        queueCompactionMessage: (text, mode) =>
          this.queueCompactionMessage(text, mode),
      },
      commands: {
        isExtensionCommand: (text) => this.isExtensionCommand(text),
        handlePersonaCommand: (text) => this.handlePersonaCommand(text),
        handleBashCommand: (command, excludeFromContext) =>
          this.handleBashCommand(command, excludeFromContext),
      },
      render: {
        showStatus: (message) => this.showStatus(message),
        showWarning: (message) => this.showWarning(message),
        showError: (message) => this.showError(message),
        notify: (message, options) => this.notify(message, options),
        requestRender: () => this.ui.requestRender(),
        flushPendingBashComponents: () => this.flushPendingBashComponents(),
        updatePendingMessagesDisplay: () => this.updatePendingMessagesDisplay(),
        addOptimisticUserMessage: (text, content) => {
          this.state.optimisticUserMessages.push({ text });
          this.addMessageToChat({
            role: "user",
            content,
            timestamp: Date.now(),
          } as AgentMessage);
        },
        rollbackFirstOptimisticUserMessageIfMatches: (text) => {
          if (
            this.state.optimisticUserMessages.length > 0 &&
            this.state.optimisticUserMessages[0]?.text === text
          ) {
            this.state.optimisticUserMessages.shift();
          }
        },
      },
    });
    this.interrupt = new InterruptController({
      queue: {
        isLoadingAnimationActive: () => !!this.state.loadingAnimation,
        restoreQueuedMessagesWithAbort: () =>
          void this.restoreQueuedMessagesToEditor({ abort: true }),
      },
      runtime: {
        isStreaming: () => this.session.isStreaming,
        isBashRunning: () => this.session.isBashRunning,
        abortAgent: () => this.agent.abort(),
        abortBash: () => this.session.abortBash(),
      },
      bash: {
        isBashMode: () => this.isBashMode,
        exitBashMode: () => {
          this.editor.setText("");
          this.isBashMode = false;
          this.updateEditorBorderColor();
        },
      },
      editor: {
        getText: () => this.editor.getText(),
        clearEditor: () => this.clearEditor(),
      },
      tree: {
        getDoubleEscapeAction: () => this.settingsManager.getDoubleEscapeAction(),
        showTreeSelector: () => this.treeOverlay.showTreeSelector(),
        showForkSelector: () => this.treeOverlay.showForkSelector(),
      },
      lifecycle: {
        requestShutdown: () => void this.shutdown(),
        suspend: () => this.suspend(),
      },
    });
    this.streamRender = new StreamRenderController({
      state: { get: () => this.state },
      layout: {
        getUi: () => this.ui,
        getChatContainer: () => this.chatContainer,
        getStatusContainer: () => this.statusContainer,
        addMessageToChat: (message) => this.addMessageToChat(message),
        updatePendingMessagesDisplay: () => this.updatePendingMessagesDisplay(),
        rebuildChatFromMessages: () => this.rebuildChatFromMessages(),
        requestRender: () => this.ui.requestRender(),
        invalidateFooter: () => this.footer.invalidate(),
      },
      loaders: {
        getSessionId: () => this.sessionManager.getSessionId(),
        getDefaultWorkingMessage: () => this.getNextCatMessage(),
        getInterruptKeyHint: () => appKey(this.keybindings, "interrupt"),
        setBuddyPetState: (state, speech, options) =>
          this.setBuddyPetState(state, speech, options),
        startAgentRunTimer: () => this.startAgentRunTimer(),
        stopAgentRunTimer: () => this.stopAgentRunTimer(),
        updateWorkingMessage: (options) => this.updateWorkingMessage(options),
        formatElapsedSeconds: (ms) => this.formatElapsedSeconds(ms),
        isInPlanMode: () => this.footerDataProvider.getExtensionStatuses().has("plan"),
      },
      toolTrace: {
        shouldRenderToolTrace: (toolName) => this.shouldRenderToolTrace(toolName),
        getRegisteredToolDefinition: (toolName) =>
          this.getRegisteredToolDefinition(toolName),
        getShowImages: () => this.settingsManager.getShowImages(),
      },
      runtime: {
        getRetryAttempt: () => this.session.retryAttempt,
        abortCompaction: () => this.session.abortCompaction(),
        abortRetry: () => this.session.abortRetry(),
        flushCompactionQueue: (options) =>
          void this.flushCompactionQueue(options),
        checkShutdownRequested: () => this.checkShutdownRequested(),
        clearAttachments: () => this.imagePipeline.clearAttachments(),
      },
      escape: {
        getHandler: () => this.defaultEditor.onEscape,
        setHandler: (handler) => {
          this.defaultEditor.onEscape = handler;
        },
      },
      surface: {
        ensureInitialized: async () => {
          if (!this.isInitialized) {
            await this.init();
          }
        },
        restoreEditorFocusIfPossible: () =>
          this.promptHost.restoreEditorFocusIfPossible(),
        getUserMessageText: (message) => this.getUserMessageText(message),
        getMarkdownThemeWithSettings: () => this.getMarkdownThemeWithSettings(),
        showStatus: (message) => this.showStatus(message),
        showError: (message) => this.showError(message),
      },
    });
    this.syncBuddyPet();

    // Load hide thinking block setting
    this.state.hideThinkingBlock = this.settingsManager.getHideThinkingBlock();

    // Register themes from resource loader and initialize
    setRegisteredThemes(this.session.resourceLoader.getThemes().themes);
    initTheme(this.settingsManager.getTheme(), true);
    this.session.setSlashCommandExecutor((text) =>
      this.slashDispatcher.execute(text, { clearEditor: false }),
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
        context,
      ): AutocompleteItem[] | null => {
        const models =
          this.session.scopedModels.length > 0
            ? this.session.scopedModels.map((s) => s.model)
            : this.session.modelRegistry.getAvailable();
        return getModelArgumentCompletions(prefix, context, models);
      };
    }

    const thinkingCommand = slashCommands.find(
      (command) => command.name === "thinking",
    );
    if (thinkingCommand) {
      thinkingCommand.getArgumentCompletions = (
        prefix: string,
        context,
      ): AutocompleteItem[] | null => getThinkingArgumentCompletions(
        prefix,
        context,
        this.session.getAvailableThinkingLevels(),
      );
    }

    const agentLoopCommand = slashCommands.find(
      (command) => command.name === "agent-loop",
    );
    if (agentLoopCommand) {
      agentLoopCommand.getArgumentCompletions = getAgentLoopArgumentCompletions;
    }

    const mcpCommand = slashCommands.find((command) => command.name === "mcp");
    if (mcpCommand) {
      mcpCommand.getArgumentCompletions = (prefix, context) =>
        getMcpArgumentCompletions(prefix, context, listMCPServers());
    }

    const languageCommand = slashCommands.find(
      (command) => command.name === "language",
    );
    if (languageCommand) {
      languageCommand.getArgumentCompletions = getLanguageArgumentCompletions;
    }

    const personaCommand = slashCommands.find(
      (command) => command.name === "persona",
    );
    if (personaCommand) {
      personaCommand.getArgumentCompletions = (prefix, context) =>
        getPersonaArgumentCompletions(
          prefix,
          context,
          listPersonas(),
          getActivePersonaId(),
        );
    }

    const loginCommand = slashCommands.find((command) => command.name === "login");
    if (loginCommand) {
      loginCommand.getArgumentCompletions = (prefix, context) =>
        getLoginArgumentCompletions(
          prefix,
          context,
          this.authProviderConfig.getLoginSelectorProviders("login"),
        );
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

    // Enable slash command highlighting in the input box
    const allCommandNames = new Set(
      [...slashCommands, ...templateCommands, ...extensionCommands, ...skillCommandList]
        .map((c) => c.name),
    );
    this.defaultEditor.enableSlashHighlight(() => allCommandNames, theme);
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
    this.imagePipeline.cleanupStaleClipboardFiles();

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

    this.ui.addChild(this.notificationQueue);
    this.ui.addChild(this.chatContainer);
    this.ui.addChild(this.pendingMessagesContainer);
    this.ui.addChild(this.statusContainer);
    this.surfaces.renderWidgets(); // Initialize with default spacer
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
    await this.modelOverlay.updateAvailableProviderCount();
    time("interactive.firstInput.ready");
    printTimings();

    // Warm MCP tools in the background now that the prompt is usable. MCP server
    // spawn/handshake can take many seconds (the npx-based default servers
    // measure ~20s); blocking the UI on it used to make startup feel frozen.
    // Tools merge into the live runtime when ready (sdk:mcp_ready → showStatus).
    void this.session.warmupMcpTools();
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
    await this.selfUpdate.checkAutoUpdateOnStartup();

    // Start version check asynchronously (for notification only, if auto-update is not enabled)
    const autoUpdate = this.settingsManager.getAutoUpdate();
    if (autoUpdate !== "always") {
      this.selfUpdate.checkForNewVersion().then((newVersion) => {
        if (newVersion) {
          this.selfUpdate.showNewVersionNotification(newVersion);
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
      _dbg(`main loop: got input "${userInput.slice(0, 80)}"`);
      try {
        await this.session.prompt(userInput);
        _dbg("main loop: prompt returned normally");
      } catch (error: unknown) {
        _dbg(`main loop: prompt threw: ${error}`);
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error occurred";
        this.showError(errorMessage);
      }
    }
  }

  /**
   * Check npm registry for a newer version.
   */
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
          if (this.state.loadingAnimation) {
            (this.state.loadingAnimation as PencilLoader).stop();
            this.state.loadingAnimation = undefined;
          }
          this.statusContainer.clear();

          // Delegate to AgentSession (handles setup + agent state sync)
          const success = await this.session.newSession(options);
          if (!success) {
            return { cancelled: true };
          }

          // Clear UI state
          this.clearStatusTimers();
          this.chatContainer.clear();
          this.pendingMessagesContainer.clear();
          this.state.compactionQueuedMessages = [];
          this.state.streamingComponent = undefined;
          this.state.streamingMessage = undefined;
          this.state.pendingTools.clear();
          this.imagePipeline.clearAttachments();

          // Render any messages added via setup, or show empty session
          this.renderInitialMessages();

          return { cancelled: false };
        },
        fork: async (entryId) => {
          const result = await this.session.fork(entryId);
          if (result.cancelled) {
            return { cancelled: true };
          }

          this.clearStatusTimers();
          this.chatContainer.clear();
          this.imagePipeline.clearAttachments();
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

          this.clearStatusTimers();
          this.chatContainer.clear();
          this.imagePipeline.clearAttachments();
          this.addSessionNavigationBanner("Navigated session tree");
          this.renderInitialMessages();
          if (result.editorText && !this.editor.getText().trim()) {
            this.editor.setText(result.editorText);
          }
          this.showStatus("Navigated to selected point");

          return { cancelled: false };
        },
        switchSession: async (sessionPath) => {
          await this.treeOverlay.resumeSession(sessionPath);
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

  private formatElapsedSeconds(ms: number): string {
    return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
  }

  private getNextCatMessage(): string {
    const now = Date.now();
    if (now - this.catMessageLastSwitch >= 3000) {
      this.catMessageIndex++;
      this.catMessageLastSwitch = now;
    }
    return this.catWorkingMessages[this.catMessageIndex % this.catWorkingMessages.length]!;
  }

  private buildWorkingMessage(): { base: string; suffix: string } {
    const base = this.state.workingMessageOverride || this.getNextCatMessage();
    const interruptHint = `${appKey(this.keybindings, "interrupt")} to interrupt`;
    const elapsed =
      this.state.agentRunStartMs !== undefined
        ? this.formatElapsedSeconds(Date.now() - this.state.agentRunStartMs)
        : undefined;
    const suffix = elapsed
      ? `(${elapsed}, ${interruptHint})`
      : `(${interruptHint})`;
    return { base, suffix };
  }

  private updateWorkingMessage(options?: { resetStallTimer?: boolean }): void {
    if (!this.state.loadingAnimation) return;
    const { base, suffix } = this.buildWorkingMessage();
    (this.state.loadingAnimation as PencilLoader).setMessage(
      base,
      { ...options, suffix },
    );
  }

  private stopAgentRunTimer(): void {
    if (this.state.agentRunTimer) {
      clearInterval(this.state.agentRunTimer);
      this.state.agentRunTimer = undefined;
    }
  }

  private stopWelcomeBannerTimer(): void {
    if (this.state.welcomeBannerTimer) {
      clearInterval(this.state.welcomeBannerTimer);
      this.state.welcomeBannerTimer = undefined;
    }
  }

  private startAgentRunTimer(): void {
    this.stopAgentRunTimer();
    this.state.agentRunStartMs = Date.now();
    this.state.agentRunTimer = setInterval(() => {
      if (!this.state.loadingAnimation || this.state.agentRunStartMs === undefined) {
        this.stopAgentRunTimer();
        return;
      }
      // Keep stall detection meaningful while still showing live elapsed time.
      this.updateWorkingMessage({ resetStallTimer: false });
    }, 100);
  }

  private resetExtensionUI(): void {
    this.promptHost.dismiss();
    this.ui.hideOverlay();
    this.clearExtensionTerminalInputListeners();
    this.surfaces.setFooter(undefined);
    this.surfaces.setHeader(undefined);
    this.surfaces.clearWidgets();
    this.footerDataProvider.clearExtensionStatuses();
    this.footer.invalidate();
    this.editorAdapter.setComponent(undefined);
    this.defaultEditor.onExtensionShortcut = undefined;
    this.updateTerminalTitle();
    if (this.state.loadingAnimation) {
      this.state.workingMessageOverride = undefined;
      this.updateWorkingMessage();
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
      this.surfaces.renderWidgets();
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
    this.surfaces.renderWidgets();
  }

  /**
   * Restore attachments bar (if any) + editor row with optional buddy column.
   */
  private remountEditorShell(): void {
    this.editorContainer.clear();
    if (this.imagePipeline.hasAttachments() && this.attachmentsContainer) {
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
        this.promptHost.selector(title, options, opts),
      confirm: (title, message, opts) =>
        this.promptHost.confirm(title, message, opts),
      input: (title, placeholder, opts) =>
        this.promptHost.input(title, placeholder, opts),
      notify: (message, type) => this.showExtensionNotify(message, type),
      onTerminalInput: (handler) =>
        this.addExtensionTerminalInputListener(handler),
      setStatus: (key, text) => this.surfaces.setStatus(key, text),
      setWorkingMessage: (message) => {
        this.state.workingMessageOverride = message || undefined;
        if (this.state.loadingAnimation) {
          this.updateWorkingMessage();
        } else {
          // Queue message for when loadingAnimation is created (handles agent_start race)
          this.state.pendingWorkingMessage = message;
        }
      },
      setWidget: (key, content, options) =>
        this.surfaces.setWidget(key, content, options),
      setFooter: (factory) => this.surfaces.setFooter(factory),
      setHeader: (factory) => this.surfaces.setHeader(factory),
      setTitle: (title) => this.ui.terminal.setTitle(title),
      custom: (factory, options) => this.customOverlay.show(factory, options),
      pasteToEditor: (text) =>
        this.editor.handleInput(`\x1b[200~${text}\x1b[201~`),
      setEditorText: (text) => this.editor.setText(text),
      getEditorText: () => this.editor.getText(),
      editor: (title, prefill) => this.promptHost.editor(title, prefill),
      openExternalEditor: (filePath) => this.openExistingFileInExternalEditor(filePath),
      setEditorComponent: (factory) => this.editorAdapter.setComponent(factory),
      get theme() {
        return theme;
      },
      getAllThemes: () => getAvailableThemesWithPaths(),
      getTheme: (name) => getThemeByName(name),
      setTheme: (themeOrName) => {
        // themeOrName is `string | Theme` (Theme is the contract interface, so narrow by typeof
        // rather than `instanceof` — an interface has no runtime constructor to test against).
        if (typeof themeOrName !== "string") {
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
      getToolsExpanded: () => this.state.toolOutputExpanded,
      setToolsExpanded: (expanded) => this.setToolsExpanded(expanded),
    };
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
    this.defaultEditor.onEscape = () => this.interrupt.dispatchEscape();

    // Register app action handlers
    this.defaultEditor.onAction("clear", () => this.interrupt.handleCtrlC());
    this.defaultEditor.onAction("showResources", () =>
      this.handleShowResourcesCommand(),
    );
    this.defaultEditor.onCtrlD = () => this.interrupt.handleCtrlD();
    this.defaultEditor.onAction("suspend", () => this.interrupt.handleCtrlZ());
    this.defaultEditor.onAction("cycleThinkingLevel", () =>
      this.modelOverlay.cycleThinkingLevel(),
    );
    this.defaultEditor.onAction("cycleModelForward", () =>
      this.modelOverlay.cycleModel("forward"),
    );
    this.defaultEditor.onAction("cycleModelBackward", () =>
      this.modelOverlay.cycleModel("backward"),
    );

    // Global debug handler on TUI (works regardless of focus)
    this.ui.onDebug = () => this.handleRenderDebugCommand();
    this.defaultEditor.onAction("selectModel", () =>
      this.modelOverlay.showProviderThenModelSelector(),
    );
    this.defaultEditor.onAction("selectProviderThenModel", () =>
      this.modelOverlay.showProviderThenModelSelector(),
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
    this.defaultEditor.onAction("tree", () => this.treeOverlay.showTreeSelector());
    this.defaultEditor.onAction("fork", () => this.treeOverlay.showForkSelector());
    this.defaultEditor.onAction("resume", () => this.treeOverlay.showSessionSelector());

    this.defaultEditor.onChange = (text: string) => {
      const wasBashMode = this.isBashMode;
      this.isBashMode = text.trimStart().startsWith("!");
      if (wasBashMode !== this.isBashMode) {
        this.updateEditorBorderColor();
      }
    };

    // Handle clipboard image paste (triggered on Ctrl+V)
    this.defaultEditor.onPasteImage = () => {
      this.imagePipeline.handleClipboardImagePaste();
    };

    // Handle attachment navigation keys (arrow keys, delete)
    this.defaultEditor.onAttachmentKey = (data: string) => {
      return this.imagePipeline.handleAttachmentKeyNavigation(data);
    };
  }

  private setupEditorSubmitHandler(): void {
    this.defaultEditor.onSubmit = async (text: string) => {
      await this.inputSubmit.handleSubmit(text);
    };
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
    _dbg(`handleEvent: ${event.type}`);
    if (event.type === "sdk:mcp_ready") {
      // Deferred MCP loading finished in the background; surface a quiet status.
      if (event.toolCount > 0) {
        this.showStatus(`MCP: ${event.toolCount} tool(s) ready`);
      }
      return;
    }
    await this.streamRender.handle(event);
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
   * Auto-dismisses after 5 seconds.
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
      last === this.state.lastStatusText &&
      secondLast === this.state.lastStatusSpacer
    ) {
      this.state.lastStatusText.setText(theme.fg("dim", message));
      this.scheduleStatusDismiss(this.state.lastStatusSpacer!, this.state.lastStatusText);
      this.ui.requestRender();
      return;
    }

    const spacer = new Spacer(1);
    const text = new Text(theme.fg("dim", message), 1, 0);
    this.chatContainer.addChild(spacer);
    this.chatContainer.addChild(text);
    this.state.lastStatusSpacer = spacer;
    this.state.lastStatusText = text;
    this.scheduleStatusDismiss(spacer, text);
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
            const existing = this.state.customStreamComponents.get(details.streamKey);
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
          component.setExpanded(this.state.toolOutputExpanded);
          this.chatContainer.addChild(component);
          if (details?.streamKey) {
            this.state.customStreamComponents.set(details.streamKey, component);
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
        component.setExpanded(this.state.toolOutputExpanded);
        this.chatContainer.addChild(component);
        break;
      }
      case "branchSummary": {
        this.chatContainer.addChild(new Spacer(1));
        const component = new BranchSummaryMessageComponent(
          message,
          this.getMarkdownThemeWithSettings(),
        );
        component.setExpanded(this.state.toolOutputExpanded);
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
            component.setExpanded(this.state.toolOutputExpanded);
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
          this.state.hideThinkingBlock,
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
    this.state.pendingTools.clear();
    this.state.customStreamComponents.clear();

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
            component.setExpanded(this.state.toolOutputExpanded);
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
              this.state.pendingTools.set(content.id, component);
            }
          }
        }
      } else if (message.role === "toolResult") {
        // Match tool results to pending tool components
        const component = this.state.pendingTools.get(message.toolCallId);
        if (component) {
          component.updateResult(message);
          this.state.pendingTools.delete(message.toolCallId);
        }
      } else {
        // All other messages use standard rendering
        this.addMessageToChat(message, options);
      }
    }

    this.state.pendingTools.clear();
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
        this.state.welcomeBannerTimer = setInterval(() => {
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
    this.clearStatusTimers();
    this.chatContainer.clear();
    const context = this.sessionManager.buildSessionContext();
    this.renderSessionContext(context);
    // Re-add optimistic user messages not yet persisted to session.
    // Cleared by chatContainer.clear() above but absent from buildSessionContext().
    for (const msg of this.state.optimisticUserMessages) {
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
    this.imagePipeline.cleanupClipboardImages();

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

  /** TUI suspend mechanic (Ctrl-Z): stop the TUI, SIGTSTP the group, restore on SIGCONT. */
  private suspend(): void {
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

  private toggleToolOutputExpansion(): void {
    this.setToolsExpanded(!this.state.toolOutputExpanded);
  }

  private setToolsExpanded(expanded: boolean): void {
    this.state.toolOutputExpanded = expanded;
    for (const child of this.chatContainer.children) {
      if (isExpandable(child)) {
        child.setExpanded(expanded);
      }
    }
    this.ui.requestRender();
  }

  private toggleThinkingBlockVisibility(): void {
    this.state.hideThinkingBlock = !this.state.hideThinkingBlock;
    this.settingsManager.setHideThinkingBlock(this.state.hideThinkingBlock);

    // Rebuild chat from session messages
    this.chatContainer.clear();
    this.rebuildChatFromMessages();

    // If streaming, re-add the streaming component with updated visibility and re-render
    if (this.state.streamingComponent && this.state.streamingMessage) {
      this.state.streamingComponent.setHideThinkingBlock(this.state.hideThinkingBlock);
      this.state.streamingComponent.updateContent(this.state.streamingMessage);
      this.chatContainer.addChild(this.state.streamingComponent);
    }

    this.showStatus(
      `Thinking blocks: ${this.state.hideThinkingBlock ? "hidden" : "visible"}`,
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
    const spacer = new Spacer(1);
    const text = new Text(theme.fg("warning", `Warning: ${warningMessage}`), 1, 0);
    this.chatContainer.addChild(spacer);
    this.chatContainer.addChild(text);
    this.scheduleStatusDismiss(spacer, text);
    this.setBuddyPetState("error", "Careful.", {
      resetTo: "idle",
      afterMs: 1800,
    });
    this.ui.requestRender();
  }

  /**
   * Schedule auto-removal of a status/warning message after 5 seconds.
   */
  private scheduleStatusDismiss(spacer: Spacer, text: Text): void {
    const timer = setTimeout(() => {
      this.statusTimers.delete(timer);
      this.chatContainer.removeChild(spacer);
      this.chatContainer.removeChild(text);
      // Clear lastStatus tracking if it matches the removed message
      if (this.state.lastStatusText === text) {
        this.state.lastStatusText = undefined;
        this.state.lastStatusSpacer = undefined;
      }
      this.ui.requestRender();
    }, 5000);
    this.statusTimers.add(timer);
  }

  /**
   * Cancel all pending status dismiss timers (e.g., on /clear).
   */
  private clearStatusTimers(): void {
    for (const timer of this.statusTimers) {
      clearTimeout(timer);
    }
    this.statusTimers.clear();
    this.notificationQueue.clearAll();
  }

  /**
   * Show a priority notification (floating, auto-dismiss, dedup by key).
   */
  notify(message: string, options?: { key?: string; priority?: "immediate" | "high" | "medium" | "low"; type?: "info" | "warning" | "error"; duration?: number }): void {
    this.notificationQueue.notify(message, options);
  }

  /**
   * Get all queued messages (read-only).
   * Combines session queue and compaction queue.
   */
  private getAllQueuedMessages(): { steering: string[]; followUp: string[] } {
    return {
      steering: [
        ...this.session.getSteeringMessages(),
        ...this.state.compactionQueuedMessages
          .filter((msg) => msg.mode === "steer")
          .map((msg) => msg.text),
      ],
      followUp: [
        ...this.session.getFollowUpMessages(),
        ...this.state.compactionQueuedMessages
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
    const compactionSteering = this.state.compactionQueuedMessages
      .filter((msg) => msg.mode === "steer")
      .map((msg) => msg.text);
    const compactionFollowUp = this.state.compactionQueuedMessages
      .filter((msg) => msg.mode === "followUp")
      .map((msg) => msg.text);
    this.state.compactionQueuedMessages = [];
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
    this.state.compactionQueuedMessages.push({ text, mode });
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
    if (this.state.compactionQueuedMessages.length === 0) {
      return;
    }

    const queuedMessages = [...this.state.compactionQueuedMessages];
    this.state.compactionQueuedMessages = [];
    this.updatePendingMessagesDisplay();

    const restoreQueue = (error: unknown) => {
      this.session.clearQueue();
      this.state.compactionQueuedMessages = queuedMessages;
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
      this.state.hideThinkingBlock = this.settingsManager.getHideThinkingBlock();
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
    for (const line of formatAgentLoopStatusLines(state.lastResult)) {
      lines.push(theme.fg("border", `│`) + padLine(`  ${line}`, width) + theme.fg("border", `│`));
    }

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
    if (this.state.loadingAnimation) {
      (this.state.loadingAnimation as PencilLoader).stop();
      this.state.loadingAnimation = undefined;
    }
    this.statusContainer.clear();

    // New session via session (emits extension session events)
    await this.session.newSession();

    // Clear UI state
    this.clearStatusTimers();
    this.chatContainer.clear();
    this.pendingMessagesContainer.clear();
    this.state.compactionQueuedMessages = [];
    this.state.streamingComponent = undefined;
    this.state.streamingMessage = undefined;
    this.state.pendingTools.clear();
    this.imagePipeline.clearAttachments();

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
    if (this.state.loadingAnimation) {
      (this.state.loadingAnimation as PencilLoader).stop();
      this.state.loadingAnimation = undefined;
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
    if (this.state.loadingAnimation) {
      (this.state.loadingAnimation as PencilLoader).stop();
      this.state.loadingAnimation = undefined;
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

    // Resolve persona id: from session tag, or fall back to active persona (default: vex)
    let personaId: string | undefined;
    if (personaEntries.length > 0) {
      const last = personaEntries[personaEntries.length - 1] as any;
      const raw: unknown = last?.data?.personaId ?? last?.data?.id;
      if (typeof raw === "string" && raw.trim()) personaId = raw;
    }
    personaId = personaId ?? getActivePersonaId();
    if (!personaId) return;

    const currentActive = getActivePersonaId();
    if (currentActive === personaId && personaEntries.length === 0) {
      // No session tag and persona already active — just ensure env vars are set
      process.env.NANO_PERSONA_DIR ??= toAbsolutePath(getPersonaDir(personaId));
      return;
    }

    if (personaEntries.length > 0) setActivePersonaId(personaId);
    process.env.NANOMEM_MEMORY_DIR = toAbsolutePath(
      getPersonaMemoryDir(personaId),
    );
    process.env.SOUL_DIR = toAbsolutePath(getPersonaSoulDir(personaId));
    process.env.MCP_CONFIG_PATH = toAbsolutePath(
      getPersonaMcpConfigPath(personaId),
    );
    process.env.NANO_PERSONA_DIR = toAbsolutePath(getPersonaDir(personaId));

    if (personaEntries.length > 0 && !this.session.isStreaming && !this.session.isCompacting) {
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

    if (action === "list" || action === "use" && !personaArg) {
      // Show interactive persona selector
      const personaIds = listPersonas();
      const active = getActivePersonaId();

      this.showSelector((done) => {
        const selector = new PersonaSelectorComponent(
          this.ui,
          personaIds,
          active,
          getPersonaDescription,
          (personaId) => {
            done();
            void this.switchPersona(personaId);
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

    if (action !== "use") {
      this.chatContainer.addChild(new Spacer(1));
      this.chatContainer.addChild(
        new Text(
          theme.fg(
            "dim",
            "Usage:\n- /persona (open selector)\n- /persona use <personaId>",
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

    await this.switchPersona(personaId);
  }

  private async switchPersona(personaId: string): Promise<void> {
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
    process.env.NANO_PERSONA_DIR = toAbsolutePath(getPersonaDir(personaId));

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

  private handleBrowserOptInCommand(): void {
    this.showStatus(
      [
        "Browser automation is opt-in.",
        "",
        "Enable it by starting NanoPencil with:",
        "  --extension extensions/builtin/browser",
        "",
        "Or add that path to your extensions config, then run /browser status.",
      ].join("\n"),
    );
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
      "../../core/platform/i18n/index.js"
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

}
