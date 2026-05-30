/**
 * [WHO]: TUI viewport render regression tests
 * [FROM]: Depends on node:test, core/lib/tui/src/tui.ts, core/lib/tui/test/virtual-terminal.ts
 * [TO]: Consumed by repository test runner
 * [HERE]: test/tui-viewport-render.test.ts - verifies bottom input updates overwrite the same visible row instead of stacking
 */

import assert from "node:assert/strict";
import test from "node:test";
import { CURSOR_MARKER, TUI, type Component } from "../core/lib/tui/src/tui.js";
import { VirtualTerminal } from "../core/lib/tui/test/virtual-terminal.js";

class TestComponent implements Component {
	public lines: string[] = [];

	render(): string[] {
		return this.lines;
	}

	invalidate(): void {}
}

test("tui bottom input updates overwrite the same visible row while typing", async () => {
	const terminal = new VirtualTerminal(40, 6);
	const tui = new TUI(terminal);
	const component = new TestComponent();
	tui.addChild(component);

	const renderInput = (text: string) => {
		component.lines = Array.from({ length: 12 }, (_, index) => (
			index === 11 ? `${text}${CURSOR_MARKER}` : `L${index}`
		));
	};

	renderInput("");
	tui.start();
	await terminal.flush();

	for (const text of ["现", "现在", "现在几", "现在几点", "现在几点了"]) {
		renderInput(text);
		tui.requestRender();
		await terminal.flush();

		const viewport = terminal.getViewport();
		assert.deepEqual(viewport.slice(0, 5), ["L6", "L7", "L8", "L9", "L10"]);
		assert.equal(viewport[5], text);
	}

	tui.stop();
});
