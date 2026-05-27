import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { RegisteredCommand } from "../core/extensions/types.js";
import btwExtension from "../extensions/defaults/btw/index.js";
import browserExtension from "../extensions/defaults/browser/index.js";
import debugExtension from "../extensions/defaults/debug/index.js";
import diagnosticsExtension from "../extensions/defaults/diagnostics/index.js";
import grubExtension from "../extensions/defaults/grub/index.js";
import interviewExtension from "../extensions/defaults/interview/index.js";
import loopExtension from "../extensions/defaults/loop/index.js";
import linkWorldExtension from "../extensions/defaults/link-world/index.js";
import mcpExtension from "../extensions/defaults/mcp/index.js";
import exportHtmlExtension from "../extensions/optional/export-html/index.js";
import simplifyExtension from "../extensions/optional/simplify/index.js";
import recapExtension from "../extensions/defaults/recap/index.js";
import salExtension from "../extensions/defaults/sal/index.js";
import securityAuditExtension from "../extensions/defaults/security-audit/index.js";
import subagentExtension from "../extensions/defaults/subagent/index.js";
import teamExtension from "../extensions/defaults/team/index.js";
import tokenSaveExtension from "../extensions/defaults/token-save/index.js";

type CapturedCommand = Omit<RegisteredCommand, "name">;

function createExtensionHarness() {
	const commands = new Map<string, CapturedCommand>();
	const messages: Array<{ content: unknown; display?: boolean }> = [];
	const notifications: string[] = [];
	const statuses: string[] = [];
	const simplePrompts: Array<{ systemPrompt: string; userMessage: string }> = [];
	const api = {
		cwd: process.cwd(),
		agentDir: process.cwd(),
		registerCommand: (name: string, options: CapturedCommand) => commands.set(name, options),
		registerMessageRenderer: () => {},
		registerTool: () => {},
		registerShortcut: () => {},
		registerFlag: () => {},
		getFlag: () => false,
		on: () => {},
		appendEntry: () => {},
		executeCommand: async () => false,
		isIdle: () => true,
		sendMessage: (message: { content: unknown; display?: boolean }) => messages.push(message),
		sendUserMessage: () => {},
		events: { on: () => {}, emit: () => {} },
	};
	const ctx = {
		cwd: process.cwd(),
		hasUI: true,
		sessionManager: { getEntries: () => [] },
		completeSimple: async (systemPrompt: string, userMessage: string) => {
			simplePrompts.push({ systemPrompt, userMessage });
			return "Short answer.";
		},
		ui: {
			notify: (message: string) => notifications.push(message),
			setStatus: (_key: string, text?: string) => statuses.push(text ?? ""),
		},
	};
	return { api, commands, ctx, messages, notifications, statuses, simplePrompts };
}

test("debug command advertises and runs quick preference diagnostics", async () => {
	const previousMemoryDir = process.env.NANOMEM_MEMORY_DIR;
	const memoryDir = mkdtempSync(join(tmpdir(), "nanopencil-debug-prefs-"));
	mkdirSync(memoryDir, { recursive: true });
	process.env.NANOMEM_MEMORY_DIR = memoryDir;

	try {
		const harness = createExtensionHarness();
		await debugExtension(harness.api as never);

		const debug = harness.commands.get("debug");
		assert.ok(debug);
		assert.match(debug.description ?? "", /Check NanoPencil health/);
		assert.deepEqual(debug.getArgumentCompletions?.("pre")?.map((item) => item.value), ["preferences"]);
		assert.match(debug.getArgumentCompletions?.("pre")?.[0]?.description ?? "", /saved preferences/);
		assert.equal(
			debug.getArgumentCompletions?.("pre", {
				commandName: "debug",
				argumentText: "model pre",
				argumentPrefix: "pre",
				tokenIndex: 1,
				previousTokens: ["model"],
			}),
			null,
		);

		await debug.handler("preferences", harness.ctx as never);
		assert.match(String(harness.messages.at(-1)?.content ?? ""), /Preferences/);

		const setLocale = harness.commands.get("set-locale");
		assert.ok(setLocale);
		assert.deepEqual(setLocale.getArgumentCompletions?.("z")?.map((item) => item.value), ["zh"]);
		assert.match(setLocale.getArgumentCompletions?.("z")?.[0]?.description ?? "", /Chinese/);
	} finally {
		if (previousMemoryDir === undefined) {
			delete process.env.NANOMEM_MEMORY_DIR;
		} else {
			process.env.NANOMEM_MEMORY_DIR = previousMemoryDir;
		}
		rmSync(memoryDir, { recursive: true, force: true });
	}
});

test("report-issue command exposes diagnostic scope completions", async () => {
	const harness = createExtensionHarness();
	await diagnosticsExtension(harness.api as never);

	const reportIssue = harness.commands.get("report-issue");
	assert.ok(reportIssue);
	assert.match(reportIssue.description ?? "", /Report recent diagnostics/);
	assert.deepEqual(reportIssue.getArgumentCompletions?.("la")?.map((item) => item.value), ["last"]);
	assert.deepEqual(reportIssue.getArgumentCompletions?.("al")?.map((item) => item.value), ["all"]);
});

test("tokensave command exposes first-argument completions", () => {
	const harness = createExtensionHarness();
	tokenSaveExtension(harness.api as never);

	const tokensave = harness.commands.get("tokensave");
	assert.ok(tokensave);
	assert.match(tokensave.description ?? "", /Review shell output shortening/);
	assert.deepEqual(tokensave.getArgumentCompletions?.("hi")?.map((item) => item.value), ["history"]);
	assert.deepEqual(tokensave.getArgumentCompletions?.("re")?.map((item) => item.value), ["reload"]);
	assert.match(tokensave.getArgumentCompletions?.("pl")?.[0]?.description ?? "", /Preview how a command will be shortened/);
	assert.equal(
		tokensave.getArgumentCompletions?.("hi", {
			commandName: "tokensave",
			argumentText: "plan hi",
			argumentPrefix: "hi",
			tokenIndex: 1,
			previousTokens: ["plan"],
		}),
		null,
	);
});

test("interview, grill, and btw commands use human-readable descriptions", async () => {
	const interviewHarness = createExtensionHarness();
	await interviewExtension(interviewHarness.api as never);

	const interview = interviewHarness.commands.get("interview");
	assert.ok(interview);
	assert.match(interview.description ?? "", /Turn a rough request into clear next steps/);
	assert.doesNotMatch(interview.description ?? "", /ambiguous|inject|refined intent/i);

	const grill = interviewHarness.commands.get("grill-me");
	assert.ok(grill);
	assert.match(grill.description ?? "", /Challenge a plan with focused follow-up questions/);
	assert.doesNotMatch(grill.description ?? "", /stress-test|recommended answers/i);

	const btwHarness = createExtensionHarness();
	await btwExtension(btwHarness.api as never);
	const btw = btwHarness.commands.get("btw");
	assert.ok(btw);
	assert.match(btw.description ?? "", /Ask a quick side question while the main task keeps its place/);
	assert.doesNotMatch(btw.description ?? "", /interrupting/i);

	await btw.handler("what changed?", btwHarness.ctx as never);
	assert.match(btwHarness.simplePrompts[0]?.systemPrompt ?? "", /Keep responses short \(1-3 sentences unless detail is critical\)\./);
	assert.deepEqual(btwHarness.messages.at(-1), { customType: "btw", content: "Short answer.", display: true });
});

test("browser and link-world commands expose readable first-argument completions", () => {
	const browserHarness = createExtensionHarness();
	browserExtension(browserHarness.api as never);
	const browser = browserHarness.commands.get("browser");
	assert.ok(browser);
	assert.deepEqual(browser.getArgumentCompletions?.("sta")?.map((item) => item.value), ["status"]);
	assert.match(browser.getArgumentCompletions?.("sta")?.[0]?.description ?? "", /doctor diagnostics/);
	assert.equal(
		browser.getArgumentCompletions?.("sta", {
			commandName: "browser",
			argumentText: "status sta",
			argumentPrefix: "sta",
			tokenIndex: 1,
			previousTokens: ["status"],
		}),
		null,
	);

	const linkWorldHarness = createExtensionHarness();
	linkWorldExtension(linkWorldHarness.api as never);
	const linkWorld = linkWorldHarness.commands.get("link-world");
	assert.ok(linkWorld);
	assert.deepEqual(linkWorld.getArgumentCompletions?.("doc")?.map((item) => item.value), ["doctor"]);
	assert.match(linkWorld.getArgumentCompletions?.("doc")?.[0]?.description ?? "", /agent-reach doctor/);
	assert.equal(
		linkWorld.getArgumentCompletions?.("doc", {
			commandName: "link-world",
			argumentText: "status doc",
			argumentPrefix: "doc",
			tokenIndex: 1,
			previousTokens: ["status"],
		}),
		null,
	);
});

test("loop command exposes scheduler subcommands and flags", async () => {
	const harness = createExtensionHarness();
	await loopExtension(harness.api as never);

	const loop = harness.commands.get("loop");
	assert.ok(loop);
	assert.deepEqual(loop.getArgumentCompletions?.("sta")?.map((item) => item.value), ["status"]);
	assert.match(loop.getArgumentCompletions?.("sta")?.[0]?.description ?? "", /Show scheduled tasks/);
	assert.deepEqual(loop.getArgumentCompletions?.("--q")?.map((item) => item.value), ["--quiet"]);
	assert.match(loop.getArgumentCompletions?.("--q")?.[0]?.description ?? "", /Hide per-run messages/);
	assert.ok(loop.getArgumentCompletions?.("")?.some((item) => item.value === "every"));
	assert.equal(
		loop.getArgumentCompletions?.("sta", {
			commandName: "loop",
			argumentText: "status sta",
			argumentPrefix: "sta",
			tokenIndex: 1,
			previousTokens: ["status"],
		}),
		null,
	);
	assert.deepEqual(
		loop
			.getArgumentCompletions?.("--q", {
				commandName: "loop",
				argumentText: "Review build every 10m --q",
				argumentPrefix: "--q",
				tokenIndex: 4,
				previousTokens: ["Review", "build", "every", "10m"],
			})
			?.map((item) => item.value),
		["--quiet"],
	);
});

test("grub command exposes readable subcommand and flag completions", async () => {
	const harness = createExtensionHarness();
	await grubExtension(harness.api as never);

	const grub = harness.commands.get("grub");
	assert.ok(grub);
	assert.match(grub.description ?? "", /Keep working/);
	assert.deepEqual(grub.getArgumentCompletions?.("sta")?.map((item) => item.value), ["status"]);
	assert.deepEqual(
		grub
			.getArgumentCompletions?.("--j", {
				commandName: "grub",
				argumentText: "status --j",
				argumentPrefix: "--j",
				tokenIndex: 1,
				previousTokens: ["status"],
			})
			?.map((item) => item.value),
		["--json"],
	);
	assert.deepEqual(
		grub
			.getArgumentCompletions?.("--max", {
				commandName: "grub",
				argumentText: "build command UX --max",
				argumentPrefix: "--max",
				tokenIndex: 3,
				previousTokens: ["build", "command", "UX"],
			})
			?.map((item) => item.value),
		["--max-iter", "--max-fail"],
	);
});

test("security commands expose dashboard actions and log limit completions", () => {
	const harness = createExtensionHarness();
	securityAuditExtension(harness.api as never);

	const security = harness.commands.get("security");
	assert.ok(security);
	assert.match(security.description ?? "", /Review security activity/);
	assert.deepEqual(security.getArgumentCompletions?.("lo")?.map((item) => item.value), ["logs"]);
	assert.deepEqual(security.getArgumentCompletions?.("sta")?.map((item) => item.value), ["stats"]);

	const logs = harness.commands.get("security-logs");
	assert.ok(logs);
	assert.deepEqual(logs.getArgumentCompletions?.("1")?.map((item) => item.value), ["10", "100"]);
});

test("sal commands use readable descriptions and setup hints", async () => {
	const harness = createExtensionHarness();
	await salExtension(harness.api as never);

	const coverage = harness.commands.get("sal:coverage");
	assert.ok(coverage);
	assert.match(coverage.description ?? "", /file map headers/);
	assert.doesNotMatch(coverage.description ?? "", /DIP|P3|prerequisite gating/);
	assert.deepEqual(coverage.getArgumentCompletions?.("ext")?.map((item) => item.value), ["extensions/"]);

	const setup = harness.commands.get("sal:setup");
	assert.ok(setup);
	assert.match(setup.description ?? "", /Connect evaluation records/);
	assert.doesNotMatch(setup.description ?? "", /eval credentials|adapter inferred/);
	assert.deepEqual(setup.getArgumentCompletions?.("fi")?.map((item) => item.value), ["file://"]);
	assert.match(setup.getArgumentCompletions?.("fi")?.[0]?.description ?? "", /local JSONL file/);

	const status = harness.commands.get("sal:status");
	assert.ok(status);
	assert.match(status.description ?? "", /Show whether SAL is active/);
	assert.doesNotMatch(status.description ?? "", /snapshot/);
});

test("optional export and simplify commands expose safe option hints", async () => {
	const exportHarness = createExtensionHarness();
	await exportHtmlExtension(exportHarness.api as never);
	const exportCommand = exportHarness.commands.get("export");
	assert.ok(exportCommand);
	assert.match(exportCommand.description ?? "", /Save this session as a shareable HTML file/);
	assert.deepEqual(exportCommand.getArgumentCompletions?.(".")?.map((item) => item.value), ["./nanopencil-session.html"]);
	assert.match(exportCommand.getArgumentCompletions?.(".")?.[0]?.description ?? "", /Choose the output file/);

	const simplifyHarness = createExtensionHarness();
	simplifyExtension(simplifyHarness.api as never);
	const simplify = simplifyHarness.commands.get("simplify");
	assert.ok(simplify);
	assert.match(simplify.description ?? "", /Suggest smaller code changes/);
	assert.doesNotMatch(simplify.description ?? "", /Claude Code|cognitive load/i);
	assert.deepEqual(simplify.getArgumentCompletions?.("--d")?.map((item) => item.value), ["--dry-run"]);
	assert.match(simplify.getArgumentCompletions?.("--d")?.[0]?.description ?? "", /Preview changes without writing files/);
	assert.equal(
		simplify.getArgumentCompletions?.("--d", {
			commandName: "simplify",
			argumentText: "src/file.ts --d",
			argumentPrefix: "--d",
			tokenIndex: 1,
			previousTokens: ["src/file.ts"],
		}),
		null,
	);
});

test("figma command exposes setup and authentication completions", async () => {
	const harness = createExtensionHarness();
	await mcpExtension(harness.api as never);

	const figma = harness.commands.get("figma");
	assert.ok(figma);
	assert.match(figma.description ?? "", /Connect NanoPencil to Figma/);
	assert.deepEqual(figma.getArgumentCompletions?.("sta")?.map((item) => item.value), ["status"]);
	assert.deepEqual(figma.getArgumentCompletions?.("auth")?.map((item) => item.value), ["auth"]);
	assert.deepEqual(figma.getArgumentCompletions?.("rem")?.map((item) => item.value), ["remote"]);
});

test("recap command exposes free and smart mode completions", async () => {
	const harness = createExtensionHarness();
	await recapExtension(harness.api as never);

	const recap = harness.commands.get("recap");
	assert.ok(recap);
	assert.deepEqual(recap.getArgumentCompletions?.("--s")?.map((item) => item.value), ["--smart"]);
	assert.deepEqual(recap.getArgumentCompletions?.("--f")?.map((item) => item.value), ["--free"]);
});

test("subagent commands expose root actions and write flag completions", async () => {
	const harness = createExtensionHarness();
	await subagentExtension(harness.api as never);

	const subagent = harness.commands.get("subagent");
	assert.ok(subagent);
	assert.match(subagent.description ?? "", /Run or inspect a background helper task/);
	assert.doesNotMatch(subagent.description ?? "", /SubAgent/);
	assert.deepEqual(subagent.getArgumentCompletions?.("sta")?.map((item) => item.value), ["status"]);
	assert.match(subagent.getArgumentCompletions?.("sta")?.[0]?.description ?? "", /current helper task/);

	const run = harness.commands.get("subagent:run");
	assert.ok(run);
	assert.match(run.description ?? "", /Start a background helper task/);
	assert.doesNotMatch(run.description ?? "", /SubAgent/);
	assert.deepEqual(run.getArgumentCompletions?.("--w")?.map((item) => item.value), ["--write"]);
	assert.match(run.getArgumentCompletions?.("--w")?.[0]?.description ?? "", /isolated workspace/);
	assert.equal(
		run.getArgumentCompletions?.("--w", {
			commandName: "subagent:run",
			argumentText: "inspect architecture --w",
			argumentPrefix: "--w",
			tokenIndex: 2,
			previousTokens: ["inspect", "architecture"],
		}),
		null,
	);
	assert.equal(harness.commands.get("subagent:status")?.getArgumentCompletions?.("sta"), null);
});

test("team commands use readable labels in the command palette", async () => {
	const previousAgentDir = process.env.NANOPENCIL_CODING_AGENT_DIR;
	const agentDir = mkdtempSync(join(tmpdir(), "nanopencil-team-commands-"));
	process.env.NANOPENCIL_CODING_AGENT_DIR = agentDir;

	try {
		const harness = createExtensionHarness();
		await teamExtension(harness.api as never);

		const team = harness.commands.get("team");
		assert.ok(team);
		assert.match(team.description ?? "", /Create or manage teammates/);
		assert.doesNotMatch(team.description ?? "", /AgentTeam/);
		assert.match(team.getArgumentCompletions?.("ps")?.[0]?.description ?? "", /decision settings/);

		const progress = harness.commands.get("team:progress");
		assert.ok(progress);
		assert.match(progress.description ?? "", /Show teammate progress/);
		assert.doesNotMatch(progress.description ?? "", /harness/i);

		const terminate = harness.commands.get("team:terminate");
		assert.ok(terminate);
		assert.match(terminate.description ?? "", /Remove a teammate/);
		assert.doesNotMatch(terminate.description ?? "", /Destroy/i);

		const mail = harness.commands.get("team:mail");
		assert.ok(mail);
		assert.match(mail.description ?? "", /Send a note from one teammate to another/);
		assert.doesNotMatch(mail.description ?? "", /mailbox/i);

		const psyche = harness.commands.get("team:psyche");
		assert.ok(psyche);
		assert.match(psyche.description ?? "", /Show teammate decision settings/);
		assert.doesNotMatch(psyche.description ?? "", /psyche/i);
	} finally {
		if (previousAgentDir === undefined) {
			delete process.env.NANOPENCIL_CODING_AGENT_DIR;
		} else {
			process.env.NANOPENCIL_CODING_AGENT_DIR = previousAgentDir;
		}
		rmSync(agentDir, { recursive: true, force: true });
	}
});
