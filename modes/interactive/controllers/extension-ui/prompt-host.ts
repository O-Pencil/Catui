/**
 * [WHO]: Provides PromptHost, PromptHostContext — single-active-prompt slot for extension dialogs
 * [FROM]: Depends on @pencil-agent/tui (Component/Container/TUI), keybindings (KeybindingsManager),
 *         extensions-host (ExtensionUIDialogOptions), components (Extension{Selector,Input,Editor}Component)
 * [TO]: Consumed by modes/interactive/interactive-mode.ts (held as `this.promptHost`; wired into
 *       ExtensionUIContext select/confirm/input/editor; focus restore called by handleEvent + resetExtensionUI)
 * [HERE]: modes/interactive/controllers/extension-ui/prompt-host.ts — P5 extension-ui rewrite, host 2/4 (UI02, 重写)
 *
 * Rewrite of the three byte-identical show/hide/dismiss lifecycles (selector / input / editor) into a
 * single "active prompt" slot (see extension-ui-analysis.md §3, rewrite-acceptance.md). The three prompt
 * types are now thin builders plugged into one generic `show` that owns the shared skeleton: abort
 * handling, single-active-prompt invariant, mount-into-editor-shell + focus, and dismiss → dispose +
 * remount + restore focus. NOT a generic overlay stack — there is one slot (no nesting need today).
 * Behavior of select/confirm/input/editor is identical to the former InteractiveMode methods.
 */

import type { Component, Container, TUI } from "@pencil-agent/tui";
import type { ExtensionUIDialogOptions } from "../../../../core/extensions-host/index.js";
import type { KeybindingsManager } from "../../../../core/platform/keybindings.js";
import { ExtensionEditorComponent } from "../../components/extension-editor.js";
import { ExtensionInputComponent } from "../../components/extension-input.js";
import { ExtensionSelectorComponent } from "../../components/extension-selector.js";

type DisposableComponent = Component & { dispose?(): void };

/** Narrow capability seam: the editor-shell handles the prompt slot mounts into. */
export interface PromptHostContext {
  getEditorContainer(): Container;
  getUi(): TUI;
  /** The editor component (focused when the prompt is dismissed and the shell is mounted). */
  getEditor(): Component;
  /** The editor/buddy layout node — its presence means the editor shell is mounted. */
  getEditorBuddyLayout(): Component;
  getKeybindings(): KeybindingsManager;
  /** Rebuild the editor shell (attachments bar + editor row) after a prompt is removed. */
  remountEditorShell(): void;
}

export class PromptHost {
  private active: DisposableComponent | undefined = undefined;

  constructor(private readonly ctx: PromptHostContext) {}

  // ----- public lifecycle -----

  hasActivePrompt(): boolean {
    return !!this.active;
  }

  /** Focus the editor when no prompt is active and the editor shell is mounted. */
  restoreEditorFocusIfPossible(): void {
    if (this.active) return;
    const editorContainer = this.ctx.getEditorContainer();
    if (editorContainer.children.includes(this.ctx.getEditorBuddyLayout())) {
      this.ctx.getUi().setFocus(this.ctx.getEditor());
    }
  }

  /** Dismiss the active prompt (dispose + remount editor shell + restore focus + render). */
  dismiss(restoreFocus = true): void {
    this.clear(restoreFocus);
    this.ctx.getUi().requestRender();
  }

  // ----- prompt types (thin builders over `show`) -----

  selector(
    title: string,
    options: string[],
    opts?: ExtensionUIDialogOptions,
  ): Promise<string | undefined> {
    return this.show<string>(
      (settle) =>
        new ExtensionSelectorComponent(
          title,
          options,
          (option) => settle(option),
          () => settle(undefined),
          { tui: this.ctx.getUi(), timeout: opts?.timeout },
        ),
      opts?.signal,
    );
  }

  async confirm(
    title: string,
    message: string,
    opts?: ExtensionUIDialogOptions,
  ): Promise<boolean> {
    const result = await this.selector(
      `${title}\n${message}`,
      ["Yes", "No"],
      opts,
    );
    return result === "Yes";
  }

  input(
    title: string,
    placeholder?: string,
    opts?: ExtensionUIDialogOptions,
  ): Promise<string | undefined> {
    return this.show<string>(
      (settle) =>
        new ExtensionInputComponent(
          title,
          placeholder,
          (value) => settle(value),
          () => settle(undefined),
          {
            tui: this.ctx.getUi(),
            timeout: opts?.timeout,
            initialValue: opts?.initialValue,
          },
        ),
      opts?.signal,
    );
  }

  editor(title: string, prefill?: string): Promise<string | undefined> {
    // The former showExtensionEditor had no abort signal.
    return this.show<string>(
      (settle) =>
        new ExtensionEditorComponent(
          this.ctx.getUi(),
          this.ctx.getKeybindings(),
          title,
          prefill,
          (value) => settle(value),
          () => settle(undefined),
        ),
    );
  }

  // ----- private: the single shared lifecycle -----

  /**
   * Show one prompt as the single active slot. `build` receives a `settle` callback
   * to resolve the promise (with the chosen value, or undefined on cancel/abort);
   * it must wire that into the component's submit/cancel callbacks.
   */
  private show<T>(
    build: (settle: (value: T | undefined) => void) => DisposableComponent,
    signal?: AbortSignal,
  ): Promise<T | undefined> {
    return new Promise((resolve) => {
      if (signal?.aborted) {
        resolve(undefined);
        return;
      }

      let settled = false;
      const finish = (value: T | undefined) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        this.dismiss();
        resolve(value);
      };
      const onAbort = () => finish(undefined);
      signal?.addEventListener("abort", onAbort, { once: true });

      // Single-active-prompt invariant: clear any existing prompt first (no render —
      // mount() renders). Then mount the new one.
      this.clear(false);
      this.mount(build(finish));
    });
  }

  private mount(component: DisposableComponent): void {
    this.active = component;
    const editorContainer = this.ctx.getEditorContainer();
    editorContainer.clear();
    editorContainer.addChild(component);
    this.ctx.getUi().setFocus(component);
    this.ctx.getUi().requestRender();
  }

  private clear(restoreFocus: boolean): void {
    if (this.active) {
      this.active.dispose?.();
      this.active = undefined;
      this.ctx.remountEditorShell();
    }
    if (restoreFocus) {
      this.restoreEditorFocusIfPossible();
    }
  }
}
