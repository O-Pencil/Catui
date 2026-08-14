# Evolution Auto Activation Review

```yaml
status: active
owner: extensions/optional/evolution
scope: default self-evolution activation behavior
trigger: default-enabled extension behavior change
```

## Decision

Evolution proposals produced by Catui-owned self-evolution paths should become active automatically after local validation and any required gates pass.

Manual approval remains available for old or blocked candidates, but it is no longer the normal activation step for low-risk declarative artifacts.

## Boundary

- Owner stays in `extensions/optional/evolution`; no runtime or protocol change is required.
- Session and workspace declarative artifacts can promote immediately after candidate validation.
- Workspace executable tools and eval fixtures still require deterministic gate evidence before activation.
- Global auto-activation remains limited by `canAutoPromoteGlobalEvolution()`.

## Acceptance

- Turn-end reusable lessons become active session memory without `/refine promote`.
- Structured turn-end proposals without an `autoPromote` flag become active when gates and scope policy allow it.
- Existing gate failures keep candidates inactive and record gate evidence.
- DIP, quality, package-boundary, build, and TypeScript checks pass.
