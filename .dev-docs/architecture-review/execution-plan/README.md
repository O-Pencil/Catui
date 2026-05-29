# Execution Plan — 重构执行方案（按 Phase 目录）

```yaml
group: refactor
status: active
produced_at: 2026-05-29
branch: refactor/arch-candidate-d
cut_from: main
merge_policy: DO_NOT_MERGE_TO_MAIN_YET    # ★ 未签字前不合 main
authoritative_refs:
  - ../refactor-plan.md
  - ../target-architecture.md
  - ../refactor-validation.md
  - ../../../llm-wiki/
```

> **文档职责**：本目录是**可执行 runbook**，按 Phase 分文件管理任务与验证。批次排序/ADR 仍以 `../refactor-plan.md` 为权威；端态目录见 `../target-architecture.md`；总体验收方法见 `../refactor-validation.md`。
>
> **演进组（PARP / continuity）不在本目录**，见 `../evolution/`。

---

## 0. 分支与合并策略（★ 硬约束）

| 项 | 规定 |
|----|------|
| **执行分支** | `refactor/arch-candidate-d`（从 `main` 切出，2026-05-29）|
| **main** | 重构期间**冻结**，不接收合并；保留 `llm-wiki/` 作为重构前基线 |
| **合并时机** | P1–P6 全过 + [sign-off-main.md](./sign-off-main.md) 签字 → PR 合 main |
| **子分支** | 可选 `refactor/arch-candidate-d/p<N>-<name>` → PR 合入**执行分支**（不是 main）|
| **回滚单元** | 以 Phase 为单位 revert |

```
main (冻结基线)
  └─ refactor/arch-candidate-d
        ├─ P0 → P1 → P2 ─┬─ P4 ─┐
        │                └─ P5 ─┼→ P6 → P7? → P8?
        └─ P3 (依赖 P1) ─────────┘
              └── (签字) ──PR──► main
```

---

## 1. Phase 索引

| Phase | 文件 | 批次 | 状态 | 依赖 |
|-------|------|------|------|------|
| **P0** 准备 | [P0-prepare.md](./P0-prepare.md) | — | 🟡 进行中 | — |
| **P1** 骨架搬迁 | [P1-skeleton-move.md](./P1-skeleton-move.md) | B0a | ⬜ 待开始 | P0 |
| **P2** 治环+守门 | [P2-cycles-gate.md](./P2-cycles-gate.md) | B1 | ⬜ 待开始 | P1 |
| **P3** 扩展能力 | [P3-extension-sdk.md](./P3-extension-sdk.md) | B0b | ⬜ 待开始 | P1 |
| **P4** runtime 拆 | [P4-runtime-split.md](./P4-runtime-split.md) | B2 | ⬜ 待开始 | P2 + P0 基线 |
| **P5** UI 拆 | [P5-ui-split.md](./P5-ui-split.md) | B3 | ⬜ 待开始 | P2；可与 P4 并行 |
| **P6** 入口与体积 | [P6-entry-volume.md](./P6-entry-volume.md) | B4 | ⬜ 待开始 | P5 |
| **P7** 体积重设计（可选）| [P7-bundle-redesign.md](./P7-bundle-redesign.md) | B5 | ⬜ 可选 | P6 |
| **P8** SDK 收窄（可选）| [P8-sdk-narrow.md](./P8-sdk-narrow.md) | B6 | ⬜ 可选 | 发版窗口 |
| **签字合 main** | [sign-off-main.md](./sign-off-main.md) | — | ⬜ 待开始 | P1–P6 |

> 每个 Phase 文件结构统一：**目标 → 进入条件 → 任务清单 → 验证门控（DoD）→ 提交建议 → 决策门控**。

---

## 2. 执行规则

1. **机械与语义分离**：P1 只搬位置；语义改动进对应 Phase。
2. **接缝只留形状**：S1/S2/S3 只留接口形状，不实现 PARP/continuity 本体。
3. **每 Phase 可回滚**：DoD 不达标 → revert 该 Phase。
4. **不碰用户态**：`~/.pencils/agents/` 向后兼容。
5. **决策门控（✦）**：标 ✦ 的任务动手前查 `../refactor-plan.md` ADR 表。

---

## 3. 总进度

- [x] 切执行分支 `refactor/arch-candidate-d`
- [x] 执行方案目录化（本目录）
- [ ] [P0](./P0-prepare.md)
- [ ] [P1](./P1-skeleton-move.md) → [P2](./P2-cycles-gate.md) / [P3](./P3-extension-sdk.md)
- [ ] [P4](./P4-runtime-split.md) / [P5](./P5-ui-split.md)
- [ ] [P6](./P6-entry-volume.md) → [P7?](./P7-bundle-redesign.md) → [P8?](./P8-sdk-narrow.md)
- [ ] [sign-off-main](./sign-off-main.md)
