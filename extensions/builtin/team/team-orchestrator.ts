/**
 * [WHO]: Provides createTeamUtterance(), buildLeaderPlan(), parseTeamMentions(), runLeaderOrchestration()
 * [FROM]: Depends on ./team-types, ./team-presets, ./team-runtime
 * [TO]: Consumed by index.ts for structured speaker-stream rendering and leader-led team orchestration
 * [HERE]: extensions/builtin/team/team-orchestrator.ts - leader planning, mention parsing, and handoff execution
 */

import type { Model } from "@pencil-agent/ai";
import { executePreset, selectAutoTeamPlan } from "./team-presets.js";
import type { TeamRuntime, TeamRuntimeEvent } from "./team-runtime.js";
import type {
	Handoff,
	LeaderPlan,
	LeaderSubtask,
	PersistedTeammate,
	TeamMention,
	TeamSpeakerRole,
	TeamUtterance,
} from "./team-types.js";

export interface TeamStreamEmitter {
	emitUtterance(utterance: TeamUtterance, options?: { streamKey?: string; replace?: boolean }): void;
}

export interface LeaderOrchestrationOptions extends TeamStreamEmitter {
	taskDescription: string;
	baseCwd: string;
	model?: Model<any>;
	onRuntimeEvent?: (event: TeamRuntimeEvent) => void;
	completeSimple?: (systemPrompt: string, userMessage: string) => Promise<string | undefined>;
}

export interface LeaderOrchestrationResult {
	plan: LeaderPlan;
	handoffs: Handoff[];
}

interface PendingAssignment {
	target: PersistedTeammate;
	task: string;
	title: string;
	kind: "work" | "handoff";
	sourceLabel?: string;
	sourceExcerpt?: string;
	subtaskId?: string;
}

const LEADER_ID = "leader";
const LEADER_LABEL = "pencil";

export function createTeamUtterance(input: {
	speakerId: string;
	speakerLabel: string;
	role: TeamSpeakerRole;
	text: string;
	kind: TeamUtterance["kind"];
	mentions?: TeamMention[];
	timestamp?: number;
}): TeamUtterance {
	return {
		id: crypto.randomUUID(),
		speakerId: input.speakerId,
		speakerLabel: input.speakerLabel,
		role: input.role,
		text: input.text.trim(),
		kind: input.kind,
		mentions: input.mentions ?? [],
		timestamp: input.timestamp ?? Date.now(),
	};
}

export function formatUtteranceForContext(utterance: TeamUtterance): string {
	return `${utterance.speakerLabel}: ${utterance.text}`;
}

export function parseTeamMentions(text: string, teammates: PersistedTeammate[]): TeamMention[] {
	const mentions: TeamMention[] = [];
	const regex = /(^|\s)@([A-Za-z][A-Za-z0-9-]*)/g;
	for (const match of text.matchAll(regex)) {
		const raw = match[2];
		if (!raw) continue;
		const target = resolveMentionTarget(raw, teammates);
		if (!target) continue;

		const mentionStart = (match.index ?? 0) + match[1].length;
		const contentStart = mentionStart + raw.length + 1;
		const task = extractMentionTask(text, contentStart);
		if (!task) continue;

		mentions.push({
			raw: `@${raw}`,
			targetId: target.identity.id,
			targetName: target.identity.name,
			targetLabel: target.identity.label,
			task,
		});
	}
	return dedupeMentions(mentions);
}

export async function buildLeaderPlan(
	userGoal: string,
	teammates: PersistedTeammate[],
	completeSimple?: (systemPrompt: string, userMessage: string) => Promise<string | undefined>,
): Promise<LeaderPlan> {
	const modelPlan = completeSimple ? await buildLeaderPlanWithModel(userGoal, teammates, completeSimple) : undefined;
	if (modelPlan) return modelPlan;
	return buildLeaderPlanHeuristic(userGoal, teammates);
}

export async function runLeaderOrchestration(
	runtime: TeamRuntime,
	options: LeaderOrchestrationOptions,
): Promise<LeaderOrchestrationResult> {
	const autoPlan = await selectAutoTeamPlan(options.taskDescription, options.completeSimple);
	const presetResult = await executePreset(
		runtime,
		autoPlan.presetName,
		options.taskDescription,
		options.baseCwd,
		options.model,
		options.onRuntimeEvent,
		false,
	);

	const teammates = presetResult.teammates;
	const leaderPlan = await buildLeaderPlan(options.taskDescription, teammates, options.completeSimple);
	const handoffs: Handoff[] = [];
	const queuedAssignments: PendingAssignment[] = [];
	const seenAssignmentKeys = new Set<string>();
	const teammateById = new Map(teammates.map((teammate) => [teammate.identity.id, teammate] as const));
	const planName = buildResearchPlanName(options.taskDescription);

	options.emitUtterance(
		createTeamUtterance({
			speakerId: LEADER_ID,
			speakerLabel: LEADER_LABEL,
			role: "leader",
			kind: "thought",
			text: formatLeaderPlanAnnouncement(leaderPlan),
		}),
	);
	options.emitUtterance(
		createTeamUtterance({
			speakerId: LEADER_ID,
			speakerLabel: LEADER_LABEL,
			role: "leader",
			kind: "thought",
			text: `A research plan named ${planName} has already been created. If you would like to make any changes to this plan, please provide your input directly in the chat box.`,
		}),
	);

	leaderPlan.phase = "assign";
	leaderPlan.completionState = "running";

	const enqueue = (assignment: PendingAssignment): void => {
		const key = `${assignment.target.identity.id}:${singleLine(assignment.task).toLowerCase()}`;
		if (seenAssignmentKeys.has(key)) return;
		seenAssignmentKeys.add(key);
		queuedAssignments.push(assignment);
	};

	for (const subtask of leaderPlan.subtasks.filter((candidate) => candidate.dependsOn.length === 0)) {
		const target = teammateById.get(subtask.ownerId);
		if (!target) continue;
		enqueue({
			target,
			task: subtask.task,
			title: subtask.title,
			kind: "work",
			subtaskId: subtask.id,
		});
	}

	let turns = 0;
	const maxTurns = Math.max(6, teammates.length * 4);

	const runAssignment = async (assignment: PendingAssignment) => {
		const subtask = assignment.subtaskId ? leaderPlan.subtasks.find((item) => item.id === assignment.subtaskId) : undefined;
		if (subtask) subtask.status = "in_progress";

		options.emitUtterance(
			createTeamUtterance({
				speakerId: LEADER_ID,
				speakerLabel: LEADER_LABEL,
				role: "leader",
				kind: assignment.kind,
				text: formatLeaderAssignment(assignment),
				mentions: [
					{
						raw: `@${assignment.target.identity.name}`,
						targetId: assignment.target.identity.id,
						targetName: assignment.target.identity.name,
						targetLabel: assignment.target.identity.label,
						task: assignment.task,
					},
				],
			}),
		);

		const sendResult = await runtime.send(
			assignment.target.identity.name,
			buildAssignmentPrompt(options.taskDescription, assignment, leaderPlan, teammates),
			options.model,
			{ onEvent: options.onRuntimeEvent },
		);
		const replyText = sendResult.response || sendResult.error || "No response.";
		const mentions = parseTeamMentions(replyText, teammates);
		options.emitUtterance(
			createTeamUtterance({
				speakerId: assignment.target.identity.id,
				speakerLabel: assignment.target.identity.name,
				role: assignment.target.identity.role,
				kind: mentions.length > 0 ? "handoff" : sendResult.success ? "result" : "work",
				text: replyText,
				mentions,
			}),
			{ streamKey: `team-stream:${assignment.target.identity.id}`, replace: true },
		);

		if (subtask) {
			subtask.status = sendResult.success ? "done" : "blocked";
		}

		return {
			assignment,
			subtask,
			sendResult,
			replyText,
			mentions,
		};
	};

	while (queuedAssignments.length > 0 && turns < maxTurns) {
		const batchSize = Math.min(queuedAssignments.length, maxTurns - turns);
		const batch = queuedAssignments.splice(0, batchSize);
		turns += batch.length;
		const results = await Promise.all(batch.map((assignment) => runAssignment(assignment)));

		for (const { assignment, replyText, mentions } of results) {
			for (const mention of mentions) {
				const target = teammateById.get(mention.targetId);
				if (!target) continue;
				handoffs.push({
					id: crypto.randomUUID(),
					from: assignment.target.identity.name,
					to: mention.targetName,
					task: mention.task,
					status: "pending",
					timestamp: Date.now(),
				});
				enqueue({
					target,
					task: mention.task,
					title: `Follow-up from ${assignment.target.identity.name}`,
					kind: "handoff",
					sourceLabel: assignment.target.identity.name,
					sourceExcerpt: replyText,
				});
			}

			for (const dependent of leaderPlan.subtasks.filter(
				(candidate) =>
					candidate.status === "pending" &&
					candidate.dependsOn.length > 0 &&
					candidate.dependsOn.every((dependencyId) => leaderPlan.subtasks.find((item) => item.id === dependencyId)?.status === "done"),
			)) {
				const target = teammateById.get(dependent.ownerId);
				if (!target) continue;
				enqueue({
					target,
					task: dependent.task,
					title: dependent.title,
					kind: "work",
					subtaskId: dependent.id,
				});
			}
		}
	}

	for (const handoff of handoffs) {
		handoff.status =
			leaderPlan.subtasks.some((subtask) => subtask.ownerName === handoff.to && subtask.status === "blocked") ? "blocked" : "done";
	}

	leaderPlan.phase = "summarize";
	leaderPlan.completionState = leaderPlan.subtasks.some((subtask) => subtask.status === "blocked") ? "blocked" : "completed";
	options.emitUtterance(
		createTeamUtterance({
			speakerId: LEADER_ID,
			speakerLabel: LEADER_LABEL,
			role: "leader",
			kind: "result",
			text: formatLeaderSummary(leaderPlan, handoffs),
		}),
	);
	leaderPlan.phase = "done";

	return {
		plan: leaderPlan,
		handoffs,
	};
}

async function buildLeaderPlanWithModel(
	userGoal: string,
	teammates: PersistedTeammate[],
	completeSimple: (systemPrompt: string, userMessage: string) => Promise<string | undefined>,
): Promise<LeaderPlan | undefined> {
	try {
		const response = await completeSimple(
			[
				"You are the leader of a terminal-native coding team.",
				"Split the user goal into a small, dependency-aware plan for the given teammates.",
				'Return strict JSON only: {"subtasks":[{"owner":"Ada","title":"...","task":"...","dependsOn":["Ada"]}]}',
				"Use only the provided teammate names as owners.",
				"Keep 1-6 subtasks total.",
			].join("\n"),
			[
				`User goal: ${userGoal}`,
				"Teammates:",
				...teammates.map((teammate) => `- ${teammate.identity.name}: ${teammate.identity.role}`),
			].join("\n"),
		);
		if (!response) return undefined;
		const parsed = JSON.parse(extractJsonObject(response)) as {
			subtasks?: Array<{ owner?: string; title?: string; task?: string; dependsOn?: string[] }>;
		};
		if (!Array.isArray(parsed.subtasks) || parsed.subtasks.length === 0) return undefined;

		const byName = new Map(teammates.map((teammate) => [teammate.identity.name.toLowerCase(), teammate] as const));
		const subtasks: LeaderSubtask[] = [];
		for (const item of parsed.subtasks.slice(0, 6)) {
			const owner = item.owner ? byName.get(item.owner.toLowerCase()) : undefined;
			if (!owner || typeof item.task !== "string" || typeof item.title !== "string") continue;
			subtasks.push({
				id: crypto.randomUUID(),
				ownerId: owner.identity.id,
				ownerName: owner.identity.name,
				ownerLabel: owner.identity.label,
				ownerRole: owner.identity.role,
				title: item.title.trim(),
				task: item.task.trim(),
				dependsOn: [],
				status: "pending",
			});
		}
		if (subtasks.length === 0) return undefined;

		const idByOwnerTitle = new Map(subtasks.map((subtask) => [subtask.ownerName.toLowerCase(), subtask.id] as const));
		for (let index = 0; index < subtasks.length; index++) {
			const item = parsed.subtasks?.[index];
			const subtask = subtasks[index];
			if (!item || !subtask) continue;
			subtask.dependsOn = (item.dependsOn ?? [])
				.map((dependency) => idByOwnerTitle.get(String(dependency).toLowerCase()))
				.filter((value): value is string => Boolean(value) && value !== subtask.id);
		}

		return finalizePlan(userGoal, subtasks);
	} catch {
		return undefined;
	}
}

function buildLeaderPlanHeuristic(userGoal: string, teammates: PersistedTeammate[]): LeaderPlan {
	const ordered = [...teammates].sort((a, b) => a.identity.createdAt - b.identity.createdAt);
	if (ordered.length === 0) {
		return finalizePlan(userGoal, []);
	}

	if (ordered.length === 1) {
		const only = ordered[0];
		return finalizePlan(userGoal, [
			{
				id: crypto.randomUUID(),
				ownerId: only.identity.id,
				ownerName: only.identity.name,
				ownerLabel: only.identity.label,
				ownerRole: only.identity.role,
				title: "Deliver the task",
				task: userGoal,
				dependsOn: [],
				status: "pending",
			},
		]);
	}

	const pm = pickOwner(ordered, ["pm", "planner", "researcher", "generic"]) ?? ordered[0];
	const architect =
		pickOwner(
			ordered.filter((candidate) => candidate.identity.id !== pm.identity.id),
			["architect", "researcher", "planner", "generic"],
		) ?? ordered.find((candidate) => candidate.identity.id !== pm.identity.id) ?? pm;
	const developer =
		pickOwner(
			ordered.filter((candidate) => ![pm.identity.id, architect.identity.id].includes(candidate.identity.id)),
			["developer", "implementer"],
		) ?? ordered.find((candidate) => candidate.identity.id !== pm.identity.id && candidate.identity.id !== architect.identity.id) ?? architect;
	const designer = pickOwner(
		ordered.filter((candidate) => ![pm.identity.id, architect.identity.id, developer.identity.id].includes(candidate.identity.id)),
		["designer", "reviewer", "researcher", "generic"],
	);
	const analyst = pickOwner(
		ordered.filter((candidate) => ![pm.identity.id, architect.identity.id, developer.identity.id, designer?.identity.id].includes(candidate.identity.id)),
		["data-analyst", "verifier", "reviewer", "generic"],
	);

	const pmId = crypto.randomUUID();
	const architectId = crypto.randomUUID();
	const developerId = crypto.randomUUID();
	const subtasks: LeaderSubtask[] = [
		{
			id: pmId,
			ownerId: pm.identity.id,
			ownerName: pm.identity.name,
			ownerLabel: pm.identity.label,
			ownerRole: pm.identity.role,
			title: "Frame the goal and success bar",
			task: `Break "${userGoal}" into the smallest practical delivery slice and hand the technical framing to @${architect.identity.name}.`,
			dependsOn: [],
			status: "pending",
		},
		{
			id: architectId,
			ownerId: architect.identity.id,
			ownerName: architect.identity.name,
			ownerLabel: architect.identity.label,
			ownerRole: architect.identity.role,
			title: "Map files, interfaces, and approach",
			task: `Identify the likely modules/files and implementation shape for "${userGoal}", then hand the concrete build step to @${developer.identity.name}.`,
			dependsOn: [pmId],
			status: "pending",
		},
		{
			id: developerId,
			ownerId: developer.identity.id,
			ownerName: developer.identity.name,
			ownerLabel: developer.identity.label,
			ownerRole: developer.identity.role,
			title: "Implement the change",
			task: `Implement the requested change for "${userGoal}". When useful, hand UX polish to @${designer?.identity.name ?? architect.identity.name} and evidence/risk review to @${analyst?.identity.name ?? architect.identity.name}.`,
			dependsOn: [architectId],
			status: "pending",
		},
	];

	if (designer) {
		subtasks.push({
			id: crypto.randomUUID(),
			ownerId: designer.identity.id,
			ownerName: designer.identity.name,
			ownerLabel: designer.identity.label,
			ownerRole: designer.identity.role,
			title: "Check UX, copy, and visual impact",
			task: `Review the change from a UX/design perspective. Call out confusing copy, weak affordances, or UI regressions.`,
			dependsOn: [developerId],
			status: "pending",
		});
	}

	if (analyst) {
		subtasks.push({
			id: crypto.randomUUID(),
			ownerId: analyst.identity.id,
			ownerName: analyst.identity.name,
			ownerLabel: analyst.identity.label,
			ownerRole: analyst.identity.role,
			title: "Validate evidence and risks",
			task: `Review the implementation for evidence, metrics, test coverage, and remaining risks. Summarize release readiness.`,
			dependsOn: [developerId],
			status: "pending",
		});
	}

	return finalizePlan(userGoal, subtasks);
}

function finalizePlan(userGoal: string, subtasks: LeaderSubtask[]): LeaderPlan {
	return {
		userGoal,
		phase: "plan",
		subtasks,
		owners: Object.fromEntries(subtasks.map((subtask) => [subtask.ownerLabel, subtask.ownerRole])),
		dependencies: Object.fromEntries(subtasks.map((subtask) => [subtask.id, subtask.dependsOn])),
		completionState: subtasks.length === 0 ? "completed" : "pending",
	};
}

function pickOwner(teammates: PersistedTeammate[], preferredRoles: PersistedTeammate["identity"]["role"][]): PersistedTeammate | undefined {
	for (const role of preferredRoles) {
		const match = teammates.find((candidate) => candidate.identity.role === role);
		if (match) return match;
	}
	return teammates[0];
}

function resolveMentionTarget(raw: string, teammates: PersistedTeammate[]): PersistedTeammate | undefined {
	const token = raw.trim();
	const upper = token.toUpperCase();
	return teammates.find(
		(teammate) => teammate.identity.label.toUpperCase() === upper || teammate.identity.name.toLowerCase() === token.toLowerCase(),
	);
}

function extractMentionTask(text: string, startIndex: number): string {
	const remaining = text.slice(startIndex);
	if (!remaining.trim()) return "";

	const nextMentionIndex = remaining.search(/\s@[A-Za-z][A-Za-z0-9-]*/);
	const nextLineIndex = remaining.indexOf("\n");
	const nextSentenceIndex = remaining.search(/[。！？!?]/);
	const bounds = [nextMentionIndex, nextLineIndex, nextSentenceIndex].filter((value) => value >= 0);
	const cut = bounds.length > 0 ? Math.min(...bounds) : remaining.length;
	const task = remaining
		.slice(0, cut)
		.replace(/^[\s:：,，-]+/, "")
		.trim();
	return singleLine(task);
}

function dedupeMentions(mentions: TeamMention[]): TeamMention[] {
	const seen = new Set<string>();
	return mentions.filter((mention) => {
		const key = `${mention.targetId}:${mention.task.toLowerCase()}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function buildAssignmentPrompt(
	userGoal: string,
	assignment: PendingAssignment,
	plan: LeaderPlan,
	teammates: PersistedTeammate[],
): string {
	const lines = [
		`Leader goal: ${userGoal}`,
		`Your assignment: ${assignment.task}`,
		"",
		"Team roster:",
		...teammates.map((teammate) => `- ${teammate.identity.name} (${teammate.identity.role})`),
		"",
		"Mention rules:",
		"- Use @Name mentions only for concrete next-step handoffs.",
		"- A mention must be followed by the task fragment for the target agent.",
		"- Do not ping without actionable work.",
	];

	if (assignment.sourceLabel && assignment.sourceExcerpt) {
		lines.push("", `Handoff source: ${assignment.sourceLabel}`, `Context: ${tailText(singleLine(assignment.sourceExcerpt), 280)}`);
	}
	if (assignment.subtaskId) {
		const subtask = plan.subtasks.find((item) => item.id === assignment.subtaskId);
		if (subtask?.dependsOn.length) {
			lines.push("", "Dependencies are already satisfied. Build on prior team outputs rather than repeating discovery.");
		}
	}
	lines.push("", "Respond as yourself, not as the leader.");
	return lines.join("\n");
}

function formatLeaderPlanAnnouncement(plan: LeaderPlan): string {
	if (plan.subtasks.length === 0) {
		return `I did not need to split the work; the task can be handled directly.`;
	}
	const parts = plan.subtasks.map(
		(subtask) =>
			`${subtask.ownerName} (${subtask.ownerRole}) handles "${subtask.title}"${subtask.dependsOn.length ? " after its dependencies clear" : ""}`,
		);
	return `I split the goal into ${plan.subtasks.length} steps. ${parts.join("; ")}.`;
}

function formatLeaderAssignment(assignment: PendingAssignment): string {
	if (assignment.kind === "handoff" && assignment.sourceLabel) {
		return `@${assignment.target.identity.name} take the handoff from ${assignment.sourceLabel}: ${assignment.task}`;
	}
	return `@${assignment.target.identity.name} ${assignment.task}`;
}

function formatLeaderSummary(plan: LeaderPlan, handoffs: Handoff[]): string {
	const done = plan.subtasks.filter((subtask) => subtask.status === "done").length;
	const blocked = plan.subtasks.filter((subtask) => subtask.status === "blocked").length;
	const handoffCount = handoffs.length;
	if (blocked > 0) {
		return `The team completed ${done}/${plan.subtasks.length} planned steps. ${blocked} step(s) ended blocked. Handoffs observed: ${handoffCount}.`;
	}
	return `The team completed ${done}/${plan.subtasks.length} planned steps. Handoffs observed: ${handoffCount}.`;
}

function extractJsonObject(value: string): string {
	const start = value.indexOf("{");
	const end = value.lastIndexOf("}");
	if (start === -1 || end === -1 || end <= start) return value;
	return value.slice(start, end + 1);
}

function singleLine(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function tailText(value: string, max: number): string {
	if (value.length <= max) return value;
	return value.slice(value.length - max);
}

function buildResearchPlanName(taskDescription: string): string {
	const slug = singleLine(taskDescription)
		.replace(/[^A-Za-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.slice(0, 32);
	return `Team_Research_${slug || "Plan"}`;
}
