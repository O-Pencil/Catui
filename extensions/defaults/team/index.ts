/**
 * [WHO]: AgentTeam extension, registers /team commands for persistent teammates, harness status, psyche status, dashboard widget
 * [FROM]: Depends on @pencil-agent/tui, core/extensions/types, ./team-runtime, ./team-parser, ./team-types, ./team-harness, ./team-presets, ./team-dashboard
 * [TO]: Consumed by builtin-extensions.ts as default extension
 * [HERE]: extensions/defaults/team/index.ts - AgentTeam extension entry point
 *
 * Commands:
 *   /team                      - List teammates
 *   /team <task>               - Auto-select team size/roles and start the task
 *   /team:spawn <role> [--name <id>] [--harness] - Create teammate
 *   /team:preset <solo|duo|squad> <task> - Create preset team
 *   /team:send <name> <message>      - Send message to teammate
 *   /team:status [<name>]            - Show status
 *   /team:progress [<name>]          - Show harness progress
 *   /team:psyche [<name>]            - Show psyche weights
 *   /team:dashboard                  - Toggle dashboard widget
 *   /team:task <add|claim|done|block|cancel|list> ... - Manage shared task list
 *   /team:mail <from> <to> <message> - Route teammate-to-teammate mailbox messages
 *   /team:allow-path <name> <path>   - Grant teammate write access to a path prefix
 *   /team:stop <name>                - Stop teammate turn
 *   /team:terminate <name>           - Destroy teammate
 *   /team:approve <request-id>       - Approve permission request
 *   /team:mode <name> <plan|execute|review> - Switch mode
 */

import { Box, Container, Spacer, Text } from "@pencil-agent/tui";
import type { ExtensionAPI } from "../../../core/extensions/types.js";
import { TeamRuntime, type TeamRuntimeEvent } from "./team-runtime.js";
import { buildTeamHelp, parseTeamCommand } from "./team-parser.js";
import type { PersistedTeammate, TeamTask } from "./team-types.js";
import { executeAutoTeam, executePreset, formatAutoTeamResult, formatPresetResult } from "./team-presets.js";
import { formatHarnessProgress } from "./team-harness.js";
import { formatPsycheWeights } from "./team-psyche.js";
import { renderTeamDashboard, renderTeamFooterStatus } from "./team-dashboard.js";

const TEAM_MESSAGE_TYPE = "team";

// Global runtime instance
let runtime: TeamRuntime | null = null;
let dashboardVisible = false;
let dashboardAutoHideTimer: ReturnType<typeof setTimeout> | undefined;

function getRuntime(): TeamRuntime {
	if (!runtime) {
		runtime = new TeamRuntime();
	}
	return runtime;
}

export default async function teamExtension(api: ExtensionAPI): Promise<void> {
	const teamRuntime = getRuntime();
	await teamRuntime.load();

	api.on("session_shutdown", async () => {
		if (dashboardAutoHideTimer) {
			clearTimeout(dashboardAutoHideTimer);
			dashboardAutoHideTimer = undefined;
		}
		await teamRuntime.dispose();
	});

	api.on("session_ready", (_event, ctx) => {
		teamRuntime.setSoulManager(ctx.getSoulManager());
		updateTeamUi(ctx, teamRuntime);
	});

	// Register message renderer
	api.registerMessageRenderer(TEAM_MESSAGE_TYPE, (message, _options, theme) => {
		const text =
			typeof message.content === "string"
				? message.content
				: message.content
						.filter((part): part is { type: "text"; text: string } => part.type === "text")
						.map((part) => part.text)
						.join("\n");

		const box = new Box(1, 1, (value) => theme.bg("customMessageBg", value));
		box.addChild(new Text(theme.fg("customMessageText", text), 0, 0));

		const container = new Container();
		container.addChild(new Spacer(1));
		container.addChild(box);
		return container;
	});

	// Register commands
	const commandNames = [
		"team",
		"team:spawn",
		"team:send",
		"team:status",
		"team:stop",
		"team:terminate",
		"team:approve",
		"team:mode",
		"team:preset",
		"team:dashboard",
		"team:progress",
		"team:psyche",
		"team:task",
		"team:mail",
		"team:allow-path",
	] as const;

	for (const commandName of commandNames) {
		api.registerCommand(commandName, {
			description: getCommandDescription(commandName),
			handler: async (args: string, ctx) => {
				const parsed = parseTeamCommand(commandName, args);

				if (!parsed) {
					ctx.ui.notify(`Invalid /team command. Use /team for usage.`, "error");
					return;
				}

				switch (parsed.command) {
					case "help": {
						api.sendMessage({
							customType: TEAM_MESSAGE_TYPE,
							content: buildTeamHelp(),
							display: true,
						});
						break;
					}

					case "list": {
						const teammates = teamRuntime.getAllTeammates();
						const lines = formatTeammateList(teammates);
						api.sendMessage({
							customType: TEAM_MESSAGE_TYPE,
							content: lines.join("\n"),
							display: true,
						});
						break;
					}

					case "auto": {
						if (!parsed.taskDescription) {
							ctx.ui.notify("Usage: /team <task>", "error");
							return;
						}

						setTeamActivity(ctx, [
							"Team: selecting agents for task...",
							`Task: ${truncateForStatus(parsed.taskDescription)}`,
						]);
						api.sendMessage({
							customType: TEAM_MESSAGE_TYPE,
							content: `Selecting team for task...`,
							display: true,
						});

						try {
							const observer = createTeamObserver(api, ctx, teamRuntime);
							const result = await executeAutoTeam(
								teamRuntime,
								parsed.taskDescription,
								ctx.cwd,
								ctx.model,
								observer.onEvent,
								ctx.completeSimple,
							);
							observer.flush();
							api.sendMessage({
								customType: TEAM_MESSAGE_TYPE,
								content: formatAutoTeamResult(result).join("\n"),
								display: true,
							});
							updateTeamUi(ctx, teamRuntime);
						} catch (error: unknown) {
							const message = error instanceof Error ? error.message : String(error);
							ctx.ui.notify(`Failed to auto-select team: ${message}`, "error");
							api.sendMessage({
								customType: TEAM_MESSAGE_TYPE,
								content: `Failed to auto-select team: ${message}`,
								display: true,
							});
							updateTeamUi(ctx, teamRuntime);
						} finally {
							ctx.ui.setWorkingMessage();
						}
						break;
					}

					case "spawn": {
						if (!parsed.role) {
							ctx.ui.notify("Usage: /team:spawn <role> [--name <name>]", "error");
							return;
						}

						api.sendMessage({
							customType: TEAM_MESSAGE_TYPE,
							content: `Spawning ${parsed.role} teammate${parsed.name ? ` named "${parsed.name}"` : ""}...`,
							display: true,
						});
						ctx.ui.setWorkingMessage(`Team: spawning ${parsed.role} teammate...`);

						try {
							const teammate = await teamRuntime.spawn({
								role: parsed.role,
								name: parsed.name,
								baseCwd: ctx.cwd,
								harnessEnabled: parsed.harnessEnabled,
							});

							const lines = [
								`Teammate spawned successfully:`,
								`  Name: ${teammate.identity.name}`,
								`  Role: ${teammate.identity.role}`,
								`  Mode: ${teammate.mode}`,
								`  Status: ${teammate.status}`,
								...(teammate.harness?.enabled ? [`  Harness: ${teammate.harness.phase}`] : []),
								...(teammate.worktreePath ? [`  Worktree: ${teammate.worktreePath}`] : []),
							];

							api.sendMessage({
								customType: TEAM_MESSAGE_TYPE,
								content: lines.join("\n"),
								display: true,
							});
							updateTeamUi(ctx, teamRuntime);
						} catch (error: unknown) {
							const message = error instanceof Error ? error.message : String(error);
							ctx.ui.notify(`Failed to spawn teammate: ${message}`, "error");
							api.sendMessage({
								customType: TEAM_MESSAGE_TYPE,
								content: `Failed to spawn teammate: ${message}`,
								display: true,
							});
						} finally {
							ctx.ui.setWorkingMessage();
						}
						break;
					}

					case "send": {
						if (!parsed.target || !parsed.message) {
							ctx.ui.notify("Usage: /team:send <name> <message>", "error");
							return;
						}

						const model = ctx.model;

						api.sendMessage({
							customType: TEAM_MESSAGE_TYPE,
							content: `Sending message to ${parsed.target}...`,
							display: true,
						});
						setTeamActivity(ctx, [`Team: sending task to ${parsed.target}...`]);

						try {
							const observer = createTeamObserver(api, ctx, teamRuntime);
							const result = await teamRuntime.send(parsed.target, parsed.message, model, {
								onEvent: observer.onEvent,
							});
							observer.flush();
							updateTeamUi(ctx, teamRuntime);

							if (result.success) {
								const lines = [
									`Response from ${result.teammateName} (${Math.round(result.durationMs / 1000)}s):`,
									"",
									result.response,
								];
								api.sendMessage({
									customType: TEAM_MESSAGE_TYPE,
									content: lines.join("\n"),
									display: true,
								});
							} else {
								ctx.ui.notify(
									`Teammate ${result.teammateName} failed: ${result.error ?? "Unknown error"}`,
									"error",
								);
								api.sendMessage({
									customType: TEAM_MESSAGE_TYPE,
									content: `Teammate ${result.teammateName} failed: ${result.error ?? "Unknown error"}`,
									display: true,
								});
							}
						} catch (error: unknown) {
							const message = error instanceof Error ? error.message : String(error);
							ctx.ui.notify(`Failed to send message: ${message}`, "error");
							api.sendMessage({
								customType: TEAM_MESSAGE_TYPE,
								content: `Failed to send message: ${message}`,
								display: true,
							});
							updateTeamUi(ctx, teamRuntime);
						} finally {
							ctx.ui.setWorkingMessage();
						}
						break;
					}

					case "status": {
						if (parsed.target) {
							const teammate = teamRuntime.getTeammate(parsed.target);
							if (!teammate) {
								ctx.ui.notify(`Teammate "${parsed.target}" not found`, "error");
								return;
							}
							const lines = formatTeammateStatus(teammate);
							api.sendMessage({
								customType: TEAM_MESSAGE_TYPE,
								content: lines.join("\n"),
								display: true,
							});
						} else {
							const teammates = teamRuntime.getAllTeammates();
							const lines = formatTeammateList(teammates);
							api.sendMessage({
								customType: TEAM_MESSAGE_TYPE,
								content: lines.join("\n"),
								display: true,
							});
						}
						break;
					}

					case "stop": {
						if (!parsed.target) {
							ctx.ui.notify("Usage: /team:stop <name>", "error");
							return;
						}

						const success = await teamRuntime.stop(parsed.target);
						updateTeamUi(ctx, teamRuntime);
						if (success) {
							api.sendMessage({
								customType: TEAM_MESSAGE_TYPE,
								content: `Stopped ${parsed.target}'s current turn.`,
								display: true,
							});
						} else {
							ctx.ui.notify(`Teammate "${parsed.target}" not found`, "error");
						}
						break;
					}

					case "terminate": {
						if (!parsed.target) {
							ctx.ui.notify("Usage: /team:terminate <name>", "error");
							return;
						}

						const success = await teamRuntime.terminate(parsed.target);
						updateTeamUi(ctx, teamRuntime);
						if (success) {
							api.sendMessage({
								customType: TEAM_MESSAGE_TYPE,
								content: `Terminated teammate "${parsed.target}".`,
								display: true,
							});
						} else {
							ctx.ui.notify(`Teammate "${parsed.target}" not found`, "error");
						}
						break;
					}

					case "mode": {
						if (!parsed.target || !parsed.mode) {
							ctx.ui.notify("Usage: /team:mode <name> <plan|execute|review>", "error");
							return;
						}

						const result = await teamRuntime.setMode(parsed.target, parsed.mode);
						updateTeamUi(ctx, teamRuntime);
						if (!result.ok) {
							ctx.ui.notify(`Teammate "${parsed.target}" not found`, "error");
							break;
						}
						if (result.pending) {
							api.sendMessage({
								customType: TEAM_MESSAGE_TYPE,
								content:
									`Mode change for ${parsed.target} → ${parsed.mode} requires approval.\n` +
									`Approve with: /team:approve ${result.pending.requestId}`,
								display: true,
							});
						} else {
							api.sendMessage({
								customType: TEAM_MESSAGE_TYPE,
								content: `Changed ${parsed.target}'s mode to "${parsed.mode}".`,
								display: true,
							});
						}
						break;
					}

					case "approve": {
						if (!parsed.requestId) {
							// No id → list pending requests for convenience.
							const pending = teamRuntime.getPermissionStore().listPending();
							if (pending.length === 0) {
								api.sendMessage({
									customType: TEAM_MESSAGE_TYPE,
									content: "No pending permission requests.",
									display: true,
								});
							} else {
								const lines = ["Pending permission requests:", ""];
								for (const req of pending) {
									lines.push(`  ${req.id}`);
									lines.push(`    teammate: ${req.teammateName}`);
									lines.push(`    action:   ${req.action}`);
									lines.push(`    detail:   ${req.detail}`);
								}
								lines.push("", "Approve with: /team:approve <id>");
								api.sendMessage({
									customType: TEAM_MESSAGE_TYPE,
									content: lines.join("\n"),
									display: true,
								});
							}
							break;
						}

						const ok = teamRuntime.approvePermission(parsed.requestId);
						if (ok) {
							api.sendMessage({
								customType: TEAM_MESSAGE_TYPE,
								content: `Approved request ${parsed.requestId}.`,
								display: true,
							});
						} else {
							ctx.ui.notify(
								`Permission request "${parsed.requestId}" not found or already resolved.`,
								"error",
							);
						}
						break;
					}

					case "preset": {
						if (!parsed.presetName || !parsed.taskDescription) {
							ctx.ui.notify("Usage: /team:preset <solo|duo|squad> <task>", "error");
							return;
						}

						api.sendMessage({
							customType: TEAM_MESSAGE_TYPE,
							content: `Creating "${parsed.presetName}" preset...`,
							display: true,
						});
						setTeamActivity(ctx, [
							`Team: creating "${parsed.presetName}" preset...`,
							`Task: ${truncateForStatus(parsed.taskDescription)}`,
						]);

						try {
							const observer = createTeamObserver(api, ctx, teamRuntime);
							const result = await executePreset(
								teamRuntime,
								parsed.presetName,
								parsed.taskDescription,
								ctx.cwd,
								ctx.model,
								observer.onEvent,
							);
							observer.flush();
							api.sendMessage({
								customType: TEAM_MESSAGE_TYPE,
								content: formatPresetResult(result).join("\n"),
								display: true,
							});
							updateTeamUi(ctx, teamRuntime);
						} catch (error: unknown) {
							const message = error instanceof Error ? error.message : String(error);
							ctx.ui.notify(`Failed to execute preset: ${message}`, "error");
							api.sendMessage({
								customType: TEAM_MESSAGE_TYPE,
								content: `Failed to execute preset: ${message}`,
								display: true,
							});
							updateTeamUi(ctx, teamRuntime);
						} finally {
							ctx.ui.setWorkingMessage();
						}
						break;
					}

					case "progress": {
						const teammates = parsed.target
							? [teamRuntime.getTeammate(parsed.target)].filter((t): t is PersistedTeammate => Boolean(t))
							: teamRuntime.getAllTeammates();
						if (parsed.target && teammates.length === 0) {
							ctx.ui.notify(`Teammate "${parsed.target}" not found`, "error");
							return;
						}
						const lines = teammates.flatMap((teammate) => [
							`Teammate: ${teammate.identity.name}`,
							...formatHarnessProgress(teammate.harness),
							"",
						]);
						api.sendMessage({
							customType: TEAM_MESSAGE_TYPE,
							content: lines.join("\n").trimEnd(),
							display: true,
						});
						break;
					}

					case "psyche": {
						const teammates = parsed.target
							? [teamRuntime.getTeammate(parsed.target)].filter((t): t is PersistedTeammate => Boolean(t))
							: teamRuntime.getAllTeammates();
						if (parsed.target && teammates.length === 0) {
							ctx.ui.notify(`Teammate "${parsed.target}" not found`, "error");
							return;
						}
						const lines = teammates.map(
							(teammate) => `${teammate.identity.name}: ${formatPsycheWeights(teammate.psyche)}`,
						);
						api.sendMessage({
							customType: TEAM_MESSAGE_TYPE,
							content: lines.join("\n"),
							display: true,
						});
						break;
					}

					case "dashboard": {
						dashboardVisible = !dashboardVisible;
						updateTeamUi(ctx, teamRuntime);
						api.sendMessage({
							customType: TEAM_MESSAGE_TYPE,
							content: `Team dashboard ${dashboardVisible ? "enabled" : "disabled"}.`,
							display: true,
						});
						break;
					}

					case "task": {
						if (!parsed.taskAction) {
							ctx.ui.notify("Usage: /team:task <list|add|claim|done|block|cancel> ...", "error");
							return;
						}
						if (parsed.taskAction === "list") {
							const tasks = await teamRuntime.listTasks();
							api.sendMessage({
								customType: TEAM_MESSAGE_TYPE,
								content: formatTaskList(tasks).join("\n"),
								display: true,
							});
							break;
						}
						if (parsed.taskAction === "add") {
							if (!parsed.taskTitle) {
								ctx.ui.notify("Usage: /team:task add <title>", "error");
								return;
							}
							const task = await teamRuntime.addTask(parsed.taskTitle);
							api.sendMessage({
								customType: TEAM_MESSAGE_TYPE,
								content: `Added task ${task.id}: ${task.title}`,
								display: true,
							});
							break;
						}
						if (parsed.taskAction === "claim") {
							if (!parsed.taskId || !parsed.target) {
								ctx.ui.notify("Usage: /team:task claim <id> <name>", "error");
								return;
							}
							const task = await teamRuntime.claimTask(parsed.taskId, parsed.target);
							if (!task) {
								ctx.ui.notify(`Task or teammate not found: ${parsed.taskId}`, "error");
								return;
							}
							api.sendMessage({
								customType: TEAM_MESSAGE_TYPE,
								content: `Claimed ${task.id} for ${task.ownerName}: ${task.title}`,
								display: true,
							});
							break;
						}
						if (!parsed.taskId) {
							ctx.ui.notify(`Usage: /team:task ${parsed.taskAction} <id>`, "error");
							return;
						}
						const status =
							parsed.taskAction === "done"
								? "done"
								: parsed.taskAction === "block"
									? "blocked"
									: "cancelled";
						const task = await teamRuntime.updateTaskStatus(parsed.taskId, status);
						if (!task) {
							ctx.ui.notify(`Task not found: ${parsed.taskId}`, "error");
							return;
						}
						api.sendMessage({
							customType: TEAM_MESSAGE_TYPE,
							content: `Updated ${task.id} to ${task.status}: ${task.title}`,
							display: true,
						});
						break;
					}

					case "mail": {
						if (!parsed.from || !parsed.to || !parsed.message) {
							ctx.ui.notify("Usage: /team:mail <from> <to> <message>", "error");
							return;
						}
						const ok = await teamRuntime.sendTeammateMail(parsed.from, parsed.to, parsed.message);
						if (!ok) {
							ctx.ui.notify(`Could not route mail from ${parsed.from} to ${parsed.to}`, "error");
							return;
						}
						api.sendMessage({
							customType: TEAM_MESSAGE_TYPE,
							content: `Routed mail ${parsed.from} -> ${parsed.to}.`,
							display: true,
						});
						break;
					}

					case "allow-path": {
						if (!parsed.target || !parsed.path) {
							ctx.ui.notify("Usage: /team:allow-path <name> <path>", "error");
							return;
						}
						const allowedPath = await teamRuntime.allowPath(parsed.target, parsed.path);
						if (!allowedPath) {
							ctx.ui.notify(`Teammate "${parsed.target}" not found`, "error");
							return;
						}
						api.sendMessage({
							customType: TEAM_MESSAGE_TYPE,
							content: `Granted ${parsed.target} write access to ${allowedPath}`,
							display: true,
						});
						break;
					}
				}
			},
		});
	}
}

function getCommandDescription(commandName: string): string {
	switch (commandName) {
		case "team:spawn":
			return "Create a persistent teammate (/team:spawn <role> [--name <name>])";
		case "team:send":
			return "Send message to a teammate (/team:send <name> <message>)";
		case "team:status":
			return "Show team or teammate status";
		case "team:stop":
			return "Stop teammate's current turn";
		case "team:terminate":
			return "Destroy a teammate";
		case "team:approve":
			return "Approve a permission request";
		case "team:mode":
			return "Switch teammate mode (/team:mode <name> <plan|execute|review>)";
		case "team:preset":
			return "Create teammates from a preset";
		case "team:dashboard":
			return "Toggle the team dashboard";
		case "team:progress":
			return "Show harness progress";
		case "team:psyche":
			return "Show psyche weights";
		case "team:task":
			return "Manage shared team tasks";
		case "team:mail":
			return "Route teammate-to-teammate mailbox messages";
		case "team:allow-path":
			return "Grant a teammate write access to a path prefix";
		default:
			return "AgentTeam management";
	}
}

function formatTaskList(tasks: TeamTask[]): string[] {
	if (tasks.length === 0) return ["No team tasks. Use /team:task add <title> to create one."];
	const lines = ["Team Tasks:", ""];
	for (const task of tasks) {
		const owner = task.ownerName ? ` @${task.ownerName}` : "";
		const deps = task.dependsOn.length ? ` deps:${task.dependsOn.join(",")}` : "";
		lines.push(`${task.id} [${task.status}]${owner}${deps} ${task.title}`);
		if (task.description) lines.push(`  ${task.description}`);
		if (task.artifactPaths.length) lines.push(`  artifacts: ${task.artifactPaths.join(", ")}`);
	}
	return lines;
}

function formatTeammateList(teammates: PersistedTeammate[]): string[] {
	if (teammates.length === 0) {
		return ["No teammates. Use /team:spawn to create one."];
	}

	const lines = [
		`Team (${teammates.length} teammate${teammates.length === 1 ? "" : "s"}):`,
		"",
	];

	for (const t of teammates) {
		const statusIcon = getStatusIconAscii(t.status);
		const harness = t.harness?.enabled ? ` | harness:${t.harness.phase} ${t.harness.passedFeatures}/${t.harness.totalFeatures}` : "";
		lines.push(`${statusIcon} ${t.identity.name} (${t.identity.role}) - ${t.mode} mode${harness}`);
	}

	return lines;
}

function formatTeammateStatus(teammate: PersistedTeammate): string[] {
	const lines = [
		`Teammate: ${teammate.identity.name}`,
		`  ID: ${teammate.identity.id}`,
		`  Role: ${teammate.identity.role}`,
		`  Mode: ${teammate.mode}`,
		`  Status: ${teammate.status}`,
		`  Created: ${new Date(teammate.identity.createdAt).toLocaleString()}`,
		`  Last Active: ${new Date(teammate.lastActiveAt).toLocaleString()}`,
		`  Working Directory: ${teammate.cwd}`,
	];

	if (teammate.worktreePath) {
		lines.push(`  Worktree: ${teammate.worktreePath}`);
		if (teammate.worktreeBranch) {
			lines.push(`  Branch: ${teammate.worktreeBranch}`);
		}
	}

	if (teammate.lastError) {
		lines.push(`  Last Error: ${teammate.lastError}`);
	}

	if (teammate.harness?.enabled) {
		lines.push(...formatHarnessProgress(teammate.harness).map((line) => `  ${line}`));
	}
	if (teammate.psyche) {
		lines.push(`  ${formatPsycheWeights(teammate.psyche)}`);
	}

	lines.push(`  Messages: ${teammate.messages.length}`);

	return lines;
}

function updateTeamUi(
	ctx: { ui: { setStatus(key: string, text: string | undefined): void; setWidget(key: string, content: string[] | undefined): void } },
	teamRuntime: TeamRuntime,
): void {
	const teammates = teamRuntime.getAllTeammates();
	const hasRunning = teammates.some((teammate) => teammate.status === "running");
	if (dashboardAutoHideTimer) {
		clearTimeout(dashboardAutoHideTimer);
		dashboardAutoHideTimer = undefined;
	}

	ctx.ui.setStatus("team", renderTeamFooterStatus(teammates));
	ctx.ui.setWidget(
		"team-dashboard",
		dashboardVisible || hasRunning || teammates.length > 0 ? renderTeamDashboard(teammates) : undefined,
	);
	if (!dashboardVisible && !hasRunning && teammates.length > 0) {
		dashboardAutoHideTimer = setTimeout(() => {
			ctx.ui.setWidget("team-dashboard", undefined);
			dashboardAutoHideTimer = undefined;
		}, 30_000);
	}
}

function setTeamActivity(
	ctx: {
		ui: {
			setStatus(key: string, text: string | undefined): void;
			setWidget(key: string, content: string[] | undefined): void;
			setWorkingMessage(message?: string): void;
		};
	},
	lines: string[],
): void {
	const [firstLine] = lines;
	ctx.ui.setStatus("team", firstLine ?? "Team: working...");
	ctx.ui.setWidget("team-dashboard", ["Team Activity", "", ...lines]);
	ctx.ui.setWorkingMessage(firstLine ?? "Team: working...");
}

function createTeamObserver(
	api: ExtensionAPI,
	ctx: {
		ui: {
			setStatus(key: string, text: string | undefined): void;
			setWidget(key: string, content: string[] | undefined): void;
			setWorkingMessage(message?: string): void;
		};
	},
	teamRuntime: TeamRuntime,
): { onEvent(event: TeamRuntimeEvent): void; flush(): void } {
	let lastUiUpdate = 0;

	return {
		onEvent(event) {
			const now = Date.now();
			if (event.type === "teammate_live") {
				ctx.ui.setWorkingMessage(formatLiveWorkingMessage(event));
			} else if (event.type === "teammate_status") {
				api.sendMessage({
					customType: TEAM_MESSAGE_TYPE,
					content: event.event,
					display: true,
				});
				ctx.ui.setWorkingMessage(`Team: ${event.event}`);
			} else {
				api.sendMessage({
					customType: TEAM_MESSAGE_TYPE,
					content: `Harness event for ${event.teammate.identity.name}: ${event.event}`,
					display: true,
				});
			}

			if (event.type === "teammate_live" || now - lastUiUpdate > 80) {
				updateTeamUi(ctx, teamRuntime);
				lastUiUpdate = now;
			}
		},
		flush() {
			updateTeamUi(ctx, teamRuntime);
		},
	};
}

function formatLiveWorkingMessage(event: Extract<TeamRuntimeEvent, { type: "teammate_live" }>): string {
	const name = event.teammate.identity.name;
	const live = event.teammate.live;
	if (event.event.type === "tool_start") {
		return `Team: ${name} running ${event.event.toolName}...`;
	}
	if (event.event.type === "tool_update" || event.event.type === "tool_end") {
		return `Team: ${name} using ${event.event.toolName}...`;
	}
	if (live?.phase === "thinking") {
		return `Team: ${name} streaming...`;
	}
	if (live?.phase === "finishing") {
		return `Team: ${name} finishing...`;
	}
	return `Team: ${name} ${live?.phase ?? "working"}...`;
}

function singleLine(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function truncateForStatus(value: string, max = 100): string {
	const single = singleLine(value);
	if (single.length <= max) return single;
	return `${single.slice(0, Math.max(0, max - 3))}...`;
}

function getStatusIconAscii(status: PersistedTeammate["status"]): string {
	switch (status) {
		case "idle":
			return "o";
		case "running":
			return "*";
		case "stopped":
			return "!";
		case "error":
			return "x";
		case "terminated":
			return "-";
		default:
			return "?";
	}
}

function getStatusIcon(status: PersistedTeammate["status"]): string {
	switch (status) {
		case "idle":
			return "○";
		case "running":
			return "●";
		case "stopped":
			return "◐";
		case "error":
			return "✗";
		case "terminated":
			return "⊗";
		default:
			return "?";
	}
}
