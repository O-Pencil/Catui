/**
 * Builds the first-party internal libraries (build:deps) with dependency-aware
 * parallelism.
 *
 * Replaces the serial `&& ` chain. The only build-time dependency among the
 * libs is agent-core → ai (agent-core imports `@pencil-agent/ai/*` declarations),
 * so:
 *   Phase 1 (parallel): extension-sdk, ai, tui   — mutually independent
 *   Phase 2:            agent-core               — needs ai's .d.ts
 *
 * Unlike a shell `p1 & p2 & wait` chain, this propagates any sub-build failure
 * (POSIX `wait` with no args returns 0 even when a child failed, which would
 * silently ship a broken build).
 */
import { spawn } from "node:child_process";

const PHASE_1 = [
	"packages/extension-sdk",
	"core/lib/ai",
	"core/lib/tui",
];
const PHASE_2 = ["core/lib/agent-core"];

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
	for (const prefix of PHASE_2) {
		await buildPackage(prefix);
	}
}

run().catch((error) => {
	console.error(error.message ?? error);
	process.exit(1);
});
