# P2 — 治环 + 守门（B1）

```yaml
phase: P2
batch: B1
status: pending
risk: low
depends_on: [P1]
blocks: [P4, P5]
findings: [F03, F04, F08]
seams: []
```

## 目标

消除循环依赖，上线 quality 守门，对齐 telemetry 与 README（R1）。

## 进入条件

- [ ] [P1 DoD](./P1-skeleton-move.md#验证门控dod) 全过

## 任务清单

- [ ] **F03** 步骤 1-2：拆 root barrel 循环；`core/_internal.ts` 或 `*-contract.ts`（✦**Q5**）
- [ ] **F04**：`core/mcp/mcp-types.ts`、`core/soul-options-contract.ts`、`core/lib/ai/event-stream-types.ts`
- [ ] **F08**：`scripts/verify-quality.ts` + `.github/workflows/quality.yml`（✦**Q8** 例外白名单 deadline）
- [ ] **R1**：README "no telemetry" → "opt-in" 或 telemetry 默认 opt-in（✦**Q13**）

## 验证门控（DoD）

| # | 检查项 | 通过标准 |
|---|--------|---------|
| V2-1 | 无环 | `madge` 零循环依赖（对照 P0 基线归零）|
| V2-2 | 守门上线 | `verify-quality` 在 CI 对 PR 生效 |
| V2-3 | R1 一致 | README 表述与 telemetry 实际默认行为一致 |
| V2-4 | 测试 | 现有测试仍全绿 |

## 提交建议

建议拆 3 commit：`refactor(p2): break import cycles` / `ci(p2): verify-quality gate` / `docs(p2): telemetry readme alignment`

## 决策门控

| 门控 | 议题 | 查 |
|------|------|-----|
| ✦Q5 | contract 文件粒度 | `../refactor-plan.md` ADR |
| ✦Q8 | 例外白名单 deadline | 同上 |
| ✦Q13 | Privacy vs telemetry | 同上 |

## 参考

- Finding cards：`../findings/F03-*.md` `F04-*.md` `F08-*.md`
