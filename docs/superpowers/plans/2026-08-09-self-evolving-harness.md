# Self-Evolving Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an opt-in Catui extension that turns bounded session evidence into immutable declarative harness candidates, validates them, promotes versioned revisions atomically, loads only promoted resources, and supports rollback.

**Architecture:** The feature lives entirely in `extensions/optional/evolution/`. Pure schema/state-machine modules define the trust boundary; a filesystem store owns immutable candidates/revisions plus an atomic activation pointer; the extension command orchestrates structured completion, validation, promotion, reload, prompt injection, and rollback without modifying core runtime behavior.

**Tech Stack:** TypeScript strict mode, Node.js filesystem/crypto/path APIs, Catui `ExtensionAPI`, Node test runner with `tsx`.

---

### Task 1: Record the architecture review and module map

**Files:**
- Create: `.dev-docs/architecture-review/self-evolution-review/README.md`
- Create: `.dev-docs/architecture-review/self-evolution-review/findings/SE01-trust-boundary.md`
- Create: `.dev-docs/architecture-review/self-evolution-review/findings/SE02-persistence-and-concurrency.md`
- Create: `.dev-docs/architecture-review/self-evolution-review/closure.md`
- Modify: `extensions/optional/AGENT.md`

- [ ] **Step 1: Write the review decision**

Document that the optional extension is the single owner, only declarative artifacts are executable in v1, candidate content is immutable, `current.json` is the sole mutable pointer, and generated resources live below `<agentDir>/evolution/v1`.

- [ ] **Step 2: Record the two blocking findings**

Use acceptance statements that can be checked mechanically:

```text
SE01: no candidate path is returned by resources_discover and no executable artifact kind exists.
SE02: promotion compares the candidate baseline revision with current.json, writes a complete immutable revision, then atomically renames the pointer.
```

- [ ] **Step 3: Register the extension files in the P2 map**

Add one precise member entry per file to `extensions/optional/AGENT.md`; describe the dependency direction as extension-local modules consuming only `core/extensions-host/types.ts` at the entry point.

- [ ] **Step 4: Run the structural gate and commit**

Run: `npm run verify:dip`

Expected: exit 0.

```bash
git add .dev-docs/architecture-review/self-evolution-review extensions/optional/AGENT.md docs/superpowers/plans/2026-08-09-self-evolving-harness.md
git commit -m "docs(harness): plan self-evolution delivery"
```

### Task 2: Define strict artifact and candidate contracts

**Files:**
- Create: `extensions/optional/evolution/types.ts`
- Create: `extensions/optional/evolution/schema.ts`
- Test: `test/evolution-schema.test.ts`

- [ ] **Step 1: Write failing schema tests**

Cover a valid `prompt_note`, rejection of unknown artifact kinds, non-`evolved:` IDs, executable tool specifications, path-like content, secret-like content, excessive content, and duplicate IDs.

```typescript
assert.equal(validateProposal(validProposal).ok, true);
assert.match(validateProposal({ ...validProposal, artifacts: [{ ...artifact, id: "builtin" }] }).issues[0]!, /evolved:/);
assert.match(validateProposal({ ...validProposal, artifacts: [{ ...artifact, kind: "tool_spec", content: "command: npm install" }] }).issues.join(" "), /executable/i);
```

- [ ] **Step 2: Run the focused test and observe RED**

Run: `node --test --import tsx test/evolution-schema.test.ts`

Expected: FAIL because `extensions/optional/evolution/schema.ts` does not exist.

- [ ] **Step 3: Implement narrow local types**

Define `EvolutionScope`, `ArtifactKind`, `CandidateState`, `EvolutionArtifact`, `EvolutionProposal`, `GateEvidence`, `CandidateRecord`, `RevisionManifest`, `CurrentPointer`, and discriminated validation results. Use this ordered state list:

```typescript
export const CANDIDATE_STATES = [
  "observed", "proposed", "statically_validated", "replay_validated",
  "eval_validated", "awaiting_approval", "promoted", "superseded",
  "rolled_back", "quarantined",
] as const;
```

- [ ] **Step 4: Implement proposal validation**

Enforce schema version 1, known scopes/kinds, namespaced IDs, non-empty applicability and provenance, per-artifact prompt budget, aggregate content limits, collision checks, and declarative-only content. Return all issues without mutating input.

- [ ] **Step 5: Run GREEN and commit**

Run: `node --test --import tsx test/evolution-schema.test.ts`

Expected: all tests pass.

```bash
git add extensions/optional/evolution/types.ts extensions/optional/evolution/schema.ts test/evolution-schema.test.ts
git commit -m "feat(evolution): validate declarative candidates"
```

### Task 3: Add immutable storage and optimistic promotion

**Files:**
- Create: `extensions/optional/evolution/paths.ts`
- Create: `extensions/optional/evolution/store.ts`
- Test: `test/evolution-store.test.ts`

- [ ] **Step 1: Write failing store tests**

Use a temporary agent directory and assert deterministic hashed workspace keys, lazy directory creation, exclusive candidate creation, immutable evidence files, atomic promotion, append-only history, stale-baseline rejection, and rollback to a predecessor.

```typescript
const store = new EvolutionStore({ agentDir, cwd, sessionId: "session-1" });
await store.createCandidate("workspace", candidate);
const first = await store.promote("workspace", candidate.id);
await assert.rejects(() => store.promote("workspace", stale.id), /baseline/i);
const rolledBack = await store.rollback("workspace", first.revisionId);
assert.equal(rolledBack.currentRevisionId, first.previousRevisionId);
```

- [ ] **Step 2: Run the focused test and observe RED**

Run: `node --test --import tsx test/evolution-store.test.ts`

Expected: FAIL because `store.ts` does not exist.

- [ ] **Step 3: Implement safe path resolution**

Resolve session/workspace/global roots below `<agentDir>/evolution/v1`, derive workspace keys from `realpath(cwd)` with SHA-256, reject path escapes, and expose only absolute scope paths.

- [ ] **Step 4: Implement durable store operations**

Use `open(..., "wx", 0o600)` for immutable JSON/evidence creation, temp-file plus `rename` for `current.json`, and append mode for `history.jsonl`. Promotion must re-read `current.json`, compare it with `proposal.baselineRevisionId`, write a content-addressed revision, then swap the pointer.

- [ ] **Step 5: Run GREEN and commit**

Run: `node --test --import tsx test/evolution-store.test.ts`

Expected: all tests pass.

```bash
git add extensions/optional/evolution/paths.ts extensions/optional/evolution/store.ts test/evolution-store.test.ts
git commit -m "feat(evolution): add versioned atomic store"
```

### Task 4: Add state transitions and evidence gates

**Files:**
- Create: `extensions/optional/evolution/workflow.ts`
- Test: `test/evolution-workflow.test.ts`

- [ ] **Step 1: Write failing transition tests**

Assert that states cannot be skipped, any hard safety failure quarantines, replay success alone cannot claim quality, missing outcome scenarios remains awaiting evidence, global promotion requires approval, and workspace/session candidates can promote only after all declared gates pass.

- [ ] **Step 2: Run RED**

Run: `node --test --import tsx test/evolution-workflow.test.ts`

Expected: FAIL because `workflow.ts` does not exist.

- [ ] **Step 3: Implement the pure transition reducer**

Expose `nextCandidateState(record, event)` where events are `static_passed`, `replay_passed`, `eval_passed`, `approval_requested`, `approved`, `promoted`, `failed`, and `superseded`. Reject invalid transitions with a typed error.

- [ ] **Step 4: Implement evidence orchestration**

Static validation produces the first hard gate. Replay evidence must explicitly report lifecycle/tool-pairing/path-policy status. Eval evidence must name at least one scenario matching `expectedOutcome`; otherwise return pending rather than pass. Global scope always returns `awaiting_approval` until an explicit approval event is supplied.

- [ ] **Step 5: Run GREEN and commit**

Run: `node --test --import tsx test/evolution-workflow.test.ts`

Expected: all tests pass.

```bash
git add extensions/optional/evolution/workflow.ts test/evolution-workflow.test.ts
git commit -m "feat(evolution): enforce candidate evidence gates"
```

### Task 5: Deliver the manual refinement and rollback commands

**Files:**
- Create: `extensions/optional/evolution/prompts.ts`
- Create: `extensions/optional/evolution/index.ts`
- Test: `test/evolution-extension.test.ts`

- [ ] **Step 1: Write failing extension tests**

Capture registered handlers and commands. Assert `/refine` uses `completeJson`, bounds/redacts session evidence, writes a candidate before promotion, leaves missing eval evidence pending, accepts `approve <candidate>`, supports `rollback <revision>`, and calls `reload()` only after a pointer changes.

- [ ] **Step 2: Run RED**

Run: `node --test --import tsx test/evolution-extension.test.ts`

Expected: FAIL because the extension entry does not exist.

- [ ] **Step 3: Implement structured proposal generation**

Build the JSON schema and prompts around the five v1 artifact kinds. Serialize only the newest bounded message entries, redact credential/path patterns, include fingerprints instead of raw tool bodies, and make the baseline revision explicit.

- [ ] **Step 4: Implement command orchestration**

Register `refine` with `--scope session|workspace|global`, `status`, `inspect <id>`, `approve <candidate-id>`, `reject <candidate-id> [reason]`, and `rollback <revision-id>`. New proposals stop after static validation unless replay/eval evidence is supplied by the extension's adapters; approval never bypasses hard safety gates.

- [ ] **Step 5: Run GREEN and commit**

Run: `node --test --import tsx test/evolution-extension.test.ts`

Expected: all tests pass.

```bash
git add extensions/optional/evolution/prompts.ts extensions/optional/evolution/index.ts test/evolution-extension.test.ts
git commit -m "feat(evolution): add controlled refine workflow"
```

### Task 6: Load only promoted declarative resources

**Files:**
- Modify: `extensions/optional/evolution/index.ts`
- Test: `test/evolution-extension.test.ts`
- Create: `extensions/optional/evolution/README.md`
- Modify: `.dev-docs/architecture-review/self-evolution-review/closure.md`

- [ ] **Step 1: Add failing resource-consumption tests**

Assert `before_agent_start` appends only promoted `prompt_note` and `memory` content in precedence order; `resources_discover` returns only promoted skill directories; candidates and quarantine are never returned; evolved IDs cannot shadow effective user skills.

- [ ] **Step 2: Run RED**

Run: `node --test --import tsx test/evolution-extension.test.ts`

Expected: FAIL because promoted resources are not consumed.

- [ ] **Step 3: Implement promoted-resource loading**

Read each active manifest defensively. Sort global, workspace, session. Render prompt/memory content within declared budgets and expose promoted skill artifact directories. Ignore invalid or missing pointers and notify only from explicit commands, not lifecycle hooks.

- [ ] **Step 4: Document operation and close the review**

Document opt-in loading, directory layout, command examples, approval policy, inspection, rollback, data retention, and the v1 prohibition on executable generation. Mark SE01/SE02 closed with test evidence and list shadow/guarded automation as deferred.

- [ ] **Step 5: Run focused and full gates**

Run:

```bash
node --test --import tsx test/evolution-schema.test.ts test/evolution-store.test.ts test/evolution-workflow.test.ts test/evolution-extension.test.ts
npm run verify:dip
npm run verify:quality
npm run verify:package-boundary
npm run build
npx tsc --noEmit
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 6: Commit**

```bash
git add extensions/optional/evolution test/evolution-*.test.ts .dev-docs/architecture-review/self-evolution-review extensions/optional/AGENT.md
git commit -m "docs(evolution): document safe operations"
```

### Task 7: Add shadow triggers and guarded policy

**Files:**
- Create: `extensions/optional/evolution/automation.ts`
- Modify: `extensions/optional/evolution/index.ts`
- Test: `test/evolution-automation.test.ts`
- Modify: `extensions/optional/evolution/README.md`

- [ ] **Step 1: Write failing automation tests**

Use an injected clock and proposal callback. Assert `off` and `manual` make zero automatic calls; `shadow` reviews at the configured turn interval and after compaction but never promotes; cooldown and daily token/cost budgets suppress calls; `guarded` may promote session/workspace candidates only after all gates; global remains approval-only.

- [ ] **Step 2: Run RED**

Run: `node --test --import tsx test/evolution-automation.test.ts`

Expected: FAIL because `automation.ts` does not exist.

- [ ] **Step 3: Implement deterministic automation policy**

Persist mode, last review time, daily usage, and trigger fingerprints below `<agentDir>/evolution/v1/automation.json`. Expose pure `shouldReview(trigger, state, policy, now)` and `recordUsage(...)`; default mode is `manual`. Register turn and compaction hooks without blocking shutdown or active tool execution.

- [ ] **Step 4: Add mode control and reporting**

Implement `/refine mode off|manual|shadow|guarded`; `/refine status` reports mode, budget, active revisions, pending candidates, and quarantine counts. Guarded mode invokes the same workflow reducer and store promotion path as manual mode.

- [ ] **Step 5: Run GREEN and commit**

Run: `node --test --import tsx test/evolution-automation.test.ts test/evolution-extension.test.ts`

Expected: all tests pass.

```bash
git add extensions/optional/evolution/automation.ts extensions/optional/evolution/index.ts extensions/optional/evolution/README.md test/evolution-automation.test.ts test/evolution-extension.test.ts
git commit -m "feat(evolution): add budgeted shadow automation"
```

### Task 8: Harden corruption, redaction, and integration boundaries

**Files:**
- Create: `extensions/optional/evolution/redaction.ts`
- Modify: `extensions/optional/evolution/store.ts`
- Modify: `extensions/optional/evolution/index.ts`
- Test: `test/evolution-security.test.ts`
- Modify: `.dev-docs/architecture-review/self-evolution-review/closure.md`

- [ ] **Step 1: Write failing adversarial tests**

Cover symlink escapes, malformed/oversized JSON, invalid hashes, incomplete revisions, corrupt active pointers, malicious messages requesting approval bypass, credential/env/network strings, built-in collisions, permission escalation, and reload failure. Assert the champion remains active and normal hooks return safely.

- [ ] **Step 2: Run RED**

Run: `node --test --import tsx test/evolution-security.test.ts`

Expected: at least the first unimplemented hardening assertion fails.

- [ ] **Step 3: Implement redaction and defensive reads**

Replace secret-like values and absolute home/workspace paths with typed redaction markers before prompt or evidence persistence. Read bounded files without following escaping symlinks; verify manifest and artifact hashes; recover a corrupt pointer from the newest valid promotion history entry or disable the affected scope.

- [ ] **Step 4: Make activation reload transactional**

When `ctx.reload()` fails, atomically restore the predecessor pointer and append a `reload_failed_rollback` history event. Keep mem/soul integration adapter-only: promoted memory/preference facets are injected with provenance through supported context hooks, never written into either package's private storage.

- [ ] **Step 5: Run GREEN and commit**

Run: `node --test --import tsx test/evolution-security.test.ts test/evolution-extension.test.ts test/evolution-store.test.ts`

Expected: all tests pass.

```bash
git add extensions/optional/evolution/redaction.ts extensions/optional/evolution/store.ts extensions/optional/evolution/index.ts test/evolution-security.test.ts .dev-docs/architecture-review/self-evolution-review/closure.md
git commit -m "fix(evolution): harden untrusted artifact boundaries"
```

### Task 9: Review and publish the branch

**Files:**
- Modify only files required by review findings.

- [ ] **Step 1: Review the complete diff against the approved spec**

Check all artifact kinds, scope precedence, immutable candidate/revision rules, hard gates, manual approval, rollback, separate runtime directory, extension ownership, redaction, and no executable generation.

- [ ] **Step 2: Re-run affected tests after review fixes**

Run the focused test command including automation/security plus all five repository gates from Task 6 and `npm run test:harness-eval`.

Expected: every command exits 0.

- [ ] **Step 3: Push and open the linked PR**

```bash
git push -u origin hap-45-self-evolving-harness
gh pr create --title "HAP-45: add controlled harness self-evolution" --body-file ./pr-body.md
```

The PR body must summarize the trust boundary and contain verification evidence. It should link HAP-45 without closing it because later automation stages remain part of the long-lived goal.
