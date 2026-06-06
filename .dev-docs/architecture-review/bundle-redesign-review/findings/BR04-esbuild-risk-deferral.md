# BR04: Esbuild Is A Later Build-System Decision

```yaml
id: BR04
status: deferred
severity: structural
classification: build pipeline
scope:
  - package build scripts
  - tsconfig.build.json
  - package files
  - dist layout
```

## Problem

Esbuild could reduce emitted code size, but it also changes module resolution, package `exports`, side-effect ordering, source maps, declaration generation, and extension loading assumptions.

The recent beta loop shows the current risk is not "too many bytes" first; it is "published package contents and resolution are not boring yet."

## Deletion Test

If esbuild is not introduced, the code still works and P7 can still reduce install cost through browser optionalization and metadata chunking. If esbuild is introduced too early, complexity concentrates in package/runtime debugging.

## Verdict

Deferred. Reopen only after:

- BR01 package boundary smoke is green.
- BR02/BR03 are either done or explicitly rejected.
- there is a concrete size/performance target that previous slices did not meet.

## Acceptance If Reopened

- declaration output remains correct.
- extension loader dynamic imports and jiti aliases still work.
- public package exports are unchanged unless a separate review accepts changes.
- tarball contents and fresh global install smoke pass.

