/**
 * [WHO]: PersonaManager class, persona state and path management
 * [FROM]: Depends on node:fs, node:path, agent-dir-context
 * [TO]: Consumed by core/config/resource-loader.ts
 * [HERE]: core/persona/persona-manager.ts - persona management layer
 */
import { existsSync, readdirSync, readFileSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { defaultAgentDirContext, type AgentDirContext } from "../agent-dir/agent-dir-context.js";

type PersonaState = {
	activePersonaId?: string;
};

function normalizePersonaId(personaId: string): string {
	// Allow alphanumeric, underscore, and hyphen; prevent path traversal
	const trimmed = personaId.trim();
	if (!trimmed) return "general";
	return trimmed.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export class PersonaManager {
	private readonly ctx: AgentDirContext;

	constructor(ctx: AgentDirContext = defaultAgentDirContext()) {
		this.ctx = ctx;
	}

	private get personasDir(): string {
		return join(this.ctx.path, "personas");
	}

	private get activePersonaStatePath(): string {
		return join(this.ctx.path, "persona.json");
	}

	private ensurePersonasDir(): void {
		if (!existsSync(this.personasDir)) mkdirSync(this.personasDir, { recursive: true });
	}

	getPersonasDir(): string {
		return this.personasDir;
	}

	getActivePersonaId(): string | undefined {
		try {
			if (!existsSync(this.activePersonaStatePath)) return undefined;
			const raw = readFileSync(this.activePersonaStatePath, "utf-8");
			const parsed = JSON.parse(raw) as PersonaState;
			if (!parsed?.activePersonaId) return undefined;
			return normalizePersonaId(String(parsed.activePersonaId));
		} catch {
			return undefined;
		}
	}

	setActivePersonaId(personaId: string | undefined): void {
		this.ensurePersonasDir();
		if (!personaId) {
			// Deleting state file means returning to general (disable persona override)
			try {
				writeFileSync(this.activePersonaStatePath, JSON.stringify({}, null, 2), "utf-8");
			} catch {
				// ignore
			}
			return;
		}

		const normalized = normalizePersonaId(personaId);
		const personaDir = this.getPersonaDir(normalized);
		if (!existsSync(personaDir)) {
			// Ensure path exists to avoid reload failures from user typos
			mkdirSync(personaDir, { recursive: true });
		}
		const state: PersonaState = { activePersonaId: normalized };
		writeFileSync(this.activePersonaStatePath, JSON.stringify(state, null, 2), "utf-8");
	}

	listPersonas(): string[] {
		try {
			this.ensurePersonasDir();
			return readdirSync(this.personasDir)
				.map((entry) => normalizePersonaId(entry))
				.filter((id) => {
					const p = this.getPersonaDir(id);
					try {
						return statSync(p).isDirectory();
					} catch {
						return false;
					}
				})
				.sort((a, b) => a.localeCompare(b));
		} catch {
			return [];
		}
	}

	getPersonaDir(personaId: string): string {
		const normalized = normalizePersonaId(personaId);
		return join(this.personasDir, normalized);
	}

	getPersonaPencilPath(personaId: string): string {
		return join(this.getPersonaDir(personaId), "PENCIL.md");
	}

	getPersonaSkillsDir(personaId: string): string {
		return join(this.getPersonaDir(personaId), "skills");
	}

	getPersonaSoulDir(personaId: string): string {
		return join(this.getPersonaDir(personaId), "soul");
	}

	getPersonaMemoryDir(personaId: string): string {
		return join(this.getPersonaDir(personaId), "memory");
	}

	getPersonaMcpConfigPath(personaId: string): string {
		return join(this.getPersonaDir(personaId), "mcp.json");
	}
}

// ---------------------------------------------------------------------------
// Default singleton for backward compatibility
// ---------------------------------------------------------------------------

const defaultManager = new PersonaManager();

/** Get path to personas directory (default agent context). */
export function getPersonasDir(): string {
	return defaultManager.getPersonasDir();
}

export function getActivePersonaId(): string | undefined {
	return defaultManager.getActivePersonaId();
}

export function setActivePersonaId(personaId: string | undefined): void {
	defaultManager.setActivePersonaId(personaId);
}

export function listPersonas(): string[] {
	return defaultManager.listPersonas();
}

export function getPersonaDir(personaId: string): string {
	return defaultManager.getPersonaDir(personaId);
}

export function getPersonaPencilPath(personaId: string): string {
	return defaultManager.getPersonaPencilPath(personaId);
}

export function getPersonaSkillsDir(personaId: string): string {
	return defaultManager.getPersonaSkillsDir(personaId);
}

export function getPersonaSoulDir(personaId: string): string {
	return defaultManager.getPersonaSoulDir(personaId);
}

export function getPersonaMemoryDir(personaId: string): string {
	return defaultManager.getPersonaMemoryDir(personaId);
}

export function getPersonaMcpConfigPath(personaId: string): string {
	return defaultManager.getPersonaMcpConfigPath(personaId);
}

/**
 * For later environment variable override: resolve path to absolute to avoid relative path issues during reload.
 */
export function toAbsolutePath(p: string): string {
	const trimmed = p.trim();
	if (!trimmed) return trimmed;
	return resolve(trimmed);
}
