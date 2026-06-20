---
name: receiving-code-review
description: Use when applying human, agent, or external review feedback.
---

# Receiving Code Review

Treat review as technical input to verify, not a script to follow blindly.

## Process

1. Read all feedback before editing.
2. Restate unclear items or ask for clarification.
3. Verify each item against current codebase behavior.
4. Accept technically valid feedback and implement one item at a time.
5. Push back with evidence when feedback is incorrect, breaks existing behavior, or violates scope.
6. Run focused verification after each substantive fix.
7. Run broader verification before completion.

## YAGNI Check

If feedback asks for "proper" infrastructure, search for actual usage. If nothing uses the path, consider deleting or deferring rather than expanding unused surface area.

## After Review

Once all feedback is addressed and verification passes, use `finishing-development-branch` to merge, push, or preserve the work.
