# Issue: `eval_runs` lifecycle leak — runs persist at `status='running'` indefinitely

```yaml
filed_on: 2026-05-17
classification: REVIEW
source:    eval_runs (lifecycle)
severity:  warning            # high impact, low frequency per event; but cumulative
category:  telemetry-completeness
historical_evidence:  53 / 92 rows  (~58%)
fresh_evidence:       1 new occurrence within today's 24h window
oldest_stuck:         2026-04-26T17:13Z
newest_stuck:         2026-05-17T10:54Z  (the Archetype A self-study run)
```

## Why this is not auto-fixable

SOP §3.3: any fix touches `extensions/defaults/sal/eval/insforge-sink.ts` (telemetry write side; `handleRunEnd` PATCH path) and `extensions/defaults/sal/index.ts` (lifecycle hooks + emergency flush wiring). Both are write side of `eval_*` tables. REVIEW.

## Likely code path(s)

- `extensions/defaults/sal/eval/insforge-sink.ts:268–286` — the `run_end` PATCH against `/api/database/records/eval_runs?run_id=eq.<id>`. If this PATCH fails or never fires, the run stays `running` forever.
- `extensions/defaults/sal/index.ts` — emergency flush on `beforeExit`/`SIGHUP`/`SIGTERM`. Per the index.ts P3 header (`extensions/CLAUDE.md`): "emergency flush on beforeExit/SIGHUP/SIGTERM; stale run cleanup is opt-in via NANOPENCIL_EVAL_CLEANUP_STALE_RUNS / credentials cleanup_stale_runs". So a janitor exists but is opt-in and apparently off in production.
- `extensions/defaults/loop/cron/cron-scheduler.ts:259` — the lock-contention path observed today suggests the SAL sink may run while the loop scheduler is in a degraded mode; the interaction is not clearly intentional.

## Evidence

### Historical scale (audit pull 2026-05-17T09:20Z)

```
status     count   oldest_start              newest_start
running    53      2026-04-26T17:13:01Z      2026-05-11T17:44:11Z
completed  39      2026-04-23T15:45:21Z      2026-05-10T18:11:19Z
failed     0       n/a                       n/a
```

53 of 92 historical runs (~58%) never received `run_end`. Zero rows ever reached `status='failed'` — meaning even error paths don't close out cleanly; they just leak as `running` too.

### Fresh evidence (this report)

Run `np-2026-05-17T10-45-52-7essp2` was started 2026-05-17T10:54:16Z to execute the Archetype A self-study task. Six hours later at the cron-scheduled SOP run:

```
status: running
turn_count: 0
ended_at: NULL
eval_turns rows: 0
eval_tool_traces rows: 0
pencil_issue_events rows attributable: 0
```

The session **did** write its `output.md` file (4 lines of bootstrap chatter, no model content) and **did** exit — but nothing closed out `eval_runs`. So even a clean exit, on the local box, with the SAL sink configured, leaks the lifecycle row.

### Side-condition that may have contributed

`.claude/scheduled_tasks.lock` was held by an unrelated Claude Code session (the SOP runner) at the time, which the loop extension reported as "Could not acquire lock (another instance running)". The pencil session ran as a non-leader scheduler. Whether this interferes with the SAL eval flush is **not** established — but the timing collision is documented.

## Question for the human

Two design questions for one bug:

1. **Why doesn't `run_end` reliably fire?** The known emergency-flush hooks (`beforeExit`/`SIGHUP`/`SIGTERM`) clearly miss ~58% of terminations. Is the flush running but the PATCH timing out silently, or is the hook itself not firing on the most common exit paths (clean exit from `--print` mode, process killed, etc.)?
2. **Should `eval_runs` self-heal at startup?** A janitor exists but is opt-in (`NANOPENCIL_EVAL_CLEANUP_STALE_RUNS`). Today its absence means every analytics query has to filter out stale-running rows manually. Should the janitor default to ON for SAL-enabled installations, or should there be a one-shot reaper script the user runs periodically?

## Suggested options

1. **Add synthetic `run_end` on `process.on('exit')`.** Beyond the existing beforeExit/SIGHUP/SIGTERM hooks. Captures the case the audit missed. Risk: `exit` is synchronous-only — the PATCH would have to be best-effort and may not land before the process is gone. But at least the *attempt* would be made.
2. **Server-side TTL job.** A scheduled task on the InsForge side (or a separate script) that marks `status='running' AND started_at < now() - interval '24 hours'` as `status='abandoned'` with `ended_at = now()` and a synthetic `error_message`. Decouples cleanup from client lifecycle entirely.
3. **Default the existing janitor to ON.** Flip `NANOPENCIL_EVAL_CLEANUP_STALE_RUNS` default from off to on for `adapter=insforge`. Cheapest change; relies on the janitor actually working.
4. **Investigate the lock-contention side-effect first.** If running pencil without the cron lock contention reproduces the issue, eliminate that as a confound before designing the fix.
5. **Defer.** Live with the leak; document the filter (`WHERE status='completed'`) as canonical for analytics; revisit when analytics actually consume `eval_runs` at scale.

## References

- Daily report: `../2026-05-17.md` (the "Routine 24h pass" appendix has the full context)
- Audit: `docs/insforge-audit-2026-05-17.md` §3.1
- Self-diagnosis charter: `/PENCIL-SELF-DIAGNOSIS.md`
- Today's stuck run row: `eval_runs.run_id='np-2026-05-17T10-45-52-7essp2'`
