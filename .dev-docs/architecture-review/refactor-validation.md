# Refactor Validation — 重构验收（重构组 · 轻量骨架）

```yaml
group: refactor
status: phase_a_light_validated # 轻量骨架 + P1 目录级轻量验收记录
produced_at: 2026-05-29
purpose: |
  定义"重构后如何证明功能不变 + 分层清晰 + 无冗余 + 性能"。
  当前阶段（重构前）不花精力做严格用例编写——maintainer 已切两分支，
  待架构层面重构完成后，用本文方法做"重构前 vs 重构后"的对比验收。
baseline_source:
  - ../../../llm-wiki/                # ★ 重构前基于既有代码生成的功能知识库，作为功能溯源基线
```

> **文档职责**：重构组的"验收证明"。本文**现在只立骨架**，不写严格用例。功能溯源基线已存在：`nanoPencil/llm-wiki/`（重构前的功能/代码知识库）。重构完成后在此填充"前后对比"结论。

---

## 1. 验收基线：llm-wiki（重构前快照）

重构前已基于既有代码生成功能知识库，作为"功能不变"的溯源参照：

| llm-wiki 页面 | 用作验收什么 |
|---------------|-------------|
| `pages/zh-CN/architecture.md` | 重构前架构事实；对照端态目录是否仅"搬位置"未"改行为" |
| `pages/zh-CN/modules.md` | 模块清单；对照拆 god 后模块职责是否一一可溯源 |
| `pages/zh-CN/symbols.md` | 符号/导出表；对照公共 API（功能不变的硬指标）|
| `pages/zh-CN/files.md` | 文件清单；对照搬迁映射是否完整、无遗漏/无冗余新增 |
| `pages/zh-CN/dependencies.md` | 依赖图；对照治环（F03/F04）后依赖方向 |
| `pages/zh-CN/retrieval.md` / `health.md` / `index.md` | 检索/健康/索引；辅助溯源 |

> 重构完成后：在重构分支重新生成一份 llm-wiki，与本基线 diff，作为"功能不变"的客观证据之一。

---

## 2. 验收维度（重构后逐项填充）

| 维度 | 验收方法（待重构后执行）| 工具 / 来源 | 结论 |
|------|------------------------|------------|------|
| **功能不变** | 公共 API 符号表 diff（对照 llm-wiki symbols）；两分支行为/快照对比；CLI 关键路径 e2e | llm-wiki diff + characterization tests | _待填_ |
| **分层清晰** | 无循环依赖；`platform 不依赖业务` 单向；`extension-sdk` 不被 host 内部反向依赖 | `scripts/verify-quality.ts`（F08）+ madge | _待填_ |
| **逻辑精准 / 无冗余** | dead-code 扫描；重复 export / 重复实现检测；god 文件拆分后无残留巨石 | verify-quality + 行数门槛 | _待填_ |
| **性能** | 冷启动时间、安装体积前后对照（F06/F07 指标）| 手测 + dist 体积 du | _待填_ |
| **接缝预留** | S1/S2/S3 接缝存在且形状正确（见 refactor-plan §接缝验收）| 代码 review | _待填_ |

---

## 3. 每 Phase 验收门控

各 Phase 的进入/出口 DoD 见 [`./execution-plan/`](./execution-plan/) 对应文件（如 [P1-skeleton-move.md](./execution-plan/P1-skeleton-move.md)）。本表为批次级摘要：

| 批次 | 合并前必须通过 | Phase 文件 |
|------|---------------|-----------|
| B0a 机械搬迁 | 编译 + 测试 + llm-wiki diff 仅路径变化 | [P1](./execution-plan/P1-skeleton-move.md) |
| B0b 扩展能力 | extension-sdk build；mem-core 仅依赖 sdk（S3）| [P3](./execution-plan/P3-extension-sdk.md) |
| B1 治环+守门 | 无环；verify-quality 上线 | [P2](./execution-plan/P2-cycles-gate.md) |
| B2/B3 god 拆 | characterization 基线 → 拆后零回归 | [P4](./execution-plan/P4-runtime-split.md) [P5](./execution-plan/P5-ui-split.md) |
| B4/B5 体积 | 冷启动/体积不劣化 | [P6](./execution-plan/P6-entry-volume.md) [P7](./execution-plan/P7-bundle-redesign.md) |
| B6 SDK 收窄 | 对外 API 有意收窄 | [P8](./execution-plan/P8-sdk-narrow.md) |
| 合 main | 两分支对比 + 签字 | [sign-off-main](./execution-plan/sign-off-main.md) |

---

## 4. Phase A 轻量验收记录（2026-05-30）

执行分支：`refactor/arch-candidate-d`

当前验收范围：只验证 P1 目录级骨架和接线；不在低性能机器运行 build/test/CLI smoke。

| 门 | 结果 | 证据 |
|----|------|------|
| GA-1 结构同构 | 部分通过 | `core/lib/{ai,agent-core,tui}`、`core/platform/{config,exec,i18n,telemetry,utils}`、`core/extensions-host`、`extensions/builtin` 已在位；`packages/` 仅保留 `mem-core`/`soul-core` |
| GA-2 行为不变 | 待重型验证 | characterization harness 已存在于 `tests/characterization/`；需在可用机器回放 golden/cassette |
| GA-3 逻辑零改 | 部分通过 | 本轮轻量检查确认旧路径迁移和 workspace 接线；完整逻辑 diff review 仍需 maintainer code review |
| GA-4 可编译可跑 | 外部已过 / 本机未跑 | maintainer 已反馈 `npm run build` 在 `91ab9de` 通过；本机因资源限制不跑 build/test/run |
| GA-5 DIP 同构 | 待工具验证 | 相关 `AGENT.md`/`CLAUDE.md` 路径已随搬迁更新；`verify-dip.ts` 属 Node/tsx 校验，本机未跑 |
| GA-6 R/U 已消化 | 部分通过 | R 单元未拆；U 项已按分类落到 `core/platform/exec`、`core/model`、`core/mcp`、`modes/interactive`、`modes/utils` 等位置 |

轻量命令结果：

- `git status --short --branch`：干净，已对齐 `origin/refactor/arch-candidate-d`
- 旧路径扫描：`packages/{ai,agent-core,tui}`、`extensions/defaults`、`core/extensions/`、`core/{config,i18n,telemetry,utils}/` 等旧路径在源码/脚本/文档接线扫描中无命中
- workspace 接线：`package.json` / `package-lock.json` 指向 `core/lib/*` + `packages/{mem-core,soul-core}`
- `scripts/bundle-deps.js`：已不在 git 索引
- 残留清理：仓库根目录的 0 字节未跟踪文件 `node`、`npm`、`npx` 已删除；不加入 `.gitignore`，因为它们不是合法生成目录

低性能机器不执行项：

- `npm install`
- `npm run build`
- `npm test` / vitest
- CLI 4 mode smoke
- `scripts/collect-baseline.ts`
- `verify-dip.ts` / `verify-quality.ts`

下一步：在性能足够的机器上补齐 GA-2/GA-4/GA-5 的重型验证后，进入 maintainer 功能维度评审并定稿门组 B。

---

## 5. 状态

- [x] 验收骨架 + llm-wiki 基线指认
- [x] P1 目录级轻量验收记录
- [ ] 重构完成后：重新生成 llm-wiki 并 diff
- [ ] 逐维度填充结论
- [ ] 两分支（重构前/后）对比签字
