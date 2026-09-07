/**
 * [WHO]: Detached supervisor startup and launchd/systemd user service installation
 * [FROM]: Node subprocess/fs/os APIs and local command discovery
 * [TO]: Source evolution CLI and foreground bridge
 * [HERE]: extensions/optional/evolution/source/runtime/service.ts - process lifecycle adapter
 */
import { spawn } from "node:child_process";
import { mkdir, open, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import lockfile from "proper-lockfile";
import { catuiCommand, checked, runCommand } from "./process.js";
import { digest } from "./observer.js";

export async function startDaemon(root: string): Promise<void> {
	await mkdir(root, { recursive: true, mode: 0o700 });
	if (await lockfile.check(root, { stale: 30000 })) return;
	const log = await open(join(root, "supervisor.log"), "a", 0o600);
	try {
		const child = spawn(process.execPath, [...catuiCommand(), "evolve", "daemon", "--root", root], { detached: true, stdio: ["ignore", log.fd, log.fd], env: { ...process.env, CATUI_EVOLUTION_WORKER: "1" } });
		await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
		child.unref();
	} finally { await log.close(); }
}
const xml = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
export async function installService(root: string): Promise<string> {
	const id = `dev.catui.evolution.${digest(root).slice(0, 12)}`;
	const command = [process.execPath, ...catuiCommand(), "evolve", "daemon", "--root", root];
	if (process.platform === "darwin") {
		const dir = join(homedir(), "Library", "LaunchAgents"); await mkdir(dir, { recursive: true });
		const path = join(dir, `${id}.plist`);
		await writeFile(path, `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${id}</string><key>ProgramArguments</key><array>${command.map(x => `<string>${xml(x)}</string>`).join("")}</array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>60</integer><key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(process.env.PATH ?? "/usr/bin:/bin")}</string><key>CATUI_EVOLUTION_WORKER</key><string>1</string></dict><key>StandardOutPath</key><string>${xml(join(root, "supervisor.log"))}</string><key>StandardErrorPath</key><string>${xml(join(root, "supervisor.log"))}</string></dict></plist>`, { mode: 0o600 });
		await checked(runCommand, "launchctl", ["bootstrap", `gui/${process.getuid!()}`, path], { cwd: root });
		return path;
	}
	if (process.platform === "linux") {
		const dir = join(homedir(), ".config", "systemd", "user"); await mkdir(dir, { recursive: true });
		const path = join(dir, `${id}.service`);
		const quote = (s: string) => '"' + s.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%") + '"';
		await writeFile(path, `[Unit]\nDescription=Catui source evolution\n[Service]\nExecStart=${command.map(quote).join(" ")}\nEnvironment=CATUI_EVOLUTION_WORKER=1\nEnvironment=${quote(`PATH=${process.env.PATH ?? "/usr/bin:/bin"}`)}\nRestart=always\nRestartSec=60\n[Install]\nWantedBy=default.target\n`, { mode: 0o600 });
		await checked(runCommand, "systemctl", ["--user", "daemon-reload"], { cwd: root });
		await checked(runCommand, "systemctl", ["--user", "enable", "--now", `${id}.service`], { cwd: root });
		return path;
	}
	throw new Error("Persistent source evolution services support macOS and Linux; use evolve daemon under your service manager");
}
