/**
 * [WHO]: InteractiveMode class, runInteractiveMode()
 * [FROM]: Depends on agent-core, ai, tui, core/* (session, model, config, tools)
 * [TO]: Consumed by modes/index.ts
 * [HERE]: modes/interactive/interactive-mode.ts - TUI orchestration hub (slash-command bodies
 *         delegated to controllers/{session,persona,config,info}-command-handlers.js, P7 C-3a;
 *         transcript rendering delegated to controllers/chat-renderer.js, P7 C-3c)
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentMessage } from "@catui/agent-core";
import type {
  ImageContent,
  Message,
} from "@catui/ai/types";
import type {
  AutocompleteItem,
  EditorComponent,
  KeyId,
  MarkdownTheme,
  SlashCommand,
} from "@catui/tui";
import {
  CombinedAutocompleteProvider,
  type Component,
  CachedContainer,
  Container,
  matchesKey,
  ProcessTerminal,
  Spacer,
  Text,
  TruncatedText,
  TUI,
} from "@catui/tui";
import { spawn, spawnSync } from "child_process";
import { APP_NAME, VERSION } from "../../config.js";
import {
  type AgentSession,
  type AgentSessionEvent,
  type PromptOptions,
} from "../../core/runtime/agent-session.js";
import type {
  ExtensionRunner,
  ExtensionUIContext,
} from "../../core/extensions-host/index.js";
import { FooterDataProvider } from "./footer-data-provider.js";
import { type AppAction, KeybindingsManager } from "../../core/platform/keybindings.js";
import { listMCPServers } from "../../core/mcp/mcp-config.js";
import type { ResourceDiagnostic } from "../../core/platform/config/resource-loader.js";
import { buildScopeGroups, formatDiagnostics, formatDisplayPath, formatScopeGroups, getShortPath } from "./services/loaded-resources-view.js";
import {
  getExtensionBackedBuiltinCommandNames,
  formatSlashCommandDescription,
  getLocalizedCommands,
  inferSlashCommandCategory,
} from "../../core/slash-commands.js";
import { t } from "../../core/platform/i18n/index.js";
import { getActivePersonaId, listPersonas } from "../../core/persona/persona-manager.js";
import { CATUI_WHATS_NEW } from "../../catui-defaults.js";
import {
  ensureTool,
  getToolPath,
  prewarmTool,
} from "../../core/platform/utils/tools-manager.js";
import { printTimings, time } from "../../core/platform/timings.js";
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
import { SessionCommandHandlersController } from "./controllers/session-command-handlers.js";
import { PersonaCommandHandlersController } from "./controllers/persona-command-handlers.js";
import { ConfigCommandHandlersController } from "./controllers/config-command-handlers.js";
import { InfoCommandHandlersController } from "./controllers/info-command-handlers.js";
import { InputSubmitController } from "./controllers/input-submit-controller.js";
import { InterruptController } from "./controllers/interrupt-controller.js";
import { StreamRenderController } from "./controllers/stream-render-controller.js";
import { ChatRendererController } from "./controllers/chat-renderer.js";
import { AssistantMessageComponent } from "./components/assistant-message.js";
import { BashExecutionComponent } from "./components/bash-execution.js";
import { BuddyPetComponent, type BuddyState } from "./components/buddy/pet-sprites.js";
import { EditorBuddyLayout } from "./components/editor-buddy-layout.js";
import { CatuiLoader } from "./components/catui-loader.js";
import { NotificationQueue } from "./components/notification-queue.js";
import { CustomEditor } from "./components/custom-editor.js";
import { FooterComponent } from "./components/footer.js";
import {
  appKey,
  appKeyHint,
  keyHint,
  rawKeyHint,
} from "./components/keybinding-hints.js";
import { ToolExecutionComponent } from "./components/tool-execution.js";
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

const _dbgEnabled = process.env.CATUI_DEBUG === "1";
const _dbgLogPath = path.join(os.homedir(), ".catui", "agent", "catui-debug.log");
function _dbg(msg: string): void {
	// Off by default — leftover dev instrumentation must never write (or crash) in
	// a release. When enabled, ensure the dir exists and never let a log failure
	// take down the app (ENOENT on a fresh install previously killed the process).
	if (!_dbgEnabled) return;
	try {
		fs.mkdirSync(path.dirname(_dbgLogPath), { recursive: true });
		fs.appendFileSync(_dbgLogPath, `[${new Date().toISOString()}] [imode] ${msg}\n`);
	} catch {
		// debug logging is best-effort; swallow all errors
	}
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
  private sessionCommands!: SessionCommandHandlersController;
  private personaCommands!: PersonaCommandHandlersController;
  private configCommands!: ConfigCommandHandlersController;
  private infoCommands!: InfoCommandHandlersController;

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

  private chatRendererRef: ChatRendererController | undefined;

  /**
   * Transcript renderer (message→component mapping, session-context replay, welcome banner,
   * chat rebuild). Created lazily so partial-mode test harnesses
   * (Object.create(InteractiveMode.prototype)) keep working with patched host methods;
   * every context member resolves dynamically through this mode.
   */
  private get chatRenderer(): ChatRendererController {
    if (!this.chatRendererRef) {
      const self = this;
      this.chatRendererRef = new ChatRendererController({
        get session() {
          return self.session;
        },
        get sessionManager() {
          return self.sessionManager;
        },
        get settingsManager() {
          return self.settingsManager;
        },
        get state() {
          return self.state;
        },
        get ui() {
          return self.ui;
        },
        get chatContainer() {
          return self.chatContainer;
        },
        get footer() {
          return self.footer;
        },
        get editor() {
          return self.editor;
        },
        get version() {
          return self.version;
        },
        getMarkdownThemeWithSettings: () => this.getMarkdownThemeWithSettings(),
        getRegisteredToolDefinition: (toolName) =>
          this.getRegisteredToolDefinition(toolName),
        updateEditorBorderColor: () => this.updateEditorBorderColor(),
        stopWelcomeBannerTimer: () => this.stopWelcomeBannerTimer(),
        showStatus: (message) => this.showStatus(message),
        clearStatusTimers: () => this.clearStatusTimers(),
        getAppKeyDisplay: (action) => this.infoCommands.getAppKeyDisplay(action),
        addMessageToChat: (message, options) =>
          this.addMessageToChat(message, options),
        getUserMessageText: (message) => this.getUserMessageText(message),
      });
    }
    return this.chatRendererRef;
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
        pickOption: (title, options) => this.promptHost.selector(title, options),
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
      playDaxnuts: () => this.infoCommands.handleDaxnuts(),
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
            (this.state.loadingAnimation as CatuiLoader).stop();
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
    const self = this;
    this.sessionCommands = new SessionCommandHandlersController({
      session: this.session,
      sessionManager: this.session.sessionManager,
      settingsManager: this.settingsManager,
      state: this.state,
      ui: this.ui,
      defaultEditor: this.defaultEditor,
      editorContainer: this.editorContainer,
      chatContainer: this.chatContainer,
      pendingMessagesContainer: this.pendingMessagesContainer,
      statusContainer: this.statusContainer,
      footer: this.footer,
      keybindings: this.keybindings,
      imagePipeline: this.imagePipeline,
      get editor() {
        return self.editor;
      },
      get fdPath() {
        return self.fdPath;
      },
      get pendingBashComponents() {
        return self.pendingBashComponents;
      },
      get bashComponent() {
        return self.bashComponent;
      },
      set bashComponent(value: BashExecutionComponent | undefined) {
        self.bashComponent = value;
      },
      showStatus: (message) => this.showStatus(message),
      showError: (errorMessage) => this.showError(errorMessage),
      showWarning: (warningMessage) => this.showWarning(warningMessage),
      resetExtensionUI: () => this.resetExtensionUI(),
      remountEditorShell: () => this.remountEditorShell(),
      setupAutocomplete: (fdPath) => this.setupAutocomplete(fdPath),
      setupExtensionShortcuts: (extensionRunner) =>
        this.setupExtensionShortcuts(extensionRunner),
      rebuildChatFromMessages: () => this.rebuildChatFromMessages(),
      showLoadedResources: (options) => this.showLoadedResources(options),
      addMessageToChat: (message, options) =>
        this.addMessageToChat(message, options),
      clearStatusTimers: () => this.clearStatusTimers(),
      flushCompactionQueue: (options) => this.flushCompactionQueue(options),
    });
    this.personaCommands = new PersonaCommandHandlersController({
      session: this.session,
      chatContainer: this.chatContainer,
      ui: this.ui,
      showError: (errorMessage) => this.showError(errorMessage),
      showStatus: (message) => this.showStatus(message),
      showSelector: (create) => this.showSelector(create),
      handleReloadCommand: () => this.sessionCommands.handleReloadCommand(),
    });
    this.configCommands = new ConfigCommandHandlersController({
      session: this.session,
      chatContainer: this.chatContainer,
      ui: this.ui,
      footer: this.footer,
      showStatus: (message) => this.showStatus(message),
      showError: (errorMessage) => this.showError(errorMessage),
    });
    this.infoCommands = new InfoCommandHandlersController({
      session: this.session,
      sessionManager: this.session.sessionManager,
      ui: this.ui,
      version: this.version,
      footerDataProvider: this.footerDataProvider,
      chatContainer: this.chatContainer,
      editorContainer: this.editorContainer,
      keybindings: this.keybindings,
      get editor() {
        return self.editor;
      },
      showStatus: (message) => this.showStatus(message),
      showError: (errorMessage) => this.showError(errorMessage),
      showWarning: (warningMessage) => this.showWarning(warningMessage),
      remountEditorShell: () => this.remountEditorShell(),
      updateTerminalTitle: () => this.updateTerminalTitle(),
      getMarkdownThemeWithSettings: () => this.getMarkdownThemeWithSettings(),
      showLoadedResources: (options) => this.showLoadedResources(options),
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
        isExtensionCommand: (text) => this.sessionCommands.isExtensionCommand(text),
        handleAgentLoopCommand: (text) => this.configCommands.handleAgentLoopCommand(text),
        handleMcpCommand: (text) => this.configCommands.handleMcpCommand(text),
        handleExportCommand: (text) => this.infoCommands.handleExportCommand(text),
        handleShareCommand: () => this.infoCommands.handleShareCommand(),
        handleCopyCommand: () => this.infoCommands.handleCopyCommand(),
        handleStatusCommand: () => this.infoCommands.handleStatusCommand(),
        handleUsageCommand: () => this.infoCommands.handleUsageCommand(),
        handleNameCommand: (text) => this.infoCommands.handleNameCommand(text),
        handleSessionCommand: () => this.infoCommands.handleSessionCommand(),
        handleChangelogCommand: () => this.infoCommands.handleChangelogCommand(),
        handleHotkeysCommand: () => this.infoCommands.handleHotkeysCommand(),
        handleShowResourcesCommand: () => this.infoCommands.handleShowResourcesCommand(),
        handleClearCommand: () => this.sessionCommands.handleClearCommand(),
        handleCompactCommand: (customInstructions) =>
          this.sessionCommands.handleCompactCommand(customInstructions),
        handleReloadCommand: () => this.sessionCommands.handleReloadCommand(),
        handleLanguageCommand: (text) => this.configCommands.handleLanguageCommand(text),
        handleSoulCommand: () => this.personaCommands.handleSoulCommand(),
        handlePersonaCommand: (text) => this.personaCommands.handlePersonaCommand(text),
        handleMemoryCommand: () => this.personaCommands.handleMemoryCommand(),
        handleArminSaysHi: () => this.infoCommands.handleArminSaysHi(),
        handleBrowserOptInCommand: () => this.personaCommands.handleBrowserOptInCommand(),
        getAvailablePersonaIds: () => this.personaCommands.getAvailablePersonaIds(),
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
        isExtensionCommand: (text) => this.sessionCommands.isExtensionCommand(text),
        handlePersonaCommand: (text) => this.personaCommands.handlePersonaCommand(text),
        handleBashCommand: (command, excludeFromContext) =>
          this.sessionCommands.handleBashCommand(command, excludeFromContext),
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
        getAgentDir: () => this.session.agentDir,
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

    // ① 同步构建完整 UI 树（含占位组件）。所有 addChild 必须在
    //    ui.start() 之前完成，让 TUI 首帧就能渲染出全部区块，
    //    不再出现"输入框两条线先出现、其它等 1 秒"的撕裂感。
    this.buildHeaderAndLayout();

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

    // ② 防 echo 残影 + 立即启动 TUI。TUI.start() 现在会同步触发
    //    首帧 doRender()（见 core/lib/tui/src/tui.ts），所以下面的
    //    这行一执行，屏幕上就已经有完整 UI 了。
    this.ui.terminal.write("\x1b[?25l\x1b[2J\x1b[H");
    this.ui.start();
    time("interactive.ui.firstFrame");
    this.isInitialized = true;
    this.prewarmStartupTools();

    // Set terminal title
    this.updateTerminalTitle();

    // Subscribe to agent events
    this.subscribeToAgent();

    // ③ fire-and-forget 异步补充真值。所有对 UI 有可见影响但需要
    //    异步结果的步骤在这里并发跑，每个完成点 requestRender 一次，
    //    由 differential render 自动把"占位"补成"真值"。
    //    注意：先 clear 一次 chatContainer，避免 showLoadedResources
    //    在 initExtensions 完成前被 renderInitialMessages 提前写入
    //    的占位消息污染。
    this.chatContainer.clear();

    void this.applyPersonaFromSessionIfAny()
      .catch((err: unknown) =>
        this.showExtensionError(
          "(persona)",
          err instanceof Error ? err.message : String(err),
        ),
      )
      .finally(() => this.ui.requestRender());

    void this.initExtensions()
      .catch((err: unknown) =>
        this.showExtensionError(
          "(extensions)",
          err instanceof Error ? err.message : String(err),
        ),
      )
      .finally(() => {
        this.renderInitialMessages({ requestRender: false });
        this.ui.requestRender();
      });

    void this.session.extensionRunner
      ?.emit({ type: "session_ready" })
      .catch((err: unknown) =>
        this.showExtensionError(
          "(session_ready)",
          err instanceof Error ? err.message : String(err),
        ),
      )
      .finally(() => this.ui.requestRender());

    void this.modelOverlay
      .updateAvailableProviderCount()
      .catch(() => {
        /* footer 数字保持占位即可 */
      })
      .finally(() => {
        this.footer.invalidate();
        this.ui.requestRender();
      });

    // ④ 主题 / branch watcher 同步挂上
    onThemeChange(() => {
      this.ui.invalidate();
      this.updateEditorBorderColor();
      this.ui.requestRender();
    });
    this.footerDataProvider.onBranchChange(() => {
      this.ui.requestRender();
    });

    time("interactive.firstInput.ready");
    printTimings();

    // Warm MCP tools in the background now that the prompt is usable. MCP server
    // spawn/handshake can take many seconds (the npx-based default servers
    // measure ~20s); blocking the UI on it used to make startup feel frozen.
    // Tools merge into the live runtime when ready (sdk:mcp_ready → showStatus).
    void this.session.warmupMcpTools();
  }

  /**
   * 同步构建 header + layout。把这段从 init() 抽出，让 init()
   * 的主体只剩"装配与启动"，阅读性更好。
   */
  private buildHeaderAndLayout(): void {
    // Add header container as first child
    this.ui.addChild(this.headerContainer);

    // Add header with keybindings from config (unless silenced)
    if (this.options.verbose || !this.settingsManager.getQuietStartup()) {
      const logo =
        theme.bold(theme.fg("accent", APP_NAME)) +
        theme.fg("dim", ` v${this.version}`);
      const whatsNewLine =
        APP_NAME === "catui" || APP_NAME === "catui"
          ? `${theme.fg("dim", CATUI_WHATS_NEW)}\n`
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

    // Start background polling for silent auto-updates (every 30 min, "always" mode only)
    this.selfUpdate.startBackgroundPolling();

    // Start version check asynchronously (for notification only, if auto-update is not enabled)
    const autoUpdate = this.settingsManager.getAutoUpdate();
    if (autoUpdate !== "always") {
      this.selfUpdate.checkForNewVersion().then(async (newVersion) => {
        if (newVersion) {
          await this.selfUpdate.showNewVersionNotification(newVersion);
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
      const _loopStart = performance.now();
      _dbg(`main loop: got input "${userInput.slice(0, 80)}"`);
      try {
        await this.session.prompt(userInput);
        _dbg(`main loop: prompt returned normally (${(performance.now() - _loopStart).toFixed(0)}ms)`);
      } catch (error: unknown) {
        _dbg(`main loop: prompt threw: ${error} (${(performance.now() - _loopStart).toFixed(0)}ms)`);
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
          .map((f) => theme.fg("dim", `  ${formatDisplayPath(f.path)}`))
          .join("\n");
        this.chatContainer.addChild(
          new Text(`${sectionHeader("Context")}\n${contextList}`, 0, 0),
        );
        this.chatContainer.addChild(new Spacer(1));
      }

      const skills = skillsResult.skills;
      if (skills.length > 0) {
        const skillPaths = skills.map((s) => s.filePath);
        const groups = buildScopeGroups(skillPaths, metadata);
        const skillList = formatScopeGroups(groups, {
          formatPath: (p) => formatDisplayPath(p),
          formatPackagePath: (p, source) => getShortPath(p, source),
        });
        this.chatContainer.addChild(
          new Text(`${sectionHeader("Skills")}\n${skillList}`, 0, 0),
        );
        this.chatContainer.addChild(new Spacer(1));
      }

      const templates = this.session.promptTemplates;
      if (templates.length > 0) {
        const templatePaths = templates.map((t) => t.filePath);
        const groups = buildScopeGroups(templatePaths, metadata);
        const templateByPath = new Map(templates.map((t) => [t.filePath, t]));
        const templateList = formatScopeGroups(groups, {
          formatPath: (p) => {
            const template = templateByPath.get(p);
            return template ? `/${template.name}` : formatDisplayPath(p);
          },
          formatPackagePath: (p) => {
            const template = templateByPath.get(p);
            return template ? `/${template.name}` : formatDisplayPath(p);
          },
        });
        this.chatContainer.addChild(
          new Text(`${sectionHeader("Prompts")}\n${templateList}`, 0, 0),
        );
        this.chatContainer.addChild(new Spacer(1));
      }

      const extensionPaths = options?.extensionPaths ?? [];
      if (extensionPaths.length > 0) {
        const groups = buildScopeGroups(extensionPaths, metadata);
        const extList = formatScopeGroups(groups, {
          formatPath: (p) => formatDisplayPath(p),
          formatPackagePath: (p, source) => getShortPath(p, source),
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
        const groups = buildScopeGroups(themePaths, metadata);
        const themeList = formatScopeGroups(groups, {
          formatPath: (p) => formatDisplayPath(p),
          formatPackagePath: (p, source) => getShortPath(p, source),
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
        const warningLines = formatDiagnostics(skillDiagnostics, metadata);
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
        const warningLines = formatDiagnostics(
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
        const warningLines = formatDiagnostics(
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
        const warningLines = formatDiagnostics(themeDiagnostics, metadata);
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
            (this.state.loadingAnimation as CatuiLoader).stop();
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
          await this.sessionCommands.handleReloadCommand();
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
    (this.state.loadingAnimation as CatuiLoader).setMessage(
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
      this.infoCommands.handleShowResourcesCommand(),
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
    this.ui.onDebug = () => this.infoCommands.handleRenderDebugCommand();
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
    this.defaultEditor.onAction("newSession", () => this.sessionCommands.handleClearCommand());
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
    // When a user message starts being processed, the agent has just picked it
    // up from the steering/follow-up queue. agent-session already spliced it
    // from the session's _steeringMessages/_followUpMessages, but the UI's
    // pendingMessagesContainer is not auto-refreshed. Re-render now so the
    // "Steering: <msg> / ↳ Alt+Up to edit all queued messages" line disappears
    // the moment the queued message starts processing (instead of lingering
    // until the next user submit / dequeue).
    if (event.type === "message_start" && event.message.role === "user") {
      this.updatePendingMessagesDisplay();
    }
    await this.streamRender.handle(event);
  }

  private async applyPersonaFromSessionIfAny(): Promise<void> {
    await this.personaCommands.applyPersonaFromSessionIfAny();
  }

  /** Extract text content from a user message */
  private getUserMessageText(message: Message): string {
    return this.chatRenderer.getUserMessageText(message);
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
    this.chatRenderer.addMessageToChat(message, options);
  }

  renderInitialMessages(options: { requestRender?: boolean } = {}): void {
    this.chatRenderer.renderInitialMessages(options);
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
    this.chatRenderer.rebuildChatFromMessages();
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

    // Stop background auto-update polling
    this.selfUpdate.stopBackgroundPolling();

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
    console.log(`\nResume this session with: catui --session ${sessionId} --cwd "${cwd}"`);

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
      if (this.sessionCommands.isExtensionCommand(text)) {
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
    const tmpFile = path.join(os.tmpdir(), `catui-editor-${Date.now()}.catui.md`);

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
      const dequeueHint = this.infoCommands.getAppKeyDisplay("dequeue");
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
          if (this.sessionCommands.isExtensionCommand(message.text)) {
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
        (message) => !this.sessionCommands.isExtensionCommand(message.text),
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
        if (this.sessionCommands.isExtensionCommand(message.text)) {
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

  stop(): void {
    this.stopWelcomeBannerTimer();
    this.clearBuddyPetResetTimer();
    this.buddyPet?.dispose();
    this.buddyPet = null;
    if (this.state.loadingAnimation) {
      (this.state.loadingAnimation as CatuiLoader).stop();
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


}


