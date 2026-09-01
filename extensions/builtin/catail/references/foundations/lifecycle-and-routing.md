# Scientific Lifecycle, Gates, and Task Routing

Read this reference when choosing where a request enters CATAIL, which stages are required, where it must stop, or whether the work should advance, revise, return, pivot, or stop.

## Routing card

For a new goal, determine internally:

```text
intent
target output
current epistemic and artifact state
earliest unmet dependency
selected scientific methods
requested endpoint and stop boundary
dialogue and artifact languages
authority, safety, confidentiality, cost, and external-action limits
```

Show only the parts that help the user verify the route. Do not make the routing card a mandatory form.

## Shared inquiry lifecycle

### 1. Orient

Clarify the originating topic, observation, tension, prior claim, practical problem, replication need, or method opportunity. Separate what was observed from its interpretation and define the intended knowledge change and output.

**Gate:** the important unknown, intended use, scope, and falsification direction are intelligible. If not, revise the question; do not discuss protocol details.

### 2. Position

Inspect relevant prior work and adjacent terminology. Map nearest work, current claims and evidence, disagreement, saturation, and candidate contribution. Evaluate importance, bounded originality, feasibility, and information gain.

**Gate:** explain “relative to what, what is new, why it matters, and whether it can be learned.” If coverage is weak, search more. If the question is saturated, pivot to replication, boundary conditions, contradiction, synthesis, or stop.

### 3. Formulate

Define constructs, core and rival claims, mechanisms, hypotheses, predictions, null or indeterminate outcomes, scope, and observations that would force revision.

**Gate:** the alternatives make meaningfully different observable predictions and the question is answerable. If not, return to positioning or formulation.

### 4. Strategize

Choose the smallest sufficient method combination. Design measurements, sampling or tasks, controls and baselines, inference units, analyses, stopping rules, and a pilot when uncertainty is primarily methodological.

**Gate:** the strategy can distinguish the central claim from serious rivals at acceptable cost and risk. A runnable activity that cannot answer the question does not pass.

### 5. Investigate

Search, observe, interview, compute, experiment, reproduce, or create and validate an artifact according to the chosen modes. Preserve raw observations, provenance, deviations, failures, and negative outcomes.

**Gate:** material evidence has a known source, quality state, scope, and relation to the question. Invalid execution returns to strategy or investigation without being called refutation.

### 6. Infer

Estimate or synthesize what the evidence supports. Separate observations, analyses, explanations, and conclusions. Report effect or relationship magnitude, uncertainty, assumptions, sensitivity, and inferential boundary.

**Gate:** every material conclusion is no stronger than its design and evidence. Otherwise narrow the claim, mark it mixed or inconclusive, or return for better evidence.

### 7. Challenge & Revise

Act as a serious critic. Seek counterexamples, alternative explanations, leakage, measurement failure, hidden selection, invalid independence, boundary conditions, and failed replication. Diagnose whether the problem is theory, construct, design, execution, analysis, or generalization.

**Gate:** the claim has survived an appropriate disconfirmation attempt or has been honestly revised, refuted, withdrawn, or left unresolved. Route changes to an earlier stage with a named uncertainty.

### 8. Communicate & Update

Produce the requested paper, review, report, figure, theory, method, dataset, benchmark, or decision memo. Preserve claim-evidence links, uncertainty, limitations, negative results, and reproducibility information. Update the conclusion when peer review, replication, or new evidence arrives.

**Gate:** the output does not outrun current evidence and a reader can identify what is known, inferred, uncertain, and still human-owned.

## Gate decisions

Use one of five decisions:

- `advance`: sufficient basis exists for the next stage;
- `revise`: stay in the current stage and correct a bounded deficiency;
- `return`: an upstream assumption, position, formulation, or design must change;
- `pivot`: redirect to a more informative output or research type;
- `stop/hold`: continuation is currently unjustified, unsafe, unauthorized, infeasible, or low value.

For a material decision, report:

- satisfied conditions;
- unresolved or failed conditions;
- evidence and reasoning;
- smallest next action;
- work that is premature now.

Do not use numerical gate scores unless a validated domain instrument actually requires them.

## Common routes

| Request | Default route |
|---|---|
| “Is this idea worth studying?” | Orient -> Position; stop with a contribution and feasibility decision |
| “Propose an innovative claim and validate it” | Orient -> Position -> Formulate -> selected investigation -> Infer -> Challenge |
| “Write a paper” with no evidence package | Determine paper type and current state; do not fabricate a completed empirical paper |
| “Write from these results” | Inspect evidence and claim bounds -> Communicate; return to analysis if support is unresolved |
| “Validate this experiment” | Identify target claim and protocol correspondence -> selected validation/replication methods -> Infer |
| “Find papers” | Evidence Synthesis/search; stop at requested coverage or synthesis |
| “Review this manuscript” | Authorization and material boundary -> critical review; do not initialize a project unasked |
| “Design but do not run” | Complete dependencies through Strategize; stop before investigation |
| “Reproduce this paper” | Position target claim -> reproduction type and correspondence -> execution -> discrepancy analysis |

## Progressive interaction

Ask only questions that affect the current gate. Topic positioning may need the originating observation, intended knowledge change, nearest known work, or scope. It normally does not need author order, protocol owner, exact sample size, run budget, or model version.

When the user's requested endpoint lies several stages ahead, continue through satisfied prerequisites without requesting approval at every boundary. Stop when:

- a scientific gate fails;
- source or data access is inadequate;
- the user-defined endpoint is reached;
- material cost, external action, confidentiality, or safety requires authorization;
- consequential human judgment cannot be inferred.

## Explicit stop boundaries

Treat phrases such as these as hard constraints:

- “only assess the topic”;
- “do not search yet”;
- “design but do not execute”;
- “analyze only the existing data”;
- “do not write the paper”;
- “discuss in Chinese; write the manuscript in English”;
- “do not modify files.”

The completion response may name later dependencies, but it must not execute beyond the boundary.

## Project continuity

If durable project artifacts exist, use them to recover the current question, evidence, gate, and unresolved decisions. Do not trust a recorded stage when its prerequisites are absent. Preserve earlier claims, protocols, null results, failures, and revisions rather than rewriting history.
