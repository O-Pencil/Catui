/**
 * [WHO]: Provides PRESETS, executePreset(), formatPresetResult()
 * [FROM]: Depends on ./team-types and ./team-runtime for spawning configured teammates
 * [TO]: Consumed by index.ts for /team:preset command handling
 * [HERE]: extensions/defaults/team/team-presets.ts - built-in AgentTeam preset definitions
 */

import type { TeamRuntime } from "./team-runtime.js";
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

export const PRESETS: Record<PresetName, PresetSpec> = {
	solo: {
		name: "solo",
		description: "Single implementer with harness, suited for most focused tasks.",
		teammates: [{ role: "implementer", harnessEnabled: true }],
		autoStart: true,
	},
	duo: {
		name: "duo",
		description: "Implementer plus verifier for higher confidence delivery.",
		teammates: [
			{ role: "implementer", harnessEnabled: true },
			{
				role: "verifier",
				name: "verifier",
				mode: "review",
				harnessEnabled: false,
				psycheOverrides: { superego: 1.5, id: 0.5 },
			},
		],
		autoStart: false,
	},
	squad: {
		name: "squad",
		description: "Planner, two implementers, and verifier for larger work.",
		teammates: [
			{ role: "planner", mode: "plan", harnessEnabled: false },
			{ role: "implementer", name: "impl-1", harnessEnabled: true },
			{ role: "implementer", name: "impl-2", harnessEnabled: true },
			{
				role: "verifier",
				name: "verifier",
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
	if (preset.autoStart && teammates[0]) {
		const sendResult = await runtime.send(teammates[0].identity.name, taskDescription, model);
		result.started = {
			teammateName: teammates[0].identity.name,
			success: sendResult.success,
			error: sendResult.error,
		};
	}

	return result;
}

export function formatPresetResult(result: PresetResult): string[] {
	const lines = [`Preset "${result.preset.name}" created: ${result.preset.description}`, ""];
	for (const teammate of result.teammates) {
		const harness = teammate.harness?.enabled ? " harness:on" : "";
		lines.push(`  ${teammate.identity.name} (${teammate.identity.role}, ${teammate.mode})${harness}`);
	}
	if (result.started) {
		lines.push(
			"",
			result.started.success
				? `Auto-started ${result.started.teammateName}.`
				: `Auto-start for ${result.started.teammateName} failed: ${result.started.error ?? "Unknown error"}`,
		);
	}
	return lines;
}
