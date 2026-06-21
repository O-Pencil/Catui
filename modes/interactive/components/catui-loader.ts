/**
 * CatuiLoader - Custom loader with rotating diamond animation
 * Uses ◆◇◈ symbols for a smooth loading indicator
 * Supports stalled animation (color transition to red) and tips display
 */
/**
 * [WHO]: CatuiLoader
 * [FROM]: Depends on @catui/tui
 * [TO]: Consumed by modes/interactive/components/index.ts
 * [HERE]: modes/interactive/components/catui-loader.ts -
 */

import { Container, Spacer, Text, type TUI } from "@catui/tui";
import type { Theme } from "../theme/theme.js";

/** Tips shown below the spinner while waiting */
const TIPS = [
	"Press Tab to autocomplete slash commands",
	"Type /help for available commands",
	"Ctrl+C to interrupt the current task",
	"Drag and drop images into the terminal",
	"Use @filename to reference files in your message",
	"Press ↑↓ to navigate command history",
	"Type /compact to summarize and free context",
	"Shift+Enter for a new line in the editor",
	"Use /model to switch AI models",
	"Type /theme to change the color theme",
];

export class CatuiLoader extends Container {
	private tui: TUI;
	private theme: Theme;
	private message: string;
	private suffix = "";
	private interval: NodeJS.Timeout | undefined;
	private tipTimeout: NodeJS.Timeout | undefined;
	private tipInterval: NodeJS.Timeout | undefined;
	private currentFrame = 0;
	private textComponent: Text;
	private tipComponent: Text;
	private isStopped = false;

	// Time tracking for stalled animation
	private readonly startTime: number;
	private lastTokenTime: number;
	private sessionId: string;

	// Stall thresholds (in ms)
	private readonly STALL_THRESHOLD_MS = 3000;

	// Rotating diamond animation frames
	private readonly frames = [
		"◆", // filled diamond
		"◇", // outline diamond
		"◈", // outlined diamond with dot
	];

	constructor(tui: TUI, theme: Theme, message: string, sessionId: string = "default") {
		super();
		this.tui = tui;
		this.theme = theme;
		this.message = message;
		this.sessionId = sessionId;
		this.startTime = Date.now();
		this.lastTokenTime = Date.now();

		this.textComponent = new Text("", 0, 0);
		this.tipComponent = new Text("", 1, 0);

		this.addChild(new Spacer(1));
		this.addChild(this.textComponent);
		this.addChild(this.tipComponent);
		this.addChild(new Spacer(1));

		this.startAnimation();
		this.startTipRotation();
	}

	private getRandomTip(): string {
		return TIPS[Math.floor(Math.random() * TIPS.length)]!;
	}

	private startTipRotation(): void {
		// Show first tip after a short delay (only if still loading)
		this.tipTimeout = setTimeout(() => {
			this.tipTimeout = undefined;
			if (!this.isStopped) {
				this.tipComponent.setText(this.theme.fg("dim", `  ╙ tip: ${this.getRandomTip()}`));
				this.tui.requestRender();
			}
		}, 2000);

		// Rotate tips every 6 seconds
		this.tipInterval = setInterval(() => {
			if (this.isStopped) return;
			this.tipComponent.setText(this.theme.fg("dim", `  ╙ tip: ${this.getRandomTip()}`));
			this.tui.requestRender();
		}, 6000);
	}

	private startAnimation(): void {
		const updateFrame = (options?: { requestRender?: boolean }) => {
			if (this.isStopped) return;

			const frameChar = this.frames[this.currentFrame];
			const diamondColor = this.getSpinnerColor();
			const diamond = diamondColor(frameChar);

			// Build display: spinner + highlighted message
			const suffixPart = this.suffix ? ` ${this.theme.fg("dim", this.suffix)}` : "";
			const display = `${diamond} ${this.theme.fg("accent", this.message)}${suffixPart}`;

			this.textComponent.setText(display);
			if (options?.requestRender !== false) {
				this.tui.requestRender();
			}

			this.currentFrame = (this.currentFrame + 1) % this.frames.length;
		};

		// Prepare the first frame without requesting a render before the loader
		// is mounted; callers request render after adding it to the status tree.
		updateFrame({ requestRender: false });

		// Update every 200ms for smooth rotation
		this.interval = setInterval(updateFrame, 200);
	}

	/**
	 * Get spinner color based on stall duration.
	 * Normal: accent color
	 * After STALL_THRESHOLD_MS: interpolates toward error red
	 */
	private getSpinnerColor(): (char: string) => string {
		const stallDuration = this.getStallDuration();
		if (stallDuration < this.STALL_THRESHOLD_MS) {
			return (char: string) => this.theme.fg("accent", char);
		}

		// Interpolate: 0 at STALL_THRESHOLD, 1 at STALL_THRESHOLD + 2000
		const intensity = Math.min((stallDuration - this.STALL_THRESHOLD_MS) / 2000, 1);

		// Return a function that applies interpolated color
		return (char: string) => {
			if (intensity >= 1) {
				return this.theme.fg("error", char);
			}
			// For intermediate values, just use warning color
			return intensity > 0.5 ? this.theme.fg("warning", char) : this.theme.fg("accent", char);
		};
	}

	/**
	 * Get how long since last token/output (for stalled animation).
	 */
	private getStallDuration(): number {
		return Date.now() - this.lastTokenTime;
	}

	/**
	 * Call this when new output arrives to reset the stall timer.
	 */
	resetStallTimer(): void {
		this.lastTokenTime = Date.now();
	}

	setMessage(message: string, options?: { resetStallTimer?: boolean; suffix?: string }): void {
		const nextSuffix = options?.suffix ?? "";
		if (
			options?.resetStallTimer === false &&
			this.message === message &&
			this.suffix === nextSuffix
		) {
			return;
		}
		this.message = message;
		this.suffix = nextSuffix;
		if (options?.resetStallTimer !== false) {
			this.resetStallTimer();
		}
		const frameChar = this.frames[this.currentFrame];
		const diamondColor = this.getSpinnerColor();
		const diamond = diamondColor(frameChar);
		const suffixPart = this.suffix ? ` ${this.theme.fg("dim", this.suffix)}` : "";
		this.textComponent.setText(`${diamond} ${this.theme.fg("accent", this.message)}${suffixPart}`);
		this.tui.requestRender();
	}

	setSessionId(sessionId: string): void {
		this.sessionId = sessionId;
	}

	stop(): void {
		this.isStopped = true;
		if (this.interval) {
			clearInterval(this.interval);
			this.interval = undefined;
		}
		if (this.tipTimeout) {
			clearTimeout(this.tipTimeout);
			this.tipTimeout = undefined;
		}
		if (this.tipInterval) {
			clearInterval(this.tipInterval);
			this.tipInterval = undefined;
		}
	}

	dispose(): void {
		this.stop();
	}
}
