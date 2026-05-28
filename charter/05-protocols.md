# §5 协议策略

> 生态中各协议的定位、适用场景与权威文档

<!--
[WHO]  全生态协议策略定义
[FROM] pencil-platform-charter.md §5
[TO]   各项目集成设计文档
[HERE] charter/05-protocols.md — 协议策略
-->

---

## 5.1 协议总览

| 协议 | 定位 | 适用场景 | 权威文档 |
|------|------|----------|----------|
| **HTTP + SSE（OpenAI 兼容）** | **主线协议** — Gateway 唯一对外 API | 所有外部客户端、第三方集成；Editor Remote HTTP；Eidolon 云端模式 | Pencil-Agent-Gateway `docs/02` |
| **ACP** | 本地直连 — Agent 引擎与宿主进程通信 | Editor 本地模式；nanoPencil CLI；IDE 插件 | nanoPencil ACP mode 实现 |
| **PCP (WebSocket)** | 仅 Editor 内部 — Rust Server / Desktop PCP 模式 | Editor 内部维护，不对外推广 | nanopencil-editor `docs/.../pencil-client-protocol.md` |
| **Pencil Tool Callback (v0.2)** | A 线工具回传 — Gateway ↔ caller | Editor Remote HTTP 调用本机工具 | Gateway `docs/18` + nanoPencil `docs/remote-tool-register-design.md` |
| **Channel 协议** | 第三方 IM 适配 | 钉钉 Stream / WeChat XML / Feishu → Gateway | Gateway `docs/13` |
| **Blackboard (KV + pub/sub)** | 多 Agent 横向通信 | O-Mesh 编排的多 Agent 协作 | O-Mesh `DOCS/` |
| **Native Messaging** | 浏览器插件 ↔ 本地进程 | Eidolon 本地模式 → nanoPencil | Pencil-Eidolon `native-host/` |

## 5.2 协议选择原则

1. **对外只暴露 OpenAI 兼容 HTTP**，降低所有接入方门槛
2. 内部协议（ACP / PCP / Channel）各自服务特定通路，不互相侵入
3. 新场景优先走 HTTP + SSE；仅在性能/隔离有明确需求时走内部协议

## 5.3 Tool Callback v0.2 双通道

```
Gateway  ── SSE event: pencil.tool_request  ──►  Caller (Editor/3rd-party)
Caller   ── POST /v1/.../tool_response      ──►  Gateway
```

**关键决策**（详见 [07-decisions.md](./07-decisions.md) §8.1）：
- 串行工具调用（同一 session 同时只允许一个 pending）
- 无 caller heartbeat（靠 timeout_ms）
- Asgard 可代理 tool_response（单一审计链）
- arguments 对称封 256 KiB
- session 失发显式事件 `pencil.session_lost`
