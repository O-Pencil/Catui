# Cat theme closure

Status: implemented and accepted locally.

## Delivered

The terminal-native CATUI wordmark uses Braille dot cells; A is the U cat rotated
180 degrees. Startup metadata, the framed composer, standalone reply quote,
completion/status symbols, selector highlights, update notices and MCP notices
now live in their existing interactive-mode owners. The approved palette is
available as the built-in `catui` theme and is the default for dark terminals.
Explicit theme preferences and the default light theme remain supported.

The real Footer and buddy rendering remain authoritative. No public package
exports, protocol contracts, dependencies, model calls or prompts changed.

## Verification and PR self-check

- `verify:dip`: passed; 722/722 complete production P3 headers, 41 P2 modules,
  36 declared extensions matching disk. New presentation members are mapped.
- `verify:quality`: passed; 787 TypeScript files scanned.
- `verify:package-boundary` and `verify:package-boundary:dist`: passed.
- `build` and `tsc --noEmit`: passed.
- `verify:structure`: passed; 39 existing baseline file-size violations remain.
- Focused rendering suite: 18 tests passed. Includes real VirtualTerminal typing
  smoke, narrow/CJK/multiline input and cursor placement, autocomplete placement
  and acceptance, rotated cat geometry, selector widths, unchanged Footer
  context/cache behavior, viewport behavior, loader cleanup and update timing.
- Update progress refresh invalidates the cached chat child. Timers stop on
  completion, failure and shutdown; process error/close events settle once.
  Both npm pipes are consumed. Failed progress stays frozen when rendered later.
- Public API unchanged; token/prompt cost neutral; no reverse imports or new
  service-locator contexts. Presentation helpers stay within interactive mode.
- Dedicated review preceded implementation: `README.md` and
  `findings/UI01-rendering-ownership.md`. `git diff --check` passed.

## Limits and reopen conditions

Update percentages are explicitly estimated, cap at 90 while installing, and
reach 100 only after npm exits successfully. Actual package installation and
restart were not invoked during smoke testing. Existing update approval,
automatic-update policy and restart ownership remain in the controller.

MCP notices use enabled-server configuration and the actual SDK-ready tool count.
The SDK does not expose the preview's individual-server progress; no fabricated
per-server readiness is shown. Use `/mcp status` for detailed live diagnostics.

The output uses standard ANSI colors and Unicode terminal cells. Font glyphs and
the terminal's own background affect rendering; no terminal image protocol or
browser graphics dependency is introduced. Widths below 64 use a compact wordmark.

Reopen for glyph/cursor regression in a supported terminal, changed SDK readiness
events, actual npm byte-progress support, or a second mode requiring these helpers.
