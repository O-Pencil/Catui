/**
 * [WHO]: Barrel exports for all run modes (InteractiveMode, runPrintMode, RpcClient, runRpcMode, runAcpMode + types)
 * [FROM]: Depends on interactive/, print/, rpc/, acp/ modes
 * [TO]: Consumed by root index.ts for programmatic SDK usage. NOT on the CLI dispatch path: as of P6/EV02,
 *       main.ts dynamically imports each selected mode runner directly so startup only pays for the chosen
 *       mode. This barrel remains the public SDK surface (do not narrow without Q3/P8).
 * [HERE]: modes/index.ts — public SDK mode surface; the CLI bypasses it via dynamic import (P6/EV02)
 */

export { InteractiveMode, type InteractiveModeOptions } from "./interactive/interactive-mode.js";
export { type PrintModeOptions, runPrintMode } from "./print-mode.js";
export { type ModelInfo, RpcClient, type RpcClientOptions, type RpcEventListener } from "./rpc/rpc-client.js";
export { runRpcMode } from "./rpc/rpc-mode.js";
export { runAcpMode } from "./acp/acp-mode.js";
export { type RemoteModeOptions, runRemoteMode } from "./remote/remote-mode.js";
export type { RpcCommand, RpcResponse, RpcSessionState } from "./rpc/rpc-types.js";
