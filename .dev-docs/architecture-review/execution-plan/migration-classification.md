# Migration Classification — 约束① 目录迁移评审清单（D / R / N / U）

```yaml
group: refactor
status: draft               # 待 maintainer 核对 R 行 + 补齐 U 行后转 active
produced_at: 2026-05-29
authoritative_refs:
  - ../target-architecture.md   # §4 端态目录（约束源）
  - ../refactor-plan.md         # finding ↔ 批次
scope: 全仓库（D1–D8 全功能域）
```

> **职责**：把现状每个代码单元按"在 §4 端态映射到几个目标目录"分类，决定**大阶段一**怎么迁。
> 判定规则（约束①）：
> - **1 个家 → D 直接迁移**（整块挪 + 只改 import，逻辑零改）
> - **≥2 个家 → R 需核对**（新边界切穿它；大阶段一**整块挪到临时主家**，拆分留大阶段二）
> - **端态有、现状无 → N 净新增**（不属迁移，归大阶段二）
> - **§4 未指定家 → U 未定位**（结构缺口，**大阶段一前必须先补 §4**）

---

## D — 直接迁移（逻辑零改，门组 A 验收）

### D.1 改路径（搬 / rename）

| 现路径 | 目标 | 说明 |
|--------|------|------|
| `packages/ai/` | `core/lib/ai/` | 包名 `@pencil-agent/ai` 保留 → 内部 import **几乎不变**，靠 workspace 解析 |
| `packages/agent-core/` | `core/lib/agent-core/` | 同上 |
| `packages/tui/` | `core/lib/tui/` | 同上 |
| `core/i18n/` | `core/platform/i18n/` | deep relative import 需 codemod |
| `core/telemetry/` | `core/platform/telemetry/` | 同上 |
| `core/utils/` | `core/platform/utils/` | 同上 |
| `core/config/` | `core/platform/config/` | 同上 |
| `core/keybindings.ts` | `core/platform/keybindings.ts` | 同上 |
| `core/extensions/` | `core/extensions-host/` | rename（避免与顶层 `extensions/` 撞名）|
| `extensions/defaults/` | `extensions/builtin/` | rename |

### D.2 原地不动（trivial D，仅可能受 import 改动牵连）

`core/{tools, mcp, session, prompt, model, sub-agent, agent-dir, persona, workspace, export-html}`、
`core/runtime/`（**除** `agent-session.ts`，见 R）、
`core/{model-registry, model-resolver, package-manager, slash-commands, soul-integration}.ts`、
`modes/{rpc, acp, print-mode.ts}`、`modes/interactive/`（**除** `interactive-mode.ts`，见 R）、
`packages/{mem-core, soul-core}`、root `{cli, main, config, index, builtin-extensions, nanopencil-defaults, migrations}.ts`

> root `index.ts` / `main.ts` / `modes/index.ts` 原地不动，但**逻辑会在大阶段二改**（F06/F03 step3）——见 R / 大阶段二。

---

## R — 需你核对（≥2 个家；大阶段一只 blob 安置，门 GA-6 把关）

| 单元 | 现行数 | 端态切成 | 大阶段一处置 | 大阶段二动作 |
|------|-------:|---------|-------------|-------------|
| `core/runtime/agent-session.ts` | 3550 | runtime 7 子模块 + ui-bridge + export-bridge | 整块挪到 `core/runtime/agent-session.ts`（不拆）| 拆（F01 / S2）|
| `modes/interactive/interactive-mode.ts` | 7958 | controllers/ + state/ + mount | 原地（已在 interactive/）| 拆（F02）|
| `core/extensions/` 扩展类型巨石 | — | 按消费域分（lifecycle/tools/ui/commands）| 随 D 整块 rename 进 extensions-host | 拆（F05）|
| root `index.ts`（barrel）| — | 内部契约(`_internal`) + 对外 SDK | 原地不动 | 拆（F03 step3 / P8）|

> **你核对的就是这 4 行**：确认"大阶段一整块挪、大阶段二再拆"的处置（你已定 = 整块挪）。

---

## N — 净新增（大阶段二建，非迁移）

- `packages/extension-sdk/`（tools 含 S1 / themes / hooks / commands / permissions / lifecycle）
- `core/extensions-host/{registry,sandbox,permissions}.ts` + 4-tier loader
- `core/_internal.ts`、`core/theme-contract.ts`
- `core/mcp/mcp-types.ts`、`core/soul-options-contract.ts`、`core/lib/ai/src/utils/event-stream-types.ts`
- `scripts/{verify-quality.ts, promote-to-package.ts}`、`.github/workflows/quality.yml`
- 接缝 S2（组合根单 config）、S3（mem/soul 依赖反转）

---

## U — §4 未定位（★ 结构缺口，大阶段一前必须补 §4）

§4 端态树**没有给以下 core/ 根散文件指定目标家**。在 top-down 下它们是约束盲区，搬迁前需 maintainer 在 §4 补落点（候选：纯原语→`platform/`，业务→对应业务子目录）：

| 文件 | 性质初判 | 候选家 |
|------|---------|--------|
| `core/bash-executor.ts` | 工具执行原语 | `core/tools/` 或 `platform/` |
| `core/exec.ts` | 进程执行原语 | `platform/` |
| `core/timings.ts` | 计时原语 | `platform/` |
| `core/messages.ts` | 消息类型 | 待定（contract?）|
| `core/footer-data-provider.ts` | UI 数据 | `modes/` 或 runtime ui-bridge |
| `core/defaults.ts` | 默认值 | `platform/config/` |
| `core/diagnostics.ts` | 诊断 | `platform/telemetry/` 或业务 |
| `core/custom-providers.ts` | provider 配置 | `core/model/` |
| `core/mcp-manager.ts` | MCP 业务 | `core/mcp/` |
| `core/skills.ts` | 技能业务 | 待定业务子目录 |

> `modes/` 也有未定位项：`agent-loop-result-format.ts`、`utils/`（§4 modes 树未列）。一并在 P0 补 §4 时处理。

---

## 状态

- [ ] maintainer 核对 R 4 行处置（已口头定=整块挪，待落字）
- [ ] **P0 前置**：maintainer 在 §4 补齐 U 全部落点
- [ ] D/N 清单冻结 → 大阶段一开工
