# PB03: Skill Install Security Gate

```yaml
finding_id: PB03
severity: p1
files_primary:
  - extensions/builtin/security-audit/engine/detector.ts
  - extensions/builtin/security-audit/interface.ts
status: selected
```

## Problem

The default security extension blocks destructive shell commands but does not recognize `git clone <external> ~/skills` or related trusted skill-directory installs. That lets untrusted code become agent-loadable behavior without warning.

## Decision

Classify external `git clone` commands targeting trusted skill directories as dangerous in strict mode. The default `tool_call` hook already converts dangerous bash checks into denials and records an audit log.

## Boundary

This is a targeted trust-directory rule, not a general ban on `git clone`. Cloning into ordinary project directories remains allowed unless another detector rule matches.

