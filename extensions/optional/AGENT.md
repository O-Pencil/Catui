# extensions/optional/

> P2 | Parent: ../AGENT.md

Member List
export-html/index.ts: HTML export extension, exportSessionToHtml/exportFromFile, /export command
simplify/index.ts: Simplification extension, /simplify style refactoring tool
evolution/types.ts: Extension-local artifact, candidate, evidence, revision, and pointer contracts
evolution/schema.ts: Pure declarative proposal validation and untrusted-content safety rules
evolution/paths.ts: Confined evolution/v1 scope paths and canonical workspace hashing
evolution/store.ts: Immutable candidate/revision persistence, atomic activation, history, and rollback
evolution/workflow.ts: Pure candidate state transitions and validation evidence gates
evolution/prompts.ts: Bounded/redacted refinement prompts and structured proposal schema
evolution/index.ts: Opt-in /refine command plus promoted prompt/resource consumption hooks
evolution/README.md: Operator guide for modes, inspection, approval, and rollback

Rule: Members complete, one item per line, parent links valid, precise terms first

[COVENANT]: Update this file header on changes and verify against parent AGENT.md
