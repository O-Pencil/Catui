# P8 — Public Contract / SDK 表面收窄（B6）

```yaml
phase: P8
macro_stage: B        # 功能级（可选）；含 root index.ts 这个 R 单元的最终拆分
batch: B6
status: root-narrowing-implementation
risk: high
depends_on: [P6]
blocks: []
findings: [F03-step3, F06-deprecate]
seams: []
gate: gates.md#门组-b
```

## 目标

P8 现在拆成两个层次推进：

1. **公共契约生成 / 收敛（当前进行中，非 breaking）**：跨 publish 边界的协议类型只进入 `@pencil-agent/protocol`，host 侧 re-export 或 `extends` 保持兼容。
2. **root `index.ts` 收窄（后续 major window，breaking）**：`@pencil-agent/nano-pencil` 根导出最终只保留 host embedding SDK；内部能力转 explicit subpath 或移除。

**唯一"功能不变"的例外**仍然是第 2 层：对外 API 有意收窄。第 1 层必须保持行为和 public root 兼容。

> 📋 **可执行方案（逐符号 matrix + protocol inventory + protocol 切片 + subpath + 迁移指南）**：
> [`../sdk-surface-review/P8-execution-scope.md`](../sdk-surface-review/P8-execution-scope.md)
> 当前切片清单见 [`../sdk-surface-review/protocol-inventory.md`](../sdk-surface-review/protocol-inventory.md)。
> root export 目标矩阵见 [`../sdk-surface-review/public-api-matrix.md`](../sdk-surface-review/public-api-matrix.md)，迁移指南见 [`../sdk-surface-review/migration-guide.md`](../sdk-surface-review/migration-guide.md)。

## 进入条件

- [x] P1–P6 已完成且 sign-off 进入收尾。
- [x] `@pencil-agent/extension-sdk` 已重命名为 `@pencil-agent/protocol`（2026-06-12 决议）。
- [x] root `index.ts` 收窄前必须明确 major 发版窗口（2.0 beta hard break，不与 patch 混发）。

## 任务清单

- [x] 建立 [sdk-surface-review/](../sdk-surface-review/README.md) 专项评审（docs-only）
- [x] 建立 protocol 作为唯一公共契约生长面（`packages/protocol`）
- [ ] 建立 protocol inventory，逐类标注 `protocol / host-only / ui-subpath / defer`
- [ ] 逐切片迁移跨 publish 边界的公共契约，host 侧 re-export / extends 保兼容
- [x] sign off root export destination matrix
- [x] sign off migration guide and hard-break beta policy
- [x] **F03** 步骤 3：`index.ts` 仅 stable SDK 接口（✦**Q3** = 2.0 beta hard break）
- [x] **F06**：root exports hard-break 收窄；仅保留已签核 advanced subpaths，不暴露 modes/UI
- [x] **纪律**：新协议类型只进 `@pencil-agent/protocol`，不进 host `index.ts`（`../evolution/dev-conventions.md` §3/§3b）
- [ ] CHANGELOG + migration guide

## 当前评审结论

P8 当前已从**非 breaking 的 protocol 切片**进入 root `index.ts` 的破坏性收窄实现窗口。

最终决议：

```text
current window: 2.0 beta hard break; narrow root exports; preserve only signed-off subpaths
```

原因：

- 直接收窄 root 会制造有意 public API diff，当前 2.0 beta 接受该 break。
- protocol 切片已完成依赖反转和公共契约生成；root 不再承载 extension/UI/mode host internals。
- 每个切片必须满足 `dev-conventions.md §3b`：只有跨 publish 边界的类型才进入 protocol。
- root 收窄必须以 `public-api-matrix.md` 和 `migration-guide.md` 为准，并补 external consumer smoke。

## 验证门控（DoD）

| # | 检查项 | 通过标准 |
|---|--------|---------|
| V8-1 | 有意 breaking | 对外 API 变更**仅为文档化收窄**，非功能回归 |
| V8-2 | Gateway/扩展宿主 | `Pencil-Agent-Gateway` / `native-host` 消费者 smoke 通过 |
| V8-3 | deprecation | 6mo alias 路径（若 Q3 选 B）或 major 文档齐全 |
| V8-4 | protocol 切片 | `packages/protocol` 只包含跨 publish 边界契约；host 富类型留在 host |

## 提交建议

- `refactor(protocol): move <contract> to @pencil-agent/protocol`（非 breaking 切片）
- `feat(p8)!: narrow public SDK surface`（major bump，root 收窄时）

## 决策门控

| 门控 | 议题 |
|------|------|
| ✦Q3 | major bump 2.0 vs deprecate + 6mo |

## 参考

- Finding：`../findings/F03-root-barrel-causes-cycles.md`
- Review：`../sdk-surface-review/README.md`
