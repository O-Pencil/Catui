# P3 — 扩展能力（B0b）

```yaml
phase: P3
macro_stage: B        # 功能级（净新增 N + S3 依赖反转）
batch: B0b
status: pending
risk: low-medium
depends_on: [P2]
blocks: []
findings: [U3]
seams: [S1, S3]
gate: gates.md#门组-b
```

## 目标

新建 `extension-sdk` + 4-tier loader，兑现 README "Plugin system"；完成 **S1/S3 接缝**（为演进预留，不建 PARP 协议文件）。

## 进入条件

- [ ] [P1 DoD](./P1-skeleton-move.md#验证门控dod) 全过（可与 P2 并行，但均依赖 P1）

## 任务清单

- [ ] 新建 `packages/extension-sdk/`：
  - `index.ts`、`tools.ts`（**S1**：`runtime?` / `permissions?` 可选字段）、`themes.ts`、`hooks.ts`、`commands.ts`、`permissions.ts`、`lifecycle.ts`
  - **不建**：`agent-profile.ts` / `host-adapter.ts` / `tool-runtime.ts` / `a2a-bridge.ts` / memory-soul provider 文件（演进 E3/E4）
- [ ] `core/extensions-host/`：4-tier loader（builtin → optional → user-dir → npm）
- [ ] **S3**：`mem-core` / `soul-core` 仅依赖 `@pencil-agent/extension-sdk`，去除 `@pencil-agent/nano-pencil`
  - ⚠️ 不止换 import：`mem-core/src/extension.ts:13` 是 **value import** `SessionManager`（运行时依赖，非纯 type）。须先在 extension-sdk 暴露其能力抽象（或经 `ExtensionContext` 注入），否则依赖反转无法落地
- [ ] host `package.json` 真依赖三包（`workspace:^`）

## 验证门控（DoD）

> 出口以 [gates.md 门组 B](./gates.md#门组-b--功能级出口大阶段二逐域草案--待你定稿) 为准。本域专属补充：

| # | 检查项 | 通过标准 | 门组 B |
|---|--------|---------|--------|
| V3-1 | extension-sdk build | `packages/extension-sdk` 独立 `tsc -b` 通过 | GB-1 |
| V3-2 | 依赖反转（含 value）| mem-core/soul-core 依赖图**不含** host 包名；`SessionManager` value 依赖已抽象 | GB-1 |
| V3-3 | S1 形状 | `runtime?`/`permissions?` 存在、可选、默认 local | GB-6 |
| V3-4 | 行为不变 | 现有 builtin/optional 扩展加载行为不变 | GB-2 |
| V3-5 | 测试 | 现有测试全绿 | GB-2 |

## 提交建议

- `feat(p3): extension-sdk + 4-tier loader + dep reversal`

## 决策门控

无新增 ✦（Q12 重构部分已在 ADR 决议：tools/themes/hooks/commands 协议化）。

## 参考

- 接缝定义：`../evolution/PARP.md` §5
- **不建** EVOLUTION-RESERVED 目录：见 `../target-architecture.md` §4
