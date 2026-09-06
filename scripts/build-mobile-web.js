/**
 * Build the mobile web UI (apps/mobile) and copy the bundle into
 * modes/remote/public, where remote-server.ts serves it and
 * scripts/copy-assets.js ships it into dist/.
 *
 * Deliberately NOT part of `npm run build`: apps/mobile has its own
 * lockfile (not in root workspaces) and a full React/Vite toolchain.
 *
 * Modes:
 *   default            — skip silently (exit 0) when apps/mobile or its
 *                        node_modules is missing, so contributors without
 *                        mobile tooling are not blocked.
 *   --strict           — fail (exit 1) instead of skipping. Used by
 *                        build:release: a published package MUST contain
 *                        the remote web UI (modes/remote/public is
 *                        gitignored, so releases must build it here).
 */
import { cpSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const APP_DIR = join(ROOT, "apps", "mobile");
const APP_DIST = join(APP_DIR, "dist");
const PUBLIC_DIR = join(ROOT, "modes", "remote", "public");
const STRICT = process.argv.includes("--strict");

if (!existsSync(join(APP_DIR, "package.json"))) {
	const message = "[build-mobile-web] apps/mobile not found";
	if (STRICT) {
		console.error(`${message} — aborting release (--strict).`);
		process.exit(1);
	}
	console.error(`${message} — skipping.`);
	process.exit(0);
}

if (!existsSync(join(APP_DIR, "node_modules"))) {
	if (STRICT) {
		console.error("[build-mobile-web] apps/mobile/node_modules missing — aborting release (--strict).");
		console.error("  A published package must ship the remote web UI:");
		console.error("    cd apps/mobile && npm install");
		process.exit(1);
	}
	console.warn("[build-mobile-web] apps/mobile/node_modules missing — skipping.");
	console.warn("  To build the mobile web UI:");
	console.warn("    cd apps/mobile && npm install");
	console.warn("    cd ../.. && npm run build:mobile-web");
	process.exit(0);
}

console.log("[build-mobile-web] building apps/mobile...");
const result = spawnSync("npm", ["run", "build"], { cwd: APP_DIR, stdio: "inherit", shell: true });
if (result.status !== 0) {
	console.error(`[build-mobile-web] build failed (exit ${result.status}).`);
	process.exit(result.status ?? 1);
}

if (!existsSync(APP_DIST)) {
	console.error("[build-mobile-web] apps/mobile/dist not produced — nothing to copy.");
	process.exit(1);
}

rmSync(PUBLIC_DIR, { recursive: true, force: true });
cpSync(APP_DIST, PUBLIC_DIR, { recursive: true });
console.log(`[build-mobile-web] copied ${APP_DIST} -> ${PUBLIC_DIR}`);
