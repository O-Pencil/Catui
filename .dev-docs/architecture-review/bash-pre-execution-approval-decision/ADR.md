# ADR: bash tool pre-execution approval gate

```yaml
adr_id: bash-pre-execution-approval-decision
status: accepted   # 2026-07-05 ratified (based on hermes-agent reference)
created_at: 2026-07-05
predecessor: ../bash-stdin-pipe-decision/ADR.md   # Layer 1 (stdin timer) is implemented as a safety net
scope: core/tools/bash.ts + modes/interactive/components/approval-selector.ts + types interface
references:
  - D:/Projects/Pencil/Template-github/hermes-agent/hermes_cli/callbacks.py:186-241
  - D:/Projects/Pencil/Template-github/hermes-agent/tools/approval.py:498+
  - D:/Projects/Pencil/Template-github/hermes-agent/hermes_cli/cli_commands_mixin.py:1591-1736
related: ../bash-stdin-pipe-decision/   # Layer 1 safety net; Layer 2/3 are this ADR
```

## Context

`core/tools/bash.ts` currently does no approval before spawning. Any bash command (including `rm -rf`, `npx create-*`, `npm install -g`, `curl | bash`, `git push -f`, etc.) goes straight into the spawn flow.

**Layer 1 (already implemented)**: 30s stdin grace timer prevents hang. But the user's original pain point is unsolved: when the model runs a command, the TUI **doesn't show** the "waiting for input" signal, the user **cannot** answer y/N from the TUI, they can only wait 30s.

**Reference**: hermes-agent implements a pre-execution approval gate: runtime detection of dangerous patterns → call `approval_callback(cli, command, description)` → TUI pops a selector (once / session / always / deny / view) → user picks → decide whether to spawn. 60s timeout auto-denies (fail-closed).

## Decision

**Adopt the hermes-agent pre-execution gate pattern, port it to nanoPencil bash tool**:

### D1: Dangerous-pattern recognition (Layer 2)

Add a `DANGEROUS_PATTERNS` list in `core/tools/bash.ts` (a lean subset, borrowed from hermes + adapted for Git Bash / Windows):

```ts
const DANGEROUS_PATTERNS: Array<[RegExp, string]> = [
  // delete class
  [/\brm\s+(-[^\s]*\s+)*\//, "delete in root path"],
  [/\brm\s+-[^\s]*r/, "recursive delete"],
  [/\bcmd(?:\.exe)?\s+\/(?:c|k)\s+.*\b(?:del|erase|rd|rmdir)\b/, "Windows cmd destructive delete"],
  // permission class
  [/\bchmod\s+(-[^\s]*\s+)*(777|666|o\+[rwx]*w|a\+[rwx]*w)\b/, "world/other-writable permissions"],
  [/\bchmod\s+--recursive\b.*(777|666|o\+[rwx]*w|a\+[rwx]*w)/, "recursive world/other-writable"],
  // system class
  [/\bmkfs\b/, "format filesystem"],
  [/\bdd\s+.*if=/, "disk copy"],
  [/>\s*\/dev\/sd/, "write to block device"],
  [/\bkill\s+-9\s+-1\b/, "kill all processes"],
  [/\bpkill\s+-9\b/, "force kill processes"],
  [/\bkillall\s+(-[^\s]*\s+)*-(9|KILL|SIGKILL)\b/, "force kill processes (killall)"],
  // shell injection class
  [/\b(bash|sh|zsh|ksh)\s+-[^\s]*c(\s+|$)/, "shell command via -c/-lc flag"],
  [/\b(python[23]?|perl|ruby|node)\s+-[ec]\s+/, "script execution via -e/-c flag"],
  [/\b(curl|wget)\b.*\|\s*(?:[/\w]*/)?(?:ba)?sh(?:\s|$|-c)/, "pipe remote content to shell"],
  [/(?:\beval\b|\bsource\b|\.)\s*(?:\$\(\s*|`\s*)(?:curl|wget)\b/, "execute remote content via command substitution"],
  // hardened npm / npx (user pain point)
  [/\bnpm\s+(?:install|i|add)\s+(?:-g|--global)/, "global npm install"],
  [/\bnpx\s+(?:create-|@?\w+\/)/, "npx create/package (interactive installer)"],
  [/\byarn\s+(?:global\s+)?add\b/, "yarn global add"],
  [/\bpip(?:3)?\s+install\s+--user/, "pip user install (often needs interactive prompts)"],
  // git dangerous push
  [/\bgit\s+push\s+(?:-f|--force(?:-with-lease)?)\b.*\b(?:origin\s+)?(?:main|master)\b/, "force push to main/master"],
  // fork bomb
  [/\:?\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, "fork bomb"],
];

function isDangerousCommand(command: string): { matched: boolean; reason?: string } {
  for (const [pattern, reason] of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) return { matched: true, reason };
  }
  return { matched: false };
}
```

**Note**: did not copy all ~60 of hermes's patterns; selectively dropped PowerShell-specific / SQL / complex-encoding-bypass — these scenarios are narrow for nanoPencil users.

### D2: TUI selector component (Layer 2)

New file `modes/interactive/components/approval-selector.ts`:

```ts
export interface ApprovalDecision {
  choice: "once" | "session" | "always" | "deny";
  command: string;
  description: string;
  reason: string;
}

export class ApprovalSelector extends Container {
  private static readonly TIMEOUT_MS = 60_000;
  private static readonly instances = new Set<ApprovalSelector>();

  /** Serialization lock — only one pre-execution gate at a time */
  private static async withLock<T>(fn: () => Promise<T>): Promise<T> { ... }

  /** Open the selector; resolves to "deny" on timeout (fail-closed). */
  static async request(decision: ApprovalDecision): Promise<string> { ... }
}
```

**Choices**: `once` / `session` / `always` / `deny` (long commands >70 chars add `view`).

**Timeout**: no pick within 60s → `deny` (fail-closed, per hermes).

**Concurrency**: static `Set<ApprovalSelector>` + sequential await; don't pop multiple at once.

### D3: Pre-spawn hook (Layer 2)

Insert into `core/tools/bash.ts:execute` between `resolveSpawnContext` and `spawn`:

```ts
const dangerousCheck = isDangerousCommand(resolvedCommand);
if (dangerousCheck.matched && !opts.skipApproval /* for tests */) {
  const choice = await ctx.approval.request({
    command: resolvedCommand,
    description: `<from description param>`,
    reason: dangerousCheck.reason!,
  });
  if (choice === "deny") {
    return { content: [{ type: "text", text: `Command denied by user: ${dangerousCheck.reason}` }], isError: true };
  }
  // "once" / "session" / "always" continue
}
// ... existing spawn flow unchanged
```

**Key**: `ctx.approval` is injected via `createBashTool`; print / rpc mode don't inject → auto-skip → fast-path.

### D4: API contract (no protocol change)

`core/extensions-host/types.ts` does not need to extend; use the existing `ExtensionUIContext.select + confirm`.

`createBashTool` accepts `{ approval?: ApprovalClient }` injection; not passed = fast-path (skip dangerous-pattern detection). `modes/interactive/interactive-mode.ts` injects the ApprovalSelector client.

### D5: Failure modes

| Case | Behavior |
|------|----------|
| Non-interactive mode (print / rpc) | No approval injection → skip check (avoid blocking) |
| User denies (deny) | Return error: `Command denied by user: <reason>` |
| 60s timeout with no pick | Auto deny (fail-closed) |
| ApprovalSelector internal exception | Degrade to deny + log (fail-closed) |
| Command itself errors (e.g. `ls /nonexistent`) | Doesn't match DANGEROUS_PATTERNS → don't pop, go straight to spawn with exit=2 |

### D6: Deferred to Layer 3 (not in this ADR's scope)

- `session` option's session-persistent state (needs `settings.json` persistence + reload logic) — left for `bash-pre-execution-approval-layer3-decision`
- `view` option (long-command expansion + in-place display) — left for layer 3
- Per-tool approval callback (not just bash; other tools too) — left for follow-up

## Consequences

### C1: What the user gets

- [x] Running `rm -rf /` / `sudo dd if=/dev/zero` / `npx create-something` → TUI pops the selector, **user can see + pick**
- [x] Running `npm install <package>` (without `-g`) → doesn't pop (not in DANGEROUS_PATTERNS)
- [x] Running `cat foo.txt` / `ls` / `cd` → fast-path (no match) → doesn't pop
- [x] 60s no pick → deny, never infinite-wait

### C2: What is lost (trade-off)

- ⚠ Every dangerous command needs user interaction (even `npx create-react-app my-app --yes` already passes `--yes` still hits `npx create-*` in DANGEROUS_PATTERNS) — **can be mitigated with a `settings.json` allowlist**
- ⚠ One more review before spawn → startup a bit slower (~5-10ms detection overhead, negligible)
- ⚠ Layer 3 (session persistence) not done → user must re-pick "always" each session

### C3: Relationship with Layer 1 safety net

| Behavior | Layer 1 (stdin timer) | Layer 2 (this ADR) |
|----------|-----------------------|---------------------|
| Prevent hang | [x] 30s then end stdin | n/a (don't enter spawn) |
| See prompt | [ ] user can't see | [x] TUI selector intercepts explicitly |
| Answer y/N | [ ] user can't type | [x] user explicitly picks |
| Non-dangerous commands | fast-path (unchanged) | fast-path (unchanged) |
| Dangerous commands | wait 30s then default to N | user picks explicitly (no pick → deny) |

**Conclusion**: keep Layer 1 as the safety net (even if Layer 2 misses a pattern, we don't hang); Layer 2 is the main path.

## Reopen triggers

1. User testing shows `npx create-*` and similar still feel like "30s wait is annoying" — DANGEROUS_PATTERNS is too strict.
2. User wants the `session` option to actually persist — start Layer 3 ADR.
3. Need to extend approval to other tools (read / write / edit) — start cross-tool ADR.
4. DANGEROUS_PATTERNS too many false positives (e.g. `npx eslint .` hits `npx create-*` but ESLint isn't interactive) — start rule-refinement ADR.

## Acceptance (filled in after this ADR is implemented)

- [ ] DANGEROUS_PATTERNS landed in `core/tools/bash.ts`
- [ ] ApprovalSelector landed in `modes/interactive/components/approval-selector.ts`
- [ ] bash tool pre-spawn hook landed (including the deny path)
- [ ] interactive mode injects the ApprovalSelector client
- [ ] print / rpc mode don't inject → fast-path verified
- [ ] Real regression `scripts/_scratch/bash-approval-regression.mjs`:
  - `[1]` dangerous command → selector pops, simulate user picks `once` → command runs
  - `[2]` dangerous command → simulate pick `deny` → command doesn't run
  - `[3]` dangerous command → simulate 60s timeout → default deny
  - `[4]` ordinary command → no pop → fast-path straight to spawn
- [ ] Five acceptance gates: `verify:dip` / `verify:quality` / `verify:package-boundary` / `tsc --noEmit` / `build`
- [ ] P3 header + AGENT.md synced
