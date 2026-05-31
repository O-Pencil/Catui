/**
 * [WHO]: Barrel for @pencil-agent/extension-sdk — the stable protocol surface for extensions
 * [FROM]: Re-exports the per-protocol modules (tools + lifecycle today; themes/hooks/commands/permissions in later P3 checkpoints)
 * [TO]: Consumed by third-party extensions, packages/mem-core, packages/soul-core, and the host (adopting these contracts)
 * [HERE]: packages/extension-sdk/src/index.ts - extension-sdk public entry
 *
 * Scope (this round / P3): tools (S1), lifecycle (ExtensionAPI/ExtensionContext/SessionManagerContract, S3),
 * then themes/hooks/commands/permissions. Explicitly NOT here (EVOLUTION-RESERVED): agent-profile,
 * host-adapter, tool-runtime, a2a-bridge, memory/soul providers — see evolution/PARP.md.
 */

export * from "./tools.js";
export * from "./lifecycle.js";
