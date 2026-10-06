# RR02 — Tool-call transforms must compose

emitToolCall sends the original event to every handler and replaces its result
with each nonempty return. A later `{block:false}` loses an earlier bounded read
input. Match tool_result's effective-event pipeline: propagate input explicitly,
retain prior input through no-op results, and terminate on a block. Return values
remain full replacement inputs, not ambiguous partial-object merges.
