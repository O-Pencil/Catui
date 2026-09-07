/**
 * [WHO]: Bounded shell-free process runner and installed/development Catui invocation
 * [FROM]: Node subprocess, URL and filesystem APIs
 * [TO]: Source evolution model, Git, verification and release adapters
 * [HERE]: extensions/optional/evolution/source/runtime/process.ts - subprocess boundary
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { RunCommand } from "../types.js";

export function catuiCommand(): string[] {
	const js = fileURLToPath(new URL("../../../../../cli.js", import.meta.url));
	return existsSync(js) ? [js] : ["--import", "tsx", js.replace(/\.js$/, ".ts")];
}
export const runCommand: RunCommand = async (command, args, options) => {
	const result = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
		const child = spawn(command, args, { cwd: options.cwd, env: options.env ?? process.env, shell: false, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] });
		let stdout = "", stderr = "", stopped = false;
		const stop = () => {
			stopped = true;
			try { if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch { /* Already exited. */ } }
			child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
			clearTimeout(timer);
			resolve({ code: 124, stdout: stdout.slice(-4_000_000), stderr: stderr.slice(-4_000_000) });
		};
		const timer = setTimeout(stop, options.timeoutMs ?? 120000);
		child.stdout.on("data", data => { stdout += String(data); if (stdout.length > 4_000_000) stop(); });
		child.stderr.on("data", data => { stderr += String(data); if (stderr.length > 4_000_000) stop(); });
		child.on("error", error => { clearTimeout(timer); reject(error); });
		child.on("close", code => { clearTimeout(timer); resolve({ code: stopped ? 124 : code ?? 1, stdout: stdout.slice(-4_000_000), stderr: stderr.slice(-4_000_000) }); });
		child.stdin.on("error", () => {});
		child.stdin.end(options.input ?? "");
	});
	if (options.log) {
		await mkdir(dirname(options.log), { recursive: true, mode: 0o700 });
		await writeFile(options.log, JSON.stringify({ command, args, ...result }), { mode: 0o600 });
	}
	return result;
};
export async function checked(run: RunCommand, command: string, args: string[], options: Parameters<RunCommand>[2]): Promise<string> {
	const result = await run(command, args, options);
	if (result.code !== 0) throw new Error(`${command} failed (${result.code}); ${options.log ? `see ${options.log}` : result.stderr.slice(-600)}`);
	return result.stdout.trim();
}
