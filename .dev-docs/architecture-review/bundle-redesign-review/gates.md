# Bundle Redesign Gates

```yaml
gate_set: bundle-redesign
inherits:
  - ../execution-plan/gates.md#门组-b
  - ../entry-volume-review/gates.md
applies_to:
  - package.json
  - package-lock.json
  - packages/*/package.json
  - core/lib/*/package.json
  - scripts/copy-internal-libs.js
  - scripts/copy-assets.js
  - extensions/builtin/browser
  - core/lib/ai/src/models.generated.ts
```

## Hard Gates

| Gate | Rule | Validation |
|------|------|------------|
| BR-G1 Package boundary | Every first-party package is classified as public npm package or host-embedded private lib | review table in README |
| BR-G2 Publish order | Public packages required by host must be published before host beta | `npm view <pkg>@<version>` on capable/networked machine |
| BR-G3 Embedded lib completeness | `core/lib/{ai,agent-core,tui}` embedded package manifests resolve from `dist/main.js` base | `require.resolve` check from `dist/main.js` base |
| BR-G4 Package contents | `npm publish --dry-run` contains all runtime assets and no accidental source-only dependency | dry-run file list review |
| BR-G5 Runtime install smoke | Fresh global install of beta starts without extension-load errors | `npm i -g @pencil-agent/nano-pencil@beta && nanopencil -v` |
| BR-G6 Public package smoke | `mem-core` published package can import `./extension` and load its transitive relative files | temp install/import smoke |
| BR-G7 Size claim evidence | Any claimed size reduction has before/after tarball and unpacked size metrics | measurement log |
| BR-G8 Token neutrality | P7 cannot alter prompts, request payloads, or token usage unless explicitly scoped | diff review + provider smoke |
| BR-G9 Reversibility | Each P7 slice is independently revertible | commit scope review |

## Low-Performance Machine Policy

Allowed here:

- `rg`, `sed`, `git diff`, `git status`
- documentation edits
- script syntax checks

Requires capable/networked machine:

- `npm install`
- `npm run build`
- `npm publish --dry-run`
- package install smoke
- provider smoke
- size measurements

