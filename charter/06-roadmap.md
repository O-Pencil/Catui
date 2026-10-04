# §6 Roadmap

> Phase history, current status, cross-project work-line progress

<!--
[WHO]  Ecosystem evolution roadmap and milestones
[FROM] catui-platform-charter.md §6-§7
[TO]   Each project's development plan
[HERE] charter/06-roadmap.md — roadmap
-->

---

## 6.1 Phase overview

| Phase | Theme | Main projects | Status |
|-------|-------|---------------|--------|
| 1 | Local ACP integration | editor + catui-agent | [x] Done |
| 2 | Agent-service-ification prototype (Rust PCP Server) | editor + catui-agent | [x] Done |
| 3 | Gateway standalone + Asgard integration + editor three modes | 4 core projects | [x] Done (2026-05) |
| 3.5 | Channel phase 1 + Multi-Catui isolation | Gateway + ops | [x] Done (2026-05) |
| 4 | Platform-ification and multi-tenancy | All projects | 🟡 **Current** |
| 5 | Ecosystem-ification and social evolution | All projects | ⚪ Planned |

## 6.2 Phase details

### Phase 1 — Local ACP integration [x]
- Editor introduces the `agent-client-protocol` crate, implements ACP client
- Connects to `catui-agent --acp` as an external Agent
- Frontend event-model adaptation: streaming render, tool calls, permission confirmation available

### Phase 2 — Rust prototype verification [x]
- Define PCP v1 (WebSocket internal protocol)
- Editor main repo builds Rust prototype `src/apps/server/`
- **Key judgment**: the prototype proved the "Agent on the server, tools on the client" architecture feasible, but the Rust server is not the ecosystem mainline — handed off to Catui-Agent-Gateway (Node.js + Hono)

### Phase 3 — Gateway standalone + Asgard integration [x]
- **Gateway**: standalone repo, v0.1 full API surface, Docker image, Multi-Catui isolation
- **Asgard**: CatuiAgentBackend service, CatuiAgent CRUD + Gateway sync + usage logging
- **Editor**: HttpChatProvider landed, three-mode routing (local / service / remote-http)
- **catui-agent**: imported by Gateway as an SDK

### Phase 3.5 — Channel + Multi-Catui [x]
- Gateway incubates Channel adapters (DingTalk Stream / WeChat / Feishu)
- Multi-Catui architecture: `~/.catui/<id>/` independent directory
- Channel long-term belongs to standalone repo `catui-channel-gateway`; currently incubated inside Gateway

### Phase 4 — Platform-ification and multi-tenancy 🟡
Six work-lines (A–F), see §6.3 below.

## 6.3 Phase 4 work-lines

| Line | Theme | Status | Main participants |
|------|-------|--------|-------------------|
| **A** | Tool-callback protocol (Gateway v0.2) | 🟡 In progress | Gateway + Catui + Editor |
| **B** | Billing and usage closed loop | ⚪ Not started | Asgard-led |
| **C** | Container isolation and orchestration | ⚪ Not started | Asgard + ops |
| **D** | Soul/Memory config-center UI | ⚪ Not started | Asgard + Gateway |
| **E** | Channel Gateway repo split | ⚪ Not started | Gateway → new repo |
| **F** | Rust high-performance layer (optional) | ⚪ Not started | Gateway refactor |

### Line A — Tool callback (Gateway v0.2) 🟡

**Goal**: let a remote CatuiAgent call tools that live on the editor's local machine (`read_file` / `write_file` / `bash` / `grep`, etc.).

**Cross-repo milestone table**:

| Repo | Milestone | Status |
|------|-----------|--------|
| Gateway | M-tools-1 (wire protocol + correlation table) | [x] Done |
| Catui | N-tools-1 (types + RemoteToolSource skeleton) | ⏳ Pending start |
| Catui | N-tools-2 (SDK `remoteTools` integration) | ⏳ Pending N-tools-1 |
| Catui | N-tools-3 (real agent-loop e2e) | ⏳ Pending N-tools-2 |
| Gateway | M-tools-2 (CatuiEngineAdapter binding) | ⏳ Cross-repo blocked: depends on N-tools-2 |
| Gateway | M-tools-3 (lifecycle / error-code hardening) | ⏳ Pending M-tools-2 |
| Editor | P1 polish (auth + agent-not-visible UI) | ⏳ Pending Gateway stability |
| Editor | Local-tool registry + SSE handling | ⏳ Pending M-tools-3 |

## 6.4 Strategic principles

1. **Single ontology**: all evolution feedback ultimately accumulates into Catui core parameters
2. **API-first**: outward-facing protocol is HTTP, hiding internal complexity
3. **Social evolution**: Agents collide in game scenarios; conflict data is evolution fuel
4. **Evaluation-driven**: Catui-Evaluate establishes the quantitative feedback loop
5. **Clear host boundaries**: each specific host must own its own permissions and execution boundary
6. **Tool-ify the harness**: Browser Harness is a pluggable tool, not a product host
