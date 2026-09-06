# Trusted Skill Install Review Closure

**Status:** implemented-gate-blocked

## Implemented

- Value-taking Git clone options no longer shift repository and destination detection.
- Explicit destinations resolve against the tool-call working directory.
- Omitted destinations derive from the repository name below the working directory.
- Git global `-C` and simple leading shell `cd` forms contribute to the effective clone directory.
- External clones into existing trusted skill roots remain strict blocks.
- Ordinary project clones and local relative repository operations retain their prior behavior.

## Boundary Verification

- Implementation remains inside the default `security-audit` extension.
- No public API, protocol type, dependency, model prompt, or trace schema changed.
- The detector uses a focused argument parser and does not claim full shell interpretation.

## Gate Evidence

- `npm run test:security`: passed.
- `npm run verify:quality`: passed.
- `npm run verify:package-boundary`: passed.
- `npx tsc --noEmit`: blocked by pre-existing type errors in `core/harness-eval/agent-fixtures.ts`, modified `main.ts`, and untracked `web/server/ws-bridge.ts`.
- `npm run verify:dip`: blocked by the pre-existing untracked `web/server/index-test.ts`, which lacks a P3 header.
- `npm run build`: blocked by the same pre-existing harness, main, and web type errors.

The review remains gate-blocked until those unrelated workspace changes are completed and the two affected gates are rerun.

## Reopen Conditions

Reopen this review if Catui adds a new trusted skill root, accepts non-Git skill installers, or replaces token-based command inspection with a structured execution plan.
