/**
 * [WHO]: AgentMetadata interface, loadAgentMetadata(), saveAgentMetadata(), ensureAgentMetadata()
 * [FROM]: Depends on agent-dir-context.ts, node:fs, node:path
 * [TO]: Consumed by main.ts, future Gateway integration
 * [HERE]: core/agent-dir/agent-metadata.ts - agent.json (machine-readable metadata)
 *
 * Design doc: docs/multi-agent-fs-design.md §4.2
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { AgentDirContext } from "./agent-dir-context.js";

export interface AgentAsgardMetadata {
	templateId: string;
	templateVersion: string;
	originUrl: string;
	externalId: string;
	lastSyncedAt: string;
}

export interface AgentMetadata {
	version: string;
	/** Slug id, [a-z0-9._-]{1,64}; matches the directory name. Immutable. */
	id: string;
	/** Human-readable name; can contain Chinese/emoji. */
	displayName: string;
	/** Human-readable description. */
	description?: string;
	createdAt: string;
	updatedAt: string;
	origin: {
		type: "local" | "cloud-adopted" | "imported";
		asgard?: AgentAsgardMetadata;
	};
	tags: string[];
	engine: string;
	extensions: Record<string, any>;
}

export const CURRENT_METADATA_VERSION = "1.0.0";

/**
 * Load agent.json from the agent directory.
 * Returns undefined if the file does not exist or is invalid.
 */
export function loadAgentMetadata(agentDir: string): AgentMetadata | undefined {
	const path = join(agentDir, "agent.json");
	if (!existsSync(path)) return undefined;

	try {
		const raw = readFileSync(path, "utf-8");
		return JSON.parse(raw) as AgentMetadata;
	} catch {
		return undefined;
	}
}

/**
 * Save agent.json to the agent directory.
 */
export function saveAgentMetadata(agentDir: string, metadata: AgentMetadata): void {
	const path = join(agentDir, "agent.json");
	if (!existsSync(agentDir)) {
		mkdirSync(agentDir, { recursive: true });
	}
	metadata.updatedAt = new Date().toISOString();
	writeFileSync(path, JSON.stringify(metadata, null, 2), "utf-8");
}

/**
 * Ensure agent.json exists. If not, creates a default one based on context.
 */
export function ensureAgentMetadata(ctx: AgentDirContext): AgentMetadata {
	const existing = loadAgentMetadata(ctx.path);
	if (existing) {
		// Basic migration: ensure ID matches context (id is immutable)
		if (existing.id !== ctx.id) {
			existing.id = ctx.id;
			saveAgentMetadata(ctx.path, existing);
		}
		return existing;
	}

	const now = new Date().toISOString();
	const metadata: AgentMetadata = {
		version: CURRENT_METADATA_VERSION,
		id: ctx.id,
		displayName: ctx.id === "default" ? "Default Agent" : ctx.id,
		createdAt: now,
		updatedAt: now,
		origin: {
			type: "local",
		},
		tags: [],
		engine: "nano-pencil",
		extensions: {},
	};

	saveAgentMetadata(ctx.path, metadata);
	return metadata;
}
