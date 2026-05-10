# TokenSave

TokenSave is a default-on extension that reduces noisy shell output before it enters the agent context.

## Behavior

- Commands execute with their original shell semantics.
- TokenSave plans commands before execution and filters output after execution.
- Small outputs, unsafe redirection, heredocs, and explicitly disabled commands pass through unchanged.
- Filtered outputs include estimated token savings and a raw recovery file path when available.
- Both agent-called `bash` tools and user `!` bash commands are covered. `!!` commands stay excluded from context and are not intercepted.

## Disable

Set either environment variable on a command to bypass filtering:

```bash
TOKEN_SAVE_DISABLED=1 git status
TOKENSAVE_DISABLED=1 npm test
```

## Stats

Use:

```text
/tokensave
/tokensave history
/tokensave plan <command>
```

## Config Filters

User filters load from:

```text
~/.pencils/token-save/filters.json
```

Project filters load from:

```text
.nanopencil/token-save/filters.json
```

Project filters are ignored unless the project explicitly opts in with:

```json
{ "trusted": true }
```

at:

```text
.nanopencil/token-save/trust.json
```
