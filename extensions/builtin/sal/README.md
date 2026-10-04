# SAL — Structural Anchor Localization (Experimental)

A pluggable Catui extension that gives the agent **address awareness** inside the codebase.

## Status

MVP — Layer 1 (task localization) and action grounding only. Memory anchoring is sidecar-only and does not modify NanoMem schema.

## Activation

SAL is **enabled by default** on every Catui session.

```bash
# SAL active (default)
catui -p "your prompt"

# SAL active with local A/B sidecar artifacts
catui --sal-ab -p "your prompt"

# SAL disabled — baseline memory mode
catui --nosal -p "your prompt"
```

When `--nosal` is set, all hooks return early and zero work is performed. When SAL is active without `--sal-ab`, it can still emit configured eval data to InsForge, but it does not create local `.memory-experiments` sidecar files.

## Terminal compatibility (Warp, block UIs)

SAL builds a **terrain snapshot** of the workspace (walk + read DIP headers). That work is **asynchronous and periodically yields to the event loop** so the TUI can flush user input and status lines to the terminal while indexing runs. If you still see UI glitches in a specific terminal, use `--nosal` to confirm whether SAL is involved, then file an issue with `TERM_PROGRAM`, Warp version, and repro steps.

## Slash commands

| Command | Purpose |
|---------|---------|
| `/sal:coverage [module1 module2 ...]` | Report DIP P3 coverage per module. PASS ≥ 90%, WARN ≥ 70%, otherwise FAIL. Layer 1 experiments require PASS in target modules. |
| `/sal:status` | Show flag state, snapshot timestamp, weights source |

## Sidecar output

Local sidecar output is disabled by default. Enable it only for explicit SAL A/B experiments with `--sal-ab` or `CATUI_SAL_AB=1`. In that mode, every grounded turn writes a JSON record to:

```
<workspace>/.memory-experiments/sal/anchors/turn-<timestamp>.json
```

Each record contains the task anchor, top candidates, evidence reasons, the action anchor inferred from tool touches, and the touched file list. These are the comparable artifacts for the SAL A/B experiment.

## Tunable weights

Drop a `sal-config.json` next to the workspace root or under `.memory-experiments/sal/`:

```json
{
  "directFileEvidence": 0.45,
  "moduleResponsibilityMatch": 0.20,
  "dipContractMatch": 0.15,
  "importNeighborhoodMatch": 0.10,
  "memoryHistoryMatch": 0.10,
  "structuralSalience": 0.35
}
```

Missing fields fall back to defaults individually. See `weights.ts` for the full set.

## Pluggability contract

Deleting `extensions/builtin/sal/` and removing its registration in `builtin-extensions.ts` must leave the system fully functional. SAL must not be imported by any code in `core/`, `modes/`, `packages/`, or other extensions. Use `--nosal` to opt out at runtime without modifying code.

## See also

The detailed design notes for SAL lived under `docs/` and were removed during the docs cleanup. Refer to the SAL `AGENT.md` and the extension's source under `extensions/builtin/sal/` for the current contract.
