/**
 * [WHO]: Barrel for @pencil-agent/protocol — the stable protocol surface for extensions
 * [FROM]: Re-exports the per-protocol modules (tools + lifecycle + commands today; themes/hooks/permissions in later P3 checkpoints)
 * [TO]: Consumed by third-party extensions, packages/mem-core, packages/soul-core, and the host (adopting these contracts)
 * [HERE]: packages/protocol/src/index.ts - protocol public entry
 *
 * Scope (this round / P3): tools (S1), lifecycle (ExtensionAPI/ExtensionContext/SessionManagerContract, S3),
 * commands, then themes/hooks/permissions. Explicitly NOT here (EVOLUTION-RESERVED): agent-profile,
 * host-adapter, tool-runtime, a2a-bridge, memory/soul providers — see evolution/PARP.md.
 */

export * from "./tools.js";
export * from "./lifecycle.js";
export * from "./commands.js";
