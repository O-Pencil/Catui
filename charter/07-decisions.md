# §7 Cross-Project Decision Log

> Major decisions that affect multiple repositories

<!--
[WHO]  Authoritative record of cross-project decisions
[FROM] catui-platform-charter.md §8
[TO]   Each project's architecture docs
[HERE] charter/07-decisions.md — decision log
-->

---

## 7.1 D-1 — Five decisions for Line-A tool-callback protocol (2026-05-20)

**Authoritative source**: Catui-Agent-Gateway `docs/18` §16. This table is the concise version.

| # | Question | Decision | Reason |
|---|----------|----------|--------|
| 1 | Parallel tool calls? | **Serial**. Same `(agentId, sessionId)` only allows one pending tool call at a time | Editor-side tool runtime (FS lock, bash process) is calmer with a serial mental model |
| 2 | Caller heartbeat? | **No**. Caller sets sufficient `timeout_ms`; Gateway enforces it | A third status message adds pointless complexity |
| 3 | Does Asgard proxy `tool_response`? | **Yes**. editor → Asgard → Gateway | Single audit chain + single key boundary |
| 4 | Cap `arguments` at 256 KiB? | **Yes, symmetric**. `tool_payload_too_large` covers both inbound and outbound | Prevents one-sided abuse |
| 5 | Explicit event when session lost? | **Yes**. SSE `event: catui.session_lost` + `[DONE]`; subsequent POST returns 410 | Lets UI distinguish "network lost" from "server cleared session" |

---

## 7.2 D-2 — Rust Server not on the ecosystem mainline (2026-05, end of phase 2)

| Dimension | Decision |
|-----------|----------|
| **Judgment** | The Rust `src/apps/server/` prototype does not continue as an ecosystem mainline service |
| **Replacement** | The ecosystem mainline service is handed to Catui-Agent-Gateway (Node.js + Hono) |
| **Reason** | The prototype proved the "Agent on the server, tools on the client" architecture feasible, but full-stack Rust maintenance cost is too high |
| **Impact** | `packages/catui-client-sdk/` is downgraded to editor PCP-mode internal dependency |

---

## 7.3 D-3 — Outward mainline protocol is HTTP + SSE (2026-05, start of phase 3)

| Dimension | Decision |
|-----------|----------|
| **Judgment** | The outward mainline protocol is OpenAI-compatible HTTP + SSE + API Key |
| **Rejected** | PCP WebSocket is not promoted externally |
| **Reason** | HTTP + SSE is industry standard with the lowest integration barrier |
| **Kept** | PCP is maintained only for editor-internal mode |

---

## 7.4 D-4 — Channel long-term belongs to standalone repo (2026-05, phase 3.5)

| Dimension | Decision |
|-----------|----------|
| **Judgment** | Channel module long-term belongs to standalone repo `catui-channel-gateway` |
| **Current** | Incubated inside Gateway for ease of future migration |
| **Trigger** | Channel features stabilized + dedicated maintainer available |

---

## 7.5 D-5 — Browser Harness positioning (2026-05)

| Dimension | Decision |
|-----------|----------|
| **Judgment** | Browser Harness is the generic browser tooling layer, called by Catui extension wrappers |
| **Is not** | Not a product host; does not replace Eidolon's browser-control authority |
| **Eidolon scenarios** | Harness experience can be absorbed, but execution must be arbitrated by Eidolon's permission model |
| **Non-Eidolon scenarios** | Catui can call Harness directly for web automation |

---

## 7.6 D-6 — Catui N-tools-1 open questions

Before launching N-tools-1 we need to nail down (see Catui `docs/remote-tool-register-design.md` §9):

| # | Question | Default lean |
|---|----------|--------------|
| Q-1 | RemoteToolSource source location | `core/tools/` |
| Q-2 | Should remote tools go through extension hook? | Yes |
| Q-3 | Gateway pendingTools registry location | Inside CatuiEngineAdapter |
| Q-4 | Does `invoke()` carry a schema parameter? | No |
| Q-5 | Does Soul evolve on remote tools? | Yes |

---

## Decision-numbering rules

- Format: `D-{n}`
- Cross-repo impact ≥ 2 projects → goes into this file
- Single-repo decisions → stay inside that project's docs
- Modifying an existing decision → add a new entry tagged `supersedes D-{old}`
