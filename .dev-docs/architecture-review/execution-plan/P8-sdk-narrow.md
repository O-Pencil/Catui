# P8 — SDK 表面收窄（B6 · 可选）

```yaml
phase: P8
macro_stage: B        # 功能级（可选）；含 root index.ts 这个 R 单元的最终拆分
batch: B6
status: review-open
risk: high
depends_on: [P6]
blocks: []
findings: [F03-step3, F06-deprecate]
seams: []
gate: gates.md#门组-b
```

## 目标

收窄 host `index.ts` 公共 export；2.x major bump。**唯一"功能不变"的例外**：对外 API 有意收窄。

> 📋 **可执行方案（逐符号 matrix + extension-sdk 补全 + rewire/重发 + subpath + 迁移指南）**：
> [`../sdk-surface-review/P8-execution-scope.md`](../sdk-surface-review/P8-execution-scope.md)
> （2026-06-11 审计：builtin 扩展走相对 import、mem-core 已在 extension-sdk → 内部 churn 小，breaking 面主要是外部 SDK 消费者 + 用户扩展）。

## 进入条件

- [ ] P1–P6 已完成且 [sign-off](./sign-off-main.md) 前置项满足（或 maintainer 决定 P8 与 sign-off 同窗口）
- [ ] 发版窗口开启（不与 patch 混发）

## 任务清单

- [x] 建立 [sdk-surface-review/](../sdk-surface-review/README.md) 专项评审（docs-only）
- [ ] **F03** 步骤 3：`index.ts` 仅 stable SDK 接口（✦**Q3** major vs deprecate 6mo）
- [ ] **F06**：deprecate root exports；子路径暴露 `InteractiveMode` 等
- [ ] **纪律**：新协议类型只进 `extension-sdk`，不进 host `index.ts`（`../evolution/dev-conventions.md` §3）
- [ ] CHANGELOG + migration guide

## 当前评审结论

P8 可以与 sign-off 验证并行做专项评审，但不建议在当前 sign-off 分支直接实现。

默认建议：

```text
current sign-off: P8 skipped / review-only
future API window: choose breaking narrow or deprecation path
```

原因：

- P8 会制造有意 public API diff。
- 当前 sign-off 主目标是证明 P1-P7 功能行为稳定。
- 若 P8 同步实现，S-1 需要改成“接受 intentional API break”，并补 migration guide / external consumer smoke。

## 验证门控（DoD）

| # | 检查项 | 通过标准 |
|---|--------|---------|
| V8-1 | 有意 breaking | 对外 API 变更**仅为文档化收窄**，非功能回归 |
| V8-2 | Gateway/扩展宿主 | `Pencil-Agent-Gateway` / `native-host` 消费者 smoke 通过 |
| V8-3 | deprecation | 6mo alias 路径（若 Q3 选 B）或 major 文档齐全 |

## 提交建议

- `feat(p8)!: narrow public SDK surface`（major bump）

## 决策门控

| 门控 | 议题 |
|------|------|
| ✦Q3 | major bump 2.0 vs deprecate + 6mo |

## 参考

- Finding：`../findings/F03-root-barrel-causes-cycles.md`
- Review：`../sdk-surface-review/README.md`
