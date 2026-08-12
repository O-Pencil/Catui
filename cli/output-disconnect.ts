/**
 * [WHO]: Owns process-level handling for closed CLI output consumers
 * [FROM]: Depends only on Node writable streams and process lifecycle
 * [TO]: Installed by cli.ts before any fast-path or application output
 * [HERE]: CLI boundary policy for expected stdout/stderr disconnects
 */

import type { Writable } from "node:stream";

const guardedStreams = new WeakSet<Writable>();

function errorCode(error: unknown): string | undefined {
	if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
	return typeof error.code === "string" ? error.code : undefined;
}

export function isOutputDisconnectError(error: unknown): boolean {
	return errorCode(error) === "EPIPE";
}

function guardOutputStream(stream: Writable): void {
	if (guardedStreams.has(stream)) return;
	guardedStreams.add(stream);
	stream.on("error", (error: unknown) => {
		if (isOutputDisconnectError(error)) {
			process.exit(0);
		}
		throw error;
	});
}

export function installOutputDisconnectHandlers(): void {
	guardOutputStream(process.stdout);
	guardOutputStream(process.stderr);
}
