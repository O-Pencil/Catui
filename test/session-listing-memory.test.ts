/**
 * [WHO]: SessionManager.listAll() bounded search-index regression coverage
 * [FROM]: Depends on core/session/session-manager.ts and temporary JSONL fixtures
 * [TO]: None (test-only)
 * [HERE]: test/session-listing-memory.test.ts - prevents session history scans from retaining unbounded message text
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionManager } from "../core/session/session-manager.js";

const MAX_SEARCH_TEXT_CHARS = 8 * 1024;

test("session listing keeps a bounded head-and-tail search index for large histories", async () => {
	const agentDir = mkdtempSync(join(tmpdir(), "catui-session-listing-"));
	const projectDir = join(agentDir, "sessions", "project");
	mkdirSync(projectDir, { recursive: true });

	const timestamp = "2026-08-09T00:00:00.000Z";
	const sessionFile = join(projectDir, "large.jsonl");
	const lines = [
		{
			type: "session",
			version: 3,
			id: "large-session",
			timestamp,
			cwd: "/workspace",
		},
		{
			type: "session_info",
			id: "large-session-name",
			parentId: null,
			timestamp,
			name: "Large regression fixture",
		},
		{
			type: "message",
			id: "early-message",
			parentId: null,
			timestamp,
			message: {
				role: "user",
				content: `EARLY_SENTINEL ${"a".repeat(12_000)}`,
				timestamp: Date.parse(timestamp),
			},
		},
		{
			type: "message",
			id: "late-message",
			parentId: "early-message",
			timestamp: "2026-08-09T00:01:00.000Z",
			message: {
				role: "assistant",
				content: `${"b".repeat(12_000)} LATE_SENTINEL`,
				timestamp: Date.parse("2026-08-09T00:01:00.000Z"),
			},
		},
	];
	writeFileSync(sessionFile, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf8");
	for (let index = 0; index < 31; index++) {
		const id = `small-session-${index}`;
		const smallLines = [
			{ type: "session", version: 3, id, timestamp, cwd: "/workspace" },
			{
				type: "message",
				id: `${id}-message`,
				parentId: null,
				timestamp,
				message: { role: "user", content: `small fixture ${index}`, timestamp: Date.parse(timestamp) },
			},
		];
		writeFileSync(
			join(projectDir, `${id}.jsonl`),
			`${smallLines.map((line) => JSON.stringify(line)).join("\n")}\n`,
			"utf8",
		);
	}

	try {
		const sessions = await SessionManager.listAll(undefined, {
			id: "test",
			path: agentDir,
		});

		assert.equal(sessions.length, 32);
		const session = sessions.find((candidate) => candidate.id === "large-session");
		assert.ok(session);
		assert.equal(session.name, "Large regression fixture");
		assert.equal(session.messageCount, 2);
		assert.equal(session.modified.toISOString(), "2026-08-09T00:01:00.000Z");
		assert.match(session.firstMessage, /EARLY_SENTINEL/);
		assert.match(session.allMessagesText, /EARLY_SENTINEL/);
		assert.match(session.allMessagesText, /LATE_SENTINEL/);
		assert.ok(
			session.allMessagesText.length <= MAX_SEARCH_TEXT_CHARS,
			`search index retained ${session.allMessagesText.length} characters`,
		);
	} finally {
		rmSync(agentDir, { recursive: true, force: true });
	}
});
