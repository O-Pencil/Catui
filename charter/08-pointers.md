# §8 Per-Repo Documentation Pointers

> The Charter does not duplicate implementation details; it only provides jump-links. Overview of each project's local `docs/` layout.

<!--
[WHO]  Navigation index for each project's documentation
[FROM] catui-platform-charter.md §9 + each project's docs/ scan
[TO]   Each project's README
[HERE] charter/08-pointers.md — documentation pointers
-->

---

## 8.1 Catui

**GitHub**: [O-Pencil/Catui](https://github.com/O-Pencil/Catui)

| Topic | Doc |
|-------|-----|
| Project navigation | `AGENTS.md` |
| Product-personality charter | `.CATUI.md` |
| Multi-Catui file-system design | `docs/multi-agent-fs-design.md` |
| Remote-tool-callback SDK interface | `docs/remote-tool-register-design.md` |
| SDK usage guide | `docs/SDK.md` |
| SDK testing | `docs/SDK-TESTING.md` |
| ACP protocol integration | `docs/ACP协议集成开发文档.md` |
| MCP integration guide | `docs/MCP集成指南.md` |
| MCP quick reference | `docs/MCP快速参考.md` |
| Memory system | `docs/mem-core技术文档.md` |
| Evaluation framework | `docs/eval/` |
| Startup performance optimization | `docs/startup-performance-optimization.md` |
| This ecosystem charter | `charter/` |

## 8.2 Catui-Agent-Gateway

**GitHub**: [O-Pencil/Catui-Agent-Gateway](https://github.com/O-Pencil/Catui-Agent-Gateway)

| Topic | Doc |
|-------|-----|
| Product boundary / dual deployment | `docs/00-product-boundary.md` |
| Development plan / milestones | `docs/01-development-plan.md` |
| OpenAI-compatible API contract | `docs/02-api-contract.md` |
| EngineAdapter architecture | `docs/03-adapter-architecture.md` |
| Asgard / Editor integration | `docs/04-asgard-editor-integration.md` + `docs/10-editor-integration-guide.md` |
| Caller runtime | `docs/05-caller-runtime.md` |
| Glossary (Gateway-internal) | `docs/06-glossary.md` |
| catui-agent integration | `docs/07-m7-catui-agent-integration.md` |
| Channel integration | `docs/13-channel-integration.md` + `docs/14-multi-catui-architecture.md` |
| Multi-Catui playbook | `docs/16-catui-storage-layout.md` |
| **Tool-callback protocol v0.2** | `docs/18-tool-callback-protocol-v0.2.md` |

## 8.3 Asgard-platform

**GitHub**: [O-Catui/Asgard-platform](https://github.com/O-Catui/Asgard-platform)

| Topic | Doc |
|-------|-----|
| Platform overview | `README.md` |
| Backend architecture review | `packages/api/ARCHITECTURE_REVIEW.md` (Asgard-api submodule) |
| Backend development plan | `packages/api/DEVELOPMENT_PLAN.md` |
| Frontend PRD | `packages/web/PRD.md` (Asgard-web submodule) |

### Submodules

| Submodule | GitHub | Description |
|-----------|--------|-------------|
| Asgard-api | [O-Catui/Asgard-api](https://github.com/O-Catui/Asgard-api) | FastAPI backend |
| Asgard-web | [O-Catui/Asgard-web](https://github.com/O-Catui/Asgard-web) | React frontend |

## 8.4 catui-editor

**GitHub**: [O-Pencil/catui-editor](https://github.com/O-Pencil/catui-editor)

| Topic | Doc |
|-------|-----|
| Application-layer roadmap | `docs/technical-proposals/catui-platform-roadmap.md` |
| Remote-HTTP provider design | `docs/technical-proposals/remote-http-chat-provider-design.md` |
| Writing-Agent orchestration seams | `docs/technical-proposals/writing-agent-orchestration-seams.md` |
| Platform budget API requirements | `docs/technical-proposals/platform-budget-api.md` |
| ACP integration | `docs/acp-integration-followups.md` |
| PCP internal protocol (legacy) | `docs/technical-proposals/catui-client-protocol.md` |

## 8.5 O-Mesh

**GitHub**: [O-Catui/O-Mesh](https://github.com/O-Catui/O-Mesh)

| Topic | Doc |
|-------|-----|
| Product definition | `PRD.md` |
| API docs | `DOCS/API.md` |
| Development guide | `DOCS/DEVELOPMENT.md` |
| Agent coordination mechanism | `DOCS/AGENT-COORDINATION.md` |
| Event system | `DOCS/EVENTS.md` |
| Suggestion system | `DOCS/SUGGEST.md` |

## 8.6 Catui-Evaluate

**GitHub**: [O-Pencil/Catui-Evaluate](https://github.com/O-Pencil/Catui-Evaluate)

| Topic | Doc |
|-------|-----|
| Eval framework overview | `README.md` |
| Benchmark usage | `BENCHMARK_USAGE.md` |
| Eval-metric docs | `docs/guides/` + `docs/integrations/` |

## 8.7 Catui-Eidolon

**GitHub**: [O-Pencil/Catui-Eidolon](https://github.com/O-Pencil/Catui-Eidolon)

| Topic | Doc |
|-------|-----|
| Installation guide | `INSTALL.md` |
| Catui + Harness architecture | `docs/eidolon-catui-harness-architecture.md` |
| SDK integration report | `docs/catui-sdk-integration-report.md` |
| Theme system | `docs/theme/` |

## 8.8 Catui-Game

**GitHub**: [O-Pencil/Catui-Game](https://github.com/O-Pencil/Catui-Game)

| Subproject | Description |
|------------|-------------|
| `novel-studio/` | Novel-creation workbench |
| `Philosophical-Studio/` | Philosophical-thinking workbench |
| `werewolf/` | Werewolf game-theoretic scenario |

## 8.9 Catui-Lesson

**GitHub**: [O-Pencil/Catui-Lesson](https://github.com/O-Pencil/Catui-Lesson)

A Next.js-based knowledge-learning platform; see the repo's README for details.

## 8.10 Catui-Terminal

**GitHub**: [O-Pencil/Catui-Terminal](https://github.com/O-Pencil/Catui-Terminal)

A terminal application built on Go + Electron; see the repo's README for details.

---

## Local links

For local development, the `charter/links/` directory contains junction links pointing to each sibling project (gitignored):

```bash
# Create local links (Windows)
mkdir charter\links
mklink /J charter\links\gateway   ..\..\Catui-Agent-Gateway
mklink /J charter\links\asgard    ..\..\Asgard-platform
mklink /J charter\links\editor    ..\..\catui-editor
mklink /J charter\links\o-mesh    ..\..\O-Mesh
mklink /J charter\links\evaluate  ..\..\Catui-Evaluate
mklink /J charter\links\eidolon   ..\..\Catui-Eidolon
mklink /J charter\links\game      ..\..\Catui-Game
mklink /J charter\links\lesson    ..\..\Catui-Lesson
mklink /J charter\links\terminal  ..\..\Catui-Terminal
```
