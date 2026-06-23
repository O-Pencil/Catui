/**
 * [WHO]: Provides SelfUpdateController, SelfUpdateContext — version check / update / reinstall / restart
 * [FROM]: Depends on @catui/tui (Container/Text/Spacer), config (VERSION/PACKAGE_NAME),
 *         theme, components/dynamic-border, node:child_process (spawn)
 * [TO]: Consumed by modes/interactive/interactive-mode.ts (constructs one, delegates /update, /reinstall, startup check)
 * [HERE]: modes/interactive/controllers/self-update-controller.ts — P5 UI slice (UI02, 纯搬)
 *
 * Extracted from InteractiveMode (P5 self-update). Owns the npm-based update/reinstall workflow
 * and the startup version check — an ops flow that happens to use the TUI for prompts. Reads chat
 * container / render / settings / selector through a narrow SelfUpdateContext (no InteractiveMode
 * reference). Behavior is identical to the former InteractiveMode methods. P5 keeps it inside
 * modes/interactive; only a second mode consumer would justify moving it to modes/_shell/update.
 */

import { spawn } from "node:child_process";
import { type Container, Spacer, Text } from "@catui/tui";
import { PACKAGE_NAME, VERSION } from "../../../config.js";
import { DynamicBorder } from "../components/dynamic-border.js";
import { theme } from "../theme/theme.js";

function spawnNpm(args: string[]) {
  if (process.platform === "win32") {
    // On Windows, use shell mode with a single string to avoid DEP0190 warning.
    // We quote arguments that contain spaces.
    const fullCommand = ["npm", ...args]
      .map((arg) => (arg.includes(" ") ? `"${arg}"` : arg))
      .join(" ");

    return spawn(fullCommand, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
      shell: true,
    });
  }

  return spawn("npm", args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
}

/** Narrow capability seam: the chat/render/settings/selector capabilities the updater needs. */
export interface SelfUpdateContext {
  /** The chat container the updater renders progress/results into. */
  getChatContainer(): Container;
  /** Request a TUI re-render. */
  requestRender(): void;
  getAutoUpdate(): "always" | "prompt" | "never";
  getSkippedVersion(): string | undefined;
  setSkippedVersion(version: string | undefined): void;
  setAutoUpdate(mode: "always" | "prompt" | "never"): void;
  /** Present a selector overlay (delegates to the extension-selector UI). */
  showSelector(title: string, options: string[]): Promise<string | undefined>;
}

/** Background auto-update polling interval: 30 minutes (CC-aligned). */
const AUTO_UPDATE_INTERVAL_MS = 30 * 60 * 1000;

export class SelfUpdateController {
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly ctx: SelfUpdateContext) {}

  private get chat(): Container {
    return this.ctx.getChatContainer();
  }

  private render(): void {
    this.ctx.requestRender();
  }

  // ----- public surface (called by mount) -----

  async checkForNewVersion(): Promise<string | undefined> {
    if (process.env.CATUI_SKIP_VERSION_CHECK || process.env.CATUI_OFFLINE)
      return undefined;

    try {
      const response = await fetch(
        `https://registry.npmjs.org/${encodeURIComponent(PACKAGE_NAME)}`,
        {
          signal: AbortSignal.timeout(10000),
        },
      );
      if (!response.ok) return undefined;

      const data = (await response.json()) as {
        "dist-tags"?: { latest?: string };
        version?: string;
      };
      const latestVersion = data["dist-tags"]?.latest ?? data.version;

      // Only return latestVersion if it's actually newer than current version
      if (latestVersion && this.compareVersion(latestVersion, VERSION) > 0) {
        return latestVersion;
      }

      return undefined;
    } catch {
      return undefined;
    }
  }

  async showNewVersionNotification(newVersion: string): Promise<void> {
    this.chat.addChild(new Spacer(1));
    this.chat.addChild(
      new DynamicBorder((text) => theme.fg("warning", text)),
    );
    this.chat.addChild(
      new Text(
        `${theme.bold(theme.fg("warning", "Update Available"))}\n` +
          theme.fg("muted", `New version ${newVersion} is available. Updating automatically...`),
        1,
        0,
      ),
    );
    this.chat.addChild(
      new DynamicBorder((text) => theme.fg("warning", text)),
    );
    this.render();

    await this.performUpdate(newVersion);
  }

  async handleUpdateCommand(): Promise<void> {
    this.chat.addChild(new Spacer(1));
    this.chat.addChild(
      new Text(theme.fg("accent", "↝ Checking for updates..."), 1, 0),
    );
    this.render();

    try {
      const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(PACKAGE_NAME)}`, {
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        throw new Error(`Failed to check for updates: ${response.status}`);
      }

      const data = (await response.json()) as {
        "dist-tags": { latest?: string };
        homepage?: string;
      };

      const latestVersion = data["dist-tags"]?.latest ?? "unknown";
      const currentVersion = VERSION;
      const versionComparison = latestVersion !== "unknown" ? this.compareVersion(latestVersion, currentVersion) : 0;

      const lines: string[] = [];
      lines.push(theme.fg("accent", "↝ Catui Update Checker"));
      lines.push("");
      lines.push(`Current version: ${theme.fg("dim", currentVersion)}`);
      lines.push(
        `Latest version:  ${theme.fg(
          versionComparison > 0 ? "success" : "dim",
          latestVersion,
        )}`,
      );
      lines.push("");

      if (latestVersion !== "unknown" && versionComparison > 0) {
        lines.push(theme.fg("success", `✦ New version ${latestVersion} available!`));
        lines.push("");

        this.chat.addChild(new Spacer(1));
        this.chat.addChild(new Text(lines.join("\n"), 1, 0));
        this.render();

        // Show interactive update options
        await this.showUpdateOptions(latestVersion);
        return;
      } else if (latestVersion !== "unknown" && versionComparison < 0) {
        lines.push(theme.fg("success", "✦ You're ahead!"));
        lines.push("");
        lines.push(
          theme.fg(
            "dim",
            "You're running a pre-release or newer version than published on npm.",
          ),
        );
      } else {
        lines.push(theme.fg("success", "✦ Up to date!"));
        lines.push("");
        lines.push(
          theme.fg("dim", "You're running the latest version of Catui."),
        );
      }

      this.chat.addChild(new Spacer(1));
      this.chat.addChild(new Text(lines.join("\n"), 1, 0));
    } catch (error) {
      this.chat.addChild(new Spacer(1));
      this.chat.addChild(
        new Text(
          theme.fg(
            "warning",
            `✕ Update failed: ${error instanceof Error ? error.message : "Unknown error"}`,
          ),
          1,
          0,
        ),
      );
      this.chat.addChild(
        new Text(
          theme.fg(
            "dim",
            `Visit https://www.npmjs.com/package/${PACKAGE_NAME} to check manually`,
          ),
          1,
          0,
        ),
      );
    }

    this.render();
  }

  /**
   * Handle /reinstall command - force clean reinstall.
   */
  handleReinstallCommand(): void {
    this.chat.addChild(new Spacer(1));
    this.chat.addChild(
      new Text(theme.fg("accent", "↝ Force Reinstalling Catui..."), 1, 0),
    );
    this.chat.addChild(
      new Text(
        theme.fg("dim", "This will uninstall and reinstall with cache cleared."),
        1,
        0,
      ),
    );
    this.render();

    // Step 1: Uninstall
    const uninstall = spawnNpm(["uninstall", "-g", PACKAGE_NAME]);

    uninstall.on("close", (code) => {
      if (code !== 0) {
        this.chat.addChild(
          new Text(theme.fg("warning", `✕ Uninstall failed (exit code ${code}), continuing anyway...`), 1, 0),
        );
        this.render();
      }

      // Step 2: Clear cache
      this.chat.addChild(
        new Text(theme.fg("dim", "↝ Clearing npm cache..."), 1, 0),
      );
      this.render();

      const cacheClean = spawnNpm(["cache", "clean", "--force"]);

      cacheClean.on("close", () => {
        // Step 3: Reinstall
        this.chat.addChild(
          new Text(theme.fg("dim", "↝ Installing latest version..."), 1, 0),
        );
        this.render();

        const install = spawnNpm(["install", "-g", "--force", `${PACKAGE_NAME}@latest`]);

        install.on("close", (installCode) => {
          if (installCode === 0) {
            this.chat.addChild(
              new Text(theme.fg("success", "◈ Catui reinstalled successfully!"), 1, 0),
            );
            this.chat.addChild(
              new Text(theme.fg("accent", "Press 'R' to restart Catui"), 1, 0),
            );
            this.render();

            // Wait for R to restart
            const waitForRestart = async () => {
              const key = await this.waitForKeyPress(["r", "R", "q", "Q", "\x03"] as const);
              if (key === "r" || key === "R") {
                this.restartCatui();
              } else {
                process.exit(0);
              }
            };
            waitForRestart();
          } else {
            this.chat.addChild(
              new Text(theme.fg("warning", `✕ Reinstall failed (exit code ${installCode})`), 1, 0),
            );
            this.chat.addChild(
              new Text(
                theme.fg("dim", `Try running manually: npm uninstall -g ${PACKAGE_NAME} && npm install -g ${PACKAGE_NAME}`),
                1,
                0,
              ),
            );
            this.render();
          }
        });

        install.on("error", (err) => {
          this.chat.addChild(
            new Text(theme.fg("warning", `✕ Install failed: ${err.message}`), 1, 0),
          );
          this.render();
        });
      });
    });

    uninstall.on("error", (err) => {
      this.chat.addChild(
        new Text(theme.fg("warning", `✕ Uninstall failed: ${err.message}`), 1, 0),
      );
      this.render();
    });
  }

  /**
   * Check for updates on startup.
   * - "always": silently install in background, notify user when done.
   * - "prompt": show selector dialog asking user what to do.
   * - "never": no-op.
   */
  async checkAutoUpdateOnStartup(): Promise<void> {
    const autoUpdate = this.ctx.getAutoUpdate();
    if (autoUpdate === "never") return;

    try {
      const latestVersion = await this.fetchLatestVersion();
      if (!latestVersion) return;

      const skippedVersion = this.ctx.getSkippedVersion();
      if (skippedVersion === latestVersion) return;

      if (this.compareVersion(latestVersion, VERSION) <= 0) return;

      if (autoUpdate === "always") {
        // Silent background install — no prompt, no interaction
        await this.silentInstall(latestVersion);
        return;
      }

      // "prompt" mode: show selector dialog
      const title = `${theme.fg("accent", "↝ Update Available")}\n\n${theme.fg("dim", `Current: ${VERSION}`)}\n${theme.fg("success", `Latest:  ${latestVersion}`)}\n\n${theme.fg("dim", "A new version is available. Would you like to update now?")}`;

      const choice = await this.ctx.showSelector(title, [
        "1. Update now and restart",
        "2. Skip this version",
        "3. Continue without updating",
      ]);

      if (!choice) return;

      if (choice.includes("Update now")) {
        await this.performUpdate(latestVersion);
      } else if (choice.includes("Skip")) {
        this.ctx.setSkippedVersion(latestVersion);
        this.chat.addChild(new Spacer(1));
        this.chat.addChild(
          new Text(theme.fg("dim", `» Skipped version ${latestVersion}. You won't be prompted again.`), 1, 0),
        );
        this.render();
      }
    } catch {
      // Silently fail — don't block user
    }
  }

  /**
   * Start background polling for updates (every 30 minutes).
   * Only active when autoUpdate is "always".
   */
  startBackgroundPolling(): void {
    if (this.ctx.getAutoUpdate() !== "always") return;
    if (this.pollTimer) return; // already running

    this.pollTimer = setInterval(async () => {
      try {
        const latestVersion = await this.fetchLatestVersion();
        if (!latestVersion) return;

        const skippedVersion = this.ctx.getSkippedVersion();
        if (skippedVersion === latestVersion) return;

        if (this.compareVersion(latestVersion, VERSION) <= 0) return;

        await this.silentInstall(latestVersion);
      } catch {
        // Silently fail — don't disturb user
      }
    }, AUTO_UPDATE_INTERVAL_MS);
  }

  /**
   * Stop background polling (called on shutdown).
   */
  stopBackgroundPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Fetch the latest version from npm registry.
   * Returns the version string or undefined if check fails.
   */
  private async fetchLatestVersion(): Promise<string | undefined> {
    if (process.env.CATUI_SKIP_VERSION_CHECK || process.env.CATUI_OFFLINE)
      return undefined;

    const response = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(PACKAGE_NAME)}`,
      { signal: AbortSignal.timeout(10000) },
    );
    if (!response.ok) return undefined;

    const data = (await response.json()) as {
      "dist-tags"?: { latest?: string };
      version?: string;
    };
    return data["dist-tags"]?.latest ?? data.version ?? undefined;
  }

  /**
   * Silently install update in background. On success, show a persistent
   * notification banner. No interactive prompts — user discovers it passively.
   */
  private async silentInstall(latestVersion: string): Promise<void> {
    return new Promise((resolve) => {
      const child = spawnNpm(["install", "-g", "--force", `${PACKAGE_NAME}@latest`]);

      child.on("close", (code) => {
        if (code === 0) {
          this.chat.addChild(new Spacer(1));
          this.chat.addChild(
            new DynamicBorder((text) => theme.fg("success", text)),
          );
          this.chat.addChild(
            new Text(
              `${theme.bold(theme.fg("success", "Update Installed"))}\n` +
                theme.fg("muted", `Catui has been updated to v${latestVersion}. Restart to apply.`),
              1,
              0,
            ),
          );
          this.chat.addChild(
            new DynamicBorder((text) => theme.fg("success", text)),
          );
          this.render();
        }
        resolve();
      });

      child.on("error", () => {
        // Silent failure — don't disturb user
        resolve();
      });
    });
  }

  // ----- private -----

  /**
   * Show interactive update options when a new version is available.
   */
  private async showUpdateOptions(latestVersion: string): Promise<void> {
    const autoUpdate = this.ctx.getAutoUpdate();
    const skippedVersion = this.ctx.getSkippedVersion();

    // If user has already skipped this version, offer options to clear it
    if (skippedVersion === latestVersion) {
      const title = `${theme.fg("accent", "Update Skipped")}\n\n${theme.fg("dim", `You previously chose to skip version ${latestVersion}.`)}\n${theme.fg("dim", `Current: ${VERSION}`)}\n${theme.fg("success", `Latest:  ${latestVersion}`)}\n\n${theme.fg("dim", "What would you like to do?")}`;

      const skipOptions = [
        "1. Update now",
        "2. Clear skip and enable auto-update",
        "3. Continue without updating",
      ];

      const skipChoice = await this.ctx.showSelector(title, skipOptions);

      if (!skipChoice) {
        this.chat.addChild(
          new Text(theme.fg("dim", "Returning to chat..."), 1, 0),
        );
        this.render();
        return;
      }

      if (skipChoice.includes("Update now")) {
        await this.performUpdate(latestVersion);
        return;
      } else if (skipChoice.includes("Clear skip")) {
        this.ctx.setSkippedVersion(undefined);
        this.ctx.setAutoUpdate("always");
        this.chat.addChild(new Spacer(1));
        this.chat.addChild(
          new Text(
            theme.fg("success", "◈ Skip cleared! Auto-update enabled. Catui will check for updates on startup."),
            1,
            0,
          ),
        );
        this.render();
        // Proceed with update
        await this.performUpdate(latestVersion);
        return;
      }
      // Continue without updating
      this.chat.addChild(
        new Text(theme.fg("dim", "Continuing without update..."), 1, 0),
      );
      this.render();
      return;
    }

    // Build title with version info
    const title = `${theme.fg("accent", "Update Available")}\n\n${theme.fg("dim", `Current: ${VERSION}`)}\n${theme.fg("success", `Latest:  ${latestVersion}`)}`;

    // Build options list with consistent numbering
    const options: string[] = [];
    options.push("1. Update now and restart");
    options.push("2. Exit and I'll update manually");
    options.push("3. Skip this version");

    // Add auto-update toggle option
    if (autoUpdate !== "always") {
      options.push("4. Enable auto-update");
    } else {
      options.push("4. Disable auto-update");
    }

    // Add status subtitle
    const subtitle = autoUpdate === "always"
      ? `\n\n${theme.fg("success", "● Auto-update is enabled")}`
      : `\n\n${theme.fg("dim", "○ Auto-update is disabled")}`;

    const choice = await this.ctx.showSelector(title + subtitle, options);

    if (!choice) {
      // User cancelled, return to chat
      this.chat.addChild(
        new Text(theme.fg("dim", "Returning to chat..."), 1, 0),
      );
      this.render();
      return;
    }

    if (choice.includes("Update now")) {
      await this.performUpdate(latestVersion);
    } else if (choice.includes("Exit")) {
      this.chat.addChild(new Spacer(1));
      this.chat.addChild(
        new Text(
          theme.fg("accent", "↝ Exiting. Run this command to update:"),
          1,
          0,
        ),
      );
      this.chat.addChild(
        new Text(
          theme.fg("dim", `  npm install -g ${PACKAGE_NAME}@latest`),
          1,
          0,
        ),
      );
      this.render();
      await new Promise((resolve) => setTimeout(resolve, 2000));
      process.exit(0);
    } else if (choice.includes("Skip")) {
      this.ctx.setSkippedVersion(latestVersion);
      this.chat.addChild(new Spacer(1));
      this.chat.addChild(
        new Text(
          theme.fg("dim", `» Skipped version ${latestVersion}. You won't be prompted for this version again.`),
          1,
          0,
        ),
      );
      this.chat.addChild(
        new Text(
          theme.fg("dim", "   You can clear this skip later from settings."),
          1,
          0,
        ),
      );
      this.render();
    } else if (choice.includes("Enable auto-update")) {
      this.ctx.setAutoUpdate("always");
      this.chat.addChild(new Spacer(1));
      this.chat.addChild(
        new Text(
          theme.fg("success", "◈ Auto-update enabled! Catui will check for updates on startup."),
          1,
          0,
        ),
      );
      this.render();
      // Proceed with update after enabling auto-update
      await this.performUpdate(latestVersion);
    } else if (choice.includes("Disable auto-update")) {
      this.ctx.setAutoUpdate("prompt");
      this.chat.addChild(new Spacer(1));
      this.chat.addChild(
        new Text(
          theme.fg("dim", "◈ Auto-update disabled. You'll be prompted when updates are available."),
          1,
          0,
        ),
      );
      this.render();
    }
  }

  /**
   * Perform the actual npm install update.
   */
  private async performUpdate(latestVersion: string, retryCount = 0): Promise<void> {
    this.chat.addChild(new Spacer(1));
    this.chat.addChild(
      new Text(theme.fg("accent", "↝ Updating Catui..."), 1, 0),
    );
    this.render();

    return new Promise((resolve) => {
      const child = spawnNpm(["install", "-g", "--force", `${PACKAGE_NAME}@latest`]);

      let errorOutput = "";

      child.stderr?.on("data", (data: Buffer) => {
        errorOutput += data.toString();
      });

      child.on("close", async (code) => {
        if (code === 0) {
          this.chat.addChild(
            new Text(
              theme.fg("success", `◈ Successfully updated to version ${latestVersion}!`),
              1,
              0,
            ),
          );
          this.chat.addChild(new Spacer(1));
          this.chat.addChild(
            new Text(
              theme.fg("accent", "Press 'R' to restart or Ctrl+C to exit manually"),
              1,
              0,
            ),
          );

          this.render();

          // Wait for user to press R to restart
          const waitForRestart = async () => {
            const key = await this.waitForKeyPress(["r", "R", "q", "Q", "\x03"] as const);
            if (key === "r" || key === "R") {
              this.chat.addChild(
                new Text(
                  theme.fg("dim", "↝ Restarting Catui..."),
                  1,
                  0,
                ),
              );
              this.render();
              // Use the improved restart method
              this.restartCatui();
            } else {
              process.exit(0);
            }
          };

          waitForRestart().then(() => resolve());
        } else {
          this.chat.addChild(
            new Text(
              theme.fg("warning", `✕ Update failed (exit code ${code})`),
              1,
              0,
            ),
          );
          this.chat.addChild(
            new Text(
              theme.fg("dim", "This may be a network issue or permissions problem."),
              1,
              0,
            ),
          );
          this.render();
          resolve();

          // Offer retry option
          this.showRetryOptions(latestVersion, retryCount);
        }
      });

      child.on("error", async (err) => {
        this.chat.addChild(
          new Text(
            theme.fg("warning", `✕ Failed to run npm: ${err.message}`),
            1,
            0,
          ),
        );
        this.chat.addChild(
          new Text(
            theme.fg("dim", "Make sure npm is installed and in your PATH."),
            1,
            0,
          ),
        );
        this.render();
        resolve();

        // Offer retry option
        this.showRetryOptions(latestVersion, retryCount);
      });
    });
  }

  /**
   * Show retry options after a failed update attempt.
   */
  private async showRetryOptions(latestVersion: string, retryCount: number): Promise<void> {
    await new Promise((r) => setTimeout(r, 500));

    const options: string[] = ["1. Try again", "2. Exit and update manually"];
    const choice = await this.ctx.showSelector(
      `${theme.fg("accent", "Update Failed")}\n\n${theme.fg("dim", "What would you like to do?")}`,
      options,
    );

    if (choice?.includes("Try again")) {
      if (retryCount < 3) {
        await this.performUpdate(latestVersion, retryCount + 1);
      } else {
        this.chat.addChild(
          new Text(
            theme.fg("dim", "Multiple retry attempts failed. Please try updating manually."),
            1,
            0,
          ),
        );
        this.chat.addChild(
          new Text(
            theme.fg("dim", `  npm install -g ${PACKAGE_NAME}@latest`),
            1,
            0,
          ),
        );
        this.render();
      }
    } else {
      this.chat.addChild(new Spacer(1));
      this.chat.addChild(
        new Text(
          theme.fg("accent", "↝ Exiting. Run this command to update:"),
          1,
          0,
        ),
      );
      this.chat.addChild(
        new Text(
          theme.fg("dim", `  npm install -g ${PACKAGE_NAME}@latest`),
          1,
          0,
        ),
      );
      this.render();
      await new Promise((resolve) => setTimeout(resolve, 2000));
      process.exit(0);
    }
  }

  /**
   * Wait for a specific key press from user.
   * Falls back to selector UI if TTY is not available.
   */
  private async waitForKeyPress<T extends readonly string[]>(keys: T): Promise<T[number] | "\x03" | null> {
    // Check if we're in a TTY environment
    if (!process.stdin.isTTY) {
      // Fall back to selector UI
      const options = keys
        .filter((k) => k !== "\x03")
        .map((k) => `Press '${k}'`);
      options.push("Cancel");

      const choice = await this.ctx.showSelector(
        theme.fg("accent", "Restart Options"),
        options,
      );

      if (!choice || choice.includes("Cancel")) {
        return "\x03";
      }

      const selectedKey = keys.find((k) => choice.includes(k));
      return (selectedKey as T[number]) ?? "\x03";
    }

    return new Promise((resolve) => {
      const stdin = process.stdin;
      const originalRawMode = stdin.isRaw;

      const cleanup = () => {
        try {
          if (stdin.isTTY) {
            stdin.setRawMode(originalRawMode);
          }
        } catch {
          // Ignore errors when restoring raw mode
        }
        stdin.pause();
        stdin.removeListener("data", onData);
      };

      const onData = (data: Buffer) => {
        const key = data.toString();
        // Check for Ctrl+C or matching keys
        if (key === "\x03" || keys.includes(key as T[number])) {
          cleanup();
          resolve(key === "\x03" ? "\x03" : (key as T[number]));
        }
      };

      try {
        stdin.setRawMode(true);
        stdin.resume();
        stdin.on("data", onData);
      } catch (err) {
        cleanup();
        resolve(null);
      }
    });
  }

  /**
   * Restart Catui by spawning a new process.
   * Tries to detect the correct command to restart.
   */
  private restartCatui(): void {
    // Try to detect how Catui was launched
    const execArgv = process.argv;
    const cmd = execArgv[0]; // e.g., /usr/local/bin/catui or node
    const args = execArgv.slice(1);

    // Check if running as global CLI (catui/catui) or via node (node dist/cli.js)
    const isGlobalCli = cmd.includes("catui") || cmd.includes("catui");

    if (isGlobalCli) {
      // Running as global CLI command
      spawn(cmd, args, {
        detached: true,
        stdio: "ignore",
      }).unref();
    } else {
      // Running via node (development or bundled)
      spawn(process.execPath, execArgv.slice(1), {
        detached: true,
        stdio: "ignore",
      }).unref();
    }

    process.exit(0);
  }

  /**
   * Compare two version strings (semver style).
   * Returns: 1 if v1 > v2, -1 if v1 < v2, 0 if equal
   */
  private compareVersion(v1: string, v2: string): number {
    const parts1 = v1.split(".").map(Number);
    const parts2 = v2.split(".").map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] ?? 0;
      const p2 = parts2[i] ?? 0;
      if (p1 > p2) return 1;
      if (p1 < p2) return -1;
    }
    return 0;
  }
}
