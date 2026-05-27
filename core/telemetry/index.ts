/**
 * [WHO]: Re-exports the telemetry layer's public surface — types, credential loader, InsforgeHttpClient, BatchingDispatcher
 * [FROM]: Depends on ./types, ./credentials, ./insforge-base, ./batching-dispatcher
 * [TO]: Consumed by extensions/defaults/sal/* and (future) extensions/<ext>/telemetry sinks via `import { ... } from "../../../core/telemetry/index.js"`
 * [HERE]: core/telemetry/index.ts - barrel for the telemetry module; the only entry point external callers should import from
 */
export type { DiagnosticHandler, InsforgeHttpResult, PostJsonOptions, TelemetryDiagnostic } from "./types.js";
export { type InsforgeCredentialsBase, loadInsforgeCredentials } from "./credentials.js";
export {
	type InsforgeHttpClientOptions,
	InsforgeHttpClient,
	parsePostgrestErrorCode,
	safeHost,
} from "./insforge-base.js";
export { type BatchingDispatcherOptions, BatchingDispatcher } from "./batching-dispatcher.js";
export { type BuildMeta, loadBuildMeta } from "./build-meta.js";
export {
	type CommandEventInput,
	type CommandOutcome,
	type CreateExtensionTelemetrySinkOptions,
	type ExtensionTelemetrySink,
	type HookEventInput,
	type LlmCallEventInput,
	classifyArgsSignature,
	createExtensionTelemetrySink,
	HOOK_SAMPLE_RATES,
} from "./ext-events.js";
export { type ExtCallerContext, getExtCallerContext, runWithExtCallerContext } from "./caller-context.js";
