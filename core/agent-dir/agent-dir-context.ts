/**
 * [WHO]: AgentDirContext interface, defaultAgentDirContext(), agentDirContextOf(), validateAgentId()
 * [FROM]: Depends on config.ts (getAgentDir)
 * [TO]: Consumed by core/persona, core/session, core/soul-integration, core/mcp, extensions, future --agent flag
 * [HERE]: core/agent-dir/agent-dir-context.ts - multi-agent directory abstraction
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, getPencilsAgentsDir } from "../../config.js";

// ---------------------------------------------------------------------------
// ID validation
// ---------------------------------------------------------------------------

/**
 * Regex for a valid agent <id>.
 * ASCII slug: lowercase alphanumeric start, then [a-z0-9._-], max 64 chars.
 * Design doc §4.1.
 */
export const AGENT_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/**
 * Validate an agent id. Returns the id if valid, throws otherwise.
 */
export function validateAgentId(id: string): string {
	if (!AGENT_ID_RE.test(id)) {
		throw new Error(
			`Invalid agent id "${id}". Must match ${AGENT_ID_RE.source} (lowercase ASCII slug, max 64 chars).`,
		);
	}
	return id;
}

// ---------------------------------------------------------------------------
// AgentDirContext
// ---------------------------------------------------------------------------

export interface AgentOriginMetadata {
	type: "local" | "cloud-adopted" | "imported";
	asgard?: {
		templateId: string;
		templateVersion: string;
		originUrl: string;
		externalId: string;
		lastSyncedAt: string;
	};
}

/**
 * Represents the resolved filesystem context for one agent.
 *
 * - `id`  : machine-readable slug (directory name, route key, Asgard externalId)
 * - `path`: absolute path to the agent's data directory
 * - `origin`: optional metadata if adopted from cloud (future, §4.2)
 */
export interface AgentDirContext {
	/** Slug id, [a-z0-9._-]{1,64}; matches the directory name. Immutable once created. */
	readonly id: string;
	/** Absolute path; trusted to exist or be creatable. */
	readonly path: string;
	/** Optional — if the agent was adopted from cloud, the origin metadata. */
	readonly origin?: AgentOriginMetadata;
}

/**
 * Build the default context for the legacy single-agent path.
 * This is the fallback when no `--agent` flag is provided.
 * Resolves to whatever `getAgentDir()` returns today (~/.pencils/agents/default).
 */
export function defaultAgentDirContext(): AgentDirContext {
	return { id: "default", path: getAgentDir() };
}

/**
 * Build an AgentDirContext for a specific agent id + resolved path.
 * Throws if the id fails validation.
 */
export function agentDirContextOf(id: string, path: string, origin?: AgentOriginMetadata): AgentDirContext {
	validateAgentId(id);
	return { id, path, origin };
}

/**
 * Load AgentDirContext from an agent directory (loads agent.json if it exists).
 */
export function loadAgentDirContext(id: string): AgentDirContext {
	const path = join(getPencilsAgentsDir(), id);
	const agentJsonPath = join(path, "agent.json");

	if (existsSync(agentJsonPath)) {
		try {
			const content = readFileSync(agentJsonPath, "utf-8");
			const metadata = JSON.parse(content);
			return {
				id: metadata.id || id,
				path,
				origin: metadata.origin,
			};
		} catch {
			// Fallback on parse error
		}
	}

	// Default for agents under PENCILS_AGENTS_DIR
	if (id !== "default" || existsSync(path)) {
		return { id, path };
	}

	// Ultimate fallback to legacy default
	return defaultAgentDirContext();
}

/**
 * Save AgentDirContext to agent.json.
 */
export function saveAgentDirContext(ctx: AgentDirContext): void {
	if (!existsSync(ctx.path)) {
		mkdirSync(ctx.path, { recursive: true });
	}

	const agentJsonPath = join(ctx.path, "agent.json");
	const metadata = {
		id: ctx.id,
		origin: ctx.origin,
	};

	writeFileSync(agentJsonPath, JSON.stringify(metadata, null, 2), "utf-8");
}
