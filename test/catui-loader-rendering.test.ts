import assert from "node:assert/strict";
import test from "node:test";
import type { TUI } from "@catui/tui";
import { CatuiLoader } from "../modes/interactive/components/catui-loader.js";
import type { Theme } from "../modes/interactive/theme/theme.js";

const plainTheme = {
	fg: (_color: string, value: string) => value,
} as Theme;

test("CatuiLoader constructor prepares first frame without requesting a render before mount", () => {
	const originalSetInterval = globalThis.setInterval;
	const originalClearInterval = globalThis.clearInterval;
	const originalSetTimeout = globalThis.setTimeout;
	let renderRequests = 0;

	(globalThis as unknown as { setInterval: typeof setInterval }).setInterval = ((() => 1) as unknown) as typeof setInterval;
	(globalThis as unknown as { clearInterval: typeof clearInterval }).clearInterval = ((() => {}) as unknown) as typeof clearInterval;
	(globalThis as unknown as { setTimeout: typeof setTimeout }).setTimeout = ((() => 1) as unknown) as typeof setTimeout;

	try {
		const ui = { requestRender: () => { renderRequests += 1; } } as TUI;
		const loader = new CatuiLoader(ui, plainTheme, "Working...");

		assert.equal(renderRequests, 0);
		assert.ok(
			loader.render(40).some((line) => line.includes("◌ Working...")),
			"expected constructor to prepare the first spinner frame",
		);
		loader.stop();
	} finally {
		globalThis.setInterval = originalSetInterval;
		globalThis.clearInterval = originalClearInterval;
		globalThis.setTimeout = originalSetTimeout;
	}
});

test("CatuiLoader skips render for no-op working-message updates that do not reset stall state", () => {
	const originalSetInterval = globalThis.setInterval;
	const originalClearInterval = globalThis.clearInterval;
	const originalSetTimeout = globalThis.setTimeout;
	let renderRequests = 0;

	(globalThis as unknown as { setInterval: typeof setInterval }).setInterval = ((() => 1) as unknown) as typeof setInterval;
	(globalThis as unknown as { clearInterval: typeof clearInterval }).clearInterval = ((() => {}) as unknown) as typeof clearInterval;
	(globalThis as unknown as { setTimeout: typeof setTimeout }).setTimeout = ((() => 1) as unknown) as typeof setTimeout;

	try {
		const ui = { requestRender: () => { renderRequests += 1; } } as TUI;
		const loader = new CatuiLoader(ui, plainTheme, "Working...");

		loader.setMessage("Working...", { resetStallTimer: false });

		assert.equal(renderRequests, 0);
		loader.stop();
	} finally {
		globalThis.setInterval = originalSetInterval;
		globalThis.clearInterval = originalClearInterval;
		globalThis.setTimeout = originalSetTimeout;
	}
});

test("CatuiLoader stop clears delayed tip timeout as well as animation timers", () => {
	const originalSetInterval = globalThis.setInterval;
	const originalClearInterval = globalThis.clearInterval;
	const originalSetTimeout = globalThis.setTimeout;
	const originalClearTimeout = globalThis.clearTimeout;
	let timeoutClears = 0;
	let intervalClears = 0;
	let nextTimerId = 1;

	(globalThis as unknown as { setInterval: typeof setInterval }).setInterval = ((() => nextTimerId++) as unknown) as typeof setInterval;
	(globalThis as unknown as { clearInterval: typeof clearInterval }).clearInterval = ((() => {
		intervalClears += 1;
	}) as unknown) as typeof clearInterval;
	(globalThis as unknown as { setTimeout: typeof setTimeout }).setTimeout = ((() => nextTimerId++) as unknown) as typeof setTimeout;
	(globalThis as unknown as { clearTimeout: typeof clearTimeout }).clearTimeout = ((() => {
		timeoutClears += 1;
	}) as unknown) as typeof clearTimeout;

	try {
		const ui = { requestRender: () => {} } as TUI;
		const loader = new CatuiLoader(ui, plainTheme, "Working...");

		loader.stop();

		assert.equal(intervalClears, 2);
		assert.equal(timeoutClears, 1);
	} finally {
		globalThis.setInterval = originalSetInterval;
		globalThis.clearInterval = originalClearInterval;
		globalThis.setTimeout = originalSetTimeout;
		globalThis.clearTimeout = originalClearTimeout;
	}
});
