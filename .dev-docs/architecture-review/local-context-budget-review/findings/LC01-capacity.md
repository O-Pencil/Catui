# LC01 — Model capability is not deployment capacity

Finding: model-position limits can exceed allocated KV cache by more than an order
of magnitude. Default 16384-token compaction reserves can also consume an entire
small deployment window.

Decision: deployment capacity bounds the existing model contract. Probe only the
same configured API prefix with its existing credentials. Treat optional metadata
as untrusted; validate state, integers and multiplication. Keep original declared
limits separate from transient capacity so cache expansion can be detected.

Fixed instructions are non-compressible. Use server tokenization when available;
character heuristics are insufficient grounds to discard or block user instructions.
History-only compaction must not retry a preflight failure as context overflow.

Tradeoff: FreeToken detection requires a bounded model-list request; fixed-prompt
tokenization requires a supported optional endpoint. Failures preserve compatibility
and the provider's ordinary errors. Runtime metadata refresh is bounded to 30 seconds.

Layer review: no host-internal imports in extensions; no public protocol changes;
no service-locator controller; no new global mutable settings.
