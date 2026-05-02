/**
 * [WHO]: Provides PRESETS, executePreset(), executeAutoTeam(), selectAutoTeamPlan(), formatPresetResult()
 * [FROM]: Depends on ./team-types and ./team-runtime for spawning configured teammates
 * [TO]: Consumed by index.ts for /team:preset command handling
 * [HERE]: extensions/defaults/team/team-presets.ts - built-in AgentTeam preset definitions
 */

import type { TeamRuntime } from "./team-runtime.js";
import type { TeamRuntimeEvent } from "./team-runtime.js";
import type { PersistedTeammate, PresetName, PsycheWeights, TeammateMode, TeammateRole } from "./team-types.js";

export interface PresetTeammateSpec {
	role: TeammateRole;
	name?: string;
	mode?: TeammateMode;
	harnessEnabled: boolean;
	psycheOverrides?: Partial<PsycheWeights>;
}

export interface PresetSpec {
	name: PresetName;
	description: string;
	teammates: PresetTeammateSpec[];
	autoStart: boolean;
}

export interface PresetResult {
	preset: PresetSpec;
	teammates: PersistedTeammate[];
	started?: {
		teammateName: string;
		success: boolean;
		error?: string;
	};
}

export interface AutoTeamPlan {
	presetName: PresetName;
	rationale: string;
	startTargetRole: TeammateRole;
}

export interface AutoTeamResult extends PresetResult {
	plan: AutoTeamPlan;
}

export const PRESETS: Record<PresetName, PresetSpec> = {
	solo: {
		name: "solo",
		description: "Single developer with harness, suited for focused delivery tasks.",
		teammates: [{ role: "developer", name: "Theo", harnessEnabled: true }],
		autoStart: true,
	},
	duo: {
		name: "duo",
		description: "Architect plus developer for discovery followed by execution.",
		teammates: [
			{ role: "architect", name: "Ada", mode: "plan", harnessEnabled: false },
			{ role: "developer", name: "Theo", harnessEnabled: true },
		],
		autoStart: false,
	},
	squad: {
		name: "squad",
		description: "PM, architect, developer, designer, and data analyst for explicit multi-agent handoffs.",
		teammates: [
			{ role: "pm", name: "Mason", mode: "plan", harnessEnabled: false },
			{ role: "architect", name: "Ada", mode: "plan", harnessEnabled: false },
			{ role: "developer", name: "Theo", harnessEnabled: true },
			{
				role: "designer",
				name: "Iris",
				mode: "research",
				harnessEnabled: false,
				psycheOverrides: { id: 1.3, ego: 1.1 },
			},
			{
				role: "data-analyst",
				name: "Quinn",
				mode: "review",
				harnessEnabled: false,
				psycheOverrides: { superego: 1.5, id: 0.5 },
			},
		],
		autoStart: false,
	},
};

export async function executePreset(
	runtime: TeamRuntime,
	presetName: PresetName,
	taskDescription: string,
	baseCwd: string,
	model?: Parameters<TeamRuntime["send"]>[2],
	onEvent?: (event: TeamRuntimeEvent) => void,
	autoStartOverride?: boolean,
): Promise<PresetResult> {
	const preset = PRESETS[presetName];
	const teammates: PersistedTeammate[] = [];

	for (const teammateSpec of preset.teammates) {
		teammates.push(
			await runtime.spawn({
				role: teammateSpec.role,
				name: teammateSpec.name,
				mode: teammateSpec.mode,
				baseCwd,
				harnessEnabled: teammateSpec.harnessEnabled,
				psycheOverrides: teammateSpec.psycheOverrides,
			}),
		);
	}

	const result: PresetResult = { preset, teammates };
	const shouldAutoStart = autoStartOverride ?? preset.autoStart;
	if (shouldAutoStart && teammates[0]) {
		const sendResult = await runtime.send(teammates[0].identity.name, taskDescription, model, { onEvent });
		result.started = {
			teammateName: teammates[0].identity.name,
			success: sendResult.success,
			error: sendResult.error,
		};
	}

	return result;
}

export async function executeAutoTeam(
	runtime: TeamRuntime,
	taskDescription: string,
	baseCwd: string,
	model?: Parameters<TeamRuntime["send"]>[2],
	onEvent?: (event: TeamRuntimeEvent) => void,
	completeSimple?: (systemPrompt: string, userMessage: string) => Promise<string | undefined>,
): Promise<AutoTeamResult> {
	const plan = await selectAutoTeamPlan(taskDescription, completeSimple);
	const presetResult = await executePreset(runtime, plan.presetName, taskDescription, baseCwd, model, onEvent, false);
	const startTarget = presetResult.teammates.find((teammate) => teammate.identity.role === plan.startTargetRole) ?? presetResult.teammates[0];
	const result: AutoTeamResult = { ...presetResult, plan };

	if (startTarget) {
		const sendResult = await runtime.send(startTarget.identity.name, taskDescription, model, { onEvent });
		result.started = {
			teammateName: startTarget.identity.name,
			success: sendResult.success,
			error: sendResult.error,
			response: sendResult.response,
		} as typeof result.started & { response?: string };
	}

	return result;
}

export async function selectAutoTeamPlan(
	taskDescription: string,
	completeSimple?: (systemPrompt: string, userMessage: string) => Promise<string | undefined>,
): Promise<AutoTeamPlan> {
	if (completeSimple) {
		const modelPlan = await selectAutoTeamPlanWithModel(taskDescription, completeSimple);
		if (modelPlan) return modelPlan;
	}
	return selectAutoTeamPlanHeuristic(taskDescription);
}

export function formatPresetResult(result: PresetResult): string[] {
	const lines = [`Preset "${result.preset.name}" created: ${result.preset.description}`, ""];
	for (const teammate of result.teammates) {
		const harness = teammate.harness?.enabled ? " harness:on" : "";
		lines.push(`  ${teammate.identity.name} (${teammate.identity.role}, ${teammate.mode})${harness}`);
	}
	if (result.started) {
		const started = result.started as typeof result.started & { response?: string };
		lines.push(
			"",
			started.success
				? `Auto-started ${started.teammateName}.`
				: `Auto-start for ${started.teammateName} failed: ${started.error ?? "Unknown error"}`,
		);
		if (started.success && started.response?.trim()) {
			lines.push("", `Response from ${started.teammateName}:`, "", started.response);
		}
	}
	return lines;
}

export function formatAutoTeamResult(result: AutoTeamResult): string[] {
	return [
		`Auto team selected "${result.plan.presetName}".`,
		`Reason: ${result.plan.rationale}`,
		"",
		...formatPresetResult(result),
	];
}

async function selectAutoTeamPlanWithModel(
	taskDescription: string,
	completeSimple: (systemPrompt: string, userMessage: string) => Promise<string | undefined>,
): Promise<AutoTeamPlan | undefined> {
	try {
		const response = await completeSimple(
			[
				"You select the smallest useful AgentTeam preset for a coding task.",
				'Return strict JSON only: {"presetName":"solo|duo|squad","rationale":"short reason","startTargetRole":"developer|architect|pm"}',
				"solo: focused implementation or small/medium bugfix.",
				"duo: implementation needs architecture reading, API mapping, or light decomposition before coding.",
				"squad: tasks that need explicit handoff, product framing, design input, data validation, review, tests, or broader coordination.",
			].join("\n"),
			taskDescription,
		);
		if (!response) return undefined;
		const parsed = JSON.parse(extractJsonObject(response)) as Partial<AutoTeamPlan>;
		if (parsed.presetName === "solo" || parsed.presetName === "duo" || parsed.presetName === "squad") {
			const startTargetRole =
				parsed.startTargetRole === "pm" && parsed.presetName === "squad"
					? "pm"
					: parsed.startTargetRole === "architect" && (parsed.presetName === "duo" || parsed.presetName === "squad")
						? "architect"
						: "developer";
			return {
				presetName: parsed.presetName,
				rationale: typeof parsed.rationale === "string" ? parsed.rationale : "Selected by the current model.",
				startTargetRole,
			};
		}
	} catch {
		return undefined;
	}
	return undefined;
}

function selectAutoTeamPlanHeuristic(taskDescription: string): AutoTeamPlan {
	const text = taskDescription.toLowerCase();
	const largeSignals = [
		"architecture",
		"refactor",
		"migration",
		"migrate",
		"system",
		"multiple",
		"end-to-end",
		"e2e",
		"large",
		"完整",
		"重构",
		"架构",
		"迁移",
		"大型",
	];
	const verifySignals = [
		"test",
		"tests",
		"verify",
		"review",
		"security",
		"auth",
		"payment",
		"release",
		"bug",
		"验证",
		"测试",
		"安全",
		"登录",
		"支付",
		"发布",
	];

	if (largeSignals.some((signal) => text.includes(signal)) || taskDescription.length > 240) {
		return {
			presetName: "squad",
			rationale: "Task looks broad or architectural, so PM, architect, developer, designer, and data analyst are safer.",
			startTargetRole: "pm",
		};
	}
	if (verifySignals.some((signal) => text.includes(signal))) {
		return {
			presetName: "squad",
			rationale: "Task has correctness or verification signals, so explicit PM, architecture, implementation, design, and data validation are appropriate.",
			startTargetRole: "pm",
		};
	}
	if (text.includes("refactor") || text.includes("api") || text.includes("investigate") || text.includes("analyze")) {
		return {
			presetName: "duo",
			rationale: "Task benefits from architecture framing before coding, so an architect plus developer is appropriate.",
			startTargetRole: "architect",
		};
	}
	return {
		presetName: "solo",
		rationale: "Task appears focused enough for one harnessed developer.",
		startTargetRole: "developer",
	};
}

function extractJsonObject(value: string): string {
	const start = value.indexOf("{");
	const end = value.lastIndexOf("}");
	if (start === -1 || end === -1 || end <= start) return value;
	return value.slice(start, end + 1);
}
