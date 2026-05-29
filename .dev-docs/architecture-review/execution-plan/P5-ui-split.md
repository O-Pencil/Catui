# P5 — UI god 拆（B3）

```yaml
phase: P5
batch: B3
status: pending
risk: medium-high
depends_on: [P2]
blocks: [P6]
findings: [F02, F05-partial]
seams: []
parallel_with: [P4]
```

## 目标

拆分 `interactive-mode.ts`（~7958 行）为 controllers + state + mount 入口；TUI **行为零回归**。

## 进入条件

- [ ] [P2 DoD](./P2-cycles-gate.md#验证门控dod) 全过
- [ ] [P0](./P0-prepare.md) characterization / snapshot 基线就绪
- [ ] 建议：P4 部分 runtime 契约稳定后启动（可与 P4 并行但注意 merge 冲突）

## 任务清单

- [ ] `modes/_shell/cancellation.ts` 抽出（Q7：只抽 cancellation）
- [ ] `modes/interactive/controllers/`：5 个 controller
  - slash-dispatcher / model-overlay / session-tree / auth-controller / image-pipeline
- [ ] `modes/interactive/state/`：UI 状态合一
- [ ] `interactive-mode.ts` → mount 入口（< 500 行）
- [ ] **F05** 步骤 4-5：扩展类型 UI / commands 部分

## 验证门控（DoD）

| # | 检查项 | 通过标准 |
|---|--------|---------|
| V5-1 | TUI 零回归 | snapshot / characterization **全过**（本 Phase 最高风险项）|
| V5-2 | 公共 API | 符号表不变 |
| V5-3 | 行数 | interactive-mode 壳 < 500 行 |
| V5-4 | 冒烟 | interactive 模式完整会话 smoke 通过 |

## 提交建议

- 建议拆 ≤5 个 PR 合入执行分支（按 controller 分批）
- 每 PR 合入前跑 V5-1

## 决策门控

无新增 ✦（Q7 已决议：只抽 cancellation）。

## 参考

- Finding：`../findings/F02-interactive-mode-god-file.md`
