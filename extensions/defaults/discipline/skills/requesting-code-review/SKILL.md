---
name: requesting-code-review
description: Use after meaningful implementation tasks, before merging, or when a fresh review would reduce risk.
---

# Requesting Code Review

Ask for review with precise context and explicit requirements.

## Review Packet

Provide the reviewer:

- Summary of the intended change
- Requirements or plan being checked
- Files changed
- Base and head SHAs when available
- Verification already run
- Known risks or areas needing attention

## Review Standard

Ask the reviewer to lead with findings ordered by severity. Findings need file and line references, a concrete failure mode, and a suggested correction. Require distinction between:

- Critical: must fix before proceeding
- Important: should fix before merge
- Minor: optional improvement

## After Review

Use `receiving-code-review` before applying feedback.
