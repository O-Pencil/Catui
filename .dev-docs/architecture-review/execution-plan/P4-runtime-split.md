# P4 — runtime god 拆（B2）

```yaml
phase: P4
macro_stage: B        # 功能级
batch: B2
status: pending
risk: medium
depends_on: [P2, P0]
blocks: [P5]
findings: [F01, F05-partial]
seams: [S1, S2]        # ★ 补 S1：tool-dispatch.ts 在此建，须守"ToolOrchestrator 唯一分发点"
parallel_with: []      # ★ 改串行：P5 在 P4 后（避免双 god 拆并行的归因/merge 地狱）
gate: gates.md#门组-b
```

## 目标

拆分 `agent-session.ts`（~3550 行）为 7 个子模块 + Composition Root 壳；完成 **S2 接缝**；解 U2（theme-contract）。

## 进入条件

- [ ] [P2 DoD](./P2-cycles-gate.md#验证门控dod) 全过
- [ ] [P0](./P0-prepare.md) characterization 基线 + 公共 API 符号表 snapshot 就绪

## 任务清单

- [ ] `core/runtime/` 抽出 7 子模块：
  - `session-lifecycle.ts`、`model-cycle.ts`、`compaction-pipeline.ts`
  - `tool-dispatch.ts`、`prompt-assembly.ts`、`export-bridge.ts`、`ui-bridge.ts`
- [ ] `agent-session.ts` → Composition Root（**S2：从单一显式 config 对象装配**）
- [ ] 新建 `core/theme-contract.ts`（解 U2：`modes/interactive/theme` 反向依赖）
- [ ] **F05** 步骤 1-3：扩展类型按消费域分文件（lifecycle / tools 部分）
- [ ] **S1**：建 `tool-dispatch.ts` 时保持 `ToolOrchestrator` 为唯一分发点；工具契约 `runtime?`/`permissions?` 可选字段（**不实现** browser/remote/mcp runtime 本体）

## 验证门控（DoD）

> 出口以 [gates.md 门组 B](./gates.md#门组-b--功能级出口大阶段二逐域草案--待你定稿) 为准。**边界守恒(GB-1)是硬门，行数是信号不是判决(GB-4)**。本域补充：

| # | 检查项 | 通过标准 | 门组 B |
|---|--------|---------|--------|
| V4-1 | 边界守恒（硬）| runtime 子模块 import 服从白名单：禁反向依赖组合根 / 禁碰 UI（经 ui-bridge）| **GB-1** |
| V4-2 | 公共 API | 符号表 == P0 snapshot；如有意改须声明 | GB-2 |
| V4-3 | 行为基线 | characterization tests 全过 | GB-2 |
| V4-4 | S2/S1 形状 | 组合根单 config 装配；ToolOrchestrator 唯一分发点，code review 确认 | GB-6 |
| V4-5 | 单一职责 | 子模块职责单一（行数仅作复审信号，非 pass/fail）| GB-4 |
| V4-6 | 无环 | madge 仍零循环 | GB-5 |

## 提交建议

- 可按子模块拆多个 commit，末 commit 标记 `refactor(p4): agent-session composition root`

## 决策门控

无新增 ✦。

## 参考

- Finding：`../findings/F01-agent-session-god-module.md`
- 建议 [P5](./P5-ui-split.md) 在本 phase **之后**串行启动（runtime 契约稳定后，UI 拆才有稳定依赖面；避免双 god 拆并行的归因/merge 冲突）
