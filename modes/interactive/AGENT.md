# modes/interactive/

> P2 | Parent: ../AGENT.md

Member List
interactive-mode.ts: TUI orchestration hub, coordinates AgentSession with terminal UI, handles input/output loop
controllers/image-pipeline-controller.ts: ImagePipelineController, ImagePipelineContext, Attachment — clipboard image paste, attachments bar, attachment key navigation, text→image extraction; narrow ImagePipelineContext, no InteractiveMode reference; extracted from interactive-mode.ts (P5 UI02, 纯搬)
controllers/self-update-controller.ts: SelfUpdateController, SelfUpdateContext — npm-based update/reinstall workflow + startup version check; narrow SelfUpdateContext, no InteractiveMode reference; P5 keeps it inside modes/interactive until a second mode consumer appears (纯搬)
state/interactive-state.ts: InteractiveState, CompactionQueuedMessage — consolidated render/turn UI state; held by InteractiveMode as `this.state`, accessed via `this.state.*` (P5 state 合一, UI02)
controllers/extension-ui/persistent-surface-registry.ts: PersistentSurfaceRegistry, PersistentSurfaceContext — extension keyed persistent surfaces (above/below widgets, custom footer, custom header, footer status); held as `this.surfaces`, wired into ExtensionUIContext setWidget/setFooter/setHeader/setStatus; P5 extension-ui host 1/4 (UI02, 纯搬)
controllers/extension-ui/prompt-host.ts: PromptHost, PromptHostContext — single-active-prompt slot for extension selector/confirm/input/editor dialogs; held as `this.promptHost`, wired into ExtensionUIContext select/confirm/input/editor + focus restore; P5 extension-ui host 2/4 (UI02, 重写)
controllers/extension-ui/custom-overlay-host.ts: CustomOverlayHost, CustomOverlayContext — extension custom overlay/inline component host; pure move of `showExtensionCustom`, preserving saved text restore, overlay handle/onHandle, dynamic overlayOptions, inline focus, and disposal semantics; held as `this.customOverlay`, wired into ExtensionUIContext custom; P5 extension-ui host 3/4 (UI02, 纯搬)
controllers/extension-ui/editor-component-adapter.ts: EditorComponentAdapter, EditorComponentContext — extension editor replacement host; preserves editor text/actions/autocomplete/keybindings/focus restore; held as `this.editorAdapter`, wired into ExtensionUIContext setEditorComponent (P5 extension-ui host 4/4, 纯搬)
controllers/model-overlay-controller.ts: ModelOverlayController, ModelOverlayContext — interactive model/thinking/scoped-model selector workflow; delegates reusable model capability to AgentSession ports, consumes provider precondition through ProviderConfigPort; held as `this.modelOverlay` (P5 UI08, hybrid)
controllers/auth-provider-config-controller.ts: AuthProviderConfigController, AuthProviderConfigContext — interactive API key/OAuth/custom-provider configuration; owns /apikey, /login, /logout and provider precondition flow consumed by model-overlay; no InteractiveMode reference (P5 UI02/UI03, hybrid)
controllers/tree-overlay-controller.ts: TreeOverlayController, TreeOverlayContext — interactive session tree/fork/resume overlays; delegates lifecycle to AgentSession/SessionManager and owns UI selection flow for /tree, /fork, /resume, keybindings, extension switchSession (P5 UI05, 纯搬 + 改名)
controllers/settings-overlay-controller.ts: SettingsOverlayController, SettingsOverlayContext — interactive /settings overlay; composes SettingsManager, AgentSession, theme/editor/render/buddy ports without owning reusable settings or session rules (P5 UI07, hybrid)
controllers/slash-dispatcher-controller.ts: SlashDispatcherController, SlashDispatcherContext — built-in slash command token dispatch and clearEditor policy; delegates command bodies to owner ports and leaves input-submit pipeline outside (P5 UI02, dispatch-table rewrite)
agent-loop-status.ts: formatAgentLoopStatusLines(), formats last agent loop result telemetry for /status
slash-command-arguments.ts: Built-in TUI slash command argument completion helpers for model, agent-loop, thinking, MCP, language, persona, and login commands
footer-data-provider.ts: FooterDataProvider class, supplies model/session/branch footer information for the TUI status bar
theme/theme.ts: Theme loader and definitions, ThemeJson schema validation, chalk-based color system
components/index.ts: Component barrel exports, re-exports all UI components for extensions
components/extension-selector.ts: Extension selector UI, keyboard navigation with timeout support
components/thinking-selector.ts: Thinking level selector, displays reasoning token estimates per level
components/theme-selector.ts: Theme selector UI, live preview on selection
components/user-message.ts: User message display, Markdown rendering with theme colors
components/bordered-loader.ts: Loader with borders, cancellable loading animation
components/oauth-selector.ts: OAuth provider selector, login/logout mode support
components/user-message-selector.ts: User message list selector, chronological message selection
components/diff.ts: Diff visualization, parseDiffLine for +/- line rendering
components/daxnuts.ts: Easter egg animation, tribute to dax (@thdxr) for Kimi K2.5
components/assistant-message.ts: Assistant message display, Markdown with code blocks
components/login-dialog.ts: Login UI dialog, OAuth flow initiation
components/footer.ts: Status bar footer, displays model/session/branch info and clamp-safe context progress bars
components/show-images-selector.ts: Image toggle selector, enables/disables image display
components/pencil-loader.ts: Brand animation loader, rotating diamond animation
components/countdown-timer.ts: Countdown timer, reusable timer for dialogs
components/visual-truncate.ts: Smart text truncation, accounts for line wrapping
components/extension-editor.ts: Multi-line editor for extensions, Ctrl+G for external editor
components/config-selector.ts: Package resources manager, enable/disable packages
components/custom-message.ts: Custom message renderer, MessageRenderer interface
components/tree-selector.ts: Tree view selector, hierarchical session display
components/bash-execution.ts: Bash command execution display, streaming output with truncation
components/tool-execution.ts: Tool call execution display, image rendering support
components/skill-invocation-message.ts: Skill invocation display, collapsed/expanded state
components/soul-stats.ts: Soul statistics display, personality profile visualization
components/dynamic-border.ts: Dynamic border component, viewport-width adaptive
components/attachments-bar.ts: File attachments bar, path/mimeType display
components/memory-stats.ts: Memory statistics display, NanoMem engine integration
components/session-selector-search.ts: Session fuzzy search, ParsedSearchQuery parsing
components/armin.ts: Easter egg animation, XBM art animation
components/keybinding-hints.ts: Keyboard hints utilities, editorKey/appKey formatting
components/compaction-summary-message.ts: Compaction message display, context window summary
components/branch-summary-message.ts: Branch summary display, git branch visualization
components/extension-input.ts: Extension input component, timeout countdown support
components/custom-editor.ts: Custom editor with app keybindings, actionHandlers map
components/model-selector.ts: Model picker UI, fuzzy filter with Ctrl+N append; emits selected model only, provider configuration and default-model persistence stay with caller
components/session-selector.ts: Session picker UI, external editor for descriptions
components/scoped-models-selector.ts: Scoped models selector, project-specific model config
components/apikey-input.ts: API key input dialog, readline-based prompt
components/provider-selector.ts: Provider picker UI, custom protocol provider support
components/settings-selector.ts: Settings UI, thinking level/transport selection

Rule: Members complete, one item per line, parent links valid, precise terms first

[COVENANT]: Update this file header on changes and verify against parent AGENT.md
