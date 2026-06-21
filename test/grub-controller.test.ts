import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { GrubController } from "../extensions/builtin/grub/grub-controller.js";
import { extractGrubDecision } from "../extensions/builtin/grub/grub-decision.js";
import {
	FeatureListDiffError,
	createInitialFeatureList,
	migrateChecklistToFeatureList,
	validateFeatureListDiff,
	writeFeatureList,
} from "../extensions/builtin/grub/grub-feature-list.js";
import { formatSnapshot, formatTaskState } from "../extensions/builtin/grub/grub-format.js";
import {
	discoverActiveTasks,
	loadState,
	persistState,
	pruneStale,
} from "../extensions/builtin/grub/grub-persistence.js";
import { parseGrubCommand } from "../extensions/builtin/grub/grub-parser.js";
import { buildGrubHelp } from "../extensions/builtin/grub/grub-parser.js";
import { resolveGrubTurn } from "../extensions/builtin/grub/grub-turn.js";

function createTempWorkspace(): string {
	return mkdtempSync(join(tmpdir(), "catui-grub-"));
}

function cleanup(path: string): void {
	rmSync(path, { recursive: true, force: true });
}

function featureList(goal: string, count = 15) {
	return {
		version: 1 as const,
		goal,
		features: Array.from({ length: count }, (_, index) => ({
			id: `feature-${index + 1}`,
			category: "functional" as const,
			description: `feature ${index + 1}`,
			steps: [`verify feature ${index + 1}`],
			passes: false,
		})),
	};
}

function enterExecutionPhase(controller: GrubController, goal: string, cwd: string) {
	const task = controller.start(goal, cwd);
	const baseline = featureList(task.goal);
	writeFeatureList(task.featureListPath, baseline);
	assert.equal(controller.validateFeatureListAfterTurn().ok, true);
	controller.markDispatched();
	const outcome = controller.finishTurn({
		status: "continue",
		summary: "initializer done",
		nextStep: "start execution",
	});
	assert.equal(outcome.action, "continue");
	return { task, baseline };
}

test("grub controller starts with initializer phase and harness paths", () => {
	const cwd = createTempWorkspace();
	try {
		const controller = new GrubController();
		const task = controller.start("Ship one safe incremental feature", cwd);

		assert.equal(task.phase, "initializer");
		assert.match(task.harnessDirectory, /[\\/]\.grub[\\/]/);
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

test("formatTaskState presents readable progress without raw state details", () => {
	const cwd = createTempWorkspace();
	try {
		const controller = new GrubController();
		const task = controller.start("Make grub status readable", cwd);
		writeFeatureList(task.featureListPath, {
			...featureList(task.goal),
			features: featureList(task.goal).features.map((feature, index) =>
				index === 0 ? { ...feature, passes: true, evidence: "verified" } : feature,
			),
		});
		task.lastDecision = {
			status: "continue",
			summary: "Finished the first visible check.",
			nextStep: "Work through the next item.",
		};

		const formatted = formatTaskState(task);
		assert.match(formatted, /Task: Make grub status readable/);
		assert.match(formatted, /Progress: 1\/15 checks done/);
		assert.match(formatted, /Next: Work through the next item/);
		assert.match(formatted, /Use \/grub status --json/);
		assert.doesNotMatch(formatted, /stateFile|awaitingTurn|initializer|GrubTaskState/);
	} finally {
		cleanup(cwd);
	}
});

test("formatSnapshot uses user-facing terminal state labels", () => {
	const cwd = createTempWorkspace();
	try {
		const controller = new GrubController();
		const task = controller.start("Readable terminal state", cwd);
		writeFeatureList(task.featureListPath, {
			...featureList(task.goal, 3),
			features: featureList(task.goal, 3).features.map((feature, index) =>
				index === 0 ? { ...feature, passes: true, evidence: "verified" } : feature,
			),
		});
		const snapshot = controller.stop("Stopped by user request.", "stopped");
		assert.ok(snapshot);
		const formatted = formatSnapshot(snapshot);
		assert.match(formatted, /State: stopped/);
		assert.match(formatted, /Progress: 1\/3 checks done/);
		assert.match(formatted, /Remaining: feature-2, feature-3/);
		assert.match(formatted, /Needs attention: Stopped by user request/);
		assert.doesNotMatch(formatted, /phase|stateFile|completedIterations/);
	} finally {
		cleanup(cwd);
	}
});

test("extractGrubDecision parses the last complete loop-state block", () => {
	const decision = extractGrubDecision([
		"older text",
		'<loop-state>{"status":"continue","summary":"old","nextStep":"old next"}</loop-state>',
		"newer text",
		'<loop-state>{"status":"complete","summary":"done"}</loop-state>',
	].join("\n"));

	assert.deepEqual(decision, { status: "complete", summary: "done" });
});

test("extractGrubDecision accepts fenced JSON and rejects incomplete continue", () => {
	const fenced = extractGrubDecision([
		"<loop-state>",
		"```json",
		'{"status":"continue","summary":"round done","nextStep":"next item"}',
		"```",
		"</loop-state>",
	].join("\n"));
	assert.deepEqual(fenced, { status: "continue", summary: "round done", nextStep: "next item" });

	assert.equal(
		extractGrubDecision('<loop-state>{"status":"continue","summary":"missing next"}</loop-state>'),
		undefined,
	);
	assert.equal(extractGrubDecision('<loop-state>{"status":"weird","summary":"bad"}</loop-state>'), undefined);
});

test("extractGrubDecision ignores dangling or malformed loop-state text", () => {
	assert.equal(extractGrubDecision('<loop-state>{"status":"complete","summary":"missing close"}'), undefined);
	assert.equal(extractGrubDecision('<loop-state>{not json}</loop-state>'), undefined);
});

test("resolveGrubTurn retries with readable update when loop-state is missing", () => {
	const cwd = createTempWorkspace();
	try {
		const controller = new GrubController();
		controller.start("Recover from malformed round output", cwd);
		controller.markDispatched();

		const result = resolveGrubTurn(controller, "No structured summary here.");

		assert.equal(result.dispatchNext, true);
		assert.equal(controller.getActiveTask()?.consecutiveFailures, 1);
		assert.match(result.events[0]?.message ?? "", /could not read the round summary/i);
		assert.equal(result.events[0]?.level, "warning");
	} finally {
		cleanup(cwd);
	}
});

test("resolveGrubTurn downgrades premature complete when checklist still has pending work", () => {
	const cwd = createTempWorkspace();
	try {
		const controller = new GrubController();
		const { task, baseline } = enterExecutionPhase(controller, "Do all feature-list work", cwd);
		writeFeatureList(task.featureListPath, {
			...baseline,
			features: baseline.features.map((feature, index) =>
				index === 0 ? { ...feature, passes: true, evidence: "verified first check" } : feature,
			),
		});
		controller.markDispatched();

		const result = resolveGrubTurn(
			controller,
			'<loop-state>{"status":"complete","summary":"Everything is done."}</loop-state>',
		);

		const active = controller.getActiveTask();
		assert.equal(result.dispatchNext, true);
		assert.ok(active);
		assert.equal(active.lastDecision?.status, "continue");
		assert.match(active.lastDecision?.nextStep ?? "", /feature-2/);
		assert.match(result.events.map((event) => event.message).join("\n"), /Not done yet/);
	} finally {
		cleanup(cwd);
	}
});

test("resolveGrubTurn stops when complete decision matches fully passing checklist", () => {
	const cwd = createTempWorkspace();
	try {
		const controller = new GrubController();
		const { task, baseline } = enterExecutionPhase(controller, "Finish all feature-list work", cwd);
		writeFeatureList(task.featureListPath, {
			...baseline,
			features: baseline.features.map((feature) => ({ ...feature, passes: true, evidence: "verified" })),
		});
		controller.markDispatched();

		const result = resolveGrubTurn(
			controller,
			'<loop-state>{"status":"complete","summary":"All checks are passing."}</loop-state>',
		);

		assert.equal(result.dispatchNext, false);
		assert.equal(controller.getActiveTask(), undefined);
		assert.equal(controller.getState().lastTerminal?.status, "complete");
		assert.match(result.events.map((event) => event.message).join("\n"), /State: finished/);
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

	const twoItemBaseline = featureList("goal", 2);
	const reordered = {
		...twoItemBaseline,
		features: [...twoItemBaseline.features].reverse(),
	};
	assert.throws(() => validateFeatureListDiff(twoItemBaseline, reordered), FeatureListDiffError);
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

test("grub controller records initializer feature-list baseline", () => {
	const cwd = createTempWorkspace();
	try {
		const controller = new GrubController();
		const task = controller.start("Multi feature goal", cwd);
		writeFeatureList(task.featureListPath, featureList(task.goal));

		const result = controller.validateFeatureListAfterTurn();
		assert.equal(result.ok, true);
		assert.equal(controller.getActiveTask()?.featureListBaseline?.features.length, 15);
	} finally {
		cleanup(cwd);
	}
});

test("grub controller rejects weak initializer feature-list", () => {
	const cwd = createTempWorkspace();
	try {
		const controller = new GrubController();
		const task = controller.start("Multi feature goal", cwd);
		writeFeatureList(task.featureListPath, featureList(task.goal, 1));

		const result = controller.validateFeatureListAfterTurn();
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.match(result.message, /15-40/);
		}
	} finally {
		cleanup(cwd);
	}
});

test("grub controller reports malformed feature-list JSON location and context", () => {
	const cwd = createTempWorkspace();
	try {
		const controller = new GrubController();
		const task = controller.start("Diagnose malformed JSON", cwd);
		writeFileSync(
			task.featureListPath,
			[
				"{",
				'  "version": 1,',
				'  "goal": "Diagnose malformed JSON",',
				'  "features": [',
				'    {"id": "broken" "category": "functional"}',
				"  ]",
				"}",
			].join("\n"),
			"utf-8",
		);

		const result = controller.validateFeatureListAfterTurn();
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.match(result.message, /line 5/i);
			assert.match(result.message, />\s*5\s+\|/);
			assert.match(result.message, /"id": "broken"/);
		}
	} finally {
		cleanup(cwd);
	}
});

test("initializer auto-sanitizes pre-marked passes and stray evidence instead of failing", () => {
	const cwd = createTempWorkspace();
	try {
		const controller = new GrubController();
		const task = controller.start("Sanitize pre-marked passes", cwd);
		const dirty = featureList(task.goal);
		dirty.features[0] = { ...dirty.features[0], passes: true, evidence: "should be dropped" };
		writeFeatureList(task.featureListPath, dirty);

		const result = controller.validateFeatureListAfterTurn();
		assert.equal(result.ok, true);
		const baseline = controller.getActiveTask()?.featureListBaseline;
		assert.ok(baseline);
		assert.equal(baseline.features.every((feature) => !feature.passes), true);

		const onDisk = JSON.parse(readFileSync(task.featureListPath, "utf-8"));
		assert.equal(onDisk.features[0].passes, false);
		assert.equal(onDisk.features[0].evidence, undefined);
	} finally {
		cleanup(cwd);
	}
});

test("initializer auto-restores a mismatched goal instead of failing", () => {
	const cwd = createTempWorkspace();
	try {
		const controller = new GrubController();
		const task = controller.start("Authoritative goal text", cwd);
		writeFeatureList(task.featureListPath, featureList("a totally different goal"));

		const result = controller.validateFeatureListAfterTurn();
		assert.equal(result.ok, true);
		assert.equal(controller.getActiveTask()?.featureListBaseline?.goal, task.goal);

		const onDisk = JSON.parse(readFileSync(task.featureListPath, "utf-8"));
		assert.equal(onDisk.goal, task.goal);
	} finally {
		cleanup(cwd);
	}
});

test("initializer phase tolerates more consecutive failures than execution", () => {
	const cwd = createTempWorkspace();
	try {
		const controller = new GrubController();
		controller.start("Forgiving initializer budget", cwd, { maxConsecutiveFailures: 3, maxIterations: 50 });
		for (let i = 0; i < 4; i += 1) {
			controller.markDispatched();
			assert.equal(controller.recordFailure("structural problem").action, "continue");
		}
		controller.markDispatched();
		const stopped = controller.recordFailure("structural problem");
		assert.equal(stopped.action, "stop");
		assert.equal(stopped.snapshot?.status, "failed");
	} finally {
		cleanup(cwd);
	}
});

test("grub controller rejects immutable feature-list mutations after initializer", () => {
	const cwd = createTempWorkspace();
	try {
		const controller = new GrubController();
		const task = controller.start("Multi feature goal", cwd);
		const baseline = featureList(task.goal);
		writeFeatureList(task.featureListPath, baseline);
		assert.equal(controller.validateFeatureListAfterTurn().ok, true);
		controller.markDispatched();
		controller.finishTurn({
			status: "continue",
			summary: "initializer done",
			nextStep: "first feature",
		});

		writeFeatureList(task.featureListPath, {
			...baseline,
			features: baseline.features.map((feature, index) =>
				index === 0 ? { ...feature, description: "rewritten description" } : feature,
			),
		});
		const result = controller.validateFeatureListAfterTurn();
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.match(result.message, /description/);
		}
	} finally {
		cleanup(cwd);
	}
});

test("grub controller accepts passes and evidence updates after initializer", () => {
	const cwd = createTempWorkspace();
	try {
		const controller = new GrubController();
		const task = controller.start("Multi feature goal", cwd);
		const baseline = featureList(task.goal);
		writeFeatureList(task.featureListPath, baseline);
		assert.equal(controller.validateFeatureListAfterTurn().ok, true);
		controller.markDispatched();
		controller.finishTurn({
			status: "continue",
			summary: "initializer done",
			nextStep: "first feature",
		});

		writeFeatureList(task.featureListPath, {
			...baseline,
			features: baseline.features.map((feature, index) =>
				index === 0 ? { ...feature, passes: true, evidence: "node --test" } : feature,
			),
		});
		assert.equal(controller.validateFeatureListAfterTurn().ok, true);
		assert.equal(controller.getActiveTask()?.featureListBaseline?.features[0]?.passes, true);
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
		task.featureListBaseline = featureList(task.goal);
		persistState(task);
		const loaded = loadState(task.stateFilePath);
		assert.ok(loaded);
		assert.equal(loaded.task.id, task.id);
		assert.equal(loaded.task.goal, task.goal);
		assert.equal(loaded.task.phase, "initializer");
		assert.equal(loaded.task.featureListBaseline?.features.length, 15);
		assert.equal(loaded.version, 1);
	} finally {
		cleanup(cwd);
	}
});

test("loadState rejects malformed persisted task state", () => {
	const cwd = createTempWorkspace();
	try {
		const statePath = join(cwd, ".grub", "badbad00", "state.json");
		mkdirSync(join(cwd, ".grub", "badbad00"), { recursive: true });
		writeFileSync(
			statePath,
			JSON.stringify({
				version: 1,
				createdAt: Date.now(),
				lastPersistedAt: Date.now(),
				task: {
					id: "badbad00",
					goal: "bad",
					locale: "en",
					status: "running",
					phase: "wrong-phase",
					startedAt: Date.now(),
					updatedAt: Date.now(),
					currentIteration: 1,
					awaitingTurn: false,
					consecutiveFailures: 0,
					maxIterations: 25,
					maxConsecutiveFailures: 3,
					harnessDirectory: join(cwd, ".grub", "badbad00"),
					featureChecklistPath: join(cwd, ".grub", "badbad00", "feature-checklist.md"),
					featureListPath: join(cwd, ".grub", "badbad00", "feature-list.json"),
					stateFilePath: statePath,
					progressLogPath: join(cwd, ".grub", "badbad00", "progress-log.md"),
					initScriptPath: join(cwd, ".grub", "badbad00", "init.sh"),
				},
			}),
		);

		assert.equal(loadState(statePath), null);
		assert.equal(discoverActiveTasks(cwd).length, 0);
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
					locale: "en",
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

test("parseGrubCommand preserves quoted goals and literal unknown flags", () => {
	const quoted = parseGrubCommand('"Implement feature -- literally" --max-iter=7 --max-fail 2');
	assert.equal(quoted.type, "start");
	if (quoted.type === "start") {
		assert.equal(quoted.goal, "Implement feature -- literally");
		assert.equal(quoted.maxIterations, 7);
		assert.equal(quoted.maxConsecutiveFailures, 2);
	}

	const unknownFlag = parseGrubCommand("Implement --keep-this literal --max-iter 3");
	assert.equal(unknownFlag.type, "start");
	if (unknownFlag.type === "start") {
		assert.equal(unknownFlag.goal, "Implement --keep-this literal");
		assert.equal(unknownFlag.maxIterations, 3);
	}
});

test("buildGrubHelp supports Chinese output", () => {
	const help = buildGrubHelp("缺少 grub 目标。", "zh");
	assert.match(help, /用法/);
	assert.match(help, /启动一个聚焦的长任务/);
	assert.match(help, /完整保存细节/);
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

test("blocked decision rejected until threshold reached, then stops", () => {
	const cwd = createTempWorkspace();
	try {
		const controller = new GrubController();
		const { task } = enterExecutionPhase(controller, "blocked threshold test", cwd);

		// First two blocked attempts should be rejected and forced to continue
		for (let i = 1; i <= 2; i++) {
			controller.markDispatched();
			const result = controller.finishTurn({
				status: "blocked",
				summary: "cannot proceed",
				nextStep: "need user input",
			});
			assert.equal(result.action, "continue");
			const active = controller.getActiveTask();
			assert.ok(active);
			assert.equal(active.lastDecision?.status, "continue");
			assert.match(active.lastDecision?.nextStep ?? "", /rejected/i);
			assert.equal(active.consecutiveBlockedAttempts, i);
		}

		// Third blocked attempt should actually stop
		controller.markDispatched();
		const result = controller.finishTurn({
			status: "blocked",
			summary: "still stuck",
		});
		assert.equal(result.action, "stop");
		assert.ok(result.snapshot);
		assert.equal(result.snapshot.status, "blocked");
		assert.equal(result.snapshot.consecutiveBlockedAttempts, 3);
	} finally {
		cleanup(cwd);
	}
});

test("blocked counter resets after a successful continue", () => {
	const cwd = createTempWorkspace();
	try {
		const controller = new GrubController();
		const { task } = enterExecutionPhase(controller, "blocked reset test", cwd);

		// One blocked attempt
		controller.markDispatched();
		controller.finishTurn({ status: "blocked", summary: "stuck" });
		assert.equal(controller.getActiveTask()?.consecutiveBlockedAttempts, 1);

		// Successful continue resets counter
		controller.markDispatched();
		controller.finishTurn({ status: "continue", summary: "made progress", nextStep: "next" });
		assert.equal(controller.getActiveTask()?.consecutiveBlockedAttempts, 0);
	} finally {
		cleanup(cwd);
	}
});

test("getActiveTask returns shallow copy", () => {
	const cwd = createTempWorkspace();
	try {
		const controller = new GrubController();
		controller.start("shallow copy test", cwd);
		const copy1 = controller.getActiveTask();
		const copy2 = controller.getActiveTask();
		assert.ok(copy1);
		assert.ok(copy2);
		assert.notEqual(copy1, copy2);
		assert.deepEqual(copy1, copy2);
	} finally {
		cleanup(cwd);
	}
});

test("completedIterations accounts for awaitingTurn", () => {
	const cwd = createTempWorkspace();
	try {
		const controller = new GrubController();
		controller.start("iteration count test", cwd);
		controller.markDispatched();
		// Stop while awaitingTurn=true (iteration 1 was dispatched but not finished)
		const snapshot = controller.stop("user cancelled", "stopped");
		assert.ok(snapshot);
		// When awaiting, the dispatched iteration hasn't completed
		assert.equal(snapshot.completedIterations, 0);
	} finally {
		cleanup(cwd);
	}
});

test("completedIterations counts finished iterations", () => {
	const cwd = createTempWorkspace();
	try {
		const controller = new GrubController();
		// enterExecutionPhase does start + markDispatched + finishTurn (initializer→execution)
		enterExecutionPhase(controller, "iteration count test 2", cwd);
		// That's 1 completed iteration; now do a second
		controller.markDispatched();
		controller.finishTurn({ status: "continue", summary: "done", nextStep: "next" });
		const snapshot = controller.stop("user cancelled", "stopped");
		assert.ok(snapshot);
		// enterExecutionPhase completes iteration 1 (initializer→execution), this one completes iteration 2
		assert.ok(snapshot.completedIterations >= 2, `expected >=2, got ${snapshot.completedIterations}`);
	} finally {
		cleanup(cwd);
	}
});

test("finishTurn with complete does not advance to next iteration", () => {
	const cwd = createTempWorkspace();
	try {
		const controller = new GrubController();
		const { task, baseline } = enterExecutionPhase(controller, "complete no advance", cwd);
		writeFeatureList(task.featureListPath, {
			...baseline,
			features: baseline.features.map((f) => ({ ...f, passes: true, evidence: "verified" })),
		});
		controller.markDispatched();
		const iterBefore = controller.getActiveTask()?.currentIteration;
		controller.finishTurn({ status: "complete", summary: "all done" });
		// Task stopped, no iteration advancement
		assert.equal(controller.getActiveTask(), undefined);
		assert.equal(controller.getState().lastTerminal?.status, "complete");
	} finally {
		cleanup(cwd);
	}
});

test("validateFeatureListDiff rejects evidence removal", () => {
	const before = featureList("goal", 2);
	before.features[0] = { ...before.features[0], passes: true, evidence: "some proof" };
	const after = {
		...before,
		features: before.features.map((f, i) => (i === 0 ? { ...f, evidence: undefined } : f)),
	};
	assert.throws(() => validateFeatureListDiff(before, after), FeatureListDiffError);
});

test("consecutiveBlockedAttempts persists across round trips", () => {
	const cwd = createTempWorkspace();
	try {
		const controller = new GrubController();
		const { task } = enterExecutionPhase(controller, "persist blocked count", cwd);

		controller.markDispatched();
		controller.finishTurn({ status: "blocked", summary: "stuck" });

		const loaded = loadState(task.stateFilePath);
		assert.ok(loaded);
		assert.equal(loaded.task.consecutiveBlockedAttempts, 1);
	} finally {
		cleanup(cwd);
	}
});
