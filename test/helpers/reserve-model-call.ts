/**
 * [WHO]: One-shot helper that reserves a model-call budget and prints the outcome as JSON
 * [FROM]: Depends on node fs/path and the evolution budget module by relative path
 * [TO]: Consumed by test/evolution-concurrent-budget.test.ts as a real second process
 * [HERE]: test/helpers/reserve-model-call.ts - child process for cross-process budget tests
 *
 * Exists because an in-process assertion cannot demonstrate anything about a lock that exists to
 * work between processes. The test spawns several of these at once and checks the invariant that
 * survives nondeterminism: the ledger never records more calls than the cap allows.
 *
 * Prints one JSON line and nothing else, so the parent never has to parse a stack trace.
 */

import { DEFAULT_EVOLUTION_BUDGET, reserveEvolutionModelCall } from "../../extensions/optional/evolution/evolution-budget.js";
import type { EvolutionBudgetPolicy } from "../../extensions/optional/evolution/evolution-budget.js";

const [agentDir, rawPolicy] = process.argv.slice(2);
if (!agentDir || !rawPolicy) {
	process.stdout.write(`${JSON.stringify({ reserved: false, reason: "bad_args" })}\n`);
	process.exit(2);
}

const overrides = JSON.parse(rawPolicy) as Partial<EvolutionBudgetPolicy>;
const policy: Readonly<EvolutionBudgetPolicy> = { ...DEFAULT_EVOLUTION_BUDGET, ...overrides };

try {
	const result = reserveEvolutionModelCall(agentDir, policy);
	process.stdout.write(`${JSON.stringify({ reserved: result.reserved, reason: result.reserved ? undefined : result.reason, calls: result.reserved ? result.calls : undefined, message: result.reserved ? undefined : result.message })}\n`);
} catch (error) {
	process.stdout.write(`${JSON.stringify({ reserved: false, reason: "threw", message: error instanceof Error ? error.message : String(error) })}\n`);
	process.exit(1);
}
