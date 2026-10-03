# §2 Project Responsibility Boundaries

> What each project is and is not, technology stack, distribution form

<!--
[WHO]  Responsibility definition for each project
[FROM] catui-platform-charter.md §3 + PROJECT_OVERVIEW.md §四
[TO]   Each project's README, 03-relations
[HERE] charter/02-boundaries.md — responsibility boundaries
-->

---

## 2.1 Core layer

### Catui — Core mind runtime

| Dimension | Definition |
|-----------|------------|
| **Is** | The Agent engine itself; provides model conversation, tool loop, memory system, Soul evolution, MCP integration, Browser Harness; embedded via the `@catui/agent` SDK, or run directly as the `catui` CLI; exposes the ACP protocol for host integration |
| **Is not** | Does not expose HTTP API; does not handle API Keys / multi-tenant / billing; is not "an Agent" — it is "an engine that makes Agents" |
| **Stack** | Node.js + TypeScript + React TUI |
| **Distribution** | npm: `@catui/agent`; binary: `catui` CLI |
| **Repository** | `O-Pencil/Catui` |

**Core capabilities**:
- **NanoMem**: persistent memory engine, cross-session memory accumulation
- **NanoSoul**: personality-evolution engine, adaptive character growth
- **Agent Core**: state management and transport layer
- **AI Core**: unified model interface layer (Anthropic / OpenAI / Gemini / DashScope / Ollama)
- **Tool Extensions**: file system, Shell, MCP, link-world, Browser Harness — pluggable tools

### Catui-Agent-Gateway — PAAS gateway layer

| Dimension | Definition |
|-----------|------------|
| **Is** | HTTP serving layer; hosts multiple CatuiAgent instances; OpenAI-compatible API + SSE; EngineAdapter abstraction makes the engine swappable; CATUIS_HOME isolates multiple Catuis; Channel sub-module (DingTalk / WeChat / Feishu) |
| **Is not** | Not the engine itself (import catui-agent); does not handle user system / billing / Marketplace (that's Asgard); does not directly serve end-user writing UI (that's editor) |
| **Stack** | Node.js + Hono |
| **Distribution** | Docker image; production deployment bound to 127.0.0.1 + nginx reverse proxy |
| **Repository** | `O-Pencil/Catui-Agent-Gateway` |

---

## 2.2 Orchestration layer

### O-Mesh — multi-agent orchestration engine

| Dimension | Definition |
|-----------|------------|
| **Is** | Multi-agent collaboration engine; task decomposition and scheduling; Blackboard horizontal-communication protocol; tree + horizontal communication modes |
| **Is not** | Does not implement an Agent engine (schedules Catui); does not expose HTTP API to end users (serves indirectly through Gateway) |
| **Stack** | Rust |
| **Distribution** | CLI tool |
| **Repository** | `O-Catui/O-Mesh` |

---

## 2.3 Evaluation layer

### Catui-Evaluate — Agent evaluation framework

| Dimension | Definition |
|-----------|------------|
| **Is** | LLM evaluation framework (similar to Pytest but specialized for LLM); multi-dimensional metrics (Task Completion / Tool Correctness / Goal Accuracy / Knowledge Retention / Plan Adherence); benchmark + report generation |
| **Is not** | Does not implement Agent features; does not directly modify Agent parameters (produces reports; humans / AI decide how to optimize) |
| **Stack** | Python + DeepEval |
| **Distribution** | PyPI package |
| **Repository** | `O-Pencil/Catui-Evaluate` |

**Evaluation dimensions**:

| Metric | Description |
|--------|-------------|
| Task Completion | Whether the Agent completes the user's specified task |
| Tool Correctness | Whether tool calls (file ops, bash, etc.) are correct |
| Step Efficiency | Whether the task is completed without unnecessary steps |
| Knowledge Retention | Memory system's knowledge retention capability |
| Answer Relevancy | How relevant the response is to the user's question |
| Plan Adherence | Whether execution follows the orchestrated plan |

---

## 2.4 Platform layer

### Asgard-platform — user platform layer

| Dimension | Definition |
|-----------|------------|
| **Is** | Multi-Agent management platform; user system, API Key management, CatuiAgent CRUD, usage recording, billing policy, Agent Marketplace, Developer Console; proxies via HTTP to Gateway |
| **Is not** | Does not implement the Agent engine; does not implement the HTTP serving protocol; does not directly manage container processes (orchestration is phase-4 work-line C) |
| **Stack** | FastAPI + PostgreSQL + JWT/SSE (backend); React 19 + Vite + TailwindCSS 4 (frontend) |
| **Distribution** | Docker compose; render.yaml |
| **Repository** | `O-Catui/Asgard-platform` (contains submodules Asgard-api / Asgard-web) |

---

## 2.5 Expression layer

### catui-editor — authoring expression layer

| Dimension | Definition |
|-----------|------------|
| **Is** | AI-native writing editor; Desktop App + Web IDE; three-mode routing (local ACP / internal WS / remote HTTP); rich-text editing + workspace management + Spark Design |
| **Is not** | Does not build Agent-instance management; does not implement HTTP server; does not replicate Asgard's CatuiAgent creation UI |
| **Stack** | Rust + Tauri + React/TypeScript |
| **Distribution** | Tauri Desktop bundle (NSIS/MSI); Web build |
| **Repository** | `O-Pencil/catui-editor` |

### Catui-Game — social-game expression layer

| Dimension | Definition |
|-----------|------------|
| **Is** | Agents collide and evolve in game-theoretic scenarios; social deduction / Werewolf-style games; multi-agent strategy games |
| **Is not** | Not a general-purpose game engine; does not implement an Agent engine |
| **Stack** | Next.js + React |
| **Distribution** | Web app (Vercel) |
| **Repository** | `O-Pencil/Catui-Game` |

### Catui-Lesson — knowledge-acquisition expression layer

| Dimension | Definition |
|-----------|------------|
| **Is** | Structured learning and knowledge accumulation; AI-driven personalized learning paths |
| **Is not** | Not an LMS (Learning Management System); does not implement an Agent engine |
| **Stack** | Next.js + React |
| **Distribution** | Web app |
| **Repository** | `O-Pencil/Catui-Lesson` |

### Catui-Terminal — embodied environment

| Dimension | Definition |
|-----------|------------|
| **Is** | Physical-world anchor; file / Git / Shell operations; collaborates with Catui to provide complete embodiment |
| **Is not** | Not an Agent engine; not an IDE (editing capability is provided by editor) |
| **Stack** | Go + Electron + TypeScript |
| **Distribution** | Desktop application |
| **Repository** | `O-Pencil/Catui-Terminal` |

---

## 2.6 Infiltration layer

### Catui-Eidolon — browser-side clone

| Dimension | Definition |
|-----------|------------|
| **Is** | Catui's "phantom clone" in the browser; page sensing, DOM manipulation, Side-Panel interaction; dual-mode (local Native Messaging → Catui; cloud OpenAI-compatible API → Gateway); site authorization and user confirmation |
| **Is not** | Not a browser-automation tool (that's Catui's Browser Harness); does not implement an Agent engine; does not expose HTTP API |
| **Stack** | React + TypeScript + Chrome Manifest V3 (Edge compatible) |
| **Distribution** | Chrome Web Store / Edge Add-ons |
| **Repository** | `O-Pencil/Catui-Eidolon` |

**Boundary with Catui**:
- `Catui` is the Kernel, providing models, memory, personality, planning, and reasoning
- `Catui-Eidolon` is the browser host, owning page context, site authorization, DOM/Debugger operations, and side-panel experience
- Browser Harness is callable directly by Catui in terminal / CLI scenarios; in Eidolon scenarios browser actions must be arbitrated by Eidolon
- `link-world` / `web_search` belong to network-retrieval paths; real page interaction, login state, screenshot, filling-in belong to Eidolon

---

## 2.7 Project quick-reference matrix

| Project | Layer | Stack | Distribution form | GitHub |
|---------|-------|-------|-------------------|--------|
| Catui | Ontology | Node.js + TS | npm / CLI | O-Pencil/Catui |
| Catui-Agent-Gateway | Gateway | Node.js + Hono | Docker | O-Pencil/Catui-Agent-Gateway |
| O-Mesh | Orchestration | Rust | CLI | O-Catui/O-Mesh |
| Catui-Evaluate | Evaluation | Python + DeepEval | PyPI | O-Pencil/Catui-Evaluate |
| Asgard-platform | Platform | FastAPI + React | Docker compose | O-Catui/Asgard-platform |
| catui-editor | Expression | Rust/Tauri + React | Desktop / Web | O-Pencil/catui-editor |
| Catui-Eidolon | Infiltration | React + Chrome MV3 | Browser Extension | O-Pencil/Catui-Eidolon |
| Catui-Game | Expression | Next.js + React | Web | O-Pencil/Catui-Game |
| Catui-Lesson | Expression | Next.js + React | Web | O-Pencil/Catui-Lesson |
| Catui-Terminal | Embodiment | Go + Electron | Desktop | O-Pencil/Catui-Terminal |
