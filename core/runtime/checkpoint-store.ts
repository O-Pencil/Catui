/**
 * [WHO]: FileCheckpointStore
 * [FROM]: Depends on node:fs/promises, node:path, node:crypto, @catui/agent-core checkpoint contract
 * [TO]: Consumed by SDK callers that opt into cross-process approval checkpoints
 * [HERE]: core/runtime/checkpoint-store.ts - path-confined atomic JSON checkpoint persistence
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentRunCheckpoint, CheckpointStore } from "@catui/agent-core";

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

function assertSafeId(id: string): void {
	if (!SAFE_ID.test(id)) throw new Error("Invalid checkpoint id");
}

function isCheckpoint(value: unknown): value is AgentRunCheckpoint {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	const toolCall = record.toolCall;
	return record.version === 1
		&& typeof record.id === "string"
		&& typeof record.createdAt === "number"
		&& typeof record.policyId === "string"
		&& !!toolCall
		&& typeof toolCall === "object"
		&& typeof (toolCall as Record<string, unknown>).id === "string"
		&& typeof (toolCall as Record<string, unknown>).name === "string";
}

export class FileCheckpointStore implements CheckpointStore {
	constructor(private readonly directory: string) {}

	async save(checkpoint: AgentRunCheckpoint): Promise<void> {
		assertSafeId(checkpoint.id);
		await mkdir(this.directory, { recursive: true });
		const destination = this.pathFor(checkpoint.id);
		const temporary = join(this.directory, `.${checkpoint.id}.${randomUUID()}.tmp`);
		await writeFile(temporary, `${JSON.stringify(checkpoint)}\n`, { encoding: "utf8", mode: 0o600 });
		await rename(temporary, destination);
	}

	async consume(id: string, now = Date.now()): Promise<AgentRunCheckpoint | undefined> {
		assertSafeId(id);
		await mkdir(this.directory, { recursive: true });
		const claimed = join(this.directory, `.${id}.${randomUUID()}.consuming`);
		try {
			await rename(this.pathFor(id), claimed);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
			throw error;
		}
		try {
			const parsed: unknown = JSON.parse(await readFile(claimed, "utf8"));
			if (!isCheckpoint(parsed) || parsed.id !== id) throw new Error("Invalid checkpoint payload");
			if (parsed.expiresAt !== undefined && parsed.expiresAt <= now) return undefined;
			return parsed;
		} finally {
			await unlink(claimed).catch(() => undefined);
		}
	}

	async delete(id: string): Promise<boolean> {
		assertSafeId(id);
		try {
			await unlink(this.pathFor(id));
			return true;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
			throw error;
		}
	}

	private pathFor(id: string): string {
		return join(this.directory, `${id}.json`);
	}
}
