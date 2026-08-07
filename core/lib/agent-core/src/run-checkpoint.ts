/**
 * [WHO]: Versioned agent run checkpoints and the atomic checkpoint store port
 * [FROM]: No external dependencies
 * [TO]: Consumed by policy-driven approval pause/resume adapters
 * [HERE]: core/lib/agent-core/src/run-checkpoint.ts - serializable at-most-once checkpoint primitives
 */

export interface AgentRunCheckpoint {
	version: 1;
	id: string;
	createdAt: number;
	expiresAt?: number;
	policyId: string;
	toolCall: {
		id: string;
		name: string;
		input: unknown;
	};
	metadata?: Record<string, unknown>;
}

export interface CheckpointStore {
	save(checkpoint: AgentRunCheckpoint): Promise<void>;
	consume(id: string, now?: number): Promise<AgentRunCheckpoint | undefined>;
	delete(id: string): Promise<boolean>;
}

export type CheckpointResolution =
	| { status: "unavailable" }
	| { status: "denied"; checkpoint: AgentRunCheckpoint }
	| { status: "approved"; checkpoint: AgentRunCheckpoint; toolCall: AgentRunCheckpoint["toolCall"] };

/** Atomically consumes a checkpoint and turns the human decision into resume data. */
export async function resolveRunCheckpoint(
	store: CheckpointStore,
	id: string,
	decision: "approve" | "deny",
	now = Date.now(),
): Promise<CheckpointResolution> {
	const checkpoint = await store.consume(id, now);
	if (!checkpoint) return { status: "unavailable" };
	if (decision === "deny") return { status: "denied", checkpoint };
	return { status: "approved", checkpoint, toolCall: checkpoint.toolCall };
}

export class InMemoryCheckpointStore implements CheckpointStore {
	readonly #checkpoints = new Map<string, AgentRunCheckpoint>();

	async save(checkpoint: AgentRunCheckpoint): Promise<void> {
		if (checkpoint.version !== 1) throw new Error(`Unsupported checkpoint version: ${String(checkpoint.version)}`);
		this.#checkpoints.set(checkpoint.id, structuredClone(checkpoint));
	}

	async consume(id: string, now = Date.now()): Promise<AgentRunCheckpoint | undefined> {
		const checkpoint = this.#checkpoints.get(id);
		if (!checkpoint) return undefined;
		this.#checkpoints.delete(id);
		if (checkpoint.expiresAt !== undefined && checkpoint.expiresAt <= now) return undefined;
		return structuredClone(checkpoint);
	}

	async delete(id: string): Promise<boolean> {
		return this.#checkpoints.delete(id);
	}
}
