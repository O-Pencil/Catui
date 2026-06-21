# External Catui Documents Review

```yaml
status: in-progress
scope: Unfinished @CATUI documents from the 2026-06-20/21 engineering exchange folder
decision: Apply only reproducible, narrowly testable fixes
```

## Scope

This review evaluates:

- NanoMem retrieval quality and performance proposal
- link-world SearXNG fallback proposal
- Grub harness safety and recovery feedback
- system prompt leakage prevention proposal
- Catui bug report and its implementation receipt

## Decision

| Topic | Evidence | Decision |
|---|---|---|
| Grub malformed JSON diagnostics | `readFeatureList()` discards parse errors and the controller emits a generic message | Fix with parse location and local context |
| Grub iteration-limit handoff | terminal snapshot omits feature progress and pending IDs | Fix terminal formatting |
| Grub immutable feature rules | coding prompt and README already state count/order/content invariants | No code change |
| NanoMem embedding quality | hash vectors are lexical, but the proposal has no benchmark corpus and SimHash does not solve synonym semantics | Defer pending an evaluation dataset |
| NanoMem scoring weights | proposed 0.6/0.4 weights have no measured precision/recall basis | Defer |
| link-world SearXNG fallback | public instances are unstable and would receive user queries without an explicit trust decision | Reject as a default fallback |
| System prompt creator metadata | default prompt contains a hard-coded creator identity | Remove from the default prompt |
| Dynamic system-reminder secrecy | moving text inside the same model-visible prompt does not make it secret | Reject |
| Broad input/output redaction | high false-positive and compatibility risk without a threat model and corpus | Defer to a dedicated security design |
| Bug-fix receipt | current worktree contains the claimed implementation and type-checks, but several changes lack focused regression tests | Track separately from this narrow patch |

## Acceptance

- Malformed `feature-list.json` errors identify the parse location and show nearby source lines.
- Grub terminal summaries show passing count and pending feature IDs.
- The default system prompt contains no hard-coded creator identity.
- Existing Grub and system-prompt tests remain green.
- DIP, quality, package-boundary, build, and type-check gates pass.

