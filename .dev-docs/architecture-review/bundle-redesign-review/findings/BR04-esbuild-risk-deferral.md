# BR04: Esbuild Is A Later Build-System Decision

```yaml
id: BR04
status: reviewed-deferred
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

Current build shape:

```text
npm run build
  -> build:deps
       packages/extension-sdk: tsc
       core/lib/ai: tsc
       core/lib/agent-core: tsc
       core/lib/tui: tsc
  -> host tsc -p tsconfig.build.json
  -> copy-internal-libs
       dist/node_modules/@pencil-agent/{ai,agent-core,tui}
  -> copy runtime assets
```

Current runtime assumptions:

- `@pencil-agent/ai`, `@pencil-agent/agent-core`, and `@pencil-agent/tui` are private internal libs embedded as package-shaped directories under `dist/node_modules`.
- `core/extensions-host/loader.ts` uses static imports, `createRequire()`, `require.resolve()`, jiti aliases, and virtual modules for extension compatibility.
- `builtin-extensions.ts` and several extensions use `__dirname` equivalents to locate sibling assets and extension entry files.
- `main.ts` and provider runtime code use dynamic `import()` to keep mode/provider loading lazy.
- Type declarations are part of the public package surface; esbuild does not generate `.d.ts` by itself.

## Deletion Test

If esbuild is not introduced, the code still works and P7 can still reduce install cost through browser optionalization and metadata chunking. If esbuild is introduced too early, complexity concentrates in package/runtime debugging.

## Verdict

Keep deferred. Esbuild is not the next P7 implementation slice.

The main reason is not that esbuild is bad; it is that its strongest wins require bundling or minification, and those touch exactly the package-resolution and extension-loading contracts that BR01 just stabilized.

## What Esbuild Could Improve

| Benefit | Where it helps | Strength | Notes |
|---------|----------------|----------|-------|
| Faster JS emission | local/release build time | likely high | esbuild transpilation is much faster than `tsc` emit, but declarations still require `tsc --emitDeclarationOnly` or API Extractor |
| Fewer runtime files if bundled | Node startup/module resolution | possible | current `dist` has hundreds of files; fewer files can reduce filesystem/module loader overhead |
| Minified JS size | unpacked package size | possible medium | tarball/gzip savings may be smaller than raw JS savings; must be measured |
| Tree-shaking provider/runtime imports | startup and package size | limited unless package surface changes | root barrels and extension virtual modules intentionally keep compatibility imports |
| Single executable/binary pipeline foundation | future distribution | strategic | only relevant if nanoPencil later ships a bundled binary/app image |

## What Esbuild Does Not Solve

- It does not generate `.d.ts`; TypeScript remains in the build pipeline.
- It does not fix npm package boundary issues; BR01 already owns that.
- It does not automatically remove browser assets; BR02 is an extension UX/package decision.
- It does not safely make model metadata lazy; BR03 owns catalog shape.
- It does not remove runtime dependencies unless they are bundled, and bundling them changes extension/package resolution behavior.

## Build Strategy Options

| Option | Benefit | Risk | Verdict |
|--------|---------|------|---------|
| Keep `tsc` | stable declarations and current dist/package shape | slower build, many JS files | current default |
| esbuild transpile-only + `tsc --emitDeclarationOnly` | faster JS emit while preserving file-per-module shape | dual pipeline complexity, source map/path parity checks | possible later, lowest-risk esbuild slice |
| esbuild bundle host entry only | fewer host files, possibly faster startup | must externalize internal libs/assets/extensions carefully; dynamic import semantics change | defer |
| esbuild bundle host + internal libs | largest runtime file-count reduction | conflicts with BR01 embedded private-lib package strategy and extension aliases | reject for P7 |
| esbuild minify only after tsc | smaller JS with less bundling risk | may harm stack traces; still needs sourcemap/debug policy | possible only with error-reporting review |

## Reopen Conditions

Reopen only after:

- BR01 package boundary smoke is green.
- BR02/BR03 are either done or explicitly rejected.
- there is a concrete size/performance target that previous slices did not meet.
- a capable machine captures baseline measurements:
  - build time for `npm run build`
  - cold `nanopencil -v` startup
  - `npm publish --dry-run --tag beta` tarball/unpacked size
  - extension loading smoke with built-in, optional, user-dir, and npm-package extensions

## If Reopened: Recommended First Slice

Start with the least disruptive variant:

```text
tsc --noEmit                 # typecheck
tsc --emitDeclarationOnly    # declarations
esbuild --format=esm         # JS transpilation, no bundling
```

This targets build speed without changing runtime package topology. Do not start with bundling.

If transpile-only proves stable, then separately review bundling. Bundling must be explicit about externals:

- externalize first-party public packages.
- externalize private embedded libs unless BR01 is redesigned.
- preserve extension entry files and sibling assets.
- preserve provider runtime dynamic imports if startup lazy behavior is still desired.

## Acceptance If Reopened

- declaration output remains correct.
- extension loader dynamic imports and jiti aliases still work.
- public package exports are unchanged unless a separate review accepts changes.
- tarball contents and fresh global install smoke pass.
- stack traces and diagnostics remain usable without source maps in release output.
- `verify:package-boundary:dist` still passes.
- provider runtime lazy loading still loads only on first use.
