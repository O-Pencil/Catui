/**
 * [WHO]: Reserved, bounded model-worker subprocess invocations
 * [FROM]: Local process, state and configuration contracts
 * [TO]: Candidate triage, reproduction, repair and independent review
 * [HERE]: extensions/optional/evolution/source/delivery/model.ts - model budget boundary
 */
import { join } from "node:path";
import type { RunCommand, SourceConfig, SourceState } from "../types.js";
import { reserveCall } from "../runtime/state.js";
import { catuiCommand, checked } from "../runtime/process.js";
import { readInstalled } from "./adoption.js";

export function workerEnvironment(agentDir: string): NodeJS.ProcessEnv {
	const env = { ...process.env, CATUI_EVOLUTION_WORKER: "1", CATUI_CODING_AGENT_DIR: agentDir };
	for (const key of Object.keys(env)) if (/^(GH_|GITHUB_|NPM_|NODE_AUTH_TOKEN|GIT_)/i.test(key)) delete (env as NodeJS.ProcessEnv)[key];
	return env;
}
export async function askWorker(run: RunCommand, root: string, state: SourceState, config: SourceConfig, phase: "triage" | "reproduce" | "repair" | "review", cwd: string, prompt: string, testPath = ""): Promise<string> {
	if (prompt.length > 100000) throw new Error("Worker evidence exceeds bounded context; split the finding");
	await reserveCall(root, state, config);
	const installed = await readInstalled(root);
	return checked(run, process.execPath, [...(installed ? [installed.cli] : catuiCommand()), "evolve", "worker", "--root", root, "--phase", phase, "--test", testPath], {
		cwd, input: prompt, env: workerEnvironment(config.agentDir), timeoutMs: config.maxWorkerSeconds * 1000,
		log: join(root, "logs", `model-${Date.now()}-${phase}.json`),
	});
}
