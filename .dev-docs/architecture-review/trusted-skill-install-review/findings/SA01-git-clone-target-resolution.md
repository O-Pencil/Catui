# SA01 — Git Clone Target Resolution

## Finding

The trusted-skill detector currently treats every non-option token after `git clone` as positional. Options such as `--depth 1` and `-b main` therefore shift the repository and destination slots. A clone without an explicit destination has no target slot at all, even though Git will create a directory below the command working directory.

## Risk

An external repository can be installed into a trusted agent-instruction directory without matching the dedicated security rule. Once present, its instructions can be loaded with trusted skill authority.

## Resolution

Add a focused clone parser that skips known value-taking options, stops at shell command boundaries, identifies the repository, and resolves either the explicit destination or Git's inferred default directory. Track Git's global `-C` option and simple leading shell `cd` forms when computing the effective working directory.

## Invariant

When Catui can identify an external Git repository and resolve its clone destination inside a trusted skill root, default strict mode blocks the tool call before execution.

## Non-Goals

- Full POSIX shell parsing.
- Variable, command-substitution, or glob expansion.
- Changing the trusted root list.
- Blocking local relative repository operations solely because their target is a skill directory.

## Evidence

`test/security-audit.test.ts` covers long, short, inline, and `--bundle-uri` value-taking options; Git global `-C`; leading shell `cd`; inferred destinations in trusted working directories; ordinary project destinations; and local relative repositories.
