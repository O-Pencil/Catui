/**
 * [WHO]: Provides default PairingDiagnostics (bottom sheet with probe results + copy)
 * [FROM]: Depends on zustand stores (src/state/session-store, src/connection/connection-store)
 * [TO]: Consumed by src/views/ChatView.tsx (pairing-failure banner entry)
 * [HERE]: apps/mobile/src/connection/PairingDiagnostics.tsx - pairing failure diagnostics: per-endpoint healthz probe results in plain language, one-tap copy for bug reports
 */
import { useState } from "react";
import { useSessionStore, type PairingProbe } from "../state/session-store";
import { useConnectionStore } from "./connection-store";

const STATUS_TEXT: Record<PairingProbe["status"], { icon: string; label: string; hint: string; tone: string }> = {
	ok: {
		icon: "✅",
		label: "网络可达，令牌有效",
		hint: "WebSocket 连接失败可能是瞬时问题，正在自动重试",
		tone: "text-success",
	},
	badToken: {
		icon: "⚠️",
		label: "网络可达，但令牌无效",
		hint: "电脑端服务重启后令牌会更换 — 请在电脑上重新运行 catui --serve 并重新扫码",
		tone: "text-warning",
	},
	unreachable: {
		icon: "❌",
		label: "无法连通",
		hint: "请检查：手机与电脑是否在同一 WiFi；路由器是否开启 AP 隔离；电脑防火墙是否放行",
		tone: "text-error",
	},
};

async function copyText(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		try {
			const textarea = document.createElement("textarea");
			textarea.value = text;
			textarea.style.position = "fixed";
			textarea.style.opacity = "0";
			document.body.appendChild(textarea);
			textarea.select();
			const ok = document.execCommand("copy");
			document.body.removeChild(textarea);
			return ok;
		} catch {
			return false;
		}
	}
}

/** Build the plain-text diagnostics block that gets copied for debugging. */
function buildReport(target: { endpoint: string; name?: string } | null, probes: PairingProbe[]): string {
	const lines = [
		"Catui 连接诊断",
		`时间: ${new Date().toLocaleString()}`,
	];
	if (target) {
		lines.push(`目标: ${target.endpoint}${target.name ? ` (${target.name})` : ""}`);
	}
	lines.push("探测结果:");
	for (const probe of probes) {
		const label = STATUS_TEXT[probe.status].label;
		lines.push(`  ${probe.endpoint} → [${probe.status}] ${label}${probe.detail ? ` (${probe.detail})` : ""}`);
	}
	lines.push(`UA: ${typeof navigator !== "undefined" ? navigator.userAgent : "unknown"}`);
	return lines.join("\n");
}

export default function PairingDiagnostics({ onClose }: { onClose: () => void }) {
	const target = useConnectionStore((s) => s.current);
	const probes = useSessionStore((s) => s.pairingProbes);
	const probesState = useSessionStore((s) => s.probesState);
	const [copied, setCopied] = useState(false);

	async function handleCopy() {
		const ok = await copyText(buildReport(target, probes));
		setCopied(ok);
		setTimeout(() => setCopied(false), 2000);
	}

	return (
		<div className="fixed inset-0 z-40 flex flex-col justify-end bg-ink/45" onClick={onClose}>
			<div
				className="safe-bottom max-h-[70%] overflow-y-auto rounded-t-2xl border-t border-line bg-panel p-5"
				onClick={(event) => event.stopPropagation()}
			>
				<div className="mb-4 flex items-center justify-between">
					<h2 className="font-serif text-base font-semibold text-ink">连接诊断</h2>
					<button type="button" className="rounded-lg border border-line bg-panel-2 px-3 py-1.5 text-sm text-ink active:opacity-70" onClick={onClose}>
						关闭
					</button>
				</div>

				{probesState === "running" && (
					<p className="py-4 text-center text-sm text-muted">正在探测各服务地址…</p>
				)}

				{probesState === "done" && (
					<div className="space-y-3">
						{probes.map((probe) => {
							const meta = STATUS_TEXT[probe.status];
							return (
								<div key={probe.endpoint} className="rounded-xl border border-line bg-panel-2 p-3">
									<div className={`flex items-center gap-2 text-sm font-medium ${meta.tone}`}>
										<span>{meta.icon}</span>
										<span>{meta.label}</span>
									</div>
									<div className="mt-1 break-all font-mono text-xs text-muted">{probe.endpoint}</div>
									<p className="mt-1.5 text-xs leading-relaxed text-muted">{meta.hint}</p>
								</div>
							);
						})}
						<button
							type="button"
							className="w-full rounded-xl bg-accent py-2.5 text-sm font-semibold text-on-accent active:opacity-80"
							onClick={handleCopy}
						>
							{copied ? "已复制 ✓" : "复制诊断信息"}
						</button>
					</div>
				)}
			</div>
		</div>
	);
}
