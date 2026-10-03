/**
 * [WHO]: Prints the resolved built-in extension registry and per-extension bootstrap prompt length
 * [FROM]: Depends on builtin-extensions and the five measured passive/skill extension modules
 * [TO]: Consumed by simplification-learning-review closure evidence and prompt-budget checks
 * [HERE]: scripts/dev-loop/bootstrap-length-probe.ts - measurement probe, no side effects
 */

import { builtInExtensions, getBuiltinExtensionPaths } from "../../builtin-extensions.js";
import { CATAIL_BOOTSTRAP_PROMPT } from "../../extensions/builtin/catail/index.js";
import { HUMANIZER_BOOTSTRAP_PROMPT } from "../../extensions/builtin/humanizer/index.js";
import { DECISION_GUIDANCE } from "../../extensions/builtin/typesafe/index.js";

type MeasuredBootstrap = { id: string; chars: number };

async function bootstrapFromExtension(id: string, modulePath: string): Promise<MeasuredBootstrap> {
	let prompt = "";
	const api = {
		on: (event: string, handler: () => { appendSystemPrompt?: string } | undefined) => {
			if (event !== "before_agent_start") return;
			prompt = handler()?.appendSystemPrompt ?? "";
		},
	};
	const module = await import(modulePath) as { default: (api: unknown) => Promise<void> | void };
	await module.default(api);
	return { id, chars: prompt.length };
}

const measured: MeasuredBootstrap[] = [
	{ id: "typesafe", chars: DECISION_GUIDANCE.length },
	await bootstrapFromExtension("discipline", "../../extensions/builtin/discipline/index.js"),
	await bootstrapFromExtension("catpaw", "../../extensions/builtin/catpaw/index.js"),
	{ id: "humanizer", chars: HUMANIZER_BOOTSTRAP_PROMPT.length },
	{ id: "catail", chars: CATAIL_BOOTSTRAP_PROMPT.length },
];

const paths = getBuiltinExtensionPaths();

console.log(`descriptors: ${builtInExtensions.length}`);
console.log(`defaultEnabled: ${builtInExtensions.filter((entry) => entry.defaultEnabled).length}`);
console.log(`paths: ${paths.length}`);
console.log(`uniquePaths: ${new Set(paths).size}`);
console.log(`duplicatePaths: ${JSON.stringify(paths.filter((entry, index) => paths.indexOf(entry) !== index))}`);
console.log("");
for (const entry of measured) {
	console.log(`${entry.id}: ${entry.chars}`);
}
console.log(`total: ${measured.reduce((sum, entry) => sum + entry.chars, 0)}`);
