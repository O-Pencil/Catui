# PB19-01 Tool Request Input

## Phenomenon

PawBench sees `tool.requested` entries such as `CronCreate`, but only with `inputFingerprint`. It cannot verify parameters like cron schedule, prompt, or channel.

## Essence

The trace boundary receives `call.arguments` and computes a stable fingerprint, but it does not persist the source value. The benchmark evidence is therefore non-reversible by design.

## Decision

Extend `tool.requested` payloads with optional `input: unknown` and emit it for new runs. Keep `inputFingerprint` as the stable compatibility field and accept old traces where `input` is absent.

## Verification

- Agent loop regression asserts emitted `tool.requested.payload.input`.
- Trace parser regression asserts old and new payload shapes validate.
- Workspace JSONL regression asserts persisted trace files retain `input`.
