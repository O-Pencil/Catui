# §5 Protocol Strategy

> Positioning, applicable scenarios, and authoritative docs for each protocol in the ecosystem

<!--
[WHO]  Whole-ecosystem protocol strategy definition
[FROM] catui-platform-charter.md §5
[TO]   Each project's integration design docs
[HERE] charter/05-protocols.md — protocol strategy
-->

---

## 5.1 Protocol overview

| Protocol | Positioning | Applicable scenarios | Authoritative doc |
|----------|-------------|----------------------|-------------------|
| **HTTP + SSE (OpenAI-compatible)** | **Main protocol** — Gateway's only outward API | All external clients and third-party integrations; Editor Remote HTTP mode; Eidolon cloud mode | Catui-Agent-Gateway `docs/02` |
| **ACP** | Local direct connection — Agent engine and host process communication | Editor local mode; Catui CLI; IDE plugins | Catui ACP-mode implementation |
| **PCP (WebSocket)** | Editor-internal only — Rust Server / Desktop PCP mode | Editor-maintained; not promoted externally | catui-editor `docs/.../catui-client-protocol.md` |
| **Catui Tool Callback (v0.2)** | Work-line A tool return — Gateway ↔ caller | Editor Remote HTTP calls local tools | Gateway `docs/18` + Catui `docs/remote-tool-register-design.md` |
| **Channel protocol** | Third-party IM adaptation | DingTalk Stream / WeChat XML / Feishu → Gateway | Gateway `docs/13` |
| **Blackboard (KV + pub/sub)** | Multi-Agent horizontal communication | O-Mesh-orchestrated multi-Agent collaboration | O-Mesh `DOCS/` |
| **Native Messaging** | Browser extension ↔ local process | Eidolon local mode → Catui | Catui-Eidolon `native-host/` |

## 5.2 Protocol-selection principles

1. **Expose only OpenAI-compatible HTTP externally** — lower the bar for all integrators
2. Internal protocols (ACP / PCP / Channel) each serve specific paths and do not invade one another
3. New scenarios prefer HTTP + SSE; only use internal protocols when there is a clear performance / isolation need

## 5.3 Tool Callback v0.2 dual channel

```
Gateway  ── SSE event: catui.tool_request  ──►  Caller (Editor / 3rd-party)
Caller   ── POST /v1/.../tool_response      ──►  Gateway
```

**Key decisions** (see [07-decisions.md](./07-decisions.md) §8.1):
- Serial tool calls (only one pending allowed per session at a time)
- No caller heartbeat (rely on `timeout_ms`)
- Asgard may proxy `tool_response` (single audit chain)
- `arguments` capped symmetrically at 256 KiB
- Explicit `catui.session_lost` event when session is lost
