# Feature Development Workflow

> **开发前必读。** 把 `.dev-docs/architecture-review/` 的评审思路（如何顶层设计、如何评审功能质量）固化成**每次功能开发都走的判断流程**。
> 入口链接自根 P1 [`AGENTS.md`](../AGENTS.md)。本次重构的收益结论见 [architecture-review/REFACTOR-LEDGER.md §1b](./architecture-review/REFACTOR-LEDGER.md)。

```yaml
doc: feature-workflow
status: canonical
applies_to: 所有新功能 / 重构 / bugfix（按影响面分级，见 §3）
supersedes: REFACTOR-LEDGER §1c（已毕业到本文）
```

---

## 0. 为什么有这份文档

重构（P0–P6）给项目分了层、立了 owner、加了守门规则。但**分层只有"被日常开发持续遵守"才有价值**——否则几个月后又会长出新的 god 文件、反向依赖、重复规则。

这份文档 = 把架构评审从"一次性重构 handbook"沉淀成"**每个功能都走的同一套判断**"。目标是：开发新功能时**能感知到架构**，而不是每次都从头读一遍目录结构才知道往哪写。

---

## 1. 核心心法

> 架构评审**不是**写代码前多写文档。它是写代码前问清同一组问题：

1. **Owner**：这个需求要改变的能力，当前有没有明确的 owner？（core / mode / extension / package / platform / build）
2. **分层契合**：改动是否符合现有分层——不跨层、不反向 import、不在两处重复同一规则？
3. **收益 vs 抽象**：引入的新抽象，收益是否大于它的理解/维护成本？（能删的分支 > 能写对的分支）
4. **可验收**：功能是否不变或按预期变化，且**能自动或人工复现**？

---

## 2. 四步循环（每个功能都走）

| Step | 问题 | 必看材料 | 输出 |
|------|------|----------|------|
| **1. Feature intake** | 要改变什么能力？落在哪一层？ | **§2b 层级归属决策**（核心）、[`target-architecture.md`](./architecture-review/target-architecture.md)、相关模块的 P2 `AGENT.md` | 一句话意图 + 影响面清单 + **目录落点** |
| **2. Feasibility & boundary** | 当前架构是否已有 owner？会不会跨层 / 反向 import / 重复规则？ | 相关 P2/P3、[`evolution/dev-conventions.md`](./architecture-review/evolution/dev-conventions.md)、历史 review/finding | 落点判断：**纯搬 / 局部改 / hybrid / 需专项评审**（§3）|
| **3. Architecture-fit design** | 如何在现有分层里实现，而不是新增耦合？ | §4 的实现原则 | 设计草案：owner、ports、依赖方向、兼容性、token/perf 影响 |
| **4. Acceptance review** | 功能对不对？文档同步没？守门绿没？ | §5 验收门 | 验收结论：**通过 / 需补测 / 需 ADR 接受 trade-off** |

> Step 1–2 通常几分钟；只有 Step 2 判定"需专项评审"时才走 §3 的重流程。**大多数小改动止于这张表。**

---

## 2b. 层级归属决策（Step 1 的核心：这个功能放哪一层）

> 这是最容易做错、且影响最深的一步。先记住一句话：**有两个正交的轴，别混。**

### 两个正交的轴

| 轴 | 是什么 | 取值 | 回答 |
|----|--------|------|------|
| **概念轴**（产品认知）| 这是**什么**能力 | 🧠 Cognition（认知）· 🔧 Tool（工具）· 🎨 Interface（界面）| 帮你想清依赖与表面 |
| **结构轴**（代码归属）| 代码**住哪** + 依赖规则 | `packages/` · `core/`（含 `lib/` `platform/`）· `modes/` · `extensions/` | **决定文件落点** |

> ⚠️ **两轴完全正交**（顶层评审 candidate D 的结论）：一个功能同时有概念层**和**目录家，二者**不 1:1 映射**。
> 例：`teach` 概念上是 🧠 Cognition，但结构上住 `extensions/`。**别因为它"是认知能力"就想往 core 塞。**

### 结构轴决策树（决定文件落点）

按顺序问，第一个"是"就是落点：

1. 是**独立可发布的库**（有自己 version、有 host 之外的消费者、npm semver 可解析）？→ **`packages/`**
2. 是**零业务的横切原语**（config / i18n / telemetry / exec / utils，不含任何业务知识）？→ **`core/platform/`**
3. 是**被多个 mode/extension 复用的运行时原语**（session / tools / model / mcp / prompt / runtime）？→ **`core/`** 对应子域
4. 是**一种新的 I/O 范式**（像 interactive / print / rpc / acp），或某 mode 专属适配/渲染？→ **`modes/`**
5. 是**用户可感知的能力 / 行为**（slash 命令 + 工具 + 行为 hook + renderer）？→ **`extensions/`**（默认走这里）

> **默认判据**：**新的用户可感知功能，默认进 `extensions/`。** 只有它确实是"被多 mode/extension 复用的运行时原语"才进 `core/`；确实是"独立可发布库"才进 `packages/`；确实是"新 I/O 范式"才进 `modes/`。

### 每层的约束（MUST / CAN / MUST-NOT）

| 层 | MUST | CAN | MUST-NOT |
|----|------|-----|----------|
| **`packages/`** | 独立 version+files；npm semver 可解析；无 host 反向依赖 | 稳定协议（extension-sdk）、可复用领域引擎（mem-core/soul-core）| ❌ 放 app feature；❌ 放只有 host 用的东西（那是 `core/lib/`）；❌ 依赖 host 内部符号 |
| **`core/`** | 是被多 mode/extension 复用的运行时原语，有明确 owner | 新增一个清晰的 runtime 子域 | ❌ 放单个 feature 的业务；❌ 放 UI；❌ 放只服务一个 extension 的逻辑 |
| **`core/lib/`** | 仅 ai / agent-core / tui 三个 fork 内部库 | — | ❌ 放非 fork 的新代码；❌ 去掉 `private:true` / publish |
| **`core/platform/`** | 零业务知识的横切原语 | config/i18n/telemetry/exec/utils | ❌ 任何业务知识；❌ 反向依赖业务层 |
| **`modes/`** | 一种新 I/O 范式，或某 mode 专属适配/渲染 | mode 内 controller（capability-context）| ❌ 放跨 mode 的功能（→core/extension）；❌ 放业务能力 |
| **`extensions/`** | 经 `ExtensionContext` / extension-sdk 协议消费 core；`builtin/`=默认加载、`optional/`=opt-in | 注册 tool / slash / 键位 / 生命周期 hook / 消息 renderer | ❌ 直接 import host 内部符号；❌ 跨 extension 依赖；❌ 默认加载却不走 GB-2 声明 |

### 走一遍：`teach`（用户用它学代码等）

| 步骤 | 判断 |
|------|------|
| 概念轴 | 主要 🧠 Cognition（学习/认知）+ 🎨 Interface 表面（`/teach` UX）+ 可能 🔧 Tool（读代码/跑例子）|
| 结构轴决策树 | ①独立可发布库?否 ②零业务原语?否 ③多 mode/extension 复用的运行时原语?**否**（是一个具体功能）④新 I/O 范式?否 ⑤用户可感知能力?**是** → **`extensions/builtin/teach/`**（若不想默认启用则 `optional/`）|
| 落点 | `extensions/builtin/teach/index.ts`：注册 `/teach` 命令 + teaching 状态机 + renderer；经 `ExtensionContext` 复用 core 的 session/tools/model；要新工具就用 extension tool 注册；UX 经当前 mode 自然渲染 |
| 约束自检 | ✅ MUST：补 P3 头、登记 `extensions/AGENT.md` P2；✅ MUST-NOT：不反向 import host 内部、**不在 `core/` 塞 teach 业务**、不跨 extension 依赖；⚠️ 若默认加载 → 属"默认启用 extension"= 用户可感知变更，**必须按 GB-2 声明**（参考 browser opt-in 的 EV03）|

> **反面教材**：把 `teach` 的逻辑写进 `core/runtime/` 或新建 `core/teach/`——这违反 `core/` 的 MUST-NOT（放单个 feature 业务），会让 runtime 重新长出 god 耦合。概念上是认知层 ≠ 结构上进 core。

---

## 3. 何时升级为"专项评审"（先评审，后写代码）

满足**任一**条件，不要直接开写，先在 `.dev-docs/architecture-review/<topic>-review/` 建专项评审：

- 改 **load-bearing 区域**：runtime/session、interactive mode、extension host、package/public API、build/release。
- 单文件预计 **> 400 行**，或新 controller/context 需要 **≥ 8 个能力 port**。
- 需要**重写**而非纯搬；或存在 **token 消耗 / 兼容性 / 性能 / 发布体积**影响。
- 会改 **public API / npm deps / 默认启用 extension / CLI·TUI 用户路径**。
- **找不到明确 owner**，或同一规则要在两个模块重复实现。

专项评审最小产物（参考 `runtime-session-review/` `interactive-ui-review/` 的同型）：

```text
<topic>-review/
  README.md        # scope / status / decision / acceptance
  findings/UIxx-*.md   # one card per finding（边界争议 / 归属风险）
  closure.md       # 收尾：实施了什么、deferred 了什么、reopen 条件
```

> 这套流程已被 P4（runtime-session-review，12 卡）/ P5（interactive-ui-review，UI01-08）/ P6（entry-volume-review，EV01-05）/ P7（bundle-redesign-review，BR01-04）验证有效——它们是"如何顶层设计 + 如何评审功能质量"的活样板，新评审照搬即可。

---

## 4. 架构契合的实现原则（重构沉淀的模式）

写 Step 3 设计时，照这些已被守门固化的模式：

| 原则 | 含义 | 反例 |
|------|------|------|
| **capability-context** | controller/服务只接收**命名能力闭包**的窄 context | 整个 `InteractiveMode` / `AgentSession` 传进去（service-locator）|
| **single owner** | 每个副作用/overlay/状态只有一个 owning 模块 | 同一状态散落多处 `this._` |
| **DIP P1/P2/P3** | map 与 terrain 同构：新文件补 P3 头，新模块补 P2，删/移文件同步 P2 | 改代码不同步文档 |
| **依赖方向单一** | `platform/` 零业务、不被业务反向依赖；`core/lib/*` 内部库；`packages/*` 真发布包 | host 反向依赖内部库内部符号 |
| **token / perf 中性** | 重构类改动不得隐性增加 LLM 调用 / prompt-context / 发送体积 | 拆 UI 顺手改了发给模型的内容 |

详细 WHY 见各 review 子目录（历史决策档）：[runtime-session-review](./architecture-review/runtime-session-review/) · [interactive-ui-review](./architecture-review/interactive-ui-review/) · [entry-volume-review](./architecture-review/entry-volume-review/) · [bundle-redesign-review](./architecture-review/bundle-redesign-review/) · [sdk-surface-review](./architecture-review/sdk-surface-review/)。

---

## 5. 验收门（自动 + 人工）

| 门 | 目的 | 命令 | CI 现状 |
|----|------|------|---------|
| **DIP** | map-terrain 同构 | `npm run verify:dip` | ✅ `ci.yml` |
| **Quality** | 无循环 + 边界不污染 | `npm run verify:quality` | ✅ `quality.yml` |
| **Build/Type** | 可编译 | `npm run build && npx tsc --noEmit` | ✅ `ci.yml` |
| **Package boundary** | public 包 vs 内部库边界（BR01）| `npm run verify:package-boundary`（`:dist` 验内嵌库可解析）| ⚠️ **未接 CI（手动）** — 待接进 `quality.yml` |
| **Public API** | 兼容性显式 | 符号 diff 对 `architecture-review/baseline/public-api-symbols-main.txt` | 手动；**默认不破，破必须先声明 intentional API diff（major 窗口）** |
| **Token/perf** | 不隐性涨成本 | 人工 review：LLM 调用链 / provider lazy / prompt 注入是否中性 | 人工 |
| **UX smoke** | 用户路径可用 | 按 [`beta-smoke-checklist.md`](./architecture-review/beta-smoke-checklist.md) | 人工，重点走默认路径 + 错误兜底 |

> **唯一已知缺口**：`verify:package-boundary` 还没接进 CI（BR01 guard 目前只手动）。把它加进 `quality.yml` 是关闭 workflow 自动化的最后一步。

---

## 6. PR 自检清单

提 PR 前过一遍（对应 §5）：

- [ ] 改/加文件都有 P3 头；新模块/目录登记进 P2 `AGENT.md`；删/移文件同步 P2。
- [ ] `verify:dip` / `verify:quality` / `verify:package-boundary` 本地绿。
- [ ] `build` + `tsc --noEmit` 绿。
- [ ] 没新增反向 import / service-locator context / 重复规则。
- [ ] public API 未变；若变，PR 描述显式声明 intentional diff + 影响面。
- [ ] LLM 调用/prompt/发送体积是否 token 中性，已说明。
- [ ] 涉及用户路径的改动，过了相关 UX smoke。
- [ ] 命中 §3 触发条件的，已先建专项评审并链接。

---

## 7. 参考（评审思路来源）

- [`architecture-review/methodology.md`](./architecture-review/methodology.md) — 评审词汇与认知层（Phenomenon/Essence/Philosophy）。
- [`architecture-review/target-architecture.md`](./architecture-review/target-architecture.md) — 端态目录 + 功能域映射。
- [`architecture-review/REFACTOR-LEDGER.md`](./architecture-review/REFACTOR-LEDGER.md) — 重构收益结论、已发现问题、已接受 trade-off、未完成项（P7/P8）。
- [`architecture-review/evolution/dev-conventions.md`](./architecture-review/evolution/dev-conventions.md) — 重构后开发约规。
