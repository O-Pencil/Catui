/**
 * [WHO]:
 * [FROM]:
 * [TO]: Consumed by modes/interactive/components/index.ts
 * [HERE]: modes/interactive/components/custom-editor.ts -
 */
import { Editor, getEditorKeybindings, matchesKey, type EditorOptions, type EditorTheme, type TUI } from "@pencil-agent/tui";
import type { AppAction, KeybindingsManager } from "../../../core/platform/keybindings.js";
import type { Theme } from "../../../core/theme-contract.js";

/** Regex matching a slash command at start-of-string or after whitespace. */
const SLASH_CMD_RE = /(^|[\s])(\/[a-zA-Z][a-zA-Z0-9:\-_]*)/g;

/**
 * Build an input highlighter that colors recognized slash commands.
 * Follows CC's approach: only highlight when the command name matches
 * a registered command (prevents highlighting filesystem paths like /usr/bin).
 */
function buildSlashHighlighter(
	getCommandNames: () => Set<string>,
	theme: Theme,
): (text: string) => string {
	const highlightColor = (text: string) => theme.fg("accent", text);

	return (text: string): string => {
		if (!text.includes("/")) return text;

		const commands = getCommandNames();
		let result = "";
		let lastIdx = 0;

		// Reset regex state (global regex retains state between calls)
		SLASH_CMD_RE.lastIndex = 0;

		for (const match of text.matchAll(SLASH_CMD_RE)) {
			const cmdName = match[2]!.slice(1); // strip leading "/"
			if (!commands.has(cmdName)) continue;

			// Append text before this match
			const prefix = match[1]!; // whitespace or ""
			const matchStart = match.index! + prefix.length;
			result += text.slice(lastIdx, matchStart);
			// Highlight the /command portion
			result += highlightColor(match[2]!);
			lastIdx = matchStart + match[2]!.length;
		}

		// Append remaining text
		if (lastIdx < text.length) result += text.slice(lastIdx);
		return result || text;
	};
}

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
	/** Slash command highlight function for input text. */
	public highlightInput?: (text: string) => string;

	constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager, options?: EditorOptions) {
		super(tui, theme, options);
		this.keybindings = keybindings;
	}

	/**
	 * Enable slash command highlighting in the input box.
	 * @param getCommandNames returns the current set of valid command names (without "/")
	 * @param theme the interactive mode theme for color resolution
	 */
	enableSlashHighlight(getCommandNames: () => Set<string>, theme: Theme): void {
		this.highlightInput = buildSlashHighlighter(getCommandNames, theme);
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
