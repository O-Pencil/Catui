# P3 — 扩展能力（B0b）

```yaml
phase: P3
macro_stage: B        # 功能级（净新增 N + S3 依赖反转）
batch: B0b
status: in_progress
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

- [x] [P2 DoD](./P2-cycles-gate.md#验证门控dod) 全过（verify-quality + verify-dip 绿；2026-05-30）

## 执行检查点（增量 · 强编译耦合部分需 build loop 逐步验证）

> extension-sdk 的类型抽取与 host 的 1465 行 `types.ts` 深度耦合（`ToolDefinition` 牵连 `TSchema`/`AgentToolResult`/`ExtensionContext`/`Theme`/`Component`）。受限环境无法编译，故拆为可逐步 `tsc`/`vitest` 验证的检查点。

| 检查点 | 内容 | 验证 | 状态 |
|--------|------|------|------|
| **P3.0** 地基 | `packages/extension-sdk/` 包骨架 + 自包含 **S1 词汇**(`tools.ts`)+ host workspaces 注册 | `tsc -b packages/extension-sdk`(V3-1) | ✅ |
| **P3.1** S1 host 采纳 | host `ToolDefinition extends ToolRuntimeDescriptor`(首个 host→sdk 跨包引用) | `tsc --noEmit` 绿 | ✅ |
| **P3.2a** SessionManager 实例委托 | `countTouchedSince` 加实例方法 + 纳入 `ReadonlySessionManager`(S3 前置) | host `tsc` 绿 | ✅ |
| **P3.2b** 生命周期 + **S3** | `lifecycle.ts`(ExtensionAPI/Context/Factory + `SessionManagerContract`)+ `tools.ts` 补 ToolResult/ToolContract;`mem-core` 改依赖 extension-sdk;删 gate 的 extension.ts 例外 | `tsc -b sdk` + host/mem-core `tsc --noEmit` + `verify:quality` 绿 | ✅ |
| **P3.3** 4-tier loader | `discoverNpmExtensions()` 补 npm 发现层(排除一方包),接为 tier 4 | `tsc` + `verify:quality` 绿(V3-4 行为不变) | ✅ |
| **P3.4** host 真依赖 | host `dependencies` 加 `@pencil-agent/{extension-sdk@^0.1.0,mem-core@^1.1.0,soul-core@^0.1.0}`(npm 用真实版本,非 `workspace:`)+ extension-sdk 进 `build:deps` | ★ `npm install` 重生成 **package-lock.json**(CI `npm ci` 依赖)+ `npm run build` + 全 mode 冒烟 | 🔄 待 lock |

> **S3 已摸清(P3.2 输入)**:mem-core 对 host 的 value 依赖仅 `SessionManager.countTouchedSince(ctx.cwd, …)` 一处(extension.ts:640)+ `ctx.sessionManager.getSessionFile()`;soul-core 零 host 依赖。故 `SessionManagerContract` 只需覆盖这几个方法。

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
