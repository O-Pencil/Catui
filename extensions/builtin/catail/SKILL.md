---
name: catail
description: Professional research-to-publication Skill for question formation, prior-art positioning, theory, evidence synthesis, empirical or computational investigation, inference, replication, scientific writing, venue verification, and submission readiness. Use when the user explicitly invokes /skill:catail, explicitly asks to use CATAIL, or the active persona is Vera and the task has scientific intent. Outside Vera, do not activate from scientific keywords or ordinary coding investigation alone.
metadata:
  short-description: Research-to-publication Skill
---

# CATAIL — Professional Research-to-Publication Skill

CATAIL augments a researcher or scientific persona from an uncertain question to defensible, revisable knowledge and submission-ready research artifacts. It supplies method selection, critical counter-roles, project memory, and research-to-publication routing. It is not a persona, paper generator, mandatory experiment pipeline, search wrapper, audit product, or autonomous scientific authority.

## Activation boundary

Use CATAIL when the user:

- invokes `/skill:catail`, with or without arguments; or
- explicitly says to use CATAIL; or
- has selected the Vera persona and asks for scientific inquiry, evidence, experiment, paper, review, venue, or publication work.

Outside Vera, do not infer activation from words such as research, paper, discovery, investigation, test, experiment, evidence, analysis, or their translations. Ordinary coding, debugging, implementation, and verification remain under Catui's default coding behavior unless CATAIL is explicitly named. While Vera is active, ordinary coding, debugging, maintenance, and administrative work still does not require a research workflow merely because Vera is the active persona.

If invoked without a task, inspect only readily available project context and present two or three context-aware scientific next actions. Never initialize a workspace, search, design, or experiment merely because CATAIL was opened.

## Establish the task context

At the start of a new scientific goal, or when the goal materially changes, determine:

- **intent:** discover, explain, synthesize, compare, test, reproduce, evaluate, or communicate;
- **target output:** idea assessment, position map, theory, protocol, evidence synthesis, analysis, paper, review, method, dataset, benchmark, or another artifact;
- **current state:** topic, observation, literature, claims, protocol, data, results, manuscript, or completed project;
- **entry and endpoint:** earliest unmet dependency and the user's requested stopping point;
- **language scope:** dialogue, artifact, source, and terminology languages;
- **authority and constraints:** available evidence, time, resources, confidentiality, ethics, safety, and external-action limits.

Do not turn this into a questionnaire. Ask only for information that blocks the current scientific decision; otherwise state bounded assumptions and continue. A user instruction such as “do not start experiments,” “only assess novelty,” or “write the manuscript in English but explain revisions in Chinese” is a hard scope boundary.

Read [foundations/lifecycle-and-routing.md](references/foundations/lifecycle-and-routing.md) when selecting the entry stage, endpoint, gate decision, or backtracking path. Read [foundations/scientific-reasoning.md](references/foundations/scientific-reasoning.md) when classifying observations, hypotheses, evidence, claims, conclusions, negative results, or cross-language certainty.

## Scientific capability kernel

CATAIL can compose eight capabilities:

- **Discover:** expose important unknowns, tensions, anomalies, and candidate questions.
- **Ground:** map prior work, source quality, disagreement, and claim-level novelty.
- **Explain:** construct mechanisms, theories, rival explanations, and predictions.
- **Strategize:** choose methods and design the smallest informative investigation.
- **Investigate:** collect, generate, or ingest evidence using appropriate research modes.
- **Infer:** estimate, compare, explain uncertainty, and bound conclusions.
- **Correct:** seek disconfirmation, diagnose failure, replicate, revise, reframe, or stop.
- **Communicate:** produce papers, reviews, reports, figures, methods, or other scientific outputs.

**Stewardship** cuts across all capabilities: provenance, reproducibility, confidentiality, ethics, transparent uncertainty, and durable project memory. Stewardship protects scientific work; it is not CATAIL's product identity.

## Epistemic discipline

Keep these objects distinct:

- an **observation** records what was reported or measured;
- a **hypothesis** offers a testable explanation or prediction;
- **evidence** is an inspected, quality-assessed observation relevant to discriminating claims;
- a **claim** is a scoped proposition that the researcher may defend;
- a **conclusion** is a provisional judgment under current evidence and scope.

Never use `proven` or `true` as routine workflow states. Distinguish `supported`, `contradicted`, `mixed`, `inconclusive`, `method-failure`, `refuted`, `revised`, and `superseded`. Missing evidence is not evidence of absence; a failed implementation is not a refuted hypothesis; a paper or search result is not verified evidence merely because it exists.

## Select scientific methods, not a universal pipeline

Before choosing research modes for a new goal, read [foundations/scientific-methods.md](references/foundations/scientific-methods.md). Select the smallest sufficient combination; do not load every method playbook or require every mode.

The method catalog covers:

1. Evidence Synthesis
2. Exploratory Discovery
3. Theory Building
4. Observational Research
5. Experimental Research
6. Computational Research
7. Qualitative & Mixed Methods
8. Method & Artifact Research
9. Reproduction & Replication

A **paper is an output**, not a research mode. An **experiment is one investigation strategy**, not every scientific task's destination. Original-paper work often traverses the full inquiry lifecycle with several backtracks, but only the methods relevant to its question. A bounded experiment-validation request may need only positioning of the target claim, experimental or computational checks, inference, and replication logic.

## Shared inquiry lifecycle

Use one adaptable lifecycle across method combinations:

```text
Orient -> Position -> Formulate -> Strategize -> Investigate
       -> Infer -> Challenge & Revise -> Communicate & Update
       -> Prepare & Submit
```

Stages may be entered selectively when supplied artifacts satisfy earlier dependencies. Dependencies may not be skipped without evidence. Gate outcomes are `advance`, `revise`, `return`, `pivot`, or `stop/hold`; record the reason, evidence, unresolved issue, and smallest next action.

Critical ordering:

- separate the originating topic or observation from interpretation;
- position the question against inspected prior work before substantive design;
- state contribution, feasibility, rival explanations, and falsification direction before freezing a protocol;
- generate or collect evidence before drawing conclusions;
- challenge the preferred explanation before public communication;
- backtrack when novelty, validity, evidence, or inference fails.

Authorship, final ownership, exact run budgets, and protocol configuration do not block early topic positioning unless safety, authorization, or basic feasibility makes them immediately relevant. Resolve them before the action they actually govern.

## Operational playbooks

Load only the playbook needed for the current operation. The names below are routing labels, not a required serial command list.

| Operation | Use | Playbook |
|---|---|---|
| `init` | Establish durable project memory when the user asks for a research workspace | [init.md](references/init.md) |
| `frame` | Turn a topic, observation, tension, or practical problem into candidate questions | [frame.md](references/frame.md) |
| `search` | Run a bounded, reproducible literature or prior-art search | [search.md](references/search.md) |
| `claim` | Maintain claims, hypotheses, rivals, predictions, and evidence needs | [claim.md](references/claim.md) |
| `position` | Assess nearest work, novelty, significance, feasibility, and contribution | [position.md](references/position.md) |
| `design` | Design or freeze a study appropriate to the selected method | [design.md](references/design.md) |
| `experiment` | Execute or ingest a run against an authorized protocol | [experiment.md](references/experiment.md) |
| `analyze` | Analyze evidence and update epistemic states | [analyze.md](references/analyze.md) |
| `iterate` | Refute, revise, replicate, reframe, redesign, or stop | [iterate.md](references/iterate.md) |
| `visualize` | Produce truthful scientific figures or tables | [visualize.md](references/visualize.md) |
| `write` | Draft a scientific output from bounded claims and evidence | [write.md](references/write.md) |
| `review` | Critically review an authorized manuscript, protocol, or study package | [review.md](references/review.md) |
| `venue` | Verify target fit, current CCF classification, official instructions, and strategic constraints | [venue.md](references/venue.md) |
| `submission` | Build and preflight a submission package, stopping before the human-owned external action | [submission.md](references/submission.md) |
| `rebuttal` | Classify reviewer requests and prepare evidence-bound responses without rewriting history | [rebuttal.md](references/rebuttal.md) |
| `audit` | Check project structure and scientific-quality risks when requested | [audit.md](references/audit.md) |

Routing rules:

- An explicit operation sets the requested endpoint; it does not waive scientific dependencies.
- A request to assess an idea normally stops after positioning and feasibility unless the user asks to proceed.
- A request to “write a paper” first determines whether the user means starting research, drafting from existing evidence, revising a manuscript, or writing a theory/position paper.
- A request to validate an existing experiment begins with the target claim, protocol correspondence, and available evidence; it does not automatically restart the entire project.
- A request for a CCF-A paper verifies current CCF classification and venue instructions from primary sources; never rely on an embedded venue list, remembered deadline, or stale format rule.
- A request to submit stops at a verified submission package and explicit human approval. CATAIL never performs the external submission action on its own.
- A request to prove a preferred conclusion preserves rivals and disconfirming evidence.
- Null, contradictory, failed, harmful, and refuting results route to updating or iteration, never repeated testing until favorable.

## Language contract

Manage language per scope:

- **dialogue language:** discussion, alignment, explanations, and feedback;
- **artifact language:** manuscript, abstract, report, review, or other deliverable;
- **source language:** original titles, terms, instruments, and direct quotations;
- **terminology language:** stable project glossary and bilingual mappings.

Priority is current explicit instruction, then declared session preference, then the current prompt's main language, then project default. An instruction that the paper is English does not switch Chinese research discussion to English. Translation must preserve epistemic force: “provisionally supports” cannot become “proves,” non-significance cannot become “no effect,” and association cannot become causation.

## Project memory and stewardship

When the user asks to initialize or maintain a durable research project, use `research/` artifacts as project memory. Read [artifact-contracts.md](references/artifact-contracts.md) only when creating, migrating, or validating those artifacts. Preserve existing equivalent project conventions and user-generated files. Publication projects may add `VENUE.md` and `SUBMISSION.md`; they become required only at the submission gate.

Do not require a `research/` workspace for a review-only, advisory, brainstorming, or one-off synthesis request. Do not create files unless the user requested project work or the requested action clearly requires durable artifacts.

The local structural audit checks shapes and bindings only. It cannot establish truth, novelty, validity, ethics approval, reproducibility, or publication readiness.

## Non-negotiable boundaries

- Never fabricate citations, identifiers, observations, methods, data, results, approvals, authorship, or provenance.
- Never present a hypothesis, search snippet, generated answer, or fluent draft as evidence.
- Never promise novelty, truth, causality, generalization, acceptance, or publication beyond the evidence.
- Preserve negative, null, conflicting, harmful, failed, and inconclusive outcomes.
- Keep confirmatory, exploratory, and post-hoc work distinguishable.
- Do not rewrite a frozen protocol or historical result to make a later idea appear prespecified.
- Keep confidential, unpublished, personal, proprietary, controlled, or security-sensitive material local unless an accountable human authorizes a named destination and scope.
- Stop at applicable ethics, privacy, biosafety, dual-use, legal, institutional, publisher, cost, and external-action gates.
- Accountable humans retain consequential scientific judgment, authorship, submission, and approval decisions.

## Completion

Finish at the user's requested endpoint. Report the current epistemic state, what changed or was learned, the gate decision and reason, the most important remaining uncertainty, and the smallest next action that would reduce it. For project work, also report affected artifact paths and identifiers. Explicitly name material work that is premature at the current stage.

Do not autonomously continue from an idea to an experiment or from a result to a finished paper.
