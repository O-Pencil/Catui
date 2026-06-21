import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Container, TUI } from "@catui/tui";
import type { Message } from "@catui/ai/types";
import { StreamRenderController, type StreamRenderContext } from "../modes/interactive/controllers/stream-render-controller.js";
import { InteractiveState } from "../modes/interactive/state/interactive-state.js";
import { initTheme } from "../modes/interactive/theme/theme.js";
import {
	createTask,
	getTaskListId,
	listTasks,
	stopAllTaskFileWatchers,
} from "../extensions/builtin/task/task-store.js";

function createController(agentDir: string, state: InteractiveState, ui: TUI, status: Container): StreamRenderController {
	const context: StreamRenderContext = {
		state: { get: () => state },
		layout: {
			getUi: () => ui,
			getChatContainer: () => new Container() as never,
			getStatusContainer: () => status,
			addMessageToChat: () => {},
			updatePendingMessagesDisplay: () => {},
			rebuildChatFromMessages: () => {},
			requestRender: () => {},
			invalidateFooter: () => {},
		},
		loaders: {
			getSessionId: () => "task-panel-session",
			getDefaultWorkingMessage: () => "Working...",
			getInterruptKeyHint: () => "Esc",
			setBuddyPetState: () => {},
			startAgentRunTimer: () => {},
			stopAgentRunTimer: () => {},
			updateWorkingMessage: () => {},
			formatElapsedSeconds: () => "0s",
			isInPlanMode: () => false,
		},
		toolTrace: {
			shouldRenderToolTrace: () => false,
			getRegisteredToolDefinition: () => undefined,
			getShowImages: () => false,
		},
		runtime: {
			getRetryAttempt: () => 0,
			abortCompaction: () => {},
			abortRetry: () => {},
			flushCompactionQueue: () => {},
			checkShutdownRequested: async () => {},
			clearAttachments: () => {},
			getAgentDir: () => agentDir,
		},
		escape: {
			getHandler: () => undefined,
			setHandler: () => {},
		},
		surface: {
			ensureInitialized: async () => {},
			restoreEditorFocusIfPossible: () => {},
			getUserMessageText: (message: Message) =>
				message.content
					.filter((part) => part.type === "text")
					.map((part) => part.text)
					.join("\n"),
			getMarkdownThemeWithSettings: () => ({}) as never,
			showStatus: () => {},
			showError: () => {},
		},
	};
	return new StreamRenderController(context);
}

test("StreamRenderController auto-hides completed task panel without deleting completed task files", async () => {
	initTheme("dark", false);
	const agentDir = mkdtempSync(join(tmpdir(), "catui-stream-task-panel-"));
	const taskListId = getTaskListId("task-panel-session");
	const originalSetTimeout = globalThis.setTimeout;
	const originalClearTimeout = globalThis.clearTimeout;
	let autoHideCallback: (() => Promise<void>) | undefined;
	const state = new InteractiveState();

	(globalThis as unknown as { setTimeout: typeof setTimeout }).setTimeout = ((callback) => {
		autoHideCallback = callback as () => Promise<void>;
		return 1;
	}) as typeof setTimeout;
	(globalThis as unknown as { clearTimeout: typeof clearTimeout }).clearTimeout = (() => {}) as typeof clearTimeout;

	try {
		await createTask(agentDir, taskListId, {
			subject: "Completed work",
			description: "",
			status: "completed",
			blocks: [],
			blockedBy: [],
		});

		const ui = new TUI();
		const status = new Container();
		const controller = createController(agentDir, state, ui, status);
		await (controller as unknown as {
			refreshTaskPanel(state: InteractiveState, ui: TUI, statusContainer: Container): Promise<void>;
		}).refreshTaskPanel(state, ui, status);

		assert.ok(autoHideCallback, "completed tasks should schedule panel auto-hide");
		await autoHideCallback();

		const tasksAfterHide = await listTasks(agentDir, taskListId);
		assert.equal(tasksAfterHide.length, 1, "auto-hide should preserve completed task persistence");
		assert.equal(tasksAfterHide[0].subject, "Completed work");
		assert.equal(state.taskStatusPanel, undefined, "auto-hide should still unmount the visible panel");

		await (controller as unknown as {
			refreshTaskPanel(state: InteractiveState, ui: TUI, statusContainer: Container): Promise<void>;
		}).refreshTaskPanel(state, ui, status);
		assert.equal(state.taskStatusPanel, undefined, "same completed snapshot should not resurrect the hidden panel");

		await createTask(agentDir, taskListId, {
			subject: "Follow-up work",
			description: "",
			status: "in_progress",
			blocks: [],
			blockedBy: [],
		});
		await (controller as unknown as {
			refreshTaskPanel(state: InteractiveState, ui: TUI, statusContainer: Container): Promise<void>;
		}).refreshTaskPanel(state, ui, status);
		assert.ok(state.taskStatusPanel, "new active work should restore the task panel");
	} finally {
		state.taskStatusPanel?.dispose?.();
		globalThis.setTimeout = originalSetTimeout;
		globalThis.clearTimeout = originalClearTimeout;
		stopAllTaskFileWatchers();
		rmSync(agentDir, { recursive: true, force: true });
	}
});
