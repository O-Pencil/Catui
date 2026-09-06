/**
 * [WHO]: Provides PersonaCommandHandlersController + PersonaCommandHandlersContext — interactive
 *        persona/soul/memory command bodies (/persona, /soul, /memory, /browser opt-in, session persona apply)
 * [FROM]: Depends on injected host capability closures + persona-manager; no InteractiveMode reference
 * [TO]: Consumed by modes/interactive/interactive-mode.ts (held as `this.personaCommands`; wired into
 *       SlashDispatcherController commands port + startup persona application)
 * [HERE]: modes/interactive/controllers/persona-command-handlers.ts — P7 C-3a slice 2/4 (extracted from
 *         InteractiveMode command-handler block; behavior-preserving move)
 */
import * as fs from "node:fs";
import { Spacer, Text, type CachedContainer, type Component, type TUI } from "@catui/tui";
import type { AgentSession } from "../../../core/runtime/agent-session.js";
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
} from "../../../core/persona/persona-manager.js";
import { PersonaSelectorComponent } from "../components/persona-selector.js";
import { formatSoulStats } from "../components/soul-stats.js";
import { theme } from "../theme/theme.js";

/** Host capabilities needed by the persona/soul/memory command handlers. */
export interface PersonaCommandHandlersContext {
  readonly session: AgentSession;
  readonly chatContainer: CachedContainer;
  readonly ui: TUI;
  showError(errorMessage: string): void;
  showStatus(message: string): void;
  showSelector(
    create: (done: () => void) => { component: Component; focus: Component },
  ): void;
  /** Persona switching ends with a full extension/theme reload (session-commands slice). */
  handleReloadCommand(): Promise<void>;
}

export class PersonaCommandHandlersController {
  constructor(private readonly ctx: PersonaCommandHandlersContext) {}

  /**
   * If session is tagged with a persona, apply it to env + active persona file,
   * then reload session runtime so Catui/Soul/NanoMem/Skills/MCP can be re-wired.
   */
  async applyPersonaFromSessionIfAny(): Promise<void> {
    const entries = this.ctx.session.sessionManager.getEntries();
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

    // A custom persona may have been removed after this session was tagged.
    // Fall back to the current valid persona instead of wiring extensions to
    // missing directories or failing the entire session resume.
    const availablePersonaIds = new Set(listPersonas());
    if (!availablePersonaIds.has(personaId)) {
      personaId = getActivePersonaId();
    }
    if (!personaId || !availablePersonaIds.has(personaId)) return;

    // Apply persona env vars so extensions (NanoMem, Soul, MCP) use persona dirs
    process.env.NANOMEM_MEMORY_DIR = toAbsolutePath(
      getPersonaMemoryDir(personaId),
    );
    process.env.SOUL_DIR = toAbsolutePath(getPersonaSoulDir(personaId));
    process.env.MCP_CONFIG_PATH = toAbsolutePath(
      getPersonaMcpConfigPath(personaId),
    );
    process.env.NANO_PERSONA_DIR = toAbsolutePath(getPersonaDir(personaId));

    // Persist persona id from session tag if needed
    if (personaEntries.length > 0) setActivePersonaId(personaId);

    // Reload to reinitialize extensions with persona env vars.
    // Extensions were created during createAgentSession() with global defaults,
    // so a reload is needed even when the persona was already active.
    if (!this.ctx.session.isStreaming && !this.ctx.session.isCompacting) {
      await this.ctx.session.reload();
    }
  }

  handleSoulCommand(): void {
    const soulManager = (this.ctx.session as any)._soulManager;
    if (!soulManager) {
      this.ctx.chatContainer.addChild(new Spacer(1));
      this.ctx.chatContainer.addChild(
        new Text(theme.fg("warning", "⚠️  Soul Not Enabled"), 1, 0),
      );
      this.ctx.chatContainer.addChild(
        new Text(
          theme.fg(
            "dim",
            "Soul (AI personality system) is not enabled. Please use Catui 1.3.0 or later.",
          ),
          1,
          0,
        ),
      );
      this.ctx.ui.requestRender();
      return;
    }

    const stats = formatSoulStats(soulManager, { compact: false });

    this.ctx.chatContainer.addChild(new Spacer(1));
    this.ctx.chatContainer.addChild(new Text(stats, 1, 0));
    this.ctx.ui.requestRender();
  }

  async handlePersonaCommand(text: string): Promise<void> {
    const parts = text.trim().split(/\s+/);
    const action = (parts[1] ?? "list").toLowerCase();
    const personaArg = parts[2];

    if (action === "list" || action === "use" && !personaArg) {
      // Show interactive persona selector
      const personaIds = listPersonas();
      const active = getActivePersonaId();

      this.ctx.showSelector((done) => {
        const selector = new PersonaSelectorComponent(
          this.ctx.ui,
          personaIds,
          active,
          getPersonaDescription,
          (personaId) => {
            done();
            void this.switchPersona(personaId);
          },
          () => {
            done();
            this.ctx.ui.requestRender();
          },
        );
        return { component: selector, focus: selector };
      });
      return;
    }

    if (action !== "use") {
      this.ctx.chatContainer.addChild(new Spacer(1));
      this.ctx.chatContainer.addChild(
        new Text(
          theme.fg(
            "dim",
            "Usage:\n- /persona (open selector)\n- /persona use <personaId>",
          ),
          1,
          0,
        ),
      );
      this.ctx.ui.requestRender();
      return;
    }

    const personaId = personaArg ? personaArg.trim() : "";
    if (!personaId) {
      this.ctx.showError("Missing personaId. Use: /persona use <personaId>");
      return;
    }

    await this.switchPersona(personaId);
  }

  private async switchPersona(personaId: string): Promise<void> {
    // setActivePersonaId triggers ensurePersonasDir() which copies bundled
    // personas to ~/.catui/agent/personas/ on first run. Must be called
    // before checking if the persona directory exists.
    try {
      setActivePersonaId(personaId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.ctx.showError(message);
      return;
    }

    const personaDir = getPersonaDir(personaId);
    if (!fs.existsSync(personaDir)) {
      this.ctx.showError(`Persona not found: ${personaId}\nExpected: ${personaDir}`);
      return;
    }

    // Fork from the latest user message so the existing conversation keeps its
    // persona on the old branch. A session with no user message yet has nothing
    // to preserve — switch in place without forking (resume reads the LAST
    // persona entry in the branch, so re-tagging is safe).
    const branch = this.ctx.session.sessionManager.getBranch();
    let forkFromEntryId: string | undefined;
    for (let i = branch.length - 1; i >= 0; i--) {
      const e: any = branch[i];
      if (e?.type === "message" && e?.message?.role === "user") {
        forkFromEntryId = e.id;
        break;
      }
    }

    if (forkFromEntryId) {
      // Create branched session directly (instead of session.fork) so the
      // user's last message is INCLUDED in the new branch. The general
      // fork() excludes it (branches from parentId) to support edit-and-resend,
      // but for persona switching we want the new persona to see the user's
      // message and respond to it naturally.
      this.ctx.session.sessionManager.createBranchedSession(forkFromEntryId);
      // Sync agent messages with the new branch so the LLM sees the correct
      // conversation history under the new persona.
      const sessionContext = this.ctx.session.sessionManager.buildSessionContext();
      this.ctx.session.agent.replaceMessages(sessionContext.messages);
    }

    // Tag this branch with personaId for later resume.
    this.ctx.session.sessionManager.appendCustomEntry("persona", { personaId });

    // Apply persona-specific env before reload so extensions/system prompt use it.
    process.env.NANOMEM_MEMORY_DIR = toAbsolutePath(
      getPersonaMemoryDir(personaId),
    );
    process.env.SOUL_DIR = toAbsolutePath(getPersonaSoulDir(personaId));
    process.env.MCP_CONFIG_PATH = toAbsolutePath(
      getPersonaMcpConfigPath(personaId),
    );
    process.env.NANO_PERSONA_DIR = toAbsolutePath(getPersonaDir(personaId));

    // Set flag to skip interview on first message after persona switch
    process.env.CATUI_JUST_SWITCHED_PERSONA = "true";

    await this.ctx.handleReloadCommand();
    this.ctx.showStatus(`Persona switched to: ${personaId}`);
  }

  handleMemoryCommand(): void {
    const lines: string[] = [];
    lines.push(theme.fg("accent", "📚 Project Memory - NanoMem"));
    lines.push("");
    lines.push(theme.fg("dim", `Storage: ${this.ctx.session.agentDir}/memory/`));
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

    this.ctx.chatContainer.addChild(new Spacer(1));
    this.ctx.chatContainer.addChild(new Text(lines.join("\n"), 1, 0));
    this.ctx.ui.requestRender();
  }

  getAvailablePersonaIds(): string[] {
    try {
      return listPersonas();
    } catch {
      return [];
    }
  }

  handleBrowserOptInCommand(): void {
    this.ctx.showStatus(
      [
        "Browser automation is opt-in.",
        "",
        "Enable it by starting Catui with:",
        "  --extension extensions/builtin/browser",
        "",
        "Or add that path to your extensions config, then run /browser status.",
      ].join("\n"),
    );
  }
}
