/**
 * Builds the first-party internal libraries (build:deps) with dependency-aware
 * parallelism.
 *
 * Replaces the serial `&& ` chain. The only build-time dependency among the
 * libs are agent-core → ai and mem-core → protocol,
 * so:
 *   Phase 1 (parallel): protocol, ai, tui, soul-core — mutually independent
 *   Phase 2 (parallel): agent-core, mem-core         — need phase 1 declarations
 *
 * Unlike a shell `p1 & p2 & wait` chain, this propagates any sub-build failure
 * (POSIX `wait` with no args returns 0 even when a child failed, which would
 * silently ship a broken build).
 */
import { spawn } from "node:child_process";

const PHASE_1 = [
	"packages/protocol",
	"core/lib/ai",
	"core/lib/tui",
	"packages/soul-core",
];
const PHASE_2 = ["core/lib/agent-core", "packages/mem-core"];

function buildPackage(prefix) {
	return new Promise((resolve, reject) => {
		const child = spawn("npm", ["run", "build", "--prefix", prefix], {
			stdio: "inherit",
			shell: process.platform === "win32",
		});
		child.on("error", reject);
		child.on("exit", (code) => {
			if (code === 0) resolve();
			else reject(new Error(`build failed for ${prefix} (exit ${code})`));
		});
	});
}

async function run() {
	await Promise.all(PHASE_1.map(buildPackage));
	await Promise.all(PHASE_2.map(buildPackage));
}

run().catch((error) => {
	console.error(error.message ?? error);
	process.exit(1);
});
