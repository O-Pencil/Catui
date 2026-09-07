# Context continuity

Catui automatically gives the model context-budget hints and tools to recover earlier conversation details. No setting or command is required. When space runs low, the model can save a handoff and continue in a fresh working window within the same session. Models that do not use this capability still have automatic compaction.

- `session_history`: search/list active-branch conversation records, read original text, and list checkpoints.
- `working_notes`: maintain versioned working notes that survive restart and follow the selected branch.
- `new_context`: save a handoff and request a safe window change after the current tool batch.

The model's task budget and host permissions continue unchanged. Raw session records remain available; saved notes are not long-term memory. A window change can be skipped when it would not free useful space or the retained content cannot fit safely. Retrieval is paginated; notes allow 16 names, 12000 characters per note, and 32000 characters total. History does not expose hidden reasoning or sibling branches.

Handoffs add no separate summary-model call. Tool definitions, small budget hints, note writes, and history retrieval still consume tokens. Automatic compaction remains the fallback, including context-overflow recovery.
