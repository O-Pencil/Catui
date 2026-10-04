# Dev Conventions — Post-refactor development discipline (Evolution Group · Skeleton)

```yaml
group: evolution
status: skeleton
purpose: |
  Codify the boundaries and discipline crystallized by the Candidate-D refactor into long-lived development
  conventions, so "maintainable + extensible" stays enforced in everyday development instead of regressing
  after a one-off achievement.
based_on:
  - ../target-architecture.md   # Candidate-D target-state boundaries
  - ./PARP.md                    # seam and growth-surface discipline
audience: pencil maintainer · future contributors · arch agent
```

> **Document role**: maintain the long-lived development conventions after the refactor. Couples with F08 (quality-rule executability) — F08 is the CI gate's implementation; this document is the "why + how" of the conventions.

---

## 1. Top-level directory placement criteria (where does new code go)

| Where to put it | Criterion | Anti-example (do NOT put here) |
|-----------------|-----------|---------------------------------|
| `core/<domain>/` | nano-pencil business core | cross-cutting primitives (→ platform); publishable libraries (→ packages) |
| `core/lib/<lib>/` | Internal library, **currently 0 outside consumers**, not published | Has outside consumers (→ packages) |
| `core/platform/` | Cross-cutting primitive, **no business knowledge** | Contains business logic |
| `packages/<pkg>/` | **Independently publishable identity** (has outside consumers OR maintainer has a clear publishing strategy) | Internal lib with 0 consumers (→ core/lib) |
| `extensions/{builtin,optional}/` | First-party / opt-in capability implementations | Stable third-party protocol types (→ protocol) |

> **Entry ticket to `packages/`** (grilling resolution): independently publishable identity is the only entry ticket. First-party packages entering `packages/` must be maintained as real npm packages; if not yet published, publish that package first and have the host depend on the public version. Don't use scripts to temporarily strip or rewrite dependencies during the publish phase to hide an unpublished state.

## 2. Dependency direction (one-way; CI-gated)

```
modes/ ──► core/ ──► core/platform/         (platform does not depend on business; reverse is forbidden)
core/ ──► core/lib/                          (lib does not reverse-depend on business)
packages/mem-core, soul-core ──► packages/protocol   (forbidden to reverse-import host; fix U3)
extensions/ ──► packages/protocol            (extensions depend only on stable protocols, not host internals)
```

## 3. Protocol growth-surface discipline (prevent a second PARP refactor)

> **Rename** (resolution 2026-06-12, landed with Phase B / P8): `@pencil-agent/extension-sdk` → **`@pencil-agent/protocol`**.
> Reason: it doesn't only serve "extensions" — mem-core / soul-core also implement its contracts; it is **the entire Agent capability protocol** (tool / lifecycle / memory / soul / agent-profile / ...). It is the counterpart to ACP (`@agentclientprotocol/sdk`) as a protocol framework; it is **pure type contracts**, not a runtime SDK. First-party + pre-2.0, so the rename is safe. Below, `protocol` refers to this package.

- **`packages/protocol/` is the only additive-only protocol growth surface**: all future PARP protocol types (agent-profile / host-adapter / tool-runtime / a2a-bridge / memory-* / soul-* / cognitive-*) only go into protocol.
- **Host `index.ts` never grows protocol types**: after one-time narrowing, the host exposes only stable SDK surface.
- **Protocols prefer re-exporting industry standards**: `host-adapter.ts ← @agentclientprotocol/sdk` (ACP); `tool-runtime.ts ← MCP`; `a2a-bridge.ts ← A2A` (placeholder). **When a wire standard exists, depend on and re-export it; don't reinvent.** When a domain adopts a wire standard, only then does protocol add the corresponding dependency (e.g. when host-adapter lands, protocol depends on ACP; for now ACP is only used on the implementation side in `modes/acp/`). Only Continuity and Agent Profile schemas are pencil-defined.
- **One file per protocol domain** (mirroring ACP's acp/jsonrpc/stream split): `tools.ts` / `lifecycle.ts` / `host-adapter.ts` / `tool-runtime.ts` / `memory-store.ts` / `soul-facet.ts` / `agent-profile.ts` / `a2a-bridge.ts`. Zero/minimal deps, pure types, counterpart schema where a wire standard exists.

## 3b. Type / protocol placement convention (everyday-development iron rule)

> Answers two high-frequency questions: **where should this type go? how do I find what already exists so I don't redefine it?**

**Bright line — what counts as a "public protocol"**:
> A type becomes a public protocol (lands in `packages/protocol/`) **if and only if an [already-published package (mem/soul) or an external extension author] needs it** — i.e. **it has crossed the publish boundary**. Being used by multiple files inside the host is NOT a protocol (that's just a module export).

**Placement ladder (a type lives in the narrowest scope that covers its consumers)**:

| Consumer scope | Home | Published? |
|----------------|------|------------|
| 1 file | Inside the file, not exported | No |
| Multiple files within one module | `<module>/types.ts` or the file that owns the concept | No |
| Multiple modules within one layer | **Exported by the module that owns the concept** (no layer-level big types.ts, no layer barrel) | No |
| Inside the host, across core↔modes | `*-contract.ts` (e.g. `theme-contract.ts`), producer-side ownership | No |
| **Across the publish boundary** (mem/soul/external) | `packages/protocol/` (one file per domain) | **Yes (only ship when the contract changes)** |

**Emergent extraction**: start at the narrowest, **only widen when a wider consumer actually appears**. **Never pre-place in protocol** — when you write a single feature, it's not a protocol; extract when multiple consumers show up.

**Local extension, no write-back (Open/Closed)**: when a consumer needs to specialize a contract, **extend the base contract locally inside that consumer** (`interface MyMemStore extends MemoryStore {...}` / generics / composition), **do not modify protocol**. Only when a specialization is needed by **multiple consumers** do you promote it into protocol's base contract. Base contracts are closed to modification, open to extension.

**Discovery mechanism (avoid redefining)**: don't rely on memory or layer-level big types.ts — **read that directory's DIP P2 `AGENT.md` Member List** (each file already lists what it defines / exports). Types live at "the file that owns the concept" or in the module `types.ts`; the location is predictable; protocol is split by domain, so finding a contract is finding its domain file.

## 4. Promote-to-package flow (promoting a lib)

- Default placement is `core/lib/`; only promote when real external consumers appear.
- Use `scripts/promote-to-package.ts <name>`: mv the directory + generate `package.json` / `tsconfig.build.json` + rewrite imports; local development can resolve via workspace, but host's published dependency must be a semver-resolvable npm package.
- Publish order: `protocol` → `mem-core` / `soul-core` → `nano-pencil`. Any first-party package that is not semver-resolvable on npm must be independently published first; do not bypass via the host's publish scripts.

## 5. Quality rules (couples with F08, CI-executable)

- ≤ 400 lines / file, ≤ 15 files / directory, no cycles, public APIs carry JSDoc.
- Exemptions need a due date (Q8 resolution pending — see refactor-plan).
- `scripts/verify-quality.ts` implements; `.github/workflows/quality.yml` enforces on PR.

## 6. Status

- [x] Convention skeleton
- [ ] Aligned with F08 (`verify-quality.ts`) implementation
- [ ] Dependency-direction CI rule enforced
- [ ] Promote flow completed with `scripts/promote-to-package.ts`
