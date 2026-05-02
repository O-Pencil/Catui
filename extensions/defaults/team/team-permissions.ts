/**
 * [WHO]: PermissionStore, PermissionRequest, PermissionAction, PermissionDecision
 * [FROM]: No external deps
 * [TO]: Consumed by team-runtime.ts, index.ts
 * [HERE]: extensions/defaults/team/team-permissions.ts - Phase B B.4 permission model
 *
 * Per refactor plan §B.4: "permission must be frozen before mailbox".
 *
 * The permission model is the trust boundary between leader and teammate.
 * Any action that mutates the world or escalates a teammate's mode goes
 * through a PermissionRequest which the leader must approve via
 * `/team:approve <request-id>`.
 *
 * Pending requests carry a `resolve` callback so the runtime side can
 * `await` the leader's decision without polling.
 */

export type PermissionAction =
	| "mode_change_to_execute"
	| "write_path"
	| "bash_command";

export type PermissionStatus = "pending" | "approved" | "denied" | "expired";

export interface PermissionRequest {
	id: string;
	teammateId: string;
	teammateName: string;
	action: PermissionAction;
	detail: string;
	createdAt: number;
	status: PermissionStatus;
}

interface PendingEntry extends PermissionRequest {
	resolve: (approved: boolean) => void;
}

/**
 * In-memory permission store. Decisions never persist across process restarts:
 * if the main session dies while a request is pending, the teammate is left
 * idle and the leader must reissue the action after restart.
 */
export class PermissionStore {
	private requests: Map<string, PendingEntry> = new Map();
	private pathAllowlist: Map<string, Set<string>> = new Map();

	/**
	 * File a new permission request and return a promise that resolves
	 * with the leader's decision (true = approved, false = denied).
	 */
	request(
		teammateId: string,
		teammateName: string,
		action: PermissionAction,
		detail: string,
	): { id: string; decision: Promise<boolean> } {
		const id = crypto.randomUUID();
		const decision = new Promise<boolean>((resolve) => {
			const entry: PendingEntry = {
				id,
				teammateId,
				teammateName,
				action,
				detail,
				createdAt: Date.now(),
				status: "pending",
				resolve,
			};
			this.requests.set(id, entry);
		});
		return { id, decision };
	}

	/** Approve a pending request. Returns false if id is unknown or already resolved. */
	approve(id: string): boolean {
		const entry = this.requests.get(id);
		if (!entry || entry.status !== "pending") return false;
		entry.status = "approved";
		entry.resolve(true);
		return true;
	}

	/** Deny a pending request. */
	deny(id: string): boolean {
		const entry = this.requests.get(id);
		if (!entry || entry.status !== "pending") return false;
		entry.status = "denied";
		entry.resolve(false);
		return true;
	}

	/** All pending requests, sorted oldest first. */
	listPending(): PermissionRequest[] {
		return [...this.requests.values()]
			.filter((r) => r.status === "pending")
			.map(stripResolve)
			.sort((a, b) => a.createdAt - b.createdAt);
	}

	/** Get a request snapshot without the resolve handle. */
	get(id: string): PermissionRequest | undefined {
		const entry = this.requests.get(id);
		return entry ? stripResolve(entry) : undefined;
	}

	/**
	 * Cancel any pending requests owned by `teammateId`. Used when the
	 * teammate is terminated so the awaiting promise does not leak.
	 */
	cancelForTeammate(teammateId: string): void {
		for (const entry of this.requests.values()) {
			if (entry.teammateId === teammateId && entry.status === "pending") {
				entry.status = "expired";
				entry.resolve(false);
			}
		}
	}

	/** Grant a teammate write permission for a path prefix. */
	allowPath(teammateId: string, path: string): void {
		let set = this.pathAllowlist.get(teammateId);
		if (!set) {
			set = new Set();
			this.pathAllowlist.set(teammateId, set);
		}
		set.add(normalizeAllowedPath(path));
	}

	/** Check whether a teammate currently holds write access to `path`. */
	isPathAllowed(teammateId: string, path: string): boolean {
		const set = this.pathAllowlist.get(teammateId);
		if (!set) return false;
		const normalizedPath = normalizeAllowedPath(path);
		for (const allowed of set) {
			if (normalizedPath === allowed || normalizedPath.startsWith(`${allowed}/`)) return true;
		}
		return false;
	}

	/** Drop a teammate's allowlist entirely (called on terminate). */
	clearPaths(teammateId: string): void {
		this.pathAllowlist.delete(teammateId);
	}
}

function stripResolve(entry: PendingEntry): PermissionRequest {
	const { resolve: _resolve, ...rest } = entry;
	return rest;
}

function normalizeAllowedPath(path: string): string {
	return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}
