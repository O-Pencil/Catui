/**
 * [WHO]: inferScenariosFromSchema(), MCPSchemaFieldRule, SCENARIO_RULES
 * [FROM]: Depends on nothing — pure data + helper that walks JSON Schema.
 * [TO]: Consumed by core/mcp/mcp-adapter.ts (buildMcpToolGuidance).
 * [HERE]: core/mcp/mcp-schema-inference.ts - schema-driven scenario inference.
 *
 * Server-level hints (mcp-server-hints.ts) describe what an MCP *server* is for
 * at a coarse grain. Schema inference describes what a specific *tool* takes
 * as input, which lets us add tool-grain hints ("takes a `path` arg → it's a
 * file operation") that the server-level table can't express.
 *
 * The output is intentionally short — a list of human-readable scenario
 * phrases — and gets merged into the LLM guidance / description. We bound the
 * total length downstream so callers can fit the result into the guidance
 * budget without exploding prompt size when many tools are present.
 *
 * Matching is case-insensitive. Field names that overlap (e.g. a tool with
 * both `path` and `url` properties) yield multiple phrases; dedup keeps the
 * first match per rule but lets different rules each contribute one phrase.
 */

export interface MCPSchemaFieldRule {
  /** Field name substrings (lower-cased). Match is `any rule.any(substring)`. */
  readonly substrings: readonly string[];
  /** Human-readable scenario phrase that the rule implies. */
  readonly phrase: string;
}

/**
 * Rule order matters: more specific rules come first. When a property name
 * matches multiple rules we keep one phrase per *rule*, not per substring,
 * so vocabulary stays tight. The order also determines priority when later
 * rules overlap — earlier phrases win for the same property.
 */
export const SCENARIO_RULES: readonly MCPSchemaFieldRule[] = [
  {
    substrings: ["filepath", "filename"],
    phrase: "operates on a specific file by path",
  },
  {
    substrings: ["path", "dirpath", "directorypath"],
    phrase: "operates on files or directories by path",
  },
  {
    substrings: ["dir", "folder", "directory"],
    phrase: "browses directories",
  },
  {
    substrings: ["content", "body", "text", "message"],
    phrase: "writes or reads textual content",
  },
  {
    substrings: ["url", "uri", "endpoint", "href"],
    phrase: "targets a URL or HTTP endpoint",
  },
  {
    substrings: ["query", "keyword", "term", "phrase", "q"],
    phrase: "runs a search / lookup against a query string",
  },
  {
    substrings: ["sql", "statement", "querysql", "sqltxt"],
    phrase: "runs a SQL statement",
  },
  {
    substrings: ["table", "collection", "bucket"],
    phrase: "targets a table / collection",
  },
  {
    substrings: ["branch", "ref", "tagname"],
    phrase: "targets a git ref (branch / tag)",
  },
  {
    substrings: ["commit", "sha", "revision"],
    phrase: "targets a specific commit",
  },
  {
    substrings: ["repo", "reponame", "repository"],
    phrase: "targets a repository",
  },
  {
    substrings: ["owner", "org", "organization", "username"],
    phrase: "targets a user / org identifier",
  },
  {
    substrings: ["since", "until", "fromdate", "todate", "startdate", "enddate"],
    phrase: "filters by a date / time range",
  },
  {
    substrings: ["limit", "maxresults", "count", "pagesize", "perpage"],
    phrase: "paginates or limits result count",
  },
];

// Generic identifiers that are too noisy to map on their own — intentionally
// kept out of rules so a property literally named "id" doesn't fire any phrase.
const NOISE_FIELD_SUBSTRINGS = new Set<string>([
  "id",
  "name",
  "type",
  "value",
  "key",
  "description",
  "title",
  "format",
  "options",
  "metadata",
  "tags",
]);

/**
 * Walk an MCP tool inputSchema's `properties` and return a deduplicated
 * list of scenario phrases implied by the field names. Schemas without
 * `properties` (or with no recognized field names) yield `[]`. Properties
 * whose name matches a known noise substring (id, name, type, …) contribute
 * nothing.
 *
 * Output is bounded to `maxRules` rules (default 3) so a single tool can't
 * balloon the guidance text when its schema has many recognizable fields.
 * Earlier rules (more specific) win; later matches are dropped.
 */
export function inferScenariosFromSchema(
  inputSchema: unknown,
  maxRules = 3,
): string[] {
  if (!inputSchema || typeof inputSchema !== "object") return [];
  const schema = inputSchema as Record<string, unknown>;
  const properties = schema.properties;
  if (!properties || typeof properties !== "object") return [];

  const propertyNames: string[] = [];
  for (const key of Object.keys(properties as Record<string, unknown>)) {
    if (typeof key !== "string") continue;
    const lower = key.toLowerCase();
    // Skip noise keys outright so a property literally called "id" doesn't
    // accidentally trip an unrelated rule through substring overlap.
    if (NOISE_FIELD_SUBSTRINGS.has(lower)) continue;
    propertyNames.push(lower);
  }
  if (propertyNames.length === 0) return [];

  const out: string[] = [];
  const seenPhrases = new Set<string>();
  outer: for (const rule of SCENARIO_RULES) {
    for (const property of propertyNames) {
      if (rule.substrings.some((s) => property.includes(s))) {
        if (!seenPhrases.has(rule.phrase)) {
          out.push(rule.phrase);
          seenPhrases.add(rule.phrase);
          if (out.length >= maxRules) break outer;
        }
        break; // one match per rule is enough; move on
      }
    }
  }
  return out;
}

/**
 * Render a list of scenario phrases into a single sentence fragment suitable
 * for appending to guidance / description text. Returns "" when the list is
 * empty so callers can `result || fallback` without ceremony.
 *
 * Phrase order matches the rule order (more specific first).
 */
export function renderSchemaInferences(phrases: readonly string[]): string {
  if (phrases.length === 0) return "";
  if (phrases.length === 1) return `Takes args that ${phrases[0]}.`;
  if (phrases.length === 2) return `Takes args that ${phrases[0]} or ${phrases[1]}.`;
  return `Takes args that ${phrases.slice(0, -1).join(", ")}, or ${phrases[phrases.length - 1]}.`;
}
