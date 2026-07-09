/**
 * [WHO]: ApprovalSelectorComponent, ApprovalDecision, ApprovalChoice
 * [FROM]: Depends on @catui/tui, ../theme/theme.js
 * [TO]: Consumed by modes/interactive/interactive-mode.ts (Layer 2 pre-execution gate)
 * [HERE]: modes/interactive/components/approval-selector.ts - TUI selector for dangerous bash commands.
 *   Spawned by the bash tool spawn-pre-hook when isDangerousCommand() matches.
 *   Choices: once / session / always / deny (+ view for long commands >70 chars).
 *   60s timeout -> deny (fail-closed). See ADR bash-pre-execution-approval-decision.
 */

import { Container, getEditorKeybindings, Spacer, TruncatedText } from "@catui/tui";
import { theme } from "../theme/theme.js";

export type ApprovalChoice = "once" | "session" | "always" | "deny";

export interface ApprovalDecision {
	command: string;
	description: string;
	reason: string;
}

const CHOICES: ApprovalChoice[] = ["once", "session", "always", "deny"];
const TIMEOUT_MS = 60_000;

export class ApprovalSelectorComponent extends Container {
	private listContainer: Container;
	private allChoices: ApprovalChoice[] = [...CHOICES];
	private selectedIndex = CHOICES.length - 1; // default cursor on "deny" (fail-closed)
	private onResolve: (choice: ApprovalChoice) => void;
	private resolved = false;
	private choiceLabels: Record<ApprovalChoice, string> = {
		once: "once (this command)",
		session: "session (this turn)",
		always: "always (remember choice)",
		deny: "deny (do not run)",
	};

	constructor(
		decision: ApprovalDecision,
		onResolve: (choice: ApprovalChoice) => void,
	) {
		super();

		this.onResolve = onResolve;

		// Long-command "view" toggle — kept as a controller state, not a choice,
		// because pressing 'v' expands the command text inline instead of selecting.
		this.allChoices = [...CHOICES];
		if (decision.command.length > 70) {
			this.allChoices = [...CHOICES]; // 'view' is a separate key, not a choice row
		}

		// Header
		this.addChild(new TruncatedText(theme.bold(theme.fg("warning", "⚠ Dangerous command"))));
		this.addChild(new Spacer(1));

		// Reason
		this.addChild(new TruncatedText(theme.fg("muted", `Reason: ${decision.reason}`)));
		this.addChild(new Spacer(1));

		// Command preview (truncated to ~70 chars)
		const commandPreview = decision.command.length > 70
			? decision.command.slice(0, 67) + "..."
			: decision.command;
		this.addChild(new TruncatedText(theme.fg("accent", `$ ${commandPreview}`)));
		this.addChild(new Spacer(1));

		// Choices
		this.listContainer = new Container();
		this.addChild(this.listContainer);
		this.addChild(new Spacer(1));

		// Help footer
		const helpKeys = decision.command.length > 70
			? "↑↓ select · enter confirm · v view · esc deny"
			: "↑↓ select · enter confirm · esc deny";
		this.addChild(new TruncatedText(theme.fg("dim", helpKeys)));
		this.addChild(new Spacer(1));

		// Timeout hint
		this.addChild(new TruncatedText(theme.fg("dim", `Default if no choice: deny (60s)`)));

		this.updateList();
	}

	private updateList(): void {
		this.listContainer.clear();
		for (let i = 0; i < this.allChoices.length; i++) {
			const choice = this.allChoices[i];
			if (!choice) continue;
			const isSelected = i === this.selectedIndex;
			const prefix = isSelected ? theme.fg("accent", "→ ") : "  ";
			const text = isSelected
				? theme.fg("accent", this.choiceLabels[choice])
				: theme.fg("text", this.choiceLabels[choice]);
			this.listContainer.addChild(new TruncatedText(prefix + text, 0, 0));
		}
	}

	private resolve(choice: ApprovalChoice): void {
		if (this.resolved) return;
		this.resolved = true;
		this.onResolve(choice);
	}

	/** Implement the keypress handler required by selector pattern. */
	handleInput(keyData: string): void {
		if (this.resolved) return;
		const kb = getEditorKeybindings();
		// Up arrow
		if (kb.matches(keyData, "selectUp")) {
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
			this.updateList();
			return;
		}
		// Down arrow
		if (kb.matches(keyData, "selectDown")) {
			this.selectedIndex = Math.min(this.allChoices.length - 1, this.selectedIndex + 1);
			this.updateList();
			return;
		}
		// Enter — confirm selected choice
		if (kb.matches(keyData, "selectConfirm")) {
			const choice = this.allChoices[this.selectedIndex];
			if (choice) this.resolve(choice);
			return;
		}
		// Escape — fail-closed default: deny
		if (kb.matches(keyData, "selectCancel")) {
			this.resolve("deny");
			return;
		}
	}
}

export { TIMEOUT_MS as APPROVAL_TIMEOUT_MS };
