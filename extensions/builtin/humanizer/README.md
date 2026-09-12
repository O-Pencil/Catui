# humanizer (vendored)

Default-loaded Catui extension that bundles the upstream **humanizer** writing-quality skill
(version 3.0.0, MIT). The skill removes AI-writing tells from prose — not-X-but-Y contrasts,
one-line closers, forced triads, AI-word habits, sales language, and chat residue — without
changing what the text says and without inventing facts or sources.

It is grounded in Wikipedia's public ["Signs of AI writing"](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing)
guide. It is a **writing-quality** skill, not an "evade AI detectors" tool.

## Activation

This extension is registered in `builtin-extensions.ts` as a default-enabled, passive extension
(no UI, no timers, no workspace writes, no external processes). It contributes one skill
(`humanizer`) to the available skills list.

The skill body is **not** injected into the default system prompt. It loads on demand via the
`skill` tool; the `before_agent_start` hook only appends a ~6-line bootstrap note so the model
knows the skill exists for prose work.

## Loading the skill

- From the TUI: invoke the `skill` tool with `name: "humanizer"`.
- From the agent system prompt: the skill appears under `<available_skills>` once Catui's core
  skill pipeline discovers it through `resources_discover`.

## Usage in prose work

Ask in plain language, e.g.:

```text
Humanize the prose in docs/launch-post.md
```

The skill supports file mode (edit prose in place, keep code blocks / data / frontmatter
unchanged) and pasted-text mode (three-step workflow: mark tells → draft rewrite → final version).
When writing new docs, the model can invoke it before finalizing user-facing text.

## Source and license

See `THIRD_PARTY_NOTICE.md`. Upstream: [github.com/blader/humanizer](https://github.com/blader/humanizer).