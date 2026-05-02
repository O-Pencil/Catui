/**
 * [WHO]: BashTool, bashTool, createBashTool, BashToolInput, BashToolDetails
 * [FROM]: Depends on agent-core, node:fs, node:path, node:os, node:child_process
 * [TO]: Consumed by core/tools/index.ts
 * [HERE]: core/tools/bash.ts - shell command execution boundary; consumed by orchestrator
 */
import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { AgentTool } from "@pencil-agent/agent-core";
import { type Static, Type } from "@sinclair/typebox";
import { spawn } from "child_process";
import { getShellConfig, getShellEnv, killProcessTree } from "../utils/shell.js";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, type TruncationResult, truncateTail } from "./truncate.js";

/**
 * Generate a unique temp file path for bash output
 */
function getTempFilePath(): string {
	const id = randomBytes(8).toString("hex");
	return join(tmpdir(), `nanopencil-bash-${id}.log`);
}

const bashSchema = Type.Object({
	command: Type.String({ description: "Bash command to execute" }),
	timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional, no default timeout)" })),
});

export type BashToolInput = Static<typeof bashSchema>;

export interface BashToolDetails {
	truncation?: TruncationResult;
	fullOutputPath?: string;
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
			env?: NodeJS.ProcessEnv;
		},
	) => Promise<{ exitCode: number | null }>;
}

/**
 * Default bash operations using local shell
 */
const defaultBashOperations: BashOperations = {
	exec: (command, cwd, { onData, signal, timeout, env }) => {
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
				stdio: ["ignore", "pipe", "pipe"],
			});

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
				if (signal) signal.removeEventListener("abort", onAbort);
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
				if (signal) signal.removeEventListener("abort", onAbort);

				if (signal?.aborted) {
					reject(new Error("aborted"));
					return;
				}

				if (timedOut) {
					reject(new Error(`timeout:${timeout}`));
					return;
				}

				resolve({ exitCode: code });
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
}

export function createBashTool(cwd: string, options?: BashToolOptions): AgentTool<typeof bashSchema> {
	const ops = options?.operations ?? defaultBashOperations;
	const commandPrefix = options?.commandPrefix;
	const spawnHook = options?.spawnHook;

	return {
		name: "bash",
		label: "bash",
		description: `Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds.`,
		parameters: bashSchema,
		execute: async (
			_toolCallId: string,
			{ command, timeout }: { command: string; timeout?: number },
			signal?: AbortSignal,
			onUpdate?,
		) => {
			// Apply command prefix if configured (e.g., "shopt -s expand_aliases" for alias support)
			const resolvedCommand = commandPrefix ? `${commandPrefix}\n${command}` : command;
			const spawnContext = resolveSpawnContext(resolvedCommand, cwd, spawnHook);

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
					timeout,
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
