import assert from "node:assert/strict";
import test from "node:test";
import { TUI } from "../core/lib/tui/src/tui.js";
import type { Terminal } from "../core/lib/tui/src/terminal.js";

class FakeTerminal implements Terminal {
	public writes: string[] = [];
	public kittyProtocolActive = false;
	public columns = 80;
	public rows = 24;

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

test("awaitRender resolves after a queued render flushes", async () => {
	const terminal = new FakeTerminal();
	const tui = new TUI(terminal, false) as any;
	let rendered = false;

	tui.doRender = () => {
		rendered = true;
	};

	tui.requestRender();
	const renderPromise = tui.awaitRender();

	assert.equal(rendered, false);
	await renderPromise;
	assert.equal(rendered, true);
});
