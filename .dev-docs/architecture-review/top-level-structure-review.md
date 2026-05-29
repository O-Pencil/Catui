# Top-Level Structure & Extensibility Review — 2026-05-27

```yaml
phase: 2.5-meta-synthesis
produced_at: 2026-05-27T16:10:00Z
status: phase_3a_grilled
relationship_to_target_arch: |
  本文是 target-architecture.md 的"前置评审 / 决策依据"。本文回答为什么选择候选 D；
  target-architecture.md 维护最终目录树、功能域映射、协议边界和迁移路径。
  为避免重复，本文不再维护完整目标目录树。
new_review_targets:
  - 项目结构合理性
  - 功能合理性
  - 扩展能力（README 承诺 "Plugin system" 对照现实）
  - 与 README/CHARTER 初衷的对齐度
```

> **【2026-05-29 · 重构组】** 本文属**重构组**决策依据。**候选 D 的骨架因 F01–F08 + 本文顶层评审本身成立，不以 PARP 为前提**——它恰好对未来 PARP 友好（接缝见 `refactor-plan.md` B1/B2），但即使永不做 PARP，候选 D 依旧是正确的结构决策。本文中涉及 PARP/continuity 的论证（原 §5.5.B、§6.D.1.1、§6.D.6 的内核部分）已迁/指向**演进组** `evolution/PARP.md` 与 `evolution/industry-protocol-survey.md`。
>
> **本文范围**：回答"为什么选择候选 D"。完整目标目录、协议草图与迁移动作以 `target-architecture.md` 为准；本文只保留证据、候选对比、决策原则。
>
> 本文在 target-architecture.md 之上，回答 4 个元问题 ——
>
> 1. 顶层 `packages/core/modes/extensions` 四分法是否合理？是否应合并 / 增加？
> 2. `packages/` 不发布子包到外部消费者，那它的真实价值是什么？
> 3. README 承诺的 "Plugin system for tools, themes, and behaviors" 在当前结构下能否实现？
> 4. 当前代码有没有偷偷背离 README 三层架构（Cognitive / Tool / Interface）和 4 条 design principles？

---

## 1. 数据底盘：npm 真实状态 vs 仓库形式

### 1.1 6 个 npm 包的真相

| Package | npm 已发布？ | 仓库版本 | 真实外部消费者 |
|---------|-------------|----------|----------------|
| `@pencil-agent/nano-pencil` | ✅ 1.14.3 | 1.14.3 | `Pencil-Agent-Gateway` (`^1.13.6`) · `Pencil-extension/native-host` (`^1.13.0`) |
| `@pencil-agent/ai` | ✅ 0.0.1 | 0.0.1 | **0 外部** · 仓库自用 + 被 host bundle 进 dist |
| `@pencil-agent/agent-core` | ✅ 0.0.1 | 0.0.1 | **0 外部** · 同上 |
| `@pencil-agent/tui` | ✅ 0.0.1 | 0.0.1 | **0 外部** · 同上 |
| `@pencil-agent/mem-core` | ✅ 1.1.0 | 1.1.0 | **0 外部** · 但版本号在迭代，意图明显 |
| `@pencil-agent/soul-core` | ❌ **404 Not Found** | 0.1.0 | **0 外部** · README 第二大卖点，根本没上 npm |

### 1.2 两个决定性反差证据

**证据 A — `nanoPencil/package.json:87-119` 的 `dependencies` 没有任何 `@pencil-agent/*`**：

```jsonc
"dependencies": {
  "@agentclientprotocol/sdk": "^0.16.1",
  "@anthropic-ai/sdk": "^0.73.0",
  // ... 28 个第三方
  // ❌ 没有 @pencil-agent/ai
  // ❌ 没有 @pencil-agent/agent-core
  // ❌ 没有 @pencil-agent/tui
  // ❌ 没有 @pencil-agent/mem-core
  // ❌ 没有 @pencil-agent/soul-core
}
```

也就是说 host 包**不通过 npm 依赖图**消费 packages。

**证据 B — `scripts/bundle-deps.js` 是把 packages "倒灌" 进 host dist 的胶水**：

```js
const PACKAGES_TO_VENDOR = ["ai", "agent-core", "tui"];
//   ↑ build 时 copy 到 dist/node_modules/@pencil-agent/<name>/
const PACKAGES_TO_BUNDLE = ["mem-core", "soul-core"];
//   ↑ build 时 copy 到 dist/packages/<name>/
```

`workspaces` 字段对**开发期**有效（TS 路径解析、tsc -p workspaces 依赖图），但对**发布期**而言 host 包是单一 npm 包，packages 是它内嵌的子目录。

### 1.3 真实拓扑（Pencil ecosystem 视角）

```
                 npm registry
                       │
                       │ install
                       ▼
   ┌───────────────────────────────────┐
   │  @pencil-agent/nano-pencil@1.14.3 │  ← 唯一被外部 install 的包
   │  ─ dist/cli.js                    │
   │  ─ dist/index.js                  │
   │  ─ dist/node_modules/             │
   │    └ @pencil-agent/{ai,agent-core,│  ← 被 bundle-deps.js
   │                     tui}          │     "倒灌" 进来
   │  ─ dist/packages/                 │
   │    └ {mem-core, soul-core}        │  ← 同上，但路径不同
   └───────────────────────────────────┘
                       ▲
                       │ npm install @pencil-agent/nano-pencil
       ┌───────────────┴────────────────┐
       │                                │
Pencil-Agent-Gateway          Pencil-extension/native-host
(SDK 嵌入)                    (浏览器扩展宿主)

不存在的箭头：
  · 没有任何外部项目 npm install @pencil-agent/mem-core
  · 没有任何外部项目 npm install @pencil-agent/soul-core
  · 没有任何外部项目 npm install @pencil-agent/ai
  · ...
```

**结论 1**：packages/ 在 npm 层面**已发布 5 个、未发布 1 个**，但 ecosystem 中**0 个外部消费者直接用它们** —— 全部通过 `@pencil-agent/nano-pencil` 间接消费。

**结论 2**：`workspaces` 字段在当前代码里实际只承担两个功能 ——
- 让 host 代码可以用 `import { X } from "@pencil-agent/ai"` 而非 `"./packages/ai/src/X"`
- 让 packages 间可以互相 import（如 `agent-core → ai`）

这两个功能 **都可以用 tsconfig path mapping 或子目录 import 替代**，**不需要 workspace 表面装饰**。

---

## 2. README 的初衷重读（4 个对齐基准）

要回答"有没有背离初衷"，先把 README.md 的承诺逐条提取：

### 2.1 README §"What Makes It Different" — 5 个产品承诺

| # | 承诺 | 当前代码实现 | 对齐度 |
|---|------|-------------|--------|
| P1 | **Memory** — "Remembers your projects" | `packages/mem-core` + `extensions/defaults/sal` | ✅ 实现到位 |
| P2 | **Personality** — "Evolves a unique personality" | `packages/soul-core` + `core/soul-integration.ts` + `extensions/defaults/soul` | ⚠️ soul-core 未发 npm 但实际工作 |
| P3 | **Terminal Native** — "Pure TUI" | `modes/interactive/` + `packages/tui` | ✅ |
| P4 | **Model Freedom** — "10+ providers" | `packages/ai/src/providers/` 11 个 | ✅ |
| P5 | **Offline Ready** — "Local models via Ollama" | `packages/ai/src/providers/ollama` | ✅ |

### 2.2 README §"Architecture Philosophy" — 三层架构

```
┌─────────────────────────────────────────┐
│           🧠 COGNITIVE LAYER            │  ← Memory + Personality + Context
├─────────────────────────────────────────┤
│           🔧 TOOL LAYER                 │  ← File Ops + Bash + Search + MCP
├─────────────────────────────────────────┤
│           🎨 INTERFACE LAYER            │  ← TUI + Themes + Keybindings
└─────────────────────────────────────────┘
```

**关键反差**：README 用 **"三层"** 描述架构，但代码用 **"四分类目录"**（packages / core / modes / extensions）。两套切法**完全正交**：

| README 层 | 实现散布在 |
|-----------|------------|
| 🧠 Cognitive | `packages/mem-core` + `packages/soul-core` + `core/soul-integration.ts` + `extensions/defaults/sal` |
| 🔧 Tool | `core/tools/` + `core/mcp/` + `extensions/defaults/*`（很多） |
| 🎨 Interface | `modes/` + `packages/tui` + `core/i18n/` + `modes/interactive/theme/` |

也就是说 **README 描述的层与代码的目录之间没有直接映射**。要找一个"记忆相关的功能"在哪，你得问 4 个目录。

### 2.3 README §"Design Principles" — 4 条原则

| # | 原则 | 当前现实 | 对齐度 |
|---|------|----------|--------|
| D1 | **Terminal First** — "No Electron, no browser" | ✅ TUI 是主入口 | ✅ |
| D2 | **Privacy First** — "Local storage, **no telemetry**, your data stays yours" | ⚠️ 1.14.3 加入了**远程 telemetry**（`core/telemetry/` 写 InsForge `pencil_*` / `ext_*` 表） | ❌ **README 与现实直接冲突** |
| D3 | **Extensible** — "Plugin system for tools, themes, and behaviors" | ⚠️ 有 extension 系统但**只是 first-party**（21 default + 2 optional），无第三方注册机制 | ❌ **README 承诺超出现实** |
| D4 | **Fast** — "Sub-second startup, instant response" | ⚠️ F06/F07 揭示当前启动恒付全 mode + 全 provider + 全扩展 | ⚠️ 已知短板 |

### 2.4 README §"Documentation" 提到的扩展文档

`README.md:243` 链接 `docs/EXTENSIONS.md` —— **明确承诺有"扩展指南"给第三方开发者读**。如果这份文档不教用户如何写自己的扩展，承诺等于空头支票。

我没读 `docs/EXTENSIONS.md`，但**这是一个必须核验的点**。

---

## 3. 当前顶层划分逐一审视

四个一级目录的真实角色与价值评分：

### 3.1 `packages/` — 评分：⚠️ 形式 vs 实质撕裂

**形式上是什么**：5 个 npm workspace 包，4 个已发布到 npm registry。

**实质上是什么**：

| 子包 | 实质角色 | 表 vs 里一致吗？ |
|------|----------|-----------------|
| `ai` | host 内部模块，被 vendored 进 dist；版本号停在 0.0.1；有自己的 `nanopencil-ai` bin（但没在主 bin 注册）| ❌ 装独立但实际不独立 |
| `agent-core` | 同上，被 vendored；`@pencil-agent/agent-core` 名字暗示"通用 agent 抽象"但只有 nano-pencil 用 | ❌ |
| `tui` | 同上，被 vendored；可独立的 TUI 库，但没人单独用 | ❌ |
| `mem-core` | 真在迭代版本号（1.1.0），有 `extension.ts` 入口；README 力推 | ⚠️ 想独立但反向 import host |
| `soul-core` | README 力推但**npm 404 未发布**；通过 bundle 进 host | ❌ 言行不一 |

**packages/ 当前的真实功能**：

1. ✅ 让仓库内代码可以 `import "@pencil-agent/ai"` 而不是相对路径 —— 但这**用 tsconfig paths 一样能做到**
2. ✅ 让 mem-core / soul-core 在 build 时被 bundle 成可加载扩展 —— 但这**用 `extensions/cognitive/` 子目录一样能做到**
3. ❌ "未来独立发布"的可能性 —— **2 年版本号不动证明这是假愿景**
4. ❌ "跨 ecosystem 共享" —— **0 个外部直接消费者**

**packages/ 是否合理**：作为当前实现的代码组织手段是 OK 的，但作为"承诺独立发布的子包仓库"是**假象**。这种假象的代价：
- `bundle-deps.js` 这种胶水脚本（F07）
- `mem-core` 反向 import host（U3）
- 每个 package 都有自己的 `tsconfig.build.json` / `prepublishOnly` / `package.json` —— **重复维护成本**
- 新成员困惑："为什么 ai 是 package 而 tools 是 core 子目录？"

### 3.2 `core/` — 评分：⚠️ 名实不副的"杂物间"

**形式上是什么**：nano-pencil 业务核心。

**实质上是什么**：包含 17 个子目录 + 18 个顶层 .ts 文件（agent-dir / config / extensions / mcp / model / persona / prompt / runtime / session / soul-integration / sub-agent / telemetry / tools / utils / workspace / export-html / i18n + 18 个独立文件）。

**实质角色细分**：

| core/ 子项 | 实质属于哪一层（按 README 三层）| 应该在 core/ 吗？ |
|------------|------------------------------|------------------|
| `core/runtime/` | Tool Layer 的 host（agent loop） | ✅ |
| `core/tools/` | Tool Layer | ✅ |
| `core/mcp/` | Tool Layer | ✅ |
| `core/extensions/` | Extension Layer（横切） | ✅ |
| `core/session/` | Cognitive Layer（context 持久化） | ✅ |
| `core/prompt/` | Cognitive Layer（context 组装） | ✅ |
| `core/model/`、`core/model-registry.ts`、`core/model-resolver.ts` | 跨 Cognitive/Tool 的模型层 | ✅ |
| `core/persona/` | Cognitive Layer | ✅ |
| `core/soul-integration.ts` | Cognitive Layer 桥接 packages/soul-core | ⚠️ 跨层 |
| `core/telemetry/` | 横切关注点（D7 域） | ⚠️ 应是顶层域 |
| `core/i18n/` | Interface Layer（横切） | ❌ **不应在 core**，应是平台基础设施 |
| `core/workspace/` | Tool Layer | ✅ |
| `core/export-html/` | Tool Layer 的 IO | ✅ |
| `core/utils/` | 横切基础设施 | ❌ **不应在 core**，应是平台层 |
| `core/keybindings.ts` | Interface Layer | ❌ |
| `core/slash-commands.ts` | Interface Layer（但也是 Extension protocol） | ⚠️ |
| `core/package-manager.ts` | Tool Layer 但 1795 行 | ⚠️ 单独看是 god |
| `core/agent-dir/` | 横切（用户态布局） | ⚠️ |
| `core/config/` | 横切（设置） | ⚠️ |

**结论**：`core/` 实际上**混装了 Tool Layer 业务核心 + 横切基础设施 + Interface 边角**。它的名字 "core" 暗示"业务核心"，但实际是**"不属于 packages/modes/extensions 的所有剩下东西"**的杂物间。

### 3.3 `modes/` — 评分：✅ 角色清晰

4 个对外 surface：`interactive` / `print` / `rpc` / `acp`。每个 mode 是一种 entry shape。

**唯一问题**是内部巨型化（F02）+ 静态导入（F06），但**目录划分本身是合理的**。

### 3.4 `extensions/` — 评分：⚠️ 分层有但语义模糊

```
extensions/
├── defaults/    21 个扩展（启动 eager load）
└── optional/    2 个扩展（用户选择启用）
```

**问题**：

1. **"defaults" 与 "optional" 的边界没规则**：为什么 browser 是 default 但 simplify 是 optional？没有书面标准。
2. **没有 "third-party" 入口**：第三方开发者写的扩展放在哪？README §"Extensible" 承诺了 plugin system，但代码上**没有 third-party extension registry**。
3. **`extensions/` 与 `core/extensions/` 名称混淆**：前者是"扩展实现"，后者是"扩展运行时协议"。新人看到两个 extensions 目录会困惑。

---

## 4. 扩展能力评审：README 承诺 vs 现实

### 4.1 README 的扩展承诺

> "**Extensible** — Plugin system for tools, themes, and behaviors"

承诺 3 类扩展点：**tools** / **themes** / **behaviors**。

### 4.2 现实的扩展机制

| 扩展类型 | 现实机制 | 第三方可扩展？ |
|---------|---------|---------------|
| **Tools** | `core/tools/`（内置）+ `MCP servers`（外部协议）+ `core/extensions/Extension.tools` 字段 | ⚠️ MCP 可第三方；Extension 系统只 first-party |
| **Themes** | `modes/interactive/theme/` 3 个硬编码（dark/light/warm）+ `theme/*.json` | ❌ 完全不可第三方扩展；硬编码 |
| **Behaviors** | `extensions/defaults/*` + `builtin-extensions.ts` 注册表 | ❌ 注册表是仓库内静态，第三方无法注册 |

### 4.3 扩展能力的 4 个具体缺口

**缺口 1：没有 "user extension directory"**
- 用户能不能在 `~/.pencils/extensions/<my-ext>/` 放自己的扩展？**当前不能**。Loader 只从仓库内 `extensions/defaults` 和 `extensions/optional` 加载。

**缺口 2：没有第三方 theme 注册**
- `modes/interactive/theme/theme.ts` 硬编码 3 个 theme key。用户想加 monokai 必须 fork 仓库。

**缺口 3：没有扩展开发者 SDK**
- 写扩展需要的类型从 `@pencil-agent/nano-pencil` 整包 import（U3 问题的另一面）。**没有 `@pencil-agent/extension-sdk` 这样的稳定接口包**。

**缺口 4：MCP servers 是唯一真正可第三方扩展的能力**
- 但 MCP 只覆盖"tools"一类，不覆盖"themes"和"behaviors"。
- README §"Built-in tools include" 列了 5 个内置工具，但用户能不能用 MCP 给 nanopencil 加新工具？技术上可以，但**文档缺位**。

### 4.4 扩展能力综合评分

| 维度 | 评分 | 备注 |
|------|------|------|
| 内部扩展能力 | ✅ 强 | 21 default + 2 optional，hook 体系完整 |
| 第三方扩展能力 | ❌ 弱 | 只有 MCP 一条路；没有 user-dir loader / 第三方 theme / SDK 包 |
| 与 README 承诺一致度 | ❌ 不一致 | README 写得像可用，现实只对 first-party 友好 |

**这是一个**真正背离 README 初衷**的点**。比 F08 quality rule 脱节更严重，因为这影响产品定位。

---

## 5. 是否背离 README 初衷的对照表

| README 关键承诺 | 代码实现状态 | 背离程度 |
|----------------|-------------|----------|
| Three Pillars: Cognitive / Tool / Interface | 代码用四分类，与三层正交 | 🟧 结构层背离（不致命） |
| Privacy First — "no telemetry" | 1.14.3 加入了远程 InsForge telemetry | 🟥 **直接矛盾**（文档需更新或代码需调整） |
| Extensible — Plugin system for tools/themes/behaviors | 只 first-party + MCP；缺第三方注册 | 🟥 **承诺超出现实**（产品定位风险） |
| Fast — Sub-second startup | 当前恒付全 mode/provider/扩展 | 🟧 已知短板，F06/F07 在治 |
| NanoMem 持久记忆 | `packages/mem-core@1.1.0` 已 npm 发布且工作 | ✅ |
| NanoSoul 性格演化 | `packages/soul-core@0.1.0` **npm 404**；实际通过 bundle 工作 | 🟨 名实不副但功能在 |
| 10+ providers | 11 个 provider 在 `packages/ai/src/providers/` | ✅ |
| MCP Protocol Support | `core/mcp/` 工作 | ✅ |
| Terminal Native | `modes/interactive/` + `packages/tui` | ✅ |

**3 处真背离需要在重构方案中明确**：

- **R1 Privacy First vs Telemetry**：必须二选一——要么 README 改"opt-in anonymous telemetry"，要么 telemetry 改 opt-in
- **R2 Extensible 承诺**：要么 README 改 "extensible via MCP and contributions"，要么真做第三方扩展机制
- **R3 三层架构 vs 四分目录**：要么 README 换图（贴四分目录），要么代码重组对齐三层

---

## 5.5 业界对标（grilling 期间补做）

> Phase 3a 期间分两批做：**5.5.A 项目布局对标**（本节，2026-05-27 完成）+ **5.5.B 协议/runtime 对标**（独立调研落到 `industry-protocol-survey.md`，2026-05-28 完成）。本节只保留项目布局视角；协议层证据见 §5.5.B 链接。

### 5.5.A 项目布局对标

5 个开源 Agent 项目顶层结构对比：

| 项目 | ★ | 语言 | 顶层关键目录 | "核心"目录 | packages/ | SDK 位置 |
|------|---|------|------------|----------|----------|---------|
| OpenClaw | 375k | TS | `src/` `packages/` `apps/` `extensions/` `ui/` `skills/` | `src/` 平铺 | 真发布子包 | `tsconfig.plugin-sdk.dts.json` |
| Nanobot (HKUDS) | 43k | Py | `nanobot/` `bridge/` `webui/` | `nanobot/` 单 module | 无 | 不显式 |
| **Continue.dev** | 33k | TS | **`core/`** `packages/` `extensions/` `gui/` `binary/` `skills/` | **`core/` 作顶层** | 8 个细粒度发布库 | `packages/continue-sdk/` |
| Aider | 45k | Py | `aider/` `benchmark/` | `aider/` 单 module | 无 | 不显式 |
| Codex (OpenAI) | 86k | Rust+TS+Py | `codex-rs/` `codex-cli/` `sdk/` `tools/` | `codex-rs/core/` 子目录 | 100+ Rust crate | **`sdk/typescript/` `sdk/python/`** 顶层 |
| **nanoPencil 现状** | - | TS | `core/` `packages/` `modes/` `extensions/` | `core/` 但语义混乱 | 半发布 0 外部消费者 | 无 |

**3 个关键观察**：

1. **`core/` 是业界合法且常见选择** —— Continue.dev（33k★）顶层、Codex（86k★）子目录都用 `core/`。保留 `core/` 有充分先例。
2. **Continue.dev 的拓扑就是候选 D 的形态** —— `core/`（业务核心，不发布）+ `packages/`（细粒度真发布库，含 SDK）+ `extensions/`（host 适配器）。8 个 packages：`continue-sdk` / `config-types` / `llm-info` / `openai-adapters` / `hub` / `fetch` / `terminal-security` / `config-yaml`，全部是**真有外部消费者**的小库。
3. **Codex 100+ crate 是 Rust 特例**，npm package 边界成本高，nanoPencil 不应跟随。

**结论**：候选 D 路线（`core/` + 精选 `packages/`）有 Continue.dev 直接背书。

### 5.5.B 协议 / Runtime 对标 → 已迁出到演进组

> **【已迁移 · 2026-05-29】** 协议/Runtime 对标是 **PARP（演进组）** 的证据层，与候选 D 的结构决策无关，已整体移到 `evolution/industry-protocol-survey.md`；PARP 定义见 `evolution/PARP.md`。
>
> 一句话留档：候选 D 选择 `core/` + 精选 `packages/` 的结构理由来自 §5.5.A 项目布局对标（Continue.dev 同形），**不依赖**协议层证据。协议层证据只服务未来 PARP，是否做 PARP 不影响本文的候选 D 结论。

## 6. 顶层结构调整提案（候选 D 主推 + A/B/C 对照）

基于 §1–§5.5，给出 4 个**顶层结构候选**。这不是 8 个 finding 的延伸，而是**顶层骨架的重新选择**。

> 注：原 §6 列了 A/B/C 三个候选，grilling 期间产出第四候选 **D**（"selective packages + 真发布 + 协议化"），与 Continue.dev 拓扑同形，是当前主推。下面保留 A/B/C 作为对照备忘，**D 详见 §6.D**。

### 候选 A — "认领 monorepo"（中改革）

**核心理念**：承认 packages/ 是**内部代码组织手段**，不再装"未来独立发布"。

```
nanoPencil/
├── cli.ts / main.ts / index.ts          ← 顶层入口（不变）
│
├── src/                                  ← ★ 新增：把现 core/ 和 packages/ 合并的根
│   ├── runtime/                         ← 等于现 core/runtime/
│   ├── ai/                              ← 等于现 packages/ai/
│   ├── agent-core/                      ← 等于现 packages/agent-core/
│   ├── tui/                             ← 等于现 packages/tui/
│   ├── tools/                           ← 等于现 core/tools/
│   ├── mcp/                             ← 等于现 core/mcp/
│   ├── session/                         ← 等于现 core/session/
│   ├── prompt/                          ← 等于现 core/prompt/
│   ├── model/                           ← 等于现 core/model/
│   ├── extensions-host/                 ← 等于现 core/extensions/（扩展运行时）
│   ├── persona/  workspace/  export-html/ ...
│   └── ...
│
├── platform/                            ← ★ 新增：横切基础设施
│   ├── i18n/                            ← 等于现 core/i18n/
│   ├── telemetry/                       ← 等于现 core/telemetry/
│   ├── config/                          ← 等于现 core/config/
│   ├── agent-dir/                       ← 等于现 core/agent-dir/
│   └── utils/
│
├── cognitive/                           ← ★ 新增：对齐 README "Cognitive Layer"
│   ├── mem-core/                        ← 等于现 packages/mem-core/
│   ├── soul-core/                       ← 等于现 packages/soul-core/
│   └── soul-bridge.ts                   ← 等于现 core/soul-integration.ts
│
├── modes/                               ← 不变（Interface Layer）
│   ├── _shell/  interactive/  print/  rpc/  acp/
│
├── extensions/                          ← 扩展实现
│   ├── builtin/                         ← rename "defaults" → "builtin"（更准确）
│   ├── optional/
│   └── third-party-loader.ts            ← ★ 新增：从 ~/.pencils/extensions/ 加载
│
├── packages/                            ← ★ 仅保留 "对外发布单独可用"的包
│   └── extension-sdk/                   ← ★ 新增：第三方扩展类型契约
│
└── scripts/  .dev-docs/  docs/  test/
```

**收益**：
- 消除 packages 形式 vs 实质撕裂
- 三层（Cognitive/Tool/Interface）与目录直接映射（cognitive / src + extensions + platform / modes）
- 第三方扩展有清晰落点（packages/extension-sdk）
- `bundle-deps.js` 可删（packages 不再需要 vendor）
- `mem-core` 反向 import host 问题自动消失（共享同一目录树）

**代价**：
- **打破 `@pencil-agent/mem-core@1.1.0` 已发布的语义**（如果未来想独立发就要重新设计）
- 现有 import path `@pencil-agent/ai` 全部要改成 `./src/ai`（codemod 可做）
- monorepo workspaces 字段移除（开发期 dx 略有影响）
- **风险**：未来如果想让 mem-core 独立发布，需要把它再切出去

### 候选 B — "认领 ecosystem packages"（深改革）

**核心理念**：承认 packages/ 应**真做生态级共享**。把 cognitive / ai / tui 三类真有"跨 Pencil 项目复用"潜力的能力**升到 Pencil ecosystem 顶层**，nano-pencil 只是消费者之一。

```
Pencil/                                  ← ecosystem 顶层
├── packages/                            ← ★ 真正的 ecosystem 共享包（独立 git repo 或 monorepo 包）
│   ├── @pencil-agent/ai/                ← 多 provider AI 库（独立维护、独立发布）
│   ├── @pencil-agent/agent-core/        ← 通用 agent loop 抽象
│   ├── @pencil-agent/tui/               ← 终端 UI 库
│   ├── @pencil-agent/mem-core/          ← 跨项目记忆能力
│   ├── @pencil-agent/soul-core/         ← 跨项目性格能力
│   └── @pencil-agent/extension-sdk/     ← ★ 新增：扩展开发 SDK
│
├── nanoPencil/                          ← nano-pencil 仅作为 ecosystem 一员
│   ├── src/                             ← 业务核心（不含 ai/agent-core/tui/mem/soul）
│   ├── modes/                           ← TUI / print / rpc / acp
│   ├── extensions/builtin/              ← 内置扩展
│   ├── extensions/optional/             ← 可选扩展
│   ├── platform/                        ← 横切
│   └── package.json                     ← dependencies: @pencil-agent/ai, etc.（真依赖！）
│
├── Pencil-Agent-Gateway/                ← 也消费 ecosystem packages
├── nanopencil-editor/                   ← 也消费
├── Pencil-Pet/                          ← 未来可以用 mem/soul
└── ...
```

**收益**：
- packages 不再"形式与实质撕裂"，真为生态服务
- 每个包**独立 release cycle**，nano-pencil 用 semver 引用
- `Pencil-Pet`、`Pencil-Eidolon` 等子项目**真能 npm install** mem-core / soul-core
- README §"NanoMem / NanoSoul" 的定位（Pencil 生态级能力）名实相符
- 第三方扩展从 `@pencil-agent/extension-sdk` 引入稳定类型

**代价**：
- **改组工程量大** —— 涉及 6+ 个独立 npm 包仓库 / 子模块 / monorepo 包决策
- 需要 ecosystem 顶层的 release coordinator（人/CI）
- nano-pencil 不能再 bundle 一切，**冷启动 install 时间增加**（多个 npm 包下载）—— 与 D4 "Fast" 冲突
- 短期内打破 1.x 公共 API
- 风险：可能从来都没有外部消费者愿意单独用 mem-core，做了无意义

### 候选 C — "保现状 + 三处真背离修正"（保守）

**核心理念**：不动顶层骨架，但**修 §5 列的 3 处真背离**。

变化：
1. 删 packages/agent-core（agent-core 直接合并进 core/agent-loop/，因为没有外部消费者）—— 或者保但 README 不再夸"独立发布"
2. soul-core 要么 npm publish 到 0.1.0 让 README 名实相符，要么从 packages 移到 cognitive 子目录
3. 写 `docs/EXTENSIONS.md` 第三方扩展指南；新增 `~/.pencils/extensions/` user-dir loader
4. README §"Privacy First" 改为 "anonymous opt-in telemetry"，与 1.14.3 现实对齐
5. 其他维持现状

**收益**：
- 最小动静；不冒整体性风险
- 仍可独立做 8 个 finding 的优化

**代价**：
- packages/ 形式 vs 实质撕裂**继续存在**
- 顶层杂物间 `core/` 继续混装
- 第三方扩展能力**靠文档而非架构**保证（弱)
- 顶层结构仍与 README 三层不对齐

---

### 三个候选的横向对比

| 维度 | A 认领 monorepo | B 认领 ecosystem | C 保守 |
|------|----------------|------------------|--------|
| 与 README 三层对齐 | ✅ 强 | ✅ 强 | ❌ 仍不对齐 |
| 解决 packages 撕裂 | ✅ 是 | ✅ 是 | ❌ 不解决 |
| 第三方扩展能力 | ⚠️ 需配套写 SDK 包 | ✅ SDK 是顶层 | ⚠️ 靠文档 |
| 与 1.x 兼容性 | ⚠️ 需 codemod 内部 import | ❌ 大改 SDK 公共 API | ✅ 完全兼容 |
| 工程量 | 中等（1-2 个迭代） | 大（3-6 月，需 ecosystem 协调） | 小（1 个 sprint） |
| 与 D4 "Fast" 冲突 | ❌ 无 | ⚠️ 包合并增 install 时间 | ❌ 无 |
| **总体推荐度** | **⭐⭐⭐⭐⭐ 主推** | ⭐⭐⭐（若 ecosystem 战略已定） | ⭐⭐（短期权宜） |

### 旧倾向（grilling 前）

主推 A，但 grilling 中 maintainer 明确表态："mem 和 soul 是独立的重点，希望 src 直接引用但更新时也要发包" + "nanomem 应该可插拔，未来 pencil 可能使用外部记忆"。这两个新约束**让 A 不够用**（A 取消 mem/soul 独立 npm 身份），引出**候选 D**。

## 6.D 候选 D — Selective Packages + 真发布 + 协议化（**当前主推**）

### 6.D.1 核心理念

> **"独立可发布身份"是 packages/ 的唯一入场券。无外部消费者 + 无发布纪律的包，全部退回 `core/lib/`**。
>
> **Memory / Soul 是 PencilAgent 的器官级基础能力**：官方保留连续性内核（canonical state、provenance、merge policy、prompt injection policy），mem-core / soul-core 提供官方基础实现；第三方通过 provider / adapter / candidate seam 接入存储、检索、人格侧面和派生认知模型，而不是直接替换 Pencil 的长期自我解释机制。

#### 6.D.1.1 上位抽象：PARP → 已迁出到演进组

> **【已迁移 · 2026-05-29】** PARP（Pencil Agent Runtime Protocol）是候选 D 之上的产品架构解释层（演进组，net-new），完整定义见 `evolution/PARP.md`。
>
> **与本文（候选 D）的关系**：PARP **不是**候选 D 成立的理由，候选 D 是纯结构决策（见 §5.5.A Continue.dev 同形）。本轮重构与 PARP 的唯一交集是在 `refactor-plan.md` B1/B2 预留 3 个接缝（S1/S2/S3），使未来 PARP 落地为纯增量。`core/continuity/`、`core/agent-profile/`、`packages/extension-sdk/` 的 PARP 协议文件**本轮不建**。

### 6.D.2 选择性归类（5 个现 packages 重新分类）

| 子包 | 独立发布意义 | 候选 D 归属 | 理由 |
|------|------------|------------|------|
| `ai` | 0 外部消费者 + 0.0.1 不动 + 无可见独立路线 | **退到 `core/lib/ai/`** | 当前是 nanoPencil 内部库 |
| `agent-core` | 0 外部消费者 + 0.0.1 不动 | **退到 `core/lib/agent-core/`** | 同上 |
| `tui` | 0 外部消费者 + 0.0.1 不动 | **退到 `core/lib/tui/`** | 同上 |
| `mem-core` | README 力推 + maintainer 明确想保 + 已发 1.1.0 + 未来可接外部 store/provider | **保 `packages/mem-core/`** | 真发布的官方基础记忆实现 |
| `soul-core` | README 力推 + maintainer 明确想保 | **保 `packages/soul-core/`** | 真发布的官方基础灵魂实现（需补发 npm） |
| `extension-sdk`（**新增**）| 第三方扩展协议 + Memory/Soul 低层 provider/adapter 协议 | **新建 `packages/extension-sdk/`** | 等同 Continue.dev 的 continue-sdk，但不外包连续性内核 |

### 6.D.3 目标骨架摘要（权威目录树见 target-architecture）

本文不维护完整目录树，避免与 `target-architecture.md` 重复。候选 D 的权威目标目录见 `target-architecture.md §4`；本文只保留顶层骨架决策：

```text
nanoPencil/
├── core/        ← 仓库核心：runtime/tools/mcp/extensions-host + lib/platform（continuity/agent-profile = 演进保留）
├── modes/       ← 入口形态：interactive/print/rpc/acp
├── extensions/  ← 第一方能力实现：builtin/optional（browser 本轮 builtin→optional；升 Tool Runtime = 演进）
├── packages/    ← 仅放真发布包：extension-sdk/mem-core/soul-core
└── scripts/     ← 质量守门、发布、迁移辅助工具
```

这五个顶层区分回答五个不同问题：

| 顶层区域 | 回答的问题 | 不承载什么 |
|----------|------------|------------|
| `core/` | nano-pencil 作为 Agent runtime 如何运转 | 不承诺独立 npm 发布 |
| `modes/` | 同一 runtime 如何被不同入口形态使用 | 不放业务核心 |
| `extensions/` | 第一方/可选能力如何接入 runtime | 不定义稳定第三方 SDK 类型 |
| `packages/` | 哪些能力值得独立发布并被生态复用 | 不放 0 外部消费者的内部库 |
| `scripts/` | 如何验证、迁移、发布 | 不藏运行时代码 |

### 6.D.4 关键设计决策汇总

| 维度 | 决策 | 业界对标 / 理由 |
|------|------|----------------|
| 顶层目录命名 | **保留 `core/`** | Continue.dev 同样选 `core/`；语义诚实 |
| core 内部分层 | **多管一层**：业务子目录 + `lib/` + `platform/` | 一次性架构决策防止再变杂物间 |
| 上位抽象（PARP）| **演进组**，不在本轮重构 | 见 `evolution/PARP.md`；本轮只预留 S1/S2/S3 接缝 |
| ai/agent-core/tui 归属 | 退到 `core/lib/` | 当前 0 外部消费者；无发布纪律 |
| 未来发布 ai-core | **设计 4**（手工挪 30 分钟 + 可选 promote 脚本） | Continue 历史也是手工挪过 |
| 真发布的包数量 | 3 个（extension-sdk + mem-core + soul-core） | Continue 用 8 个，3 个起步可扩 |
| Memory/Soul 可插拔 | **连续性内核官方定义；provider/adapter/candidate 可插拔** | 不把 PencilAgent 长期自我叙事外包给插件 |
| 扩展运行时位置 | `core/extensions-host/` | Continue 类似 |
| 第一方扩展位置 | `extensions/builtin/` + `optional/` 顶层 | OpenClaw + Continue 都顶层 |
| host dependencies | 真依赖 3 个真包（`workspace:^`）| 标准 npm workspaces 玩法 |
| bundle-deps.js | **删除** | 走 npm 自然解析 |

### 6.D.5 发布依赖原则

候选 D 的发布原则是：**host 不再把 workspace 包倒灌进 dist，而是通过 npm workspace / package dependency 表达真实依赖**。

- `@pencil-agent/nano-pencil` 依赖 3 个真发布包：`extension-sdk`、`mem-core`、`soul-core`
- `core/lib/*` 只作为内部 workspace/private package 提供开发期路径解析，不作为外部承诺
- 发布顺序是 `extension-sdk` → `mem-core` / `soul-core` → `nano-pencil`
- 具体 `package.json` 形态与迁移动作由 `target-architecture.md §4.1` 和 `§7` 维护

### 6.D.6 Memory/Soul 边界原则

本文只记录边界原则；接口草图与目录落点由 `target-architecture.md §5 D5` 维护。

grilling 后修订：原先的 "MemoryProvider / SoulProvider 可替换默认实现" 表述过粗，容易把 PencilAgent 的长期自我解释权外包给第三方插件。新的边界是：

**本轮重构落地（behavior-preserving）**：
- **mem-core / soul-core 保独立发布身份**（soul-core 属"战略保留"例外，已记名）
- **S3 接缝**：mem-core 不再 import `@pencil-agent/nano-pencil`，改 import `@pencil-agent/extension-sdk` 的低层协议（修 U3）——为未来 continuity 内核留干净接口

**【EVOLUTION-RESERVED】演进 E3（见 `evolution/PARP.md §6`）**：
- **官方定义连续性内核**：`core/continuity/` 定义 canonical state、provenance、merge policy、prompt injection policy
- **第三方只插拔技术层**：storage / retrieval candidate / soul facet / cognitive model / 外部知识 adapter
- **最终解释权不外包**：是否 merge、是否长期保存、是否进入 prompt，仍由官方 continuity + engine 决定
- **SAL 认知地图定位**：若只分析/可视化，留在 builtin extension；若参与 recall/planning/reflection，则作为 `CognitiveModelProvider` 提供 derived cognitive model，不直接写 canonical state

### 6.D.7 未来发布机制（设计 4 + 可选辅助工具）

按 maintainer 选择 —— **设计 4**：未来真要发布某模块时，手工挪目录 + 改 import + 写 package.json。每模块约 30 分钟一次性成本。

同步提供 `scripts/promote-to-package.ts` 工具（可选）：

```bash
# 当某天 ai 真有外部消费者时：
node scripts/promote-to-package.ts ai

# 自动完成：
#  1. mv core/lib/ai/ packages/ai/
#  2. 生成 packages/ai/package.json + tsconfig.build.json
#  3. host package.json 加入 "@pencil-agent/ai": "workspace:^"
#  4. 仓库内 import 改 "../core/lib/ai" → "@pencil-agent/ai"
```

工具不强制；它的存在是把"30 分钟手工活"降到"30 秒命令"，**降低未来决策的执行摩擦**。

### 6.D.8 候选 D 满足 maintainer 的全部诉求

| maintainer 诉求 | 候选 D 满足？ | 实现机制 |
|---------------|------------|---------|
| mem/soul 在 src 直接引用 | ✅ | workspace:^ + tsc 开发期吃源码 |
| mem/soul 同时发包 | ✅ | packages/ 真包 + 真依赖 + 真 publish |
| 删 bundle-deps.js | ✅ | 走 npm 自然解析 |
| ai/agent-core/tui 不假装独立 | ✅ | 退 `core/lib/`，不发包 |
| 未来想发 ai-core 不挪来挪去 | ⚠️ 接受 30 分钟成本 + 可选 promote 脚本 | 6.D.7 |
| nanomem 可插拔 | ✅ | MemoryStore / MemoryCandidate provider；官方 MemoryEngine + ContinuityKernel 保留合并权 |
| 配置出不同 PencilAgent | ✅ | PARP + `core/agent-profile/`：CLI / Browser / Remote / Editor profile |
| Browser agent 插件化 | ✅ | Browser capability 作为 optional Browser Tool Runtime；Browser Agent 是 profile，不是普通插件 |
| 修 U3 反向依赖 | ✅ | mem-core depends on extension-sdk |
| 第三方扩展能力真兑现 | ✅ | 4-tier loader + extension-sdk + provider/adapter/candidate seam |
| 与 README 三层对齐 | ✅ | Cognitive=packages/mem+soul · Tool=core/runtime+tools+mcp · Interface=modes+core/lib/tui |
| 编译时间 | ✅ 改善 | 删 4 个子 tsc，单一主 tsc + 3 个真包 build |
| install 影响 | ⚠️ 增 2-3MB | 仅 4 个 tarball；maintainer 已接受 |

---

## 6.A/B/C 备忘（grilling 前候选，保留供未来追溯）

### 候选 A — "认领 monorepo"（被 D 取代）

把 packages/ 全部退到 `cognitive/` `src/` 等目录，**取消 mem/soul 独立发布身份**。问题：maintainer 明确要保 mem/soul 独立发布 → A 不够用。

### 候选 B — "认领 ecosystem packages"（不采用）

packages/ 升到 Pencil 顶层，6 个独立 release cycle，host 真依赖。问题：与 D4 "Fast" 冲突 + release coordination 负担过大 + 0 外部消费者证明生态价值未经验证。**保留作未来 mem-core 真有 2-3 个外部消费者后的升级路径**。

### 候选 C — 保守（不采用）

只修 3 处真背离不动骨架。问题：packages 撕裂继续 + core 杂物间继续。

---

## 7. 本文与 target-architecture.md 的关系

| 文档 | 评审层 | 决策粒度 |
|------|--------|----------|
| **本文（top-level-structure-review）** | **决策依据** —— 为什么放弃 A/B/C、为什么选候选 D？packages/core/extensions 的战略含义是什么？ | 战略级 |
| target-architecture.md | **目标架构** —— 目录树、功能域映射、PARP / continuity 协议边界、迁移路径 | 设计级 |
| finding cards F01–F08 | **单点问题** | 微观级 |

**Grilling 后 maintainer 选择**：**候选 D**（详见 §6.D）。target-architecture.md §4 据此重写为基于 `core/` + `core/lib/` + `core/platform/` + `packages/` (3 个) 的目标结构。

target-architecture.md 当前 9 个决策点 Q1–Q9 状态更新：

| target-arch Q | grilling 状态 |
|---------------|--------------|
| ~~Q1 mem/soul package 身份~~ | 被 Q10 吸收 → **决议：保独立包 + 协议化** |
| ~~Q4 SAL 是包还是扩展~~ | 被 Q10 隐含决定 → **决议：留扩展走 core/telemetry 通道** |
| **Q5 内部 contract 粒度** | 候选 D 下问题简化（同 workspaces 直接 import） |
| **Q9 D8 平台基础设施** | 候选 D 下 `core/platform/` 目录成立 → **决议：集中** |

---

## 8. 决策点状态（grilling 后更新）

### ✅ 已 grilling 决议

| Q | 议题 | maintainer 决议 |
|---|------|----------------|
| **Q10** | 顶层结构选哪个候选？（取代 Q1） | **候选 D** Selective Packages + 真发布 + 协议化 |
| **Q11** | `cognitive/` 目录命名是否合理？ | 不需要 cognitive/，mem+soul 直接放 `packages/`；name 暂时搁置 |
| **Q12** | 第三方扩展做到什么程度？ | **粒度 3 协议化**，但 D5 收窄为 provider/adapter/candidate seam：Memory/Soul 的连续性内核和最终 merge 解释权仍由官方定义 |
| **Q14** | `core/` 杂物间是否拆开？ | **拆开**：业务子目录 + `core/lib/` + `core/platform/` 多管一层 |
| **未来发布机制** | ai-core 何时发布、怎么不挪来挪去？ | **设计 4** 接受 30 分钟手工成本 + 可选 `promote-to-package.ts` 脚本 |

### 🟨 待 grilling

| Q | 议题 | 备注 |
|---|------|------|
| **Q13** | Privacy First 与 telemetry 如何对齐？ | 候选 D 不直接解决；需要单独决议（改 README 或改默认 opt-in） |
| **Q2** | Browser opt-in 是否伤用户？ | F07 战术决策，候选 D 已规划迁 `extensions/optional/browser/` |
| **Q3** | `index.ts` 公共 export 收窄是否做 major bump？ | 候选 D 下问题简化（packages 真依赖 + 内外清晰） |
| **Q5** | 内部 contract 粒度 | 候选 D 下权重降低 |
| **Q6** | `models.generated.ts` 14506 行怎么拆？ | F07 中期项，与 ai 在 `core/lib/ai/` 关联 |
| **Q8** | F08 例外白名单 deadline？ | 战术决策，B1 启动门控 |

### ❌ 失效（被覆盖或吸收）

- ~~Q1 mem/soul package 身份~~ → 被 Q10 决议（保 + 协议化）
- ~~Q4 SAL 是包还是扩展~~ → 留扩展走 telemetry 通道
- ~~Q9 D8 集中化~~ → 候选 D 下 `core/platform/` 自动集中

---

## 9. 状态与下一步

- [x] Phase 1–2 8 个 finding + refactor plan + HTML + target-architecture
- [x] Phase 2.5 顶层结构与扩展能力评审（本文）
- [x] **Phase 3a grilling — 顶层骨架决议（Q10/Q11/Q12/Q14 已定 + 候选 D）**
- [x] **业界对标（5 个开源 Agent 项目，详见 §5.5）**
- [x] target-architecture.md §4 已据本文 §6.D 重写
- [ ] Phase 3b grilling — 剩余 Q（Q2/Q3/Q5/Q6/Q8/Q13）战术决策
- [ ] Phase 3 ADRs（驳回的 finding）
- [ ] 签字 sign-off

**剩余 grilling 顺序建议**：

```
Q13  → telemetry 真背离怎么修（产品定位级，独立决策）
Q8   → quality rule 守门白名单 deadline（B1 启动门控）
Q5   → contract 粒度（B1 启动门控）
其余 Q2/Q3/Q6  → 战术级，可在批次内决策
```

