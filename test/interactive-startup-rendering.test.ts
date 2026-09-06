import assert from "node:assert/strict";
import test from "node:test";
import { Container } from "@catui/tui";
import { InteractiveMode } from "../modes/interactive/interactive-mode.js";
import { InteractiveState } from "../modes/interactive/state/interactive-state.js";
import { initTheme } from "../modes/interactive/theme/theme.js";

initTheme("dark");

test("interactive startup builds the initial transcript once before the first visible frame", async () => {
	const calls = {
		addedChildren: [] as unknown[],
		chatClears: 0,
		renders: 0,
		starts: 0,
	};
	const mode = Object.create(InteractiveMode.prototype) as InteractiveMode & Record<string, any>;

	mode.isInitialized = false;
	mode.options = {};
	mode.version = "test";
	mode.imagePipeline = {
		cleanupStaleClipboardFiles: () => {},
	};
	mode.fdPath = undefined;
	mode.ui = {
		terminal: {
			columns: 80,
			rows: 24,
			write: () => {},
		},
		addChild: (child: unknown) => {
			calls.addedChildren.push(child);
		},
		setFocus: () => {},
		start: () => {
			calls.starts += 1;
		},
		requestRender: () => {},
	};
	mode.headerContainer = new Container();
	Object.defineProperty(mode, "settingsManager", {
		value: {
			getQuietStartup: () => true,
		},
		configurable: true,
	});
	mode.notificationQueue = new Container();
	mode.chatContainer = new Container();
	const originalClear = mode.chatContainer.clear.bind(mode.chatContainer);
	mode.chatContainer.clear = () => {
		calls.chatClears += 1;
		originalClear();
	};
	mode.pendingMessagesContainer = new Container();
	mode.statusContainer = new Container();
	mode.surfaces = {
		renderWidgets: () => {},
	};
	mode.widgetContainerAbove = new Container();
	mode.editorContainer = new Container();
	mode.widgetContainerBelow = new Container();
	mode.footer = new Container();
	mode.editor = new Container();
	mode.setupKeyHandlers = () => {};
	mode.setupEditorSubmitHandler = () => {};
	mode.applyPersonaFromSessionIfAny = async () => {};
	mode.initExtensions = async () => {};
	mode.renderInitialMessages = () => {
		calls.renders += 1;
	};
	mode.prewarmStartupTools = () => {};
	mode.updateTerminalTitle = () => {};
	mode.subscribeToAgent = () => {};
	mode.session = {
		extensionRunner: {
			emit: async () => {},
		},
		warmupMcpTools: async () => {},
	};
	mode.footerDataProvider = {
		onBranchChange: () => {},
	};
	mode.modelOverlay = {
		updateAvailableProviderCount: async () => {},
	};

	await mode.init();

	// Startup transcript fill is fire-and-forget since the async-first-frame
	// redesign: flush pending microtasks before asserting on call counts.
	await new Promise((resolve) => setImmediate(resolve));

	assert.equal(calls.starts, 1);
	assert.equal(calls.renders, 1);
	// init() intentionally clears the chat once before the async transcript
	// fill, dropping placeholder content written before initExtensions finished.
	assert.equal(calls.chatClears, 1);
	assert.equal(
		calls.addedChildren.filter((child) => child === mode.footer).length,
		1,
	);
});

test("initial transcript build does not request a render before the terminal starts", () => {
	const calls = {
		requests: 0,
	};
	const mode = Object.create(InteractiveMode.prototype) as InteractiveMode & Record<string, any>;

	mode.version = "test";
	mode.state = new InteractiveState();
	mode.ui = {
		terminal: {
			columns: 80,
			rows: 24,
			write: () => {},
		},
		requestRender: () => {
			calls.requests += 1;
		},
	};
	Object.defineProperty(mode, "settingsManager", {
		value: {
			getQuietStartup: () => true,
		},
		configurable: true,
	});
	mode.notificationQueue = new Container();
	mode.chatContainer = new Container();
	mode.pendingMessagesContainer = new Container();
	mode.footer = {
		invalidate: () => {},
	};
	mode.stopWelcomeBannerTimer = () => {};
	mode.updateEditorBorderColor = () => {};
	mode.getAppKeyDisplay = () => "Esc";
	mode.getMarkdownThemeWithSettings = () => ({});
	mode.editor = {
		addToHistory: () => {},
	};
	Object.defineProperty(mode, "sessionManager", {
		value: {
			buildSessionContext: () => ({
				messages: [
					{
						role: "user",
						content: [{ type: "text", text: "existing prompt" }],
						timestamp: 1,
					},
				],
				entries: [],
			}),
			getEntries: () => [],
		},
		configurable: true,
	});
	mode.session = {
		model: { name: "test-model" },
		cwd: "/tmp",
	};

	mode.renderInitialMessages({ requestRender: false });

	assert.equal(calls.requests, 0);
});
