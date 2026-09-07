/**
 * [WHO]: Bounded sanitized observation spool and repeated-failure selection
 * [FROM]: Node filesystem/crypto and local source state contracts
 * [TO]: Extension bridge and independent supervisor
 * [HERE]: extensions/optional/evolution/source/runtime/observer.ts - evidence boundary
 */
import { createHash } from "node:crypto";
import { readdir, unlink, stat } from "node:fs/promises";
import { join } from "node:path";
import { atomicJson, readJson, saveState } from "./state.js";
import type { Observation, SourceConfig, SourceState } from "../types.js";

export const digest = (text: string) => createHash("sha256").update(text).digest("hex");
export function sanitize(text: string): string {
	return text.replace(/-----BEGIN[^\n]*PRIVATE KEY-----[\s\S]*?-----END[^\n]*PRIVATE KEY-----/g, "[secret]")
		.replace(/\b(?:Bearer\s+\S+|(?:sk|ghp|github_pat|npm)[_-][\w-]{10,})/gi, "[secret]")
		.replace(/\b(?:api[_-]?key|password|token|secret|authorization|cookie)\s*[:=]\s*[^\n,;]+/gi, "[credential]")
		.replace(/https?:\/\/\S+/g, "[url]")
		.replace(/(?:\/(?:Users|home|private|tmp)\/|[A-Z]:\\)[^\s"'<>]+/g, "[local-path]")
		.slice(0, 1800);
}
export function fingerprint(tool: string, summary: string): string {
	return digest(`${tool}:${summary.toLowerCase().replace(/\b[0-9a-f]{8,}\b|\d+/g, "#").replace(/\s+/g, " ")}`).slice(0, 24);
}
export async function spool(root: string, observation: Observation): Promise<void> {
	const dir = join(root, "spool");
	let files: string[] = [];
	try { files = await readdir(dir); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
	if (files.length >= 2000) throw new Error("Source observation spool is full");
	await atomicJson(join(dir, `${observation.id}.json`), observation);
}
export async function ingest(root: string, state: SourceState): Promise<void> {
	const dir = join(root, "spool");
	let files: string[];
	try { files = (await readdir(dir)).filter(f => /^[\w-]+\.json$/.test(f)).sort().slice(0, 500); }
	catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return; throw e; }
	const consumed: string[] = [];
	for (const file of files) {
		const path = join(dir, file);
		if ((await stat(path)).size > 16000) { state.dropped++; consumed.push(path); continue; }
		let event: Observation | undefined;
		try { event = await readJson<Observation>(path); } catch { state.dropped++; consumed.push(path); continue; }
		if (!event || typeof event.id !== "string" || typeof event.fingerprint !== "string" || typeof event.summary !== "string" || !["task", "tool", "result", "usage"].includes(event.kind)) { state.dropped++; consumed.push(path); continue; }
		if (!state.seen.includes(event.id)) {
			state.observations.push(event);
			state.seen.push(event.id);
		}
		consumed.push(path);
	}
	state.observations = state.observations.slice(-5000);
	state.seen = state.seen.slice(-10000);
	await saveState(root, state); // Commit cursor before deleting acknowledged events.
	await Promise.all(consumed.map(path => unlink(path).catch(() => {})));
}
export function selectEvidence(state: SourceState, config: SourceConfig): Observation[] | undefined {
	const groups = new Map<string, Observation[]>();
	const previous = new Set(state.jobs.map(j => j.fingerprint));
	const cutoff = Date.now() - 7 * 86400000;
	for (const event of state.observations) {
		if ((!event.failed && !event.inefficient) || previous.has(event.fingerprint) || Date.parse(event.time) < cutoff) continue;
		const group = groups.get(event.fingerprint) ?? [];
		group.push(event); groups.set(event.fingerprint, group);
	}
	const best = [...groups.values()].filter(g => new Set(g.map(e => e.run)).size >= config.minimumFailures).sort((a, b) => b.length - a.length)[0];
	if (!best) return undefined;
	const runs = new Set(best.slice(-10).map(e => e.run));
	const primary = best.slice(-10);
	const ids = new Set(primary.map(e => e.id));
	const evidence = [...primary, ...state.observations.filter(e => runs.has(e.run) && !ids.has(e.id)).slice(-50)];
	while (JSON.stringify(evidence).length > 48000) evidence.pop();
	return evidence;
}
