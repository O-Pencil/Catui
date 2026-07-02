/**
 * [WHO]: MCP_SERVER_HINTS, getMcpServerHint(), getMcpServerScenarios()
 * [FROM]: Depends on nothing — pure data + lookup helpers.
 * [TO]: Consumed by core/mcp/mcp-adapter.ts (buildMcpToolGuidance / buildMcpDescriptionSuffix).
 * [HERE]: core/mcp/mcp-server-hints.ts - per-server scenario vocabulary for guidance text.
 *
 * Each hint entry maps a builtin MCP server id (from mcp-config.ts) to a
 * short list of user-facing scenario phrases. The phrases are intentionally
 * phrased as observable user intents ("read files outside the local project
 * cwd", "fetch a public web page") so that when merged into the LLM's
 * guidance / description text they raise the chance the model recognizes
 * a query → tool match it would otherwise miss.
 *
 * Server ids not present here fall through to a generic "<serverId>'s domain"
 * phrase. Adding a new server to mcp-config.ts without a hint entry is fine;
 * the hint layer degrades gracefully.
 *
 * Keep entries short and concrete. Verbose marketing copy wastes prompt
 * budget and dilutes signal across many tools.
 */
export const MCP_SERVER_HINTS: Record<string, readonly string[]> = {
  filesystem: [
    "read or write files outside the local project cwd",
    "browse a directory tree the in-project `read` tool can't reach",
    "list, search, or edit files in another project or in $HOME",
  ],
  fetch: [
    "fetch a public web page or raw HTTP resource",
    "download HTML / JSON / text the local network tools can't reach",
    "scrape a URL when the user asks about a webpage",
  ],
  "sequential-thinking": [
    "break a multi-step reasoning task into structured sub-steps",
    "plan a non-trivial decision before acting",
  ],
  memory: [
    "store or recall entities in the persistent knowledge graph",
    "remember facts across sessions (people, projects, preferences)",
    "query the long-term memory graph",
  ],
  "figma-desktop": [
    "read or modify the open Figma file via the desktop bridge",
    "inspect a Figma node's properties or screenshot it",
  ],
  "figma-remote": [
    "read or modify a remote Figma file via Figma's cloud MCP",
    "fetch Figma node properties without the desktop bridge",
  ],
  sqlite: [
    "query or mutate a local SQLite database file",
    "inspect schema or run SQL on a .db / .sqlite file the user names",
  ],
  github: [
    "interact with GitHub repositories, issues, pull requests",
    "search code on GitHub or read a remote repo's contents",
    "create or comment on a PR / issue when the user asks",
  ],
  "brave-search": [
    "search the public web when the user asks for current information",
    "find a URL or look up a fact that needs an up-to-date web source",
  ],
  git: [
    "run git operations beyond what the local `bash` shell should handle",
    "inspect or mutate a repo's history, branches, or remotes via MCP",
  ],
  postgres: [
    "query or mutate a PostgreSQL database the user has configured",
    "inspect schema or run SQL against a local Postgres instance",
  ],
};

/**
 * Get the scenario phrases for a server id. Returns an empty array for
 * unknown servers — callers must handle the empty case.
 */
export function getMcpServerScenarios(serverId: string): readonly string[] {
  return MCP_SERVER_HINTS[serverId] ?? [];
}

/**
 * Get a short hint phrase for a server id, suitable for embedding in
 * guidance / description text. Falls back to "<serverId>'s domain" when
 * no scenario list is registered. Length is bounded to keep the resulting
 * guidance under the ~280-char budget enforced by the system-prompt MCP
 * section verifier.
 */
export function getMcpServerHint(serverId: string): string {
  const scenarios = getMcpServerScenarios(serverId);
  if (scenarios.length === 0) {
    return `${serverId}'s domain`;
  }
  // Take the first scenario as the headline; mention "and related X tasks" to
  // hint at the rest without exploding token count.
  return `${scenarios[0]} (and related ${serverId} tasks)`;
}