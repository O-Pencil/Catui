import { useEffect } from "react";
import { useSessionStore } from "../state/session-store";

interface SessionDrawerProps {
	open: boolean;
	onClose: () => void;
}

/** Slide-over listing sessions (list_sessions) with switch + new session. */
export default function SessionDrawer({ open, onClose }: SessionDrawerProps) {
	const sessions = useSessionStore((s) => s.sessions);
	const state = useSessionStore((s) => s.state);
	const refreshSessions = useSessionStore((s) => s.refreshSessions);
	const switchSession = useSessionStore((s) => s.switchSession);
	const newSession = useSessionStore((s) => s.newSession);

	useEffect(() => {
		if (open) {
			void refreshSessions();
		}
	}, [open, refreshSessions]);

	if (!open) return null;

	const currentFile = state?.sessionFile;

	return (
		<div className="fixed inset-0 z-40 flex justify-end">
			<div className="absolute inset-0 bg-ink/45" onClick={onClose} />
			<div className="safe-top safe-bottom relative flex h-full w-[85%] max-w-sm flex-col border-l border-line bg-panel">
				<div className="flex items-center justify-between border-b border-line px-4 py-3">
					<span className="font-serif text-base font-semibold text-ink">Sessions</span>
					<button type="button" className="rounded-lg border border-line bg-panel-2 px-3 py-1.5 text-sm text-ink active:opacity-70" onClick={onClose}>
						Close
					</button>
				</div>

				<button
					type="button"
					className="mx-4 mt-3 rounded-xl bg-accent py-2.5 font-semibold text-on-accent active:opacity-80"
					onClick={() => {
						onClose();
						void newSession();
					}}
				>
					+ New session
				</button>

				<div className="mt-3 flex-1 overflow-y-auto px-4 pb-4">
					{sessions.length === 0 && (
						<p className="mt-8 text-center text-sm text-faint">No saved sessions found.</p>
					)}
					{sessions.map((session) => {
						const active = session.path === currentFile;
						return (
							<button
								key={session.path}
								type="button"
								className={`mb-2 block w-full rounded-xl border p-3 text-left active:opacity-70 ${
									active ? "border-accent/50 bg-accent-soft" : "border-line bg-panel-2"
								}`}
								onClick={() => {
									onClose();
									void switchSession(session.path);
								}}
							>
								<div className="flex items-center gap-2">
									<span className="min-w-0 flex-1 truncate text-sm font-medium">
										{session.name || session.firstMessage || "(unnamed)"}
									</span>
									{active && <span className="shrink-0 text-[0.65rem] text-accent-ink">current</span>}
								</div>
								<div className="mt-1 flex items-center gap-2 text-xs text-muted">
									<span>{new Date(session.modified).toLocaleString()}</span>
									<span>· {session.messageCount} msgs</span>
									{session.parentSessionPath && <span>· forked</span>}
								</div>
							</button>
						);
					})}
				</div>
			</div>
		</div>
	);
}
