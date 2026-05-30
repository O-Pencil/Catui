/**
 * [WHO]: messages - English translations for user-facing messages
 * [FROM]: No external dependencies
 * [TO]: Consumed by core/platform/i18n/index.ts
 * [HERE]: core/platform/i18n/messages.ts - English message translations
 */

export const messages = {
	// General
	error: "Error",
	warning: "Warning",
	info: "Info",
	success: "Success",
	confirm: "Confirm",
	cancel: "Cancel",
	yes: "Yes",
	no: "No",
	ok: "OK",
	save: "Save",
	close: "Close",
	retry: "Retry",
	loading: "Loading...",

	// Session
	newSession: "New session",
	continueSession: "Continue session",
	sessionSaved: "Session saved",
	sessionLoaded: "Session loaded",
	noSessions: "No sessions found",

	// Settings
	settings: "Settings",
	language: "Language",
	theme: "Theme",
	model: "Model",
	thinkingLevel: "Thinking Level",

	// Model
	selectModel: "Select Model",
	modelChanged: "Model changed to",
	noModelsAvailable: "No models available",

	// API Key
	apiKeyRequired: "API key required",
	enterApiKey: "Enter your API key",
	apiKeySaved: "API key saved",
	apiKeyInvalid: "Invalid API key",

	// Extensions
	extensions: "Extensions",
	extensionEnabled: "Extension enabled",
	extensionDisabled: "Extension disabled",
	extensionError: "Extension error",

	// Memory
	memory: "Memory",
	memoryUpdated: "Memory updated",
	memoryCleared: "Memory cleared",

	// Errors
	errorOccurred: "An error occurred",
	tryAgain: "Please try again",
	networkError: "Network error",
	timeoutError: "Request timeout",

	// Confirmations
	confirmQuit: "Are you sure you want to quit?",
	confirmNewSession: "Start a new session? Current session will be saved.",
	confirmDelete: "Are you sure you want to delete?",

	// Presence (AI generation fails or memory is empty - fallback messages)
	presence: {
		opening: [
			"Hey, what's up?",
			"Ready when you are.",
			"What do you want to work on?",
			"Any ideas?",
			"Let's do this.",
		],
		idle: [
			"Still here when you need me.",
			"No rush, take your time.",
			"Ready when you are.",
			"I'll be here.",
			"Whenever you're ready.",
		],
	},
};
