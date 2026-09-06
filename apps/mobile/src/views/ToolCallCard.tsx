import { useState } from "react";
import type { ToolCall, ToolResultMessage } from "../protocol/types";

interface ToolCallCardProps {
	call: ToolCall;
	result?: ToolResultMessage;
}

const TOOL_EMOJI: Record<string, string> = {
	bash: "$",
	read: "◧",
	edit: "✎",
	write: "✎",
	grep: "⌕",
	find: "⌕",
	ls: "▤",
	source: "◈",
};

function summarize(call: ToolCall): string {
	const args = call.arguments ?? {};
	if (call.name === "bash" && typeof args.command === "string") return args.command;
	if (call.name === "read" && typeof args.path === "string") return args.path;
	if ((call.name === "edit" || call.name === "write") && typeof args.path === "string") return args.path;
	if ((call.name === "grep" || call.name === "find") && typeof args.pattern === "string") return args.pattern;
	if (typeof args.path === "string") return args.path;
	const first = Object.values(args)[0];
	if (typeof first === "string") return first;
	return "";
}

function resultText(result: ToolResultMessage): string {
	return result.content
		.filter((block): block is { type: "text"; text: string } => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

/** Collapsible tool invocation card with its (possibly streaming) result. */
export default function ToolCallCard({ call, result }: ToolCallCardProps) {
	const [open, setOpen] = useState(false);
	const running = !result;
	const isError = result?.isError ?? false;

	return (
		<div className="my-1.5 overflow-hidden rounded-lg border border-line bg-panel">
			<button
				type="button"
				className="flex w-full items-center gap-2 px-3 py-2 text-left active:bg-panel-2"
				onClick={() => setOpen(!open)}
			>
				<span
					className={`flex h-5 w-5 shrink-0 items-center justify-center rounded font-mono text-[0.65rem] ${
						running ? "animate-pulse bg-accent-soft text-accent-ink" : isError ? "bg-error/15 text-error" : "bg-panel-2 text-muted"
					}`}
				>
					{TOOL_EMOJI[call.name] ?? "•"}
				</span>
				<span className="shrink-0 font-mono text-xs text-ink">{call.name}</span>
				<span className="min-w-0 flex-1 truncate text-xs text-muted">{summarize(call)}</span>
				<span className="shrink-0 text-[0.65rem] text-faint">{open ? "▾" : "▸"}</span>
			</button>
			{open && (
				<div className="border-t border-line px-3 py-2">
					<div className="mb-2">
						<div className="mb-0.5 text-[0.65rem] uppercase tracking-wide text-faint">input</div>
						<pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-xs text-muted">
							{JSON.stringify(call.arguments, null, 2)}
						</pre>
					</div>
					{result && (
						<div>
							<div className="mb-0.5 text-[0.65rem] uppercase tracking-wide text-faint">
								{isError ? "error" : "output"}
							</div>
							<pre
								className={`max-h-72 overflow-auto whitespace-pre-wrap font-mono text-xs ${
									isError ? "text-error" : "text-muted"
								}`}
							>
								{resultText(result) || "(empty)"}
							</pre>
						</div>
					)}
					{running && <div className="text-xs text-faint">running…</div>}
				</div>
			)}
		</div>
	);
}
