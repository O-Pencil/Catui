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

### 基线
- [ ] 记录 `main` 上 `llm-wiki/` 基线 commit 指针（写入 Baseline Record）
- [ ] 记录基线数字：循环依赖数（`madge`，需先装/`npx`）、`tsc --noEmit` 耗时、dist 体积、公共 API 符号表 snapshot

### Characterization 脚手架（★ 命门，不能 placeholder）
- [ ] CLI 关键路径 + 公共 API 符号表导出
- [ ] **TUI characterization 方案落地**：print-mode 黄金输出对比 / interactive 录放机制（P5 的 V5-1 零回归依赖此，必须先建得起来）

### 结构缺口 + 分类（约束①）
- [ ] **补 §4**：为 `migration-classification.md` 的 **U（10 个 core/ 根散文件 + modes 未列项）**在 `../target-architecture.md §4` 指定目标家
- [ ] **核对 R 4 行**处置（已定=整块 blob 挪，落字到分类清单）
- [ ] 冻结 `migration-classification.md` 的 D / N 清单

## 验证门控（DoD）

| # | 检查项 | 通过标准 |
|---|--------|---------|
| V0-1 | 基线 commit | `llm-wiki/` 在 main 的 SHA 已记录 |
| V0-2 | 基线数字 | 循环依赖数 / tsc 耗时 / dist 体积 / 符号表 snapshot 已存档 |
| V0-3 | TUI 脚手架 | characterization 能跑、**能捕获 TUI 行为**（非 placeholder）|
| V0-4 | §4 无盲区 | `migration-classification.md` U 行全部在 §4 有落点；D/R/N 冻结 |

## Baseline Record（P0 填写）

```yaml
llm_wiki_baseline_commit: _待填_
cycle_count_before: _待填_
tsc_no_emit_ms: _待填_
dist_size_mb: _待填_
public_api_symbols_snapshot: _待填_
recorded_at: _待填_
recorded_on_branch: main
```

## 提交建议

- `docs(p0): record baseline + fill §4 unplaced files + freeze migration classification`

## 决策门控

无 ✦（补 §4 落点由 maintainer 在 target-architecture 直接决定）。
