# Trusted Skill Install Review

```yaml
review_id: trusted-skill-install-review
status: implemented-gate-blocked
created_at: 2026-08-25
scope:
  - extensions/builtin/security-audit/engine/detector.ts
  - test/security-audit.test.ts
```

## Purpose

Close Git clone parsing gaps that can place an external repository inside a trusted skill directory while preserving ordinary project clones and local repository operations.

## Decision

- `DangerDetector` remains the single owner of trusted skill install policy.
- Parse only the `git clone` argument surface needed to resolve repository and destination.
- Skip known value-taking clone options and stop at shell control operators.
- Resolve explicit destinations against the tool-call working directory.
- Infer Git's default destination from the repository when no destination is supplied.
- Apply Git's global `-C` option and simple leading `cd ... &&`/`cd ... ;` directory changes before destination inference.
- Keep Catui's default strict behavior: confirmed external installs into trusted skill roots are blocked without a confirmation override.

## Boundary Rationale

This is extension-owned security policy, not a shared runtime primitive or public protocol. The implementation stays in `extensions/builtin/security-audit/` and adds no dependency, public type, tool field, or prompt.

## Finding Set

| Finding | Status | Purpose |
|---|---|---|
| [SA01](./findings/SA01-git-clone-target-resolution.md) | closed | Resolve clone targets after options and default-target inference |

## Acceptance

- Value-taking clone options cannot hide the repository or target.
- Omitted destinations are inferred under the command working directory.
- Global `git -C` and simple leading `cd` forms cannot bypass destination resolution.
- External clones into trusted skill roots are blocked.
- Ordinary project clones and local relative repository operations remain allowed.
- Focused tests and all five repository gates pass.
