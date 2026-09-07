/**
 * [WHO]: Source evolution CLI setup, service control, status and managed version launch
 * [FROM]: Local source runtime and delivery adapters, public config path discovery
 * [TO]: CLI fast command dispatch
 * [HERE]: extensions/optional/evolution/source/cli.ts - source evolution product surface
 */
import { getAgentDir } from "../../../../config.js";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { defaultConfig, loadConfig, sourceRoot, validateConfig } from "./runtime/config.js";
import { atomicJson, loadState } from "./runtime/state.js";
import { startDaemon, installService } from "./runtime/service.js";
import { readInstalled } from "./delivery/adoption.js";

export async function sourceEvolutionCli(args: string[]): Promise<void> {
	const option = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
	const root = resolve(option("--root") ?? sourceRoot(getAgentDir()));
	const command = args[0] ?? "status";
	if (["--help", "-h", "help"].includes(command)) { console.log("Usage: catui evolve init --model provider/model | start | stop | status | run | install-service | launch [-- args]"); return; }
	if (command === "init") {
		if (loadConfig(root)) throw new Error(`Source evolution already configured: ${join(root, "config.json")}`);
		const model = option("--model");
		if (!model) throw new Error("Usage: catui evolve init --model provider/model [--root path]");
		await atomicJson(join(root, "config.json"), validateConfig(defaultConfig(getAgentDir(), model)));
		console.log(`Source evolution configured at ${root}. Autonomous merge, publish and update enabled; daily worker runs: 8 (up to 24 turns each), repair jobs: 1. Run catui evolve start or install-service.`); return;
	}
	if (command === "status") {
		const config = loadConfig(root);
		if (!config) { console.log("Source evolution is not configured. Run catui evolve init --model provider/model."); return; }
		const state = await loadState(root);
		console.log(JSON.stringify({ root, enabled: config.enabled, schedule: `${config.hour}:00 ${config.timeZone}`, autoMerge: config.autoMerge, autoPublish: config.autoPublish, autoUpdate: config.autoUpdate, heartbeat: state.heartbeat, paused: state.paused, error: state.error, dropped: state.dropped, observations: state.observations.length, budgets: state.budgets, installed: await readInstalled(root), jobs: state.jobs.map(({ evidence, ...job }) => ({ ...job, evidenceCount: evidence.length })) }, null, 2)); return;
	}
	const config = loadConfig(root);
	if (!config) throw new Error("Source evolution is not configured");
	if (command === "worker") {
		const chunks: Buffer[] = []; let length = 0;
		for await (const chunk of process.stdin) { length += chunk.length; if (length > 400000) throw new Error("Worker input too large"); chunks.push(Buffer.from(chunk)); }
		const { runWorker } = await import("./delivery/worker.js");
		console.log(await runWorker(config, option("--phase") ?? "", option("--test") ?? "", Buffer.concat(chunks).toString())); return;
	}
	if (command === "start" || command === "stop") {
		config.enabled = command === "start"; await atomicJson(join(root, "config.json"), config);
		if (config.enabled) await startDaemon(root);
		console.log(config.enabled ? "Source evolution supervisor started." : "Source evolution disabled. In-flight verification may finish; new delivery stops on the next supervisor tick."); return;
	}
	if (command === "install-service") { console.log(await installService(root)); return; }
	if (command === "daemon" || command === "run") {
		const controller = new AbortController();
		process.once("SIGINT", () => controller.abort()); process.once("SIGTERM", () => controller.abort());
		const { runSupervisor } = await import("./runtime/daemon.js");
		await runSupervisor(root, command === "run", controller.signal); return;
	}
	if (command === "launch") {
		const installed = await readInstalled(root);
		if (!installed) throw new Error("No managed version has been adopted yet");
		await launch(installed.cli, args.includes("--") ? args.slice(args.indexOf("--") + 1) : []); return;
	}
	throw new Error("Usage: catui evolve init|start|stop|status|run|install-service|launch");
}
async function launch(cli: string, args: string[]): Promise<void> {
	const child = spawn(process.execPath, [cli, ...args], { stdio: "inherit", env: { ...process.env, CATUI_EVOLUTION_LAUNCHED: "1" } });
	await new Promise<void>((resolve, reject) => {
		child.once("error", reject); child.once("exit", code => { process.exitCode = code ?? 1; resolve(); });
	});
}
export async function launchAdoptedVersion(args: string[]): Promise<boolean> {
	if (process.env.CATUI_EVOLUTION_WORKER === "1" || process.env.CATUI_EVOLUTION_LAUNCHED === "1") return false;
	if (args.includes("--agent") || process.argv[1]?.endsWith(".ts")) return false;
	const root = sourceRoot(getAgentDir());
	try {
		if (!loadConfig(root)?.autoUpdate) return false;
		const installed = await readInstalled(root);
		if (!installed) return false;
		await launch(installed.cli, args); return true;
	} catch (error) {
		console.error(`Managed evolution version unavailable; using original installation. ${error instanceof Error ? error.message : String(error)}`);
		return false;
	}
}
