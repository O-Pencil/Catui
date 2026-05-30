/**
 * [WHO]: loadTokenSaveConfigFilters() trusted user/project filter loader
 * [FROM]: Depends on node:fs/promises, node:os, node:path, ./toml-dsl
 * [TO]: Consumed by extensions/builtin/token-save/index.ts
 * [HERE]: extensions/builtin/token-save/config.ts - configurable TokenSave filters with project trust guard
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { TomlStyleFilter } from "./toml-dsl.js";

export interface ConfiguredTokenSaveFilter {
	name: string;
	commandPattern: string;
	filter: TomlStyleFilter;
	source: "user" | "project";
}

interface TokenSaveConfigFile {
	filters?: ConfiguredTokenSaveFilter[];
}

interface TokenSaveTrustFile {
	trusted?: boolean;
}

export async function loadTokenSaveConfigFilters(projectPath: string): Promise<ConfiguredTokenSaveFilter[]> {
	const userPath = join(homedir(), ".pencils", "token-save", "filters.json");
	const projectPathConfig = join(projectPath, ".nanopencil", "token-save", "filters.json");
	const projectTrustPath = join(projectPath, ".nanopencil", "token-save", "trust.json");

	const filters: ConfiguredTokenSaveFilter[] = [];
	filters.push(...(await readFilters(userPath, "user")));

	if (await isProjectTrusted(projectTrustPath)) {
		filters.push(...(await readFilters(projectPathConfig, "project")));
	}

	return filters;
}

async function isProjectTrusted(path: string): Promise<boolean> {
	try {
		const trust = JSON.parse(await readFile(path, "utf8")) as TokenSaveTrustFile;
		return trust.trusted === true;
	} catch {
		return false;
	}
}

async function readFilters(path: string, source: "user" | "project"): Promise<ConfiguredTokenSaveFilter[]> {
	try {
		const parsed = JSON.parse(await readFile(path, "utf8")) as TokenSaveConfigFile;
		return (parsed.filters ?? [])
			.filter((filter) => isSafeFilter(filter))
			.map((filter) => ({ ...filter, source }));
	} catch {
		return [];
	}
}

function isSafeFilter(filter: ConfiguredTokenSaveFilter): boolean {
	if (!filter || typeof filter.name !== "string" || typeof filter.commandPattern !== "string") return false;
	if (filter.commandPattern.length > 240) return false;
	if (!canCompile(filter.commandPattern)) return false;
	if (!filter.filter || typeof filter.filter !== "object") return false;
	const regexLists = [
		filter.filter.stripLines ?? [],
		filter.filter.keepLines ?? [],
		(filter.filter.replace ?? []).map((rule) => rule.pattern),
		(filter.filter.matchMessage ?? []).map((rule) => rule.pattern),
	];
	return regexLists.flat().every((pattern) => typeof pattern === "string" && pattern.length <= 240 && canCompile(pattern));
}

function canCompile(pattern: string): boolean {
	try {
		new RegExp(pattern);
		return true;
	} catch {
		return false;
	}
}
