# modes/rpc/

> P2 | Parent: ../AGENT.md

Member List
rpc-command-handler.ts: Transport-agnostic RPC protocol core (RpcCommandHandler), command dispatch over all RpcCommand variants, extension UI bridging (ExtensionUIContext + first-response-wins dialogs), session event forwarding, list_sessions via SessionManager.list
rpc-mode.ts: stdio JSON-lines transport over the shared protocol core, readline command loop, re-exports protocol builders for tests and SDK consumers
rpc-client.ts: Programmatic RPC client, spawns Catui subprocess, async event streaming, exposes loop policy updates
rpc-types.ts: RPC protocol type definitions, RpcCommand/RpcResponse/RpcSessionState/RpcSlashCommand/RpcLoopPolicyOptions/RpcSessionListEntry, includes last agent loop result in state

Rule: Members complete, one item per line, parent links valid, precise terms first

[COVENANT]: Update this file header on changes and verify against parent AGENT.md
