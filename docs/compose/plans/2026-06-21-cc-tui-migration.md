# Claude-Code TUI Reuse Migration Plan

> **Status:** Draft plan only. Do not implement directly from this file without first opening the required architecture review.
> **Source candidate:** `/Users/cunyu666/Dev/Claude-Code/src/ink`
> **Target:** Catui `core/lib/tui` plus `modes/interactive`
> **Policy:** License/ownership is user-cleared for this project; prefer reusing Claude-Code TUI source where technically sound.

## Goal

Evaluate and migrate the useful parts of Claude-Code's TUI framework and components into Catui, because Catui's current command-style TUI still has stability and interaction gaps.

The target is still not a blind overwrite. Claude-Code's TUI is a React/Ink-like rendering engine with reconciler, Yoga layout, event dispatch, selection, terminal screen diffing, hooks, and JSX components. Catui's current TUI is a lightweight imperative component model with `render(width): string[]`. The migration should reuse as much Claude-Code TUI code as possible, but every reused file must be adapted to Catui's package boundaries, imports, P2/P3 documentation, tests, and interactive extension contracts.

## Feasibility Conclusion

Technically feasible, and reuse should be the default implementation posture.

Recommended route: vendor a Catui-owned `tui-next` engine from Claude-Code's `src/ink`, trim or replace app-specific imports, then migrate one interactive surface at a time. Avoid replacing `core/lib/tui` in one step.

Direct wholesale overwrite is still not recommended because the APIs are incompatible, but direct source reuse is allowed. The implementation should copy the Claude-Code TUI engine into an isolated Catui module first, then make it compile by removing unrelated Claude-Code application dependencies.

## Current Architecture Read

| Area | Catui today | Claude-Code source |
|------|-------------|--------------------|
| Rendering model | Imperative `Component.render(width): string[]` | React/JSX tree with custom reconciler |
| Layout | Manual line width and component padding | Yoga/Flexbox layout |
| Diffing | Text-line differential renderer in `TUI` | Screen-buffer diff with style/char/hyperlink pools |
| Input | `StdinBuffer`, key parser, Kitty support | `parse-keypress`, terminal events, focus manager |
| Components | `Box`, `Text`, `Editor`, `SelectList`, overlays | `Box`, `Text`, `ScrollBox`, `Button`, hooks, alternate screen |
| Consumption | `modes/interactive` directly owns containers/components | React component tree and context providers |

## Mandatory Process

This change touches load-bearing TUI and interactive mode, so it must follow `.dev-docs/feature-workflow.md`:

- [ ] Create `.dev-docs/architecture-review/cc-tui-migration-review/` before implementation.
- [ ] Document scope, dependency graph, file ownership, and migration strategy in that review.
- [ ] Update P2/P3 docs for every changed TUI or interactive file.
- [ ] Run the required gates before claiming completion:
  - `npm run verify:dip`
  - `npm run verify:quality`
  - `npm run verify:package-boundary`
  - `npm run build`
  - `npx tsc --noEmit`
  - `npm run verify:package-boundary:dist` after build if public/package resolution changes.

## Migration Strategy

Use a reuse-first, bridge-first strategy:

1. Keep legacy `@catui/tui` public exports stable.
2. Copy Claude-Code's `src/ink` engine into an internal experimental module under `core/lib/tui/src/next/` or an equivalent clearly scoped location.
3. Replace Claude-Code app-specific imports with Catui-local shims or minimal implementations.
4. Build adapters so a next-engine subtree can render inside existing `TUI` while legacy interactive components keep working.
5. Migrate low-risk components first, then the main chat transcript and editor.
6. Remove the bridge only after parity tests and interactive smoke tests prove the new engine is stable.

Avoid adding new protocol types unless a type crosses a publish boundary. TUI-local types should stay inside `core/lib/tui`; interactive-only types should stay inside `modes/interactive`.

## Task Plan

### Task 1: Open Architecture Review

**Files:**
- Add `.dev-docs/architecture-review/cc-tui-migration-review/README.md`
- Add `.dev-docs/architecture-review/cc-tui-migration-review/findings/CT01-engine-boundary.md`
- Add `.dev-docs/architecture-review/cc-tui-migration-review/findings/CT02-vendor-policy.md`
- Add `.dev-docs/architecture-review/cc-tui-migration-review/findings/CT03-interactive-migration-slices.md`

- [ ] Record the Catui TUI owner modules: `core/lib/tui`, `modes/interactive`, extension UI hosts.
- [ ] Record Claude-Code source modules to vendor first: `src/ink/layout`, `screen`, `renderer`, `render-node-to-output`, `dom`, `reconciler`, `Box`, `Text`, `Spacer`, `RawAnsi`, input events.
- [ ] Record source policy: license is user-cleared; prefer direct reuse unless a file is app-coupled enough that rewriting is cheaper.
- [ ] Define rollback: default to legacy engine unless explicitly switched during development.

### Task 2: Vendor the Claude-Code TUI Engine Skeleton

**Files likely created:**
- `core/lib/tui/src/next/ink.tsx`
- `core/lib/tui/src/next/dom.ts`
- `core/lib/tui/src/next/reconciler.ts`
- `core/lib/tui/src/next/layout/*`
- `core/lib/tui/src/next/components/*`
- `core/lib/tui/src/next/events/*`
- `core/lib/tui/src/next/termio/*`
- `core/lib/tui/src/next/vendor-notes.md`
- `core/lib/tui/AGENT.md`

- [ ] Copy the minimal connected Claude-Code `src/ink` file set needed to compile a static `Box` + `Text` render.
- [ ] Preserve file-level structure where it reduces merge/adaptation risk.
- [ ] Add Catui P3 headers to copied TypeScript files.
- [ ] Add `vendor-notes.md` with source path, copy date, and adaptation rules.
- [ ] Do not expose `next` from `core/lib/tui/src/index.ts` until the skeleton compiles.

Acceptance: copied files are present, documented, and isolated from production exports.

### Task 3: Replace Claude-Code App-Specific Dependencies

**Files likely touched:**
- `core/lib/tui/src/next/ink.tsx`
- `core/lib/tui/src/next/layout/yoga.ts`
- `core/lib/tui/src/next/reconciler.ts`
- `core/lib/tui/src/next/terminal.ts`
- `core/lib/tui/package.json`
- root `package.json` if workspace dependencies are needed.

- [ ] Replace `src/*` path aliases with relative imports or Catui-local shims.
- [ ] Replace Claude-Code debug/log/bootstrap imports with Catui-neutral no-op or logger shims.
- [ ] Decide Yoga integration: package dependency if available, or keep a minimal layout subset for the first slice.
- [ ] Add only necessary dependencies such as `react` and `react-reconciler`; avoid pulling Claude-Code app dependencies.
- [ ] Run `npm run build:deps` or the narrow package build command to expose missing imports.

Acceptance: `@catui/tui` can type-check the `next` skeleton without changing runtime behavior.

### Task 4: Build a TUI Parity Test Harness

**Files:**
- Add tests under `core/lib/tui/test/next-*` or a similar scoped name.
- Reuse existing virtual terminal helpers where possible.

- [ ] Add deterministic render tests for width clipping, full-width characters, ANSI styles, and cursor placement.
- [ ] Add input tests for bracketed paste, escape ambiguity, Ctrl/Alt/Shift keys, and resize.
- [ ] Add snapshot-style tests for `Box`, `Text`, `ScrollBox`, and footer/status rows.
- [ ] Add a smoke test that renders a minimal chat transcript plus input box.

Acceptance: tests fail against missing `tui-next` behavior before implementation, then pass after each slice.

### Task 5: Introduce the Legacy Adapter

**Files likely touched:**
- `core/lib/tui/src/next/*`
- `core/lib/tui/src/next/legacy-adapter.ts`
- `core/lib/tui/src/index.ts`
- `core/lib/tui/AGENT.md`

- [ ] Reuse Claude-Code's DOM node model and render path where possible.
- [ ] Implement a small Catui `Component` wrapper around a next-engine root.
- [ ] Implement a render-to-lines adapter so next components can be embedded in legacy `Component`.
- [ ] Normalize text measurement to Catui's existing `visibleWidth` behavior or prove the Claude-Code behavior is more correct with tests.
- [ ] Keep exports internal until at least one production surface is migrated.

Acceptance: no change to existing interactive behavior; new tests pass.

### Task 6: Port Foundation Components

**Components:**
- `Box`
- `Text`
- `Spacer`
- `RawAnsi` or equivalent
- `ScrollBox`
- `Button` only if needed by overlays

- [ ] Reuse Claude-Code component source directly, changing only imports and Catui-required headers.
- [ ] Keep Claude-Code prop names internally to reduce porting drift; add Catui wrapper props only when legacy callers need them.
- [ ] Preserve Catui theme/color ownership in `modes/interactive/theme`.
- [ ] Avoid importing app-specific Claude-Code dependencies.
- [ ] Add P3 headers to all new files.

Acceptance: foundation components render correctly in isolation and through the legacy adapter.

### Task 7: Migrate One Low-Risk Interactive Surface

Recommended first surface: footer/status row or a simple selector overlay.

**Files likely touched:**
- `modes/interactive/components/footer.ts` or one selector component
- `modes/interactive/AGENT.md`

- [ ] Wrap the migrated component with the legacy adapter.
- [ ] Keep the existing component API stable for `InteractiveMode`.
- [ ] Verify no regression in extension widgets or prompt host overlays.

Acceptance: one real interactive surface uses `tui-next`, with all existing tests passing.

### Task 8: Migrate Transcript Rendering

**Files likely touched:**
- `modes/interactive/components/assistant-message.ts`
- `modes/interactive/components/user-message.ts`
- `modes/interactive/components/tool-execution.ts`
- `modes/interactive/components/bash-execution.ts`
- `modes/interactive/controllers/stream-render-controller.ts`

- [ ] Move message layout to next components while preserving message content semantics.
- [ ] Preserve cached rendering or replace it with measured screen diffing backed by tests.
- [ ] Prove streaming output does not flicker, overwrite input, or leak stale lines.
- [ ] Keep tool execution collapse/expand behavior stable.

Acceptance: transcript smoke test passes for streaming assistant text, tool calls, bash output, and compaction messages.

### Task 9: Migrate Editor and Focus

This is the riskiest slice and should happen after transcript stability.

**Files likely touched:**
- `core/lib/tui/src/components/editor.ts`
- `modes/interactive/components/custom-editor.ts`
- `modes/interactive/controllers/interrupt-controller.ts`
- `modes/interactive/controllers/input-submit-controller.ts`

- [ ] Decide whether to keep Catui's current editor logic and only replace layout, or port Claude-Code-style focus/hooks.
- [ ] Preserve slash autocomplete, file/image attachments, custom editor components, keybindings, and IME cursor placement.
- [ ] Add regression tests for multi-line submit, bracketed paste, completion selection, and Escape/Ctrl-C behavior.

Acceptance: typing, autocomplete, submit, interrupt, and focus restore work under both simple and overlay states.

### Task 10: Switch Default and Remove Bridge Debt

- [ ] Make the next engine default only after footer, transcript, and editor pass parity.
- [ ] Remove temporary env switches or clearly document them as developer-only.
- [ ] Delete dead legacy paths only after P2 maps and tests prove no consumers remain.
- [ ] Update `docs/cc-tui-design.md` with final implementation reality.

Acceptance: legacy engine is either still supported intentionally or fully removed with P2/P3 updates.

## Dependency Risks

- `react`, `react-reconciler`, and Yoga introduce runtime weight and build complexity.
- Claude-Code imports internal aliases like `src/bootstrap/state.js` and native Yoga bindings; those cannot be copied as-is.
- License/ownership is user-cleared, so it is not a blocker; still record provenance so future maintainers know which files came from Claude-Code.
- Interactive mode has many extension UI ports. A renderer replacement can break third-party extension surfaces even if core chat still works.

## Recommended First Implementation Slice

Do not start with the editor. Start with:

1. Architecture review and source policy.
2. Vendored `tui-next` skeleton from Claude-Code `src/ink`.
3. App-specific import cleanup and Catui shims.
4. `Box` + `Text` + `Spacer` through a render-to-lines adapter.
5. Footer/status row migration.

That proves layout/render integration without touching the most fragile input path.

## Completion Criteria

The migration is complete only when:

- Catui can run interactive mode with the new TUI engine by default.
- Legacy engine compatibility debt is either removed or documented as intentional.
- Extension UI prompts, overlays, custom editor, images, slash completions, and streaming tool output still work.
- Required verification gates pass.
- `.dev-docs/architecture-review/cc-tui-migration-review/closure.md` records final decisions, unresolved risks, and rollback status.
