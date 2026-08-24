# PawBench Safety and Cron Compatibility Design

**Date:** 2026-08-25

**Status:** Approved for implementation planning

## Intent

Improve the Catui/PawBench evaluation path without weakening Catui's product contracts. The work has two independent deliverables:

1. Harden Catui's default security extension against external repository installation into trusted skill directories.
2. Normalize Catui cron trace arguments at the PawBench adapter boundary so the benchmark sees the equivalent fixed Catui delivery semantics.

API rate-limit handling, vision-model configuration, professional MCP integrations, output self-review, skill installation, and persistent Agent creation are outside this scope.

## Evidence and Problem Definition

The PawBench v1.2.20 report combines product defects with benchmark-schema mismatches.

- Catui's `CronCreate` intentionally exposes `cron`, `prompt`, `recurring`, and `durable`, matching its scheduler model. PawBench combination tasks grade OpenClaw-style fields such as `schedule`, `channel`, `target-user`, and `target-session`.
- Catui print-mode cron execution is local to the current console, user, and session. Those fixed semantics can be projected by the PawBench adapter, but Catui must not claim configurable multi-user or multi-session routing that it does not implement.
- The default `security-audit` extension already blocks the simplest `git clone URL ~/skills/name` form in strict mode. Its current positional parser can misread clone options that consume values and does not infer Git's default destination when the target argument is omitted. Those gaps can permit an external repository to land in a trusted skill directory.

## Considered Approaches

### 1. Separate Product and Evaluation Boundaries — Selected

Harden clone detection inside Catui's `security-audit` extension and normalize cron arguments inside PawBench's Catui adapter.

This keeps each decision with its owner: Catui owns execution safety, and PawBench owns grader-facing transcript representation. Both changes can be tested independently without changing Catui's public API or trace schema.

### 2. Emit Benchmark Aliases in Catui Traces

Catui could emit both native tool input and PawBench aliases. This would make downstream extraction easy but would couple a general observability contract to one benchmark and make synthetic fields appear to be original tool arguments.

### 3. Expand `CronCreate` with Delivery Targets

Catui could add channel, user, and session fields to the product tool. A truthful version of that change requires a delivery-routing model that does not currently exist. Adding inert fields would create a false capability; implementing the full routing system is disproportionate to the observed evaluation mismatch.

## Architecture and Ownership

### Catui Product Hardening

The implementation remains in `extensions/builtin/security-audit/`, whose `DangerDetector` is the existing owner of dangerous-command policy. No new core service, public protocol, npm dependency, or default extension is introduced.

Because this changes the behavior of a default extension, implementation must first create the required focused review under:

```text
.dev-docs/architecture-review/trusted-skill-install-review/
  README.md
  findings/SA01-git-clone-target-resolution.md
  closure.md
```

The review records scope, ownership, accepted behavior, verification evidence, and deferred shell-language coverage.

### PawBench Compatibility Projection

The benchmark-only transformation remains in:

```text
/Users/cunyu666/Dev/PawBench/pawbench/agents/impl/catui_agent.py
```

The adapter reads Catui's original trace input and produces grader-facing transcript arguments. It does not modify Catui trace files or feed normalized arguments back into Catui.

The PawBench repository already contains unrelated and uncommitted work, including the untracked Catui adapter. Implementation must modify that file incrementally and must not stage or overwrite unrelated files.

## Catui Clone Detection

The detector will use a focused Git clone argument parser rather than a general shell parser.

The parser will:

- locate a `git clone` invocation in the tokenized command;
- stop at a shell control operator instead of consuming a following command;
- recognize clone options that consume the next token, including common long options and `-b`, `-o`, `-u`, and `-c`;
- recognize inline long-option values such as `--depth=1`;
- identify the repository and optional explicit destination from the remaining positional arguments;
- resolve an explicit destination against the tool-call working directory;
- when the destination is omitted, derive Git's default directory name from the repository URL or path and resolve it under the working directory.

The existing external-repository check remains the trust boundary. A confirmed external repository whose resolved destination is equal to or below a trusted skill root is dangerous and is blocked in the default strict mode.

Trusted roots remain owned by the detector and include the existing global and workspace skill locations. Clone operations into ordinary project directories and local relative repository operations remain allowed unless another existing security rule blocks them.

Unrecognized or malformed commands continue through the existing detector pipeline. The focused parser will not attempt to execute, expand variables, or emulate the complete shell grammar.

## PawBench Cron Normalization

The adapter will introduce a pure `_normalize_tool_arguments(tool_name, arguments)` function that accepts the original Catui tool name and parsed trace input, then returns the grader-facing argument value.

For an original `CronCreate` event with dictionary input, it returns a copied dictionary with this projection:

| Catui/native meaning | PawBench transcript field |
|---|---|
| `cron` | `schedule` |
| `prompt` | `prompt` |
| local print-mode surface | `channel: "console"` |
| current/default Catui user | `target-user: "default"` |
| current/default Catui session | `target-session: "default"` |

Explicit input values take precedence over adapter defaults. The normalization does not mutate the parsed trace object.

`CronDelete`, `CronList`, unknown tools, and non-dictionary inputs pass through unchanged. The existing tool-name mapping from `CronCreate` to `cron` remains separate from argument normalization so create-specific fields are never attached to list or delete operations.

The projection represents fixed semantics only. It must not invent skill-installation calls, Agent creation calls, successful outcomes, or configurable routing that did not occur.

## Data Flow

```text
Catui command
  -> security-audit DangerDetector
  -> allowed tool execution or strict block
  -> Catui native run trace
  -> PawBench Catui adapter
  -> create-only cron argument normalization
  -> PawBench grader transcript
```

Catui's native `CronCreate` schema, scheduler storage, and trace payload remain unchanged.

## Error Handling and Compatibility

- Security parsing failures do not bypass the rest of `DangerDetector`; existing dangerous-pattern checks still run.
- Confirmed external clones into trusted skill destinations are blocked without a confirmation override in default strict mode.
- Adapter inputs with missing fields or unexpected types remain extractable and are passed through when normalization is not safe.
- Explicit grader-compatible fields are preserved.
- No public Catui symbol or package boundary changes.
- No new LLM call, prompt injection, startup provider import, or token cost.

## Test Strategy

All behavioral changes follow red-green-refactor TDD.

### Catui Tests

Extend `test/security-audit.test.ts` with focused cases proving:

1. `git clone --depth 1 <external-url> ~/skills/name` is blocked.
2. `git clone -b main <external-url> ~/.claude/skills/name` is blocked.
3. Running `git clone <external-url>` with a trusted skill directory as `cwd` is blocked after default-target inference.
4. An external clone into an ordinary project directory remains allowed.
5. A local relative repository operation does not become an external-install violation.

Each new test must be observed failing for the intended reason before production code changes.

### PawBench Tests

Add a focused Python test module for the Catui adapter proving:

1. `cron` is projected to `schedule` for `CronCreate`.
2. Fixed console/default delivery fields are added.
3. Explicit compatible values are not overwritten.
4. `CronDelete`, ordinary tools, and non-dictionary values remain unchanged.
5. The input dictionary is not mutated.
6. A synthetic Catui trace produces the expected transcript tool call through `extract_transcript`.

## Acceptance

Catui acceptance requires the target test plus all repository-mandated gates:

```bash
node --test --import tsx test/security-audit.test.ts
npm run verify:dip
npm run verify:quality
npm run verify:package-boundary
npm run build
npx tsc --noEmit
```

PawBench acceptance requires its focused adapter tests and synthetic trace smoke test. A full 150-task benchmark is an effect measurement, not a deterministic completion gate, because it is expensive and model-dependent.

The final report must distinguish:

- structural fixes verified by automated tests;
- expected PawBench cron-score recovery enabled by transcript normalization;
- remaining gaps caused by unavailable skill installation, persistent Agent creation, vision-model configuration, specialist tools, or model output quality.

## Non-Goals and Deferred Work

- API 429 retry classification or concurrency tuning.
- Adding benchmark-specific aliases to Catui's tool API or trace schema.
- Multi-user, multi-session, or arbitrary-channel cron routing.
- Skill marketplace installation or persistent named Agent creation.
- Vision-model setup commands or automatic multimodal model selection.
- A complete POSIX shell parser for security inspection.
- Running or tuning the complete PawBench suite as part of implementation acceptance.
