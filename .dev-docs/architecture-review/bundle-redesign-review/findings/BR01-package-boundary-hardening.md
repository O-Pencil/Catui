# BR01: Package Boundary Hardening Comes Before Size Work

```yaml
id: BR01
status: selected-first
severity: load-bearing
classification: package boundary
scope:
  - package.json
  - packages/*/package.json
  - core/lib/*/package.json
  - scripts/copy-internal-libs.js
  - npm publish workflow
```

## Problem

The beta.2-beta.6 loop showed that the project can build locally while published installs fail:

- missing public package
- missing host-embedded private package
- package `exports` condition mismatch
- incomplete public package tarball
- public package publish build depending on workspace install state

These are not esbuild problems. They are package boundary problems.

## Deletion Test

If we delete the explicit package-boundary checks, the complexity does not vanish. It reappears as late install/runtime failures on user machines. Therefore the boundary checks are load-bearing.

## Verdict

Selected as the first P7 implementation slice.

## Boundary Rule

```text
packages/* public packages -> npm semver dependency
core/lib/* private libs     -> embedded under host dist/node_modules
```

Do not blur these with ad hoc publish scripts.

## Acceptance

- Fresh install of host beta starts without extension load errors.
- `npm publish --dry-run` confirms embedded private libs include package.json + dist files.
- Public package versions used by host are resolvable by `npm view`.
- `mem-core` publish build is self-contained and its published tarball imports `./extension`.

