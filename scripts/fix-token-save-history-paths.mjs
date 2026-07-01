#!/usr/bin/env node
/**
 * One-shot repair script for catui token-save history.jsonl records whose
 * rawRecoveryPath points at the legacy project-internal location
 * (`<project>/.catui/token-save/raw/`) after that location was emptied by
 * migrateLegacyTokenSave's rename.
 *
 * Without this repair the agent's footer links for those records hit
 * ENOENT. Fix rewrites every legacy-prefixed rawRecoveryPath to the
 * user-level dataDir (`~/.catui/token-save/projects/<key>/raw/`), then
 * writes history.jsonl back atomically.
 *
 * Usage:
 *   node scripts/fix-token-save-history-paths.mjs [projectRoot]
 *
 * If projectRoot is omitted, defaults to the current working directory.
 * Idempotent: re-running on already-fixed data is a no-op.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const projectRoot = process.argv[2] || process.cwd();
const legacyRawPrefix = join(projectRoot, ".catui", "token-save", "raw");

const tokenSaveDir = join(process.env.HOME || "~", ".catui", "token-save", "projects");
if (!existsSync(tokenSaveDir)) {
	console.error(`token-save projects directory not found: ${tokenSaveDir}`);
	console.error("nothing to repair.");
	process.exit(0);
}

const projectDirs = await readdir(tokenSaveDir);
let totalScanned = 0;
let totalRewritten = 0;
let totalMissing = 0;

for (const projectKey of projectDirs) {
	const historyFile = join(tokenSaveDir, projectKey, "history.jsonl");
	if (!existsSync(historyFile)) continue;

	let text;
	try {
		text = await readFile(historyFile, "utf8");
	} catch {
		continue;
	}
	if (!text) continue;

	const lines = text.split("\n");
	let rewritten = 0;
	let missingInNew = 0;
	const newRawPrefix = join(tokenSaveDir, projectKey, "raw");

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!line) continue;
		let record;
		try {
			record = JSON.parse(line);
		} catch {
			continue;
		}
		totalScanned++;
		const oldPath = record.rawRecoveryPath;
		if (!oldPath || !oldPath.startsWith(legacyRawPrefix)) continue;
		const fileName = oldPath.slice(legacyRawPrefix.length);
		const newPath = newRawPrefix + fileName;
		record.rawRecoveryPath = newPath;
		lines[i] = JSON.stringify(record);
		rewritten++;
		totalRewritten++;
		if (!existsSync(newPath)) {
			missingInNew++;
			totalMissing++;
		}
	}

	if (rewritten > 0) {
		await writeFile(historyFile, lines.join("\n"), "utf8");
		console.log(
			`[${projectKey}] rewrote ${rewritten} record(s); ${missingInNew} now point at files that don't exist in ${newRawPrefix}`,
		);
	}
}

console.log("");
console.log(`Scanned ${totalScanned} history record(s); rewrote ${totalRewritten}; ${totalMissing} now missing.`);
if (totalMissing > 0) {
	console.log("");
	console.log("Some records now point at files that don't exist. The agent still has the filtered output (history.jsonl); only the raw-recovery footer link is broken for those. To investigate:");
console.log(`  ls -la ${legacyRawPrefix}/`);
console.log("Compare filenames to the rewrites logged above to find which records lost their raw file.");
}