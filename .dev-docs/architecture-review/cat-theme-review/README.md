# Cat theme TUI review

Status: design approved before implementation.

## Intent and placement

Apply the reviewed terminal-native preview to startup, composer, message markers,
selectors, tool status, update progress and MCP notices. These are interactive-mode
rendering adaptations: §2b decision 4 selects `modes/interactive/`, with existing
controllers retaining their side effects. No new extension, protocol, dependency,
model call or prompt content is required.

## Decision

- Keep the real Footer, buddy sprites, editor input and update lifecycle owners.
- Render the wordmark from a fixed dot grid; A is the U cat rotated 180 degrees.
- Use ANSI colors and Unicode cells, without browser graphics or terminal image protocols.
- Add a selectable preview-derived theme; existing explicit theme preferences remain valid.
- Keep editor cursor markers, wrapping, multiline input and autocomplete behavior intact.
- Estimated install progress stops at 90%; only successful process exit completes it.
  Dispose its timer on all exit paths. Do not change update approval or restart behavior.
- Use existing MCP-ready events and loading ownership, without inventing server counts.

## Acceptance

Focused rendering/lifecycle tests, all five feature-workflow gates, documentation
isomorphism, terminal smoke and PR self-check. See findings and closure.
