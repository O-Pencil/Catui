/**
 * [WHO]: time(), printTimings()
 * [FROM]: No external dependencies
 * [TO]: Consumed by core/runtime/sdk.ts
 * [HERE]: core/platform/timings.ts - central timing instrumentation
 */
const ENABLED = process.env.NANOPENCIL_TIMING === "1";
const timings: Array<{ label: string; ms: number }> = [];
let lastTime = Date.now();
let printed = false;

export function time(label: string): void {
	if (!ENABLED) return;
	const now = Date.now();
	timings.push({ label, ms: now - lastTime });
	lastTime = now;
}

export function printTimings(): void {
	if (!ENABLED || printed || timings.length === 0) return;
	printed = true;
	console.error("\n--- Startup Timings ---");
	for (const t of timings) {
		console.error(`  ${t.label}: ${t.ms}ms`);
	}
	console.error(`  TOTAL: ${timings.reduce((a, b) => a + b.ms, 0)}ms`);
	console.error("------------------------\n");
}

// Headless safety net: interactive mode prints at first-input-ready (the
// meaningful "ready" moment); non-interactive paths (print / --list-models /
// rpc) have no such hook, so flush on process exit. printTimings() is
// idempotent, so whichever fires first wins and the other is a no-op.
if (ENABLED) {
	process.once("exit", printTimings);
}
