/**
 * [WHO]: Provides Listeners<T> — a typed broadcast listener set
 * [FROM]: No dependencies
 * [TO]: Consumed by core/runtime/agent-session.ts (session event subscribers); reusable by any
 *       module needing add/emit/clear over a set of same-typed callbacks
 * [HERE]: core/platform/listeners.ts - generic observer primitive (no business knowledge)
 *
 * Replaces the inline `private _xListeners: Fn[]` + push / indexOf-splice / clear pattern.
 * add() returns an unsubscribe closure; emit() broadcasts to every current listener.
 */

export class Listeners<T> {
  private _listeners: Array<(value: T) => void> = [];

  /** Register a listener; returns a function that removes exactly this listener. */
  add(listener: (value: T) => void): () => void {
    this._listeners.push(listener);
    return () => {
      const index = this._listeners.indexOf(listener);
      if (index !== -1) {
        this._listeners.splice(index, 1);
      }
    };
  }

  /** Broadcast a value to all current listeners. */
  emit(value: T): void {
    for (const listener of this._listeners) {
      listener(value);
    }
  }

  /** Number of registered listeners. */
  get size(): number {
    return this._listeners.length;
  }

  /** Remove all listeners. */
  clear(): void {
    this._listeners = [];
  }
}
