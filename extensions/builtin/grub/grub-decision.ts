/**
 * [WHO]: Provides extractGrubDecision()
 * [FROM]: Depends on ./grub-types for GrubDecision
 * [TO]: Consumed by ./index.ts and tests for assistant loop-state parsing
 * [HERE]: extensions/builtin/grub/grub-decision.ts - protocol parser for Grub assistant round summaries
 */

import type { GrubDecision } from "./grub-types.js";

const LOOP_STATE_BLOCK = /<loop-state>([\s\S]*?)<\/loop-state>/gi;

export function extractGrubDecision(text: string): GrubDecision | undefined {
	const payload = extractLastLoopStatePayload(text);
	if (!payload) return undefined;

	try {
		const parsed = JSON.parse(stripMarkdownFence(payload)) as Partial<GrubDecision>;
		if (parsed.status !== "continue" && parsed.status !== "complete" && parsed.status !== "blocked") {
			return undefined;
		}

		const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
		const nextStep = typeof parsed.nextStep === "string" ? parsed.nextStep.trim() : undefined;
		if (!summary) return undefined;
		if (parsed.status === "continue" && !nextStep) return undefined;

		return nextStep ? { status: parsed.status, summary, nextStep } : { status: parsed.status, summary };
	} catch {
		return undefined;
	}
}

function extractLastLoopStatePayload(text: string): string | undefined {
	let lastPayload: string | undefined;
	for (const match of text.matchAll(LOOP_STATE_BLOCK)) {
		const payload = match[1]?.trim();
		if (payload) lastPayload = payload;
	}
	return lastPayload;
}

function stripMarkdownFence(payload: string): string {
	const trimmed = payload.trim();
	const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
	return fenced?.[1]?.trim() ?? trimmed;
}
