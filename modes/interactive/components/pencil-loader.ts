/**
 * PencilLoader - Custom loader with rotating diamond animation
 * Uses ◆◇◈ symbols for a smooth loading indicator
 * Supports stalled animation (color transition to red) and tips display
 */
/**
 * [WHO]: PencilLoader
 * [FROM]: Depends on @pencil-agent/tui, ../services/tips
 * [TO]: Consumed by modes/interactive/components/index.ts
 * [HERE]: modes/interactive/components/pencil-loader.ts -
 */

import { Container, Spacer, Text, type TUI } from "@pencil-agent/tui";
import type { Theme } from "../theme/theme.js";

export class PencilLoader extends Container {
	private tui: TUI;
	private theme: Theme;
	private message: string;
	private interval: NodeJS.Timeout | undefined;
	private currentFrame = 0;
	private textComponent: Text;
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

		this.addChild(new Spacer(1));
		this.addChild(this.textComponent);
		this.addChild(new Spacer(1));

		this.startAnimation();
	}

	private startAnimation(): void {
		const updateFrame = () => {
			if (this.isStopped) return;

			const frameChar = this.frames[this.currentFrame];
			const diamondColor = this.getSpinnerColor();
			const diamond = diamondColor(frameChar);
			const stallDuration = this.getStallDuration();

			// Build display: spinner + message
			const display = `${diamond} ${this.message}`;

			this.textComponent.setText(display);
			this.tui.requestRender();

			this.currentFrame = (this.currentFrame + 1) % this.frames.length;
		};

		// Initial render
		updateFrame();

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

	setMessage(message: string, options?: { resetStallTimer?: boolean }): void {
		this.message = message;
		if (options?.resetStallTimer !== false) {
			this.resetStallTimer();
		}
		const frameChar = this.frames[this.currentFrame];
		const diamondColor = this.getSpinnerColor();
		const diamond = diamondColor(frameChar);
		this.textComponent.setText(`${diamond} ${this.message}`);
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
	}

	dispose(): void {
		this.stop();
	}
}
