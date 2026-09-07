/**
 * [WHO]: Immutable candidate/revision persistence, optimistic atomic activation, history, and rollback
 * [FROM]: Depends on Node crypto/fs/path, local evolution paths, schema, and types
 * [TO]: Consumed by the evolution workflow and extension entry
 * [HERE]: extensions/optional/evolution/store.ts - durable evolution ledger owner
 */
import { createHash, randomUUID } from "node:crypto";
import { renameSync } from "node:fs";
import { appendFile, mkdir, open, readFile, readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { assertNoSymlinkComponents, resolveScopePaths, type ScopePaths, workspaceKeyForPath } from "./paths.js";
import { normalizedSkillName, validateProposal } from "./schema.js";
import type {
	CurrentPointer,
	EvolutionArtifact,
	EvolutionProposal,
	EvolutionScope,
	GateEvidence,
	RevisionManifest,
} from "./types.js";

export { workspaceKeyForPath };

const ARTIFACT_DIRS: Record<EvolutionArtifact["kind"], string> = {
	prompt_note: "prompt-notes",
	memory: "memories",
	skill_manifest: "skills",
	subagent_spec: "subagents",
	tool_spec: "tool-specs",
};

function safeSegment(value: string, label: string): string {
	if (!/^[A-Za-z0-9._-]{1,200}$/.test(value)) throw new Error(`${label} is unsafe for evolution storage`);
	return value;
}

function artifactFileName(id: string): string {
	return `${id.replace(/[^A-Za-z0-9._-]/g, "_")}.json`;
}

export function skillDirectoryName(id: string): string {
	return normalizedSkillName(id);
}

function skillMarkdown(artifact: EvolutionArtifact): string {
	const name = skillDirectoryName(artifact.id);
	return `---\nname: ${name}\ndescription: ${JSON.stringify(artifact.title)}\n---\n\n# ${artifact.title}\n\n${artifact.content}\n`;
}

function json(value: unknown): string {
	return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function writeExclusive(path: string, value: unknown): Promise<void> {
	try {
		const handle = await open(path, "wx", 0o600);
		try {
			await handle.writeFile(json(value), "utf8");
		} finally {
			await handle.close();
		}
	} catch (error: unknown) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`Evolution file already exists: ${path}`);
		throw error;
	}
}

async function readJson<T>(path: string): Promise<T> {
	const metadata = await stat(path);
	if (!metadata.isFile() || metadata.size > 1_000_000) throw new Error(`Evolution JSON is invalid or oversized: ${path}`);
	return JSON.parse(await readFile(path, "utf8")) as T;
}

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch (error: unknown) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}

export interface EvolutionStoreOptions {
	agentDir: string;
	cwd: string;
	sessionId: string;
}

export interface ActivationResult {
	revisionId: string;
	previousRevisionId: string | null;
}

export class EvolutionStore {
	private readonly paths = new Map<EvolutionScope, ScopePaths>();

	constructor(private readonly options: EvolutionStoreOptions) {}

	async scopePaths(scope: EvolutionScope): Promise<ScopePaths> {
		const cached = this.paths.get(scope);
		if (cached) return cached;
		const resolved = await resolveScopePaths(this.options.agentDir, this.options.cwd, this.options.sessionId, scope);
		this.paths.set(scope, resolved);
		return resolved;
	}

	async inventory(scope: EvolutionScope): Promise<{ pendingCandidates: number; revisions: number; quarantined: number }> {
		const paths = await this.scopePaths(scope);
		const countDirectories = async (path: string): Promise<number> => {
			await this.assertSafe(path);
			try {
				return (await readdir(path, { withFileTypes: true })).filter((entry) => entry.isDirectory()).length;
			} catch (error: unknown) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
				throw error;
			}
		};
		const [candidates, revisions, quarantined] = await Promise.all([
			countDirectories(paths.candidatesDir),
			countDirectories(paths.revisionsDir),
			countDirectories(paths.quarantineDir),
		]);
		return { pendingCandidates: Math.max(0, candidates - revisions), revisions, quarantined };
	}

	private async ensureScope(scope: EvolutionScope): Promise<ScopePaths> {
		const paths = await this.scopePaths(scope);
		await assertNoSymlinkComponents(this.options.agentDir, paths.root);
		await mkdir(paths.root, { recursive: true, mode: 0o700 });
		return paths;
	}

	private async assertSafe(target: string): Promise<void> {
		await assertNoSymlinkComponents(this.options.agentDir, target);
	}

	async createCandidate(scope: EvolutionScope, proposal: EvolutionProposal): Promise<string> {
		if (proposal.scope !== scope) throw new Error("Candidate scope does not match proposal scope");
		const validation = validateProposal(proposal);
		if (!validation.ok) throw new Error(`Candidate validation failed: ${validation.issues.join("; ")}`);
		const paths = await this.ensureScope(scope);
		await this.assertSafe(paths.candidatesDir);
		await mkdir(paths.candidatesDir, { recursive: true, mode: 0o700 });
		const candidateDir = join(paths.candidatesDir, safeSegment(proposal.id, "Candidate id"));
		await this.assertSafe(candidateDir);
		try {
			await mkdir(candidateDir, { mode: 0o700 });
		} catch (error: unknown) {
			if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`Candidate already exists: ${proposal.id}`);
			throw error;
		}
		for (const artifact of proposal.artifacts) {
			const kindDir = join(candidateDir, "artifacts", ARTIFACT_DIRS[artifact.kind]);
			await mkdir(kindDir, { recursive: true, mode: 0o700 });
			await writeExclusive(join(kindDir, artifactFileName(artifact.id)), artifact);
		}
		await writeExclusive(join(candidateDir, "proposal.json"), proposal);
		return candidateDir;
	}

	async writeEvidence(scope: EvolutionScope, candidateId: string, evidence: GateEvidence): Promise<void> {
		const paths = await this.scopePaths(scope);
		const candidateDir = join(paths.candidatesDir, safeSegment(candidateId, "Candidate id"));
		await this.assertSafe(candidateDir);
		if (!(await exists(join(candidateDir, "proposal.json")))) throw new Error(`Candidate not found: ${candidateId}`);
		const evidenceDir = join(candidateDir, "evidence");
		await this.assertSafe(evidenceDir);
		await mkdir(evidenceDir, { recursive: true, mode: 0o700 });
		await writeExclusive(join(evidenceDir, `${evidence.gate}-validation.json`), evidence);
	}

	async readProposal(scope: EvolutionScope, candidateId: string): Promise<EvolutionProposal> {
		const paths = await this.scopePaths(scope);
		const path = join(paths.candidatesDir, safeSegment(candidateId, "Candidate id"), "proposal.json");
		await this.assertSafe(path);
		return readJson<EvolutionProposal>(path);
	}

	async getCurrent(scope: EvolutionScope): Promise<CurrentPointer | undefined> {
		const paths = await this.scopePaths(scope);
		if (!(await exists(paths.currentPath))) return (await this.recoverCurrentFromHistory(paths)) ?? undefined;
		try {
			await this.assertSafe(paths.currentPath);
			const pointer = await readJson<CurrentPointer>(paths.currentPath);
			if (pointer.schemaVersion !== 1 || !safeSegment(pointer.revisionId, "Revision id")) throw new Error("Active evolution pointer is invalid");
			await this.readRevisionManifest(paths, pointer.revisionId);
			return pointer;
		} catch (error: unknown) {
			const recovered = await this.recoverCurrentFromHistory(paths);
			if (recovered !== undefined) return recovered ?? undefined;
			throw error;
		}
	}

	private async readRevisionManifest(paths: ScopePaths, revisionId: string): Promise<RevisionManifest> {
		const safeRevisionId = safeSegment(revisionId, "Revision id");
		const revisionDir = join(paths.revisionsDir, safeRevisionId);
		const manifestPath = join(revisionDir, "manifest.json");
		await this.assertSafe(manifestPath);
		const manifest = await readJson<RevisionManifest>(manifestPath);
		if (
			manifest.schemaVersion !== 1
			|| manifest.revisionId !== safeRevisionId
			|| !Array.isArray(manifest.artifacts)
			|| manifest.contentHash !== `sha256:${sha256(manifest.artifacts)}`
		) {
			throw new Error("Evolution revision failed manifest integrity validation");
		}
		for (const artifact of manifest.artifacts) {
			const artifactPath = join(revisionDir, "artifacts", ARTIFACT_DIRS[artifact.kind], artifactFileName(artifact.id));
			await this.assertSafe(artifactPath);
			const stored = await readJson<EvolutionArtifact>(artifactPath);
			if (sha256(stored) !== sha256(artifact)) throw new Error("Evolution artifact failed integrity validation");
			if (artifact.kind !== "skill_manifest") continue;
			const markdownPath = join(revisionDir, "artifacts", "skills", skillDirectoryName(artifact.id), "SKILL.md");
			await this.assertSafe(markdownPath);
			const metadata = await stat(markdownPath);
			if (!metadata.isFile() || metadata.size > 1_000_000 || await readFile(markdownPath, "utf8") !== skillMarkdown(artifact)) {
				throw new Error("Evolution skill materialization failed integrity validation");
			}
		}
		return manifest;
	}

	private async recoverCurrentFromHistory(paths: ScopePaths): Promise<CurrentPointer | null | undefined> {
		await this.assertSafe(paths.historyPath);
		if (!(await exists(paths.historyPath))) return undefined;
		const metadata = await stat(paths.historyPath);
		if (!metadata.isFile() || metadata.size > 4 * 1_024 * 1_024) return undefined;
		const lines = (await readFile(paths.historyPath, "utf8")).trim().split("\n").reverse();
		for (const line of lines) {
			try {
				const event = JSON.parse(line) as Record<string, unknown>;
				if (event.event === "reload_failed_rollback" && event.restoredRevisionId === null) return null;
				const revisionId = event.event === "reload_failed_rollback" ? event.restoredRevisionId : event.revisionId;
				if (typeof revisionId !== "string") continue;
				const manifest = await this.readRevisionManifest(paths, revisionId);
				return {
					schemaVersion: 1,
					revisionId,
					previousRevisionId: manifest.previousRevisionId,
					updatedAt: typeof event.createdAt === "string" ? event.createdAt : manifest.createdAt,
				};
			} catch {
				// Continue toward the newest older revision that still verifies completely.
			}
		}
		return undefined;
	}

	private async writePointer(paths: ScopePaths, pointer: CurrentPointer, beforeSwap?: () => void): Promise<void> {
		await this.assertSafe(paths.currentPath);
		const tempPath = join(paths.root, `.current.${process.pid}.${randomUUID()}.tmp`);
		await writeExclusive(tempPath, pointer);
		try {
			beforeSwap?.();
			renameSync(tempPath, paths.currentPath);
		} catch (error: unknown) {
			await unlink(tempPath).catch(() => undefined);
			throw error;
		}
	}

	private async appendHistory(paths: ScopePaths, event: Record<string, unknown>): Promise<void> {
		await this.assertSafe(paths.historyPath);
		await appendFile(paths.historyPath, `${JSON.stringify({ schemaVersion: 1, ...event })}\n`, { encoding: "utf8", mode: 0o600 });
	}

	private async withActivationLock<T>(scope: EvolutionScope, action: (paths: ScopePaths) => Promise<T>): Promise<T> {
		const paths = await this.ensureScope(scope);
		await this.assertSafe(paths.lockPath);
		let handle;
		try {
			handle = await open(paths.lockPath, "wx", 0o600);
		} catch (error: unknown) {
			if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("Evolution activation is already in progress");
			throw error;
		}
		try {
			await handle.writeFile(`${process.pid}\n`, "utf8");
			return await action(paths);
		} finally {
			await handle.close();
			await unlink(paths.lockPath).catch(() => undefined);
		}
	}

	private async restorePointer(paths: ScopePaths, previous: CurrentPointer | undefined): Promise<void> {
		if (previous) await this.writePointer(paths, previous);
		else await unlink(paths.currentPath).catch((error: unknown) => {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		});
	}

	async promote(
		_scope: EvolutionScope,
		_candidateId: string,
		_options: { beforeActivate?: () => void } = {},
	): Promise<ActivationResult> {
		throw new Error("Legacy EvolutionStore promotion is disabled; use the evidence-gated evolution store");
	}

	async rollback(scope: EvolutionScope, revisionId: string): Promise<ActivationResult> {
		return this.withActivationLock(scope, async (paths) => {
			const target = safeSegment(revisionId, "Revision id");
			await this.readRevisionManifest(paths, target);
			const current = await this.getCurrent(scope);
			if (current?.revisionId === target) return { revisionId: target, previousRevisionId: current.previousRevisionId };
			await this.writePointer(paths, {
				schemaVersion: 1,
				revisionId: target,
				previousRevisionId: current?.revisionId ?? null,
				updatedAt: new Date().toISOString(),
			});
			try {
				await this.appendHistory(paths, { event: "rolled_back", revisionId: target, previousRevisionId: current?.revisionId ?? null, createdAt: new Date().toISOString() });
			} catch (error: unknown) {
				await this.restorePointer(paths, current);
				throw error;
			}
			return { revisionId: target, previousRevisionId: current?.revisionId ?? null };
		});
	}

	async restoreActivation(scope: EvolutionScope, expectedRevisionId: string, previousRevisionId: string | null): Promise<void> {
		await this.withActivationLock(scope, async (paths) => {
			const current = await this.getCurrent(scope);
			if (current?.revisionId !== expectedRevisionId) throw new Error("Cannot restore evolution activation because the pointer changed");
			const previous = previousRevisionId === null
				? undefined
				: {
					schemaVersion: 1 as const,
					revisionId: previousRevisionId,
					previousRevisionId: null,
					updatedAt: new Date().toISOString(),
				};
			await this.appendHistory(paths, { event: "reload_failed_rollback", revisionId: expectedRevisionId, restoredRevisionId: previousRevisionId, createdAt: new Date().toISOString() });
			await this.restorePointer(paths, previous);
		});
	}

	async readActiveManifest(scope: EvolutionScope): Promise<RevisionManifest | undefined> {
		const current = await this.getCurrent(scope);
		if (!current) return undefined;
		const paths = await this.scopePaths(scope);
		return this.readRevisionManifest(paths, current.revisionId);
	}

	async activeSkillPaths(scope: EvolutionScope): Promise<Array<{ name: string; path: string; artifact: EvolutionArtifact }>> {
		const manifest = await this.readActiveManifest(scope);
		if (!manifest) return [];
		const paths = await this.scopePaths(scope);
		const skills = manifest.artifacts
			.filter((artifact) => artifact.kind === "skill_manifest")
			.map((artifact) => {
				const name = skillDirectoryName(artifact.id);
				return { name, path: join(paths.revisionsDir, manifest.revisionId, "artifacts", "skills", name), artifact };
			});
		for (const skill of skills) await this.assertSafe(join(skill.path, "SKILL.md"));
		return skills;
	}
}
