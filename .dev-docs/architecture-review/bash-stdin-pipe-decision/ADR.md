# ADR: bash tool stdin pipe + stdin timeout

```yaml
adr_id: bash-stdin-pipe-decision
status: implemented-but-reopened   # 2026-07-05 implemented + 5 gates + regression PASS; 2026-07-05 second test run revealed the user's original issue is NOT solved
created_at: 2026-07-05
reopened_at: 2026-07-05
reopen_reason: The 30s stdin timer is a **defensive fallback only**, not the real fix.
              The user's actual pain is "the command never showed it needed input". The timer
              just prevents an infinite hang; the user still can't answer y/N from the TUI,
              still can't see the prompt. The real fix needs a pre-execution gate
              (hermes-agent style: dangerous-pattern detection + TUI selector +
              session persistence + fail-closed default). Layer 1 (stdin timer)
              stays as the safety net; layers 2-3 deferred to the next ADR.
scope_now: core/tools/bash.ts (Layer 1 — implemented)
scope_next: TBD by successor ADR (`bash-pre-execution-approval-decision`)
references:
  - ../../scripts/_scratch/interactive-bash-repro/ (Layer 1 reproduction)
  - ../../scripts/_scratch/test-real-bash-debug.mjs (Layer 1 verification)
  - hermes-agent approval_callback in callbacks.py:186-241 (inspiration for Layer 2)
  - hermes-agent DANGEROUS_PATTERNS in tools/approval.py:498+ (inspiration for Layer 2)
```

## Context

The `core/tools/bash.ts:130` spawn config `stdio: ["ignore", "pipe", "pipe"]` causes any interactive command (`read -p`, `npm init`, `npx create-x`, `git push -f`, `ssh-add`, etc.) to:

- **Some CLIs**: exit immediately with code 1 on stdin EOF (user sees "failure", but it's actually stdin being cut)
- **Some CLIs**: hang forever waiting for stdin (user sees the spinner spin indefinitely, "stuck")

User reproduction: running `npx create-xxx` shows the TUI spinner frozen, with no signal whether the command is waiting for input or already failed.

**Reproduction script**: `scripts/_scratch/interactive-bash-repro/compare.mjs` outputs:

```
[A: stdio=ignore] Do you want to proceed? (y/N)
[A: stdio=ignore] [exit=1]
[B: stdio=pipe   ] Do you want to proceed? (y/N)
[B: stdio=pipe   ] [KILLED: no response in 2s]
[B: stdio=pipe   ] [exit=null]
```

The `[B]` pattern ("looks stuck") is exactly what the user reported.

## Decision (ratified 2026-07-05)

**Minimal change**: change `bash.ts:130` to `stdio: ["pipe", "pipe", "pipe"]` and add a stdin-timeout guard (default 30s; on timeout, `child.stdin.end()` to force EOF).

### Specific change

```diff
  // core/tools/bash.ts:130
- stdio: ["ignore", "pipe", "pipe"],
+ stdio: ["pipe", "pipe", "pipe"],
```

Add the stdin-timeout logic (pseudocode):

```ts
let stdinTimedOut = false;
const stdinTimeoutMs = options.stdinTimeoutMs ?? 30_000;
const stdinTimer = setTimeout(() => {
  stdinTimedOut = true;
  child.stdin.end();   // force EOF so the command takes its defaults
}, stdinTimeoutMs);
child.on("close", () => clearTimeout(stdinTimer));
```

### Why "only this one line + a timeout" is safe

| Before (ignore) | After (pipe + timeout) |
|-----------------|------------------------|
| `read` gets immediate EOF → command exits 1 immediately | `read` waits for stdin; after 30s, `stdin.end()` forces EOF, command takes defaults |
| Spinner stops briefly, TaskOutput reports failure | Spinner runs 30s, TaskOutput shows the prompt, then command completes with defaults |
| **For the model**: command fails fast, immediately replans | **For the model**: command takes defaults and continues |

**Two key guards**:

1. **30s timeout**: prevents the command from hanging forever (replaces Ctrl+C).
2. **`child.stdin.end()` forced EOF**: lets the command continue with default behavior after timeout (instead of SIGKILL).

### Why this option (and not the others)

| Candidate | Evaluation | Choose |
|-----------|------------|--------|
| **A. Do nothing** (user saves with Ctrl+C) | User's pain point unresolved | [ ] |
| **B. Change stdio to "pipe" without timeout** | After change, command hangs forever — worse than now | [ ] |
| **C. Change stdio to "pipe" + 30s timeout** (this decision) | Minimal change, maximum safety guard | [x] |
| **D. Change stdio to "pipe" + TUI bridge + prompt detection + UI hint** | Truly lets the user answer y/N from TUI | [ ] (large effort; this ADR only solves 80% of cases) |
| **E. Full bash-tool refactor** (sandbox / pty / full interactive mode) | Long-term solution | [ ] (deferred — see §Reopen) |

**This ADR only changes 1-2 lines**; full interactive support (D) is the reopen trigger; do not do it in this ADR.

### Non-Goals

- [ ] No TUI stdin bridge (user can't answer y/N from TUI)
- [ ] No prompt detection (no proactive "this command is waiting for input" signal)
- [ ] No full bash-tool refactor
- [ ] No change to background-task spawn (background tasks also use `ops.exec`, **inheriting this fix** — intended, no separate change needed)

### Known trade-offs

- **During the 30s timeout**: what the user sees is almost identical to "stuck" today (spinner runs, TaskOutput shows the prompt) — **minor visual improvement**.
- **Cannot input y/N**: if the user really wants to answer, they have to **manually open a terminal and rerun** (or pass args to skip the prompt, e.g. `yes | npx create-x`).
- **30s may not be enough** (slow CLIs, slow network downloads): but the timeout is configurable, and users / extensions can override.

**All these trade-offs are accepted** — this ADR's job is "first remove the immediate failure + the infinite hang"; full fix is D.

## Consequences

- [x] Commands that used to fail on EOF immediately (e.g. `read -p`) can now wait 30s and take defaults.
- [x] Commands that used to hang (a few CLIs) are forced to EOF after 30s.
- [x] Background tasks inherit the same fix (stdin is also pipe + timeout).
- **Warning:** `child.stdin` is now `Writable | null` — must guarantee cleanup paths (on spawn failure / signal abort, no leak).
- **Warning:** 30s is the default; **some commands may need more** — later, `BashOperations` should accept a `stdinTimeoutMs` option.

## Reopen triggers

If any of these hold, reopen this ADR and escalate to D (full interactive support) or E (full refactor):

1. User testing shows the 30s timeout is frequently insufficient (most scenarios need longer).
2. A new report appears: "the command failed immediately again" (suggests `stdin.end()` side effects have a problem).
3. Users start **needing** to answer y/N from the TUI (not just see the prompt).
4. Bash-tool sandboxing or pty-ization is on next quarter's plan.

## Acceptance (filled in after implementation · 2026-07-05)

- [x] `bash.ts` stdio changed to `'pipe'` ([bash.ts:148](../../../core/tools/bash.ts))
- [x] 30s stdin timeout + `child.stdin.end()` logic landed ([bash.ts:163-180](../../../core/tools/bash.ts))
- [x] Real regression script `bash-regression.mjs` runs:
  - `read -p` default stdin timeout: **elapsed=30096ms** (exactly 30s), exit=1
  - `echo hello` no stdin: **elapsed=81ms**, exit=0
  - `ls` failing fast: **elapsed=55ms**, exit=2
  - The previous `[B: stdio=pipe] [KILLED: no response in 2s]` pattern **eliminated**
- [x] Five acceptance gates passed:
  - `verify:dip` [x] 591 P3 headers compliant
  - `verify:quality` [x] 659 files, 0 cycles
  - `verify:package-boundary` [x]
  - `tsc --noEmit` [x] exit=0
  - `build:deps` [x]
- [x] P3 header updated ([bash.ts:1-9](../../../core/tools/bash.ts))
- [x] Reproduction script `interactive-bash-repro/compare.mjs` still runs (kept as a historical regression reference)
- [ ] commit message includes the reopen-conditions link (fill in at commit time)
