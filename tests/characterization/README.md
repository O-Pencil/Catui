# Characterization Harness — Behavior Baseline (the behavioral half of "feature-preserved" proof)

> Recorded on the **pre-refactor** trunk (`main`); replayed and compared on the refactor branch. Combined with the public-symbol table (the structural half, see `scripts/collect-baseline.ts`), it forms the two-sided evidence that "feature behavior is preserved."

## Purpose

The refactor (Candidate D / two big phases) makes a core promise: "feature behavior is preserved." The symbol table can prove **the outward shape didn't change**, but refactoring inside a function may **quietly change behavior** even when symbols don't move. This harness uses **characterization (behavior-pinning) tests** to nail down "current behavior":

- **Fixed input → actual Agent output** is recorded byte-for-byte as a golden file.
- After the refactor, replay the same input and diff against gold; **any difference = regression** (or, for phase-2, an **explicitly declared** intentional change, GB-2).
- It will pin **current bugs along with the rest** — this is exactly what behavior-preserving refactor needs: phase 1 forbids even bug changes; phase 2 requires any change to be explicitly declared.

**Why we use print mode**: print mode is "the same core engine, minus TUI non-determinism." It directly covers P4 (runtime split), and also covers most of P5's core-call risk surface. UI-specific flows (controller / overlay / keybinding) are invisible to print → for those, add local snapshots during P5.

## How determinism is solved (key point)

Agent output depends on an LLM (non-deterministic, costs money, needs network). This harness **never calls a real model in CI**. It reuses a mechanism already proven in the repo — **override `global.fetch`** (see `packages/ai/test/openai-codex-stream.test.ts` etc.) — implemented as **record-once / replay (VCR)**:

| Mode | Behavior |
|------|----------|
| **record** (`RECORD=1`, run once on `main`) | Wraps the real `fetch`, stores the **raw SSE bytes** of every model call in order into `cases/<name>/cassette.json`, and writes the golden at the same time |
| **replay** (default, CI / refactor branches) | `fetch` is replaced: the Nth model-host call replays the Nth cassette entry verbatim; any other host returns 404 (telemetry auto-noops in the sandbox with no credentials) |

Byte-level recording → replay is deterministic, **no need to hand-write SSE**, and provider-protocol details don't matter (we're recording real responses).

## Layout

```
tests/characterization/
├── harness/
│   ├── fetch-cassette.ts   # record/replay global.fetch (in-order, raw bytes)
│   ├── normalize.ts        # wash easy-variables before diff (timestamps / durations / absolute paths / ANSI / uuid)
│   └── run-case.ts         # build session (fake model) + runPrintMode + capture stdout
├── cases/<name>/
│   ├── case.json           # { provider, model, input, workspace?, baseUrl?, api? }
│   ├── cassette.json       # recording artifact (RECORD generates)
│   └── workspace/          # sandbox seed files (make read/edit/bash output stable)
├── __golden__/<name>.txt   # normalized golden stdout
├── characterization.test.ts# vitest: per-case replay + golden comparison
└── vitest.config.ts
```

## Workflow

```bash
# ① On main (pre-refactor) record the golden + cassette — requires a working real-model provider on your machine
RECORD=1 OPENAI_API_KEY=sk-... npx vitest run --config tests/characterization/vitest.config.ts
git add tests/characterization/cases/*/cassette.json tests/characterization/__golden__
git commit -m "test(characterization): record pre-refactor golden baseline"

# ② Bring the harness + golden + cassette onto the refactor branch and replay (zero network)
npx vitest run --config tests/characterization/vitest.config.ts
#   All green = behavior preserved; red = regression (or, for phase-2, intentional change — --update gold + leave a reason)
```

**OpenAI-compatible third-party endpoints** (models not in the static registry): add `baseUrl` to `case.json` (plus optional `api`, defaults to `openai-completions`); `run-case.ts buildModel()` synthesizes a `Model` directly when it sees `baseUrl`. The key is still resolved by `provider` (no generic `${PROVIDER}_API_KEY` fallback) — for `provider:"openai"`, put that endpoint's key into `OPENAI_API_KEY`. Example:

```json
{ "provider": "openai", "model": "mimo-v2.5-pro",
  "baseUrl": "https://token-plan-cn.xiaomimimo.com/v1", "api": "openai-completions",
  "input": "..." }
```

Replay prerequisites:

- Every `cases/<name>/` must already have `cassette.json`.
- `tests/characterization/__golden__/<name>.txt` must already exist.
- If the cassette is missing, the test fast-fails with a hint to run `RECORD=1` on `main` first, and never enters the model loop.

## Which gates this feeds

| Gate | Use |
|------|-----|
| **GA-2 / GA-3** (phase-1 behavior preserved) | After P1 mechanical move, replay must be all green (mechanical moves don't change behavior) |
| **GB-2** (phase-2 per-domain) | That domain's replay is all green, unless the review explicitly declares an intentional change (`--update` + reason) |
| **V5-1** (P5 zero regression) | Print goldens cover core; UI-specific flows supplemented with local snapshots |

## ⚠️ Status

This harness **cannot be run/verified in the restricted sandbox** (tsx/vitest cold-start takes several minutes, performance is insufficient). The code is written against the real interfaces I've read (`createAgentSession` / `runPrintMode` / fetch-override); **you need to run `RECORD=1` once on your dev machine to lock it down**. The top of `run-case.ts` lists the 2 assumptions you need to confirm (apiKey env injection, `createAgentSession` option names).
