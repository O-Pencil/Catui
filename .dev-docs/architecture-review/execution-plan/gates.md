# Gates — 约束② 两套验收门（门组 A 目录级 / 门组 B 功能级）

```yaml
group: refactor
produced_at: 2026-05-29
gate_set_A: final          # 目录级出口门，本文定稿
gate_set_B: final          # 功能级出口门：2026-05-31 功能维度评审定稿（GB-1 白名单 / GB-4 判定法 / 各域质量项）
principle: |
  行数从"判决"降为"触发评审的信号"；"边界守恒"升为硬门。
  门组 A 证明"搬家没碰坏东西"；门组 B 证明"每个功能在新约束下被重审且服从边界"。
```

---

## 门组 A — 目录级出口（大阶段一收尾，**定稿**）

| 门 | 内容 | 通过标准 | 工具 |
|----|------|---------|------|
| **GA-1 结构同构** | 实际目录树 == §4 端态树 | D 全落位；R 已 blob 安置；`migration-classification.md` D/R 行全消化 | 人工 + tree diff |
| **GA-2 行为不变（硬）** | 公共 API 符号 | 重生成 llm-wiki `symbols` 与 P0 基线 diff **仅路径变化**，零符号/签名变化 | llm-wiki diff |
| **GA-3 逻辑零改（硬）** | 被搬文件体内 | `git diff` 仅含路径/import 行；文件体内**无逻辑 diff** | git + review |
| **GA-4 可编译可跑** | 编译 + 测试 + 冒烟 | `tsc --noEmit` 绿；现有测试全绿；CLI 4 mode（interactive/print/rpc/acp）冒烟 | tsc / test / smoke |
| **GA-5 DIP 同构** | 文档跟随 | 各级 `CLAUDE.md` member、P3 header 路径已同步；`verify-dip.ts` exit 0 | verify-dip |
| **GA-6 R/U 已消化** | 不偷拆、不留盲区 | 每个 R 单元 blob 安置 + 已登记大阶段二拆分票；§4 中 U 落点已补齐 | review |

> **增量守门预上线**（你已同意）：`verify-quality` 在大阶段一末以"基线允许全红、只 gate 增量"模式上线，使搬迁本身也在守门下；真正治环在大阶段二头（P2）。

---

## 门组 B — 功能级出口（大阶段二逐域，**已定稿 2026-05-31**）

> 功能维度架构评审已定稿：通用门(GB-1..6)+ 下方 GB-1 import 白名单 / GB-4 判定法 / 各域专属质量项。P4 起逐域据此验收。

每评审一个功能域（裁决 **重写 / 保持 / 拆分**）后过：

| 门 | 内容 | 通过标准（草案）| 取代 |
|----|------|----------------|------|
| **GB-1 边界守恒（新硬门）** | import 服从目录依赖规则 | `platform↛业务`；runtime 子模块走 import 白名单；`extension-sdk` 不被 host 内部反向 import；`mem/soul` 不依赖 host | **行数<400 门** |
| **GB-2 行为不变 / 有意变更声明** | public API 符号 diff | 默认为空；该域评审若**主动**改 API，必须文档化 + 更新 characterization——**变更要声明，不许误伤** | — |
| **GB-3 决策留痕** | 每域一条裁决 | `{重写\|保持\|拆分}` + 在新约束下的理由（审计链）| — |
| **GB-4 抽象到位** | 单一职责复审 | 行数仅作**触发复审的信号**，非 pass/fail | 行数判决降级 |
| **GB-5 无环 + 守门** | madge + verify-quality | 零环；绿或带 deadline 白名单 | — |
| **GB-6 契约/接缝** | 该域建立的契约 | `_internal` / S2 / S3 形状经 code review | — |

### 定稿（2026-05-31 · 功能维度评审）

#### GB-1 import 白名单（逐层依赖方向，单向 DAG）

依赖只能向**下/同层**，禁止向上/向 UI/向组合根。`verify-quality.ts` 已强制 platform↛业务、lib↛host、internal↛root-barrel、零环；本表是 P4/P5 拆分的**目标态**判据（code review + 后续可加规则）。

| 层 | 允许 import | 禁止 import |
|----|------------|------------|
| **core/platform/** | node 内置、第三方、platform 内部 | 任何 `core/` 业务、`core/lib/`、`modes/`、`extensions*`、root barrel |
| **core/lib/** (ai/agent-core/tui) | node、第三方、本包内 | 任何 host 模块(`core/runtime|tools|session|...`)、`modes/`、`extensions*` |
| **core/runtime/ 子模块**(P4 产物) | `platform/`、`lib/`、业务域(`session|tools|model|mcp|prompt|export-html|agent-dir`)、runtime 内**契约/兄弟**、`*-contract.ts` | ❌ `modes/`(经 `theme-contract`/`ui-bridge` 注入)❌ 反向依赖**组合根**`agent-session.ts` ❌ root barrel |
| **core/ 业务域**(session/tools/model/mcp/...) | `platform/`、`lib/`、本域、跨域**契约** | ❌ `modes/` ❌ `runtime/` 组合根 ❌ root barrel |
| **modes/**(UI) | 任意 `core/`、`lib/`、`extensions-host` 契约 | ❌ 反向被 `core/` import(UI 是叶子) |
| **packages/{mem,soul}-core** | `@pencil-agent/extension-sdk` | ❌ `@pencil-agent/nano-pencil`(S3,已清零) |

**P4 必清的现存违规**:`agent-session.ts → modes/interactive/theme`(U2)→ 改走 `core/theme-contract.ts`。

#### GB-4 单一职责判定法（行数仅信号）

一个模块**通过**当且仅当全部满足:
1. **一句话职责**:能用一句不含"和/以及/并"的话描述其职责;否则按连接词拆。
2. **单一变更轴**:它只因**一类**原因变更(改 prompt 组装 vs 改 compaction 策略 vs 改 UI 绑定不应落在同一文件)。
3. **import 内聚**:其依赖集中在 1–2 个域;依赖横跨 ≥4 个不相关域 = 拆分信号。
4. 行数 >400 仅触发**复审**(非自动 fail);复审若满足 1–3 可豁免并记理由。

#### 各域专属质量项（P4/P5 评审时附加)

| 域 | 专属门 |
|----|--------|
| **P4 runtime** | 组合根**单 config 装配**(S2);`ToolOrchestrator` 唯一分发点(S1);abort/取消路径行为不变(characterization 覆盖) |
| **P5 interactive UI** | TUI snapshot/characterization 零回归(最高风险);controllers 间无共享可变状态(经 state/ 单源);mount 入口 <500 行 |
| **P6 入口** | 冷启动 ≤ P0 基线;lazy 边界不破坏 4 mode 冒烟 |

---

## 合 main 终验（两阶段全过）

见 [sign-off-main.md](./sign-off-main.md)：门组 A 全过 + 门组 B 逐域全过 + 两分支 llm-wiki 对比 + maintainer 签字。
