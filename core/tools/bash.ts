/**
 * [WHO]: BashTool, bashTool, createBashTool, BashToolInput, BashToolDetails, BashOperations,
 *        isDangerousCommand, DangerousCommandCheck, ApprovalClient, ApprovalChoice, ApprovalDecision
 * [FROM]: Depends on agent-core, node:fs, node:path, node:os, node:child_process
 * [TO]: Consumed by core/tools/index.ts
 * [HERE]: core/tools/bash.ts - shell command execution boundary; consumed by orchestrator.
 *   Layer 1: stdio[0] = "pipe" + 30s stdin grace timer (ADR bash-stdin-pipe-decision).
 *   Layer 2: DANGEROUS_PATTERNS + isDangerousCommand + pre-execution approval gate
 *            (ADR bash-pre-execution-approval-decision).
 */
import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { AgentTool } from "@catui/agent-core";
import { type Static, Type } from "@sinclair/typebox";
import { spawn } from "child_process";
import { getShellConfig, getShellEnv, killProcessTree } from "../platform/utils/shell.js";
import { validatePositiveNumberOption } from "./input-validation.js";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, type TruncationResult, truncateTail } from "./truncate.js";

/**
 * Generate a unique temp file path for bash output
 */
function getTempFilePath(): string {
	const id = randomBytes(8).toString("hex");
	return join(tmpdir(), `catui-bash-${id}.log`);
}

const DEFAULT_TIMEOUT = 120;

interface BackgroundTask {
	id: string;
	outputPath: string;
	status: "running" | "completed" | "failed";
	exitCode: number | null;
	startTime: number;
	endTime?: number;
	pid?: number;
}

/** Module-level registry of background tasks */
const backgroundTasks = new Map<string, BackgroundTask>();

/** Get a background task by ID. */
export function getBackgroundTask(taskId: string): BackgroundTask | undefined {
	return backgroundTasks.get(taskId);
}

/** List all background tasks. */
export function listBackgroundTasks(): BackgroundTask[] {
	return Array.from(backgroundTasks.values());
}

/** Kill a background task's process tree. Returns true if task was found and killed. */
export function killBackgroundTask(taskId: string): boolean {
	const task = backgroundTasks.get(taskId);
	if (!task || task.status !== "running" || !task.pid) return false;
	killProcessTree(task.pid);
	task.status = "failed";
	task.exitCode = -1;
	task.endTime = Date.now();
	return true;
}

/** Read the output of a background task (if finished). */
export function readBackgroundTaskOutput(taskId: string): string | null {
	const task = backgroundTasks.get(taskId);
	if (!task || task.status === "running") return null;
	try {
		return readFileSync(task.outputPath, "utf-8");
	} catch {
		return null;
	}
}

const bashSchema = Type.Object({
	command: Type.Optional(Type.String({ description: "Bash command to execute" })),
	timeout: Type.Optional(Type.Number({ exclusiveMinimum: 0, description: "Timeout in seconds (default: 120)" })),
	description: Type.Optional(Type.String({ description: "Clear, concise description of what this command does" })),
	run_in_background: Type.Optional(Type.Boolean({ description: "Run command in background, return immediately with task ID (default: false)" })),
	task_id: Type.Optional(Type.String({ description: "Task ID to check status/get output for a background command" })),
});

export type BashToolInput = Static<typeof bashSchema>;

export interface BashToolDetails {
	truncation?: TruncationResult;
	fullOutputPath?: string;
}

/**
 * Result of a dangerous-command pattern check.
 * See ADR `.dev-docs/architecture-review/bash-pre-execution-approval-decision/ADR.md`.
 */
export interface DangerousCommandCheck {
	matched: boolean;
	/** Pattern label when matched, e.g. "shell command via -c/-lc flag". */
	reason?: string;
}

/**
 * Patterns that warrant pre-execution user approval.
 * Derived from `hermes-agent`'s `tools/approval.py:498+` DANGEROUS_PATTERNS,
 * narrowed to the npm/npx/curl/git shell-injection surface relevant here.
 * PowerShell-specific and SQL patterns are omitted intentionally — see ADR.
 */
const DANGEROUS_PATTERNS: Array<[RegExp, string]> = [
	// Destructive deletes
	[/\brm\s+(-[^\s]*\s+)*\//, "delete in root path"],
	[/\brm\s+-[^\s]*r/, "recursive delete"],
	[/\brm\s+--recursive\b/, "recursive delete (long flag)"],
	[/\bcmd(?:\.exe)?\s+\/(?:c|k)\s+.*\b(?:del|erase|rd|rmdir)\b/, "Windows cmd destructive delete"],
	// Permission widening
	[/\bchmod\s+(-[^\s]*\s+)*(777|666|o\+[rwx]*w|a\+[rwx]*w)\b/, "world/other-writable permissions"],
	[/\bchmod\s+--recursive\b.*(777|666|o\+[rwx]*w|a\+[rwx]*w)/, "recursive world/other-writable"],
	// Disk / process
	[/\bmkfs\b/, "format filesystem"],
	[/\bdd\s+.*if=/, "disk copy"],
	[/>\s*\/dev\/sd/, "write to block device"],
	[/\bkill\s+-9\s+-1\b/, "kill all processes"],
	[/\bpkill\s+-9\b/, "force kill processes"],
	[/\bkillall\s+(-[^\s]*\s+)*-(9|KILL|SIGKILL)\b/, "force kill processes (killall -KILL)"],
	// Shell-injection
	[/\b(bash|sh|zsh|ksh)\s+-[^\s]*c(\s+|$)/, "shell command via -c/-lc flag"],
	[/\b(python[23]?|perl|ruby|node)\s+-[ec]\s+/, "script execution via -e/-c flag"],
	// Use RegExp ctor for the next two to avoid TS lexer ambiguity with `/` inside character classes
	[new RegExp("\\b(curl|wget)\\b.*\\|\\s*(?:[\\/\\w]*\\/)?(?:ba)?sh(?:\\s|$|-c)"), "pipe remote content to shell"],
	[new RegExp("(?:\\beval\\b|\\bsource\\b|\\.)\\s*(?:\\$\\(\\s*|`\\s*)(?:curl|wget)\\b"), "execute remote content via command substitution"],
	[new RegExp("\\b(base64|base32)\\s+(?:-[dD]|--decode)\\b.*\\|\\s*\\b(bash|sh|zsh|ksh|dash)\\b"), "pipe decoded content to shell (possible obfuscation)"],
	// npm / yarn / npx surface (the user's actual pain point)
	[/\bnpm\s+(?:install|i|add)\s+(?:-g|--global)/, "global npm install"],
	[/\bnpx\s+(?:create-|@?\w+\/|\S+)/, "npx package execution (often downloads + may be interactive)"],
	[/\byarn\s+global\s+add\b/, "yarn global add"],
	// Git force-push to main/master
	[/\bgit\s+push\s+(?:-f|--force(?:-with-lease)?)\b.*\b(?:origin\s+)?(?:main|master)\b/, "force-push to main/master"],
	// Fork bomb
	[/:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, "fork bomb"],
];

/**
 * Check whether `command` matches any DANGEROUS_PATTERNS entry.
 * Returns `{ matched, reason }` — `reason` is the human-readable pattern label.
 *
 * Pure function — no side effects, no I/O. Intended to be used by spawn
 * pre-hook (Layer 2) and by tests.
 */
export function isDangerousCommand(command: string): DangerousCommandCheck {
	if (!command) return { matched: false };
	for (const [pattern, reason] of DANGEROUS_PATTERNS) {
		if (pattern.test(command)) {
			return { matched: true, reason };
		}
	}
	return { matched: false };
}

/**
 * Pluggable operations for the bash tool.
 * Override these to delegate command execution to remote systems (e.g., SSH).
 */
export interface BashOperations {
	/**
	 * Execute a command and stream output.
	 * @param command - The command to execute
	 * @param cwd - Working directory
	 * @param options - Execution options
	 * @returns Promise resolving to exit code (null if killed)
	 */
	exec: (
		command: string,
		cwd: string,
		options: {
			onData: (data: Buffer) => void;
			signal?: AbortSignal;
			timeout?: number;
			/**
			 * How long to wait for the child process to finish reading from stdin
			 * before forcibly closing it. Defaults to 30000 (30s).
			 *
			 * Background: previously `stdio[0]` was `"ignore"`, which made any
			 * interactive command (`npm init`, `npx create-x`, `read -p`, etc.)
			 * either fail with EOF immediately or hang forever. With `"pipe"`,
			 * the child waits for stdin; this timeout prevents indefinite hangs
			 * by closing stdin after the grace period, letting the command fall
			 * back to its default behavior.
			 *
			 * See `.dev-docs/architecture-review/bash-stdin-pipe-decision/ADR.md`.
			 */
			stdinTimeoutMs?: number;
			env?: NodeJS.ProcessEnv;
			onSpawn?: (pid: number) => void;
		},
	) => Promise<{ exitCode: number | null; pid?: number }>;
}

/**
 * Default bash operations using local shell
 */
const defaultBashOperations: BashOperations = {
	exec: (command, cwd, { onData, signal, timeout, stdinTimeoutMs, env, onSpawn }) => {
		return new Promise((resolve, reject) => {
			const { shell, args } = getShellConfig();

			if (!existsSync(cwd)) {
				reject(new Error(`Working directory does not exist: ${cwd}\nCannot execute bash commands.`));
				return;
			}

			const child = spawn(shell, [...args, command], {
				cwd,
				detached: true,
				env: env ?? getShellEnv(),
				stdio: ["pipe", "pipe", "pipe"],
			});

			if (child.pid) onSpawn?.(child.pid);

			let timedOut = false;

			// Set timeout if provided
			let timeoutHandle: NodeJS.Timeout | undefined;
			if (timeout !== undefined && timeout > 0) {
				timeoutHandle = setTimeout(() => {
					timedOut = true;
					if (child.pid) {
						killProcessTree(child.pid);
					}
				}, timeout * 1000);
			}

			// Stdin grace timer: close stdin after `stdinTimeoutMs` so commands
			// waiting for input (npm init, read -p, etc.) fall back to defaults
			// instead of hanging forever. See ADR bash-stdin-pipe-decision.
			const stdinGraceMs = stdinTimeoutMs ?? 30_000;
			let stdinTimer: NodeJS.Timeout | undefined;
			let stdinClosed = false;
			const closeStdin = () => {
				if (stdinClosed) return;
				stdinClosed = true;
				try {
					child.stdin?.end();
				} catch {
					// stdin may already be closed; ignore
				}
			};
			stdinTimer = setTimeout(closeStdin, stdinGraceMs);

			// Stream stdout and stderr
			if (child.stdout) {
				child.stdout.on("data", onData);
			}
			if (child.stderr) {
				child.stderr.on("data", onData);
			}

			// Handle shell spawn errors
			child.on("error", (err) => {
				if (timeoutHandle) clearTimeout(timeoutHandle);
				if (stdinTimer) clearTimeout(stdinTimer);
				if (signal) signal.removeEventListener("abort", onAbort);
				closeStdin();
				reject(err);
			});

			// Handle abort signal - kill entire process tree
			const onAbort = () => {
				if (child.pid) {
					killProcessTree(child.pid);
				}
			};

			if (signal) {
				if (signal.aborted) {
					onAbort();
				} else {
					signal.addEventListener("abort", onAbort, { once: true });
				}
			}

			// Handle process exit
			child.on("close", (code) => {
				if (timeoutHandle) clearTimeout(timeoutHandle);
				if (stdinTimer) clearTimeout(stdinTimer);
				if (signal) signal.removeEventListener("abort", onAbort);
				closeStdin();

				if (signal?.aborted) {
					reject(new Error("aborted"));
					return;
				}

				if (timedOut) {
					reject(new Error(`timeout:${timeout}`));
					return;
				}

				resolve({ exitCode: code, pid: child.pid });
			});
		});
	},
};

export interface BashSpawnContext {
	command: string;
	cwd: string;
	env: NodeJS.ProcessEnv;
}

export type BashSpawnHook = (context: BashSpawnContext) => BashSpawnContext;

function resolveSpawnContext(command: string, cwd: string, spawnHook?: BashSpawnHook): BashSpawnContext {
	const baseContext: BashSpawnContext = {
		command,
		cwd,
		env: { ...getShellEnv() },
	};

	return spawnHook ? spawnHook(baseContext) : baseContext;
}

export interface BashToolOptions {
	/** Custom operations for command execution. Default: local shell */
	operations?: BashOperations;
	/** Command prefix prepended to every command (e.g., "shopt -s expand_aliases" for alias support) */
	commandPrefix?: string;
	/** Hook to adjust command, cwd, or env before execution */
	spawnHook?: BashSpawnHook;
	/**
	 * Layer 2: pre-execution approval client. When provided, dangerous
	 * commands (see isDangerousCommand) will prompt the user before spawn.
	 * When omitted, no approval gating happens — fast-path only.
	 * See ADR .dev-docs/architecture-review/bash-pre-execution-approval-decision/ADR.md.
	 */
	approval?: ApprovalClient;
	/**
	 * Layer 2: skip approval gating entirely (for tests or non-interactive
	 * modes). Defaults to false.
	 */
	skipApproval?: boolean;
}

/**
 * Client injected into bash tool for pre-execution approval prompts.
 * `request()` should resolve to a user choice; if it rejects or times out,
 * the bash tool fails closed (treats as "deny").
 */
export interface ApprovalClient {
	request(decision: ApprovalDecision): Promise<ApprovalChoice>;
}

/**
 * Reducer of what we send to the approval client.
 */
export interface ApprovalDecision {
	command: string;
	description: string;
	reason: string;
}

export type ApprovalChoice = "once" | "session" | "always" | "deny";

export function createBashTool(cwd: string, options?: BashToolOptions): AgentTool<typeof bashSchema> {
	const ops = options?.operations ?? defaultBashOperations;
	const commandPrefix = options?.commandPrefix;
	const spawnHook = options?.spawnHook;
	const approval = options?.approval;
	const skipApproval = options?.skipApproval ?? false;

	return {
		name: "bash",
		label: "bash",
		description: `Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). If truncated, full output is saved to a temp file. Default timeout: ${DEFAULT_TIMEOUT}s. Supports run_in_background for long-running commands.`,
		parameters: bashSchema,
		execute: async (
			_toolCallId: string,
			{ command, timeout, description: _description, run_in_background, task_id }: {
				command?: string;
				timeout?: number;
				description?: string;
				run_in_background?: boolean;
				task_id?: string;
			},
			signal?: AbortSignal,
			onUpdate?,
		) => {
			validatePositiveNumberOption("timeout", timeout);

			// Handle task_id: check status of a background task
			if (task_id) {
				const task = backgroundTasks.get(task_id);
				if (!task) {
					throw new Error(`Background task not found: ${task_id}`);
				}

				if (task.status === "running") {
					return {
						content: [{ type: "text", text: `Task ${task_id} is still running.` }],
						details: undefined,
					};
				}

				// Task finished - read output
				let output = "";
				try {
					const { readFileSync } = await import("node:fs");
					output = readFileSync(task.outputPath, "utf-8");
				} catch {
					output = "(output unavailable)";
				}

				const truncation = truncateTail(output);
				let outputText = truncation.content || "(no output)";
				if (task.exitCode !== 0 && task.exitCode !== null) {
					outputText += `\n\nCommand exited with code ${task.exitCode}`;
				}

				// Clean up
				backgroundTasks.delete(task_id);

				const details: BashToolDetails | undefined = truncation.truncated ? { truncation } : undefined;
				if (task.exitCode !== 0 && task.exitCode !== null) {
					throw new Error(outputText);
				}
				return { content: [{ type: "text", text: outputText }], details };
			}

			if (!command) {
				throw new Error("command is required (or provide task_id to check a background task)");
			}

			const effectiveTimeout = timeout ?? DEFAULT_TIMEOUT;

			// Handle run_in_background: start command and return immediately
			if (run_in_background) {
				// Layer 2: pre-execution approval gate for background tasks too.
				// Same fail-closed semantics as the foreground path above.
				if (!skipApproval && approval && command) {
					const danger = isDangerousCommand(commandPrefix ? `${commandPrefix}\n${command}` : command);
					if (danger.matched) {
						let choice: ApprovalChoice;
						try {
							choice = await approval.request({
								command: commandPrefix ? `${commandPrefix}\n${command}` : command,
								description: _description ?? "",
								reason: danger.reason ?? "dangerous pattern matched",
							});
						} catch (err) {
							return {
								content: [{
									type: "text",
									text: `Background command denied (approval error): ${err instanceof Error ? err.message : String(err)}`,
								}],
								details: undefined,
								isError: true,
							};
						}
						if (choice === "deny") {
							return {
								content: [{
									type: "text",
									text: `Background command denied by user: ${danger.reason ?? "dangerous pattern"}`,
								}],
								details: undefined,
								isError: true,
							};
						}
					}
				}

				const taskId = randomBytes(4).toString("hex");
				const outputPath = getTempFilePath();
				const backgroundTask: BackgroundTask = {
					id: taskId,
					outputPath,
					status: "running",
					exitCode: null,
					startTime: Date.now(),
				};
				backgroundTasks.set(taskId, backgroundTask);

				// Apply command prefix if configured
				const resolvedCommand = commandPrefix ? `${commandPrefix}\n${command}` : command;
				const spawnContext = resolveSpawnContext(resolvedCommand, cwd, spawnHook);

				// Start the command asynchronously (fire-and-forget)
				const fileStream = createWriteStream(outputPath);
				ops.exec(spawnContext.command, spawnContext.cwd, {
					onData: (data) => fileStream.write(data),
					timeout: effectiveTimeout,
					env: spawnContext.env,
					onSpawn: (pid) => { backgroundTask.pid = pid; },
				})
					.then(({ exitCode }) => {
						fileStream.end();
						backgroundTask.status = exitCode === 0 ? "completed" : "failed";
						backgroundTask.exitCode = exitCode;
						backgroundTask.endTime = Date.now();
					})
					.catch(() => {
						fileStream.end();
						backgroundTask.status = "failed";
						backgroundTask.exitCode = -1;
						backgroundTask.endTime = Date.now();
					});

				return {
					content: [{
						type: "text",
						text: `Background task started: ${taskId}\nOutput will be written to: ${outputPath}\nUse task_id="${taskId}" to check status and retrieve output.`,
					}],
					details: undefined,
				};
			}

			// Normal foreground execution
			// Apply command prefix if configured (e.g., "shopt -s expand_aliases" for alias support)
			const resolvedCommand = commandPrefix ? `${commandPrefix}\n${command}` : command;
			const spawnContext = resolveSpawnContext(resolvedCommand, cwd, spawnHook);

			// Layer 2: pre-execution approval gate (ADR bash-pre-execution-approval-decision).
			// Fast-path when skipApproval=true OR no approval client wired (print/rpc mode).
			// Fail-closed: any exception, timeout, or "deny" response aborts execution.
			if (!skipApproval && approval && command) {
				const danger = isDangerousCommand(resolvedCommand);
				if (danger.matched) {
					let choice: ApprovalChoice;
					try {
						choice = await approval.request({
							command: resolvedCommand,
							description: _description ?? "",
							reason: danger.reason ?? "dangerous pattern matched",
						});
					} catch (err) {
						// Approval rejected / threw -> fail-closed
						return {
							content: [{
								type: "text",
								text: `Command denied (approval error): ${err instanceof Error ? err.message : String(err)}`,
							}],
							details: undefined,
							isError: true,
						};
					}
					if (choice === "deny") {
						return {
							content: [{
								type: "text",
								text: `Command denied by user: ${danger.reason ?? "dangerous pattern"}`,
							}],
							details: undefined,
							isError: true,
						};
					}
					// "once" / "session" / "always" all proceed to spawn.
					// Session persistence ("session"/"always" mapping to a config allowlist)
					// is out of scope for Layer 2 — deferred to Layer 3 (same ADR §D6).
				}
			}

			return new Promise((resolve, reject) => {
				// We'll stream to a temp file if output gets large
				let tempFilePath: string | undefined;
				let tempFileStream: ReturnType<typeof createWriteStream> | undefined;
				let totalBytes = 0;

				// Keep a rolling buffer of the last chunk for tail truncation
				const chunks: Buffer[] = [];
				let chunksBytes = 0;
				// Keep more than we need so we have enough for truncation
				const maxChunksBytes = DEFAULT_MAX_BYTES * 2;

				const handleData = (data: Buffer) => {
					totalBytes += data.length;

					// Start writing to temp file once we exceed the threshold
					if (totalBytes > DEFAULT_MAX_BYTES && !tempFilePath) {
						tempFilePath = getTempFilePath();
						tempFileStream = createWriteStream(tempFilePath);
						// Write all buffered chunks to the file
						for (const chunk of chunks) {
							tempFileStream.write(chunk);
						}
					}

					// Write to temp file if we have one
					if (tempFileStream) {
						tempFileStream.write(data);
					}

					// Keep rolling buffer of recent data
					chunks.push(data);
					chunksBytes += data.length;

					// Trim old chunks if buffer is too large
					while (chunksBytes > maxChunksBytes && chunks.length > 1) {
						const removed = chunks.shift()!;
						chunksBytes -= removed.length;
					}

					// Stream partial output to callback (truncated rolling buffer)
					if (onUpdate) {
						const fullBuffer = Buffer.concat(chunks);
						const fullText = fullBuffer.toString("utf-8");
						const truncation = truncateTail(fullText);
						onUpdate({
							content: [{ type: "text", text: truncation.content || "" }],
							details: {
								truncation: truncation.truncated ? truncation : undefined,
								fullOutputPath: tempFilePath,
							},
						});
					}
				};

				ops.exec(spawnContext.command, spawnContext.cwd, {
					onData: handleData,
					signal,
					timeout: effectiveTimeout,
					env: spawnContext.env,
				})
					.then(({ exitCode }) => {
						// Close temp file stream
						if (tempFileStream) {
							tempFileStream.end();
						}

						// Combine all buffered chunks
						const fullBuffer = Buffer.concat(chunks);
						const fullOutput = fullBuffer.toString("utf-8");

						// Apply tail truncation
						const truncation = truncateTail(fullOutput);
						let outputText = truncation.content || "(no output)";

						// Build details with truncation info
						let details: BashToolDetails | undefined;

						if (truncation.truncated) {
							details = {
								truncation,
								fullOutputPath: tempFilePath,
							};

							// Build actionable notice
							const startLine = truncation.totalLines - truncation.outputLines + 1;
							const endLine = truncation.totalLines;

							if (truncation.lastLinePartial) {
								// Edge case: last line alone > 30KB
								const lastLineSize = formatSize(Buffer.byteLength(fullOutput.split("\n").pop() || "", "utf-8"));
								outputText += `\n\n[Showing last ${formatSize(truncation.outputBytes)} of line ${endLine} (line is ${lastLineSize}). Full output: ${tempFilePath}]`;
							} else if (truncation.truncatedBy === "lines") {
								outputText += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}. Full output: ${tempFilePath}]`;
							} else {
								outputText += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). Full output: ${tempFilePath}]`;
							}
						}

						if (exitCode !== 0 && exitCode !== null) {
							outputText += `\n\nCommand exited with code ${exitCode}`;
							reject(new Error(outputText));
						} else {
							resolve({ content: [{ type: "text", text: outputText }], details });
						}
					})
					.catch((err: Error) => {
						// Close temp file stream
						if (tempFileStream) {
							tempFileStream.end();
						}

						// Combine all buffered chunks for error output
						const fullBuffer = Buffer.concat(chunks);
						let output = fullBuffer.toString("utf-8");

						if (err.message === "aborted") {
							if (output) output += "\n\n";
							output += "Command aborted";
							reject(new Error(output));
						} else if (err.message.startsWith("timeout:")) {
							const timeoutSecs = err.message.split(":")[1];
							if (output) output += "\n\n";
							output += `Command timed out after ${timeoutSecs} seconds`;
							reject(new Error(output));
						} else {
							reject(err);
						}
					});
			});
		},
	};
}

/** Default bash tool using process.cwd() - for backwards compatibility */
export const bashTool = createBashTool(process.cwd());

/**
 * Patterns that indicate write operations in bash commands.
 * These are blocked in sandbox mode.
 */
const SANDBOX_BLOCKED_PATTERNS = [
  // Output redirection
  /^\s*>|\s>|\s>>|\s&\d>/,
  // File deletion
  /\brm\s+/,
  // Move/copy
  /\bmv\s+/,
  /\bcp\s+.*\s+\//,
  // Git write operations
  /\bgit\s+(commit|push|pull|add|checkout\s+[^-|]|reset|rebase\s+[^--]|merge)/,
  // Create directories
  /\bmkdir\s+[^-]/,
  // chmod/chown
  /\bchmod\s+/,
  /\bchown\s+/,
  //ln -s
  /\bln\s+.*-s/,
  // tee
  /\btee\s+/,
  // wget/curl with output
  /\bwget\s+.*-O/,
  /\bcurl\s+.*-o/,
];

export interface BashSandboxOptions {
  /** Additional patterns to block (in addition to default blocked patterns) */
  additionalBlockedPatterns?: RegExp[];
  /** Custom error message for blocked commands */
  blockedMessage?: string;
  /** Optional path allowlist hook for simple write commands. Defaults to denying all writes. */
  allowWritePath?: (absolutePath: string) => boolean;
}

/**
 * Create a sandboxed bash hook that blocks dangerous write operations.
 * This is a defense-in-depth measure for read-only SubAgents.
 */
export function createSandboxHook(options?: BashSandboxOptions): BashSpawnHook {
  const blockedPatterns = [
    ...SANDBOX_BLOCKED_PATTERNS,
    ...(options?.additionalBlockedPatterns ?? []),
  ];
  const blockedMessage = options?.blockedMessage ?? "Write operations are not allowed in sandbox mode";

  return (context) => {
    const command = context.command.trim();
    const writePaths = extractSimpleWritePaths(command, context.cwd);
    if (writePaths === null) {
      return {
        ...context,
        command: `echo "${blockedMessage}" >&2; exit 1`,
      };
    }
    if (writePaths.length > 0) {
      const allAllowed = writePaths.every((path) => options?.allowWritePath?.(path) === true);
      if (!allAllowed) {
        return {
          ...context,
          command: `echo "${blockedMessage}" >&2; exit 1`,
        };
      }
      return context;
    }

    // Check if command contains any blocked patterns
    for (const pattern of blockedPatterns) {
      if (pattern.test(command)) {
        return {
          ...context,
          command: `echo "${blockedMessage}" >&2; exit 1`,
        };
      }
    }

    return context;
  };
}

function extractSimpleWritePaths(command: string, cwd: string): string[] | null {
  if (/[;&|`$()]/.test(command)) return null;
  const tokens = tokenizeSimpleShell(command);
  if (tokens.length === 0) return [];

  const paths: string[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (token === ">" || token === ">>" || /^&?\d?>&?\d?$/.test(token)) {
      const next = tokens[index + 1];
      if (!next) return null;
      paths.push(resolveSandboxPath(next, cwd));
      index++;
      continue;
    }
    const redirectMatch = /^(?:\d?>|>>)(.+)$/.exec(token);
    if (redirectMatch?.[1]) {
      paths.push(resolveSandboxPath(redirectMatch[1], cwd));
      continue;
    }
  }

  const cmd = tokens[0];
  if (cmd === "mkdir") {
    const targets = tokens.slice(1).filter((token) => !token.startsWith("-"));
    if (targets.length === 0) return null;
    paths.push(...targets.map((target) => resolveSandboxPath(target, cwd)));
  } else if (cmd === "cp" || cmd === "mv") {
    const operands = tokens.slice(1).filter((token) => !token.startsWith("-"));
    if (operands.length < 2) return null;
    paths.push(resolveSandboxPath(operands[operands.length - 1]!, cwd));
  } else if (cmd === "rm") {
    const targets = tokens.slice(1).filter((token) => !token.startsWith("-"));
    if (targets.length === 0) return null;
    paths.push(...targets.map((target) => resolveSandboxPath(target, cwd)));
  } else if (cmd === "tee") {
    const targets = tokens.slice(1).filter((token) => !token.startsWith("-"));
    if (targets.length === 0) return null;
    paths.push(...targets.map((target) => resolveSandboxPath(target, cwd)));
  } else if (cmd === "touch") {
    const targets = tokens.slice(1).filter((token) => !token.startsWith("-"));
    if (targets.length === 0) return null;
    paths.push(...targets.map((target) => resolveSandboxPath(target, cwd)));
  }

  return paths;
}

function tokenizeSimpleShell(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | "\"" | undefined;
  let escaped = false;

  for (let index = 0; index < command.length; index++) {
    const ch = command[index]!;
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      const next = command[index + 1];
      if (!quote && next && (/\s/.test(next) || next === "\"" || next === "'" || next === "\\")) {
        escaped = true;
      } else {
        current += ch;
      }
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = undefined;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === "'" || ch === "\"") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }

  if (current) tokens.push(current);
  return tokens;
}

function resolveSandboxPath(path: string, cwd: string): string {
  return resolve(isAbsolute(path) ? path : join(cwd, path));
}
