import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { GrubController } from "../extensions/defaults/grub/grub-controller.js";
import {
	FeatureListDiffError,
	createInitialFeatureList,
	migrateChecklistToFeatureList,
	validateFeatureListDiff,
	writeFeatureList,
} from "../extensions/defaults/grub/grub-feature-list.js";
import {
	discoverActiveTasks,
	loadState,
	persistState,
	pruneStale,
} from "../extensions/defaults/grub/grub-persistence.js";
import { parseGrubCommand } from "../extensions/defaults/grub/grub-parser.js";
import { buildGrubHelp } from "../extensions/defaults/grub/grub-parser.js";

function createTempWorkspace(): string {
	return mkdtempSync(join(tmpdir(), "nanopencil-grub-"));
}

function cleanup(path: string): void {
	rmSync(path, { recursive: true, force: true });
}

test("grub controller starts with initializer phase and harness paths", () => {
	const cwd = createTempWorkspace();
	try {
		const controller = new GrubController();
		const task = controller.start("Ship one safe incremental feature", cwd);

		assert.equal(task.phase, "initializer");
		assert.match(task.harnessDirectory, /\/\.grub\//);
		assert.match(task.featureListPath, /feature-list\.json$/);
		assert.match(task.progressLogPath, /progress-log\.md$/);
		assert.match(task.initScriptPath, /init\.sh$/);
		assert.match(task.stateFilePath, /state\.json$/);
	} finally {
		cleanup(cwd);
	}
});

test("grub controller stores locale and builds localized prompts", () => {
	const cwd = createTempWorkspace();
	try {
		const controller = new GrubController();
		const task = controller.start("实现中文进度体验", cwd, { locale: "zh" });
		const prompt = controller.buildPrompt();

		assert.equal(task.locale, "zh");
		assert.match(prompt, /自主 Grub 目标/);
		assert.match(prompt, /所有面向用户的总结、进度和说明都必须使用中文/);
	} finally {
		cleanup(cwd);
	}
});

test("grub controller transitions to execution phase after first successful turn", () => {
	const cwd = createTempWorkspace();
	try {
		const controller = new GrubController();
		controller.start("Improve harness quality", cwd);
		controller.markDispatched();

		const outcome = controller.finishTurn({
			status: "continue",
			summary: "Initializer artifacts are prepared.",
			nextStep: "Execute the first checklist slice.",
		});

		assert.equal(outcome.action, "continue");
		const active = controller.getActiveTask();
		assert.ok(active);
		assert.equal(active.phase, "execution");
		assert.equal(active.currentIteration, 2);
	} finally {
		cleanup(cwd);
	}
});

test("feature list diff rejects mutations to immutable fields", () => {
	const before = createInitialFeatureList("goal");
	const mutatedDescription = {
		...before,
		features: before.features.map((f) => ({ ...f, description: "rewritten" })),
	};
	assert.throws(() => validateFeatureListDiff(before, mutatedDescription), FeatureListDiffError);

	const mutatedSteps = {
		...before,
		features: before.features.map((f) => ({ ...f, steps: ["new", "steps"] })),
	};
	assert.throws(() => validateFeatureListDiff(before, mutatedSteps), FeatureListDiffError);

	const addedFeature = {
		...before,
		features: [
			...before.features,
			{
				id: "extra",
				category: "functional" as const,
				description: "smuggled in",
				steps: [],
				passes: false,
			},
		],
	};
	assert.throws(() => validateFeatureListDiff(before, addedFeature), FeatureListDiffError);

	const renamedId = {
		...before,
		features: before.features.map((f) => ({ ...f, id: "rename-attack" })),
	};
	assert.throws(() => validateFeatureListDiff(before, renamedId), FeatureListDiffError);
});

test("feature list diff allows passes/evidence updates", () => {
	const before = createInitialFeatureList("goal");
	const after = {
		...before,
		features: before.features.map((f) => ({ ...f, passes: true, evidence: "abc123" })),
	};
	const result = validateFeatureListDiff(before, after);
	assert.equal(result.features[0].passes, true);
	assert.equal(result.features[0].evidence, "abc123");
});

test("validateCompletion downgrades complete when features still pending", () => {
	const cwd = createTempWorkspace();
	try {
		const controller = new GrubController();
		const task = controller.start("Multi-feature goal", cwd);
		writeFeatureList(task.featureListPath, {
			version: 1,
			goal: "Multi-feature goal",
			features: [
				{
					id: "alpha",
					category: "functional",
					description: "alpha",
					steps: ["do alpha"],
					passes: true,
				},
				{
					id: "beta",
					category: "functional",
					description: "beta",
					steps: ["do beta"],
					passes: false,
				},
			],
		});
		const outcome = controller.validateCompletion({
			status: "complete",
			summary: "Done",
		});
		assert.equal(outcome.downgraded, true);
		assert.equal(outcome.decision.status, "continue");
		assert.match(outcome.decision.nextStep ?? "", /beta/);
	} finally {
		cleanup(cwd);
	}
});

test("validateCompletion accepts complete when all features pass", () => {
	const cwd = createTempWorkspace();
	try {
		const controller = new GrubController();
		const task = controller.start("Single-feature goal", cwd);
		writeFeatureList(task.featureListPath, {
			version: 1,
			goal: "Single-feature goal",
			features: [
				{
					id: "alpha",
					category: "functional",
					description: "alpha",
					steps: ["do alpha"],
					passes: true,
				},
			],
		});
		const outcome = controller.validateCompletion({
			status: "complete",
			summary: "Done",
		});
		assert.equal(outcome.downgraded, false);
		assert.equal(outcome.decision.status, "complete");
	} finally {
		cleanup(cwd);
	}
});

test("persistState round trips via loadState", () => {
	const cwd = createTempWorkspace();
	try {
		const controller = new GrubController();
		const task = controller.start("Persist round-trip", cwd);
		persistState(task);
		const loaded = loadState(task.stateFilePath);
		assert.ok(loaded);
		assert.equal(loaded.task.id, task.id);
		assert.equal(loaded.task.goal, task.goal);
		assert.equal(loaded.task.phase, "initializer");
		assert.equal(loaded.version, 1);
	} finally {
		cleanup(cwd);
	}
});

test("discoverActiveTasks finds running state files and skips terminal ones", () => {
	const cwd = createTempWorkspace();
	try {
		const controller = new GrubController();
		const running = controller.start("Running task", cwd);
		// create a second task directory manually with terminal status
		const terminalDir = join(cwd, ".grub", "aaaaaaaa");
		mkdirSync(terminalDir, { recursive: true });
		writeFileSync(
			join(terminalDir, "state.json"),
			JSON.stringify(
				{
					version: 1,
					createdAt: Date.now(),
					lastPersistedAt: Date.now(),
					task: {
						...running,
						id: "aaaaaaaa",
						status: "complete",
						harnessDirectory: terminalDir,
						stateFilePath: join(terminalDir, "state.json"),
					},
				},
				null,
				2,
			),
		);

		const discovered = discoverActiveTasks(cwd);
		assert.equal(discovered.length, 1);
		assert.equal(discovered[0].task.id, running.id);
	} finally {
		cleanup(cwd);
	}
});

test("pruneStale removes old terminal harness directories", () => {
	const cwd = createTempWorkspace();
	try {
		const oldDir = join(cwd, ".grub", "oldoldol");
		mkdirSync(oldDir, { recursive: true });
		const oldState = {
			version: 1,
			createdAt: Date.now() - 40 * 24 * 60 * 60 * 1000,
			lastPersistedAt: Date.now() - 40 * 24 * 60 * 60 * 1000,
			task: {
				id: "oldoldol",
				goal: "old",
				status: "complete",
				phase: "execution",
				startedAt: Date.now() - 40 * 24 * 60 * 60 * 1000,
				updatedAt: Date.now() - 40 * 24 * 60 * 60 * 1000,
				currentIteration: 1,
				awaitingTurn: false,
				consecutiveFailures: 0,
				maxIterations: 25,
				maxConsecutiveFailures: 3,
				harnessDirectory: oldDir,
				featureChecklistPath: join(oldDir, "feature-checklist.md"),
				featureListPath: join(oldDir, "feature-list.json"),
				stateFilePath: join(oldDir, "state.json"),
				progressLogPath: join(oldDir, "progress-log.md"),
				initScriptPath: join(oldDir, "init.sh"),
			},
		};
		writeFileSync(join(oldDir, "state.json"), JSON.stringify(oldState));

		const removed = pruneStale(cwd);
		assert.equal(removed, 1);
		assert.equal(existsSync(oldDir), false);
	} finally {
		cleanup(cwd);
	}
});

test("migrateChecklistToFeatureList converts legacy markdown checklist", () => {
	const cwd = createTempWorkspace();
	try {
		const checklistPath = join(cwd, "feature-checklist.md");
		writeFileSync(
			checklistPath,
			[
				"# Feature Checklist",
				"",
				"- [ ] feature one",
				"- [x] feature two done",
				"- [ ] feature three",
				"",
				"misc text",
			].join("\n"),
		);
		const migrated = migrateChecklistToFeatureList(checklistPath, "goal");
		assert.ok(migrated);
		assert.equal(migrated.features.length, 3);
		assert.equal(migrated.features[0].description, "feature one");
		assert.equal(migrated.features[1].passes, true);
		assert.equal(migrated.features[2].passes, false);
		assert.equal(migrated.goal, "goal");
	} finally {
		cleanup(cwd);
	}
});

test("parseGrubCommand handles start with flags, status --json, resume", () => {
	const start = parseGrubCommand("Implement feature X --max-iter 40 --max-fail 5");
	assert.equal(start.type, "start");
	if (start.type === "start") {
		assert.equal(start.goal, "Implement feature X");
		assert.equal(start.maxIterations, 40);
		assert.equal(start.maxConsecutiveFailures, 5);
	}

	const statusJson = parseGrubCommand("status --json");
	assert.equal(statusJson.type, "status");
	if (statusJson.type === "status") {
		assert.equal(statusJson.json, true);
	}

	const resume = parseGrubCommand("resume");
	assert.equal(resume.type, "resume");

	const stop = parseGrubCommand("stop");
	assert.equal(stop.type, "stop");

	const help = parseGrubCommand("");
	assert.equal(help.type, "help");
});

test("buildGrubHelp supports Chinese output", () => {
	const help = buildGrubHelp("缺少 grub 目标。", "zh");
	assert.match(help, /用法/);
	assert.match(help, /启动一个自主长任务/);
});

test("persisted state reflects start and finishTurn", () => {
	const cwd = createTempWorkspace();
	try {
		const controller = new GrubController();
		const task = controller.start("persist flow", cwd);
		controller.markDispatched();
		controller.finishTurn({
			status: "continue",
			summary: "init done",
			nextStep: "execute",
		});
		const loaded = loadState(task.stateFilePath);
		assert.ok(loaded);
		assert.equal(loaded.task.phase, "execution");
		assert.equal(loaded.task.currentIteration, 2);
		// Raw JSON should also contain lastDecision.summary for debuggability.
		const raw = readFileSync(task.stateFilePath, "utf-8");
		assert.match(raw, /"init done"/);
	} finally {
		cleanup(cwd);
	}
});
