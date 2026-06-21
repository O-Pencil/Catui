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
