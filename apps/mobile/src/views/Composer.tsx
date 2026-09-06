import { useEffect, useMemo, useRef, useState } from "react";
import { useSessionStore } from "../state/session-store";

/**
 * Input area. Idle: sends prompts. Streaming: offers steer / follow-up plus
 * abort. "/"-prefixed input surfaces the slash command palette.
 */
export default function Composer() {
	const isStreaming = useSessionStore((s) => s.state?.isStreaming ?? false);
	const steeringMode = useSessionStore((s) => s.state?.steeringMode ?? "all");
	const commands = useSessionStore((s) => s.commands);
	const sendPrompt = useSessionStore((s) => s.sendPrompt);
	const steer = useSessionStore((s) => s.steer);
	const followUp = useSessionStore((s) => s.followUp);
	const abort = useSessionStore((s) => s.abort);

	const [text, setText] = useState("");
	const [queueMode, setQueueMode] = useState<"steer" | "followUp">("steer");
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const editorPrefill = useSessionStore((s) => s.editorPrefill);
	const consumeEditorPrefill = useSessionStore((s) => s.consumeEditorPrefill);

	// Extension-initiated editor prefill (set_editor_text)
	useEffect(() => {
		const prefill = consumeEditorPrefill();
		if (prefill !== undefined && inputRef.current) {
			inputRef.current.value = prefill;
			inputRef.current.focus();
		}
	}, [editorPrefill, consumeEditorPrefill]);

	const slashQuery = text.startsWith("/") ? text.slice(1).split(" ")[0].toLowerCase() : null;
	const commandMatches = useMemo(() => {
		if (slashQuery === null) return [];
		return commands.filter((command) => command.name.toLowerCase().includes(slashQuery)).slice(0, 8);
	}, [commands, slashQuery]);

	function submit() {
		const value = text.trim();
		if (!value) return;
		setText("");
		if (isStreaming) {
			if (queueMode === "steer") {
				void steer(value);
			} else {
				void followUp(value);
			}
		} else {
			void sendPrompt(value);
		}
	}

	return (
		<div className="safe-bottom border-t border-line bg-panel px-3 pb-2 pt-2">
			{slashQuery !== null && commandMatches.length > 0 && (
				<div className="mb-2 max-h-40 overflow-y-auto rounded-xl border border-line bg-panel-2">
					{commandMatches.map((command) => (
						<button
							key={`${command.source}:${command.name}`}
							type="button"
							className="block w-full px-3 py-2 text-left active:bg-panel"
							onClick={() => {
								const remainder = text.slice(1).slice(slashQuery.length);
								setText(`/${command.name} ${remainder.trimStart()}`);
								inputRef.current?.focus();
							}}
						>
							<span className="font-mono text-sm text-accent-ink">/{command.name}</span>
							{command.description && <span className="ml-2 text-xs text-muted">{command.description}</span>}
						</button>
					))}
				</div>
			)}

			{isStreaming && (
				<div className="mb-2 flex items-center gap-2 text-xs text-muted">
					<span className="rounded-full bg-accent-soft px-2 py-0.5 text-accent-ink">streaming</span>
					<div className="flex overflow-hidden rounded-full border border-line">
						<button
							type="button"
							className={`px-2.5 py-0.5 ${queueMode === "steer" ? "bg-accent-soft text-accent-ink" : "text-muted"}`}
							onClick={() => setQueueMode("steer")}
						>
							Steer{steeringMode === "one-at-a-time" ? " (next)" : ""}
						</button>
						<button
							type="button"
							className={`px-2.5 py-0.5 ${queueMode === "followUp" ? "bg-accent-soft text-accent-ink" : "text-muted"}`}
							onClick={() => setQueueMode("followUp")}
						>
							Follow-up
						</button>
					</div>
					<button
						type="button"
						className="ml-auto rounded-full bg-error/12 px-3 py-1 font-medium text-error active:opacity-70"
						onClick={() => void abort()}
					>
						Abort
					</button>
				</div>
			)}

			<div className="flex items-end gap-2">
				<textarea
					ref={inputRef}
					className="max-h-36 min-h-[2.75rem] flex-1 resize-none rounded-xl border border-line bg-panel-2 px-3.5 py-2.5 text-[0.9375rem] text-ink outline-none placeholder:text-faint focus:border-accent"
					rows={1}
					placeholder={isStreaming ? "Steer the running agent…" : "Message the agent…"}
					value={text}
					onChange={(e) => {
						setText(e.target.value);
						e.target.style.height = "auto";
						e.target.style.height = `${Math.min(e.target.scrollHeight, 144)}px`;
					}}
					onKeyDown={(e) => {
						if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
							e.preventDefault();
							submit();
						}
					}}
				/>
				<button
					type="button"
					className="h-11 w-11 shrink-0 rounded-xl bg-accent text-lg font-bold text-on-accent active:opacity-70 disabled:opacity-40"
					disabled={!text.trim()}
					onClick={submit}
					aria-label="Send"
				>
					{isStreaming ? "⏎" : "↑"}
				</button>
			</div>
		</div>
	);
}
