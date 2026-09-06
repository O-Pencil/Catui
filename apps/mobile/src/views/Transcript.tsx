import { useEffect, useMemo, useRef } from "react";
import { useSessionStore } from "../state/session-store";
import type { AgentMessage, ToolResultMessage } from "../protocol/types";
import MessageBubble from "./MessageBubble";

/**
 * Scrollable transcript. Derived entirely from the message list: assistant
 * tool-call blocks look up their results via a by-callId index, so streaming
 * updates and reconnect snapshots render through the same path.
 */
export default function Transcript() {
	const messages = useSessionStore((s) => s.messages);
	const isStreaming = useSessionStore((s) => s.state?.isStreaming ?? false);
	const scrollSignal = useSessionStore((s) => s.scrollSignal);

	const bottomRef = useRef<HTMLDivElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const stickToBottom = useRef(true);

	const toolResults = useMemo(() => {
		const index = new Map<string, ToolResultMessage>();
		for (const message of messages) {
			if (message.role === "toolResult") {
				index.set(message.toolCallId, message);
			}
		}
		return index;
	}, [messages]);

	useEffect(() => {
		if (!stickToBottom.current) return;
		bottomRef.current?.scrollIntoView({ block: "end" });
	}, [scrollSignal, messages.length, isStreaming]);

	function handleScroll() {
		const el = containerRef.current;
		if (!el) return;
		stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
	}

	return (
		<div
			ref={containerRef}
			onScroll={handleScroll}
			className="flex-1 overflow-y-auto px-3 py-3"
		>
			{messages.length === 0 && (
				<div className="mx-auto mt-16 max-w-xs text-center font-serif text-sm italic text-faint">
					No messages yet. Send a prompt to start working with the agent.
				</div>
			)}
			{messages.map((message: AgentMessage) => (
				<MessageBubble key={`${message.role}-${message.timestamp}`} message={message} toolResults={toolResults} />
			))}
			{isStreaming && (
				<div className="ml-1 mt-1 flex items-center gap-1.5 text-xs text-muted">
					<span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
					working…
				</div>
			)}
			<div ref={bottomRef} />
		</div>
	);
}
