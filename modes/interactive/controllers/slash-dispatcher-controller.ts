/**
 * [WHO]: Provides SlashDispatcherController + SlashDispatcherContext — built-in slash command dispatch
 * [FROM]: Depends on injected interactive command owner callbacks; no direct TUI/session/model owner imports
 * [TO]: Consumed by modes/interactive/interactive-mode.ts for built-in slash execution
 * [HERE]: modes/interactive/controllers/slash-dispatcher-controller.ts — P5 slash-dispatcher slice (UI02, dispatch-table rewrite)
 *
 * Owns command-token dispatch only. Input submission rules, extension command execution, persona-in-text
 * handling, bash mode, attachments, and streaming steer remain outside this controller.
 */

export type SlashCommandHandler = (
  text: string,
  clear: () => void,
) => void | Promise<void>;

export interface SlashDispatcherModelPort {
  showScopedModelsSelector(): Promise<void>;
  handleModelCommand(searchTerm?: string): Promise<void>;
  handleThinkingCommand(text: string): void;
}

export interface SlashDispatcherAuthPort {
  handleApiKeyCommand(): Promise<void>;
  handleLoginCommand(text: string): Promise<void>;
  showLogoutSelector(): void;
}

export interface SlashDispatcherTreePort {
  showForkSelector(): void;
  showTreeSelector(): void;
  showSessionSelector(): void;
}

export interface SlashDispatcherSelfUpdatePort {
  handleUpdateCommand(): void;
  handleReinstallCommand(): void;
}

export interface SlashDispatcherCommandHandlers {
  isExtensionCommand(text: string): boolean;
  handleAgentLoopCommand(text: string): void | Promise<void>;
  handleMcpCommand(text: string): Promise<void>;
  handleExportCommand(text: string): Promise<void>;
  handleShareCommand(): Promise<void>;
  handleCopyCommand(): void;
  handleStatusCommand(): Promise<void>;
  handleUsageCommand(): Promise<void>;
  handleNameCommand(text: string): void;
  handleSessionCommand(): void;
  handleChangelogCommand(): void;
  handleHotkeysCommand(): void;
  handleShowResourcesCommand(): void;
  handleClearCommand(): Promise<void>;
  handleCompactCommand(customInstructions?: string): Promise<void>;
  handleReloadCommand(): Promise<void>;
  handleLanguageCommand(text: string): Promise<void>;
  handleSoulCommand(): void;
  handlePersonaCommand(text: string): Promise<void>;
  handleMemoryCommand(): void;
  handleArminSaysHi(): void;
  handleBrowserOptInCommand(): void;
  getAvailablePersonaIds(): string[];
  shutdown(): Promise<void>;
}

export interface SlashDispatcherContext {
  clearEditor(): void;
  settings: {
    showSettingsSelector(): void;
  };
  model: SlashDispatcherModelPort;
  auth: SlashDispatcherAuthPort;
  tree: SlashDispatcherTreePort;
  selfUpdate: SlashDispatcherSelfUpdatePort;
  commands: SlashDispatcherCommandHandlers;
}

export class SlashDispatcherController {
  private readonly builtinSlashCommands: Record<string, SlashCommandHandler>;

  constructor(private readonly ctx: SlashDispatcherContext) {
    this.builtinSlashCommands = this.createBuiltinSlashCommands();
  }

  async execute(
    text: string,
    options?: { clearEditor?: boolean },
  ): Promise<boolean> {
    if (!text.startsWith("/")) return false;

    const clearEditor = options?.clearEditor ?? true;
    const clear = () => {
      if (clearEditor) {
        this.ctx.clearEditor();
      }
    };

    const spaceIdx = text.indexOf(" ");
    const cmd = spaceIdx === -1 ? text : text.slice(0, spaceIdx);
    if (cmd === "/browser" && this.ctx.commands.isExtensionCommand(text)) {
      return false;
    }
    const handler = this.builtinSlashCommands[cmd];
    if (handler) {
      await handler(text, clear);
      return true;
    }

    // Check if the command matches a persona ID (e.g. /vex, /rem, /pencil)
    const personaId = cmd.slice(1); // remove leading "/"
    const personaIds = this.ctx.commands.getAvailablePersonaIds();
    if (personaIds.includes(personaId)) {
      clear();
      await this.ctx.commands.handlePersonaCommand(`use ${personaId}`);
      return true;
    }

    return false;
  }

  private createBuiltinSlashCommands(): Record<string, SlashCommandHandler> {
    return {
      "/settings": (_t, clear) => {
        this.ctx.settings.showSettingsSelector();
        clear();
      },
      "/apikey": async (_t, clear) => {
        await this.ctx.auth.handleApiKeyCommand();
        clear();
      },
      "/scoped-models": async (_t, clear) => {
        clear();
        await this.ctx.model.showScopedModelsSelector();
      },
      "/model": async (text, clear) => {
        const searchTerm = text.startsWith("/model ")
          ? text.slice(7).trim()
          : undefined;
        clear();
        await this.ctx.model.handleModelCommand(searchTerm);
      },
      "/thinking": (text, clear) => {
        this.ctx.model.handleThinkingCommand(text);
        clear();
      },
      "/agent-loop": async (text, clear) => {
        await this.ctx.commands.handleAgentLoopCommand(text);
        clear();
      },
      "/mcp": async (text, clear) => {
        await this.ctx.commands.handleMcpCommand(text);
        clear();
      },
      "/export": async (text, clear) => {
        await this.ctx.commands.handleExportCommand(text);
        clear();
      },
      "/share": async (_t, clear) => {
        await this.ctx.commands.handleShareCommand();
        clear();
      },
      "/copy": (_t, clear) => {
        this.ctx.commands.handleCopyCommand();
        clear();
      },
      "/status": async (_t, clear) => {
        await this.ctx.commands.handleStatusCommand();
        clear();
      },
      "/usage": async (_t, clear) => {
        await this.ctx.commands.handleUsageCommand();
        clear();
      },
      "/name": (text, clear) => {
        this.ctx.commands.handleNameCommand(text);
        clear();
      },
      "/session": (_t, clear) => {
        this.ctx.commands.handleSessionCommand();
        clear();
      },
      "/changelog": (_t, clear) => {
        this.ctx.commands.handleChangelogCommand();
        clear();
      },
      "/hotkeys": (_t, clear) => {
        this.ctx.commands.handleHotkeysCommand();
        clear();
      },
      "/resources": (_t, clear) => {
        this.ctx.commands.handleShowResourcesCommand();
        clear();
      },
      "/fork": (_t, clear) => {
        this.ctx.tree.showForkSelector();
        clear();
      },
      "/tree": (_t, clear) => {
        this.ctx.tree.showTreeSelector();
        clear();
      },
      "/login": async (text, clear) => {
        await this.ctx.auth.handleLoginCommand(text);
        clear();
      },
      "/logout": (_t, clear) => {
        this.ctx.auth.showLogoutSelector();
        clear();
      },
      "/new": async (_t, clear) => {
        clear();
        await this.ctx.commands.handleClearCommand();
      },
      "/update": (_t, clear) => {
        this.ctx.selfUpdate.handleUpdateCommand();
        clear();
      },
      "/reinstall": (_t, clear) => {
        this.ctx.selfUpdate.handleReinstallCommand();
        clear();
      },
      "/compact": async (text, clear) => {
        const customInstructions = text.startsWith("/compact ")
          ? text.slice(9).trim()
          : undefined;
        clear();
        await this.ctx.commands.handleCompactCommand(customInstructions);
      },
      "/reload": async (_t, clear) => {
        clear();
        await this.ctx.commands.handleReloadCommand();
      },
      "/language": async (text, clear) => {
        await this.ctx.commands.handleLanguageCommand(text);
        clear();
      },
      "/soul": (_t, clear) => {
        this.ctx.commands.handleSoulCommand();
        clear();
      },
      "/persona": async (text, clear) => {
        clear();
        await this.ctx.commands.handlePersonaCommand(text);
      },
      "/memory": (_t, clear) => {
        this.ctx.commands.handleMemoryCommand();
        clear();
      },
      "/browser": (_t, clear) => {
        this.ctx.commands.handleBrowserOptInCommand();
        clear();
      },
      "/arminsayshi": (_t, clear) => {
        this.ctx.commands.handleArminSaysHi();
        clear();
      },
      "/resume": (_t, clear) => {
        this.ctx.tree.showSessionSelector();
        clear();
      },
      "/quit": async (_t, clear) => {
        clear();
        await this.ctx.commands.shutdown();
      },
    };
  }
}
