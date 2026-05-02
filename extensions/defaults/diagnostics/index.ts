/**
 * [WHO]: diagnosticsExtension - diagnostic:event listener, /report-issue command, silent auto-upload on agent_end
 * [FROM]: Depends on core/extensions/types, @pencil-agent/tui, ./diagnostic-buffer, ./reporter, ./types
 * [TO]: Auto-loaded by builtin-extensions.ts as a default extension before diagnostic producers
 * [HERE]: extensions/defaults/diagnostics/index.ts - extension-owned diagnostic buffer; background failures auto-upload silently at agent_end plus delayed sweep, /report-issue stays for explicit user-initiated bundles
 */

import { Box, Container, Spacer, Text, type Component } from "@pencil-agent/tui";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "../../../core/extensions/types.js";
import { subscribeDiagnostics } from "../../../utils/diagnostics.js";
import { coerceDiagnosticEvent, DiagnosticBuffer } from "./diagnostic-buffer.js";
import { reportDiagnostics } from "./reporter.js";
import { DIAGNOSTIC_EVENT_CHANNEL, type DiagnosticRecord } from "./types.js";

const MESSAGE_TYPE = "diagnostics";

export default async function diagnosticsExtension(api: ExtensionAPI): Promise<void> {
	const buffer = new DiagnosticBuffer();

	api.registerMessageRenderer(MESSAGE_TYPE, (message, _options, theme): Component => {
		const text = typeof message.content === "string" ? message.content : JSON.stringify(message.content, null, 2);
		const box = new Box(1, 1, (v) => theme.bg("customMessageBg", v));
		box.addChild(new Text(theme.fg("dim", text), 0, 0));
		const container = new Container();
		container.addChild(new Spacer(1));
		container.addChild(box);
		return container;
	});

	// Legacy path: producers that still call api.events.emit("diagnostic:event", ...)
	api.events.on(DIAGNOSTIC_EVENT_CHANNEL, (payload) => {
		const event = coerceDiagnosticEvent(payload);
		if (!event) return;
		buffer.add(event);
	});

	// Canonical path: producers (including deep utilities without api access)
	// using utils/diagnostics.ts → reportDiagnostic(...). The shared Symbol.for
	// slot also relays mem-core (separate package) events here.
	subscribeDiagnostics((event) => {
		const coerced = coerceDiagnosticEvent(event);
		if (coerced) buffer.add(coerced);
	});

	api.on("agent_end", async (_event, ctx) => {
		// Background subsystem failures (SAL eval, mem-core, presence, etc.)
		// auto-upload silently — they did not interrupt the user, so prompting
		// for permission would be reverse-value. /report-issue stays available
		// for the user to bundle records manually (info/debug included).
		await flushUploadableDiagnostics(buffer, ctx);
		const timer = setTimeout(() => {
			void flushUploadableDiagnostics(buffer, ctx);
		}, 1_000);
		timer.unref?.();
	});

	api.registerCommand("report-issue", {
		description: "Report recent diagnostics (/report-issue [last|all|note])",
		handler: (args, ctx) => handleReportIssue(args, ctx, buffer),
	});
}

async function flushUploadableDiagnostics(buffer: DiagnosticBuffer, ctx: ExtensionContext): Promise<void> {
	const unreported = buffer.findUnreported();
	if (unreported.length === 0) return;

	// pencil_issue_events is for actionable issues. info/debug telemetry
	// (e.g. Soul evolution success notes) shows up in dev console via the
	// bus but should not pollute the issue table. Mark them reported so
	// they don't accumulate forever.
	const uploadable = unreported.filter((r) => r.severity === "warning" || r.severity === "error");
	const skipped = unreported.filter((r) => r.severity !== "warning" && r.severity !== "error");
	for (const record of skipped) buffer.markReported(record.fingerprint);

	if (uploadable.length === 0) return;
	const result = await reportDiagnostics(uploadable, undefined, ctx);
	// Mark reported when the upload landed OR when the reporter has no
	// endpoint configured (no point re-trying every turn against missing
	// config). Transient HTTP/network failures stay unreported and will
	// retry on the next agent_end.
	if (result.ok || !result.configured) {
		for (const record of uploadable) buffer.markReported(record.fingerprint);
	}
}

async function handleReportIssue(
	args: string,
	ctx: ExtensionCommandContext,
	buffer: DiagnosticBuffer,
): Promise<void> {
	const trimmed = args.trim();
	const records = selectRecords(trimmed, buffer);
	if (records.length === 0) {
		ctx.ui.notify("No diagnostics recorded in this session.", "info");
		return;
	}
	const userNote = trimmed && trimmed !== "last" && trimmed !== "all" ? stripQuotes(trimmed) : undefined;
	const result = await reportDiagnostics(records, userNote, ctx);
	ctx.ui.notify(result.message, result.ok ? "info" : "warning");
	if (result.ok) {
		ctx.ui.setStatus("diagnostics", undefined);
	}
}

function selectRecords(args: string, buffer: DiagnosticBuffer): DiagnosticRecord[] {
	if (args === "all") return buffer.all();
	if (args === "last") {
		const last = buffer.last();
		return last ? [last] : [];
	}
	const all = buffer.all();
	return all.length > 0 ? all.slice(0, 5) : [];
}

function stripQuotes(value: string): string {
	if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
		return value.slice(1, -1);
	}
	return value;
}
