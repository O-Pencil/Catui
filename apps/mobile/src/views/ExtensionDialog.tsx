import { useState } from "react";
import { useSessionStore } from "../state/session-store";

/**
 * Overlay rendering the oldest pending extension dialog (select / confirm /
 * input / editor / openExternalEditor). First answer wins server-side.
 */
export default function ExtensionDialog() {
	const dialogs = useSessionStore((s) => s.dialogs);
	const answerDialog = useSessionStore((s) => s.answerDialog);
	const [inputValue, setInputValue] = useState("");
	const dialog = dialogs[0];

	if (!dialog) return null;

	function resetAndAnswer(answer: { value?: string; confirmed?: boolean; cancelled?: true }) {
		setInputValue("");
		answerDialog(dialog.id, answer);
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 px-4">
			<div className="w-full max-w-sm rounded-2xl border border-line bg-panel p-4">
				<div className="mb-1 text-xs uppercase tracking-wide text-muted">Agent request</div>
				<div className="mb-3 font-serif text-lg font-semibold leading-snug text-ink">{dialog.title || "Input needed"}</div>

				{dialog.method === "select" && (
					<div className="max-h-72 space-y-1 overflow-y-auto">
						{dialog.options.map((option) => (
							<button
								key={option}
								type="button"
								className="block w-full rounded-lg bg-panel-2 px-3 py-2.5 text-left text-sm active:opacity-70"
								onClick={() => resetAndAnswer({ value: option })}
							>
								{option}
							</button>
						))}
					</div>
				)}

				{dialog.method === "confirm" && (
					<>
						<p className="mb-4 whitespace-pre-wrap text-sm text-ink">{dialog.message}</p>
						<div className="flex gap-2">
							<button
								type="button"
								className="flex-1 rounded-lg bg-accent py-2.5 font-semibold text-on-accent active:opacity-80"
								onClick={() => resetAndAnswer({ confirmed: true })}
							>
								Confirm
							</button>
							<button
								type="button"
								className="flex-1 rounded-lg bg-panel-2 py-2.5 font-medium text-ink active:opacity-80"
								onClick={() => resetAndAnswer({ confirmed: false })}
							>
								Cancel
							</button>
						</div>
					</>
				)}

				{dialog.method === "input" && (
					<>
						<input
							className="mb-3 w-full rounded-lg border border-line bg-panel-2 px-3 py-2.5 text-sm text-ink outline-none placeholder:text-faint focus:border-accent"
							placeholder={dialog.placeholder ?? ""}
							value={inputValue}
							onChange={(e) => setInputValue(e.target.value)}
							autoFocus
						/>
						<div className="flex gap-2">
							<button
								type="button"
								className="flex-1 rounded-lg bg-accent py-2.5 font-semibold text-on-accent active:opacity-80 disabled:opacity-40"
								disabled={!inputValue.trim()}
								onClick={() => resetAndAnswer({ value: inputValue.trim() })}
							>
								OK
							</button>
							<button
								type="button"
								className="flex-1 rounded-lg bg-panel-2 py-2.5 font-medium text-ink active:opacity-80"
								onClick={() => resetAndAnswer({ cancelled: true })}
							>
								Cancel
							</button>
						</div>
					</>
				)}

				{dialog.method === "editor" && (
					<>
						<textarea
							className="mb-3 max-h-64 w-full resize-none rounded-lg border border-line bg-panel-2 px-3 py-2.5 font-mono text-xs text-ink outline-none focus:border-accent"
							rows={8}
							placeholder={dialog.prefill ?? ""}
							defaultValue={dialog.prefill ?? ""}
							onChange={(e) => setInputValue(e.target.value)}
						/>
						<div className="flex gap-2">
							<button
								type="button"
								className="flex-1 rounded-lg bg-accent py-2.5 font-semibold text-on-accent active:opacity-80"
								onClick={() => resetAndAnswer({ value: inputValue || dialog.prefill || "" })}
							>
								Save
							</button>
							<button
								type="button"
								className="flex-1 rounded-lg bg-panel-2 py-2.5 font-medium text-ink active:opacity-80"
								onClick={() => resetAndAnswer({ cancelled: true })}
							>
								Cancel
							</button>
						</div>
					</>
				)}

				{dialog.method === "openExternalEditor" && (
					<>
						<p className="mb-1 text-sm text-ink">
							The agent asks to open an external editor on the PC for:
						</p>
						<p className="mb-4 break-all rounded-lg bg-panel-2 px-3 py-2 font-mono text-xs text-muted">
							{dialog.filePath}
						</p>
						<div className="flex gap-2">
							<button
								type="button"
								className="flex-1 rounded-lg bg-accent py-2.5 font-semibold text-on-accent active:opacity-80"
								onClick={() => resetAndAnswer({ confirmed: true })}
							>
								Allow
							</button>
							<button
								type="button"
								className="flex-1 rounded-lg bg-panel-2 py-2.5 font-medium text-ink active:opacity-80"
								onClick={() => resetAndAnswer({ confirmed: false })}
							>
								Deny
							</button>
						</div>
					</>
				)}
			</div>
		</div>
	);
}
