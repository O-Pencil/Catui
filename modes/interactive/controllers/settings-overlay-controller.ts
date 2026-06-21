/**
 * [WHO]: Provides SettingsOverlayController + SettingsOverlayContext — interactive /settings overlay orchestration
 * [FROM]: Depends on AgentSession, SettingsManager, SettingsSelectorComponent, interactive theme/render/editor ports
 * [TO]: Consumed by modes/interactive/interactive-mode.ts for the /settings command
 * [HERE]: modes/interactive/controllers/settings-overlay-controller.ts — P5 settings-overlay slice (UI07, hybrid)
 *
 * Owns the interactive settings overlay wiring only. Settings persistence remains in SettingsManager,
 * session behavior remains in AgentSession, and render/editor/buddy effects are delegated through ports.
 */

import type {
  AgentLoopFrameworkInput,
  ThinkingLevel,
} from "@catui/agent-core";
import type { Component } from "@catui/tui";
import type { AgentSession } from "../../../core/runtime/agent-session.js";
import type { SettingsManager } from "../../../core/platform/config/settings-manager.js";
import { getAvailableThemes, setTheme } from "../theme/theme.js";
import { SettingsSelectorComponent } from "../components/settings-selector.js";

export interface SettingsOverlaySurface {
  showSelector(
    create: (done: () => void) => { component: Component; focus: Component },
  ): void;
  showStatus(message: string): void;
  showError(message: string): void;
  invalidateUi(): void;
  requestRender(): void;
  setShowHardwareCursor(enabled: boolean): void;
  setClearOnShrink(enabled: boolean): void;
}

export interface SettingsOverlayFooterPort {
  setAutoCompactEnabled(enabled: boolean): void;
  setShowTokenStats(enabled: boolean): void;
  invalidate(): void;
}

export interface SettingsOverlayEditorPort {
  setPaddingX(padding: number): void;
  setAutocompleteMaxVisible(maxVisible: number): void;
  updateBorderColor(): void;
}

export interface SettingsOverlayRenderPort {
  setToolImagesEnabled(enabled: boolean): void;
  setAssistantThinkingHidden(hidden: boolean): void;
  rebuildChatFromMessages(): void;
}

export interface SettingsOverlayContext {
  session: AgentSession;
  settingsManager: SettingsManager;
  surface: SettingsOverlaySurface;
  footer: SettingsOverlayFooterPort;
  editor: SettingsOverlayEditorPort;
  render: SettingsOverlayRenderPort;
  getHideThinkingBlock(): boolean;
  setHideThinkingBlock(hidden: boolean): void;
  rebuildAutocomplete(): void;
  syncBuddyPet(): void;
}

export class SettingsOverlayController {
  constructor(private readonly ctx: SettingsOverlayContext) {}

  showSettingsSelector(): void {
    const { session, settingsManager } = this.ctx;

    this.ctx.surface.showSelector((done) => {
      const selector = new SettingsSelectorComponent(
        {
          autoCompact: session.autoCompactionEnabled,
          showImages: settingsManager.getShowImages(),
          autoResizeImages: settingsManager.getImageAutoResize(),
          blockImages: settingsManager.getBlockImages(),
          enableSkillCommands: settingsManager.getEnableSkillCommands(),
          steeringMode: session.steeringMode,
          followUpMode: session.followUpMode,
          transport: settingsManager.getTransport(),
          agentLoopFramework:
            settingsManager.getAgentLoopFramework() ?? "model-default",
          thinkingLevel: session.thinkingLevel,
          availableThinkingLevels: session.getAvailableThinkingLevels(),
          currentTheme: settingsManager.getTheme() || "dark",
          availableThemes: getAvailableThemes(),
          hideThinkingBlock: this.ctx.getHideThinkingBlock(),
          collapseChangelog: settingsManager.getCollapseChangelog(),
          doubleEscapeAction: settingsManager.getDoubleEscapeAction(),
          showHardwareCursor: settingsManager.getShowHardwareCursor(),
          editorPaddingX: settingsManager.getEditorPaddingX(),
          autocompleteMaxVisible: settingsManager.getAutocompleteMaxVisible(),
          quietStartup: settingsManager.getQuietStartup(),
          clearOnShrink: settingsManager.getClearOnShrink(),
          showTokenStats: settingsManager.getShowTokenStats(),
          buddyEnabled: settingsManager.getBuddyEnabled(),
          buddySpecies: settingsManager.getBuddySpecies(),
          showWorkingTrace: settingsManager.getShowWorkingTrace(),
          showMemoryTrace: settingsManager.getShowMemoryTrace(),
          presenceEnabled: settingsManager.getPresenceEnabled(),
          nextStepEnabled: settingsManager.getNextStepEnabled(),
        },
        {
          onAutoCompactChange: (enabled) => {
            session.setAutoCompactionEnabled(enabled);
            this.ctx.footer.setAutoCompactEnabled(enabled);
          },
          onShowImagesChange: (enabled) => {
            settingsManager.setShowImages(enabled);
            this.ctx.render.setToolImagesEnabled(enabled);
          },
          onAutoResizeImagesChange: (enabled) => {
            settingsManager.setImageAutoResize(enabled);
          },
          onBlockImagesChange: (blocked) => {
            settingsManager.setBlockImages(blocked);
          },
          onEnableSkillCommandsChange: (enabled) => {
            settingsManager.setEnableSkillCommands(enabled);
            this.ctx.rebuildAutocomplete();
          },
          onSteeringModeChange: (mode) => {
            session.setSteeringMode(mode);
          },
          onFollowUpModeChange: (mode) => {
            session.setFollowUpMode(mode);
          },
          onTransportChange: (transport) => {
            settingsManager.setTransport(transport);
            session.agent.setTransport(transport);
          },
          onAgentLoopFrameworkChange: (framework) => {
            const value = framework === "model-default" ? undefined : framework;
            settingsManager.setAgentLoopFramework(value);
            session.setAgentLoopFramework(value as AgentLoopFrameworkInput | undefined);
            this.ctx.footer.invalidate();
            this.ctx.surface.showStatus(`Agent loop: ${session.agentLoopFramework}`);
          },
          onThinkingLevelChange: (level) => {
            session.setThinkingLevel(level as ThinkingLevel);
            this.ctx.footer.invalidate();
            this.ctx.editor.updateBorderColor();
          },
          onThemeChange: (themeName) => {
            const result = setTheme(themeName, true);
            settingsManager.setTheme(themeName);
            this.ctx.surface.invalidateUi();
            if (!result.success) {
              this.ctx.surface.showError(
                `Failed to load theme "${themeName}": ${result.error}\nFell back to dark theme.`,
              );
            }
          },
          onThemePreview: (themeName) => {
            const result = setTheme(themeName, true);
            if (result.success) {
              this.ctx.surface.invalidateUi();
              this.ctx.surface.requestRender();
            }
          },
          onHideThinkingBlockChange: (hidden) => {
            this.ctx.setHideThinkingBlock(hidden);
            settingsManager.setHideThinkingBlock(hidden);
            this.ctx.render.setAssistantThinkingHidden(hidden);
            this.ctx.render.rebuildChatFromMessages();
          },
          onCollapseChangelogChange: (collapsed) => {
            settingsManager.setCollapseChangelog(collapsed);
          },
          onQuietStartupChange: (enabled) => {
            settingsManager.setQuietStartup(enabled);
          },
          onShowWorkingTraceChange: (enabled) => {
            settingsManager.setShowWorkingTrace(enabled);
          },
          onShowMemoryTraceChange: (enabled) => {
            settingsManager.setShowMemoryTrace(enabled);
          },
          onDoubleEscapeActionChange: (action) => {
            settingsManager.setDoubleEscapeAction(action);
          },
          onShowHardwareCursorChange: (enabled) => {
            settingsManager.setShowHardwareCursor(enabled);
            this.ctx.surface.setShowHardwareCursor(enabled);
          },
          onEditorPaddingXChange: (padding) => {
            settingsManager.setEditorPaddingX(padding);
            this.ctx.editor.setPaddingX(padding);
          },
          onAutocompleteMaxVisibleChange: (maxVisible) => {
            settingsManager.setAutocompleteMaxVisible(maxVisible);
            this.ctx.editor.setAutocompleteMaxVisible(maxVisible);
          },
          onClearOnShrinkChange: (enabled) => {
            settingsManager.setClearOnShrink(enabled);
            this.ctx.surface.setClearOnShrink(enabled);
          },
          onShowTokenStatsChange: (enabled) => {
            settingsManager.setShowTokenStats(enabled);
            this.ctx.footer.setShowTokenStats(enabled);
            this.ctx.surface.requestRender();
          },
          onBuddyEnabledChange: (enabled) => {
            settingsManager.setBuddyEnabled(enabled);
            this.ctx.syncBuddyPet();
          },
          onBuddySpeciesChange: (species) => {
            settingsManager.setBuddySpecies(species);
            this.ctx.syncBuddyPet();
          },
          onPresenceEnabledChange: (enabled) => {
            settingsManager.setPresenceEnabled(enabled);
          },
          onNextStepEnabledChange: (enabled) => {
            settingsManager.setNextStepEnabled(enabled);
          },
          onCancel: () => {
            done();
            this.ctx.surface.requestRender();
          },
        },
      );
      return { component: selector, focus: selector.getSettingsList() };
    });
  }
}
