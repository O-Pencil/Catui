/**
 * [WHO]: GrubDispatch, exclusive and idempotent iteration dispatch with prompt ownership
 * [FROM]: Extension API continuation lease and local GrubController
 * [TO]: Grub extension lifecycle and integration tests
 * [HERE]: extensions/builtin/grub/grub-dispatch.ts - queued/executing iteration boundary
 */
import { randomUUID } from "node:crypto";
import type { ContinuationLease, ExtensionAPI } from "../../../core/extensions-host/types.js";
import type { GrubController } from "./grub-controller.js";

export class GrubDispatch {
	private lease: ContinuationLease | undefined;
	private expected: string | undefined;
	private requested = false;
	private running = false;
	private resultTask: string | undefined;
	constructor(private readonly api: ExtensionAPI, private readonly controller: GrubController,
		private readonly announce: () => void) {}

	claim(): void {
		if (!this.lease?.isCurrent()) this.lease = this.api.claimContinuation?.(() => this.pause("Paused for another autonomous task."));
	}

	request(hasPendingMessages = false): void {
		if (this.expected || this.running || !this.controller.hasActiveTask()) return;
		this.requested = true;
		this.flush(hasPendingMessages);
	}

	flush(hasPendingMessages = false): void {
		if (!this.requested || this.expected || this.running || hasPendingMessages || !this.api.isIdle()) return;
		if (this.lease && !this.lease.isCurrent()) return;
		if (!this.controller.hasActiveTask()) return;
		this.expected = `${this.controller.buildPrompt()}\n<grub-dispatch>${randomUUID()}</grub-dispatch>`;
		this.requested = false;
		this.controller.markDispatched();
		this.announce();
		this.api.sendUserMessage(this.expected, { deliverAs: "followUp" });
	}

	accepts(prompt: string): boolean {
		return prompt === this.expected && this.controller.hasActiveTask() && (!this.lease || this.lease.isCurrent());
	}

	begin(prompt: string): void {
		if (!this.accepts(prompt)) return;
		this.running = true;
		this.resultTask = this.controller.getActiveTask()?.id;
	}
	takeResultTask(): string | undefined {
		const task = this.resultTask;
		this.resultTask = undefined;
		return task;
	}
	get ownsRun(): boolean { return this.running && this.controller.hasActiveTask(); }

	end(): boolean {
		this.resultTask = undefined;
		if (!this.ownsRun) return false;
		this.running = false;
		this.expected = undefined;
		return true;
	}

	cancel(): void {
		const expected = this.expected;
		this.expected = undefined;
		this.requested = false;
		this.running = false;
		this.api.clearFollowUpQueue?.(text => expected !== undefined && text === expected);
		this.lease?.release();
		this.lease = undefined;
	}

	pause(reason: string): void {
		this.cancel();
		if (this.controller.hasActiveTask()) this.controller.stop(reason, "stopped");
	}
}
