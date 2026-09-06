/**
 * [WHO]: installWarningGuard — mirrors Node process warnings into the diagnostics bus
 * [FROM]: Depends on utils/diagnostics.js (isDevRuntime, reportDiagnostic)
 * [TO]: Consumed by main.ts at CLI startup (user mode)
 * [HERE]: utils/warning-guard.ts - warning observability only; never suppresses
 *
 * Design history: an earlier in-main.ts version monkey-patched process.emitWarning
 * and removed Node's default 'warning' listeners to hide MaxListenersExceededWarning
 * in user mode. That hid real listener leaks. Empirically (Node 20+), adding a
 * 'warning' listener does NOT disable Node's default stderr printer, so nothing
 * needs to be silenced for observability — this module only mirrors, never swallows.
 */

import { isDevRuntime, reportDiagnostic } from "./diagnostics.js";

type NodeWarning = Error & { code?: string };

let installed = false;

const isMaxListenersWarning = (warning: NodeWarning): boolean => {
	if (warning.name === "MaxListenersExceededWarning") return true;
	const text = String(warning.message ?? "");
	return (
		text.startsWith("Possible EventTarget memory leak detected") ||
		text.startsWith("Possible EventEmitter memory leak detected")
	);
};

const isDep0190 = (warning: NodeWarning): boolean =>
	warning.name === "DeprecationWarning" && warning.code === "DEP0190";

/**
 * Mirror Node process warnings into the unified diagnostics bus WITHOUT
 * suppressing them. Node's default stderr printer keeps running (adding a
 * listener does not disable it), so listener leaks and deprecations stay
 * visible to users.
 *
 * DEP0190 (spawn with shell:true + args array; Node 24+) is mirrored, not
 * swallowed: this repo's own spawn sites already use the non-deprecated form.
 * If a dependency starts triggering it, diagnostics data will identify the
 * source and a targeted, documented suppression can be added then.
 *
 * No-op in dev runtime (reportDiagnostic would double-print there).
 */
export function installWarningGuard(): void {
	if (isDevRuntime()) return;
	if (installed) return;
	installed = true;

	process.on("warning", (warning: NodeWarning) => {
		try {
			if (isMaxListenersWarning(warning)) {
				reportDiagnostic({
					source: "node.warning",
					severity: "warning",
					category: "fallback",
					message: warning.message.slice(0, 240),
					detail: { code: warning.code, name: warning.name },
					fingerprint: "node.warning:max-listeners-exceeded",
				});
				return;
			}
			if (isDep0190(warning)) {
				reportDiagnostic({
					source: "node.warning",
					severity: "warning",
					category: "fallback",
					message: warning.message.slice(0, 240),
					detail: { code: warning.code, name: warning.name },
					fingerprint: "node.warning:dep0190",
				});
			}
		} catch {
			// Diagnostics must never break warning delivery.
		}
	});
}
