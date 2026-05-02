/**
 * [WHO]: TeamTaskStore class - durable shared task list for AgentTeam coordination
 * [FROM]: Depends on node:fs/promises, node:path, ./team-types
 * [TO]: Consumed by team-runtime.ts and index.ts
 * [HERE]: extensions/defaults/team/team-task-store.ts - one tasks.json file under the team storage directory
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { TeamTask, TeamTaskStatus } from "./team-types.js";

export interface CreateTeamTaskInput {
	title: string;
	description?: string;
	dependsOn?: string[];
	artifactPaths?: string[];
}

export interface UpdateTeamTaskInput {
	status?: TeamTaskStatus;
	ownerId?: string;
	ownerName?: string;
	description?: string;
	artifactPaths?: string[];
}

export class TeamTaskStore {
	private readonly filePath: string;
	private tasks: TeamTask[] = [];
	private loaded = false;

	constructor(storageDir: string) {
		this.filePath = join(storageDir, "tasks.json");
	}

	async load(): Promise<void> {
		if (this.loaded) return;
		try {
			const raw = await readFile(this.filePath, "utf-8");
			const parsed = JSON.parse(raw) as TeamTask[];
			this.tasks = Array.isArray(parsed) ? parsed.filter((task) => task?.id && task?.title) : [];
		} catch {
			this.tasks = [];
		}
		this.loaded = true;
	}

	async create(input: CreateTeamTaskInput): Promise<TeamTask> {
		await this.load();
		const now = Date.now();
		const task: TeamTask = {
			id: this.nextId(),
			title: input.title.trim(),
			description: input.description?.trim() || undefined,
			status: "open",
			dependsOn: input.dependsOn ?? [],
			artifactPaths: input.artifactPaths ?? [],
			createdAt: now,
			updatedAt: now,
		};
		this.tasks.push(task);
		await this.save();
		return task;
	}

	async claim(taskId: string, ownerId: string, ownerName: string): Promise<TeamTask | undefined> {
		return this.update(taskId, { status: "claimed", ownerId, ownerName });
	}

	async update(taskId: string, input: UpdateTeamTaskInput): Promise<TeamTask | undefined> {
		await this.load();
		const task = this.find(taskId);
		if (!task) return undefined;
		if (input.status) {
			task.status = input.status;
			task.completedAt = input.status === "done" ? Date.now() : undefined;
		}
		if (input.ownerId !== undefined) task.ownerId = input.ownerId || undefined;
		if (input.ownerName !== undefined) task.ownerName = input.ownerName || undefined;
		if (input.description !== undefined) task.description = input.description.trim() || undefined;
		if (input.artifactPaths !== undefined) task.artifactPaths = input.artifactPaths;
		task.updatedAt = Date.now();
		await this.save();
		return task;
	}

	async list(): Promise<TeamTask[]> {
		await this.load();
		return [...this.tasks].sort((a, b) => a.createdAt - b.createdAt);
	}

	async get(taskId: string): Promise<TeamTask | undefined> {
		await this.load();
		return this.find(taskId);
	}

	private find(taskId: string): TeamTask | undefined {
		return this.tasks.find((task) => task.id === taskId);
	}

	private nextId(): string {
		const existing = new Set(this.tasks.map((task) => task.id));
		for (let index = this.tasks.length + 1; ; index++) {
			const id = `T-${index}`;
			if (!existing.has(id)) return id;
		}
	}

	private async save(): Promise<void> {
		await mkdir(dirname(this.filePath), { recursive: true });
		await writeFile(this.filePath, `${JSON.stringify(this.tasks, null, 2)}\n`, "utf-8");
	}
}
