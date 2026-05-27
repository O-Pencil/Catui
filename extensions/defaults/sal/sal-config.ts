/**
 * [WHO]: Provides SAL build metadata, eval env constants, credential loading, and sidecar path resolution
 * [FROM]: Depends on node fs/os/path/url and eval adapter type for local credential normalization
 * [TO]: Consumed by extensions/defaults/sal/index.ts and tests that validate SAL experiment/config behavior
 * [HERE]: extensions/defaults/sal/sal-config.ts - configuration and path boundary for Structural Anchor Localization
 */

import { join } from "node:path";
import { loadBuildMeta as loadBuildMetaShared, loadInsforgeCredentials } from "../../../core/telemetry/index.js";
import type { EvalAdapterId } from "./eval/index.js";
import type { BuildMeta, SalDiagnosticReporter } from "./sal-runtime.js";

export const SAL_AB_ENV = "NANOPENCIL_SAL_AB";
export const EVAL_ENABLED_ENV = "NANOPENCIL_EVAL_ENABLED";
export const EVAL_ENDPOINT_ENV = "NANOPENCIL_EVAL_ENDPOINT";
export const EVAL_RUN_ID_ENV = "NANOPENCIL_EVAL_RUN_ID";
export const EVAL_VARIANT_ENV = "NANOPENCIL_EVAL_VARIANT";
export const EVAL_LEGACY_FILE_ENV = "NANOPENCIL_EVAL_LEGACY_FILE";
export const EVAL_API_KEY_ENV = "NANOPENCIL_EVAL_API_KEY";
export const EVAL_API_KEY_HEADER_ENV = "NANOPENCIL_EVAL_API_KEY_HEADER";
export const EVAL_HEADERS_JSON_ENV = "NANOPENCIL_EVAL_HEADERS_JSON";
export const EVAL_CREDENTIALS_FILE_ENV = "NANOPENCIL_EVAL_CREDENTIALS_FILE";
export const EVAL_STALE_CLEANUP_ENV = "NANOPENCIL_EVAL_CLEANUP_STALE_RUNS";

export interface EvalCredentials {
	insforge_url?: string;
	endpoint?: string;
	api_key?: string;
	anon_key?: string;
	api_key_header?: string;
	headers?: Record<string, string>;
	enabled?: boolean;
	allow_self_signed?: boolean;
	cleanup_stale_runs?: boolean;
	/** Adapter selector. When omitted, inferred from endpoint scheme (http -> insforge, file/path -> jsonl). */
	adapter?: EvalAdapterId;
}

/**
 * Delegate to the shared core/telemetry/build-meta loader so SAL eval, the
 * ext-events sink, and any future telemetry consumer all stamp identical
 * pencil_version / commit_hash on emitted rows.
 */
export function loadBuildMeta(): BuildMeta {
	return loadBuildMetaShared();
}

export const BUILD_META = loadBuildMeta();

export function resolveStaleCleanupEnabled(
	envValue: string | undefined,
	credentials: EvalCredentials | undefined,
): boolean {
	if (envValue !== undefined) return isTruthy(envValue);
	return credentials?.cleanup_stale_runs === true;
}

export function isTruthy(value: unknown): boolean {
	if (value === true) return true;
	if (typeof value !== "string") return false;
	if (!value) return false;
	return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export function parseHeadersJson(
	raw: string | undefined,
	reportDiagnostic?: SalDiagnosticReporter,
): Record<string, string> {
	if (!raw) return {};
	try {
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object") return {};
		const out: Record<string, string> = {};
		for (const [key, value] of Object.entries(parsed)) {
			if (typeof value === "string") {
				out[key] = value;
			}
		}
		return out;
	} catch {
		reportDiagnostic?.({
			source: "sal.eval",
			severity: "warning",
			category: "config",
			message: `SAL eval ignored invalid JSON in ${EVAL_HEADERS_JSON_ENV}.`,
			fingerprint: "sal.eval:config:invalid-headers-json",
		});
		return {};
	}
}

export function resolveEvalCredentials(
	workspaceRoot: string,
	reportDiagnostic?: SalDiagnosticReporter,
): EvalCredentials | undefined {
	// Delegate file discovery + JSON parsing + format normalization to the
	// shared telemetry base. SAL only needs to type-assert the result back to
	// its own extended shape (EvalCredentials adds cleanup_stale_runs +
	// adapter on top of InsforgeCredentialsBase).
	const envPath = process.env[EVAL_CREDENTIALS_FILE_ENV];
	const creds = loadInsforgeCredentials<EvalCredentials>(workspaceRoot, "sal.eval", reportDiagnostic, envPath);
	return creds ?? undefined;
}

export function normalizeExperimentId(experimentId?: string): string | undefined {
	const raw = (experimentId ?? "").trim();
	if (!raw) return undefined;
	const normalized = raw
		.replace(/[^a-zA-Z0-9-_/.\s]/g, " ")
		.replace(/[\/\s]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.toLowerCase();
	return normalized || "run";
}

export function resolveSalSidecarDir(workspaceRoot: string, experimentId?: string): string {
	const normalized = normalizeExperimentId(experimentId);
	if (!normalized) {
		return join(workspaceRoot, ".memory-experiments", "sal", "anchors");
	}
	return join(workspaceRoot, ".memory-experiments", "runs", normalized, "sal", "anchors");
}

export function resolveSalAbEnabled(flagValue: unknown): boolean {
	return isTruthy(flagValue) || isTruthy(process.env[SAL_AB_ENV]);
}
