import { useEffect, useState } from "react";
import { useConnectionStore, normalizeEndpoint, parseConnectDeepLink, targetFromPageUrl, type ConnectionTarget } from "./connection-store";
import { connectTo } from "../state/wiring";
import QrScanner from "./QrScanner";

/**
 * Pairing surface: QR scan, manual endpoint+token entry, saved endpoints.
 * Also handles the browser entry flow (?token= on the serve URL).
 */
export default function ConnectScreen() {
	const history = useConnectionStore((s) => s.history);
	const forget = useConnectionStore((s) => s.forget);
	const [endpoint, setEndpoint] = useState("");
	const [token, setToken] = useState("");
	const [scanning, setScanning] = useState(false);

	// Browser flow: served directly by `catui --serve` with ?token= pre-filled
	useEffect(() => {
		const target = targetFromPageUrl();
		if (target) {
			connectTo(target);
			return;
		}
		const last = history[0];
		if (last) {
			setEndpoint(last.endpoint);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	function submit() {
		const normalized = normalizeEndpoint(endpoint);
		if (!normalized || !token.trim()) return;
		connectTo({ endpoint: normalized, token: token.trim() });
	}

	function handleScan(payload: string) {
		const deepLink = parseConnectDeepLink(payload);
		if (deepLink) {
			setScanning(false);
			connectTo(deepLink);
			return;
		}
		// Also accept raw serve banner URLs (http://ip:port/?token=...)
		try {
			const url = new URL(payload);
			if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("not a serve URL");
			const scannedToken = url.searchParams.get("token");
			if (scannedToken) {
				const wsProtocol = url.protocol === "https:" ? "wss:" : "ws:";
				setScanning(false);
				connectTo({ endpoint: `${wsProtocol}//${url.host}/ws`, token: scannedToken, name: url.hostname });
			}
		} catch {
			// not a pairing payload — keep scanning
		}
	}

	return (
		<div className="safe-top safe-bottom flex h-full flex-col overflow-y-auto px-5 py-8">
			<div className="mx-auto w-full max-w-sm">
				<div className="mb-8 text-center">
					<div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-2xl">
						🐈
					</div>
					<h1 className="font-serif text-2xl font-semibold text-ink">Catui Remote</h1>
					<p className="mt-1 text-sm text-muted">在手机上操控电脑里的 Catui</p>
				</div>

				<button
					type="button"
					className="mb-6 w-full rounded-xl bg-accent py-3 font-semibold text-on-accent active:opacity-80"
					onClick={() => setScanning(true)}
				>
					扫码配对
				</button>

				<div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">手动输入</div>
				<div className="space-y-3 rounded-xl border border-line bg-panel p-4">
					<label className="block">
						<span className="mb-1 block text-sm text-muted">服务地址</span>
						<input
							className="w-full rounded-lg border border-line bg-panel-2 px-3 py-2.5 font-mono text-sm text-ink outline-none placeholder:text-faint focus:border-accent"
							placeholder="ws://192.168.0.17:8787/ws"
							value={endpoint}
							onChange={(e) => setEndpoint(e.target.value)}
							spellCheck={false}
							autoCapitalize="off"
						/>
					</label>
					<label className="block">
						<span className="mb-1 block text-sm text-muted">配对令牌</span>
						<input
							className="w-full rounded-lg border border-line bg-panel-2 px-3 py-2.5 font-mono text-sm text-ink outline-none placeholder:text-faint focus:border-accent"
							placeholder="见电脑端 catui --serve 输出"
							value={token}
							onChange={(e) => setToken(e.target.value)}
							spellCheck={false}
							autoCapitalize="off"
						/>
					</label>
					<button
						type="button"
						className="w-full rounded-lg bg-panel-2 py-2.5 font-medium text-ink active:opacity-80 disabled:opacity-40"
						disabled={!endpoint.trim() || !token.trim()}
						onClick={submit}
					>
						连接
					</button>
				</div>

				{history.length > 0 && (
					<>
						<div className="mb-2 mt-6 text-xs font-medium uppercase tracking-wide text-muted">历史连接</div>
						<div className="space-y-2">
							{history.map((entry: ConnectionTarget) => (
								<div key={entry.endpoint} className="flex items-center gap-2 rounded-xl border border-line bg-panel px-3 py-2.5">
									<button
										type="button"
										className="min-w-0 flex-1 text-left"
										onClick={() => {
											setEndpoint(entry.endpoint);
											setToken("");
										}}
									>
										<div className="truncate font-mono text-sm text-ink">{entry.endpoint}</div>
										{entry.name && <div className="text-xs text-muted">{entry.name}</div>}
									</button>
									<button
										type="button"
										className="rounded-lg px-2 py-1 text-xs text-muted active:text-error"
										onClick={() => forget(entry.endpoint)}
									>
										删除
									</button>
								</div>
							))}
						</div>
						<p className="mt-2 text-xs text-faint">令牌在每次服务重启后更换 — 需重新扫码或输入新令牌</p>
					</>
				)}
			</div>

			{scanning && <QrScanner onResult={handleScan} onClose={() => setScanning(false)} />}
		</div>
	);
}
