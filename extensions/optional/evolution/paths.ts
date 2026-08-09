/**
 * [WHO]: Confined evolution/v1 scope path derivation and canonical workspace hashing
 * [FROM]: Depends on Node crypto, fs, and path primitives
 * [TO]: Consumed by the evolution store and extension entry
 * [HERE]: extensions/optional/evolution/paths.ts - runtime data location authority
 */
import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { EvolutionScope } from "./types.js";

export interface ScopePaths {
	root: string;
	candidatesDir: string;
	revisionsDir: string;
	quarantineDir: string;
	currentPath: string;
	historyPath: string;
	lockPath: string;
}

export async function workspaceKeyForPath(cwd: string): Promise<string> {
	const canonical = await realpath(cwd);
	return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

function confined(base: string, child: string): string {
	const resolved = resolve(base, child);
	const rel = relative(base, resolved);
	if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Evolution path escaped its runtime root");
	return resolved;
}

function safeSessionId(sessionId: string): string {
	if (!/^[A-Za-z0-9._-]{1,160}$/.test(sessionId)) throw new Error("Session id is unsafe for evolution storage");
	return sessionId;
}

export async function resolveScopePaths(
	agentDir: string,
	cwd: string,
	sessionId: string,
	scope: EvolutionScope,
): Promise<ScopePaths> {
	const base = resolve(agentDir, "evolution", "v1");
	const scopeChild = scope === "global"
		? "global"
		: scope === "workspace"
			? join("workspaces", await workspaceKeyForPath(cwd))
			: join("sessions", safeSessionId(sessionId));
	const root = confined(base, scopeChild);
	return {
		root,
		candidatesDir: confined(root, "candidates"),
		revisionsDir: confined(root, "revisions"),
		quarantineDir: confined(root, "quarantine"),
		currentPath: confined(root, "current.json"),
		historyPath: confined(root, "history.jsonl"),
		lockPath: confined(root, ".activation.lock"),
	};
}
