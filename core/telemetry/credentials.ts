/**
 * [WHO]: Provides InsforgeCredentialsBase interface + loadInsforgeCredentials() — single-source credential loader for any insforge-backed telemetry sink
 * [FROM]: Depends on node:fs (existsSync, readFileSync), node:os (homedir), node:path (join), ./types for DiagnosticHandler
 * [TO]: Consumed by extensions/defaults/sal/index.ts via re-export; future extension-telemetry sink reads via the same loader
 * [HERE]: core/telemetry/credentials.ts - parses ~/.memory-experiments/credentials.json (workspace fallback ordered first), accepts both {credentials:[{id,...}]} and flat formats, returns null when no usable file found
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { DiagnosticHandler } from "./types.js";

/**
 * Base shape of an insforge credentials record. Sinks may extend this with
 * their own fields (e.g. SAL adds `cleanup_stale_runs`); use the generic
 * parameter on loadInsforgeCredentials to type those extra fields safely.
 */
export interface InsforgeCredentialsBase {
	endpoint?: string;
	/** Legacy alias for `endpoint` — both formats are produced by older configs. */
	insforge_url?: string;
	api_key?: string;
	anon_key?: string;
	api_key_header?: string;
	headers?: Record<string, string>;
	allow_self_signed?: boolean;
	enabled?: boolean;
}

interface CredentialEntry extends InsforgeCredentialsBase {
	id?: string;
	apiKey?: string;
	anonKey?: string;
	apiKeyHeader?: string;
	allowSelfSigned?: boolean;
	[key: string]: unknown;
}

interface CredentialsFile {
	credentials?: CredentialEntry[];
	[key: string]: unknown;
}

const CREDENTIALS_BASENAME = ".memory-experiments";
const CREDENTIALS_FILE = "credentials.json";
const INSFORGE_ENTRY_ID = "insforge";

/**
 * Walks a prioritized list of candidate paths (workspace overrides home dir) and
 * returns the first usable credentials record. Returns null when nothing is found
 * or all files are unparseable.
 *
 * `source` is folded into emitted diagnostics so SAL keeps emitting
 * `sal.eval:...` fingerprints and a future ext-telemetry sink emits
 * `ext.telemetry:...` without changing this loader.
 */
export function loadInsforgeCredentials<T extends InsforgeCredentialsBase = InsforgeCredentialsBase>(
	workspaceRoot: string,
	source: string,
	onDiagnostic?: DiagnosticHandler,
	extraEnvPath?: string,
): T | null {
	const candidates = [
		extraEnvPath,
		join(workspaceRoot, CREDENTIALS_BASENAME, CREDENTIALS_FILE),
		join(homedir(), CREDENTIALS_BASENAME, CREDENTIALS_FILE),
	].filter((path): path is string => Boolean(path));

	for (const filePath of candidates) {
		const parsed = readFileSafely(filePath, source, onDiagnostic);
		if (!parsed) continue;
		const record = pickInsforgeEntry<T>(parsed);
		if (record) return record;
	}
	return null;
}

function readFileSafely(
	filePath: string,
	source: string,
	onDiagnostic?: DiagnosticHandler,
): CredentialsFile | null {
	try {
		if (!existsSync(filePath)) return null;
		const raw = readFileSync(filePath, "utf-8");
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object") return null;
		return parsed as CredentialsFile;
	} catch (err) {
		onDiagnostic?.({
			source,
			severity: "warning",
			category: "config",
			message: "Insforge credentials file could not be read.",
			detail: { filePath, error: (err as Error).message },
			fingerprint: `${source}:config:credentials-read-failed`,
		});
		return null;
	}
}

function pickInsforgeEntry<T extends InsforgeCredentialsBase>(parsed: CredentialsFile): T | null {
	// Format 1: { credentials: [{ id: "insforge", ... }, ...] }
	if (Array.isArray(parsed.credentials)) {
		const entry = parsed.credentials.find(
			(e) => e?.id === INSFORGE_ENTRY_ID && e?.enabled !== false,
		);
		if (entry) return normalizeEntry<T>(entry);
		return null;
	}
	// Format 2: flat record at top level.
	return normalizeEntry<T>(parsed as CredentialEntry);
}

function normalizeEntry<T extends InsforgeCredentialsBase>(entry: CredentialEntry): T {
	// Map camelCase aliases → snake_case canonical fields. Preserve any extra
	// (sink-specific) keys verbatim so callers like SAL can read
	// `cleanup_stale_runs` etc. without this loader knowing about them.
	const normalized: InsforgeCredentialsBase & Record<string, unknown> = {
		...entry,
		endpoint: entry.endpoint ?? entry.insforge_url,
		insforge_url: entry.insforge_url ?? entry.endpoint,
		api_key: entry.api_key ?? entry.apiKey,
		anon_key: entry.anon_key ?? entry.anonKey,
		api_key_header: entry.api_key_header ?? entry.apiKeyHeader,
		headers: entry.headers,
		allow_self_signed: entry.allow_self_signed ?? entry.allowSelfSigned,
		enabled: entry.enabled,
	};
	return normalized as T;
}
