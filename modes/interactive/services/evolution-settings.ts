/**
 * [WHO]: Provides readEvolutionRemotePush(), setEvolutionRemotePush()
 * [FROM]: Depends on node:fs/path and root config.js for getAgentDir
 * [TO]: Consumed by settings-overlay-controller for the evolution remote-push settings toggle
 * [HERE]: modes/interactive/services/evolution-settings.ts - mode-local source-evolution config IO
 */
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "../../../config.js";

function configPath(agentDir: string): string {
	return join(agentDir, "evolution", "source", "config.json");
}

export function readEvolutionRemotePush(agentDir = getAgentDir()): boolean | undefined {
	try {
		const parsed = JSON.parse(readFileSync(configPath(agentDir), "utf8"));
		if (!parsed || typeof parsed !== "object") return undefined;
		// Configs written before allowRemotePush existed load as disabled, matching loadConfig backfill.
		return typeof parsed.allowRemotePush === "boolean" ? parsed.allowRemotePush : false;
	} catch {
		return undefined;
	}
}

export function setEvolutionRemotePush(enabled: boolean, agentDir = getAgentDir()): void {
	const path = configPath(agentDir);
	const parsed = JSON.parse(readFileSync(path, "utf8"));
	parsed.allowRemotePush = enabled;
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(parsed, undefined, 2)}\n`);
	renameSync(tmp, path);
}
