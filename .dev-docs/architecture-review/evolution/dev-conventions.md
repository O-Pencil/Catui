# Dev Conventions — 重构后未来开发约规（演进组 · 骨架）

```yaml
group: evolution
status: skeleton
purpose: |
  把候选 D 重构沉淀下来的边界与纪律，固化成长期开发约规，
  使"可长期维护 + 具备扩展"在日常开发中可持续，而非一次性达成后再次劣化。
based_on:
  - ../target-architecture.md   # 候选 D 端态边界
  - ./PARP.md                    # 接缝与生长面纪律
audience: pencil maintainer · 未来贡献者 · arch agent
```

> **文档职责**：维护重构后的长期开发规约。与 F08（quality rule 可执行化）联动——F08 是 CI 守门的实现，本文是规约的"为什么 + 怎么做"。

---

## 1. 顶层目录归属判据（新增代码放哪）

| 放哪 | 判据 | 反例（不要放这里）|
|------|------|------------------|
| `core/<域>/` | nano-pencil 业务核心 | 横切原语（→ platform）、可发布库（→ packages）|
| `core/lib/<lib>/` | 内部库，**当前 0 外部消费者**，不发布 | 有外部消费者（→ packages）|
| `core/platform/` | 横切原语，**无业务知识** | 含业务逻辑 |
| `packages/<pkg>/` | **独立可发布身份**（有外部消费者 或 maintainer 明确战略发布）| 0 消费者的内部库（→ core/lib）|
| `extensions/{builtin,optional}/` | 第一方/可选能力实现 | 稳定第三方协议类型（→ protocol）|

> **packages/ 入场券**（grilling 决议）：独立可发布身份是唯一入场券。进入 `packages/` 的第一方包必须按真实 npm 包维护；若尚未发布，先发布该包，再让 host 依赖公网版本。发布期禁止用脚本临时剥离或改写依赖来掩盖未发布状态。

## 2. 依赖方向（单向，CI 守门）

```
modes/ ──► core/ ──► core/platform/        （platform 不依赖业务，反向禁止）
core/ ──► core/lib/                          （lib 不反依赖业务）
packages/mem-core, soul-core ──► packages/protocol   （禁止反向 import host，修 U3）
extensions/ ──► packages/protocol            （扩展只依赖稳定协议，不依赖 host 内部）
```

## 3. 协议生长面纪律（防 PARP 二次重构）

> **改名（决议 2026-06-12，随 Phase B/P8 落地）**：`@pencil-agent/extension-sdk` → **`@pencil-agent/protocol`**。
> 理由：它不只服务"扩展"——mem-core/soul-core 也实现它的契约；它是**整个 Agent 能力协议**(tool/lifecycle/memory/soul/agent-profile…)。对位 ACP(`@agentclientprotocol/sdk`)的 protocol 框架；它是**纯类型契约**，不是运行时 SDK。first-party + pre-2.0，改名安全。下文 `protocol` 即指该包。

- **`packages/protocol/` 是唯一只增不改的协议生长面**：未来所有 PARP 协议类型（agent-profile / host-adapter / tool-runtime / a2a-bridge / memory-* / soul-* / cognitive-*）只进 protocol。
- **host `index.ts` 永不增长协议类型**：一次收窄到位后，对外只暴露 stable SDK 接口。
- **协议优先 re-export 业界标准**：`host-adapter.ts ← @agentclientprotocol/sdk`（ACP）；`tool-runtime.ts ← MCP`；`a2a-bridge.ts ← A2A`（占位）。**有 wire 标准就直接依赖并 re-export，不自造**。当某域接 wire 标准时，protocol 才新增对应依赖（如 host-adapter 化时 protocol 依赖 ACP；眼下 ACP 仅 `modes/acp/` 实现侧用）。仅 Continuity 与 Agent Profile schema 为 pencil 自定义。
- **按协议域分文件**（一文件一"大类"，对位 ACP 的 acp/jsonrpc/stream 分法）：`tools.ts` / `lifecycle.ts` / `host-adapter.ts` / `tool-runtime.ts` / `memory-store.ts` / `soul-facet.ts` / `agent-profile.ts` / `a2a-bridge.ts`。零/极小依赖、纯类型、有 wire 的对位 schema。

## 3b. 类型/协议放置约规（日常开发铁律）

> 回答两个高频问题：**一个类型该写哪？怎么发现已有的、避免重复定义？**

**亮线 —— 什么才算"公共协议"**：
> 一个类型成为公共协议（进 `packages/protocol/`），**当且仅当一个【已发布包(mem/soul)或外部扩展作者】需要它**——即它**跨过了 publish 边界**。仅被 host 内部多文件用 ≠ 协议（那只是模块导出）。

**放置阶梯（类型住"覆盖其消费者的最窄作用域"）**：

| 消费者范围 | 家 | 发包 |
|-----------|----|----|
| 1 文件 | 文件内，不导出 | 否 |
| 1 模块内多文件 | `<模块>/types.ts` 或拥有该概念的文件 | 否 |
| 1 层内多模块 | **由"概念归属的模块"导出**（不建层级大 types.ts，避免层级版 barrel）| 否 |
| host 内部、跨 core↔modes | `*-contract.ts`（范例 `theme-contract.ts`），生产方持有 | 否 |
| **跨 publish 边界**（mem/soul/外部）| `packages/protocol/`（按域分文件）| **是（改契约才发）** |

**涌现式抽取**：从最窄起步，**只在更宽作用域真出现消费者时提升一级**。**永不预先往 protocol 放**——单写功能时它不是协议；多处用了再抽取。

**本地扩展、不写回（Open/Closed）**：消费者要特化某契约，就在**自己内部 `extends` 基契约**（`interface MyMemStore extends MemoryStore {…}` / 泛型 / 组合），**不改 protocol**。只有当某特化被**多个消费者**都需要时才提升进 protocol 基契约。基契约对修改封闭、对扩展开放。

**发现机制（避免重复定义）**：不靠记忆、不靠层级大 types.ts——**读该目录的 DIP P2 `AGENT.md` Member List**（已逐文件列出每个文件定义/导出什么）；类型住"概念归属文件"或模块 `types.ts`，位置可预测；protocol 按域分文件，找契约看域文件。

## 4. 新增可发布包流程（promote）

- 默认放 `core/lib/`；出现真实外部消费者后再 promote。
- 用 `scripts/promote-to-package.ts <name>`：mv 目录 + 生成 package.json/tsconfig.build.json + 改 import；本地开发可走 workspace 解析，但 host 发布依赖必须是 npm 可解析的 semver。
- 发布顺序：`protocol` → `mem-core`/`soul-core` → `nano-pencil`。其中任何未在 npm 上可解析的 first-party 包，都必须先独立发布，不能通过 host 发布脚本绕过。

## 5. quality rule（与 F08 联动，CI 可执行）

- ≤400 行/文件、≤15 文件/目录、无循环依赖、公共 API 有 JSDoc。
- 例外白名单需带 due date（Q8 决议待定，见 refactor-plan）。
- `scripts/verify-quality.ts` 实现；`.github/workflows/quality.yml` PR 守门。

## 6. 状态

- [x] 约规骨架
- [ ] 与 F08 verify-quality.ts 实现对齐
- [ ] 依赖方向 CI 规则落地
- [ ] promote 流程随 scripts/promote-to-package.ts 落地补全
