# Runtime Reliability Closure

Implemented the four findings in their existing owners. Session journaling/state
is synchronous, notification hooks are ordered, cancellation suppresses pending
recovery, and prompt callers receive latched storage errors. Session transitions
drain old notifications. Terminal extension hooks remain detached because they
can start a new prompt. Tool-call transforms compose through later no-op returns
and stop on the first block. Source evolution records upload attempts/acceptance
and reconciles public availability without submitting the same artifact twice.

Local acceptance passed:

- Five required gates: verify:dip, verify:quality, verify:package-boundary,
  build, and tsc --noEmit (via typecheck, including scripts).
- verify:structure: 39 historical oversized files; no new entries or baseline edits.
- Dist package-boundary check, 9 release contracts and 3 built-artifact tests.
- test:pre: 407 passing test executions, including SDK-dispatched deferred hooks,
  write failures, cancellation, session switches and composed tool inputs.
- test:harness-critical: 257 passing test executions and all 16 offline harness
  scenarios passing. Receipt regressions cover durable restarts, ambiguous upload
  outcomes, credential refusals, non-404 outages, mismatched artifacts and polling.
- Agent-core suite: 166 passing tests; 43 provider tests skipped without live
  credentials. Focused final runner/SDK regression recheck: 22 passing tests.

§6 PR self-check: all modified source P3 contracts and owning P2 maps reviewed;
root topology unchanged; no reverse imports, dependencies, prompt/tool changes or
extra model calls; existing subscriber contract preserved. Additive sdk:error
source `session` is intentional. Streaming UI and cancellation paths exercised
through real Agent/SDK dispatch, not just sequential handler calls.

PR CI remains the final acceptance gate. Real FreeToken/Qwen performance evaluation
and unrelated oversized-file refactors are outside this repair scope. Reopen if
new lifecycle hooks expose queue starvation or if registry validation changes.
An unknown upload outcome that never becomes visible requires maintainer
investigation; durable receipts intentionally prevent blind resubmission.
