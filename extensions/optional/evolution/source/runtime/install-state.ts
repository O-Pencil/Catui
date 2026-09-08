/**
 * [WHO]: Validated managed installation pointer reads
 * [FROM]: Local persisted JSON and installation contract
 * [TO]: Launcher, repair workers, adoption and measurement
 * [HERE]: extensions/optional/evolution/source/runtime/install-state.ts - shared pointer boundary
 */
import { join, resolve, relative } from "node:path";
import type { InstalledVersion } from "../types.js";
import { readJson } from "./state.js";

export async function readInstalled(root: string): Promise<InstalledVersion | undefined> {
	const active = await readJson<InstalledVersion>(join(root, "current.json"));
	if (!active) return undefined;
	const rel = relative(resolve(root, "versions"), resolve(active.cli));
	if (!/^\d+\.\d+\.\d+$/.test(active.version) || !rel || rel.startsWith("..") || !active.cli.endsWith("/dist/cli.js")) throw new Error("Invalid managed installation pointer");
	return active;
}
