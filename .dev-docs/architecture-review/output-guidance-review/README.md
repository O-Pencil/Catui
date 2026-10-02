# Output guidance review

Status: complete; see [closure](closure.md).

Intent: help users understand and supervise agent work with clear language and
appropriate explanatory artifacts, while shrinking the default system prompt.

Owner: `core/prompt/system-prompt.ts`, the existing shared prompt assembly owner.
This replaces its cross-mode communication policy; it adds no extension, tool,
renderer, provider or independent product workflow. Custom prompt replacement
semantics, persona/context injection and safety boundaries stay unchanged.

Design: consolidate tone and progress guidance; use ASD-STE100-inspired clarity
without claiming formal compliance; choose text, diagrams, HTML or video based
on the explanation, user preference and available tools. Videos are optional and
must not imply unavailable rendering, credentials or paid-service authorization.

Acceptance: default prompt shrinks; preserve injection regression tests and five
repository gates; review text for scope, honest capability claims and terminal
fallbacks. No live model-quality claim will be made.
