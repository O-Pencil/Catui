# §7 跨项目决策记录

> 影响多个仓库的重大决策

<!--
[WHO]  跨项目决策的权威记录
[FROM] pencil-platform-charter.md §8
[TO]   各项目架构文档
[HERE] charter/07-decisions.md — 决策记录
-->

---

## 7.1 D-1 — A 线工具回传协议五决策（2026-05-20）

**权威源**：Pencil-Agent-Gateway `docs/18` §16。本表为简版。

| # | 问题 | 决策 | 理由 |
|---|------|------|------|
| 1 | 并行工具调用？ | **串行**。同一 (agentId, sessionId) 同时只允许一个 pending tool call | Editor 侧工具运行时（FS 锁、bash 进程）串行心智更稳 |
| 2 | Caller heartbeat？ | **否**。caller 设置足够 timeout_ms，Gateway 守时 | 第三种状态消息增加无谓复杂度 |
| 3 | Asgard 代理 tool_response？ | **是**。editor → Asgard → Gateway | 单一审计链 + 单一 key 边界 |
| 4 | arguments 封 256 KiB？ | **是，对称**。`tool_payload_too_large` 同时覆盖 inbound 和 outbound | 防止单边滥用 |
| 5 | session 失效显式事件？ | **是**。SSE `event: pencil.session_lost` + `[DONE]`；后续 POST 返回 410 | 让 UI 区分"网断"和"服务端清掉 session" |

---

## 7.2 D-2 — Rust Server 不作为生态主线（2026-05，阶段二结束时）

| 维度 | 决策 |
|------|------|
| **判断** | Rust `src/apps/server/` 原型不作为生态主线服务延续 |
| **替代** | 生态主线服务交给 Pencil-Agent-Gateway（Node.js + Hono） |
| **理由** | 原型证明了"Agent 在服务端、工具在客户端"架构可行，但 Rust 全栈维护成本过高 |
| **影响** | `packages/pencil-client-sdk/` 降级为 editor PCP 模式内部依赖 |

---

## 7.3 D-3 — 对外主线协议为 HTTP + SSE（2026-05，阶段三开始时）

| 维度 | 决策 |
|------|------|
| **判断** | 对外主线协议是 OpenAI 兼容 HTTP + SSE + API Key |
| **否决** | PCP WebSocket 不对外推广 |
| **理由** | HTTP + SSE 是行业标准，接入门槛最低 |
| **保留** | PCP 仅 editor 内部模式继续维护 |

---

## 7.4 D-4 — Channel 长期归属独立仓库（2026-05，阶段 3.5）

| 维度 | 决策 |
|------|------|
| **判断** | Channel 模块长期归属独立仓库 `pencil-channel-gateway` |
| **当前** | 在 Gateway 内孵化便于将来整体迁出 |
| **触发条件** | Channel 功能稳定 + 有独立维护者 |

---

## 7.5 D-5 — Browser Harness 定位（2026-05）

| 维度 | 决策 |
|------|------|
| **判断** | Browser Harness 是通用浏览器工具层，被 nanoPencil 扩展封装调用 |
| **不是** | 不是产品宿主，不替代 Eidolon 的浏览器控制权 |
| **Eidolon 场景** | Harness 的经验可被吸收，但执行必须由 Eidolon 权限模型仲裁 |
| **非 Eidolon 场景** | nanoPencil 可直接调用 Harness 处理网页自动化 |

---

## 7.6 D-6 — nanoPencil N-tools-1 待决问题

启动 N-tools-1 之前需要敲定（见 nanoPencil `docs/remote-tool-register-design.md` §9）：

| # | 问题 | 默认倾向 |
|---|------|----------|
| Q-1 | RemoteToolSource 源码位置 | `core/tools/` |
| Q-2 | 远程工具是否走 extension hook | 是 |
| Q-3 | Gateway pendingTools 注册表位置 | 放在 NanoPencilEngineAdapter 内 |
| Q-4 | invoke() 是否携带 schema 参数 | 否 |
| Q-5 | Soul 是否对远程工具 evolve | 是 |

---

## 决策编号规则

- 格式：`D-{序号}`
- 跨仓影响 ≥ 2 个项目 → 进本文件
- 单仓决策 → 留在项目内部文档
- 修改已有决策 → 新增条目标注 `supersedes D-{old}`
