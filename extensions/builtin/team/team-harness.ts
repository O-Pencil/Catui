/**
 * [WHO]: Provides createInitialHarnessState(), beginHarnessTurn(), buildHarnessInstructions(), prepareContextFiles(), inspectHarnessExit()
 * [FROM]: Depends on node fs/path and ./team-types for harness state and feature contracts
 * [TO]: Consumed by team-runtime.ts, team-presets.ts, index.ts to coordinate long-running AgentTeam work
 * [HERE]: extensions/builtin/team/team-harness.ts - Anthropic-style harness protocol helpers for /team teammates
 */

import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { promisify } from "node:util";
import type { HarnessFeature, HarnessPhase, HarnessState } from "./team-types.js";
import type { SubAgentResult } from "../../../core/sub-agent/index.js";

export interface HarnessFeatureList {
	version: 1;
	generatedAt: string;
	taskDescription: string;
	features: HarnessFeature[];
}

export interface HarnessExitResult {
	harness: HarnessState;
	violations: string[];
	event: string;
}

const DEFAULT_FEATURE_LIST_PATH = ".nanopencil-harness/feature_list.json";
const DEFAULT_PROGRESS_PATH = ".nanopencil-harness/progress.txt";
const DEFAULT_INIT_SCRIPT_PATH = ".nanopencil-harness/init.sh";
const execFileAsync = promisify(execFile);

export function createInitialHarnessState(): HarnessState {
	return {
		enabled: true,
		phase: "init",
		featureListPath: DEFAULT_FEATURE_LIST_PATH,
		progressPath: DEFAULT_PROGRESS_PATH,
		initScriptPath: DEFAULT_INIT_SCRIPT_PATH,
		totalFeatures: 0,
		passedFeatures: 0,
		currentFeature: null,
		lastVerifyReport: null,
		cycleCount: 0,
		featureSnapshot: [],
		preTurnCommit: null,
		lastCheckpointCommit: null,
		lastRevertCommit: null,
		lastEvent: "Harness initialized",
	};
}

export async function ensureHarnessFiles(harness: HarnessState, cwd: string, taskDescription: string): Promise<void> {
	await ensureParent(cwd, harness.featureListPath);
	await ensureParent(cwd, harness.progressPath);
	await ensureParent(cwd, harness.initScriptPath);

	await writeIfMissing(
		cwd,
		harness.progressPath,
		[
			"=== Session 0 ===",
			`Date: ${new Date().toISOString()}`,
			`Phase: ${harness.phase}`,
			"Status: initialized",
			`Task: ${taskDescription}`,
			"Notes: Harness files were prepared by TeamRuntime.",
			"",
		].join("\n"),
	);
	await writeIfMissing(
		cwd,
		harness.initScriptPath,
		["#!/usr/bin/env bash", "set -euo pipefail", "# Add reproducible setup commands here.", ""].join("\n"),
	);
}

export async function beginHarnessTurn(harness: HarnessState, cwd: string): Promise<HarnessState> {
	const next = { ...harness };
	next.preTurnCommit = await getGitHead(cwd);
	return next;
}

export async function buildHarnessInstructions(
	harness: HarnessState,
	cwd: string,
	taskDescription: string,
): Promise<string> {
	const featureListContent = await readRelativeFile(cwd, harness.featureListPath);
	const progressContent = await readRelativeFile(cwd, harness.progressPath);

	switch (harness.phase) {
		case "init":
			return buildInitPhaseInstructions(harness, taskDescription, cwd);
		case "coding":
			return buildCodingPhaseInstructions(harness, featureListContent, progressContent);
		case "verify":
			return buildVerifyPhaseInstructions(harness, featureListContent);
		case "fix":
			return buildFixPhaseInstructions(harness, harness.lastVerifyReport, featureListContent);
		case "complete":
			return buildCompletePhaseInstructions(harness, featureListContent);
	}
}

export function buildInitPhaseInstructions(harness: HarnessState, taskDescription: string, cwd: string): string {
	return [
		"## Harness Phase: init",
		"",
		`Task: ${taskDescription}`,
		`Working directory: ${cwd}`,
		"",
		"Create or update the harness files before doing implementation work:",
		`- ${harness.featureListPath}: JSON matching { version: 1, generatedAt, taskDescription, features[] }`,
		`- ${harness.progressPath}: human-readable progress log`,
		`- ${harness.initScriptPath}: reproducible setup/check script if useful`,
		"",
		"Feature rules:",
		"- Use stable feature ids such as F001, F002.",
		"- Each feature needs category, description, steps, passes=false, and priority.",
		"- Do not implement features during init. Stop after the harness plan is written.",
	].join("\n");
}

export function buildCodingPhaseInstructions(
	harness: HarnessState,
	featureListContent: string,
	progressContent: string,
): string {
	return [
		"## Harness Phase: coding",
		"",
		"Read the injected feature list and progress. Choose exactly one feature with passes=false, implement it, run its verification steps, then update progress.",
		`Current progress: ${harness.passedFeatures}/${harness.totalFeatures}`,
		"",
		"Feature list snapshot:",
		truncateForPrompt(featureListContent),
		"",
		"Progress snapshot:",
		truncateForPrompt(progressContent),
	].join("\n");
}

export function buildVerifyPhaseInstructions(harness: HarnessState, featureListContent: string): string {
	return [
		"## Harness Phase: verify",
		"",
		"Act as a strict verifier. Re-run or reason through every feature marked passes=true.",
		"If a feature is not actually verified, set passes=false and record the reason in progress.txt.",
		`Current claimed progress: ${harness.passedFeatures}/${harness.totalFeatures}`,
		"",
		"Feature list snapshot:",
		truncateForPrompt(featureListContent),
	].join("\n");
}

export function buildFixPhaseInstructions(
	harness: HarnessState,
	verifyReport: string | null,
	featureListContent: string,
): string {
	return [
		"## Harness Phase: fix",
		"",
		"Fix only the failed or downgraded features from the previous verify phase, then re-run their verification steps.",
		verifyReport ? `Last verify report:\n${verifyReport}` : "No verify report was captured; inspect feature_list.json for passes=false items.",
		"",
		"Feature list snapshot:",
		truncateForPrompt(featureListContent),
	].join("\n");
}

export function buildCompletePhaseInstructions(harness: HarnessState, featureListContent: string): string {
	return [
		"## Harness Phase: complete",
		"",
		"All tracked features are currently passing. Summarize the verification evidence and avoid new implementation work unless the leader asks for more.",
		`Final progress: ${harness.passedFeatures}/${harness.totalFeatures}`,
		"",
		"Feature list snapshot:",
		truncateForPrompt(featureListContent),
	].join("\n");
}

export function prepareContextFiles(harness: HarnessState): string[] {
	const files = [harness.progressPath, harness.initScriptPath];
	if (harness.phase !== "init" || harness.totalFeatures > 0) {
		files.unshift(harness.featureListPath);
	}
	return files;
}

export async function inspectHarnessExit(
	harness: HarnessState,
	cwd: string,
	result: SubAgentResult,
): Promise<HarnessExitResult> {
	const next: HarnessState = { ...harness };
	const previousPhase = harness.phase;
	const featureList = await readFeatureList(cwd, harness.featureListPath);
	const violations = featureList ? validateFeatureList(harness.featureSnapshot, featureList.features) : [];
	const shouldRevert = violations.length > 0;

	if (featureList) {
		next.totalFeatures = featureList.features.length;
		next.passedFeatures = featureList.features.filter((feature) => feature.passes).length;
		next.currentFeature = featureList.features.find((feature) => !feature.passes)?.description ?? null;
		if (next.featureSnapshot.length === 0 && featureList.features.length > 0) {
			next.featureSnapshot = snapshotFeatures(featureList.features);
		}
	}

	const progress = await readRelativeFile(cwd, harness.progressPath);
	if (previousPhase === "verify" || !result.success) {
		next.lastVerifyReport = result.response ?? result.error ?? progress.slice(-2000);
	}

	next.phase = resolveNextPhase(next, previousPhase, violations);
	if (shouldRevert) {
		const revertCommit = await revertHarnessChanges(cwd, harness.preTurnCommit, violations);
		next.lastRevertCommit = revertCommit ?? next.lastRevertCommit;
	} else {
		const checkpoint = await createHarnessCheckpoint(cwd, buildCheckpointMessage(previousPhase, next));
		next.lastCheckpointCommit = checkpoint ?? next.lastCheckpointCommit;
	}
	if (previousPhase === "init" && next.phase === "coding") {
		next.cycleCount += 1;
	}
	next.lastEvent = buildHarnessEvent(previousPhase, next.phase, next, violations);

	return { harness: next, violations, event: next.lastEvent };
}

export function validateFeatureList(
	original: Omit<HarnessFeature, "passes">[],
	current: HarnessFeature[],
): string[] {
	if (original.length === 0) return [];

	const violations: string[] = [];
	if (original.length !== current.length) {
		violations.push(`feature count changed: ${original.length} -> ${current.length}`);
	}

	for (const [index, originalFeature] of original.entries()) {
		const currentFeature = current[index];
		if (!currentFeature) continue;
		if (currentFeature.id !== originalFeature.id) violations.push(`feature ${index + 1} id changed`);
		if (currentFeature.category !== originalFeature.category) violations.push(`feature ${originalFeature.id} category changed`);
		if (currentFeature.description !== originalFeature.description) {
			violations.push(`feature ${originalFeature.id} description changed`);
		}
		if (currentFeature.priority !== originalFeature.priority) violations.push(`feature ${originalFeature.id} priority changed`);
		if (currentFeature.steps.join("\n") !== originalFeature.steps.join("\n")) {
			violations.push(`feature ${originalFeature.id} steps changed`);
		}
	}

	return violations;
}

export function resolveNextPhase(
	harness: Pick<HarnessState, "phase" | "totalFeatures" | "passedFeatures">,
	previousPhase: HarnessPhase = harness.phase,
	violations: string[] = [],
): HarnessPhase {
	if (violations.length > 0) return "fix";
	if (harness.totalFeatures === 0) return "init";
	if (harness.passedFeatures >= harness.totalFeatures) {
		if (previousPhase === "verify" || previousPhase === "complete") return "complete";
		return "verify";
	}
	if (previousPhase === "verify") return "fix";
	return "coding";
}

export function formatHarnessProgress(harness: HarnessState | undefined): string[] {
	if (!harness?.enabled) return ["Harness: disabled"];
	const percent = harness.totalFeatures > 0 ? Math.round((harness.passedFeatures / harness.totalFeatures) * 100) : 0;
	return [
		`Harness: ${harness.phase}`,
		`  Progress: ${harness.passedFeatures}/${harness.totalFeatures} (${percent}%)`,
		`  Current: ${harness.currentFeature ?? "none"}`,
		`  Cycle: ${harness.cycleCount}`,
		...(harness.lastCheckpointCommit ? [`  Last Checkpoint: ${harness.lastCheckpointCommit.slice(0, 12)}`] : []),
		...(harness.lastRevertCommit ? [`  Last Revert: ${harness.lastRevertCommit.slice(0, 12)}`] : []),
		`  Files: ${harness.featureListPath}, ${harness.progressPath}`,
		...(harness.lastEvent ? [`  Last Event: ${harness.lastEvent}`] : []),
	];
}

export async function createHarnessCheckpoint(cwd: string, message: string): Promise<string | null> {
	if (!(await isGitRepository(cwd))) return null;
	if (!(await hasGitChanges(cwd))) return await getGitHead(cwd);

	try {
		await git(cwd, ["add", "-A"]);
		await git(cwd, ["commit", "-m", message]);
		return await getGitHead(cwd);
	} catch {
		return null;
	}
}

export async function revertHarnessChanges(
	cwd: string,
	preTurnCommit: string | null,
	violations: string[],
): Promise<string | null> {
	if (!preTurnCommit || !(await isGitRepository(cwd)) || !(await hasGitChanges(cwd))) return null;

	try {
		const currentStatus = await git(cwd, ["status", "--porcelain"]);
		if (!currentStatus.stdout.trim()) return null;
		await git(cwd, ["add", "-A"]);
		await git(cwd, ["commit", "-m", `harness: quarantine invalid turn\n\n${violations.join("\n")}`]);
		await git(cwd, ["revert", "--no-edit", "HEAD"]);
		return await getGitHead(cwd);
	} catch {
		return null;
	}
}

async function readFeatureList(cwd: string, path: string): Promise<HarnessFeatureList | undefined> {
	const content = await readRelativeFile(cwd, path);
	if (!content.trim()) return undefined;
	try {
		const parsed = JSON.parse(content) as HarnessFeatureList;
		if (parsed.version !== 1 || !Array.isArray(parsed.features)) return undefined;
		return parsed;
	} catch {
		return undefined;
	}
}

function snapshotFeatures(features: HarnessFeature[]): Omit<HarnessFeature, "passes">[] {
	return features.map(({ passes: _passes, ...rest }) => rest);
}

async function readRelativeFile(cwd: string, path: string): Promise<string> {
	try {
		return await readFile(resolvePath(cwd, path), "utf8");
	} catch {
		return "";
	}
}

async function writeIfMissing(cwd: string, path: string, content: string): Promise<void> {
	try {
		await readFile(resolvePath(cwd, path), "utf8");
	} catch {
		await writeFile(resolvePath(cwd, path), content, "utf8");
	}
}

async function ensureParent(cwd: string, path: string): Promise<void> {
	await mkdir(dirname(resolvePath(cwd, path)), { recursive: true });
}

function resolvePath(cwd: string, path: string): string {
	return isAbsolute(path) ? path : resolve(cwd, path);
}

function truncateForPrompt(content: string): string {
	if (!content.trim()) return "(empty or unavailable)";
	return content.length > 6000 ? `${content.slice(0, 6000)}\n... (truncated)` : content;
}

function buildHarnessEvent(
	previousPhase: HarnessPhase,
	nextPhase: HarnessPhase,
	harness: HarnessState,
	violations: string[],
): string {
	const suffix = violations.length > 0 ? ` with ${violations.length} feature-list violation(s)` : "";
	const checkpoint = harness.lastCheckpointCommit ? `; checkpoint ${harness.lastCheckpointCommit.slice(0, 12)}` : "";
	const revert = harness.lastRevertCommit ? `; revert ${harness.lastRevertCommit.slice(0, 12)}` : "";
	return `Phase ${previousPhase} -> ${nextPhase}; progress ${harness.passedFeatures}/${harness.totalFeatures}${suffix}${checkpoint}${revert}`;
}

function buildCheckpointMessage(previousPhase: HarnessPhase, harness: HarnessState): string {
	return `harness: ${previousPhase} checkpoint\n\nProgress: ${harness.passedFeatures}/${harness.totalFeatures}\nNext phase: ${harness.phase}`;
}

async function isGitRepository(cwd: string): Promise<boolean> {
	try {
		await git(cwd, ["rev-parse", "--is-inside-work-tree"]);
		return true;
	} catch {
		return false;
	}
}

async function hasGitChanges(cwd: string): Promise<boolean> {
	try {
		const status = await git(cwd, ["status", "--porcelain"]);
		return status.stdout.trim().length > 0;
	} catch {
		return false;
	}
}

async function getGitHead(cwd: string): Promise<string | null> {
	try {
		const result = await git(cwd, ["rev-parse", "HEAD"]);
		return result.stdout.trim() || null;
	} catch {
		return null;
	}
}

async function git(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
	const result = await execFileAsync("git", args, {
		cwd,
		encoding: "utf8",
		maxBuffer: 1024 * 1024,
	});
	return {
		stdout: String(result.stdout ?? ""),
		stderr: String(result.stderr ?? ""),
	};
}
