/**
 * [WHO]: i18n, t(), setLocale(), getLocale(), AVAILABLE_LOCALES, type Locale
 * [FROM]: No external dependencies
 * [TO]: Consumed by modes/interactive/interactive-mode.ts, core/runtime/agent-session.ts, core/slash-commands.ts
 * [HERE]: core/platform/i18n/index.ts - internationalization core
 */

export type Locale = "en" | "zh";

export const AVAILABLE_LOCALES: Locale[] = ["en", "zh"];

export const LOCALE_NAMES: Record<Locale, string> = {
	en: "English",
	zh: "中文",
};

let currentLocale: Locale = "en";

export function getLocale(): Locale {
	return currentLocale;
}

export function setLocale(locale: Locale): void {
	if (AVAILABLE_LOCALES.includes(locale)) {
		currentLocale = locale;
	}
}

// Import all translation modules
import { slashCommands as slashCommandsEn } from "./slash-commands.js";
import { messages as messagesEn } from "./messages.js";
import { themes as themesEn } from "./themes.js";

import { slashCommands as slashCommandsZh } from "./slash-commands.zh.js";
import { messages as messagesZh } from "./messages.zh.js";
import { themes as themesZh } from "./themes.zh.js";

export type SlashCommands = typeof slashCommandsEn;
export type Messages = typeof messagesEn;
export type Themes = typeof themesEn;

const translations: Record<Locale, { slashCommands: SlashCommands; messages: Messages; themes: Themes }> = {
	en: { slashCommands: slashCommandsEn, messages: messagesEn, themes: themesEn },
	zh: { slashCommands: slashCommandsZh, messages: messagesZh, themes: themesZh },
};

export interface TranslationPaths {
	slashCommands: string[];
	messages: string[];
	themes: string[];
}

export function tValue<T = unknown>(path: string): T | undefined {
	const parts = path.split(".");
	const locale = translations[currentLocale];

	if (parts[0] === "slash") {
		return getNestedValue(locale.slashCommands as unknown as Record<string, unknown>, parts.slice(1)) as T | undefined;
	}
	if (parts[0] === "msg") {
		return getNestedValue(locale.messages as unknown as Record<string, unknown>, parts.slice(1)) as T | undefined;
	}
	if (parts[0] === "theme") {
		return getNestedValue(locale.themes as unknown as Record<string, unknown>, parts.slice(1)) as T | undefined;
	}

	return undefined;
}

export function t(path: string): string {
	const value = tValue(path);
	return typeof value === "string" ? value : path;
}

function getNestedValue(obj: Record<string, unknown>, keys: string[]): unknown {
	let result: unknown = obj;
	for (const key of keys) {
		if (result && typeof result === "object" && key in result) {
			result = (result as Record<string, unknown>)[key];
		} else {
			return undefined;
		}
	}
	return result;
}

// Re-export slash commands with translations
export { slashCommandsEn, slashCommandsZh };
