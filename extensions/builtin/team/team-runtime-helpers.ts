/**
 * [WHO]: Provides TeamRuntime helper functions for prompts, harness turns, live events, tools, labels, roles, and path guards
 * [FROM]: Depends on core tools/sub-agent events, team-harness, team-psyche, team-mailbox, team-types
 * [TO]: Consumed by team-runtime.ts to keep TeamRuntime focused on lifecycle, persistence, and send queues
 * [HERE]: extensions/builtin/team/team-runtime-helpers.ts - stateless runtime support boundary
 */

import { isAbsolute, resolve } from "node:path";
import type { SubAgentEvent } from "../../../core/sub-agent/index.js";
import {
	createBashTool,
	createCodingTools,
	createReadOnlyTools,
	createSandboxHook,
	type Tool,
} from "../../../core/tools/index.js";
import {
	beginHarnessTurn,
	buildHarnessInstructions,
	ensureHarnessFiles,
	prepareContextFiles,
} from "./team-harness.js";
import type { MailboxMessage } from "./team-mailbox.js";
import { buildPsychePrompt, computePsycheWeights, type SoulTraits } from "./team-psyche.js";
import type {
	AgentLiveView,
	PersistedTeammate,
	TeamTask,
	TeammateIdentity,
	TeammateMode,
	TeammateRole,
} from "./team-types.js";
import type { RuntimeTeammate } from "./team-runtime.js";

export function ensureLiveView(view: AgentLiveView | undefined, identity: TeammateIdentity): AgentLiveView {
	return {
		name: identity.name,
		label: identity.label,
		role: identity.role,
		currentTask: view?.currentTask,
		lastUtterance: view?.lastUtterance,
		blockedOn: view?.blockedOn,
		progress: view?.progress,
	};
}

export function getDefaultModeForRole(role: TeammateRole): TeammateMode {
	switch (role) {
		case "pm":
		case "architect":
			return "plan";
		case "designer":
		case "data-analyst":
		case "researcher":
			return "research";
		case "developer":
			return "plan";
		case "reviewer":
		case "verifier":
			return "review";
		case "implementer":
		case "planner":
			return "plan";
		case "generic":
		default:
			return "research";
	}
}

export function buildTeammatePrompt(input: {
	state: PersistedTeammate;
	teammates: PersistedTeammate[];
	tasks: TeamTask[];
	mailboxMessages: MailboxMessage[];
}): string {
	const { state, teammates, tasks, mailboxMessages } = input;
	const lines: string[] = [
		"You are a persistent teammate in an AgentTeam.",
		"",
		"Identity:",
		`  Label: ${state.identity.label}`,
		`  Name: ${state.identity.name}`,
		`  Role: ${state.identity.role}`,
		`  Mode: ${state.mode}`,
		`  Working directory: ${state.cwd}`,
		"",
		"Mode rules:",
		`  - research: read-only exploration and reporting`,
		`  - plan: read-only; produce a plan and wait for leader approval before executing`,
		`  - execute: sandboxed write inside your working directory`,
		`  - review: read-only review and feedback`,
		"",
		"Team roster:",
		...teammates.map((teammate) => `  - ${teammate.identity.name} (${teammate.identity.role})`),
		"",
		"Mention rules:",
		"  - Use @Name mentions only for concrete handoffs.",
		"  - Every mention must include the next-step task after the mention.",
		"  - Do not ping another teammate without actionable work.",
		"",
		"Conversation history with the leader:",
	];

	if (state.messages.length === 0) {
		lines.push("  (none yet)");
	} else {
		for (const msg of state.messages) {
			const prefix = msg.direction === "leader" ? "pencil" : state.identity.name;
			lines.push(`${prefix}: ${msg.content}`);
		}
	}

	const ownedTasks = tasks.filter((task) => task.ownerId === state.identity.id);
	const blockedTasks = tasks.filter((task) => task.status === "blocked");
	const openTasks = tasks.filter((task) => task.status === "open").slice(0, 8);
	lines.push("", "Shared team tasks:");
	if (ownedTasks.length === 0 && blockedTasks.length === 0 && openTasks.length === 0) {
		lines.push("  (none)");
	} else {
		if (ownedTasks.length > 0) {
			lines.push("  Claimed by you:");
			for (const task of ownedTasks) {
				lines.push(`    ${formatTaskForPrompt(task)}`);
			}
		}
		if (blockedTasks.length > 0) {
			lines.push("  Blocked:");
			for (const task of blockedTasks.slice(0, 6)) {
				lines.push(`    ${formatTaskForPrompt(task)}`);
			}
		}
		if (openTasks.length > 0) {
			lines.push("  Open:");
			for (const task of openTasks) {
				lines.push(`    ${formatTaskForPrompt(task)}`);
			}
		}
	}

	lines.push("", "Recent team mailbox:");
	if (mailboxMessages.length === 0) {
		lines.push("  (none)");
	} else {
		for (const message of mailboxMessages) {
			const from = message.teammateName;
			const to = message.targetTeammateName ? ` -> ${message.targetTeammateName}` : "";
			const content =
				typeof message.payload.content === "string"
					? message.payload.content
					: typeof message.payload.action === "string"
						? `${message.payload.action}`
						: JSON.stringify(message.payload);
			lines.push(`  [${message.type}] ${from}${to}: ${content}`);
		}
	}

	lines.push("", "Respond to the leader's last message in your current mode.");
	return lines.join("\n");
}

export async function prepareHarnessTurn(input: {
	teammate: RuntimeTeammate;
	taskDescription: string;
	soulManager: unknown;
}): Promise<
	| {
			psychePrompt: string;
			harnessInstructions: string;
			contextFiles: string[];
	  }
	| undefined
> {
	const { teammate, taskDescription, soulManager } = input;
	const harness = teammate.state.harness;
	if (!harness?.enabled) return undefined;

	await ensureHarnessFiles(harness, teammate.state.cwd, taskDescription);
	teammate.state.harness = await beginHarnessTurn(harness, teammate.state.cwd);
	const soulTraits = await getSoulTraits(soulManager);
	const weights = computePsycheWeights(
		teammate.state.harness.phase,
		teammate.state.identity.role,
		soulTraits,
		teammate.state.psycheOverrides,
	);
	teammate.state.psyche = weights;
	const psychePrompt = buildPsychePrompt(weights, teammate.state.harness.phase, teammate.state);
	const harnessInstructions = await buildHarnessInstructions(teammate.state.harness, teammate.state.cwd, taskDescription);
	return {
		psychePrompt,
		harnessInstructions,
		contextFiles: prepareContextFiles(teammate.state.harness),
	};
}

async function getSoulTraits(soulManager: unknown): Promise<SoulTraits | undefined> {
	const manager = soulManager as
		| {
				getProfile?: () => unknown | Promise<unknown>;
		  }
		| undefined;
	if (!manager?.getProfile) return undefined;

	try {
		const profile = (await manager.getProfile()) as { personality?: SoulTraits } | undefined;
		return profile?.personality;
	} catch {
		return undefined;
	}
}

export function applyLiveEvent(teammate: RuntimeTeammate, event: SubAgentEvent): void {
	const previous = teammate.state.live;
	const liveView = ensureLiveView(teammate.state.liveView, teammate.state.identity);
	switch (event.type) {
		case "agent_start":
			teammate.state.live = {
				phase: "starting",
				preview: "Sub-agent starting...",
				toolName: null,
				updatedAt: event.timestamp,
			};
			teammate.state.liveView = { ...liveView, progress: "starting" };
			break;
		case "message_update":
			teammate.state.live = {
				phase: event.text ? "thinking" : (previous?.phase ?? "thinking"),
				preview: tailText(event.text || previous?.preview || "", 1200),
				toolName: previous?.toolName ?? null,
				updatedAt: event.timestamp,
			};
			teammate.state.liveView = {
				...liveView,
				lastUtterance: tailText(singleLine(event.text || previous?.preview || ""), 200),
				progress: "thinking",
			};
			break;
		case "message_end":
			teammate.state.live = {
				phase: "finishing",
				preview: tailText(event.text || previous?.preview || "", 1200),
				toolName: previous?.toolName ?? null,
				updatedAt: event.timestamp,
			};
			teammate.state.liveView = {
				...liveView,
				lastUtterance: tailText(singleLine(event.text || previous?.preview || ""), 200),
				progress: "finishing",
			};
			break;
		case "tool_start":
		case "tool_update":
		case "tool_end":
			teammate.state.live = {
				phase: "tool",
				preview:
					event.type === "tool_update"
						? tailText(String(event.partialResult ?? previous?.preview ?? ""), 1200)
						: previous?.preview ?? "",
				toolName: event.toolName,
				updatedAt: event.timestamp,
			};
			teammate.state.liveView = { ...liveView, progress: `tool:${event.toolName}` };
			break;
		case "agent_end":
			teammate.state.live = {
				phase: event.success ? "done" : "error",
				preview: event.error ?? previous?.preview ?? "",
				toolName: null,
				updatedAt: event.timestamp,
			};
			teammate.state.liveView = { ...liveView, progress: event.success ? "done" : "error" };
			break;
	}
}

export function selectToolsForMode(input: {
	mode: TeammateMode;
	cwd: string;
	getAllTeammates: () => PersistedTeammate[];
	isPathAllowed: (teammateId: string, absolutePath: string) => boolean;
}): Tool[] {
	switch (input.mode) {
		case "research":
		case "review":
		case "plan":
			return createReadOnlyToolsForCwd(input.cwd);
		case "execute":
			return createSandboxedTools(input);
		default:
			return createReadOnlyToolsForCwd(input.cwd);
	}
}

function createReadOnlyToolsForCwd(cwd: string): Tool[] {
	const baseTools = createReadOnlyTools(cwd);
	const sandboxBash = createBashTool(cwd, {
		spawnHook: createSandboxHook(),
	});
	return [...baseTools.filter((tool) => tool.name !== "bash"), sandboxBash];
}

function createSandboxedTools(input: {
	cwd: string;
	getAllTeammates: () => PersistedTeammate[];
	isPathAllowed: (teammateId: string, absolutePath: string) => boolean;
}): Tool[] {
	const guard = createWritePathGuard(input);
	const baseTools = createCodingTools(input.cwd, {
		edit: { beforeWrite: guard },
		write: { beforeWrite: guard },
	});
	const sandboxBash = createBashTool(input.cwd, {
		spawnHook: createSandboxHook({
			allowWritePath: (path) => {
				try {
					guard(path);
					return true;
				} catch {
					return false;
				}
			},
			blockedMessage: "Write operations outside the teammate workspace are not allowed. Use /team:allow-path to grant a path prefix.",
		}),
	});
	return [...baseTools.filter((tool) => tool.name !== "bash"), sandboxBash];
}

export function createWritePathGuard(input: {
	cwd: string;
	getAllTeammates: () => PersistedTeammate[];
	isPathAllowed: (teammateId: string, absolutePath: string) => boolean;
}): (absolutePath: string) => void {
	const workspaceRoot = normalizePath(input.cwd);
	return (absolutePath: string) => {
		const target = normalizePath(absolutePath);
		const teammate = input.getAllTeammates().find((candidate) => normalizePath(candidate.cwd) === workspaceRoot);
		if (isWithinPath(target, workspaceRoot)) return;
		if (teammate && input.isPathAllowed(teammate.identity.id, target)) return;
		throw new Error(
			`Write denied for ${target}. Team execute mode may only write inside ${workspaceRoot} unless the leader grants a path allowlist.`,
		);
	};
}

export function normalizePath(path: string): string {
	return resolve(isAbsolute(path) ? path : path);
}

export function isWithinPath(target: string, root: string): boolean {
	const normalizedRoot = normalizeForComparison(root);
	const normalizedTarget = normalizeForComparison(target);
	return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}/`);
}

function formatTaskForPrompt(task: TeamTask): string {
	const owner = task.ownerName ? ` owner:${task.ownerName}` : "";
	const deps = task.dependsOn.length ? ` deps:${task.dependsOn.join(",")}` : "";
	const artifacts = task.artifactPaths.length ? ` artifacts:${task.artifactPaths.join(",")}` : "";
	const detail = task.description ? ` - ${task.description}` : "";
	return `${task.id} [${task.status}]${owner}${deps}${artifacts} ${task.title}${detail}`;
}

export function summarizeTask(value: string): string {
	return tailText(singleLine(value), 160);
}

export function singleLine(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

export function tailText(value: string, maxLength: number): string {
	if (value.length <= maxLength) return value;
	return value.slice(value.length - maxLength);
}

export function labelFromIndex(index: number): string {
	let current = index;
	let label = "";
	while (current > 0) {
		current--;
		label = String.fromCharCode(65 + (current % 26)) + label;
		current = Math.floor(current / 26);
	}
	return label || "A";
}

export function indexFromLabel(label: string): number {
	let result = 0;
	for (const char of label.toUpperCase()) {
		const code = char.charCodeAt(0);
		if (code < 65 || code > 90) return 0;
		result = result * 26 + (code - 64);
	}
	return result;
}

export function isBuilderRole(role: TeammateRole): boolean {
	return role === "implementer" || role === "developer";
}

function normalizeForComparison(value: string): string {
	return normalizePath(value).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}
