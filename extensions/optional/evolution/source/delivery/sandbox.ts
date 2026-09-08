/**
 * [WHO]: OS-confined offline verification runner with credential-free environment
 * [FROM]: Node platform/filesystem and local command contract
 * [TO]: Candidate, merged-release and installation verifiers
 * [HERE]: extensions/optional/evolution/source/delivery/sandbox.ts - generated-code execution boundary
 */
import { existsSync } from "node:fs";
import { mkdir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import type { RunCommand } from "../types.js";

export function verificationEnvironment(temp: string): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {
		PATH: process.env.PATH, HOME: temp, TMPDIR: temp, TMP: temp, TEMP: temp,
		LANG: process.env.LANG ?? "en_US.UTF-8", CI: "true", CATUI_EVOLUTION_WORKER: "1", CATUI_EVOLUTION_VERIFY: "1",
		NPM_CONFIG_USERCONFIG: join(temp, "npmrc"), NPM_CONFIG_CACHE: join(temp, "npm-cache"),
	};
	return env;
}
export function sandboxCommand(command: string, args: string[], cwd: string, temp: string, platform = process.platform, readOnly: string[] = []): { command: string; args: string[] } {
	if (platform === "darwin") {
		const literal = (s: string) => JSON.stringify(resolve(s));
		const hidden = [".ssh", ".aws", ".npmrc", ".git-credentials", "Library/Keychains", ".catui/agents/default/auth.json"].map(p => `(subpath ${literal(join(homedir(), p))})`).join(" ");
		const profile = `(version 1)(deny default)(allow process-exec)(allow process-fork)(allow signal (target self) (target same-sandbox))(allow sysctl-read)(allow mach-lookup)(allow file-read*)(deny file-read* ${hidden})(deny file-read* (require-all (subpath ${literal(join(homedir(), ".catui"))}) (require-not (subpath ${literal(cwd)}))))(allow file-write* (subpath ${literal(cwd)}) (subpath ${literal(temp)}) (literal "/dev/null"))(deny file-write* (subpath ${literal(join(cwd, ".git"))}))`;
		const frozen = readOnly.map(path => `(deny file-write* (literal ${literal(join(cwd, path))}))`).join("");
		return { command: "/usr/bin/sandbox-exec", args: ["-p", profile + frozen, command, ...args] };
	}
	if (platform === "linux") {
		const binds: string[] = [];
		for (const p of [".ssh", ".aws", ".npmrc", ".git-credentials", ".catui"]) {
			const path = join(homedir(), p);
			if (existsSync(path)) binds.push(...(p.endsWith("rc") || p === ".git-credentials" ? ["--ro-bind", "/dev/null", path] : ["--tmpfs", path]));
		}
		const frozen = readOnly.flatMap(path => ["--ro-bind", join(cwd, path), join(cwd, path)]);
		return { command: "bwrap", args: ["--die-with-parent", "--unshare-net", "--unshare-pid", "--ro-bind", "/", "/", ...binds, "--bind", cwd, cwd, "--bind", temp, temp, "--ro-bind", join(cwd, ".git"), join(cwd, ".git"), ...frozen, "--dev", "/dev", "--proc", "/proc", "--chdir", cwd, "--", command, ...args] };
	}
	throw new Error("Autonomous verification requires macOS sandbox-exec or Linux bubblewrap");
}
export function verificationRunner(run: RunCommand, readOnly: string[] = []): RunCommand {
	return async (command, args, options) => {
		const temp = join(tmpdir(), "catui-evolution-verify", String(process.pid));
		await mkdir(temp, { recursive: true, mode: 0o700 });
		const confined = sandboxCommand(command, args, await realpath(options.cwd), await realpath(temp), process.platform, readOnly);
		return run(confined.command, confined.args, { ...options, env: verificationEnvironment(temp) });
	};
}
