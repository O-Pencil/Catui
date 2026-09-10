/**
 * [WHO]: Validated source evolution policy and calendar schedule
 * [FROM]: Node path/fs and local configuration contract
 * [TO]: CLI, observer and delivery supervisor
 * [HERE]: extensions/optional/evolution/source/runtime/config.ts - policy authority
 */
import { readFileSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import type { SourceConfig } from "../types.js";

export function sourceRoot(agentDir: string): string { return join(agentDir, "evolution", "source"); }
export function defaultConfig(agentDir: string, model: string, reviewModel?: string): SourceConfig {
	return {
		version: 1, enabled: true, repository: "O-Pencil/Catui", branch: "main", packageName: "catui-agent",
		agentDir, model, reviewModel, repairScope: "source", timeZone: "Asia/Shanghai", hour: 3,
		autoMerge: true, autoPublish: true, autoUpdate: true, allowRemotePush: false,
		maxWorkerRunsPerDay: 8, maxJobsPerDay: 1, maxWorkerSeconds: 600, maxTurns: 24,
		maxAttempts: 3, minimumFailures: 2, measurementSamples: 30, regressionMargin: 0.1,
		requiredChecks: ["Test on Node.js 20", "Test on Node.js 22", "Test Packages", "architecture-boundaries", "Source evolution (macOS)"],
	};
}
export function validateConfig(value: unknown): SourceConfig {
	if (!value || typeof value !== "object") throw new Error("Invalid source evolution configuration");
	const c = value as SourceConfig;
	if (c.version !== 1 || !/^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/.test(c.repository) || c.packageName !== "catui-agent") throw new Error("Invalid source repository or package");
	if (!/^[\w/-]+$/.test(c.branch) || c.branch.includes("..") || !isAbsolute(c.agentDir)) throw new Error("Invalid branch or agent directory");
	if (typeof c.model !== "string" || !c.model.trim()) throw new Error("Configure an explicit model before enabling source evolution");
	if (c.reviewModel !== undefined && (typeof c.reviewModel !== "string" || !c.reviewModel.trim() || modelFamily(c.reviewModel) === modelFamily(c.model))) throw new Error("Review requires a different model identity from repair");
	if (c.repairScope !== undefined && !["source", "adaptive"].includes(c.repairScope)) throw new Error("Invalid repair scope");
	for (const key of ["enabled", "autoMerge", "autoPublish", "autoUpdate", "allowRemotePush"] as const) if (typeof c[key] !== "boolean") throw new Error(`Invalid ${key}`);
	for (const key of ["maxWorkerRunsPerDay", "maxJobsPerDay", "maxWorkerSeconds", "maxTurns", "maxAttempts", "minimumFailures", "measurementSamples"] as const) {
		if (!Number.isSafeInteger(c[key]) || c[key] < 1 || c[key] > 10000) throw new Error(`Invalid ${key}`);
	}
	if (!Number.isInteger(c.hour) || c.hour < 0 || c.hour > 23) throw new Error("Invalid schedule hour");
	if (!Number.isFinite(c.regressionMargin) || c.regressionMargin < 0 || c.regressionMargin > 1) throw new Error("Invalid regression margin");
	if (!Array.isArray(c.requiredChecks) || c.requiredChecks.length === 0 || c.requiredChecks.some(x => typeof x !== "string" || !x.trim())) throw new Error("Explicit required CI checks are mandatory");
	new Intl.DateTimeFormat("en-US", { timeZone: c.timeZone }).format();
	return c;
}
export function modelFamily(identity: string): string { return identity.slice(identity.indexOf("/") + 1).toLowerCase().replace(/[^a-z0-9]/g, ""); }
export function requireReviewModel(config: SourceConfig): string {
	if (!config.reviewModel || modelFamily(config.reviewModel) === modelFamily(config.model)) throw new Error("Configure an independent review model with catui evolve configure --review-model provider/model");
	return config.reviewModel;
}
export function loadConfig(root: string): SourceConfig | undefined {
	try {
		const parsed = JSON.parse(readFileSync(join(root, "config.json"), "utf8"));
		// Configs written by older versions predate later policy fields; backfill defaults before validation.
		return validateConfig(parsed && typeof parsed === "object" ? { allowRemotePush: false, ...parsed } : parsed);
	} catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw e; }
}
export function calendar(config: SourceConfig, now = new Date()): { day: string; due: boolean } {
	const parts = new Intl.DateTimeFormat("en-CA", { timeZone: config.timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
	const p = Object.fromEntries(parts.map(v => [v.type, v.value]));
	return { day: `${p.year}-${p.month}-${p.day}`, due: Number(p.hour) >= config.hour };
}
