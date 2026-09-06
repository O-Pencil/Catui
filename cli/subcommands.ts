/**
 * [WHO]: reportSettingsErrors(), handleConfigCommand(), handleMigrateCommand()
 * [FROM]: Depends on chalk, cli/config-selector, core/agent-dir/agent-dir-context, core/agent-dir/migration-tool, core/package-manager, core/platform/config/settings-manager
 * [TO]: Consumed by main.ts (config/migrate dispatch + startup settings errors) and cli/package-command.ts
 * [HERE]: cli/subcommands.ts - early-exit config/migrate subcommands + shared settings error drain helper
 */
import chalk from "chalk";
import type { AgentDirContext } from "../core/agent-dir/agent-dir-context.js";
import { MigrationManager, type MigrationOptions } from "../core/agent-dir/migration-tool.js";
import { DefaultPackageManager } from "../core/package-manager.js";
import { SettingsManager } from "../core/platform/config/settings-manager.js";
import { selectConfig } from "./config-selector.js";

export function reportSettingsErrors(settingsManager: SettingsManager, context: string): void {
	const errors = settingsManager.drainErrors();
	for (const { scope, error } of errors) {
		console.error(chalk.yellow(`Warning (${context}, ${scope} settings): ${error.message}`));
		if (error.stack) {
			console.error(chalk.dim(error.stack));
		}
	}
}

export async function handleConfigCommand(args: string[], ctx: AgentDirContext): Promise<boolean> {
	if (args[0] !== "config") {
		return false;
	}

	const cwd = process.cwd();
	const agentDir = ctx.path;
	const settingsManager = SettingsManager.create(cwd, ctx);
	reportSettingsErrors(settingsManager, "config command");
	const packageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager });

	const resolvedPaths = await packageManager.resolve();

	await selectConfig({
		resolvedPaths,
		settingsManager,
		cwd,
		agentDir,
	});

	process.exit(0);
}

export async function handleMigrateCommand(args: string[]): Promise<boolean> {
	if (args[0] !== "migrate") {
		return false;
	}

	const options: MigrationOptions = {
		dryRun: !args.includes("--apply"),
		apply: args.includes("--apply"),
		copy: !args.includes("--move"), // Default to copy
	};

	const manager = new MigrationManager();
	await manager.run(options);
	return true;
}
