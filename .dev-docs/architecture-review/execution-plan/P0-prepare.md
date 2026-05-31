# P0 — 基线 + 补 §4 + 冻结迁移分类（大阶段一）

```yaml
phase: P0
macro_stage: A        # 目录级
batch: —
status: in_progress
risk: low-medium       # ★ 上调：P5 零回归完全押在此处的 characterization 上
depends_on: []
blocks: [P1]
gate: gates.md#门组-a   # 仅前置产出，无独立出口门
```

## 目标

建立可复现重构前基线 + 真正可用的 characterization 脚手架（**含 TUI**），并在搬迁前**补齐 §4 结构缺口、冻结 D/R/N 迁移分类**。

## 进入条件

- [x] 已在执行分支 `refactor/arch-candidate-d`；`main` 冻结

## 任务清单

### 基线（脚本化，去 main 跑；不阻塞 P1/P2，阻塞 P4/P5）
- [x] 基线收集脚本就绪：`scripts/collect-baseline.ts`（5 项数据：commit / 循环依赖数 / `tsc --noEmit` 耗时 / dist 体积 / 公共 API 符号 snapshot）
- [ ] maintainer 在 `main` 跑一次脚本，把输出 YAML 粘进下方 Baseline Record（`dist_size_mb` 需带 `--build`）
  - 运行方式见脚本头部注释；不在受限环境跑（性能不足）
  - **冻结 main 是唯一行为基线来源**：只要 `main` 不合入重构/功能变更，baseline 可在进入 P4/P5 前任意时间补录；P1 骨架迁移与 P2 治环不被此项阻塞。

### Characterization 脚手架（★ 命门）
- [ ] **TUI = 黄金输出对比**（已定）：print-mode 固定输入 → stdout 黄金文件，前后 diff；交互专属流若黄金盖不住，P5 时再补局部快照
- [ ] 公共 API 符号 snapshot 由基线脚本产出（`.baseline-out/public-api-symbols.txt`）
  - **P4/P5 硬前置**：拆 `agent-session.ts` / `interactive-mode.ts` 前，必须已有来自冻结 `main` 的 cassette/golden + 公共 API 符号 snapshot。

### 结构缺口 + 分类（约束①）
- [x] **补 §4**：U（10 个 core/ 根散文件 + modes 未列项）落点已写入 `../target-architecture.md §4.2.1`
- [x] **核对 R 4 行 + messages/skills 判断点**：R=整块 blob 挪；`messages.ts` 留 core/ 根作叶子契约；`skills.ts` 升目录推迟大阶段二
- [ ] 冻结 `migration-classification.md` 的 D / N / U 清单（上述判断点已定，可冻结）

## 验证门控（DoD）

| # | 检查项 | 通过标准 |
|---|--------|---------|
| V0-1 | 基线脚本 | `scripts/collect-baseline.ts` 就绪、文档化要收集的 5 项数据 ✅ |
| V0-2 | 基线数字 | ✅ 已填(2026-05-31,main@0eea985):符号 296 + dist 3.61MB 可靠;tsc/cycle 标注为非阻塞后补。★ 符号快照 TXT 待提交到 `baseline/`(P4 diff 基线)|
| V0-3 | TUI 脚手架 | print-mode 黄金输出对比可跑、能捕获行为（非 placeholder）|
| V0-4 | §4 无盲区 | U 行全部在 §4.2.1 有落点；D/R/N 冻结 ✅ |

## Baseline Record（P0 填写 · 直接粘贴 `scripts/collect-baseline.ts` 输出）

```yaml
llm_wiki_baseline_commit: 0eea985eb1d820fa1be21cf4e8c07251d40051a2
cycle_count_before: 0          # ⚠ madge 视角;按 U3,madge 跨包跳过 → 低估 main 真实环数。重构侧权威=verify-quality SCC(已 0)
tsc_no_emit_ms: not_captured   # ⚠ Windows 上 npx tsc spawn 返回 exit -1(2ms 未真跑)。非 P4 blocker,P6 前可后补
dist_size_mb: 3.61             # ✅ node 走盘
public_api_symbols_count: 296  # ✅ TS 编译器 API(P4 硬指标)
public_api_symbols_snapshot: .dev-docs/architecture-review/baseline/public-api-symbols-main.txt  # ★ 待提交(P4 diff 基线)
recorded_at: 2026-05-31T15:59:29.689Z
recorded_on_branch: main (0eea985)
```

> **可靠性标注**:符号快照(296)+ dist(3.61MB)+ commit 可靠,P4/P6 验收够用。`tsc_no_emit_ms` 在 Windows 未捕获(spawn 失败),`cycle_count_before` 是 madge 低估值——两者非 P4 blocker;真正的"无环"由 `verify-quality` SCC(重构分支已 0)保证。

## 提交建议

- `chore(p0): baseline collection script` ＋ 跑数后 `docs(p0): record main baseline numbers`

## 决策门控

无 ✦（补 §4 落点由 maintainer 在 target-architecture 直接决定）。
