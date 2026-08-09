/**
 * [WHO]: Public extensions subpath exports for SDK embedders that need to register optional built-in extensions
 * [FROM]: Depends on extensions/optional/evolution/* factory modules and their stable type surface
 * [TO]: Consumed by advanced SDK users importing @catui/agent/extensions
 * [HERE]: extensions.ts - package subpath entry that exposes optional extension factories without leaking implementation paths
 *
 * Design note: This subpath is intentionally narrow. CLI and SDK share the same
 * `additionalExtensionPaths` mechanism on `createAgentSession`. CLI users get
 * extension paths through settings/defaults; SDK users get them through this
 * subpath. Both paths converge on the same extension loader; no parallel CLI
 * surface exists.
 */

import evolutionExtensionDefault from "./extensions/optional/evolution/index.js";

export const evolutionExtension = evolutionExtensionDefault;
export { createEvolutionRefineTool } from "./extensions/optional/evolution/evolution-refine-tool.js";
export { createEvolvedTool } from "./extensions/optional/evolution/evolution-tool.js";
export { EvolutionAutoObserver } from "./extensions/optional/evolution/evolution-auto.js";
export { buildEvolutionPromptAppend } from "./extensions/optional/evolution/evolution-format.js";

export type { EvolutionRefineToolOptions } from "./extensions/optional/evolution/evolution-refine-tool.js";

export type {
	EvolutionScope,
	EvolutionArtifactKind,
	EvolutionArtifact,
	EvolutionCandidate,
	EvolutionCandidateInput,
	EvolutionRevision,
	EvolutionCurrent,
	EvolutionGateReport,
	EvolutionPrediction,
	EvolutionAttribution,
	EvolutionActiveFixtures,
	EvolutionInspection,
	EvolutionScopeSelector,
	EvolutionValidationReport,
} from "./extensions/optional/evolution/evolution-types.js";