/**
 * [WHO]: 
 * [FROM]: 
 * [TO]: Consumed by modes/interactive/components/index.ts
 * [HERE]: modes/interactive/components/custom-editor.ts -
 */
import { Editor, getEditorKeybindings, matchesKey, type EditorOptions, type EditorTheme, type TUI } from "@pencil-agent/tui";
import type { AppAction, KeybindingsManager } from "../../../core/platform/keybindings.js";

/**
 * Custom editor that handles app-level keybindings for coding-agent.
 */
export class CustomEditor extends Editor {
	private keybindings: KeybindingsManager;
	public actionHandlers: Map<AppAction, () => void> = new Map();

	// Special handlers that can be dynamically replaced
	public onEscape?: () => void;
	public onCtrlD?: () => void;
	public onPasteImage?: () => void;
	/** Handler for extension-registered shortcuts. Returns true if handled. */
	public onExtensionShortcut?: (data: string) => boolean;
	/** Handler for attachment navigation (arrow keys, delete). Returns true if handled. */
	public onAttachmentKey?: (data: string) => boolean;

	constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager, options?: EditorOptions) {
		super(tui, theme, options);
		this.keybindings = keybindings;
	}

	/**
	 * Register a handler for an app action.
	 */
	onAction(action: AppAction, handler: () => void): void {
		this.actionHandlers.set(action, handler);
	}

	handleInput(data: string): void {
		// Check extension-registered shortcuts first
		if (this.onExtensionShortcut?.(data)) {
			return;
		}

		// Detect image paste via empty bracketed paste — the terminal sends an
		// empty bracket sequence when the clipboard contains an image (since
		// raw image bytes can't be pasted as text).  This is the ONLY trigger
		// for clipboard image reading; we intentionally do NOT intercept the
		// raw Ctrl+V key code because Windows keeps stale image data in the
		// clipboard even after the user copies text, which would cause the
		// wrong content to be pasted.
		if (this.onPasteImage && data.includes("\x1b[200~") && data.includes("\x1b[201~")) {
			const content = data.replace("\x1b[200~", "").replace("\x1b[201~", "").trim();
			if (content.length === 0) {
				this.onPasteImage();
				return;
			}
		}

		// Check app keybindings first

		// Escape/interrupt - only if autocomplete is NOT active
		if (this.keybindings.matches(data, "interrupt")) {
			if (!this.isShowingAutocomplete()) {
				// Use dynamic onEscape if set, otherwise registered handler
				const handler = this.onEscape ?? this.actionHandlers.get("interrupt");
				if (handler) {
					handler();
					return;
				}
			}
			// Let parent handle escape for autocomplete cancellation
			super.handleInput(data);
			return;
		}

		// Exit (Ctrl+D) - only when editor is empty
		if (this.keybindings.matches(data, "exit")) {
			if (this.getText().length === 0) {
				const handler = this.onCtrlD ?? this.actionHandlers.get("exit");
				if (handler) handler();
				return;
			}
			// Fall through to editor handling for delete-char-forward when not empty
		}

		// Check all other app actions
		for (const [action, handler] of this.actionHandlers) {
			if (action !== "interrupt" && action !== "exit" && this.keybindings.matches(data, action)) {
				handler();
				return;
			}
		}

		// Forward navigation/delete keys to the attachment handler. The handler
		// only consumes them when appropriate (e.g. Delete only when an
		// attachment is selected), otherwise returns false so the editor
		// processes the key normally.
		if (this.onAttachmentKey) {
			const kb = getEditorKeybindings();
			if (
				kb.matches(data, "cursorUp") ||
				kb.matches(data, "cursorDown") ||
				matchesKey(data, "delete") ||
				matchesKey(data, "backspace")
			) {
				if (this.onAttachmentKey(data)) {
					return;
				}
			}
		}

		// Pass to parent for editor handling
		super.handleInput(data);
	}
}
