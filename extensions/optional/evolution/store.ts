/**
 * [WHO]: Immutable candidate/revision persistence, optimistic atomic activation, history, and rollback
 * [FROM]: Depends on Node crypto/fs/path, local evolution paths, schema, and types
 * [TO]: Consumed by the evolution workflow and extension entry
 * [HERE]: extensions/optional/evolution/store.ts - durable evolution ledger owner
 */
import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
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

	private async ensureScope(scope: EvolutionScope): Promise<ScopePaths> {
		const paths = await this.scopePaths(scope);
		await assertNoSymlinkComponents(this.options.agentDir, paths.root);
		await mkdir(paths.root, { recursive: true, mode: 0o700 });
		return paths;
	}

	async createCandidate(scope: EvolutionScope, proposal: EvolutionProposal): Promise<string> {
		if (proposal.scope !== scope) throw new Error("Candidate scope does not match proposal scope");
		const validation = validateProposal(proposal);
		if (!validation.ok) throw new Error(`Candidate validation failed: ${validation.issues.join("; ")}`);
		const paths = await this.ensureScope(scope);
		await mkdir(paths.candidatesDir, { recursive: true, mode: 0o700 });
		const candidateDir = join(paths.candidatesDir, safeSegment(proposal.id, "Candidate id"));
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
		if (!(await exists(join(candidateDir, "proposal.json")))) throw new Error(`Candidate not found: ${candidateId}`);
		const evidenceDir = join(candidateDir, "evidence");
		await mkdir(evidenceDir, { recursive: true, mode: 0o700 });
		await writeExclusive(join(evidenceDir, `${evidence.gate}-validation.json`), evidence);
	}

	async readProposal(scope: EvolutionScope, candidateId: string): Promise<EvolutionProposal> {
		const paths = await this.scopePaths(scope);
		return readJson<EvolutionProposal>(join(paths.candidatesDir, safeSegment(candidateId, "Candidate id"), "proposal.json"));
	}

	private async readEvidence(scope: EvolutionScope, candidateId: string, gate: GateEvidence["gate"]): Promise<GateEvidence | undefined> {
		const paths = await this.scopePaths(scope);
		const path = join(paths.candidatesDir, safeSegment(candidateId, "Candidate id"), "evidence", `${gate}-validation.json`);
		return (await exists(path)) ? readJson<GateEvidence>(path) : undefined;
	}

	private async assertPromotionEvidence(scope: EvolutionScope, candidateId: string): Promise<void> {
		const [staticGate, replayGate, evalGate, reviewerGate] = await Promise.all([
			this.readEvidence(scope, candidateId, "static"),
			this.readEvidence(scope, candidateId, "replay"),
			this.readEvidence(scope, candidateId, "eval"),
			this.readEvidence(scope, candidateId, "reviewer"),
		]);
		if (staticGate?.passed !== true) throw new Error("Promotion evidence is missing a passing static gate");
		if (
			replayGate?.passed !== true
			|| replayGate.details.lifecyclePreserved !== true
			|| replayGate.details.toolPairsPreserved !== true
			|| replayGate.details.policyPreserved !== true
		) {
			throw new Error("Promotion evidence is missing a passing replay safety gate");
		}
		const scenarios = evalGate?.details.matchedScenarios;
		const evalPassed = evalGate?.passed === true
			&& Array.isArray(scenarios)
			&& scenarios.length > 0
			&& evalGate.details.nonInferior === true
			&& evalGate.details.improvement === true;
		const manualOverride = reviewerGate?.passed === true
			&& reviewerGate.details.actor === "human"
			&& reviewerGate.details.overrideMissingEffectiveness === true;
		if (!evalPassed && !manualOverride) throw new Error("Promotion evidence is missing candidate-specific effectiveness proof or an explicit human override");
		if (scope === "global" && reviewerGate?.passed !== true) throw new Error("Global promotion evidence requires explicit human approval");
	}

	async getCurrent(scope: EvolutionScope): Promise<CurrentPointer | undefined> {
		const paths = await this.scopePaths(scope);
		if (!(await exists(paths.currentPath))) return undefined;
		const pointer = await readJson<CurrentPointer>(paths.currentPath);
		if (pointer.schemaVersion !== 1 || !safeSegment(pointer.revisionId, "Revision id")) throw new Error("Active evolution pointer is invalid");
		return pointer;
	}

	private async writePointer(paths: ScopePaths, pointer: CurrentPointer): Promise<void> {
		const tempPath = join(paths.root, `.current.${process.pid}.${randomUUID()}.tmp`);
		await writeExclusive(tempPath, pointer);
		await rename(tempPath, paths.currentPath);
	}

	private async appendHistory(paths: ScopePaths, event: Record<string, unknown>): Promise<void> {
		await appendFile(paths.historyPath, `${JSON.stringify({ schemaVersion: 1, ...event })}\n`, { encoding: "utf8", mode: 0o600 });
	}

	private async withActivationLock<T>(scope: EvolutionScope, action: (paths: ScopePaths) => Promise<T>): Promise<T> {
		const paths = await this.ensureScope(scope);
		let handle;
		try {
			handle = await open(paths.lockPath, "wx", 0o600);
		} catch (error: unknown) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			const owner = Number.parseInt((await readFile(paths.lockPath, "utf8")).trim(), 10);
			let stale = !Number.isInteger(owner) || owner <= 0;
			if (!stale) {
				try { process.kill(owner, 0); } catch (probeError: unknown) { stale = (probeError as NodeJS.ErrnoException).code === "ESRCH"; }
			}
			if (!stale) throw new Error("Evolution activation is already in progress");
			await unlink(paths.lockPath);
			handle = await open(paths.lockPath, "wx", 0o600);
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

	async promote(scope: EvolutionScope, candidateId: string): Promise<ActivationResult> {
		return this.withActivationLock(scope, async (paths) => {
			const proposal = await this.readProposal(scope, candidateId);
			const validation = validateProposal(proposal);
			if (!validation.ok) throw new Error(`Candidate validation failed: ${validation.issues.join("; ")}`);
			await this.assertPromotionEvidence(scope, candidateId);
			const current = await this.getCurrent(scope);
			if ((current?.revisionId ?? null) !== proposal.baselineRevisionId) throw new Error("Candidate baseline revision is stale");
			const digest = sha256({ candidateId: proposal.id, artifacts: proposal.artifacts });
			const revisionId = `rev_${digest.slice(0, 32)}`;
			const revisionDir = join(paths.revisionsDir, revisionId);
			await mkdir(paths.revisionsDir, { recursive: true, mode: 0o700 });
			try {
				await mkdir(revisionDir, { mode: 0o700 });
			} catch (error: unknown) {
				if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`Revision already exists: ${revisionId}`);
				throw error;
			}
			for (const artifact of proposal.artifacts) {
				const kindDir = join(revisionDir, "artifacts", ARTIFACT_DIRS[artifact.kind]);
				await mkdir(kindDir, { recursive: true, mode: 0o700 });
				await writeExclusive(join(kindDir, artifactFileName(artifact.id)), artifact);
				if (artifact.kind === "skill_manifest") {
					const skillDir = join(kindDir, skillDirectoryName(artifact.id));
					await mkdir(skillDir, { mode: 0o700 });
					const handle = await open(join(skillDir, "SKILL.md"), "wx", 0o600);
					try {
						await handle.writeFile(skillMarkdown(artifact), "utf8");
					} finally {
						await handle.close();
					}
				}
			}
			const manifest: RevisionManifest = {
				schemaVersion: 1,
				revisionId,
				candidateId: proposal.id,
				scope,
				createdAt: new Date().toISOString(),
				previousRevisionId: current?.revisionId ?? null,
				contentHash: `sha256:${sha256(proposal.artifacts)}`,
				artifacts: proposal.artifacts,
			};
			await writeExclusive(join(revisionDir, "manifest.json"), manifest);
			await this.writePointer(paths, {
				schemaVersion: 1,
				revisionId,
				previousRevisionId: current?.revisionId ?? null,
				updatedAt: new Date().toISOString(),
			});
			try {
				await this.appendHistory(paths, { event: "promoted", candidateId, revisionId, previousRevisionId: current?.revisionId ?? null, createdAt: new Date().toISOString() });
			} catch (error: unknown) {
				await this.restorePointer(paths, current);
				throw error;
			}
			return { revisionId, previousRevisionId: current?.revisionId ?? null };
		});
	}

	async rollback(scope: EvolutionScope, revisionId: string): Promise<ActivationResult> {
		return this.withActivationLock(scope, async (paths) => {
			const target = safeSegment(revisionId, "Revision id");
			await readJson<RevisionManifest>(join(paths.revisionsDir, target, "manifest.json"));
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
		const manifest = await readJson<RevisionManifest>(join(paths.revisionsDir, current.revisionId, "manifest.json"));
		if (manifest.revisionId !== current.revisionId || manifest.contentHash !== `sha256:${sha256(manifest.artifacts)}`) {
			throw new Error("Active evolution revision failed integrity validation");
		}
		return manifest;
	}

	async activeSkillPaths(scope: EvolutionScope): Promise<Array<{ name: string; path: string; artifact: EvolutionArtifact }>> {
		const manifest = await this.readActiveManifest(scope);
		if (!manifest) return [];
		const paths = await this.scopePaths(scope);
		return manifest.artifacts
			.filter((artifact) => artifact.kind === "skill_manifest")
			.map((artifact) => {
				const name = skillDirectoryName(artifact.id);
				return { name, path: join(paths.revisionsDir, manifest.revisionId, "artifacts", "skills", name), artifact };
			});
	}
}
