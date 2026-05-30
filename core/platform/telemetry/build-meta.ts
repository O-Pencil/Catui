/**
 * [WHO]: Provides BuildMeta interface + loadBuildMeta() — single-source build-stamp loader (version + commit + branch)
 * [FROM]: Depends on node:fs (existsSync, readFileSync), node:path (dirname, join), node:url (fileURLToPath)
 * [TO]: Consumed by extensions/builtin/sal/index.ts and core/platform/telemetry/ext-events.ts; both want the same version stamp on every emitted row
 * [HERE]: core/platform/telemetry/build-meta.ts - extracted from SAL's inline loadBuildMeta(); location-independent walker so callers in core/, extensions/, or scripts/ all resolve the same way
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface BuildMeta {
	version: string;
	commitHash?: string;
	branch?: string;
}

const FALLBACK: BuildMeta = { version: "dev" };
const PKG_NAME = "@pencil-agent/nano-pencil";
const MAX_WALK_DEPTH = 12;

/**
 * Walk up from this module's location looking for either a generated
 * `build-meta.json` (production / dist) or the project's `package.json` (dev /
 * tsx). Location-independent: works regardless of which directory the caller
 * lives in. Always returns a result — fallback is `{ version: "dev" }`.
 */
export function loadBuildMeta(): BuildMeta {
	try {
		const thisFile = fileURLToPath(import.meta.url);
		let dir = dirname(thisFile);
		for (let i = 0; i < MAX_WALK_DEPTH; i++) {
			const distMetaPath = join(dir, "build-meta.json");
			if (existsSync(distMetaPath)) {
				const parsed = JSON.parse(readFileSync(distMetaPath, "utf-8"));
				return {
					version: typeof parsed.version === "string" ? parsed.version : FALLBACK.version,
					commitHash: typeof parsed.commitHash === "string" ? parsed.commitHash : undefined,
					branch: typeof parsed.branch === "string" ? parsed.branch : undefined,
				};
			}
			const pkgPath = join(dir, "package.json");
			if (existsSync(pkgPath)) {
				try {
					const parsed = JSON.parse(readFileSync(pkgPath, "utf-8"));
					if (parsed?.name === PKG_NAME) {
						return {
							version: typeof parsed.version === "string" ? parsed.version : FALLBACK.version,
						};
					}
				} catch {
					// fall through and keep walking
				}
			}
			const parent = dirname(dir);
			if (parent === dir) break;
			dir = parent;
		}
	} catch {
		// non-fatal — fall through to fallback
	}
	return FALLBACK;
}
