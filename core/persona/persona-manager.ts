/**
 * [WHO]: PersonaManager class, persona state, bundled preset discovery, selection validation, and path management
 * [FROM]: Depends on node:fs, node:path, agent-dir-context
 * [TO]: Consumed by core/platform/config/resource-loader.ts
 * [HERE]: core/persona/persona-manager.ts - persona management layer
 */
import { existsSync, readdirSync, readFileSync, mkdirSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultAgentDirContext, type AgentDirContext } from "../agent-dir/agent-dir-context.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUNDLED_PERSONAS_DIR_CANDIDATES = [
	// Direct source execution: <root>/core/persona -> <root>/assets/personas
	resolve(__dirname, "../../assets/personas"),
	// Compiled execution: <root>/dist/core/persona -> <root>/assets/personas
	resolve(__dirname, "../../../assets/personas"),
];

function resolveBundledPersonasDir(): string | undefined {
	return BUNDLED_PERSONAS_DIR_CANDIDATES.find((candidate) => {
		try {
			return existsSync(candidate) && statSync(candidate).isDirectory();
		} catch {
			return false;
		}
	});
}

type PersonaState = {
	activePersonaId?: string;
};

// Backward-compatible renames: old id → new id
const PERSONA_RENAMES: Record<string, string> = {
	default: "catui",
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

	private isSelectablePersona(personaId: string): boolean {
		const personaDir = this.getPersonaDir(personaId);
		try {
			return statSync(personaDir).isDirectory() && statSync(join(personaDir, "CATUI.md")).isFile();
		} catch {
			return false;
		}
	}

	private copyDirectoryIfMissing(srcDir: string, destDir: string): void {
		for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
			if (entry.name.startsWith(".")) {
				continue;
			}

			const srcPath = join(srcDir, entry.name);
			const destPath = join(destDir, entry.name);

			if (entry.isDirectory()) {
				if (!existsSync(destPath)) {
					mkdirSync(destPath, { recursive: true });
				}
				const srcStat = statSync(srcPath);
				if (!srcStat.isDirectory()) {
					continue;
				}
				this.copyDirectoryIfMissing(srcPath, destPath);
				continue;
			}

			if (entry.isFile() && !existsSync(destPath)) {
				copyFileSync(srcPath, destPath);
			}
		}
	}

	private ensurePersonasDir(): void {
		if (!existsSync(this.personasDir)) mkdirSync(this.personasDir, { recursive: true });

		// Migrate legacy PENCIL.md → CATUI.md for existing personas
		try {
			for (const entry of readdirSync(this.personasDir)) {
				const personaDir = join(this.personasDir, entry);
				if (!statSync(personaDir).isDirectory()) continue;
				const oldPath = join(personaDir, "PENCIL.md");
				const newPath = join(personaDir, "CATUI.md");
				if (existsSync(oldPath) && !existsSync(newPath)) {
					copyFileSync(oldPath, newPath);
				}
			}
		} catch { /* best-effort migration */ }

		// Copy bundled presets if they don't exist on disk.
		// Missing files are copied, but existing files are preserved to avoid
		// overwriting local persona customization.
		const bundledPersonasDir = resolveBundledPersonasDir();
		if (bundledPersonasDir) {
			try {
				for (const entry of readdirSync(bundledPersonasDir)) {
					const srcDir = join(bundledPersonasDir, entry);
					if (!statSync(srcDir).isDirectory()) continue;
					const destDir = join(this.personasDir, entry);
					if (!existsSync(destDir)) {
						mkdirSync(destDir, { recursive: true });
					}
					this.copyDirectoryIfMissing(srcDir, destDir);
				}
			} catch { /* best-effort copy */ }
		}
	}

	getPersonasDir(): string {
		return this.personasDir;
	}

	getActivePersonaId(): string | undefined {
		try {
			this.ensurePersonasDir();
			if (!existsSync(this.activePersonaStatePath)) return "vex";
			const raw = readFileSync(this.activePersonaStatePath, "utf-8");
			const parsed = JSON.parse(raw) as PersonaState;
			if (!parsed?.activePersonaId) return "vex";
			let id = normalizePersonaId(String(parsed.activePersonaId));
			// Migrate renamed personas and persist the update
			if (PERSONA_RENAMES[id]) {
				const renamedId = PERSONA_RENAMES[id];
				if (this.isSelectablePersona(renamedId)) {
					id = renamedId;
					this.setActivePersonaId(id);
				} else {
					return "vex";
				}
			}
			return this.isSelectablePersona(id) ? id : "vex";
		} catch {
			return "vex";
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
		if (normalized !== personaId.trim() || !this.isSelectablePersona(normalized)) {
			throw new Error(`Persona not found or missing CATUI.md: ${personaId}`);
		}
		const state: PersonaState = { activePersonaId: normalized };
		writeFileSync(this.activePersonaStatePath, JSON.stringify(state, null, 2), "utf-8");
	}

	listPersonas(): string[] {
		try {
			this.ensurePersonasDir();
			return readdirSync(this.personasDir)
				.filter((entry) => normalizePersonaId(entry) === entry && this.isSelectablePersona(entry))
				.sort((a, b) => a.localeCompare(b));
		} catch {
			return [];
		}
	}

	getPersonaDir(personaId: string): string {
		const normalized = normalizePersonaId(personaId);
		return join(this.personasDir, normalized);
	}

	getPersonaCatuiPath(personaId: string): string {
		return join(this.getPersonaDir(personaId), "CATUI.md");
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

	getPersonaDescription(personaId: string): string {
		try {
			const catuiPath = this.getPersonaCatuiPath(personaId);
			if (!existsSync(catuiPath)) return "";
			const raw = readFileSync(catuiPath, "utf-8");
			for (const line of raw.split("\n")) {
				const trimmed = line.trim();
				if (!trimmed || trimmed.startsWith("#")) continue;
				return trimmed.length > 60 ? trimmed.slice(0, 57) + "..." : trimmed;
			}
			return "";
		} catch {
			return "";
		}
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

export function getPersonaCatuiPath(personaId: string): string {
	return defaultManager.getPersonaCatuiPath(personaId);
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

export function getPersonaDescription(personaId: string): string {
	return defaultManager.getPersonaDescription(personaId);
}

/**
 * For later environment variable override: resolve path to absolute to avoid relative path issues during reload.
 */
export function toAbsolutePath(p: string): string {
	const trimmed = p.trim();
	if (!trimmed) return trimmed;
	return resolve(trimmed);
}
