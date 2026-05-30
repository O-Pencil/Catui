/**
 * [WHO]: isInTeammateContext(), submitPlanToLeader(), checkPlanApproval()
 * [FROM]: No external dependencies (team extension integration)
 * [TO]: Consumed by exit-plan-mode-tool.ts
 * [HERE]: extensions/builtin/plan/teammate-approval.ts - teammate plan approval flow
 *
 * @deprecated MVP implementation — uses filesystem-based mailbox (team-mail dir).
 *   TODO(v2): Replace with TeamMailbox.post() from team extension when stable.
 */

import type { PlanApprovalRequest, PlanApprovalResponse } from "./types.js";

// ============================================================================
// Teammate context detection
// ============================================================================

/**
 * Check if the current context is a teammate.
 * This is a simplified check - in full implementation this would
 * integrate with the team extension's TeamRuntime.
 */
export function isInTeammateContext(): boolean {
	// Check environment variables set by team extension for teammate sessions
	// The team extension sets TEAMMATE_ID when running as a teammate
	return process.env.NANOPENCIL_TEAMMATE_ID !== undefined;
}

/**
 * Get the current teammate identity.
 */
export function getTeammateIdentity(): { id: string; name: string } | null {
	const id = process.env.NANOPENCIL_TEAMMATE_ID;
	const name = process.env.NANOPENCIL_TEAMMATE_NAME;
	if (id) {
		return { id, name: name || id };
	}
	return null;
}

/**
 * Get the team name if in a team context.
 */
export function getTeamName(): string | null {
	return process.env.NANOPENCIL_TEAM_NAME || null;
}

// ============================================================================
// Mailbox simulation (for MVP - uses file-based communication)
// ============================================================================

/**
 * Submit a plan approval request to the leader.
 * @deprecated MVP: uses filesystem-based mailbox. Replace with TeamMailbox.post().
 */
export async function submitPlanToLeader(
	planFilePath: string,
	planContent: string,
): Promise<{ requestId: string; status: "submitted" }> {
	const identity = getTeammateIdentity();
	if (!identity) {
		throw new Error("Not in teammate context");
	}

	const requestId = generateRequestId("plan_approval", identity.name);

	const request: PlanApprovalRequest = {
		type: "plan_approval_request",
		from: identity.name,
		timestamp: new Date().toISOString(),
		planFilePath,
		planContent,
		requestId,
	};

	// For MVP: store the request in a well-known location
	// In production: use TeamMailbox.post()
	const fs = await import("node:fs");
	const os = await import("node:os");
	const path = await import("node:path");

	const mailDir = path.join(os.homedir(), ".nanopencil", "agent", "team-mail");
	const requestFile = path.join(mailDir, `${requestId}.json`);

	fs.mkdirSync(mailDir, { recursive: true });
	fs.writeFileSync(requestFile, JSON.stringify(request, null, 2), "utf-8");

	return { requestId, status: "submitted" };
}

/**
 * Check if a plan approval has been received.
 */
export async function checkPlanApproval(
	requestId: string,
): Promise<{ approved: boolean; feedback?: string } | null> {
	const os = await import("node:os");
	const path = await import("node:path");
	const fs = await import("node:fs");

	const mailDir = path.join(os.homedir(), ".nanopencil", "agent", "team-mail");
	const responseFile = path.join(mailDir, `response-${requestId}.json`);

	if (!fs.existsSync(responseFile)) {
		return null; // Not yet approved
	}

	try {
		const content = fs.readFileSync(responseFile, "utf-8");
		const response: PlanApprovalResponse = JSON.parse(content);
		return { approved: response.approved, feedback: response.feedback };
	} catch {
		return null;
	}
}

/**
 * Generate a unique request ID.
 */
function generateRequestId(type: string, agentName: string): string {
	const timestamp = Date.now().toString(36);
	const random = Math.random().toString(36).slice(2, 8);
	return `${type}-${agentName}-${timestamp}-${random}`;
}

// ============================================================================
// Approval message formatting
// ============================================================================

/**
 * Format the message shown when plan is submitted to leader.
 */
export function formatPlanSubmittedMessage(
	requestId: string,
	planFilePath: string,
): string {
	return [
		"Your plan has been submitted to the team lead for approval.",
		"",
		`Plan file: ${planFilePath}`,
		"",
		"What happens next:",
		"1. Wait for the team lead to review your plan",
		"2. You will receive a message in your inbox with approval/rejection",
		"3. If approved, you can proceed with implementation",
		"4. If rejected, refine your plan based on the feedback",
		"",
		"Important: Do NOT proceed until you receive approval.",
		"",
		`Request ID: ${requestId}`,
	].join("\n");
}

/**
 * Format the message shown when waiting for leader approval.
 */
export function formatWaitingForApprovalMessage(requestId: string): string {
	return [
		"Waiting for team lead approval...",
		`Request ID: ${requestId}`,
		"",
		"The leader will approve or reject via `/team:approve ${requestId}`",
	].join("\n");
}
