# UI01 — Preserve interaction owners while changing presentation

The HTML preview contained several proposed render overrides. Copying its strings
would lose editor cursor and autocomplete behavior and Footer width rules.

Decision: adapt the existing mode components, leave Footer and buddy layout logic
unchanged, and use a small mode-owned startup renderer and update progress component.
The update controller owns spawning and cleanup; progress is explicitly estimated.
MCP success uses the existing real tool count. Settings/model selection remains with
their current selector owners. Narrow rendering helpers stay inside this mode.

Risk: box borders reduce text width. Acceptance must cover cursor placement,
multiline wrapping, autocomplete and narrow terminals, plus update timer cleanup.
