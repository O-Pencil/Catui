import assert from "node:assert/strict";
import test from "node:test";
import type { Theme } from "../modes/interactive/theme/theme.js";
import type { TUI } from "@catui/tui";
import { TaskStatusPanelComponent, type TaskStatusEntry } from "../modes/interactive/components/task-status-panel.js";

const noopTheme: Theme = {
	fg: (_color, text) => text,
	bg: (_color, text) => text,
	bold: (text) => text,
	italic: (text) => text,
	underline: (text) => text,
	inverse: (text) => text,
	strikethrough: (text) => text,
	getFgAnsi: () => "",
	getBgAnsi: () => "",
	getColorMode: () => "truecolor",
	getThinkingBorderColor: () => (text) => text,
	getBashModeBorderColor: () => (text) => text,
};

function createMockTUI(): {
	ui: TUI;
} {
	const ui = {
		requestRender: () => {},
		terminal: {
			columns: 80,
			rows: 24,
		},
	} as unknown as TUI;
	return {
		ui,
	};
}

function getHeaderLine(panel: TaskStatusPanelComponent): string {
	const headerComponent = (panel as unknown as {
		headerText: { render(width: number): string[] };
	}).headerText;
	return headerComponent.render(80)[0]?.trim() ?? "";
}

test("TaskStatusPanelComponent animates task spinner using ♫/♬", () => {
	const originalSetInterval = globalThis.setInterval;
	const originalClearInterval = globalThis.clearInterval;
	let intervalCallbacks: Array<() => void> = [];
	let intervalCalls = 0;

	(globalThis as unknown as { setInterval: typeof setInterval }).setInterval = ((callback) => {
		const id = intervalCalls + 1;
		intervalCalls += 1;
		intervalCallbacks.push(callback as () => void);
		return id;
	}) as typeof setInterval;
	(globalThis as unknown as { clearInterval: typeof clearInterval }).clearInterval = (() => {
		return;
	}) as typeof clearInterval;

	try {
		const { ui } = createMockTUI();
		const panel = new TaskStatusPanelComponent(ui, noopTheme);
		const runningTask: TaskStatusEntry[] = [
			{
				id: "1",
				subject: "Task 1",
				status: "in_progress",
				activeForm: "Running task",
			},
		];

		panel.update(runningTask);
		assert.ok(getHeaderLine(panel).includes("♫"));
		assert.equal(intervalCalls, 1, "spinner should register one interval on first start");

		// Re-render with running tasks should not start another interval
		panel.update(runningTask);
		assert.equal(intervalCalls, 1, "spinner interval should not duplicate while running");

		// Manual tick should alternate symbol
		const firstTick = intervalCallbacks[0];
		assert.ok(firstTick, "expected spinner timer callback");
		firstTick();
		assert.ok(getHeaderLine(panel).includes("♬"));
		assert.equal(getHeaderLine(panel).includes("♫"), false);
	} finally {
		globalThis.setInterval = originalSetInterval;
		globalThis.clearInterval = originalClearInterval;
	}
});

test("TaskStatusPanelComponent switches to completed icon and clears spinner timer", () => {
	const originalSetInterval = globalThis.setInterval;
	const originalClearInterval = globalThis.clearInterval;
	let clearCount = 0;
	let intervalCalls = 0;

	(globalThis as unknown as { setInterval: typeof setInterval }).setInterval = ((callback) => {
		const id = intervalCalls + 1;
		intervalCalls += 1;
		return id;
	}) as typeof setInterval;
	(globalThis as unknown as { clearInterval: typeof clearInterval }).clearInterval = (() => {
		clearCount += 1;
	}) as typeof clearInterval;

	try {
		const { ui } = createMockTUI();
		const panel = new TaskStatusPanelComponent(ui, noopTheme);
		panel.update([
			{
				id: "1",
				subject: "Task 1",
				status: "in_progress",
			},
		]);

		panel.update([
			{
				id: "1",
				subject: "Task 1",
				status: "completed",
			},
		]);

		assert.equal(clearCount, 1, "spinner interval should be cleared when no tasks are running");
		assert.equal(intervalCalls, 1, "no duplicate intervals should be created for completed state");
		assert.ok(getHeaderLine(panel).includes("✔"), "completed tasks should render check icon");
	} finally {
		globalThis.setInterval = originalSetInterval;
		globalThis.clearInterval = originalClearInterval;
	}
});

test("TaskStatusPanelComponent renders completed tasks with strikethrough", () => {
	const originalSetInterval = globalThis.setInterval;
	const originalClearInterval = globalThis.clearInterval;
	(globalThis as unknown as { setInterval: typeof setInterval }).setInterval = (() => 1) as typeof setInterval;
	(globalThis as unknown as { clearInterval: typeof clearInterval }).clearInterval = (() => {}) as typeof clearInterval;

	try {
		const { ui } = createMockTUI();
		const themedStrike: Theme = {
			...noopTheme,
			strikethrough: (text) => `~~${text}~~`,
		};
		const panel = new TaskStatusPanelComponent(ui, themedStrike);
		panel.update([
			{ id: "1", subject: "Done task", status: "completed" },
		]);

		const headerComponent = (panel as unknown as { headerText: { render(width: number): string[] } }).headerText;
		const taskLines = (panel as unknown as { taskLines: Array<{ render(width: number): string[] }> }).taskLines;

		const header = headerComponent.render(80)[0] ?? "";
		assert.ok(!header.includes("\x1b[9m"), "header should not have strikethrough");

		assert.equal(taskLines.length, 1, "should have one task line");
		const taskLine = taskLines[0].render(80)[0] ?? "";
		assert.ok(taskLine.includes("~~Done task~~"), "completed task should have strikethrough styling");
	} finally {
		globalThis.setInterval = originalSetInterval;
		globalThis.clearInterval = originalClearInterval;
	}
});

test("TaskStatusPanelComponent uses theme strikethrough for completed task subjects", () => {
	const originalSetInterval = globalThis.setInterval;
	const originalClearInterval = globalThis.clearInterval;
	(globalThis as unknown as { setInterval: typeof setInterval }).setInterval = (() => 1) as typeof setInterval;
	(globalThis as unknown as { clearInterval: typeof clearInterval }).clearInterval = (() => {}) as typeof clearInterval;

	try {
		const { ui } = createMockTUI();
		const themedStrike: Theme = {
			...noopTheme,
			strikethrough: (text) => `<strike>${text}</strike>`,
		};
		const panel = new TaskStatusPanelComponent(ui, themedStrike);
		panel.update([
			{ id: "1", subject: "Done task", status: "completed" },
		]);

		const taskLines = (panel as unknown as { taskLines: Array<{ render(width: number): string[] }> }).taskLines;
		const taskLine = taskLines[0].render(80)[0] ?? "";
		assert.ok(taskLine.includes("<strike>Done task</strike>"), "completed subject should be styled through theme.strikethrough");
	} finally {
		globalThis.setInterval = originalSetInterval;
		globalThis.clearInterval = originalClearInterval;
	}
});

test("TaskStatusPanelComponent prioritizes recently completed tasks", () => {
	const originalSetInterval = globalThis.setInterval;
	const originalClearInterval = globalThis.clearInterval;
	(globalThis as unknown as { setInterval: typeof setInterval }).setInterval = (() => 1) as typeof setInterval;
	(globalThis as unknown as { clearInterval: typeof clearInterval }).clearInterval = (() => {}) as typeof clearInterval;

	try {
		const { ui } = createMockTUI();
		const panel = new TaskStatusPanelComponent(ui, noopTheme);

		// First update: all completed (initial seed, no transition)
		panel.update([
			{ id: "1", subject: "Old completed", status: "completed" },
			{ id: "2", subject: "Old completed 2", status: "completed" },
		]);

		// Second update: task 3 just completed (transition detected)
		panel.update([
			{ id: "1", subject: "Old completed", status: "completed" },
			{ id: "2", subject: "Old completed 2", status: "completed" },
			{ id: "3", subject: "Just completed", status: "completed" },
		]);

		const taskLines = (panel as unknown as { taskLines: Array<{ render(width: number): string[] }> }).taskLines;
		assert.equal(taskLines.length, 3, "should have three task lines");

		// First line should be the recently completed task (id: 3)
		const firstLine = taskLines[0].render(80)[0] ?? "";
		assert.ok(firstLine.includes("Just completed"), "recently completed task should be first");

		// Last line should be older completed tasks
		const lastLine = taskLines[2].render(80)[0] ?? "";
		assert.ok(lastLine.includes("Old completed"), "older completed task should be last");
	} finally {
		globalThis.setInterval = originalSetInterval;
		globalThis.clearInterval = originalClearInterval;
	}
});
