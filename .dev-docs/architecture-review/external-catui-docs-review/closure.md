# Closure

Status: closed — implemented narrow verified fixes.

## Implemented

- Grub malformed `feature-list.json` diagnostics now include parse line,
  column, and nearby line context.
- Grub terminal snapshots now show feature progress and pending feature IDs.
- The default system prompt no longer embeds the hard-coded creator identity.
- Task watcher setup now follows the actual resolved task list directory, and
  `TaskOutput` keeps its zero-argument factory compatibility.
- SSE MCP calls now resolve relative endpoint events and reuse auth headers for
  POST requests.
- `verify-package-boundary --dist` now resolves embedded runtime packages in a
  plain Node subprocess so tsx workspace resolution cannot mask package output.

## Verification

- `node --test --import tsx test/task-output-background.test.ts test/grub-controller.test.ts test/system-prompt-soul.test.ts`
- `npm test --prefix packages/mem-core`
- `npm run verify:dip`
- `npm run verify:quality`
- `npm run verify:package-boundary`
- `npm run build`
- `npx tsc --noEmit`
- `npm run verify:package-boundary:dist`

Reopen this review when:

- NanoMem has a checked-in retrieval evaluation corpus and baseline metrics.
- link-world gains a configurable, user-approved search-provider trust policy.
- a dedicated security review defines secret ownership, subprocess policy, and
  false-positive acceptance criteria.
