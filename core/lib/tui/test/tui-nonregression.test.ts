import assert from "node:assert";
import { describe, it } from "node:test";
import { resetCapabilitiesCache } from "../src/terminal-image.js";
import { CURSOR_MARKER, type Component, TUI } from "../src/tui.js";
import { VirtualTerminal } from "./virtual-terminal.js";

class MutableComponent implements Component {
	lines: string[] = [];

	render(_width: number): string[] {
		return this.lines;
	}

	invalidate(): void {}
}

class CursorComponent implements Component {
	render(_width: number): string[] {
		return [`prompt ${CURSOR_MARKER}`];
	}

	invalidate(): void {}
}

class OverlayComponent implements Component {
	render(_width: number): string[] {
		return ["overlay"];
	}

	invalidate(): void {}
}

class CountingTerminal extends VirtualTerminal {
	nonEmptyWrites = 0;

	override write(data: string): void {
		if (data.length > 0) {
			this.nonEmptyWrites += 1;
		}
		super.write(data);
	}

	override hideCursor(): void {
		this.nonEmptyWrites += 1;
		super.hideCursor();
	}

	override showCursor(): void {
		this.nonEmptyWrites += 1;
		super.showCursor();
	}

	resetWriteCount(): void {
		this.nonEmptyWrites = 0;
	}
}

async function renderAndFlush(tui: TUI, terminal: VirtualTerminal): Promise<string[]> {
	await tui.awaitRender();
	await terminal.flush();
	return terminal.getViewport();
}

function countLine(viewport: string[], text: string): number {
	return viewport.filter((line) => line.trim() === text).length;
}

async function withKittyCapabilities(fn: () => Promise<void>): Promise<void> {
	const previousKittyWindowId = process.env.KITTY_WINDOW_ID;
	process.env.KITTY_WINDOW_ID = "test-window";
	resetCapabilitiesCache();
	try {
		await fn();
	} finally {
		if (previousKittyWindowId === undefined) {
			delete process.env.KITTY_WINDOW_ID;
		} else {
			process.env.KITTY_WINDOW_ID = previousKittyWindowId;
		}
		resetCapabilitiesCache();
	}
}

describe("TUI rendering non-regressions", () => {
	it("does not duplicate stable rows across repeated render requests", async () => {
		const terminal = new VirtualTerminal(40, 8);
		const tui = new TUI(terminal);
		const component = new MutableComponent();
		component.lines = ["alpha", "beta"];
		tui.addChild(component);

		tui.start();
		await renderAndFlush(tui, terminal);

		for (let i = 0; i < 3; i++) {
			tui.requestRender();
			await renderAndFlush(tui, terminal);
		}

		const viewport = terminal.getViewport();
		assert.strictEqual(countLine(viewport, "alpha"), 1);
		assert.strictEqual(countLine(viewport, "beta"), 1);

		tui.stop();
	});

	it("clears stale rows when content shrinks on the default path", async () => {
		const terminal = new VirtualTerminal(40, 8);
		const tui = new TUI(terminal);
		const component = new MutableComponent();
		component.lines = ["alpha", "beta", "gamma"];
		tui.addChild(component);

		tui.start();
		await renderAndFlush(tui, terminal);

		component.lines = ["alpha"];
		tui.requestRender();
		const viewport = await renderAndFlush(tui, terminal);

		assert.strictEqual(countLine(viewport, "alpha"), 1);
		assert.strictEqual(countLine(viewport, "beta"), 0);
		assert.strictEqual(countLine(viewport, "gamma"), 0);

		tui.stop();
	});

	it("clears stale suffixes when a line becomes shorter", async () => {
		const terminal = new VirtualTerminal(40, 8);
		const tui = new TUI(terminal);
		const component = new MutableComponent();
		component.lines = ["alphabet soup"];
		tui.addChild(component);

		tui.start();
		await renderAndFlush(tui, terminal);

		component.lines = ["alpha"];
		tui.requestRender();
		const viewport = await renderAndFlush(tui, terminal);

		assert.strictEqual(viewport[0]?.trim(), "alpha");
		assert.ok(!viewport[0]?.includes("bet soup"), `Expected stale suffix to be cleared, got ${viewport[0]}`);

		tui.stop();
	});

	it("writes a cursor frame in one terminal write to avoid visible split-frame flicker", async () => {
		const terminal = new CountingTerminal(40, 8);
		const tui = new TUI(terminal);
		tui.addChild(new CursorComponent());

		tui.start();
		terminal.resetWriteCount();
		await renderAndFlush(tui, terminal);

		assert.strictEqual(terminal.nonEmptyWrites, 1);

		tui.stop();
	});

	it("does not write cursor escapes immediately before the first render frame", async () => {
		const terminal = new CountingTerminal(40, 8);
		const tui = new TUI(terminal);
		const component = new MutableComponent();
		component.lines = ["ready"];
		tui.addChild(component);

		tui.start();

		assert.strictEqual(terminal.nonEmptyWrites, 0);

		await renderAndFlush(tui, terminal);
		tui.stop();
	});

	it("does not write image cell-size queries immediately before the first render frame", async () => {
		await withKittyCapabilities(async () => {
			const terminal = new CountingTerminal(40, 8);
			const tui = new TUI(terminal);
			const component = new MutableComponent();
			component.lines = ["ready"];
			tui.addChild(component);

			tui.start();

			assert.strictEqual(terminal.nonEmptyWrites, 0);

			await renderAndFlush(tui, terminal);
			tui.stop();
		});
	});

	it("does not write cursor escapes for a no-change render when the hardware cursor is already positioned", async () => {
		const terminal = new CountingTerminal(40, 8);
		const tui = new TUI(terminal);
		tui.addChild(new CursorComponent());

		tui.start();
		await renderAndFlush(tui, terminal);

		terminal.resetWriteCount();
		tui.requestRender();
		await renderAndFlush(tui, terminal);

		assert.strictEqual(terminal.nonEmptyWrites, 0);

		tui.stop();
	});

	it("does not write cursor escapes immediately when toggling hardware cursor visibility", async () => {
		const terminal = new CountingTerminal(40, 8);
		const tui = new TUI(terminal, true);
		tui.addChild(new CursorComponent());

		tui.start();
		await renderAndFlush(tui, terminal);

		terminal.resetWriteCount();
		tui.setShowHardwareCursor(false);

		assert.strictEqual(terminal.nonEmptyWrites, 0);

		await renderAndFlush(tui, terminal);
		tui.stop();
	});

	it("does not clear and redraw for a forced no-change render", async () => {
		const terminal = new CountingTerminal(40, 8);
		const tui = new TUI(terminal);
		const component = new MutableComponent();
		component.lines = ["alpha", "beta"];
		tui.addChild(component);

		tui.start();
		await renderAndFlush(tui, terminal);

		terminal.resetWriteCount();
		tui.requestRender(true);
		await renderAndFlush(tui, terminal);

		assert.strictEqual(terminal.nonEmptyWrites, 0);

		tui.stop();
	});

	it("does not write cursor escapes immediately when showing an overlay", async () => {
		const terminal = new CountingTerminal(40, 8);
		const tui = new TUI(terminal);
		const component = new MutableComponent();
		component.lines = ["base"];
		tui.addChild(component);

		tui.start();
		await renderAndFlush(tui, terminal);

		terminal.resetWriteCount();
		tui.showOverlay(new OverlayComponent(), { width: 10 });

		assert.strictEqual(terminal.nonEmptyWrites, 0);

		await renderAndFlush(tui, terminal);
		tui.stop();
	});
});
