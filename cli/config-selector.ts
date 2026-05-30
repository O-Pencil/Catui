/**
 * [WHO]: ConfigSelectorOptions, ConfigSelector, runConfigSelector()
 * [FROM]: Depends on tui, core/platform/config, modes/interactive/components
 * [TO]: Consumed by main.ts
 * [HERE]: cli/config-selector.ts - TUI config selector for `nanopencil config` command
 */
import { ProcessTerminal, TUI } from "@pencil-agent/tui";
import type { ResolvedPaths } from "../core/package-manager.js";
import type { SettingsManager } from "../core/platform/config/settings-manager.js";
import { ConfigSelectorComponent } from "../modes/interactive/components/config-selector.js";
import { initTheme, stopThemeWatcher } from "../modes/interactive/theme/theme.js";

export interface ConfigSelectorOptions {
	resolvedPaths: ResolvedPaths;
	settingsManager: SettingsManager;
	cwd: string;
	agentDir: string;
}

/** Show TUI config selector and return when closed */
export async function selectConfig(options: ConfigSelectorOptions): Promise<void> {
	// Initialize theme before showing TUI
	initTheme(options.settingsManager.getTheme(), true);

	return new Promise((resolve) => {
		const ui = new TUI(new ProcessTerminal());
		let resolved = false;

		const selector = new ConfigSelectorComponent(
			options.resolvedPaths,
			options.settingsManager,
			options.cwd,
			options.agentDir,
			() => {
				if (!resolved) {
					resolved = true;
					ui.stop();
					stopThemeWatcher();
					resolve();
				}
			},
			() => {
				ui.stop();
				stopThemeWatcher();
				process.exit(0);
			},
			() => ui.requestRender(),
		);

		ui.addChild(selector);
		ui.setFocus(selector.getResourceList());
		ui.start();
	});
}
