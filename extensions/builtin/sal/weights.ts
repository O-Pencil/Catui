/**
 * [WHO]: SalWeights interface, SAL_DEFAULT_WEIGHTS, loadSalWeights()
 * [FROM]: Depends on node:fs, node:path
 * [TO]: Consumed by extensions/builtin/sal/anchors.ts and extensions/builtin/sal/index.ts
 * [HERE]: extensions/builtin/sal/weights.ts - tunable scoring weight loader
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface SalWeights {
	// Anchor scoring weights (should sum to ~1.0)
	directFileEvidence: number;
	moduleResponsibilityMatch: number;
	dipContractMatch: number;
	importNeighborhoodMatch: number;
	memoryHistoryMatch: number;
	// Retrieval scoring weights (should sum to ~1.0)
	semanticScore: number;
	recencyScore: number;
	importanceScore: number;
	structuralSalience: number;
	proceduralApplicability: number;
}

export const SAL_DEFAULT_WEIGHTS: SalWeights = {
	directFileEvidence: 0.4,
	moduleResponsibilityMatch: 0.2,
	dipContractMatch: 0.15,
	importNeighborhoodMatch: 0.15,
	memoryHistoryMatch: 0.1,
	semanticScore: 0.25,
	recencyScore: 0.15,
	importanceScore: 0.15,
	structuralSalience: 0.3,
	proceduralApplicability: 0.15,
};

/**
 * Load SalWeights from sal-config.json adjacent to the memory directory or project root.
 * Falls back to defaults if file is missing or invalid. Unknown fields are ignored;
 * missing fields fall back individually to defaults.
 */
export function loadSalWeights(searchDirs: string[]): { weights: SalWeights; source: string } {
	for (const dir of searchDirs) {
		const candidate = join(dir, "sal-config.json");
		if (!existsSync(candidate)) continue;
		try {
			const raw = readFileSync(candidate, "utf-8");
			const parsed = JSON.parse(raw) as Partial<SalWeights>;
			const merged: SalWeights = { ...SAL_DEFAULT_WEIGHTS };
			for (const key of Object.keys(SAL_DEFAULT_WEIGHTS) as Array<keyof SalWeights>) {
				const v = parsed[key];
				if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
					merged[key] = v;
				}
			}
			return { weights: merged, source: candidate };
		} catch {
			// fall through to defaults
		}
	}
	return { weights: { ...SAL_DEFAULT_WEIGHTS }, source: "default" };
}
