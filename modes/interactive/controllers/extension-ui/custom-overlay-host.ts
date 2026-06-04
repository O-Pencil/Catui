/**
 * [WHO]: Provides CustomOverlayHost, CustomOverlayContext — extension custom component (overlay/inline)
 * [FROM]: Depends on @pencil-agent/tui (Component/Container/TUI/EditorComponent/OverlayOptions/OverlayHandle),
 *         theme, theme-contract (Theme), keybindings (KeybindingsManager)
 * [TO]: Consumed by modes/interactive/interactive-mode.ts (held as `this.customOverlay`; wired into
 *       ExtensionUIContext.custom)
 * [HERE]: modes/interactive/controllers/extension-ui/custom-overlay-host.ts — P5 extension-ui rewrite, host 3/4 (UI02, 纯搬)
 *
 * Owns ExtensionUIContext.custom: render an extension-provided component either as an overlay (on top,
 * via ui.showOverlay) or inline (replacing the editor in the editor shell), saving/restoring the editor
 * text. Per-call lifecycle (no persistent state). Reaches the editor-shell handles via a narrow context.
 * Behavior is identical to the former InteractiveMode.showExtensionCustom (纯搬).
 */

import type {
  Component,
  Container,
  EditorComponent,
  OverlayHandle,
  OverlayOptions,
  TUI,
} from "@pencil-agent/tui";
import type { Theme } from "../../../../core/theme-contract.js";
import type { KeybindingsManager } from "../../../../core/platform/keybindings.js";
import { theme } from "../../theme/theme.js";

type DisposableComponent = Component & { dispose?(): void };

/** Narrow capability seam: the editor-shell handles the custom component renders into. */
export interface CustomOverlayContext {
  getEditor(): EditorComponent;
  getUi(): TUI;
  getEditorContainer(): Container;
  getKeybindings(): KeybindingsManager;
  remountEditorShell(): void;
}

export class CustomOverlayHost {
  constructor(private readonly ctx: CustomOverlayContext) {}

  /** Show a custom component with keyboard focus. Overlay mode renders on top of existing content. */
  async show<T>(
    factory: (
      tui: TUI,
      thm: Theme,
      keybindings: KeybindingsManager,
      done: (result: T) => void,
    ) => DisposableComponent | Promise<DisposableComponent>,
    options?: {
      overlay?: boolean;
      overlayOptions?: OverlayOptions | (() => OverlayOptions);
      onHandle?: (handle: OverlayHandle) => void;
    },
  ): Promise<T> {
    const ui = this.ctx.getUi();
    const savedText = this.ctx.getEditor().getText();
    const isOverlay = options?.overlay ?? false;

    const restoreEditor = () => {
      this.ctx.remountEditorShell();
      this.ctx.getEditor().setText(savedText);
      ui.setFocus(this.ctx.getEditor());
      ui.requestRender();
    };

    return new Promise((resolve, reject) => {
      let component: DisposableComponent;
      let closed = false;

      const close = (result: T) => {
        if (closed) return;
        closed = true;
        if (isOverlay) ui.hideOverlay();
        else restoreEditor();
        // Note: both branches above already call requestRender
        resolve(result);
        try {
          component?.dispose?.();
        } catch {
          /* ignore dispose errors */
        }
      };

      Promise.resolve(factory(ui, theme, this.ctx.getKeybindings(), close))
        .then((c) => {
          if (closed) return;
          component = c;
          if (isOverlay) {
            // Resolve overlay options - can be static or dynamic function
            const resolveOptions = (): OverlayOptions | undefined => {
              if (options?.overlayOptions) {
                const opts =
                  typeof options.overlayOptions === "function"
                    ? options.overlayOptions()
                    : options.overlayOptions;
                return opts;
              }
              // Fallback: use component's width property if available
              const w = (component as { width?: number }).width;
              return w ? { width: w } : undefined;
            };
            const handle = ui.showOverlay(component, resolveOptions());
            // Expose handle to caller for visibility control
            options?.onHandle?.(handle);
          } else {
            const editorContainer = this.ctx.getEditorContainer();
            editorContainer.clear();
            editorContainer.addChild(component);
            ui.setFocus(component);
            ui.requestRender();
          }
        })
        .catch((err) => {
          if (closed) return;
          if (!isOverlay) restoreEditor();
          reject(err);
        });
    });
  }
}
