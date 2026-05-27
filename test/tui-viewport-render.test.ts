/**
 * [WHO]: TUI viewport render regression tests
 * [FROM]: Depends on node:test, packages/tui/src/tui.ts
 * [TO]: Consumed by repository test runner
 * [HERE]: test/tui-viewport-render.test.ts - verifies cursor movement stays aligned when viewport shifts after content growth
 */

import assert from "node:assert/strict";
import test from "node:test";
import { TUI } from "../packages/tui/src/tui.js";
import type { Terminal } from "../packages/tui/src/terminal.js";

class FakeTerminal implements Terminal {
	public writes: string[] = [];
	public kittyProtocolActive = false;
	public columns = 80;
	public rows = 3;

	start(): void {}
	stop(): void {}
	async drainInput(): Promise<void> {}
	write(data: string): void {
		this.writes.push(data);
	}
	moveBy(): void {}
	hideCursor(): void {}
	showCursor(): void {}
	clearLine(): void {}
	clearFromCursor(): void {}
	clearScreen(): void {}
	setTitle(): void {}
}

test("tui cursor positioning uses screen rows when viewport shifts", () => {
	const terminal = new FakeTerminal();
	const tui = new TUI(terminal, false) as any;

	tui.hardwareCursorRow = 2;
	tui.positionHardwareCursor(
		{ row: 3, col: 0 },
		4,
		0,
		1,
		3,
	);

	assert.equal(terminal.writes.at(-1), "\x1b[1G");
	assert.equal(tui.hardwareCursorRow, 3);
});

test("tui cursor positioning clamps offscreen logical rows to visible screen rows", () => {
	const terminal = new FakeTerminal();
	const tui = new TUI(terminal, false) as any;

	tui.hardwareCursorRow = 100;
	tui.positionHardwareCursor(
		{ row: 8, col: 0 },
		11,
		0,
		6,
		3,
	);

	assert.equal(terminal.writes.at(-1), "\x1b[1G");
	assert.equal(tui.hardwareCursorRow, 8);
});
