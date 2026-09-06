import { useEffect, useMemo, useState } from "react";
import { useSessionStore } from "../state/session-store";
import type { ThinkingLevel } from "../protocol/types";

interface ModelSheetProps {
	open: boolean;
	onClose: () => void;
}

const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

/** Bottom sheet: model picker + thinking level chips. */
export default function ModelSheet({ open, onClose }: ModelSheetProps) {
	const models = useSessionStore((s) => s.models);
	const state = useSessionStore((s) => s.state);
	const refreshModels = useSessionStore((s) => s.refreshModels);
	const setModel = useSessionStore((s) => s.setModel);
	const setThinkingLevel = useSessionStore((s) => s.setThinkingLevel);
	const [filter, setFilter] = useState("");

	useEffect(() => {
		if (open) {
			setFilter("");
			void refreshModels();
		}
	}, [open, refreshModels]);

	const grouped = useMemo(() => {
		const query = filter.trim().toLowerCase();
		const byProvider = new Map<string, typeof models>();
		for (const model of models) {
			if (query && !`${model.provider}/${model.id}`.toLowerCase().includes(query)) continue;
			const list = byProvider.get(model.provider) ?? [];
			list.push(model);
			byProvider.set(model.provider, list);
		}
		return [...byProvider.entries()].sort(([a], [b]) => a.localeCompare(b));
	}, [models, filter]);

	if (!open) return null;

	const current = state?.model;

	return (
		<div className="fixed inset-0 z-40 flex items-end">
			<div className="absolute inset-0 bg-ink/45" onClick={onClose} />
			<div className="safe-bottom relative max-h-[80%] w-full rounded-t-2xl border-t border-line bg-panel">
				<div className="flex items-center justify-between border-b border-line px-4 py-3">
					<span className="font-serif text-base font-semibold text-ink">Model &amp; thinking</span>
					<button type="button" className="rounded-lg border border-line bg-panel-2 px-3 py-1.5 text-sm text-ink active:opacity-70" onClick={onClose}>
						Close
					</button>
				</div>

				<div className="px-4 pt-3">
					<div className="mb-1 text-xs uppercase tracking-wide text-muted">Thinking level</div>
					<div className="flex flex-wrap gap-1.5">
						{THINKING_LEVELS.map((level) => (
							<button
								key={level}
								type="button"
								className={`rounded-full px-3 py-1 text-xs ${
									state?.thinkingLevel === level ? "bg-accent font-medium text-on-accent" : "bg-panel-2 text-muted"
								}`}
								onClick={() => {
									onClose();
									void setThinkingLevel(level);
								}}
							>
								{level}
							</button>
						))}
					</div>
				</div>

				<div className="px-4 pb-2 pt-4">
					<input
						className="w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-faint focus:border-accent"
						placeholder="Filter models…"
						value={filter}
						onChange={(e) => setFilter(e.target.value)}
					/>
				</div>

				<div className="max-h-[45vh] overflow-y-auto px-4 pb-4">
					{grouped.length === 0 && <p className="py-6 text-center text-sm text-faint">No models found.</p>}
					{grouped.map(([provider, list]) => (
						<div key={provider} className="mb-3">
							<div className="mb-1 text-xs uppercase tracking-wide text-muted">{provider}</div>
							{list.map((model) => {
								const active = current?.provider === model.provider && current?.id === model.id;
								return (
									<button
										key={`${model.provider}/${model.id}`}
										type="button"
										className={`mb-1 block w-full rounded-lg px-3 py-2 text-left text-sm active:opacity-70 ${
											active ? "bg-accent-soft text-accent-ink" : "bg-panel-2 text-ink"
										}`}
										onClick={() => {
											onClose();
											void setModel(model.provider, model.id);
										}}
									>
										<span className="font-mono">{model.id}</span>
										{model.reasoning && <span className="ml-2 text-[0.65rem] text-faint">reasoning</span>}
									</button>
								);
							})}
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
