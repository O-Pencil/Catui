---
name: finishing-development-branch
description: Use after implementation is complete and verified, when deciding how to merge, push, preserve, or discard branch work.
---

# Finishing a Development Branch

Complete branch work with evidence and a clear integration choice.

## Process

1. Run the verification that proves the completed work.
2. Inspect git status and current branch.
3. Detect whether the workspace is a normal checkout, linked worktree, or detached/headless workspace.
4. Present concrete options:
   - Merge locally
   - Push and create a PR
   - Keep branch/worktree as-is
   - Discard work, with explicit confirmation
5. Execute the chosen path.
6. Re-run verification after merge when merging locally.

## Safety

Never discard work without typed confirmation. Never remove a worktree unless you can prove it was created for this workflow and is not owned by the harness.
