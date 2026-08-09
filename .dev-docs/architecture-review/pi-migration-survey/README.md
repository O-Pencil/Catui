# Pi → Catui Migration Survey

> Date: 2026-07-01
> Surveyor: Aria (in conversation with 寸雨 / cunyu)
> Status: **Read-only research report. Not a plan, not a review entry.**
> Scope: `pi` monorepo (5 packages: agent / ai / coding-agent / orchestrator / tui)

## TL;DR

读了 pi 的 3 个文件 + catui 对照后，**结论和一开始的预期相反**：

- **catui 大多数特性已经和 pi 同级或领先**（尤其是 TUI）
- 真正"pi 有、catui 没有"的具体子能力只有 **2 个**，都集中在 **Overlay 焦点管理**
- **没有任何"开箱即用整体迁移"的特性值得做**

| 候选 | 状态 | 价值 | 建议 |
|---|---|---|---|
| 1. Steer / Follow-up 队列（抽自 agent-harness） | 待你拍 | 高 | ⚠️ 单独开 `harness-review/` 专项评审，**不是迁移，是重写** |
| 2. stdout 接管（`output-guard.ts`） | **证伪** | 零 | ❌ catui 架构不撞这个墙 |
| 3. eventbus handler-error 派发 | 已存在 | 零 | ❌ 不动 |
| 4. **Overlay Focus Restore 状态机**（抽自 pi TUI） | 新发现 | 中 | 🟡 单文件 ~150 行改动，建议落 `core/lib/tui/` |
| 5. **OverlayHandle.focus/unfocus API**（抽自 pi TUI） | 新发现 | 低 | 🟡 跟 #4 一起做更顺 |
| 6. Provider 补齐（pi 有 40+，catui 有 16） | 独立议题 | — | 📋 单开盘点提案，**不**混在这次调研里 |

## 关于"调研 ≠ 落地"

报告是**只读调研**，不包含：
- commit
- review 入口
- 任何代码改动

进 review / 写 plan / 改代码，必须由**单独的**目标驱动。这份文档**只在** `.dev-docs/architecture-review/pi-migration-survey/` 下，**不进 git**。

## 文档地图

```
README.md                       # 你正在读的
methodology.md                  # 调研方法 + 读源文件的依据
evidence/
├── pi-architecture.md          # pi 5 个 package 拓扑
├── catui-baseline.md           # catui 现状（按特性对照）
├── pi-vs-catui-agent.md        # Agent 层的逐行对比
└── pi-vs-catui-tui.md          # TUI 层的逐行对比
candidates/
├── 01-steer-followup-queue.md  # 候选 1：运行时改造
├── 02-stdout-takeover.md       # 候选 2：已证伪
├── 03-eventbus-handler-error.md # 候选 3：已存在
├── 04-overlay-focus-restore.md # 候选 4：TUI 焦点恢复（**新发现**）
├── 05-overlay-handle-api.md    # 候选 5：OverlayHandle API 扩展（**新发现**）
└── 06-provider-coverage.md     # 候选 6：provider 补齐（独立议题）
recommendations.md              # 落地顺序 + 风险 + 决策树
```