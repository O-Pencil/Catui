/**
 * [WHO]: getDebugLogPath function - returns path to debug log file
 * [FROM]: Depends on node:os, node:path
 * [TO]: Consumed by ./debug-logger.ts, ai package internals
 * [HERE]: core/lib/ai/src/config-path.ts - debug log path utility
 */
import { homedir } from "os";
import { join } from "path";

export function getDebugLogPath(): string {
	// Check for environment variable override
	const envDir = process.env.NANOPENCIL_CODING_AGENT_DIR;
	if (envDir) {
		const dir = envDir === "~" ? homedir() : envDir.startsWith("~/") ? homedir() + envDir.slice(1) : envDir;
		return join(dir, "nanopencil-debug.log");
	}
	return join(homedir(), ".nanopencil", "agent", "nanopencil-debug.log");
}
