/**
 * [WHO]: sleep()
 * [FROM]: No external dependencies
 * [TO]: Consumed by core/runtime/agent-session.ts
 * [HERE]: core/platform/utils/sleep.ts - sleep helper that respects abort signal; cleans the abort listener on both resolve and reject so repeated sleeps against the same long-lived signal do not stack listeners (Node fires MaxListenersExceededWarning at 11)
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error("Aborted"));
			return;
		}

		const onAbort = () => {
			clearTimeout(timeout);
			reject(new Error("Aborted"));
		};
		const timeout = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}
