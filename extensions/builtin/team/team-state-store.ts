/**
 * [WHO]: TeamStateStore class — durable teammate persistence
 * [FROM]: Depends on node:fs/promises, node:path, node:os, ./team-types
 * [TO]: Consumed by team-runtime.ts
 * [HERE]: extensions/builtin/team/team-state-store.ts - one JSON file per teammate under <agentDir>/teams/
 *
 * Deliberately independent of core SessionManager. Per refactor plan:
 * "team-state-store 自己负责 teammate 历史 ... SessionManager 只负责主会话".
 */

import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir } from "../../../config.js";
import type { PersistedTeammate } from "./team-types.js";

/**
 * Resolve the agent dir using the canonical getAgentDir() from config.ts.
 * Previously used NANOPENCIL_AGENT_DIR env directly (wrong name — should be
 * NANOPENCIL_CODING_AGENT_DIR). Now reuses the single source of truth.
 */

export class TeamStateStore {
  private readonly dir: string;

  constructor(storageDir?: string) {
    this.dir = storageDir ?? join(getAgentDir(), "teams");
  }

  /** Absolute storage directory for teammates. */
  get directory(): string {
    return this.dir;
  }

  private fileFor(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  /** Load all persisted teammates. Skips corrupt files. */
  async loadAll(): Promise<PersistedTeammate[]> {
    await this.ensureDir();
    let entries: string[];
    try {
      entries = await readdir(this.dir);
    } catch {
      return [];
    }
    const out: PersistedTeammate[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      try {
        const raw = await readFile(join(this.dir, entry), "utf-8");
        const parsed = JSON.parse(raw) as PersistedTeammate;
        if (parsed?.identity?.id) {
          out.push(parsed);
        }
      } catch {
        // Skip corrupt files; don't crash restore.
      }
    }
    return out;
  }

  /** Save (overwrite) one teammate record. */
  async save(state: PersistedTeammate): Promise<void> {
    await this.ensureDir();
    const body = `${JSON.stringify(state, null, 2)}\n`;
    await writeFile(this.fileFor(state.identity.id), body, "utf-8");
  }

  /** Remove a teammate's persisted file. No-op if missing. */
  async remove(id: string): Promise<void> {
    try {
      await rm(this.fileFor(id), { force: true });
    } catch {
      // ignore
    }
  }
}
