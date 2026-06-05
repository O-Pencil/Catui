# Target Architecture — Phase 2 综合层（grilling 后修订）

```yaml
phase: 2-synthesis
produced_at: 2026-05-27T15:38:00Z
revised_at: 2026-05-28T01:25:00Z  # Phase 3a grilling 后修订
status: phase_3a_grilled
based_on:
  - findings/F01-agent-session-god-module.md
  - findings/F02-interactive-mode-god-file.md
  - findings/F03-root-barrel-causes-cycles.md
  - findings/F04-residual-small-cycles.md
  - findings/F05-extensions-types-monolith.md
  - findings/F06-modes-static-imports.md
  - findings/F07-dist-bundle-composition.md
  - findings/F08-quality-rules-not-enforced.md
  - top-level-structure-review.md  # ★ Phase 2.5 顶层评审
  - evolution/PARP.md              # ★ 演进组：PARP 定义（原 §3.5 迁出）
  - evolution/industry-protocol-survey.md  # ★ 演进组：协议/runtime 业界调研（PARP 对位证据）
benchmark_projects:  # ★ grilling 期间业界对标
  - openclaw/openclaw       # 375k★ TS pnpm monorepo
  - continuedev/continue    # 33k★ TS yarn monorepo - 候选 D 同形参考
  - openai/codex            # 86k★ Rust+TS+Py 多语言 monorepo
  - HKUDS/nanobot           # 43k★ Py 单包
  - Aider-AI/aider          # 45k★ Py 单包
benchmark_protocols:  # ★ PARP 五层对位的事实标准（详见 industry-protocol-survey.md §2）
  - ACP   # Agent Client Protocol — Editor↔Agent host adapter（Zed/Linux Foundation, v1）
  - MCP   # Model Context Protocol — Tool runtime 远程分支（Anthropic, 2025-11 spec）
  - A2A   # Agent2Agent Protocol — Host↔Host 跨 runtime 通信（Google→Linux Foundation, v1.2）
product_charter: .PENCIL.md
audience: pencil maintainer
```

> **修订说明（2026-05-29 · 重构/演进分组）**：本文归入**重构组**（behavior-preserving，目标"功能不变"）。原 §3.5 PARP、§5 D5 的 continuity 内核、§4 目录树里的 `core/continuity/` `core/agent-profile/` 及 extension-sdk 的 PARP 协议文件，全部属**演进组（net-new）**，已迁出到 `evolution/PARP.md` 与 `evolution/product-roadmap.md`。本文目录树对这些演进落点统一标注 `【EVOLUTION-RESERVED】`——本轮重构**不建**，仅由 `evolution/PARP.md §5` 的 3 个接缝（S1/S2/S3）预留形状，使未来落地是纯增量。
>
> **修订说明（2026-05-28）**：原 §4 目录结构基于"在现有 packages/core/modes/extensions 四分法下做减法"。Phase 2.5 顶层评审揭示 packages/ 是"形式上的多包，实质上的单包"，且 README 三层（Cognitive/Tool/Interface）与代码目录无映射。Phase 3a grilling 选定**候选 D**（详见 top-level-structure-review.md §6.D），§4 据此重写为基于 `core/` + `core/lib/` + `core/platform/` + `packages/` (3 真发布包) 的目标结构。
>
> 本文是 Phase 2 与 Phase 3 之间的**综合层**，把 8 个 finding + 顶层评审综合为一份目标架构愿景。**不取代** finding cards（每个 finding 的 deletion test、benefits 仍在原卡中），但提供一个**单一可争论的整体设计**。
>
> **文档职责**：本文维护**重构组**的"目标是什么"——目录结构、功能域映射、现状→端态迁移映射。`top-level-structure-review.md` 只维护"为什么选择候选 D"；`refactor-plan.md` 只维护批次与 ADR；**`execution-plan/` 按 Phase 维护任务与验证 DoD**；演进组见 `evolution/`。

---

## 1. 综合诊断：8 个 finding 收敛到 4 类根本症结

把 8 个 finding 不再视为 8 件独立的事，而是同一个底层失序的 4 个表面：

### 1.1 边界缺失（Boundary Absence）

**症状**：F03 主因 + F04 部分 + 新补：mem-core 跨包反向 import

仓库**没有"对外 SDK 表面"与"对内 contract"的明显 seam**。一个 barrel（`index.ts`）同时干 SDK 入口、内部 alias、main entry 三件事；`packages/mem-core` 通过 npm 包名 `@pencil-agent/nano-pencil` 反向 import host 类型，使一个"独立可发布的包"在概念上变成了"嵌套在 host 里"的东西。

**本质**：缺一个"内部 / 外部 / package"的三层边界声明。

### 1.2 职责过载（Responsibility Bloat）

**症状**：F01（agent-session 3408 行）+ F02（interactive-mode 7868 行）+ F05（extensions/types.ts 1446 行）

三个文件占了仓库**8% 的代码量**（约 12 700 / 170 030 行），每个都在一个文件内同时承担 5–10 个互相不相干的责任。这不是"做太多事"的问题，是**"把不相干的事物理上塞进同一空间"**。

**本质**：缺一个"按职责轴切分"的强制纪律。

### 1.3 入口非懒（Eager Entry）

**症状**：F06（modes 静态导入）+ F07（dist 整 copy 无 tree-shaking）+ F02 加重

任何调用方（CLI 用户、Gateway SDK、编辑器扩展）都被迫付出"全 mode + 全 provider + 全扩展"的启动 cost，**即使只用其中一小部分**。Browser Harness 1.4MB 是这种"恒付"模式最贵的一例。

**本质**：缺一个"按需加载"的入口契约。

### 1.4 规则与现实脱节（Charter ≠ Terrain）

**症状**：F08

`core/CLAUDE.md` 自身写下 4 条 quality rule（≤400 行 / ≤15 文件/目录 / 无循环 / JSDoc），但**全部被违反**，且无 CI 守门。`scripts/verify-dip.ts` 验证文档存在性全绿，但**不验证规则本身**。

**本质**：缺一个"把规则提升为可执行守门员"的机制。

---

## 2. 功能域识别（Functional Domains）

要谈"目标目录结构"，先要把"pencil 在做什么"理清。今天的目录布局是按"实现层"分（core / modes / packages / extensions），但**问题是每个功能横跨 2-4 个层**。

下表是按**功能域**重新切的视图，每个域回答 "为什么这个域必须存在 + 它的关键不变量"：

| # | 功能域 | 为什么必须存在 | 关键不变量 | 今天散布在 |
|---|--------|---------------|-----------|------------|
| **D1** | **Agent 引擎** | Pencil 的产品本体：模型→工具→输出循环。`.PENCIL.md` 的 "Jarvis-like operator" 体验完全靠它撑 | 跨 4 种 mode 接口稳定；可被 SDK 嵌入（如 Gateway）；不依赖任何 UI | `core/runtime/`、`packages/agent-core/`、`core/tools/`、`core/session/`、`core/prompt/`、`core/soul-integration.ts` |
| **D2** | **扩展运行时** | 让产品保持薄但能力可扩；MCP、grub、loop、team 等行为都靠它 | hook contract 稳定；不向用户态写入（charter §1） | `core/extensions/`、`builtin-extensions.ts`、`extensions/defaults/`、`extensions/optional/` |
| **D3** | **AI Provider 抽象** | 用户不锁厂；多 provider 是 charter §"模型自由" | OpenAI-style 接口契约；新 provider 加入零侵入；可独立发布 | `packages/ai/` |
| **D4** | **存储 / 持久化** | 会话连续性 + 凭据安全 + 设置生效；charter §"Privacy First" | 用户态结构稳定（向后兼容）；凭据零泄漏；多 agent 隔离 | `core/session/`、`core/config/`、`core/agent-dir/`、用户 `~/.pencils/agents/` |
| **D5** | **认知 / 记忆 / 性格 / 连续性** | NanoMem + NanoSoul 是 README 力推的差异化；PencilAgent 要像"同一个人"持续成长，靠的是记忆、性格和自我解释机制的连续性 | 官方定义 canonical state、provenance、merge policy、prompt injection policy；可插拔模块只能提供存储/检索/候选更新/派生模型，不能绕过官方 engine 直接改写长期自我叙事 | `packages/mem-core/`、`packages/soul-core/`、`extensions/defaults/sal/`、`core/soul-integration.ts` |
| **D6** | **UI / 入口形态** | 4 种 mode：interactive TUI（产品旗舰）、print（CI/管道）、rpc（IDE）、acp（外部 agent 协议） | TUI 行为零回归（charter §人格契约）；mode 之间可独立演化 | `modes/`、`packages/tui/` |
| **D7** | **遥测 / 自我观察** | 1.14.3 后的 ext_* 三表 + SAL eval + diagnostics；handbook 三 Agent 程序的数据底座 | 用户态零写入；凭据缺失→noop；隐私字段白名单 | `core/telemetry/`、`extensions/defaults/{diagnostics,sal}/`、`scripts/self-diagnosis/` |
| **D8** | **平台基础设施** | i18n、theme、keybinding、CLI args、migrations、package detection —— 共享低层工具 | 跨域无业务知识；只提供原语 | 散落：`core/i18n/`、`config.ts`、`migrations.ts`、`modes/interactive/theme/`、`utils/`、`core/keybindings.ts`、`core/utils/` |

**关键观察 1**：**D5 认知域跨越了 `packages/`、`extensions/defaults/`、`core/` 三个目录**。`packages/mem-core` 是包，`soul-integration.ts` 是 core 桥接器，`extensions/defaults/sal` 是扩展 —— 三种不同的"集成方式"对应同一类功能。grilling 后对 D5 的解释进一步收窄：官方不预先规定 PencilAgent 的全部"核心身份内容"，但必须规定它如何形成、更新、合并和解释长期状态。换言之，官方拥有 **Continuity Kernel（连续性内核）**，插件只进入受控的 provider / adapter / candidate update seam。

**关键观察 2**：**D6 UI 域里"产品旗舰"interactive TUI 占了 god 文件**，但 print/rpc/acp 三个**非旗舰但 SDK 嵌入更常用**的 mode 反而拆得相对干净。这暗示 god 文件不是"功能多"造成的，而是**"演进时没有同步重构"**。

**关键观察 3**：**D8 平台基础设施完全没有自己的目录**，被散落在 5-6 处。新增一个跨域共享原语没有明显落脚点。

---

## 3. 不合理设计归纳

按"应该是什么样子 vs 实际是什么样子"列出 7 处具体设计错位：

| # | 应该是 | 实际是 | 涉及 finding |
|---|--------|--------|--------------|
| **U1** | `index.ts` 仅服务外部 SDK 用户；内部模块通过 `core/_internal.ts` 共享 | `index.ts` 是 SDK 入口 + 内部 alias + main re-export 三合一 | F03 |
| **U2** | `core/` 单向依赖 `modes/` 反过来不允许（P1 拓扑） | `agent-session.ts:32` 与 `extensions/types.ts:39` 都反向 import `modes/interactive/theme` | F01、F05 |
| **U3** | `packages/mem-core` 等独立 workspace 包 → 通过 host **接口**集成 | mem-core `import from "@pencil-agent/nano-pencil"`，是反向类型依赖 host 包；被 bundle-deps 整 copy 解决 | F03、F07 |
| **U4** | mode selection 应是 dynamic 入口（按需加载） | `modes/index.ts` 12 行全 static export；只有 ACP 偶然走 `await import()` | F06 |
| **U5** | 默认扩展应是"用户大概率用到"的，opt-in 给低频/重资产 | Browser Harness 1.4MB 是默认 vendored；ext-telemetry 是 opt-in（合理）；但 sal/team/grub 都默认 enable | F07 |
| **U6** | quality rule 应是可执行的 invariants | 4 条规则全在文档里没人执行 | F08 |
| **U7** | 类型应按"消费域"分文件（contract by consumer） | `extensions/types.ts` 1446 行单文件囊括 15 个消费方的所有类型 | F05 |

**U2 + U3 合起来**揭示一个深层问题：**Pencil 既想做"轻量库"又想做"重量级应用"**。
- 当成"库"时，`@pencil-agent/ai` 这类包应该独立发布、严格 semver、不被 host 反向引用
- 当成"应用"时，所有代码塞在 `nanoPencil/` 一个仓库，vendor 整 copy，根本不存包发布问题
- 现状是**两者都做了一半**：有 workspace 包 + bundle-deps，但 package 边界并不真的隔离

这是 Phase 3 grilling 的核心议题之一（见 §6.Q1）。

---

## 3.5 上位抽象：PARP → 已迁出到演进组

> **【已迁移 · 2026-05-29】** PARP（Pencil Agent Runtime Protocol）的完整定义、组合公式、五层协议边界、工具协议化 endpoint、与候选 D 的关系，已迁出到 **`evolution/PARP.md`**（演进组）。业界对位证据见 `evolution/industry-protocol-survey.md`。
>
> **为什么迁出**：PARP 是候选 D 之上的"产品架构解释层 + 未来演进方向"（net-new），**不是本轮重构（behavior-preserving）的一部分，也不是其前提**。把它留在本文会让重构端态与演进愿景混淆，并导致执行批次把"机械搬迁"与"协议/连续性内核新增"捆在一起。
>
> **本轮重构与 PARP 的唯一交集**：在 `refactor-plan.md` B1/B2 预留 3 个接缝（S1 工具契约判别字段 / S2 组合根单 config 装配 / S3 mem-soul 依赖反转，详见 `evolution/PARP.md §5`），使未来 PARP 落地是纯增量、不引发二次重构。除此之外 PARP 的目录（`core/continuity/`、`core/agent-profile/`）、extension-sdk 的协议文件、a2a-bridge 等本轮**一律不建**，在 §4 目录树中统一标注 `【EVOLUTION-RESERVED】`。

---

## 4. 目标目录结构（grilling 后修订到候选 D）

按 §1 四类症结、§2 八个功能域、§3 七处错位推导，**叠加 Phase 2.5 顶层评审的候选 D 决议**（详见 `top-level-structure-review.md §6.D`）。

业界对标依据：Continue.dev 33k★ TS 项目使用 `core/`（顶层业务核心）+ `packages/`（细粒度真发布库，含 SDK）+ `extensions/`（host 适配器）三层布局，与本目标结构同形。

```
nanoPencil/
│
├── cli.ts                              ← CLI 入口（不变）
├── main.ts                              ← 模式分发（变薄；改 dynamic dispatch）
├── index.ts                             ← 【语义变更】仅服务外部 SDK，禁止内部 import
├── builtin-extensions.ts                ← 不变
├── nanopencil-defaults.ts               ← 不变
├── migrations.ts                        ← 不变
│
├── core/                                ← Continue 风："仓库核心"（业务 + 通用库 + 横切）
│   │  ━━━ 业务核心子目录（直接挂 core/）━━━
│   │
│   ├── runtime/                         ← 【F01 拆完】Agent 引擎域
│   │   ├── agent-session.ts             ← 3408 → < 500，退化为 Composition Root
│   │   ├── session-lifecycle.ts         ← 【新】启动/停止/abort 状态机
│   │   ├── model-cycle.ts               ← 【新】CycleModelError + xhigh 兜底
│   │   ├── compaction-pipeline.ts       ← 【新】拥有压缩阈值、执行、abort、branch summary 协调
│   │   ├── tool-dispatch.ts             ← 【新】ToolOrchestrator + bash 直通
│   │   ├── prompt-assembly.ts           ← 【新】系统 prompt + soul context 注入
│   │   ├── export-bridge.ts             ← 【新】HTML 导出绑定
│   │   ├── ui-bridge.ts                 ← 【新】注入 ThemeProvider / I18nProvider
│   │   ├── sdk.ts                       ← 不再 import soul-integration（F04 修）
│   │   ├── pencil-agent.ts              ← 不变
│   │   ├── retry-coordinator.ts         ← 不变
│   │   ├── event-bus.ts                 ← 不变
│   │   ├── turn-context.ts              ← 不变
│   │   └── CLAUDE.md                    ← 【更新】member 列全（修 DIP 漂移）
│   │
│   ├── tools/                           ← 内置工具实现（不变）
│   ├── mcp/                             ← 【F04 修】新增 mcp-types.ts
│   │   ├── mcp-types.ts                 ← 【新】client & config 共用契约
│   │   ├── mcp-client.ts                ← import mcp-types
│   │   └── mcp-config.ts                ← import mcp-types
│   │
│   ├── extensions-host/                 ← 【F05 + Q12】扩展运行时（rename 自 core/extensions/）
│   │   ├── runner.ts
│   │   ├── loader.ts                    ← 4-tier loader（Q12 协议化）
│   │   ├── wrapper.ts
│   │   ├── registry.ts                  ← 【新】tool/theme/command/hook/provider 注册中心
│   │   ├── sandbox.ts                   ← 【新】risk-level 沙箱
│   │   └── permissions.ts               ← 【新】第三方扩展权限提示
│   │   #  cognitive-provider-bridge.ts  ← 【EVOLUTION-RESERVED】continuity provider 桥接，演进 E3 时新增
│   │
│   │  # 【EVOLUTION-RESERVED】core/continuity/ 连续性内核（canonical-state/provenance/
│   │  #  merge-policy/prompt-injection-policy/cognitive-model-contract）本轮不建，
│   │  #  见 evolution/PARP.md §6 + product-roadmap.md E3。重构只需 S3 接缝（mem/soul 依赖反转）。
│   │
│   ├── session/                         ← 不变
│   ├── prompt/                          ← 不变
│   ├── model/                           ← 不变
│   │  # 【EVOLUTION-RESERVED】core/agent-profile/（Agent Profile schema/built-in/resolver）
│   │  #  本轮不建，见 evolution/PARP.md §6 + product-roadmap.md E4。重构只需 S2 接缝（组合根单 config）。
│   ├── sub-agent/                       ← 不变
│   ├── agent-dir/                       ← 不变
│   ├── persona/                         ← 不变
│   ├── workspace/                       ← 不变
│   ├── export-html/                     ← 不变
│   ├── slash-commands.ts                ← 不变
│   ├── soul-integration.ts              ← 【F04 修】不再 import sdk.ts（重构）；接 continuity 留演进 E3
│   ├── soul-options-contract.ts         ← 【新】soul ↔ sdk 共享契约（低层 option，不承载身份解释权）
│   ├── model-registry.ts                ← 不变
│   ├── model-resolver.ts                ← 不变
│   ├── package-manager.ts               ← 1795 行（候选 D 不强制拆，但建议）
│   │
│   │  ━━━ 通用库（多管一层）━━━
│   │
│   ├── lib/                             ← ★ 不打算独立发布的内部库
│   │   ├── ai/                          ← 原 packages/ai；通过 workspaces 提供路径解析
│   │   │   ├── src/
│   │   │   │   ├── providers/           ← 11 个 provider
│   │   │   │   ├── models.generated.ts  ← 【F07】14506 行考虑拆 11 个 per-provider lazy
│   │   │   │   ├── types.ts
│   │   │   │   ├── utils/
│   │   │   │   │   ├── event-stream.ts
│   │   │   │   │   └── event-stream-types.ts  ← 【新】解 F04 环 C
│   │   │   │   └── ...
│   │   │   ├── package.json             ← name: @pencil-agent/ai (private: true)
│   │   │   └── tsconfig.json
│   │   ├── agent-core/                  ← 原 packages/agent-core
│   │   │   ├── src/  package.json  tsconfig.json
│   │   └── tui/                         ← 原 packages/tui
│   │       ├── src/  package.json  tsconfig.json
│   │
│   │  ━━━ 横切基础设施（多管一层）━━━
│   │
│   ├── platform/                        ← ★ 横切原语，无业务知识
│   │   ├── i18n/                        ← 原 core/i18n/
│   │   ├── telemetry/                   ← 原 core/telemetry/（1.14.3 已干净）
│   │   ├── utils/                       ← 原 core/utils/
│   │   ├── config/                      ← 原 core/config/（settings/auth/resource-loader）
│   │   └── keybindings.ts               ← 原 core/keybindings.ts
│   │
│   ├── _internal.ts                     ← 【F03】内部模块共享 contract barrel
│   ├── theme-contract.ts                ← 【新】纯类型，解 U2 反向依赖
│   └── CLAUDE.md                        ← 【更新】quality rule 改为可执行版本（与 F08 联动）
│
├── modes/                               ← 【F06 重组】UI 入口形态
│   ├── index.ts                         ← 【F06】退化为 < 50 行 facade
│   ├── _shell/                          ← 【新】跨 mode 复用骨架（仅 cancellation；Q7 决议）
│   │   └── cancellation.ts
│   ├── interactive/                     ← 【F02 拆完】
│   │   ├── interactive-mode.ts          ← 7868 → < 500，仅 mount 入口
│   │   ├── controllers/                 ← 【新子目录】5 个 controller
│   │   │   ├── slash-dispatcher.ts
│   │   │   ├── model-overlay.ts
│   │   │   ├── session-tree.ts
│   │   │   ├── auth-controller.ts
│   │   │   └── image-pipeline.ts
│   │   ├── state/                       ← 【新】UI 状态合一
│   │   ├── components/                  ← 不变（47 文件）
│   │   └── theme/                       ← 不变；实现 core/theme-contract
│   ├── print/                           ← 不变
│   ├── rpc/                             ← 不变
│   └── acp/                             ← 不变
│
├── extensions/                          ← 第一方扩展（dev 时直接加载，OpenClaw 风）
│   ├── builtin/                         ← 【rename】"defaults" → "builtin"
│   │   #  memory-binding/ soul-binding/ ← 【EVOLUTION-RESERVED】engine↔continuity 桥接，演进 E3 新增
│   │   ├── sal/  mcp/  loop/  diagnostics/  soul/  presence/
│   │   ├── grub/  team/  subagent/  plan/  recap/
│   │   ├── discipline/  interview/  idle-think/
│   │   ├── link-world/  security-audit/  token-save/  btw/  debug/
│   │   └── AGENT.md
│   ├── optional/                        ← 2 → 3+ 个
│   │   ├── browser/                     ← 【F07】从 builtin/ 迁来
│   │   ├── simplify/
│   │   └── export-html/
│   ├── AGENT.md
│   └── third-party.md                   ← ★ 【新】第三方扩展开发指南
│
├── packages/                            ← ★ 候选 D：只放真发布的子包（3 个）
│   ├── extension-sdk/                   ← ★ 【新 · B0b】协议 + 类型契约（等同 Continue 的 continue-sdk）
│   │   ├── src/
│   │   │   ├── index.ts                 ← 总入口
│   │   │   │  ─── 重构（B0b）落地的稳定协议 ───
│   │   │   ├── tools.ts                 ← Tool 协议（含 S1 接缝：runtime? / permissions? 可选字段）
│   │   │   ├── themes.ts                ← Theme 协议
│   │   │   ├── hooks.ts                 ← Hook 协议
│   │   │   ├── commands.ts              ← SlashCommand 协议
│   │   │   ├── permissions.ts           ← 参考 OpenAI Agents SDK Guardrails 双模式
│   │   │   ├── lifecycle.ts             ← Extension / Context / Factory
│   │   │   │  ─── 【EVOLUTION-RESERVED】以下 PARP 协议文件本轮不建（见 evolution/PARP.md §6）───
│   │   │   #  agent-profile.ts          ← 演进 E4（pencil 自定义；参考 MS Agent FW 1.0 YAML）
│   │   │   #  host-adapter.ts           ← 演进（re-export ACP types + pencil CLI host adapter）
│   │   │   #  tool-runtime.ts           ← 演进 E2（re-export MCP types + local/browser runtime）
│   │   │   #  a2a-bridge.ts             ← 演进 E6（A2A 类型 stub）
│   │   │   #  memory-store.ts / memory-candidate.ts ← 演进 E3
│   │   │   #  soul-facet-provider.ts / cognitive-model-provider.ts ← 演进 E3
│   │   ├── package.json                 ← @pencil-agent/extension-sdk
│   │   │                                   peerDependencies: @agentclientprotocol/sdk, @modelcontextprotocol/sdk（演进接入时）
│   │   ├── tsconfig.build.json
│   │   └── README.md                    ← 第三方开发者手册
│   │
│   ├── mem-core/                        ← NanoMem 默认实现，真发布 npm（已 1.1.0）
│   │   ├── src/
│   │   │   ├── index.ts                 ← export NanoMemEngine（官方基础记忆实现）
│   │   │   ├── stores/                  ← 默认本地 store + 可选外部 store adapter
│   │   │   ├── extension.ts             ← 不再 import host；只 import extension-sdk 的低层协议（修 U3）
│   │   │   └── ...
│   │   ├── package.json                 ← peerDependencies: @pencil-agent/extension-sdk
│   │   └── tsconfig.build.json
│   │
│   └── soul-core/                       ← NanoSoul 官方基础实现，真发布 npm（已 0.1.0）
│       ├── src/                         ← SoulEngine + facet merge candidates；不把整套 soul 解释权外包
│       ├── package.json
│       └── tsconfig.build.json
│
├── scripts/
│   ├── verify-dip.ts                    ← 不变
│   ├── verify-quality.ts                ← 【新 F08】把 4 条 quality rule 提升为可执行
│   ├── promote-to-package.ts            ← ★ 【新】core/lib/ → packages/ 自动化工具（设计 4 辅助）
│   ├── bundle-deps.js                   ← 【删除】走 npm 自然解析
│   └── ...
│
├── .github/workflows/
│   ├── quality.yml                      ← 【新 F08】PR 守门
│   └── ...
│
└── .dev-docs/                           ← 不变（架构评审 / 自诊断 / SAL / self-awareness 四并行程序）
```

### 4.1 host package.json 关键变化（候选 D 落地）

```jsonc
{
  "name": "@pencil-agent/nano-pencil",
  "version": "1.15.0",                          // ★ 顶层重构建议 minor bump
  "dependencies": {
    "@pencil-agent/extension-sdk": "^0.1.0",       // ★ 真依赖，npm 可解析
    "@pencil-agent/mem-core": "^1.1.2",            // ★ 真依赖，npm 可解析
    "@pencil-agent/soul-core": "^0.1.0",           // ★ 真依赖，npm 可解析
    // ... 其他第三方
  },
  "workspaces": [
    "core/lib/*",                                // 内部库（开发期路径解析；发布时内嵌到 dist/node_modules）
    "packages/*"                                 // 真发布的包
  ]
}
```

发布期解析规则：

- `packages/*` 中保留的 first-party 包必须是 npm 可解析的公网 semver 依赖（当前：`extension-sdk` / `mem-core` / `soul-core`）。
- `core/lib/*` 是 host 内部库，不作为公网依赖。构建后通过 `copy:internal-libs` 放入 `dist/node_modules/@pencil-agent/*`，供 `dist/*.js` 中保留的 bare import 就近解析。
- 禁止恢复“发布前剥离/改写 package.json 依赖”的脚本路径；缺公网包就先发包，缺内部库就修 host 打包。

`core/lib/<name>/package.json` 显式标 `"private": true`，禁止 npm publish。

### 4.2 现状 → 候选 D 迁移映射（关键路径变化）

| 现路径 | 目标路径 | 变化类型 |
|--------|---------|---------|
| `packages/ai/` | `core/lib/ai/` | 退到内部库（不发布） |
| `packages/agent-core/` | `core/lib/agent-core/` | 同上 |
| `packages/tui/` | `core/lib/tui/` | 同上 |
| `packages/mem-core/` | `packages/mem-core/` | 不变（保独立发布身份） |
| `packages/soul-core/` | `packages/soul-core/` | 不变（保独立发布身份） |
| — | `packages/extension-sdk/` | ★ 新增（B0b：稳定协议 tools/themes/hooks/commands/permissions/lifecycle）|
| `core/extensions/` | `core/extensions-host/` | rename，避免与 `extensions/` 顶层撞名 |
| — | ~~`core/agent-profile/`~~ | 【EVOLUTION-RESERVED】演进 E4，本轮不建（见 evolution/PARP.md §6）|
| `core/i18n/` | `core/platform/i18n/` | 升到 platform/ 横切 |
| `core/telemetry/` | `core/platform/telemetry/` | 同上 |
| `core/utils/` | `core/platform/utils/` | 同上 |
| `core/config/` | `core/platform/config/` | 同上 |
| `core/keybindings.ts` | `core/platform/keybindings.ts` | 同上 |
| `extensions/defaults/` | `extensions/builtin/` | rename（更准确） |
| `extensions/defaults/browser/` | `extensions/optional/browser/` | F07 迁移 |
| — | ~~`extensions/builtin/memory-binding/`~~ | 【EVOLUTION-RESERVED】演进 E3，本轮不建 |
| — | ~~`extensions/builtin/soul-binding/`~~ | 【EVOLUTION-RESERVED】演进 E3，本轮不建 |
| `scripts/bundle-deps.js` | (删除) | 走 npm 自然解析 |

### 4.2.1 core/ 根散文件 + modes 未列项落点（补 §4 盲区 · 2026-05-29）

> 原 §4 树未给以下文件指定目标家（`execution-plan/migration-classification.md` 的 U 段）。判据：`platform/`=零业务知识原语；归属明确的业务→对应子目录；UI 数据→`modes/`；无所属的业务单文件可留 `core/` 根（与 `slash-commands.ts` 同例）。**均为大阶段一行为等价搬迁（逻辑零改）**。

| 现路径 | 目标 | 类型 | 理由（据 P3 头）|
|--------|------|------|----------------|
| `core/exec.ts` | `core/platform/exec/exec.ts` | 搬 | 仅依赖 `child_process` 的命令执行原语，零业务 |
| `core/bash-executor.ts` | `core/platform/exec/bash-executor.ts` | 搬 | 通用 bash 流式执行原语，与 exec 同域 |
| `core/timings.ts` | `core/platform/timings.ts` | 搬 | 无依赖的计时插桩原语（≠远程 telemetry，故不进 telemetry/）|
| `core/defaults.ts` | `core/platform/config/defaults.ts` | 搬 | 9 行默认值常量，归 config |
| `core/diagnostics.ts` | `core/platform/config/diagnostics.ts` | 搬 | 资源冲突诊断类型，与 resource-loader 同域 |
| `core/custom-providers.ts` | `core/model/custom-providers.ts` | 搬 | 自定义 provider 注册，model 域业务 |
| `core/mcp-manager.ts` | `core/mcp/mcp-manager.ts` | 搬 | MCP 生命周期，明确属 mcp 域 |
| `core/messages.ts` | `core/messages.ts` | 原地 | 依赖叶子（只 import ai/agent-core）；被 `session/compaction` + `runtime` **两域**消费 → 放进 runtime 会造 `session→runtime` 环，故留 core/ 根作中立共享契约（同 `soul-options-contract.ts`）；大阶段二可改名 `messages-contract.ts` |
| `core/footer-data-provider.ts` | `modes/interactive/footer-data-provider.ts` | 搬 | TUI footer 数据，属 UI，应离开 core/ |
| `core/skills.ts` | `core/skills.ts` | 原地 | 465 行业务单文件，暂留 core/ 根（同 slash-commands.ts）；是否升 `core/skills/` 留大阶段二评审 |
| `modes/agent-loop-result-format.ts` | `modes/utils/agent-loop-result-format.ts` | 搬 | 跨 mode 共享的结果展示 helper |
| `modes/utils/`（clipboard/image-*）| `modes/utils/` | 原地 | 已是合理的 modes 共享工具目录，§4 树补列即可 |

---

## 5. 目录的"为什么这样设计"（功能域 × 候选 D 目录映射）

把 §2 的 8 个功能域映射到 §4 的目标目录，每个回答 "为什么放在这里"。**已根据候选 D 修订**。

### D1 Agent 引擎 → `core/runtime/` + `core/lib/agent-core/` + `core/tools/`

- `core/lib/agent-core/`：**纯 Agent loop 抽象**（model → tool → output），不知道 pencil 业务；**当前 0 外部消费者 → 退 lib 不发布**。若未来真出现外部消费者，跑 `promote-to-package.ts agent-core` 升回 `packages/agent-core/` 即可
- `core/runtime/`：pencil 业务的 "Composition Root" 层 —— 把 agent-core + tools + session + extensions-host 黏在一起
- `core/tools/`：内置工具实现；它们绑定 pencil 的"信任模型"（bash 沙箱、edit 行号、ls 截断），不入 lib
- **拆 F01 后**：`runtime/` 内 7 个子模块各自 < 400 行，`agent-session.ts` 是装配壳；**S2 接缝**——组合根从单一 config 对象装配（为未来 agent-profile 留形状，本轮不建 profile）
- 【EVOLUTION-RESERVED】`core/agent-profile/`（PARP profile 层）属演进 E4，本轮不建，见 `evolution/PARP.md §6`

### D2 扩展运行时 → `core/extensions-host/` + `extensions/{builtin,optional}/`

- `core/extensions-host/`：**协议宿主**（loader / runner / wrapper / registry / sandbox / permissions）；**4-tier loader**（builtin → optional → user-dir → npm）
- `extensions/builtin/`：用户大概率用到的扩展，启动时 eager load；**rename** "defaults" → "builtin"（更准确）
- `extensions/optional/`：用户**需要时才启用**的扩展（资产重、影响隐私、需配置）
- **拆 F05 后**：扩展类型按消费域分 4 个文件（生命周期 / 工具 / UI / 命令）
- **F07 后**：browser 从 builtin 迁到 optional —— 不是"功能降级"，是"诚实地表达成本"。（未来在 PARP 下重归类为 Browser Tool Runtime 属演进 E2/E5，本轮只做 builtin→optional 迁移）
- **第三方扩展（B0b）**：4-tier loader + extension-sdk 稳定协议（tools/themes/hooks/commands）直接兑现 README "Plugin system"；Memory/Soul 的 provider/adapter 协议属演进 E3

### D3 AI Provider 抽象 → `core/lib/ai/`

- **从 `packages/ai/` 退到 `core/lib/ai/`**：当前 0 外部消费者 + 0.0.1 不动 + 无可见独立路线
- `nanopencil-ai` bin 仍可保留（在 lib/ai/package.json 中），但**不作为发布 CLI 入口**
- `models.generated.ts` 是 codegen 产物；provider 元数据来自上游 API，需要定期 refresh
- **F07 拆完后**：按 provider 切 11 个文件，运行时只 lazy import 用户配置的 provider
- **未来路径**：若 OpenRouter / 其他项目想用 nanoPencil 的 multi-provider 抽象，跑 `promote-to-package.ts ai` 升回 `packages/ai/`

### D4 存储 / 持久化 → `core/session/` + `core/platform/config/` + `core/agent-dir/` + 用户 `~/.pencils/agents/`

- `core/session/`：会话 JSONL + compaction + branching；与 pencil 的"事件结构"紧耦合，没有独立价值
- `core/platform/config/`：settings / auth / resource-loader；SOP §3.3 stability contract，**任何变更走 REVIEW**
- 用户态 `~/.pencils/agents/<id>/`：charter "Privacy First"、**任何 refactor 不可破坏向后兼容**

### D5 认知域 → `packages/mem-core/` + `packages/soul-core/` + `extensions/builtin/sal/`（重构范围）；`core/continuity/` 属演进 E3

**本轮重构范围（behavior-preserving）**：

- `packages/mem-core/` `packages/soul-core/`：**两个真发布的官方基础实现包**，对应 README 力推的 NanoMem / NanoSoul。本轮只调整其**发布/依赖身份**，不改其行为
- 为什么是 packages 而非 core/lib：**maintainer 明确战略保留独立发布身份**。截至 beta.2，`mem-core` / `soul-core` / `extension-sdk` 都按公网 npm 包处理；若未来新增 packages 成员，必须先独立发布，再让 host 依赖公网版本
- **修 U3 反向依赖（S3 接缝）**：mem-core 不再 import `@pencil-agent/nano-pencil`，只 import `@pencil-agent/extension-sdk` 的低层协议契约。这是为未来 continuity 内核插入预留的干净接口
- `extensions/builtin/sal/`：留在扩展形态（不升包），通过 `core/platform/telemetry/` 通道写 `eval_*` 表（1.14.3 已完成，行为不变）

**【EVOLUTION-RESERVED】演进 E3（net-new，本轮不建，见 `evolution/PARP.md §6` + `evolution/product-roadmap.md E3`）**：

- `core/continuity/`：官方连续性内核（canonical state / provenance / merge policy / prompt injection policy）
- `extensions/builtin/{memory-binding,soul-binding}/`：官方 engine ↔ continuity 桥接
- extension-sdk 的 `MemoryStore` / `MemoryCandidateProvider` / `SoulFacetProvider` / `CognitiveModelProvider` 协议
- 人/技术双层解释映射表（记忆/灵魂/经验沉淀/性格变化/认知地图/自我连续性 ↔ Engine/Store/MergePolicy/...）随 continuity 设计一并落到 `core/continuity/README.md`

### D6 UI / 入口形态 → `modes/` + `core/lib/tui/`

- `core/lib/tui/`：**纯渲染 + key handling 抽象**，从 `packages/tui/` 退下来（0 外部消费者）
- `modes/`：每个 mode 是一种"对外 surface"，**它们都消费同一个 D1 的 AgentSession**
- `modes/_shell/cancellation.ts`：跨 mode 复用骨架（Q7 决议：只抽 cancellation，prompt loop 各 mode 自维护）
- **F02 拆完 + F06 lazy 后**：interactive 不再连累其他 mode；SDK 嵌入只付应得的 cost

### D7 遥测 / 自我观察 → `core/platform/telemetry/` + `extensions/builtin/{diagnostics,sal}/` + `scripts/self-diagnosis/`

- `core/platform/telemetry/`：**通用底座**（HTTP 客户端 / batching / credentials / build-meta），1.14.3 已抽完，候选 D 下升 platform/
- `diagnostics/` 扩展：写 `pencil_issue_events`
- `sal/` 扩展：写 `eval_*` 表
- `core/extensions-host/runner.ts:invokeCommand/invokeHookHandler`：写 `ext_command_events` / `ext_llm_calls` / `ext_hook_events`
- `scripts/self-diagnosis/`：手动派发的 reflexive 自学习入口
- **架构上**：所有遥测都通过 `core/platform/telemetry/` 单一 sink；charter §"Privacy First" 守住（仅元数据，无 prompt/completion）

### D8 平台基础设施 → `core/platform/`（**集中化，候选 D 新定**）

- `core/platform/i18n/`、`telemetry/`、`utils/`、`config/`、`keybindings.ts`
- **为什么集中到 `core/platform/`**：多管一层让"业务核心 vs 横切原语"边界物理化，新人 ls 一眼看懂；防止 core/ 再次变杂物间
- F08 守门：`core/platform/*` 可被任何 core 子目录 import，但反向禁止（platform 不依赖业务）

---

## 6. 关键待辩论决策点（Phase 3 grilling 焦点）

下面 9 个是初版 grilling 决策点。**grilling 期间扩展到 14 个**（新增 Q10–Q14，详见 `top-level-structure-review.md §8`）。

> **【2026-05-29 单一决策源】** Q1–Q15 的**权威状态表已统一到 `refactor-plan.md` 的 ADR 决策表**，本表仅作历史摘要，避免三文档漂移。其中 Q12（continuity 深度）/ Q15（PARP 命名）属**演进组决策**，论证迁至 `evolution/PARP.md` 与 `evolution/industry-protocol-survey.md`。

### 6.0 grilling 状态总览（历史摘要 · 权威见 refactor-plan ADR 表）

| Q | 议题 | 状态 |
|---|------|------|
| **Q1** mem/soul package 身份 | 🔒 已决议 → 候选 D 协议化 |
| **Q2** Browser opt-in | 🟨 待 grilling |
| **Q3** index.ts 公共 export 收窄 | 🟨 待 grilling |
| **Q4** SAL 是包还是扩展 | 🔒 已决议 → 保扩展 |
| **Q5** 内部 contract 粒度 | 🟨 待 grilling（候选 D 下降权重）|
| **Q6** models.generated 拆 11 文件 | 🟨 待 grilling |
| **Q7** modes/_shell 粒度 | 🔒 隐含决议 → 只抽 cancellation |
| **Q8** F08 例外白名单 deadline | 🟨 待 grilling |
| **Q9** D8 平台基础设施 | 🔒 已决议 → `core/platform/` 集中 |
| **Q10** 顶层结构候选 | 🔒 已决议 → 候选 D（详见 top-level §6.D）|
| **Q11** cognitive/ 命名 | 🔒 已决议 → 不用 cognitive，mem/soul 直接放 packages |
| **Q12** 第三方扩展深度 | 🔒 重构部分（tools/themes/hooks/commands 协议化，B0b）；continuity provider/candidate 部分 → **演进 E3**（见 evolution/）|
| **Q13** Privacy vs telemetry 对齐 | 🟨 待 grilling（独立决策；建议提到守门同级，见 refactor-plan）|
| **Q14** core/ 杂物间拆开 | 🔒 已决议 → 拆 + 多管一层 |
| **Q15** PARP 命名是否引发"造轮子"误解 | 🔒 **演进组决策** → PARP = composition contract over MCP/ACP/A2A；论证见 `evolution/PARP.md` + `evolution/industry-protocol-survey.md`|

**剩余 grilling 焦点**：Q2 / Q3 / Q5 / Q6 / Q8 / Q13。

下面 9 个原 Q 保留并标注 grilling 状态：

### ~~Q1~~ — mem-core / soul-core 的 package 身份是否保留？

**🔒 grilling 后已决议** — 详见 `top-level-structure-review.md §6.D` 候选 D。

**结论**：**保 package + 真隔离 + 协议化**（原 A 选项升级版）：
1. `packages/mem-core/` 与 `packages/soul-core/` 保留独立可发布身份
2. 它们不再 import `@pencil-agent/nano-pencil`，改 import `@pencil-agent/extension-sdk` 的低层协议（修 U3）
3. 新建 `packages/extension-sdk/` 作为协议契约的稳定家，但协议分层为 `MemoryStore` / `MemoryCandidateProvider` / `SoulFacetProvider` / `CognitiveModelProvider`，不再表达为"整套 MemoryProvider/SoulProvider 可替换"
4. 新建 `core/continuity/`：官方定义 canonical state、provenance、merge policy、prompt injection policy，保留 PencilAgent 长期自我叙事的解释权
5. 在 `extensions/builtin/memory-binding/` / `soul-binding/` 提供桥接扩展（默认实现）
6. 第三方可实现存储介质、召回候选、人格侧面、认知地图等 provider/adapter（如 Mem0/Zep adapter），但不能绕过官方 engine 直接写 canonical memory / soul

**B2 批次影响**：必须先在 B1 引入 `@pencil-agent/extension-sdk` 包，让 mem-core 重定向依赖。

---

### Q2 — Browser Harness 改 opt-in 是否伤用户？

**现状**：默认 vendored 1.4MB。

**选项 A**（opt-in，独立包 `@pencil-agent/browser-harness`）：用户用 `npm i -g @pencil-agent/browser-harness` 启用；启动检测到包就启用 tool。
**选项 B**（保 default，但 lazy-extract）：默认 vendored 但启动时不展开 Python 资源，首次用浏览器时才解压。
**选项 C**（保现状）。

**初始倾向**：A。理由：现状每个用户都付 1.4MB，但根据 charter 受众"competence of elite chief of staff"，浏览器自动化是高级特性而非日常体验；F07 数据说明 default extensions 总尺寸 3MB 里 47% 是 browser。
**反对理由**：opt-in 增加首次使用摩擦；charter "easy to work with" 受损。

**影响**：决定 F07 是否要触碰 SOP §3.3（package "files" 字段）。

---

### Q3 — `index.ts` 公共 export 收窄是否做 major bump？

**现状**：`index.ts` 导出 ~200 个名字，包括 `InteractiveMode`、`main` 等内部细节。

**选项 A**（major bump 2.0.0：彻底收窄）：只导出稳定 SDK 接口（`createAgentSession` / `PencilAgent` / `Tool` 工厂等）；内部用子路径。
**选项 B**（minor bump：deprecate + 维持 alias 6 个月）：保留所有 export，但加 `@deprecated`；6 个月后再 major。
**选项 C**（不收窄）：把循环依赖纯通过 `core/_internal.ts` 修，外部 export 不动。

**初始倾向**：B。理由：major bump 阻力大；deprecation 期是软着陆。
**反对理由**：B 不解决"barrel 文件大"的问题；C 则放弃了 SDK 表面整洁这块价值。

**影响**：决定 F03 是 B1 一步到位还是 B1+B6 两阶段。

---

### ~~Q4~~ — SAL 是继续作为 default extension 还是迁到 `packages/`？

**🔒 grilling 后已决议** — 候选 D 下 packages/ 只装真发布的能力，SAL 当前**未有独立发布需求**。

**结论**：**保 extension（B 选项）+ 等待 SAL Agent 自行演化**：
1. `extensions/builtin/sal/` 继续保持扩展形态
2. 通过 `core/platform/telemetry/` 通道写 `eval_*` 表（1.14.3 P0 已完成）
3. handbook 明确 SAL 由独立 SAL Agent 演化，arch agent 不直接动
4. 若未来 SAL 真需要独立发布（如其他 Pencil 子项目复用 SAL 算法），跑 `promote-to-package.ts sal-core` 升级

---

### Q5 — `core/_internal.ts` vs 分散 contract 文件？

**现状**：F03 提议的"双 barrel"中，内部 contract 集中到一个 `core/_internal.ts`。

**选项 A**（单 internal barrel）：`core/_internal.ts` 一个文件，所有内部共享类型/常量都从这里 re-export。
**选项 B**（每个 boundary 自带 contract 文件）：`core/runtime/runtime-contract.ts`、`core/extensions/extensions-contract.ts` 各自存在，没有顶层 internal barrel。
**选项 C**（命名约定而非文件）：用 ts namespace 或 tsconfig path mapping，不创建新文件。

**初始倾向**：B。理由：A 容易演变为下一个 `index.ts` god barrel；B 让边界更明确，每个 contract 文件就是一个 seam。
**反对理由**：B 文件数变多，新成员需要熟悉多个 contract；A 学习成本低。

**影响**：决定 F03 落地代码风格；可能影响 F04 / F05 的 contract 文件命名。

---

### Q6 — `models.generated.ts` 拆 11 文件 vs 单文件运行时筛选？

**现状**：14506 行单文件 vendored 1.5MB 进 dist。

**选项 A**（拆 11 个 per-provider 文件）：build 时按 provider 切；运行时按 `models.json` 配置 lazy import。
**选项 B**（保单文件但运行时 partial parse）：保留单 generated 文件，但运行时只解码 `models.json` 用到的 provider 子树。
**选项 C**（codegen 时按运行时 detect 输出）：build 时根据 `models.json` 决定要 emit 哪些 provider，自动减小 generated 文件。

**初始倾向**：A。理由：代码可读性、tree-shaking、editor 跳转都最好。
**反对理由**：A 增加 codegen 复杂度；现在 `npm run generate-models` 单文件输出是简单的。

**影响**：决定 F07 中期项的实施难度。

---

### Q7 — `modes/_shell/` 共享骨架 vs 每 mode 自带？

**现状**：4 个 mode 各自重复 prompt loop / cancellation / 错误处理。

**选项 A**（抽 `_shell/`，每个 mode import）：减重复，但跨 mode 行为耦合（改 shell 影响 4 个 mode）。
**选项 B**（保现状，4 个 mode 各自维护）：解耦但有 drift 风险。
**选项 C**（只抽最稳定的 cancellation，prompt loop 各自实现）：折中。

**初始倾向**：C。理由：cancellation 是低层稳定原语，最适合共享；prompt loop 各 mode 行为差异较大，强行抽会做出"框架感"。
**反对理由**：cancellation 单一文件抽出意义不够大，会让 F02 的"_shell/"看起来空。

**影响**：决定 F02 拆分粒度。

---

### Q8 — F08 例外白名单有没有 deadline？

**现状**：F08 提议把 4 条 quality rule 提升为 CI 守门，已知违反列在例外白名单。

**选项 A**（每个例外有 due date，过期自动 fail CI）：强迫架构债定期清理。
**选项 B**（无 deadline，靠 maintainer 手动审）：现状的延伸。
**选项 C**（按 severity 分级 deadline）：load-bearing 3 个月内必须清，structural 6 个月，opinionated 无限。

**初始倾向**：C。理由：A 太严厉会让 PR 误中；B 等于没用。
**反对理由**：C 增加 metadata 维护成本。

**影响**：决定 F08 落地代码长度（A < B < C）。

---

### ~~Q9~~ — D8 平台基础设施是否需要自己的目录？

**🔒 grilling 后已决议** — 候选 D 下 `core/platform/` 目录自动成立。

**结论**：**集中到 `core/platform/`（B 选项升级版）**：
1. `core/i18n/` `core/utils/` `core/telemetry/` `core/config/` `core/keybindings.ts` 统一迁到 `core/platform/`
2. 多管一层（`core/lib/` + `core/platform/`）让横切关注点物理隔离
3. F08 守门：`core/platform/*` 可被任何 core 子目录 import，反向禁止（platform 不依赖业务）
4. 防止"杂物间复发"——一次性架构决策

**反对 A 的理由**（grilling 期间）：A "保散布 + 文档化" 治标不治本；候选 D 多管一层是更彻底的解。

---

## 7. 从现状到目标的迁移路径（高层映射）

> **职责切分（2026-05-29）**：批次权威排序见 `refactor-plan.md`；**每 Phase 任务与验证 DoD 见 `execution-plan/`**；本节只保留现状→端态高层映射。

本轮重构（behavior-preserving）要落地的端态变化，归为四组：

| 组 | 现状→端态动作 | 对应批次（详见 refactor-plan）|
|----|--------------|------------------------------|
| **骨架机械搬迁** | `packages/{ai,agent-core,tui}`→`core/lib/`；`core/{i18n,utils,telemetry,config,keybindings}`→`core/platform/`；`core/extensions/`→`core/extensions-host/`；`extensions/defaults/`→`extensions/builtin/`；删 `bundle-deps.js`；host 真依赖 3 包；新建 `promote-to-package.ts` | **B0a**（codemod，行为等价）|
| **扩展能力（B0b）** | 新建 `packages/extension-sdk/`（稳定协议 tools/themes/hooks/commands/permissions/lifecycle，含 S1 接缝可选字段）+ `core/extensions-host/` 4-tier loader | **B0b** |
| **治环 + 守门 + god 拆 + 体积** | F03/F04 治环、F08 守门、F01/F02 god 拆（含 S2/S3 接缝）、F06/F07 入口与体积 | **B1–B5** |
| **【EVOLUTION-RESERVED】** | `core/continuity/`、`core/agent-profile/`、extension-sdk 的 PARP 协议文件、`extensions/builtin/{memory,soul}-binding/` | **不在本轮**，见 `evolution/PARP.md §6` + `evolution/product-roadmap.md` |

### 7.1 关键观察

1. **原 B0 已拆为 B0a（纯机械搬迁，可一天 ship）+ B0b（extension-sdk + loader）**——把"搬动代码"与"新建协议"分离，使重构组可独立验收"功能不变"。
2. **continuity / agent-profile / PARP 协议文件移出批次链**——它们是 net-new，归演进组按需 gate；本轮只在 B1/B2 预留 S1/S2/S3 三个接缝（见 `evolution/PARP.md §5`）。
3. **唯一二次重构风险点 B6（对外 SDK 收窄）**：靠"extension-sdk 是唯一只增不改协议生长面"对冲（见 `evolution/dev-conventions.md §3`）。
4. 批次排序/门控/可并行性以 `refactor-plan.md` 为准。

---

## 8. 与产品宪章 `.PENCIL.md` 的一致性核验

| `.PENCIL.md` 关键约束 | 本目标架构是否冲突？ | 备注 |
|-----------------------|---------------------|------|
| "warm, natural, not robotic" | ❌ 无冲突 | 目标架构不动任何 prompt/persona 文本 |
| "easy to work with" | ⚠️ **Q2 是关键判断** | Browser opt-in 增加首次摩擦；需衡量 |
| "long-term collaborator" | ❌ 无冲突 | 不动 mem-core / soul-core 用户态 |
| "highly competent and trustworthy" | ✅ 加强 | F08 守门让规则可信；F01-F07 减摩擦让 maintainer 更可信 |
| "protect user's momentum" | ✅ 加强 | F06 lazy load 让冷启动快；F07 减小安装时间 |
| "respect user's time and attention" | ✅ 加强 | 同上 |

`.PENCIL.md` **没有任何条款被本目标架构违反**。Q2 是唯一需要权衡产品体验的决策点。

---

## 9. 文档职责与后续使用（重构组 / 演进组分离）

### 重构组（behavior-preserving，目标"功能不变"）

| 文档 | 角色 |
|------|------|
| `top-level-structure-review.md` | **决策依据** —— 为什么选择候选 D，为什么 packages 只保真发布包 |
| **`target-architecture.md`（本文）** | **架构改造结论** —— 目录树（端态）、功能域映射、现状→端态高层迁移 |
| `refactor-plan.md` | **架构改造计划** —— 批次排序、门控、风险、**单一 ADR 决策状态表**、S1/S2/S3 接缝验收条件 |
| `execution-plan/` | **可执行 runbook** —— 按 Phase 分文件：任务 + 验证 DoD + sign-off |
| `refactor-validation.md` | **重构验收** —— 功能不变（溯源 `llm-wiki`）、分层、无冗余、性能；两分支比对（重构后填充）|
| `findings/F01–F08-*.md` | **微观判断** —— 每个 finding 独立 deletion test、benefits、proposed direction |

### 演进组（net-new，重构后按需 gate）

| 文档 | 角色 |
|------|------|
| `evolution/PARP.md` | **PARP 协议定义** —— 组合公式、五层边界、工具协议化、3 个接缝预留 |
| `evolution/industry-protocol-survey.md` | **协议对位证据** —— PARP 五层 × ACP/MCP/A2A/工业框架/论文覆盖矩阵 |
| `evolution/product-roadmap.md` | **产品演进规划** —— continuity/profile/browser-runtime/多 agent 的 gate 与排期 |
| `evolution/dev-conventions.md` | **未来开发约规** —— 目录归属判据、依赖方向、协议生长面纪律、promote 流程 |

后续维护规则：

1. 目录结构、功能域映射、现状→端态映射只改本文（**不含 PARP/continuity 细节**，那些在 `evolution/`）
2. 候选 D 的论证、A/B/C 的历史对照只改 `top-level-structure-review.md`
3. 执行批次、优先级、决策状态（ADR）、接缝验收只改 `refactor-plan.md`
4. PARP / continuity / agent-profile / 产品路线 / 开发约规只改 `evolution/`
5. finding cards 只在具体 finding 的 deletion test 或 proposed direction 需要刷新时更新

---

## 10. 状态

- [x] Phase 1 量化扫描 + 走读
- [x] Phase 2 finding cards × 8
- [x] Phase 2 refactor-plan.md
- [x] Phase 2 HTML 报告
- [x] Phase 2 综合层（本文初版）
- [x] **Phase 2.5 顶层结构与扩展能力评审**（`top-level-structure-review.md`）
- [x] **Phase 3a 业界对标**（OpenClaw / Continue.dev / Codex / Nanobot / Aider）
- [x] **Phase 3a grilling — 顶层骨架已决议**（Q1/Q4/Q7/Q9/Q10/Q11/Q12/Q14 = 候选 D）
- [x] **本文修订到候选 D**（§4 目录结构 + §5 功能域映射 + §7 迁移路径 + B0 批次）
- [x] **重构组 / 演进组分离（2026-05-29）**：PARP/continuity/agent-profile 迁出到 `evolution/`；本文目录树标 EVOLUTION-RESERVED；§7 拆 B0a/B0b；§9 文档职责重列
- [ ] Phase 3b grilling — 战术决策（Q2/Q3/Q5/Q6/Q8/Q13）
- [ ] Finding cards 据本文修订（U3/U2 等议题刷新到候选 D 措辞）
- [ ] Phase 3 ADRs（若有驳回）
- [ ] Phase 3 sign-off
