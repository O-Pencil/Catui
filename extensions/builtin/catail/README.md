# CATAIL

**CATAIL — Professional Research-to-Publication Skill** helps researchers and scientific personas discover and position questions, select and combine methods, build and challenge explanations, investigate evidence, update claims, write defensible papers, verify venue requirements, and prepare submission packages.

## Activation

Use Catui's standard Skill invocation:

```text
/skill:catail <scientific request>
```

Natural language is also supported when CATAIL is explicitly named:

```text
Use CATAIL to assess whether this research idea is novel and feasible.
```

For a dedicated scientific session, switch to Athena:

```text
/persona use athena
```

Athena uses CATAIL by default for scientific intent while retaining direct coding behavior for ordinary engineering work.

Outside the Athena scientific persona, CATAIL does not activate from words such as research, paper, experiment, discovery, test, or analysis alone. Catui remains a coding agent by default. Selecting Athena authorizes CATAIL for scientific intent, while ordinary coding under Athena remains ordinary coding.

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
       -> Prepare & Submit
```

A paper is an output, not a mode. An experiment is one investigation strategy, not the default endpoint.

For CCF-A-oriented work, CATAIL verifies the current CCF classification and venue requirements from official primary sources. It never embeds a supposedly permanent venue list, deadline, page limit, or policy. The workflow stops before the external submission action until an accountable human approves it.

When the user asks for durable project work, CATAIL can maintain research memory under `research/`. Provenance, auditability, and reproducibility are scientific stewardship disciplines, not the product's identity. The bundled structural audit never establishes truth, novelty, ethics approval, or publication readiness.
