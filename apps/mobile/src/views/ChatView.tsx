import { useState } from "react";
import { useConnectionStore } from "../connection/connection-store";
import { useSessionStore } from "../state/session-store";
import { disconnectAndForget } from "../state/wiring";
import PairingDiagnostics from "../connection/PairingDiagnostics";
import Transcript from "./Transcript";
import Composer from "./Composer";
import SessionDrawer from "./SessionDrawer";
import ModelSheet from "./ModelSheet";
import ExtensionDialog from "./ExtensionDialog";
import Toaster from "./Toaster";

/**
 * Main chat surface: header (connection + model + session entry points),
 * transcript, live extension widgets, composer, and overlay layers.
 */
export default function ChatView() {
	const target = useConnectionStore((s) => s.current);
	const status = useSessionStore((s) => s.status);
	const connectFailed = useSessionStore((s) => s.connectFailed);
	const state = useSessionStore((s) => s.state);
	const [drawerOpen, setDrawerOpen] = useState(false);
	const [modelOpen, setModelOpen] = useState(false);
	const [diagOpen, setDiagOpen] = useState(false);

	const connected = status === "connected";
	const modelName = state?.model ? `${state.model.provider}/${state.model.id}` : "no model";

	return (
		<div className="flex h-full flex-col bg-bg">
			<header className="safe-top flex items-center gap-2 border-b border-line bg-panel px-3 py-2.5">
				<span
					className={`h-2 w-2 shrink-0 rounded-full ${connected ? "bg-success" : status === "connecting" ? "animate-pulse bg-warning" : "bg-error"}`}
					title={status}
				/>
				<div className="min-w-0 flex-1">
					<div className="truncate font-serif text-[0.95rem] font-semibold leading-tight text-ink">
						{state?.sessionName || target?.name || "Session"}
					</div>
					<button
						type="button"
						className="max-w-full truncate text-left text-xs text-muted"
						onClick={() => setModelOpen(true)}
					>
						{modelName}
						{state && <span className="text-faint"> · {state.thinkingLevel}</span>}
					</button>
				</div>
				<button
					type="button"
					className="rounded-lg border border-line bg-panel-2 px-3 py-1.5 text-sm font-medium text-ink active:opacity-70"
					onClick={() => setDrawerOpen(true)}
				>
					Sessions
				</button>
				<button
					type="button"
					className="rounded-lg border border-line bg-panel-2 px-3 py-1.5 text-sm text-muted active:opacity-70"
					onClick={disconnectAndForget}
					title="Disconnect"
				>
					⏻
				</button>
			</header>

			{!connected &&
				(connectFailed && status === "disconnected" ? (
					<div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 bg-error/10 px-4 py-1.5 text-center text-xs text-error">
						<span>配对失败 — 服务重启后令牌会更换，请重新扫码</span>
						<button type="button" className="underline active:opacity-70" onClick={disconnectAndForget}>
							重新配对
						</button>
						<button type="button" className="underline active:opacity-70" onClick={() => setDiagOpen(true)}>
							查看诊断
						</button>
					</div>
				) : (
					<div className="bg-warning/12 px-4 py-1.5 text-center text-xs text-warning">
						{status === "connecting" ? "连接中…" : "重连中…"}
					</div>
				))}

			<Transcript />

			<Composer />

			<SessionDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
			<ModelSheet open={modelOpen} onClose={() => setModelOpen(false)} />
			<ExtensionDialog />
			{diagOpen && <PairingDiagnostics onClose={() => setDiagOpen(false)} />}
			<Toaster />
		</div>
	);
}
