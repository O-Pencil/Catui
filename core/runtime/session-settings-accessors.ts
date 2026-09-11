/**
 * [WHO]: SessionSettingsAccessors() mixin — AgentSession 的 settings getter/setter 转发面
 * [FROM]: Depends on SettingsManager type and a minimal host interface
 * [TO]: Consumed by AgentSession (core/runtime/agent-session.ts) via mixin composition
 * [HERE]: core/runtime/session-settings-accessors.ts — settings accessor surface of AgentSession
 *
 * 拆分背景：agent-session.ts 曾有 115 个方法，其中 52 个是 settingsManager 的
 * 一行转发（display/model/image/behavior settings 的 GUI-facing 访问面）。
 * 这些方法不含会话逻辑，抽离后主类瘦身 ~300 行，公共 API 面不变
 * （mixin 方法落在原型链上，session.getTheme() 等调用方无感知）。
 */
import type { SettingsManager, ThinkingBudgetsSettings } from "../platform/config/settings-manager.js";

/** Minimal host shape required by the mixin. */
export interface SettingsManagerHost {
  settingsManager: SettingsManager;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Constructor<T> = abstract new (...args: any[]) => T;

/**
 * Mixin providing the settings getter/setter forwarding surface.
 * All methods are one-line delegations to `this.settingsManager` — pure
 * data access, no session logic, no side effects beyond the settings store.
 */
export function SessionSettingsAccessors<THost extends Constructor<SettingsManagerHost>>(Base: THost) {
  abstract class SessionSettingsAccessorsMixin extends Base {
    // =========================================================================
    // Steering & Follow-up Modes (also synced to agent in AgentSession)
    // =========================================================================

    // =========================================================================
    // Display Settings (GUI-facing)
    // =========================================================================

    /** Current theme name. */
    getTheme(): string | undefined {
      return this.settingsManager.getTheme();
    }

    /** Set theme. Saves to settings. */
    setTheme(theme: string): void {
      this.settingsManager.setTheme(theme);
    }

    /** Whether images are rendered in terminal. */
    getShowImages(): boolean {
      return this.settingsManager.getShowImages();
    }

    /** Show or hide images in terminal. Saves to settings. */
    setShowImages(show: boolean): void {
      this.settingsManager.setShowImages(show);
    }

    /** Whether token usage stats are shown in footer. */
    getShowTokenStats(): boolean {
      return this.settingsManager.getShowTokenStats();
    }

    /** Show or hide token usage stats in footer. Saves to settings. */
    setShowTokenStats(enabled: boolean): void {
      this.settingsManager.setShowTokenStats(enabled);
    }

    /** Whether tool execution trace (including edit diffs) is shown in chat. */
    getShowWorkingTrace(): boolean {
      return this.settingsManager.getShowWorkingTrace();
    }

    /** Show or hide tool execution trace (including edit diffs) in chat. Saves to settings. */
    setShowWorkingTrace(enabled: boolean): void {
      this.settingsManager.setShowWorkingTrace(enabled);
    }

    /** Whether NanoMem search/recall/alignment traces are shown in chat. */
    getShowMemoryTrace(): boolean {
      return this.settingsManager.getShowMemoryTrace();
    }

    /** Show or hide NanoMem traces in chat. Saves to settings. */
    setShowMemoryTrace(enabled: boolean): void {
      this.settingsManager.setShowMemoryTrace(enabled);
    }

    /** Whether buddy pet is displayed. */
    getBuddyEnabled(): boolean {
      return this.settingsManager.getBuddyEnabled();
    }

    /** Enable or disable buddy pet. Saves to settings. */
    setBuddyEnabled(enabled: boolean): void {
      this.settingsManager.setBuddyEnabled(enabled);
    }

    /** Buddy species index. */
    getBuddySpecies(): number {
      return this.settingsManager.getBuddySpecies();
    }

    /** Set buddy species index. Saves to settings. */
    setBuddySpecies(species: number): void {
      this.settingsManager.setBuddySpecies(species);
    }

    /** Whether presence feature is enabled. */
    getPresenceEnabled(): boolean {
      return this.settingsManager.getPresenceEnabled();
    }

    /** Enable or disable presence. Saves to settings. */
    setPresenceEnabled(enabled: boolean): void {
      this.settingsManager.setPresenceEnabled(enabled);
    }

    /** Whether hardware cursor is shown. */
    getShowHardwareCursor(): boolean {
      return this.settingsManager.getShowHardwareCursor();
    }

    /** Show or hide hardware cursor. Saves to settings. */
    setShowHardwareCursor(enabled: boolean): void {
      this.settingsManager.setShowHardwareCursor(enabled);
    }

    /** Whether empty rows are cleared when content shrinks. */
    getClearOnShrink(): boolean {
      return this.settingsManager.getClearOnShrink();
    }

    /** Enable or disable clear-on-shrink. Saves to settings. */
    setClearOnShrink(enabled: boolean): void {
      this.settingsManager.setClearOnShrink(enabled);
    }

    /** Whether startup banner is suppressed. */
    getQuietStartup(): boolean {
      return this.settingsManager.getQuietStartup();
    }

    /** Enable or disable quiet startup. Saves to settings. */
    setQuietStartup(quiet: boolean): void {
      this.settingsManager.setQuietStartup(quiet);
    }

    /** Whether thinking blocks are hidden in output. */
    getHideThinkingBlock(): boolean {
      return this.settingsManager.getHideThinkingBlock();
    }

    /** Show or hide thinking blocks. Saves to settings. */
    setHideThinkingBlock(hide: boolean): void {
      this.settingsManager.setHideThinkingBlock(hide);
    }

    /** Double-escape key action. */
    getDoubleEscapeAction(): "fork" | "tree" | "none" {
      return this.settingsManager.getDoubleEscapeAction();
    }

    /** Set double-escape key action. Saves to settings. */
    setDoubleEscapeAction(action: "fork" | "tree" | "none"): void {
      this.settingsManager.setDoubleEscapeAction(action);
    }

    /** Editor horizontal padding (0-3). */
    getEditorPaddingX(): number {
      return this.settingsManager.getEditorPaddingX();
    }

    /** Set editor horizontal padding (0-3). Saves to settings. */
    setEditorPaddingX(padding: number): void {
      this.settingsManager.setEditorPaddingX(padding);
    }

    /** Max visible autocomplete suggestions (3-20). */
    getAutocompleteMaxVisible(): number {
      return this.settingsManager.getAutocompleteMaxVisible();
    }

    /** Set max visible autocomplete suggestions (3-20). Saves to settings. */
    setAutocompleteMaxVisible(maxVisible: number): void {
      this.settingsManager.setAutocompleteMaxVisible(maxVisible);
    }

    /** Code block indent string. */
    getCodeBlockIndent(): string {
      return this.settingsManager.getCodeBlockIndent();
    }

    // =========================================================================
    // Model & Provider Settings (GUI-facing)
    // =========================================================================

    /** Default model provider name. */
    getDefaultProvider(): string | undefined {
      return this.settingsManager.getDefaultProvider();
    }

    /** Set default model provider. Saves to settings. */
    setDefaultProvider(provider: string): void {
      this.settingsManager.setDefaultProvider(provider);
    }

    /** Default model ID. */
    getDefaultModel(): string | undefined {
      return this.settingsManager.getDefaultModel();
    }

    /** Set default model ID. Saves to settings. */
    setDefaultModel(modelId: string): void {
      this.settingsManager.setDefaultModel(modelId);
    }

    /** Set both default provider and model atomically. Saves to settings. */
    setDefaultModelAndProvider(provider: string, modelId: string): void {
      this.settingsManager.setDefaultModelAndProvider(provider, modelId);
    }

    /** Thinking token budgets per level. */
    getThinkingBudgets(): ThinkingBudgetsSettings | undefined {
      return this.settingsManager.getThinkingBudgets();
    }

    /** Enabled model patterns (undefined = all). */
    getEnabledModels(): string[] | undefined {
      return this.settingsManager.getEnabledModels();
    }

    /** Set enabled model patterns (undefined = all). Saves to settings. */
    setEnabledModels(patterns: string[] | undefined): void {
      this.settingsManager.setEnabledModels(patterns);
    }

    // =========================================================================
    // Image Settings (GUI-facing)
    // =========================================================================

    /** Whether images are auto-resized for model compatibility. */
    getImageAutoResize(): boolean {
      return this.settingsManager.getImageAutoResize();
    }

    /** Enable or disable image auto-resize. Saves to settings. */
    setImageAutoResize(enabled: boolean): void {
      this.settingsManager.setImageAutoResize(enabled);
    }

    /** Whether all images are blocked from being sent to LLM. */
    getBlockImages(): boolean {
      return this.settingsManager.getBlockImages();
    }

    /** Block or unblock images from being sent to LLM. Saves to settings. */
    setBlockImages(blocked: boolean): void {
      this.settingsManager.setBlockImages(blocked);
    }

    // =========================================================================
    // Behavior Settings (GUI-facing)
    // =========================================================================

    /** Shell executable path. */
    getShellPath(): string | undefined {
      return this.settingsManager.getShellPath();
    }

    /** Set shell executable path. Saves to settings. */
    setShellPath(path: string | undefined): void {
      this.settingsManager.setShellPath(path);
    }

    /** Shell command prefix (e.g., wrapper). */
    getShellCommandPrefix(): string | undefined {
      return this.settingsManager.getShellCommandPrefix();
    }

    /** Set shell command prefix. Saves to settings. */
    setShellCommandPrefix(prefix: string | undefined): void {
      this.settingsManager.setShellCommandPrefix(prefix);
    }

    /** Auto-update mode. */
    getAutoUpdate(): "always" | "prompt" | "never" {
      return this.settingsManager.getAutoUpdate();
    }

    /** Set auto-update mode. Saves to settings. */
    setAutoUpdate(mode: "always" | "prompt" | "never"): void {
      this.settingsManager.setAutoUpdate(mode);
    }

    /** Whether skill slash commands are enabled. */
    getEnableSkillCommands(): boolean {
      return this.settingsManager.getEnableSkillCommands();
    }

    /** Enable or disable skill slash commands. Saves to settings. */
    setEnableSkillCommands(enabled: boolean): void {
      this.settingsManager.setEnableSkillCommands(enabled);
    }

    /** Whether auto-retry is enabled */
    get autoRetryEnabled(): boolean {
      return this.settingsManager.getRetryEnabled();
    }

    /** Toggle auto-retry setting. */
    setAutoRetryEnabled(enabled: boolean): void {
      this.settingsManager.setRetryEnabled(enabled);
    }
  }

  return SessionSettingsAccessorsMixin;
}