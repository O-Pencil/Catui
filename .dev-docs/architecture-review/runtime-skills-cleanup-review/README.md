# Runtime, skills, and repository cleanup review

Status: implemented and locally verified; see [closure.md](closure.md).

## Intent and ownership

Keep AgentSession's public facade while moving cohesive state and algorithms to
runtime owners. Suspend NanoSoul throughout the default application; persona is
the supported identity mechanism. Ship the MIT TypeSafe skill and a bounded,
provider-independent decision/tool/evaluation guide as a default extension.
Remove demonstrably obsolete assets and rewrite both READMEs from current code.

Runtime primitives belong in `core/runtime/`; skill behavior belongs in
`extensions/builtin/`. No new public protocol or reverse dependency is needed.
Controllers receive named capabilities, never the entire AgentSession.

## Decisions

- Extract trace lifecycle, message queues, session queries, and extension resource
  discovery with one state owner each. Preserve message persistence ordering,
  retry/compaction ordering, queue display semantics, and public facade exports.
- Remove automatic Soul creation, prompt injection, learning, and presence
  fallback loading. Keep deprecated public compatibility fields inert while
  removing Soul from application dependencies and build artifacts where feasible.
  Do not delete user persona, memory, or historical Soul data.
- Vendor TypeSafe at a recorded revision with its license. Its service-specific
  skill remains on-demand; a small default instruction covers general decisions,
  evidence-based tool selection, outcome checks, and bounded recovery. No implicit
  TypeSafe network calls or additional model calls.
- Delete only inspected obsolete code/assets. Preserve architecture decisions,
  tests for active behavior, licenses, and operational documentation.

## Acceptance

Run DIP, quality, package boundary, build, and TypeScript gates; focused runtime,
persona, skill discovery/default-loading, packaging, and CLI regression tests.
Review public API compatibility and prompt overhead. Deliver via a PR, without
merging or releasing. Record actual results and remaining limits in closure.md.

See [findings/RC01-boundaries.md](findings/RC01-boundaries.md).
