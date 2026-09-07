# core/session/

> P2 | Parent: ../AGENT.md

Member List
session-manager.ts: SessionManager class, session state persistence to JSONL, handles forking/branching/switching, key types: SessionEntry, SessionBranch, SessionMetadata, key invariant: one JSONL file per session with append-only writes; rolls back in-memory entries and branch pointer on persistence failure

Rule: Members complete, one item per line, parent links valid, precise terms first

[COVENANT]: Update this file header on changes and verify against parent AGENT.md
