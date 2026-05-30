#!/usr/bin/env tsx
/**
 * [WHO]: Provides offline Free recap evaluation CLI — reads a session .jsonl, runs extractFreeRecap, prints structured + formatted output
 * [FROM]: Depends on extensions/builtin/recap/recap-extractor for the pure extraction logic, node:fs for jsonl reading
 * [TO]: Invoked manually by maintainers to sanity-check Free quality against real sessions before promoting to default
 * [HERE]: scripts/eval-recap.ts - quality calibration tool for the recap Free path
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { extractFreeRecap, formatFreeRecap, walkSessionActivity } from "../extensions/builtin/recap/recap-extractor.js";
import type { SessionEntry } from "../core/session/session-manager.js";

function readSessionEntries(path: string): SessionEntry[] {
	const raw = readFileSync(path, "utf-8");
	const entries: SessionEntry[] = [];
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(trimmed);
		} catch (err) {
			process.stderr.write(`skipping unparseable line: ${(err as Error).message}\n`);
			continue;
		}
		// Session header is `{ type: "session", ... }` — drop it.
		if (typeof parsed === "object" && parsed !== null && (parsed as { type?: unknown }).type === "session") {
			continue;
		}
		entries.push(parsed as SessionEntry);
	}
	return entries;
}

function main(): void {
	const file = process.argv[2];
	if (!file) {
		process.stderr.write("usage: tsx scripts/eval-recap.ts <session.jsonl>\n");
		process.exit(2);
	}
	const path = resolve(file);
	const entries = readSessionEntries(path);
	const activity = walkSessionActivity(entries);
	const recap = extractFreeRecap(entries);

	process.stdout.write(`session: ${path}\n`);
	process.stdout.write(`entries: ${entries.length}\n`);
	process.stdout.write(`user messages: ${activity.userTexts.length}\n`);
	process.stdout.write(`tool calls: ${activity.tools.length}\n`);
	process.stdout.write(`file touches: ${activity.files.length}\n`);
	process.stdout.write("\n--- Free Recap (deterministic, zero-LLM) ---\n");
	process.stdout.write(`${formatFreeRecap(recap)}\n`);
	process.stdout.write("\n--- Structured ---\n");
	process.stdout.write(`${JSON.stringify(recap, null, 2)}\n`);
}

main();
