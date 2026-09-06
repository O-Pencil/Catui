import { memo, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AgentMessage, AssistantMessage, ToolCall, ToolResultMessage, UserMessage } from "../protocol/types";
import ToolCallCard from "./ToolCallCard";

interface MessageBubbleProps {
	message: AgentMessage;
	toolResults: Map<string, ToolResultMessage>;
}

/** One transcript row: user bubble or assistant block (thinking/text/tool calls). */
function MessageBubble({ message, toolResults }: MessageBubbleProps) {
	if (message.role === "user") {
		return <UserRow message={message} />;
	}
	if (message.role === "assistant") {
		return <AssistantRow message={message} toolResults={toolResults} />;
	}
	// toolResult rows render inside their ToolCallCard
	return null;
}

function textOf(content: UserMessage["content"]): string {
	if (typeof content === "string") return content;
	return content
		.filter((block): block is { type: "text"; text: string } => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

function UserRow({ message }: { message: UserMessage }) {
	return (
		<div className="mb-3 flex justify-end">
			<div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm border border-line bg-user-bubble px-3.5 py-2 text-[0.9375rem] leading-relaxed text-ink">
				{textOf(message.content)}
			</div>
		</div>
	);
}

function AssistantRow({
	message,
	toolResults,
}: {
	message: AssistantMessage;
	toolResults: Map<string, ToolResultMessage>;
}) {
	const thinking = message.content.filter((block): block is { type: "thinking"; thinking: string } => block.type === "thinking");
	const texts = message.content.filter((block): block is { type: "text"; text: string } => block.type === "text");
	const toolCalls = message.content.filter((block): block is ToolCall => block.type === "toolCall");
	const errored = message.stopReason === "error";

	return (
		<div className="mb-4">
			{thinking.length > 0 && <ThinkingBlock key={message.timestamp} thinking={thinking.map((t) => t.thinking).join("\n")} />}
			{texts.map((block, index) => (
				<div key={index} className="md-body text-ink">
					<Markdown remarkPlugins={[remarkGfm]}>{block.text}</Markdown>
				</div>
			))}
			{toolCalls.map((call) => (
				<ToolCallCard key={call.id} call={call} result={toolResults.get(call.id)} />
			))}
			{errored && message.errorMessage && (
				<div className="mt-1 rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">
					{message.errorMessage}
				</div>
			)}
		</div>
	);
}

function ThinkingBlock({ thinking }: { thinking: string }) {
	const [open, setOpen] = useState(false);
	return (
		<div className="mb-2">
			<button
				type="button"
				className="text-xs italic text-faint active:text-muted"
				onClick={() => setOpen(!open)}
			>
				{open ? "▾" : "▸"} thinking ({thinking.length} chars)
			</button>
			{open && (
				<pre className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg bg-panel-2 px-3 py-2 font-mono text-xs text-muted">
					{thinking}
				</pre>
			)}
		</div>
	);
}

export default memo(MessageBubble);
