# §4 Glossary

> Canonical term definitions for the Catui ecosystem. Project-internal docs MUST use these definitions when referring to these terms.

<!--
[WHO]  Cross-ecosystem unified term definitions
[FROM] catui-platform-charter.md §4 + PROJECT_OVERVIEW.md
[TO]   All project documentation
[HERE] charter/04-glossary.md — glossary
-->

---

## 4.1 Project and product names

| Term | Canonical definition | Common confusion |
|------|----------------------|------------------|
| **Catui** | Ecosystem brand name; generic reference to Agent capability. "Call Catui" = "call some CatuiAgent". Not a single project | OK in marketing copy; technical docs prefer CatuiAgent |
| **Catui** | Engine project; repo name (PascalCase). Contains `@catui/agent` SDK + `catui` CLI | [ ] Catui ≠ "an Agent"; it is an engine |
| **catui-agent** | npm package name (kebab-case): `@catui/agent` | "The SDK imported by Gateway" refers to this term |
| **catui** | CLI command name (all lowercase): `catui` | Command-line entry after global install |
| **CatuiAgent** | Configured runtime unit: `engine + Soul + memory + model + personality`. Has identity, identified by `catui/<agent-id>` | [ ] CatuiAgent ≠ the Catui project |
| **Catui-Agent-Gateway** | HTTP middleware project / repo / service name | Old name `catui-gateway` deprecated |
| **Asgard Platform** | Multi-Agent platform project (includes Asgard-api + Asgard-web) | "asgard" / "Asgard" are equivalent |
| **catui-editor** | Writing client project / repo | Alias "editor" |
| **Catui-Eidolon** | Browser-side clone plugin (Eidolon = clone / phantom) | Chrome/Edge MV3 |
| **O-Mesh** | Multi-Agent orchestration engine | Orchestrator + Blackboard |
| **Catui-Evaluate** | Agent evaluation framework | Python + DeepEval |

## 4.2 Architectural concepts

| Term | Canonical definition |
|------|----------------------|
| **EngineAdapter** | Abstraction over engines inside Gateway; current implementation is `CatuiEngineAdapter` |
| **RemoteToolTransport** | Callback interface inside the catui-agent SDK; enables the "caller owns the tool runtime" pattern |
| **ToolCorrelation** | Process-level table inside Gateway; correlates SSE `catui.tool_request` with HTTP POST `tool_response` |
| **Soul** | Personality-description module inside the engine (`catui-soul`); includes system prompt, style tags, behavior defaults |
| **NanoMem** | Persistent memory engine (`catui-mem`); cross-session memory accumulation and retrieval |
| **CATUIS_HOME** | Filesystem root convention: `~/.catui/` (overridable via env var `CATUIS_HOME`). Each CatuiAgent has its own `agents/<id>/` slot |
| **PAAS** | Catui as a Service — service-delivery model of Agent infrastructure centered on "digital life" |

## 4.3 Protocols

| Term | Canonical definition |
|------|----------------------|
| **ACP** | Agent Coding Protocol — inter-process protocol between editor / IDE and catui-agent CLI child process |
| **PCP** | Catui Client Protocol — WebSocket internal protocol between editor and Rust Server (phase-2 prototype) |
| **OpenAI-compatible API** | Gateway's outward-facing protocol family: `/v1/chat/completions` + `/v1/models` + `/v1/agents` + SSE |
| **Catui Tool Callback** | Work-line A tool return — Gateway → caller via SSE, caller → Gateway via HTTP POST |
| **Channel protocol** | Third-party IM adaptation — DingTalk Stream / WeChat XML / Feishu events → Gateway |
| **Blackboard** | O-Mesh-provided horizontal communication mechanism; KV + pub/sub pattern |

## 4.4 Layer terminology

| Term | Meaning |
|------|---------|
| **Ontology layer** | Catui — Agent engine core |
| **Gateway layer** | Catui-Agent-Gateway — HTTP service-ification |
| **Orchestration layer** | O-Mesh — multi-Agent collaborative scheduling |
| **Evaluation layer** | Catui-Evaluate — capability measurement |
| **Platform layer** | Asgard-platform — user entry point |
| **Expression layer** | Editor / Game / Lesson — scenario-specific applications |
| **Infiltration layer** | Catui-Eidolon — browser-side clone |
| **Embodiment layer** | Catui-Terminal — physical-world operations |

## 4.5 Deprecated terms

| Term | Status | Replacement |
|------|--------|-------------|
| `catui-gateway` | [ ] Deprecated | Catui-Agent-Gateway |
| `catui-agent` (as project name) | **Warning:** Confusing | `catui-agent` refers only to the npm package name; use Catui for the project |
