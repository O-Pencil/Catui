# AgentSession Split Review

> 专项评审：`core/runtime/agent-session.ts` god class 拆分（P4 runtime 拆分的遗留尾巴）

```yaml
doc: agent-session-split-review
status: open
created: 2026-09-11
owner: core/runtime
trigger: feature-workflow §3（load-bearing 区域 / >400 行 / 重写）
```

## Scope

拆分 `AgentSession`（2724 行文件、类体 2507 行、115 个方法），把纯转发的 settings accessor 移出主文件。

- **本次做**：55 个纯 `settingsManager` 一行委托的 getter/setter → `SessionSettingsAccessors` mixin
- **本次不做**：内部逻辑方法（`prompt`/`compact`/`fork` 等 59 个）；委托给其他 collaborator 的一行方法（如 `abortRetry` → `_retryCoordinator`）；`interactive-mode.ts`（2482 行，另立评审）

## Findings

- [AS01: 55 accessor 是纯委托，物理上不属于主类逻辑](findings/AS01-pure-delegation-accessors.md)
- [AS02: 上次 P4 拆分只抽了 helper 模块，类体未瘦身](findings/AS02-previous-split-left-class-body-intact.md)

## Decision

用 **mixin 组合**：`SessionSettingsAccessors(Base)` 提供 55 个转发方法，`AgentSession extends SessionSettingsAccessors(AgentSessionCore)`。

- 公共 API 面不变（mixin 方法在原型链上，`session.getTheme()` 照常可用）
- 构造签名不变（constructor 留在基类，`new AgentSession(config)` 兼容）
- 行为不变（每个方法体原样搬移，一行委托仍是同一行委托）
- 依赖方向单一：mixin 文件只依赖 `SettingsManager` 类型 + 基类约束接口

## Acceptance

- [ ] `npx tsc --noEmit` 绿
- [ ] `npm run build` 绿
- [ ] `npm run verify:dip` 绿（新文件补 P3 头）
- [ ] `npm run verify:quality` 绿（无新循环）
- [ ] `npm run verify:package-boundary` 绿
- [ ] `test:harness-critical` 绿（含 sdk/agent-session 相关测试）
- [ ] `test:source-evolution` 绿
- [ ] public API 符号 diff 无变化（mixin 方法原样保留）