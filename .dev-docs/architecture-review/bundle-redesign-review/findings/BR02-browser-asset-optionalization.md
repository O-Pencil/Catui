# BR02: Browser Assets Are The Largest Real Install-Size Lever

```yaml
id: BR02
status: selected-after-BR01
severity: structural
classification: optional capability
scope:
  - extensions/builtin/browser
  - scripts/copy-assets.js
  - package.json files
  - browser opt-in UX
```

## Problem

P6 made browser registration optional, but the physical browser harness assets still ship with the host package. That means non-browser users no longer pay startup registration cost, but still pay install/download size.

## Deletion Test

If browser assets are removed from the host tarball without a replacement opt-in path, the complexity concentrates in users: browser commands break. If removed behind a clear optional package/lazy extraction path, the default install-size cost vanishes while browser users still have an explicit path.

## Verdict

Selected after BR01. This is likely the highest-leverage P7 size slice.

## Options

| Option | Benefit | Cost/Risk |
|--------|---------|-----------|
| independent `@pencil-agent/browser-harness` package | host tarball shrinks; browser updates decouple | new public package + publish order |
| lazy extract/download on first use | host install shrinks if asset not shipped | network/runtime installer complexity |
| keep shipped but optional registration | already landed behavior; no further package risk | no install-size reduction |

## Recommendation

Prefer independent optional package only after BR01 is stable. Keep the lightweight `/browser` fallback as the user-facing entry.

## Acceptance

- `nanopencil` normal startup works without browser package.
- `/browser` gives clear opt-in/install guidance.
- explicit browser opt-in still loads full tools.
- dry-run package contents show browser assets moved out of host if size reduction is claimed.

