# P5 — UI god 拆（B3）

```yaml
phase: P5
macro_stage: B        # 功能级
batch: B3
status: pending
risk: medium-high
depends_on: [P4]       # ★ 改串行：P4 runtime 契约稳定后再拆 UI
blocks: [P6]
findings: [F02, F05-partial]
seams: []
gate: gates.md#门组-b
```

## 目标

拆分 `interactive-mode.ts`（~7958 行）为 controllers + state + mount 入口；TUI **行为零回归**。

## 进入条件

- [ ] [P2 DoD](./P2-cycles-gate.md#验证门控dod) 全过
- [ ] [P0](./P0-prepare.md) 来自冻结 `main` 的 characterization cassette/golden + 公共 API snapshot 基线就绪
- [ ] [P4 DoD](./P4-runtime-split.md#验证门控dod) 全过（串行：runtime 契约稳定后再拆 UI）

## 任务清单

- [ ] `modes/_shell/cancellation.ts` 抽出（Q7：只抽 cancellation）
- [ ] `modes/interactive/controllers/`：5 个 controller
  - slash-dispatcher / model-overlay / session-tree / auth-controller / image-pipeline
- [ ] `modes/interactive/state/`：UI 状态合一
- [ ] `interactive-mode.ts` → mount 入口（< 500 行）
- [ ] **F05** 步骤 4-5：扩展类型 UI / commands 部分

## 验证门控（DoD）

> 出口以 [gates.md 门组 B](./gates.md#门组-b--功能级出口大阶段二逐域草案--待你定稿) 为准。本 phase 最高风险，TUI 零回归是命门（依赖 P0 的 TUI characterization 脚手架）。本域补充：

| # | 检查项 | 通过标准 | 门组 B |
|---|--------|---------|--------|
| V5-1 | TUI 零回归（硬）| P0 的 TUI snapshot / characterization **全过** | GB-2 |
| V5-2 | 边界守恒（硬）| controllers/state 不反向依赖 mount；UI 不直接碰 runtime 内部（经契约）| **GB-1** |
| V5-3 | 公共 API | 符号表不变 | GB-2 |
| V5-4 | 单一职责 | controller 职责单一（行数仅信号）| GB-4 |
| V5-5 | 冒烟 | interactive 完整会话 smoke 通过 | GB-2 |

## 提交建议

- 建议拆 ≤5 个 PR 合入执行分支（按 controller 分批）
- 每 PR 合入前跑 V5-1

## 决策门控

无新增 ✦（Q7 已决议：只抽 cancellation）。

## 参考

- Finding：`../findings/F02-interactive-mode-god-file.md`
