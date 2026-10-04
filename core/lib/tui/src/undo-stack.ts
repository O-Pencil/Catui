/**
 * Generic undo stack with clone-on-push semantics.
 * Stores deep clones of state snapshots. Popped snapshots are returned
 * directly (no re-cloning) since they are already detached.
 * [WHO]: UndoStack
 * [FROM]: no external imports
 * [TO]: Consumed by core/lib/tui/src/components/editor.ts, core/lib/tui/src/components/input.ts
 * [HERE]: core/lib/tui/src/undo-stack.ts - owned by core/lib/tui/AGENT.md
 */


export class UndoStack<S> {
	private stack: S[] = [];

	/** Push a deep clone of the given state onto the stack. */
	push(state: S): void {
		this.stack.push(structuredClone(state));
	}

	/** Pop and return the most recent snapshot, or undefined if empty. */
	pop(): S | undefined {
		return this.stack.pop();
	}

	/** Remove all snapshots. */
	clear(): void {
		this.stack.length = 0;
	}

	get length(): number {
		return this.stack.length;
	}
}
