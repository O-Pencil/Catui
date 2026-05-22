# Cognitive Map Architecture Draft

> P1.5 | Parent: `AGENT.md`
> Type: Experimental Architecture Draft
> Status: Proposed
> Scope: DIP x NanoMem x Cognitive Map
> Purpose: Upgrade from passive retrieval to active understanding
> Isomorphism Rule: Cognitive map structures must be traceable to both DIP coordinates and memory evidence
> Verification Rule: Every prediction made by the map must be falsifiable by later tool/file/session outcomes

## Identity

This draft defines a cognitive-map architecture for nanoPencil that combines:
1. DIP as the project's structural coordinate system
2. NanoMem as the long-term experience substrate
3. Graph-based reasoning as the bridge from retrieval to active understanding

The goal is not to build a decorative knowledge graph.
The goal is to make the agent:
- locate relevant structure faster
- recall experience by structural position, not only text similarity
- predict likely impact before acting
- consolidate successful reasoning paths into reusable procedures

## WHO

Provides:
- cognitive map layering model
- node/edge model
- runtime flow for map-first recall
- prediction and consolidation loop
- phased implementation plan
- evaluation criteria

## FROM

Depends on:
- DIP P1/P2/P3 contracts for project topology
- `mem-core` V1/V2 memory stores for episodic/semantic/procedural memory
- existing graph linking and recall infrastructure
- tool execution traces and session outcomes

## TO

Consumed by:
- memory architecture design
- extension/runtime integration planning
- future `mem-core` schema evolution
- recall/prediction experiments
- DIP-aware agent behaviors

## HERE

Conceptual layer between `AGENT.md` and `packages/mem-core`.
It does not replace DIP or NanoMem.
It coordinates them.

## Core Thesis

DIP is not yet a cognitive map.
DIP is the coordinate system of the terrain.

NanoMem is not yet active understanding.
NanoMem is the experience substrate.

A cognitive map emerges only when the agent can:
- anchor memory onto structural coordinates
- traverse neighboring structure and memory jointly
- predict effects before edits
- revise the map when predictions fail

---

## Architecture Overview

### Layer 1: Terrain Map
Represents the project as an external structured world.

Primary source:
- P1 root charter
- P2 module maps
- P3 file contracts
- imports/exports
- file/module boundaries

Main purpose:
- answer "where am I in the project?"
- answer "what surrounds this file/module/symbol?"
- constrain recall to structurally plausible regions

### Layer 2: Memory Map
Represents the agent's accumulated experience.

Primary source:
- episodes
- facets
- semantic memories
- procedural memories
- conflict records
- reinforcement history

Main purpose:
- answer "what have I learned before?"
- answer "what usually works or breaks here?"
- preserve temporal and experiential knowledge

### Layer 3: Bridge Map
Maps internal experience onto external structure.

Primary source:
- DIP anchors inferred from touched files/modules/symbols
- tool traces
- P3 WHO/FROM/TO relations
- session outcome summaries

Main purpose:
- answer "what did I learn about this exact structural area?"
- answer "which memories are relevant because they belong near this target?"
- enable map-first recall and impact prediction

---

## Canonical Objects

### 1. DIP Coordinate

A normalized structural address for project terrain.

```ts
interface DipCoordinate {
  p1?: string;
  p2?: string;
  p3?: string;
  symbol?: string;
  invariant?: string;
  workspacePath?: string;
  modulePath?: string;
  filePath?: string;
}
```

Examples:
- root charter
- `core/runtime`
- `core/runtime/agent-session.ts`
- `AgentSession`
- `session persistence invariant`

### 2. Terrain Node

```ts
interface TerrainNode {
  id: string;
  kind: "root" | "module" | "file" | "symbol" | "invariant" | "workflow";
  label: string;
  dip: DipCoordinate;
  summary: string;
  evidence: string[];
  updatedAt: string;
}
```

### 3. Terrain Edge

```ts
interface TerrainEdge {
  id: string;
  fromId: string;
  toId: string;
  type:
    | "contains"
    | "depends-on"
    | "consumed-by"
    | "implements"
    | "constrains"
    | "adjacent-to"
    | "violates"
    | "updates-with";
  weight: number;
  explicit: boolean;
}
```

### 4. Memory Anchor

Attach memory to terrain.

```ts
interface MemoryAnchor {
  memoryId: string;
  memoryKind: "episode" | "facet" | "semantic" | "procedural";
  dip: DipCoordinate;
  confidence: number;
  inferredFrom: Array<"tool-trace" | "file-path" | "p3-header" | "symbol-mention" | "manual-link">;
}
```

### 5. Prediction Record

Used to turn the map into a falsifiable system.

```ts
interface PredictionRecord {
  id: string;
  seedDip: DipCoordinate;
  predictedNodeIds: string[];
  rationale: string[];
  confidence: number;
  sessionId: string;
  createdAt: string;
  validatedAt?: string;
  hits?: string[];
  misses?: string[];
  falsePositives?: string[];
}
```

---

## Required New Concept

## Structural Salience

Current memory ranking uses recency, importance, relevance.
That is necessary but insufficient.

Add a fourth retrieval factor:

```ts
structuralSalience =
  terrainProximity(targetDip, memoryAnchor.dip)
  + bridgeConfidence
  + localFailureHistoryBoost
  + procedureApplicabilityBoost
```

This changes recall from:
- "text looks similar"

to:
- "this memory lives near the area currently being worked on"

---

## Runtime Flow

## A. Map Construction

### A1. Terrain ingestion
Build terrain graph from DIP and code structure.

Inputs:
- P1 charter
- P2 member lists
- P3 file headers
- imports/exports
- optional symbol indexing

Output:
- terrain nodes
- terrain edges
- normalized DIP coordinates

### A2. Memory anchoring
When a session finishes or a turn produces meaningful work:
- inspect touched files
- inspect tools used
- inspect episode summary/facets/procedures
- infer nearest DIP coordinate
- write `MemoryAnchor`

Output:
- anchored episodic memory
- anchored procedural memory
- anchored lessons/preferences if applicable

## B. Recall

### B1. Target localization
Before agent execution:
- infer target DIP from prompt, current cwd, mentioned files, likely module
- identify 1 primary node and a small neighborhood

### B2. Map-first recall
Recall order:
1. memories directly anchored to target DIP
2. memories anchored to neighboring terrain nodes
3. structurally linked procedures
4. semantic/embedding recall as fallback expansion

This is the core inversion:
- structure-first
- semantics-second

### B3. Injection
Inject:
- relevant terrain summary
- anchored memories
- likely impact neighbors
- reusable procedures
- unresolved conflicts in this region

The injection should explicitly distinguish:
- known structure
- learned experience
- uncertain prediction

## C. Prediction

Before edits, generate:
- likely affected files/modules
- likely invariants at risk
- likely procedure to follow
- confidence + rationale

This must produce a machine-checkable prediction record.

## D. Validation

After tool execution/session shutdown:
- compare touched files against predictions
- compare failures/successes against predicted invariants
- reinforce accurate links
- demote inaccurate links
- consolidate repeated success paths into procedures

---

## Behavioral Upgrade Path

## Stage 0: Passive Retrieval
Current state is close to this:
- retrieve by tags, recency, semantic similarity
- inject summaries
- limited graph expansion

## Stage 1: Anchored Retrieval
New behavior:
- memory is tied to DIP coordinates
- recall starts from structure
- project-local memories become easier to retrieve

## Stage 2: Predictive Retrieval
New behavior:
- before acting, agent forecasts likely impact neighborhood
- recall includes "what usually breaks here"

## Stage 3: Procedural Generalization
New behavior:
- repeated successful repairs in one terrain zone become reusable procedural memories
- agent begins to say not only "what happened" but "how this area should be handled"

## Stage 4: Reflective Map Revision
New behavior:
- wrong predictions alter graph weights
- inconsistent DIP/memory links are surfaced as alignment issues
- the map becomes self-correcting

---

## Minimal Integration Plan

## Phase 1: DIP Anchor Schema
Add `dipRef` or `anchor` metadata to V2 memory.

Target:
- episode
- facet
- semantic
- procedural

Minimum fields:
- `filePath`
- `modulePath`
- `p3`
- `symbol?`
- `confidence`

Goal:
- enable structure-aware recall without rewriting the full engine

## Phase 2: Terrain Graph Index
Build a lightweight terrain index from DIP.

Store:
- file node
- module node
- P3 WHO/FROM/TO relationships
- adjacency derived from P2/P3 and imports

Goal:
- unify structural lookup into one queryable graph

## Phase 3: Map-first Recall Pipeline
In `before_agent_start`:
1. infer target DIP
2. retrieve nearby terrain nodes
3. recall anchored memories
4. merge with current semantic recall
5. inject structured context

Goal:
- experimentally compare against current recall quality

## Phase 4: Prediction Loop
Before major edits:
- produce impact prediction
After execution:
- score prediction quality

Goal:
- create a measurable path from retrieval to active understanding

## Phase 5: Procedure Synthesis
When multiple successful episodes cluster on the same terrain region:
- synthesize procedural memory
- attach it to the same DIP neighborhood

Goal:
- convert repeated local experience into reusable local expertise

---

## Suggested Storage Evolution

Do not replace current NanoMem stores immediately.
Extend them.

### Terrain Store
Separate store recommended.

```ts
interface TerrainSnapshot {
  nodes: TerrainNode[];
  edges: TerrainEdge[];
  generatedAt: string;
  sourceVersion: string;
}
```

### Anchor Store
Can be embedded into V2 memory entries or split out.

```ts
interface MemoryAnchorIndex {
  anchors: MemoryAnchor[];
  updatedAt: string;
}
```

### Prediction Store
Session-local then persisted.

```ts
interface PredictionLog {
  records: PredictionRecord[];
}
```

---

## Retrieval Strategy

Use a hybrid ranking formula:

```ts
finalScore =
  semanticScore * 0.25
  + recencyScore * 0.15
  + importanceScore * 0.15
  + structuralSalience * 0.30
  + proceduralApplicability * 0.15
```

Interpretation:
- semantic match is still useful
- but structure gets first-class weight
- procedures become more important when the target region is known

---

## Failure Modes

### 1. Over-anchoring
A memory gets linked to the wrong module/file.
Result:
- false confidence
Mitigation:
- store anchor confidence
- allow multiple candidate anchors
- decay weak anchors

### 2. Graph explosion
Too many nodes/edges make recall noisy.
Mitigation:
- keep terrain graph coarse at first
- prefer file/module nodes before symbol-level nodes
- add symbol-level anchoring later

### 3. Frozen map
DIP docs drift, map becomes stale.
Mitigation:
- terrain graph generation tied to DIP verification
- stale nodes marked with lower confidence

### 4. Overfitting to local history
Agent keeps recalling old local fixes that no longer apply.
Mitigation:
- procedural status: active/draft/deprecated/superseded
- validation feedback updates weights

---

## Evaluation Criteria

This project is only worth continuing if it improves one or more of these:

### Retrieval Quality
- fewer irrelevant memory injections
- more task-local memories recalled

### Planning Quality
- better pre-edit impact forecasts
- fewer missed companion files

### Repair Quality
- higher success rate on repeated architecture regions
- lower repeated failure count in same module

### Explainability
- agent can state:
  - where it is operating
  - what prior knowledge applies here
  - why it predicts adjacent changes

---

## Experimental Benchmarks

Run A/B comparisons between:
- current semantic recall
- map-first recall

Measure:
- retrieval precision near target module
- number of correct predicted neighbor files
- number of unnecessary recalled memories
- completion quality on repeated repo tasks

Representative tasks:
- modify session lifecycle behavior
- extend extension hooks
- change model/runtime switching
- update memory injection behavior

---

## Design Decision

The first production-worthy version should prioritize:
- file/module-level terrain nodes
- anchored episodic/procedural memories
- prediction logging

It should not yet prioritize:
- full symbol graph
- personality-driven map mutation
- abstract self-modeling

Reason:
The shortest path to value is better structural recall and better impact prediction.

---

## Covenant

The cognitive map must remain auditable.

Every important recall should answer:
- which terrain node triggered this?
- which memory was anchored there?
- why was it considered relevant?
- what prediction did it produce?
- was that prediction later validated?

If the map cannot explain itself, it is not a cognitive map.
It is only hidden retrieval.

## Summary

The implementable version is:

1. Build a terrain graph from DIP
2. Anchor NanoMem entries onto terrain coordinates
3. Recall memory by structural neighborhood before semantic fallback
4. Predict likely impact before edits
5. Validate predictions after execution
6. Consolidate repeated success paths into local procedures

That is the minimal path from passive retrieval to active understanding.
