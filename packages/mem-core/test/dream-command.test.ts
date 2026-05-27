import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import nanomemExtension from "../src/extension.js";
import { NanoMemEngine } from "../src/engine.js";
import type { Episode } from "../src/types.js";

type CommandHandler = (args: string, ctx: Record<string, unknown>) => Promise<void> | void;
type CommandRegistration = {
	description?: string;
	getArgumentCompletions?: (argumentPrefix: string) => Array<{ value: string; label: string; description?: string }> | null;
	handler: CommandHandler;
};

async function seedEpisodes(memoryDir: string): Promise<void> {
	const engine = new NanoMemEngine({ memoryDir });
	const episodes: Episode[] = Array.from({ length: 10 }, (_, index) => ({
		sessionId: `dream-command-${index}`,
		project: "dream-command",
		date: `2026-01-${String(index + 1).padStart(2, "0")}`,
		summary: `Reviewed dream command behavior ${index}`,
		userGoal: "Make dream command status readable",
		filesModified: ["packages/mem-core/src/extension.ts"],
		toolsUsed: {},
		keyObservations: ["manual dream should expose running state"],
		errors: index % 2 === 0 ? ["dream status was unclear"] : [],
		tags: ["dream", "command"],
		importance: 8,
		consolidated: false,
	}));
	for (const episode of episodes) {
		await engine.saveEpisode(episode);
	}
}

function createHarness() {
	const commands = new Map<string, CommandRegistration>();
	const events = new Map<string, unknown[]>();
	const notifications: Array<{ message: string; type?: string }> = [];
	const statuses: string[] = [];
	const api = {
		cwd: process.cwd(),
		agentDir: process.cwd(),
		registerCommand: (name: string, options: CommandRegistration) => {
			commands.set(name, options);
		},
		registerMessageRenderer: () => {},
		registerTool: () => {},
		on: (event: string, handler: unknown) => {
			const list = events.get(event) ?? [];
			list.push(handler);
			events.set(event, list);
		},
		sendMessage: () => {},
		appendEntry: () => {},
		events: { on: () => {}, emit: () => {} },
	};
	const ctx = {
		cwd: process.cwd(),
		hasUI: true,
		getSettings: () => ({}),
		ui: {
			notify: (message: string, type?: string) => notifications.push({ message, type }),
			setStatus: (_key: string, text?: string) => statuses.push(text ?? ""),
		},
	};
	return { api, commands, ctx, notifications, statuses };
}

test("dream command exposes manual run status and stop path", async () => {
	const previousMemoryDir = process.env.NANOMEM_MEMORY_DIR;
	const memoryDir = await mkdtemp(join(tmpdir(), "nanomem-dream-command-"));
	process.env.NANOMEM_MEMORY_DIR = memoryDir;

	try {
		await seedEpisodes(memoryDir);
		const harness = createHarness();
		let releaseLlm: ((value: string) => void) | undefined;
		const llmStarted = new Promise<void>((resolve) => {
			harness.ctx.completeSimple = async () => {
				resolve();
				return new Promise<string>((done) => {
					releaseLlm = done;
				});
			};
		});

		nanomemExtension(harness.api as never);
		const dreamCommand = harness.commands.get("dream");
		assert.ok(dreamCommand);
		assert.match(dreamCommand.description ?? "", /Refresh long-term NanoMem memories/);
		assert.deepEqual(dreamCommand.getArgumentCompletions?.("st")?.map((item) => item.value), ["status", "stop"]);
		const dream = dreamCommand.handler;
		assert.ok(dream);

		await dream("unknown", harness.ctx);
		assert.equal(harness.notifications.at(-1)?.message, "Usage: /dream [run|status|stop]");

		const run = Promise.resolve(dream("", harness.ctx));
		await llmStarted;

		await dream("status", harness.ctx);
		const statusMessage = harness.notifications.at(-1)?.message ?? "";
		assert.match(statusMessage, /Memory refresh: running/);
		assert.match(statusMessage, /Mode: manual/);
		assert.match(statusMessage, /Stop: \/dream stop/);

		await dream("stop", harness.ctx);
		releaseLlm?.('[]');
		await run;

		assert.ok(harness.statuses.some((status) => status.includes("Memory refresh: running")));
		assert.ok(harness.statuses.some((status) => status.includes("Memory refresh: stopped")));
		assert.ok(harness.notifications.some((entry) => entry.message.includes("Memory refresh stopped")));
	} finally {
		if (previousMemoryDir === undefined) {
			delete process.env.NANOMEM_MEMORY_DIR;
		} else {
			process.env.NANOMEM_MEMORY_DIR = previousMemoryDir;
		}
		await rm(memoryDir, { recursive: true, force: true });
	}
});
