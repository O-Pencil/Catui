# CATAIL

**CATAIL — Professional Scientific Agent** is Catui's explicit-use Skill for scientific inquiry. It helps researchers discover and position questions, select and combine methods, build and challenge explanations, investigate evidence, update claims, and communicate defensible conclusions.

## Activation

Use Catui's standard Skill invocation:

```text
/skill:catail <scientific request>
```

Natural language is also supported when CATAIL is explicitly named:

```text
Use CATAIL to assess whether this research idea is novel and feasible.
```

CATAIL does not activate from words such as research, paper, experiment, discovery, test, or analysis alone. Catui remains a coding agent by default.

## Examples

```text
/skill:catail Evaluate whether this idea has a defensible contribution. Stop after positioning.

/skill:catail Discuss the study design with me in Chinese, but write the eventual manuscript in English. Do not start experiments.

/skill:catail Validate this existing computational experiment and distinguish replication failure from hypothesis refutation.

/skill:catail Use the supplied evidence package to draft a review article; do not invent missing sources.
```

## How it works

CATAIL routes a request by scientific intent, current evidence state, requested endpoint, stop boundary, and language scope. It selects the smallest sufficient combination from nine research modes rather than forcing every task through every method.

The shared inquiry lifecycle is:

```text
Orient -> Position -> Formulate -> Strategize -> Investigate
       -> Infer -> Challenge & Revise -> Communicate & Update
```

A paper is an output, not a mode. An experiment is one investigation strategy, not the default endpoint.

When the user asks for durable project work, CATAIL can maintain research memory under `research/`. Provenance, auditability, and reproducibility are scientific stewardship disciplines, not the product's identity. The bundled structural audit never establishes truth, novelty, ethics approval, or publication readiness.
