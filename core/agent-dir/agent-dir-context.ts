/**
 * [WHO]: AgentDirContext interface, defaultAgentDirContext(), agentDirContextOf(), validateAgentId()
 * [FROM]: Depends on config.ts (getAgentDir)
 * [TO]: Consumed by core/persona, core/session, core/soul-integration, core/mcp, extensions, future --agent flag
 * [HERE]: core/agent-dir/agent-dir-context.ts - multi-agent directory abstraction
 *
 * Design doc: docs/multi-agent-fs-design.md §9.2
 *
 * Every module that resolves per-agent paths should accept AgentDirContext
 * (with default = legacy single-agent path). This allows future --agent <id>
 * to inject a different context without touching callers.
 */

import { getAgentDir } from "../../config.js";

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
}

/**
 * Build the default context for the legacy single-agent path.
 * This is the fallback when no `--agent` flag is provided.
 * Resolves to whatever `getAgentDir()` returns today (~/.nanopencil/agent/).
 */
export function defaultAgentDirContext(): AgentDirContext {
	return { id: "default", path: getAgentDir() };
}

/**
 * Build an AgentDirContext for a specific agent id + resolved path.
 * Throws if the id fails validation.
 */
export function agentDirContextOf(id: string, path: string): AgentDirContext {
	validateAgentId(id);
	return { id, path };
}
