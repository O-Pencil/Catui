# P1 — 骨架搬迁（大阶段一 · 行为等价）

```yaml
phase: P1
macro_stage: A        # 目录级
batch: B0a
status: implementation_complete_gate_partial
risk: low-medium
depends_on: [P0]
blocks: [P2]
gate: gates.md#门组-a   # ★ 本 phase 出口 = 门组 A 全过
classification: migration-classification.md
```

## 目标

按 §4 把代码迁进端态目录：**D 直接搬、R 整块 blob 安置**；删 `bundle-deps.js` 走 workspace 真依赖；**逻辑一行不动**。出口 = [门组 A](./gates.md#门组-a--目录级出口大阶段一收尾定稿)。

## 进入条件

- [ ] [P0 DoD](./P0-prepare.md#验证门控dod) 全过（含 §4 无盲区、分类冻结、TUI 脚手架可跑）

## 任务清单

### D 直接迁移（见分类清单 D.1）
- [ ] `packages/{ai,agent-core,tui}` → `core/lib/`（保留包名 → import 几乎不变；各 `package.json` 标 `"private": true`）
- [ ] `core/{i18n,telemetry,utils,config,keybindings.ts}` → `core/platform/`
- [ ] `core/extensions/` → `core/extensions-host/`（rename）
- [ ] `extensions/defaults/` → `extensions/builtin/`（rename）
- [ ] **U 项**：按 P0 补好的 §4 落点搬迁 10 个 core/ 根散文件 + modes 未列项

### R 整块 blob 安置（**禁止拆**，门 GA-6）
- [ ] `agent-session.ts`（3550 行）整块挪到 `core/runtime/agent-session.ts`，登记大阶段二拆分票
- [ ] `interactive-mode.ts`、扩展类型巨石、root `index.ts`：原地/整块，登记拆分票

### 接线 + 工具
- [ ] host `package.json`：`workspaces` → `core/lib/*` + `packages/*`；真依赖**仅现存包**（`mem-core`/`soul-core`；**extension-sdk 属大阶段二 N，本阶段不接**）
- [ ] 删 `scripts/bundle-deps.js`（验证 workspace 解析覆盖原 dist 倒灌）
- [ ] 新建 `scripts/promote-to-package.ts`
- [ ] ts-morph codemod 批量改 import（主要是 `platform/*` deep path + 两处 rename；lib 包名保留故 import 基本不变）；写 `CODEMOD.md`

### DIP 同步（门 GA-5）
- [ ] 更新各级 `CLAUDE.md` member list + 受影响文件 P3 header 路径；`verify-dip.ts` exit 0

### 禁止
- [ ] **禁止**：改业务逻辑、改公共 API、拆 R 单元、建 `extension-sdk`/`_internal`/治环

## 验证门控（DoD）= 门组 A

直接套用 [gates.md 门组 A](./gates.md#门组-a--目录级出口大阶段一收尾定稿)：GA-1 结构同构 / GA-2 行为不变 / GA-3 逻辑零改 / GA-4 可编译可跑 / GA-5 DIP 同构 / GA-6 R/U 已消化。
另：**增量守门预上线**——`verify-quality` 以"基线全红、只 gate 增量"模式接入 CI（治环本体留 P2）。

### 轻量验收记录（2026-05-30）

- P1 目录骨架和 workspace 接线已完成；见 [`../refactor-validation.md`](../refactor-validation.md#4-phase-a-轻量验收记录2026-05-30)。
- 本机资源不足，不运行 build/test/CLI smoke/Node 校验脚本；GA-2/GA-4/GA-5 的重型验证留给 maintainer 机器。
- 0 字节残留文件 `node`、`npm`、`npx` 已确认是误生成文件并清理，不加入 `.gitignore`。

## 提交建议

- 按分类拆**多个可回滚 commit**（不要单巨型 commit）：
  `refactor(p1a): packages → core/lib` / `refactor(p1b): core/* → core/platform` / `refactor(p1c): rename extensions-host & builtin` / `refactor(p1d): place unplaced core files` / `chore(p1): drop bundle-deps, wire workspaces`
- 机械搬迁与任何语义改动**不得**混在同一 commit

## 决策门控

无 ✦。

## 参考

- 分类：[migration-classification.md](./migration-classification.md)
- 端态映射：`../target-architecture.md §4 / §4.2`
