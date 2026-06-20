---
name: using-git-worktrees
description: Use before feature work that should be isolated from the current branch, or before executing a multi-step implementation plan.
---

# Using Git Worktrees

Prefer isolated workspaces for risky or multi-step changes.

## Process

1. Detect whether the current checkout is already a linked worktree:
   - `git rev-parse --git-dir`
   - `git rev-parse --git-common-dir`
   - `git rev-parse --show-superproject-working-tree`
2. If already isolated and not a submodule, continue there.
3. If not isolated, ask before creating a worktree unless the user or plan already requested isolation.
4. Prefer native workspace tools when available.
5. If using `git worktree`, place project-local worktrees under `.worktrees/` when it is ignored.
6. Run project setup only when dependencies are missing or stale.
7. Establish a clean baseline with the relevant tests before changing behavior.

## Safety

Do not remove harness-owned worktrees. Do not proceed from a failing baseline without telling the user what failed and getting direction or investigating the failure.

## Relationship to other skills

Use `using-git-worktrees` before `executing-plans` when the work should be isolated from the current branch. After setting up the worktree, proceed with `executing-plans` inside it.
