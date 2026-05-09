# core/agent-dir/ — Multi-Agent Directory Management

> P2 | Parent: ../AGENT.md

---

## Overview

This module provides the core abstractions and utilities for managing multiple Agent instances. It is responsible for resolving agent-specific storage paths, managing `agent.json` metadata, and coordinating data migration between legacy and new file system layouts.

**Key Invariants:**
- Every Agent has a unique ID (ASCII slug) and a corresponding directory.
- `agent.json` is the machine-readable source of truth for an Agent's identity.
- Data migration is "Copy-first" to preserve user data safety.

---

## Member List

### Core Context

`agent-dir-context.ts`: Defines `AgentDirContext` interface and ID validation logic. - [WHO]: AgentDirContext, validateAgentId(), defaultAgentDirContext()

### Metadata Management

`agent-metadata.ts`: Handles `agent.json` read/write operations and automatic initialization. - [WHO]: AgentMetadata, loadAgentMetadata(), saveAgentMetadata(), ensureAgentMetadata()

### Migration Tool

`migration-tool.ts`: Implements the `pencils migrate` command logic with copy-first strategy and state tracking. - [WHO]: MigrationManager, MigrationOptions, MigrationTask

---

## Path Resolution Logic

1. **Explicit ID**: If `--agent <id>` is provided, path is `~/.pencils/agents/<id>/`.
2. **Default ID**: If no ID provided, defaults to `default`.
3. **Backward Compatibility**: If ID is `default` and new path doesn't exist, fall back to legacy `~/.nanopencil/agent/`.

---

**Covenant**: Maintain map-terrain isomorphism. Keep this file aligned with actual structure.
