/**
 * [WHO]: Provides ensureHarnessArtifacts(), buildInitScript()
 * [FROM]: Depends on node:fs, ./grub-feature-list, ./grub-i18n, ./grub-types for durable harness files
 * [TO]: Consumed by ./index.ts when starting or resuming /grub tasks
 * [HERE]: extensions/builtin/grub/grub-harness.ts - filesystem artifact boundary for .grub/<id>/
 */

import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import {
	createInitialFeatureList,
	migrateChecklistToFeatureList,
	writeFeatureList,
} from "./grub-feature-list.js";
import { grubText } from "./grub-i18n.js";
import type { GrubTaskState } from "./grub-types.js";

export function buildInitScript(task: GrubTaskState): string {
	const isZh = task.locale === "zh";
	return [
		"#!/usr/bin/env bash",
		"set -euo pipefail",
		"",
		isZh
			? "# Grub harness 启动脚本（get-bearings 协议）。请将下方烟测替换为项目专属命令，"
			: "# Grub harness startup (get-bearings protocol). Override the smoke block below",
		isZh
			? "# 用来证明应用仍能端到端启动。"
			: "# with project-specific commands that prove the app still boots end-to-end.",
		"",
		'echo "=== grub bearings ==="',
		"pwd",
		'echo "--- recent commits ---"',
		"git log --oneline -n 20 2>/dev/null || true",
		'echo "--- working tree ---"',
		"git status --short 2>/dev/null || true",
		'echo "--- progress tail ---"',
		`tail -n 40 ${JSON.stringify(task.progressLogPath)} 2>/dev/null || true`,
		'echo "--- feature progress ---"',
		`node -e "try{const l=require(${JSON.stringify(task.featureListPath)});const p=l.features.filter(f=>f.passes).length;console.log(p+'/'+l.features.length+' passing');}catch(e){console.log('feature-list.json unavailable');}" 2>/dev/null || true`,
		'echo "--- project smoke (override below) ---"',
		isZh
			? "# TODO: 项目专属烟测命令（tests、curl、tsc --noEmit 等）"
			: "# TODO: project-specific smoke command (tests, curl, tsc --noEmit, etc.)",
		"",
	].join("\n");
}

export function ensureHarnessArtifacts(task: GrubTaskState): void {
	if (!existsSync(task.harnessDirectory)) {
		mkdirSync(task.harnessDirectory, { recursive: true });
	}

	if (!existsSync(task.featureListPath)) {
		const migrated = existsSync(task.featureChecklistPath)
			? migrateChecklistToFeatureList(task.featureChecklistPath, task.goal)
			: null;
		writeFeatureList(task.featureListPath, migrated ?? createInitialFeatureList(task.goal));
	}

	if (!existsSync(task.progressLogPath)) {
		const text = grubText(task.locale);
		writeFileSync(
			task.progressLogPath,
			[
				text.progressLogTitle(task.id),
				"",
				`${text.goal}: ${task.goal}`,
				"",
				text.initializationHeading,
				text.harnessCreated,
				text.structuredFeatureNote,
				text.initScriptNote,
				"",
				text.iterationsHeading,
				text.appendIterationNote,
				"",
			].join("\n"),
			"utf-8",
		);
	}

	if (!existsSync(task.initScriptPath)) {
		writeFileSync(task.initScriptPath, buildInitScript(task), "utf-8");
		chmodSync(task.initScriptPath, 0o755);
	}
}
