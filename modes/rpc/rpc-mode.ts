/**
 * [WHO]: Provides runRpcMode(), re-exports buildRpcSlashCommands(), buildRpcSessionState(), buildRpcLoopPolicyOptions(), RPC types
 * [FROM]: Depends on node:readline, core/runtime/agent-session, modes/rpc/rpc-command-handler, modes/rpc/rpc-types
 * [TO]: Consumed by modes/index.ts
 * [HERE]: modes/rpc/rpc-mode.ts - stdio JSON-lines transport over the shared RPC protocol core
 */
import * as readline from "readline";
import type { AgentSession } from "../../core/runtime/agent-session.js";
import { RpcCommandHandler, type RpcServerMessage } from "./rpc-command-handler.js";
import type { RpcCommand, RpcExtensionUIResponse, RpcResponse } from "./rpc-types.js";

// Re-export protocol builders and types for consumers (tests, SDK users)
export {
	buildRpcSlashCommands,
	buildRpcSessionState,
	buildRpcLoopPolicyOptions,
	type RpcServerMessage,
} from "./rpc-command-handler.js";

export type {
	RpcCommand,
	RpcExtensionUIRequest,
	RpcExtensionUIResponse,
	RpcResponse,
	RpcSessionState,
	RpcSessionListEntry,
	RpcLoopPolicyOptions,
	RpcSlashCommand,
} from "./rpc-types.js";

/**
 * Run in RPC mode.
 * Listens for JSON commands on stdin, outputs events and responses on stdout.
 */
export async function runRpcMode(session: AgentSession): Promise<never> {
	const output = (obj: RpcServerMessage | object) => {
		console.log(JSON.stringify(obj));
	};

	const handler = new RpcCommandHandler({
		session,
		send: (message) => output(message),
	});
	await handler.bind();

	// Listen for JSON input
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
		terminal: false,
	});

	rl.on("line", async (line: string) => {
		try {
			const parsed = JSON.parse(line);

			// Handle extension UI responses
			if (parsed.type === "extension_ui_response") {
				handler.handleExtensionUIResponse(parsed as RpcExtensionUIResponse);
				return;
			}

			// Handle regular commands
			const command = parsed as RpcCommand;
			const response = await handler.handleCommand(command);
			output(response);

			// Check for deferred shutdown request (idle between commands)
			if (handler.shutdownRequested) {
				await handler.runShutdownHooks();
				rl.close();
				process.exit(0);
			}
		} catch (e: any) {
			output({ id: undefined, type: "response", command: "parse", success: false, error: `Failed to parse command: ${e.message}` } as RpcResponse);
		}
	});

	return new Promise(() => {});
}
