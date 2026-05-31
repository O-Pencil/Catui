# Execution Plan — 两大阶段重构 runbook

> 🚫 **禁止合入 `main`**：本计划全程在 `refactor/arch-candidate-d` 执行。**任何 phase 都不得直接合 `main`**；`main` 重构期间冻结、只作基线。唯一允许合入 `main` 的时点 = 大阶段一(门组A) + 大阶段二(门组B) **全过 + maintainer 在 [sign-off-main.md](./sign-off-main.md) 签字**后的那一个 PR。子分支只能合入执行分支，不能合 main。

```yaml
group: refactor
status: active
produced_at: 2026-05-29
model: two-macro-stage      # ★ 2026-05-29 重排：目录级(A) → 功能级(B)
branch: refactor/arch-candidate-d
cut_from: main
merge_policy: DO_NOT_MERGE_TO_MAIN_YET
goal: 全仓库重构 —— 长期可维护 + 清理历史代码债
authoritative_refs:
  - ../target-architecture.md       # §4 端态目录（约束源）
  - ../refactor-plan.md             # 批次 / ADR
  - ./migration-classification.md   # 约束① D/R/N/U 迁移分类
  - ./gates.md                      # 约束② 门组 A/B
```

> **方法论（top-down）**：目录边界即抽象约束。先把 §4 端态结构铸成型（**大阶段一**，逻辑零改、功能不变），再让功能在新约束下被逐个重审（**大阶段二**，重写/保持/拆分）。finding 是症状证据，不是工作单元。

---

## 0. 两大阶段

| 大阶段 | 名字 | 做什么 | 铁律 | 出口门 |
|--------|------|--------|------|--------|
| **A** | **目录级**（结构成型）| 按 §4 把代码迁进新目录：D 直接搬 / R 整块 blob 安置 | **代码逻辑一行不动**；只保证顶层划分 + 功能不变 | [门组 A](./gates.md#门组-a--目录级出口大阶段一收尾定稿)（定稿）|
| **B** | **功能级**（约束下重审）| 目录边界已是活约束，逐功能域裁决 重写/保持/拆分 | 验收门重定义（边界守恒为硬门，行数降为信号）| [门组 B](./gates.md#门组-b--功能级出口大阶段二逐域草案--待你定稿)（草案，待定稿）|

```
main (冻结基线)
  └─ refactor/arch-candidate-d
        │
        ├─ 【大阶段一·目录级】 P0 基线+补§4+分类 → P1 搬迁(D+R blob)+接线+DIP
        │        └─ 门组 A 全过 ──►  ★ maintainer 走功能维度架构评审，定稿门组 B
        │
        └─ 【大阶段二·功能级】 P2 治环+守门 → P3 ext-sdk+S3
                 ├─ P4 runtime 拆(S2) ─┐
                 ├─ P5 UI 拆 ──────────┼→ P6 入口体积 → P7? → P8?
                 └─ (逐域过门组 B)─────┘
                          └── 两阶段全过 + 签字 ──PR──► main
```

> ★ **阶段间 handoff**：大阶段一收尾后，maintainer 再走一轮**功能维度**架构评审，产出门组 B 的逐域质量标准（见 `gates.md` 待定稿项）。大阶段二据此执行。
>
> ★ **基线策略**：冻结 `main` 是唯一行为基线来源。P1 骨架迁移与 P2 治环不被 characterization cassette/golden 阻塞；但进入 P4/P5（拆 `agent-session.ts` / `interactive-mode.ts`）前，必须已从冻结 `main` 录制 characterization cassette/golden，并保存公共 API 符号 snapshot。

---

## 1. Phase 索引

### 大阶段一 · 目录级

| Phase | 文件 | 内容 | 状态 | 依赖 |
|-------|------|------|------|------|
| **P0** 基线+分类 | [P0-prepare.md](./P0-prepare.md) | 基线数字 + characterization(含 TUI) + 补 §4 的 U 落点 + 冻结 D/R/N 清单 | 🟡 进行中 | — |
| **P1** 骨架搬迁 | [P1-skeleton-move.md](./P1-skeleton-move.md) | D 直接搬 + R blob 安置 + workspace 接线(仅现存包) + 删 bundle-deps + DIP 同步 + 增量守门预上线 | 🟡 实现完成；门组 A 重型验证待补 | P0 |
| — | **门组 A 验收** + maintainer 功能维度评审 → 定稿门组 B | — | ⬜ | P1 |

### 大阶段二 · 功能级（逐域过门组 B）

| Phase | 文件 | 批次 | 内容 | 依赖 |
|-------|------|------|------|------|
| **P2** 治环+守门 | [P2-cycles-gate.md](./P2-cycles-gate.md) | B1 | F03/F04 治环、F08 守门正式化、R1 telemetry | 门组A |
| **P3** 扩展能力 | [P3-extension-sdk.md](./P3-extension-sdk.md) | B0b→B2 | extension-sdk(N) + 4-tier loader + S3 依赖反转 | P2 |
| **P4** runtime 拆 | [P4-runtime-split.md](./P4-runtime-split.md) | B2 | agent-session 拆 7 子模块 + S2 + theme-contract | P2 |
| **P5** UI 拆 | [P5-ui-split.md](./P5-ui-split.md) | B3 | interactive-mode 拆 controllers/state/mount | P2；建议串 P4 后 |
| **P6** 入口体积 | [P6-entry-volume.md](./P6-entry-volume.md) | B4 | lazy 入口、browser→optional、ai lazy provider | P5 |
| **P7** 体积重设计（可选）| [P7-bundle-redesign.md](./P7-bundle-redesign.md) | B5 | esbuild、models.generated 拆分 | P6 |
| **P8** SDK 收窄（可选）| [P8-sdk-narrow.md](./P8-sdk-narrow.md) | B6 | index.ts 收窄、root barrel R 拆完 | P6 |
| **签字合 main** | [sign-off-main.md](./sign-off-main.md) | — | 两阶段对比 + 签字 | 全部 |

> 各 phase 的**任务清单仍有效**；其内联 DoD **一律以 [gates.md](./gates.md) 门组 B 为准**（草案，待 maintainer 功能评审定稿）。

---

## 2. 执行规则

1. **大阶段一逻辑零改**：R 单元整块 blob 安置，**不在阶段一拆**（门 GA-6）。
2. **§4 是约束源**：U（未定位）必须在 P0 补齐 §4 落点后才搬。
3. **机械与语义分离**：阶段一只搬位置；治环/拆分/新抽象全在阶段二。
4. **门组 B 已定稿**（2026-05-31）：GB-1 import 白名单 / GB-4 单一职责判定法 / 各域质量项见 [gates.md](./gates.md)。
5. **每阶段可回滚**；不碰用户态 `~/.pencils/agents/`。
6. **决策门控（✦）**：标 ✦ 的查 `../refactor-plan.md` ADR 表。

---

## 3. 总进度

- [x] 切执行分支 + 执行方案目录化 + 两大阶段模型
- [x] 【A】[P0](./P0-prepare.md)：补 §4(U) + 冻结分类 + 基线（符号 296 名快照入库 + dist 3.61MB；tsc/cycle 非阻塞后补；TUI 黄金留 P5）
- [x] 【A】[P1](./P1-skeleton-move.md)：目录级骨架实现完成
- [ ] 【A】门组 A 重型验收补齐（symbols diff / characterization / verify-dip / test / smoke）
- [ ] ★ maintainer 功能维度评审 → 定稿 [门组 B](./gates.md)
- [x] 【B】[P2](./P2-cycles-gate.md) 治环+守门 → [P3](./P3-extension-sdk.md) extension-sdk + S1/S3 + 4-tier loader（2026-05-31 build/verify:quality/test 全绿）
- [ ] 【B】[P4](./P4-runtime-split.md) / [P5](./P5-ui-split.md) → [P6](./P6-entry-volume.md) → [P7?](./P7-bundle-redesign.md) / [P8?](./P8-sdk-narrow.md)
- [ ] [sign-off](./sign-off-main.md)
