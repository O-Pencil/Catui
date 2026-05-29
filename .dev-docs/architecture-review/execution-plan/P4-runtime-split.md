# P4 — runtime god 拆（B2）

```yaml
phase: P4
batch: B2
status: pending
risk: medium
depends_on: [P2, P0]
blocks: [P5]
findings: [F01, F05-partial]
seams: [S2]
parallel_with: [P5]
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
- [ ] 各 runtime 子模块 < 400 行

## 验证门控（DoD）

| # | 检查项 | 通过标准 |
|---|--------|---------|
| V4-1 | 公共 API | **符号表 == P0 snapshot**（功能不变硬指标）|
| V4-2 | 行为基线 | characterization tests 全过 |
| V4-3 | S2 形状 | 组合根单 config 装配，code review 确认 |
| V4-4 | 行数 | runtime 各子模块 < 400 行；agent-session 壳 < 500 行 |
| V4-5 | 无环 | madge 仍零循环 |

## 提交建议

- 可按子模块拆多个 commit，末 commit 标记 `refactor(p4): agent-session composition root`

## 决策门控

无新增 ✦。

## 参考

- Finding：`../findings/F01-agent-session-god-module.md`
- 可与 [P5](./P5-ui-split.md) 并行（不同 maintainer / 子分支）
