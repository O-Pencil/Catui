# Gates — 约束② 两套验收门（门组 A 目录级 / 门组 B 功能级）

```yaml
group: refactor
produced_at: 2026-05-29
gate_set_A: final          # 目录级出口门，本文定稿
gate_set_B: draft          # 功能级出口门：起点模板；★ 大阶段一收尾后由 maintainer 功能维度评审定稿
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

## 门组 B — 功能级出口（大阶段二逐域，**草案 · 待你定稿**）

> ★ 你将在大阶段一收尾后**再走一轮功能维度架构评审**，产出该域的质量标准。本表是**起点模板**，不是终稿；各功能域评审时据此细化/替换。

每评审一个功能域（裁决 **重写 / 保持 / 拆分**）后过：

| 门 | 内容 | 通过标准（草案）| 取代 |
|----|------|----------------|------|
| **GB-1 边界守恒（新硬门）** | import 服从目录依赖规则 | `platform↛业务`；runtime 子模块走 import 白名单；`extension-sdk` 不被 host 内部反向 import；`mem/soul` 不依赖 host | **行数<400 门** |
| **GB-2 行为不变 / 有意变更声明** | public API 符号 diff | 默认为空；该域评审若**主动**改 API，必须文档化 + 更新 characterization——**变更要声明，不许误伤** | — |
| **GB-3 决策留痕** | 每域一条裁决 | `{重写\|保持\|拆分}` + 在新约束下的理由（审计链）| — |
| **GB-4 抽象到位** | 单一职责复审 | 行数仅作**触发复审的信号**，非 pass/fail | 行数判决降级 |
| **GB-5 无环 + 守门** | madge + verify-quality | 零环；绿或带 deadline 白名单 | — |
| **GB-6 契约/接缝** | 该域建立的契约 | `_internal` / S2 / S3 形状经 code review | — |

### 待你定稿的开放项（功能评审时填）

- [ ] GB-1 的 **import 白名单**逐目录写死（platform / runtime 子模块 / extension-sdk / mem-soul）
- [ ] GB-4 的"单一职责"判定法（行数仅信号，真判据由你定）
- [ ] 每个功能域（D1–D8）的**域专属质量项**（如 runtime 的并发安全、UI 的快照覆盖率）

---

## 合 main 终验（两阶段全过）

见 [sign-off-main.md](./sign-off-main.md)：门组 A 全过 + 门组 B 逐域全过 + 两分支 llm-wiki 对比 + maintainer 签字。
