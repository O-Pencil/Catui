import { useEffect } from "react";
import { useSessionStore } from "../state/session-store";

/** Bottom toast stack for notify requests, extension errors, and status notes. */
export default function Toaster() {
	const toasts = useSessionStore((s) => s.toasts);
	const dismissToast = useSessionStore((s) => s.dismissToast);

	useEffect(() => {
		if (toasts.length === 0) return;
		const timers = toasts.map((toast) => setTimeout(() => dismissToast(toast.id), 5_000));
		return () => timers.forEach(clearTimeout);
	}, [toasts, dismissToast]);

	if (toasts.length === 0) return null;

	return (
		<div className="pointer-events-none fixed inset-x-3 bottom-24 z-40 space-y-2">
			{toasts.map((toast) => (
				<button
					key={toast.id}
					type="button"
					className={`pointer-events-auto block w-full rounded-xl border px-3.5 py-2.5 text-left text-sm shadow-[0_2px_10px_rgba(45,36,22,0.10)] active:opacity-70 ${
						toast.kind === "error"
							? "border-error/30 bg-error/12 text-error"
							: toast.kind === "warning"
								? "border-warning/30 bg-warning/15 text-warning"
								: "border-line bg-panel-2 text-ink"
					}`}
					onClick={() => dismissToast(toast.id)}
				>
					{toast.message}
				</button>
			))}
		</div>
	);
}
