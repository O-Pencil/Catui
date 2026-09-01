# CATAIL

CATAIL is Catui's evidence-traceable scientific workflow. Ask Catui to use `catail`, or describe a research task such as framing a question, running a reproducible literature search, freezing an experiment, analyzing results, drafting from verified evidence, or reviewing a manuscript.

The workflow stores durable research truth under `research/` and loads one stage playbook at a time. It is deliberately not an autonomous “paper generator”: hypotheses are not findings, search gaps are not novelty, and accountable humans retain scientific, ethics, authorship, and submission decisions.

Examples:

```text
Use catail init to establish this repository's research workspace.
Use catail search to map prior work for this research question.
Use catail design to freeze study S-001 before we inspect results.
Use catail audit to show which claims are not bound to verified evidence.
```

The bundled `scripts/audit.mjs` performs read-only structural checks. It never scores scientific quality or replaces expert review.
