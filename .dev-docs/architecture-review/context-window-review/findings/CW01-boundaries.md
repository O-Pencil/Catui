# CW01: Safe context boundaries and retrieval

The current transient `transformContext` cannot commit a new working window: the loop and Agent state retain the original messages. Calling manual `compact()` from a tool also aborts the active agent. Introduce a separate synchronous preparation seam before provider requests, updating loop and Agent working state together after a persisted checkpoint. Do not change transient hook semantics.

Use existing compaction cut-point rules to preserve tool result pairing. Reject handoffs that do not reclaim meaningful space or cannot fit in the selected model. Only commit when the newest loop message is already represented in the selected session branch; otherwise defer. A queued request is bound to its session and branch and discarded when that ancestry changes. Abort does not initiate a new window.

Keep raw session entries as the evidence source. Notes and handoffs are model-authored working state, never authoritative permissions or long-term facts. History access is limited to the active ancestry and paginated; do not expose sibling branches or reasoning blocks. Retrieval must label historical text as data and retain source IDs.

Compatibility: additive optional private-loop and extension-host capabilities; unchanged root SDK exports and persisted entry union. First-party extension code consumes the host extension contract and existing public session type seam only. No changes to `catui-protocol` are needed.
