# Local model enhancement review

Status: implemented; offline acceptance passed. Real-model performance validation remains open.

## Intent and ownership

Offer an explicitly loaded extension that reduces default file/search reads and the tool-result text sent to resource-constrained models, while preserving source evidence and project instructions. This is a user-perceivable behavior, so the owner is `extensions/optional/local-model-enhancement/` under feature-workflow section 2b, step 5. No new runtime loop, provider, public protocol, dependencies, or default-loaded behavior is required.

The extension consumes existing `tool_call`, `context`, session lifecycle, command, tool registration, and session-journal capabilities. The root registry only describes the optional extension. Types remain in this extension or use existing host contracts as type-only imports.

Integration review: the shared plan-mode policy has a named read-only allowlist. Add the extension's session-evidence reader there, with a regression test showing workspace writes remain denied. This is an existing permission owner integration, not a new permission bypass or generic trust in extension metadata. Its P2/P3 contracts will record the addition.

## Accepted design

- Loading explicitly enables the profile; `/local-model-enhancement on|off|status` controls it per session branch, persisted through custom entries. Changing it while a run is active is rejected.
- Missing read/search limits receive conservative defaults. Explicit arguments remain authoritative and ordinary validation still runs.
- Before each model request, long textual tool results receive deterministic head/tail previews and a retrieval instruction. This is a transient message projection: original session results, tool-call IDs, error flags, non-text content, user instructions, and assistant messages are preserved.
- A bounded read-only tool retrieves original tool-result text by call ID from the active branch. It can recover evidence preceding compaction and remains available when the profile is off, so earlier previews remain usable.
- Per-result and per-assistant-batch body budgets scale with the declared model window, with conservative ceilings. Budgets reset at assistant boundaries, so appending turns preserves earlier projected prefixes instead of progressively rewriting history and invalidating prefix caches. These are character budgets, not an exact tokenizer or a hard request-context limit. Retrieval notices and non-text payloads are excluded from the batch body budget.
- A short additive execution instruction encourages targeted reads, small verified changes, concise output, and avoiding unsolicited delegation. It never replaces the base prompt, skills, project rules, or other extension hooks. It adds no LLM calls or timers.
- No provider-name/model-size guessing, automatic thinking changes, global tool filtering, settings rewrites, or promise of reduced GPU memory. Existing compaction, working notes, permission checks, and livelock detection retain their owners.

## Acceptance

Test opt-in registration, branch/session restore, idle-only switching, default versus explicit tool arguments, source immutability, error/multimodal preservation, bounded pagination, retrieval across compaction, off-mode restoration, and smaller projections for small windows. Exercise the real extension wrapper/runner or loader where practical. Run all five repository gates and the PR self-check.

Real FreeToken throughput/completion-rate comparisons require the user's endpoint and hardware. Offline tests validate transport-independent behavior only. Thinking/tool-parser integration, model-call concurrency controls, exact request token accounting, and semantic test-log extraction remain separate work pending evidence.
