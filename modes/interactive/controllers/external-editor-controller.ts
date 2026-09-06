/**
 * [WHO]: Provides ExternalEditorController + ExternalEditorContext — $VISUAL/$EDITOR
 *        spawning (openExternalEditor round-trip via temp file, openExistingFileInExternalEditor)
 * [FROM]: Depends on injected host capability closures + node:fs/os/path + spawnSync;
 *         no InteractiveMode reference
 * [TO]: Consumed by modes/interactive/interactive-mode.ts (held lazily as `this.externalEditor`
 *       behind thin delegators: openExternalEditor / openExistingFileInExternalEditor)
 * [HERE]: modes/interactive/controllers/external-editor-controller.ts — P7 C-3d (extracted from
 *         InteractiveMode; behavior-preserving move)
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "child_process";
import type { EditorComponent, TUI } from "@catui/tui";

/** Host capabilities needed by the external-editor controller. */
export interface ExternalEditorContext {
  readonly editor: EditorComponent;
  readonly ui: TUI;
  showWarning(warningMessage: string): void;
}

export class ExternalEditorController {
  constructor(private readonly ctx: ExternalEditorContext) {}

  openExternalEditor(): void {
    // Determine editor (respect $VISUAL, then $EDITOR)
    const editorCmd = process.env.VISUAL || process.env.EDITOR;
    if (!editorCmd) {
      this.ctx.showWarning(
        "No editor configured. Set $VISUAL or $EDITOR environment variable.",
      );
      return;
    }

    const currentText =
      this.ctx.editor.getExpandedText?.() ?? this.ctx.editor.getText();
    const tmpFile = path.join(os.tmpdir(), `catui-editor-${Date.now()}.catui.md`);

    try {
      // Write current content to temp file
      fs.writeFileSync(tmpFile, currentText, "utf-8");

      // Stop TUI to release terminal
      this.ctx.ui.stop();

      // Split by space to support editor arguments (e.g., "code --wait")
      const [editor, ...editorArgs] = editorCmd.split(" ");

      // Spawn editor synchronously with inherited stdio for interactive editing
      const result = spawnSync(editor, [...editorArgs, tmpFile], {
        stdio: "inherit",
      });

      // On successful exit (status 0), replace editor content
      if (result.status === 0) {
        const newContent = fs.readFileSync(tmpFile, "utf-8").replace(/\n$/, "");
        this.ctx.editor.setText(newContent);
      }
      // On non-zero exit, keep original text (no action needed)
    } finally {
      // Clean up temp file
      try {
        fs.unlinkSync(tmpFile);
      } catch {
        // Ignore cleanup errors
      }

      // Restart TUI
      this.ctx.ui.start();
      // Force full re-render since external editor uses alternate screen
      this.ctx.ui.requestRender(true);
    }
  }

  async openExistingFileInExternalEditor(filePath: string): Promise<boolean> {
    const editorCmd = process.env.VISUAL || process.env.EDITOR;
    if (!editorCmd) {
      this.ctx.showWarning(
        "No editor configured. Set $VISUAL or $EDITOR environment variable.",
      );
      return false;
    }

    try {
      this.ctx.ui.stop();
      const [editor, ...editorArgs] = editorCmd.split(" ");
      const result = spawnSync(editor, [...editorArgs, filePath], {
        stdio: "inherit",
      });
      return result.status === 0;
    } finally {
      this.ctx.ui.start();
      this.ctx.ui.requestRender(true);
    }
  }
}
