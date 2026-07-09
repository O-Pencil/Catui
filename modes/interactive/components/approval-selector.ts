/**
 * [WHO]: ApprovalSelectorComponent, ApprovalDecision, ApprovalChoice, CliApprovalClient, APPROVAL_TIMEOUT_MS
 * [FROM]: Depends on @catui/tui, ../theme/theme.js, node:process
 * [TO]: Consumed by modes/interactive/interactive-mode.ts (ApprovalSelectorComponent, Layer 2 TUI surface) and
 *   main.ts (CliApprovalClient, Layer 2 runtime wire) — both honor ADR bash-pre-execution-approval-decision.
 * [HERE]: modes/interactive/components/approval-selector.ts - TUI selector + minimal CLI client for
 *   dangerous bash commands. ApprovalSelectorComponent is the polished Layer 3 surface; CliApprovalClient
 *   is the Layer 2 wiring proof-of-life (does not mount to TUI, reads stdin directly + 60s timeout -> deny).
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

/**
 * Minimal CLI approval client — emits a short prompt on stdout and reads a
 * single character from stdin. NOT a polished TUI; this is the layer-2
 * "the chain works end-to-end" client used by main.ts wiring without taking
 * a hard dependency on @catui/tui or PromptHost. Polished TUI selector is
 * implemented by `ApprovalSelectorComponent` above; a follow-up will wire
 * that as the interactive-mode runtime client.
 *
 * Timeout: 60s. Defaults to "deny" (fail-closed).
 */
export class CliApprovalClient {
	private approvalPrompted = false;

	async request(decision: ApprovalDecision): Promise<ApprovalChoice> {
		const reason = decision.reason;
		const commandPreview = decision.command.length > 80
			? decision.command.slice(0, 77) + "..."
			: decision.command;
		process.stdout.write(
			`\n⚠ Dangerous command (${reason}):\n  $ ${commandPreview}\n` +
			`  [o]nce / [s]ession / [a]lways / [d]eny  (timeout 60s -> deny)\n> `,
		);
		this.approvalPrompted = true;

		const choice = await Promise.race([
			this.readLine(),
			this.timeout(),
		]);
		process.stdout.write("\n");
		return choice;
	}

	private readLine(): Promise<ApprovalChoice> {
		return new Promise((resolve) => {
			const stdin = process.stdin;
			stdin.setEncoding("utf8");
			const onData = (chunk: Buffer | string) => {
				stdin.removeListener("data", onData);
				stdin.removeListener("end", onEnd);
				resolve(this.mapChar(String(chunk).trim()));
			};
			const onEnd = () => {
				stdin.removeListener("data", onData);
				resolve("deny");
			};
			stdin.once("data", onData);
			stdin.once("end", onEnd);
		});
	}

	private timeout(): Promise<ApprovalChoice> {
		return new Promise((resolve) => {
			setTimeout(() => resolve("deny"), TIMEOUT_MS);
		});
	}

	private mapChar(s: string): ApprovalChoice {
		if (s === "o" || s === "1") return "once";
		if (s === "s" || s === "2") return "session";
		if (s === "a" || s === "3") return "always";
		if (s === "d" || s === "4") return "deny";
		// Empty / unknown -> fail-closed
		return "deny";
	}
}
