# P1 — 骨架搬迁（B0a · 行为等价）

```yaml
phase: P1
batch: B0a
status: pending
risk: low-medium
depends_on: [P0]
blocks: [P2, P3]
findings: []
seams: []
```

## 目标

候选 D 目录机械搬迁，**行为完全等价**；删 `bundle-deps.js`，为 npm workspace 真依赖铺路。

## 进入条件

- [ ] [P0 DoD](./P0-prepare.md#验证门控dod) 全过

## 任务清单

- [ ] `packages/{ai,agent-core,tui}` → `core/lib/`（各 `package.json` 标 `"private": true`）
- [ ] `core/{i18n,utils,telemetry,config,keybindings.ts}` → `core/platform/`
- [ ] `core/extensions/` → `core/extensions-host/`
- [ ] `extensions/defaults/` → `extensions/builtin/`
- [ ] host `package.json`：workspaces → `core/lib/*` + `packages/*`
- [ ] 删 `scripts/bundle-deps.js`
- [ ] 新建 `scripts/promote-to-package.ts`
- [ ] ts-morph codemod 批量改 import；写 `CODEMOD.md`
- [ ] **禁止**：改业务逻辑、改公共 API、建 `core/continuity/` / `core/agent-profile/`

## 验证门控（DoD）

| # | 检查项 | 通过标准 |
|---|--------|---------|
| V1-1 | 编译 | `tsc --noEmit` 通过 |
| V1-2 | 测试 | 现有测试全绿 |
| V1-3 | llm-wiki diff | 重生成 `files/` + `symbols/` 与 P0 基线 diff **仅路径变化**，无符号/行为变化 |
| V1-4 | 冒烟 | CLI 启动 + 1 条关键路径通过 |
| V1-5 | 搬迁完整性 | `target-architecture.md §4.2` 映射表 P1 行全部落地 |

## 提交建议

- 单 commit：`refactor(p1): skeleton move (behavior-equivalent)`
- 机械搬迁与任何语义改动**不得**混在同一 commit

## 决策门控

无 ✦ 门控。

## 参考

- 端态映射：`../target-architecture.md` §4.2
- 可选子分支：`refactor/arch-candidate-d/p1-skeleton-move`
