# PARP — Pencil Agent Runtime Protocol（演进组 · 暂定）

```yaml
group: evolution            # ★ 演进组，非重构组
status: proposed            # 暂定；不进入本轮重构批次
relationship_to_refactor: |
  PARP 不是本轮架构重构（候选 D）的一部分，也不是其前提。
  候选 D 的目录骨架因 F01–F08 + 顶层评审本身成立，与 PARP 无关。
  PARP 是候选 D 之上的"产品架构解释层 + 未来演进方向"。
  本轮重构只需在 refactor-plan B1/B2 预留 3 个接缝（见 §5），
  使未来 PARP 落地是纯增量、不引发二次重构。
based_on:
  - ./industry-protocol-survey.md   # PARP 五层 × 业界协议覆盖矩阵
  - ../target-architecture.md       # 候选 D 目录骨架（PARP 落点的宿主）
audience: pencil maintainer · 未来 PARP RFC 作者
```

> **文档职责**：本文是**演进组**文档，维护 PARP 的定义、组合公式、五层协议边界、与候选 D 的关系，以及"本轮重构需要预留的接缝"。
> 它**不**给本轮重构批次增加任务；重构端态目录见 `../target-architecture.md`，执行批次见 `../refactor-plan.md`。
>
> **为什么独立成册**：grilling 期间 PARP/continuity 被嵌进了重构结论文档，导致 B0 把"机械搬迁（behavior-preserving）"与"协议/连续性内核（net-new）"捆在同一批次。把演进内容抽出后，重构组得以独立验收"功能不变"，演进组按真实需求 gate、独立推进。

---

## 1. 定义

**PARP（Pencil Agent Runtime Protocol）**：Pencil 的底层不是单一 CLI，而是一套可宿主、可组合、可扩展的 Agent Runtime Protocol。CLI 是默认 host profile；Browser 是 browser tool runtime + browser agent profile；Gateway 是 remote host adapter；Editor 是 caller-owned tool runtime。nanoPencil 的长期定位不是"一个 CLI + 插件"，而是 Pencil 生态里能配置出多类 PencilAgent 的 runtime 内核。

> **PARP ≠ 新 wire protocol**。经调研（见 `industry-protocol-survey.md`），PARP 不是业界没有的新协议，更像是**业界第一次把已有标准显式组合起来的形态 + 如何复用业内已有标准**。它**不重新定义** Editor↔Agent、Host↔Tool、Host↔Host 的传输层，而是一份**组合契约（composition contract）**，把以下事实标准在 pencil 内统一组装：
> - **MCP**（Model Context Protocol）= Tool Runtime 的远程分支事实标准
> - **ACP**（Agent Client Protocol）= Editor Host Adapter 事实标准
> - **A2A**（Agent2Agent Protocol）= 未来 PencilAgent ↔ PencilAgent 跨 runtime 通信
>
> PARP 真正自定义的只有 **Continuity 层**（canonical state / merge policy / prompt injection policy）和 **Agent Profile schema**（参考 Microsoft Agent Framework 1.0 YAML 形态）。其余四层通过 re-export 或薄封装对接业界标准。

---

## 2. 组合公式

```text
PencilAgent =
  Agent Loop
  + Tool Runtime
  + Agent Profile
  + Continuity
  + Host Adapter
  + Permission Policy
```

不同形态只是 profile 与 runtime 组合不同：

```text
CLI PencilAgent
  = local shell/file/edit/grep tools
  + terminal host surface
  + local workspace
  + default continuity

Browser PencilAgent
  = browser tool runtime（open/click/type/screenshot/extract/waitFor）
  + browser session state
  + browser-specific loop policy
  + browser permission policy

Gateway PencilAgent
  = remote tool transport
  + HTTP/SSE host adapter
  + multi-agent isolation
  + usage/billing boundary

Editor PencilAgent
  = caller-owned workspace tools
  + ACP / Remote HTTP bridge
  + document/context runtime
```

---

## 3. 五层协议边界

| PARP 层 | 责任 | 未来目标目录 | **业界对位标准**（详见 industry-protocol-survey.md §6）|
|---------|------|----------|-------------------------------------|
| Agent Loop | 模型 → 工具 → 观察 → 下一步；不关心具体 host | `core/runtime/` + `core/lib/agent-core/` | 内部实现；参考 Scaffold paper 5 原语（ReAct / generate-test-repair / plan-execute / retry / tree search）|
| Tool Runtime | CLI / Browser / Editor / MCP / Remote 等工具执行环境 | `core/tools/` + `extensions/*` + `packages/extension-sdk/tools.ts` | **MCP** = 远程/hosted/mcp 分支事实标准；local/browser 由 pencil 实现但接口与 MCP 同形 |
| Agent Profile | 把 loop policy、tool runtime、continuity、权限组合成一种 PencilAgent | `core/agent-profile/`（演进新增）| 内部实现；schema 参考 **Microsoft Agent Framework 1.0** 声明式 YAML；OpenAI Agents SDK `Agent` 原语 |
| Host Adapter | CLI / ACP / Gateway HTTP / Editor / Browser session 等宿主适配 | `modes/` + Gateway SDK 嵌入 + ACP | **ACP** = Editor host adapter 事实标准；**A2A** = 未来 PencilAgent ↔ PencilAgent 跨 runtime 通信；CLI host adapter 由 pencil 自定义 |
| Continuity | 记忆、灵魂、认知地图、长期状态合并 | `core/continuity/`（演进新增）+ `packages/mem-core/` + `packages/soul-core/` | **★ 业界协议全部留白**（A2A 明确声明 "without access to memory/state/tools"；MCP/ACP 不管）——pencil 的真正独立贡献 |
| Permission Policy | 沙箱、approval、guardrails | `core/extensions-host/permissions.ts` + extension-sdk | 内部实现；参考 **OpenAI Agents SDK Guardrails** 双模式（parallel/blocking）+ input/output 双侧检查 |

---

## 4. 工具也是协议化 endpoint

工具不应只是散落的函数，而是 Agent Loop 可调用的协议化 endpoint：

```ts
interface AgentToolProtocol {
  name: string;
  schema: JsonSchema;
  invoke(input: unknown, context: ToolInvocationContext): Promise<ToolResult>;
  permissions: PermissionSpec;
  runtime: "local" | "remote" | "browser" | "mcp" | "hosted";
}
```

在这个模型下，`bash`、`read_file`、`edit`、`browser.click`、`browser.open`、`editor.insert_text`、MCP tools、remote tools 都是同一套 Tool Protocol 的不同实现。Browser 能力可以作为 `extensions/optional/browser/` 提供的 **Browser Tool Runtime**，而 Browser Agent 则是一个使用该 runtime 的 **Agent Profile**，不是把整个 browser agent 塞进普通插件。

**与 MCP 对齐**：对于 `runtime: 'remote' | 'mcp' | 'hosted'` 三个分支，wire format **直接采用 MCP**（2025-11 spec：JSON-RPC + stdio/Streamable HTTP + OAuth 2.1）；`runtime: 'local' | 'browser'` 由 pencil 内部实现但接口形态与 MCP 同形（schema / invoke / result）以便未来合流。AgentToolProtocol 不重新发明远程工具调用协议。

> **现状对照（grounding）**：今天 `core/extensions/types.ts` 的 `ToolDefinition`（name / parameters(TypeBox) / execute(id, params, signal, onUpdate, ctx)）+ `AgentTool<any>` 已是统一工具形态，`core/tools/orchestrator.ts` 的 `ToolOrchestrator` 已是唯一分发点。距离 `AgentToolProtocol` 只差 `runtime` 判别字段与 `permissions`。**这正是 §5 接缝预留要做的事**——本轮重构顺手加两个可选字段即可，未来 PARP Tool Runtime 是纯增量。

---

## 5. ★ 本轮重构需要预留的接缝（关键）

PARP 本轮**不实现**，但为避免未来落地引发二次重构，重构经过下列咽喉时需把"接缝形状"定好（仅形状，不实现）。这 3 条已写入 `../refactor-plan.md` B1/B2 验收条件。

| # | 接缝 | 在哪个批次顺手做 | 现在要做的（成本≈0）| 不做的后果 |
|---|------|-----------------|--------------------|-----------|
| S1 | **Tool Runtime 判别** | B2 / F01 建 `tool-dispatch.ts` 时 | 给工具契约加 2 个**可选**字段：`runtime?: 'local'\|'mcp'\|'remote'\|'browser'`（默认 `'local'`）+ `permissions?`；保持 `ToolOrchestrator` 为唯一分发点 | 未来加 browser/remote runtime 要回改每个 tool + 分发器 |
| S2 | **组合根单 config 装配** | B2 / F01 把 `agent-session` 退化为 Composition Root 时 | 让组合根**从一个显式 config 对象装配**，而非散落 `new` | 未来加 Agent Profile 要重写组合根 |
| S3 | **mem/soul 依赖反转** | B1 修 U3 时（已在计划内）| mem-core 依赖 `@pencil-agent/extension-sdk` 而非 host | 未来 continuity 内核插入时面对反向依赖，无干净接口 |

**判定标准**（用于区分"现在预留 vs 放心推迟"）：
> 省掉它，未来加回来时是否会改动 >1 个已有调用点，或改动一个已发布 / 已落盘的契约？
> - 会 → 现在定接缝形状（S1/S2/S3）。
> - 不会（只是新增文件/目录）→ 放心推迟（profile / continuity / a2a / 目录全部属此类）。

**唯一真正会触发二次重构的点**：B6 对外 SDK 表面收窄（2.0 major bump）。对冲——把 `packages/extension-sdk/` 定为**唯一只增不改的协议生长面**，未来所有 PARP 协议类型只进 extension-sdk、永不进 host `index.ts`，则 PARP 类型落地是 additive，不触发 host 二次 major bump。详见 `dev-conventions.md`。

---

## 6. 未来落点（推迟到演进 roadmap，本轮不建）

以下全部属"新增即增量"，本轮重构**不建目录、不建空 stub**（空 stub 是死代码 + 文档漂移负债）：

- `core/continuity/`：canonical-state / provenance / merge-policy / prompt-injection-policy / cognitive-model-contract
- `core/agent-profile/`：profile schema + built-in CLI/browser/remote/editor profile
- `packages/extension-sdk/` 的 PARP 协议文件：`agent-profile.ts` / `host-adapter.ts`（re-export ACP）/ `tool-runtime.ts`（re-export MCP）/ `a2a-bridge.ts`（A2A stub）/ `memory-store.ts` / `memory-candidate.ts` / `soul-facet-provider.ts` / `cognitive-model-provider.ts`
- `extensions/builtin/{memory-binding,soul-binding}/`：官方 engine ↔ continuity 桥接

落地节奏、依赖的接缝就绪条件见 `product-roadmap.md`。

---

## 7. 状态

- [x] PARP 定义 / 组合公式 / 五层边界（自 target-arch §3.5 抽离）
- [x] 接缝预留清单（S1/S2/S3，已写入 refactor-plan B1/B2）
- [ ] continuity 层最小设计（canonical state / merge policy / prompt injection policy）—— 演进组，待 gate
- [ ] agent-profile schema 草案（参考 MS Agent FW 1.0 YAML）—— 演进组，待 gate
- [ ] PARP RFC（若对外推广）—— 远期
