/**
 * CachedContainer - A Container that caches each child's render output.
 * On each render call, only re-renders children that have been explicitly
 * marked dirty via `markDirty()` or newly added via `addChild()`.  All
 * other children reuse their cached output from the previous frame.
 * This avoids the O(children × lines) cost when most children are static —
 * the common case for chat transcripts where only the latest streaming
 * message and active tool executions change.
 * IMPORTANT: Because child components (AssistantMessageComponent,
 * ToolExecutionComponent, etc.) mutate their internal state without
 * notifying the parent, callers MUST call `markDirty(component)` whenever
 * a child's content changes.  Failure to do so will result in stale
 * render output being displayed.
 * NOTE: Viewport culling is NOT done here — the TUI's own doRender() already
 * handles terminal-level viewport management. Adding a second layer of
 * culling causes double-truncation bugs.
 * [WHO]: CachedContainer
 * [FROM]: no external imports
 * [TO]: Consumed by core/lib/tui/src/index.ts
 * [HERE]: core/lib/tui/src/components/cached-container.ts - owned by core/lib/tui/AGENT.md
 */


import { Container, type Component } from "../tui.js";

interface ChildCache {
	lines: string[];
	width: number;
}

export class CachedContainer extends Container {
	private cache = new Map<Component, ChildCache>();
	private _dirty = new WeakSet<Component>();

	/**
	 * Mark a component as needing re-render on the next frame.
	 * Call this after mutating a child's internal state (e.g. updateContent).
	 */
	markDirty(component: Component): void {
		this._dirty.add(component);
	}

	addChild(component: Component): void {
		super.addChild(component);
		this._dirty.add(component);
	}

	removeChild(component: Component): void {
		this.cache.delete(component);
		super.removeChild(component);
	}

	clear(): void {
		this.cache.clear();
		super.clear();
	}

	invalidate(): void {
		// Mark all children dirty (theme change, etc.)
		for (const child of this.children) {
			this._dirty.add(child);
		}
		super.invalidate();
	}

	render(width: number): string[] {
		const allLines: string[] = [];
		const newCache = new Map<Component, ChildCache>();

		for (const child of this.children) {
			const cached = this.cache.get(child);
			const isDirty = this._dirty.has(child);
			let lines: string[];

			if (!isDirty && cached && cached.width === width) {
				// Reuse cached output — child hasn't changed
				lines = cached.lines;
			} else {
				// Re-render: child is dirty, new, or width changed
				lines = child.render(width);
			}

			newCache.set(child, { lines, width });
			allLines.push(...lines);
		}

		this.cache = newCache;
		this._dirty = new WeakSet();
		return allLines;
	}
}
