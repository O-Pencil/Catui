# EG01 - Replay Safety Is Not Effectiveness Evidence

## Evidence

- The current harness report contains pass rate, replay divergences, policy violations, and unpaired calls, but no real-task cost, latency, frozen-model identity, or held-out comparison.
- `promoteEvolutionCandidate()` requires a passing gate only for `executable_tool`; prompt, memory, skill, subagent, tool, and workflow artifacts can activate without candidate-specific real-task evidence.
- PawBench already provides 150 real tasks and Catui results, but the local optimization workflow uses best-of-three reruns, which biases promotion and cannot establish statistical significance.

## Decision

Introduce a paired snapshot/report boundary. Trusted benchmark infrastructure runs the champion and candidate under identical conditions. Catui validates, compares, hashes, and consumes only the resulting evidence. Promotion remains inactive on missing, mismatched, unsafe, statistically inconclusive, or operationally regressive evidence.

## Reopen Conditions

- The benchmark must support non-binary primary outcomes.
- Costs or latency are unavailable for a required provider.
- A trusted report-signing service replaces local content hashes.
- Online canary evidence becomes a co-authority for promotion.
