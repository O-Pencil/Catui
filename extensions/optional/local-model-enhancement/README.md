# Local Model Enhancement

An optional profile for resource-constrained local models, including Qwen served by FreeToken. It reduces tool-result text and encourages short, verifiable execution steps. It uses the existing agent loop and makes no extra model calls.

## Enable

From a source checkout:

```bash
npx tsx cli.ts --extension ./extensions/optional/local-model-enhancement/index.ts
```

For an installed release, pass the absolute path to the bundled
`dist/extensions/optional/local-model-enhancement/index.js` with `--extension`.
The same absolute path can be added to the `extensions` array in your agent's
`settings.json`. Registration in the built-in catalog does **not** load it by default.

Explicit loading enables the profile. Within a session:

```text
/local-model-enhancement status
/local-model-enhancement off
/local-model-enhancement on
```

Changes apply while idle and persist on the current session branch. A new session
starts enabled when the extension is loaded; resumed/forked branches inherit their
own recorded state. Model switching keeps the explicit on/off choice and recalculates
preview budgets from the newly selected model's declared context window. No model
names, providers, or parameter counts are used to guess activation.

## Behavior

- Missing tool limits default to 120 lines for `read`, 30 matches for `grep`, and
  50 entries for `find`/`ls`. Explicit limits and grep's `head_limit` alias win.
- A transient context hook creates head/tail previews of long textual tool results.
  Recent results within each assistant tool batch receive priority. Every preview identifies the omitted character
  interval and how to retrieve it with `local_model_read_result`.
- The read-only reader returns up to 1000 characters per call, using `tool_call_id`,
  `offset` (zero-based), and `limit`. Follow `next_offset` for another page. It searches
  the active branch, including pre-compaction entries, without exposing sibling
  history or assistant reasoning. It remains usable when enhancement is off.
- Original stored tool results are unchanged. Error status, call pairing, images,
  documents, user requirements, and project/system instructions are preserved.
  Results without matching stored evidence are left intact.
- A short additive instruction encourages targeted reads, concise output, small
  verified changes, and avoiding unsolicited subagents/background model work.
  This is guidance, not a scheduler or a hard concurrency limit.
- Status reports character counts from the most recent projection. It does not
  claim tokenizer-exact savings or measured performance gains.

The per-result body ceiling is one quarter of the declared context-window number,
bounded to 512–6000 **characters**. Per-assistant-batch preview-body allowance is four times
that ceiling. An unknown window uses 16384 as the budgeting reference. Notices,
readback pages, non-text content, and preserved short/unrecoverable results can
exceed this allowance; it is not a hard total-request token limit. Even a tiny body
budget retains the complete retrieval notice. Results are not expanded just to add
a notice. Defaults intentionally favor small payloads over long autonomous runs.
Appending a new assistant turn does not reallocate old batches' previews, preserving
their request prefixes for server caching. Changing models/budgets or disabling
the profile can change those prefixes. Actual cache reuse is server-dependent.

## Limits and validation

This extension cannot recover text already removed by a tool's own truncation or
the core aggregate-result gate. Use file ranges/search offsets or the underlying
tool's saved full-output path for that evidence. It does not rewrite the server's
context allocation, Catui's compaction settings, thinking configuration, tool
catalog, other extensions, permissions, or the system prompt. In particular, it
does not globally disable background activity initiated by other extensions.
Existing runtime compaction and loop limits remain necessary. An explicit off
restores ordinary payloads from stored results; unload the extension to remove its
reader schema as well. This profile also applies to cloud models if you leave it on.

Before relying on a local endpoint, verify a read/edit/check tool-call round trip.
FreeToken must return structured tool calls; printing JSON in assistant text is
insufficient. This extension never interprets ordinary text as executable calls.

For an A/B comparison, use identical model weights, quantization, server settings,
repository fixtures, and sampling settings. Run each task repeatedly in fresh
sessions, with the extension absent and present. Include a targeted edit, failed
test repair, multi-file change, and a long log with relevant evidence in its middle.
Record task checks, wall time, time to first token, input/output tokens, repeated
calls, and failure reasons; measure warm and cold cache runs separately. Character
reductions in offline tests do not establish faster or more successful real-model
execution. Real FreeToken performance remains unverified until this comparison is run.
