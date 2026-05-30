/**
 * [WHO]: Soul extension entrypoint
 * [FROM]: Depends on core/extensions-host/types.js
 * [TO]: Consumed by builtin-extensions.ts as default extension
 * [HERE]: extensions/builtin/soul/index.ts - keeps the built-in Soul entrypoint while delegating prompt injection and evolution to AgentSession
 *
 * Features:
 * - Preserves the built-in Soul extension slot
 * - Avoids creating duplicate SoulManager instances in the extension layer
 * - Leaves stable prompt injection and interaction recording to core/runtime/agent-session.ts
 */

import type { ExtensionAPI } from "../../../core/extensions-host/types.js";

export default async function soulExtension(_pi: ExtensionAPI): Promise<void> {
	// Soul prompt injection and lifecycle updates are centralized in AgentSession.
	// Keeping the extension entrypoint avoids breaking built-in extension discovery
	// while preventing duplicate manager instances and prompt re-injection.
}
