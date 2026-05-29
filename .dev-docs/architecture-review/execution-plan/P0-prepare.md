# P0 — 准备

```yaml
phase: P0
batch: —
status: in_progress
risk: low
depends_on: []
blocks: [P1, P4, P5]
findings: []
seams: []
```

## 目标

建立可复现的重构前基线，搭 characterization 脚手架，确保后续 Phase 能客观证明"功能不变"。

## 进入条件

- [x] 已在执行分支 `refactor/arch-candidate-d`
- [x] `main` 冻结，不做重构改动

## 任务清单

- [x] 从 `main` 切分支 `refactor/arch-candidate-d`
- [ ] 记录 `main` 上 `llm-wiki/` 基线 commit 指针（写入下方 Baseline Record）
- [ ] 搭 characterization test 脚手架：CLI 关键路径 + 公共 API 符号表导出
- [ ] 记录重构前基线数字（循环依赖数、编译时间、dist 体积）

## 验证门控（DoD）

| # | 检查项 | 通过标准 |
|---|--------|---------|
| V0-1 | 基线 commit | `llm-wiki/` 在 main 的 commit SHA 已记录 |
| V0-2 | 基线数字 | 循环依赖数 / `tsc --noEmit` 耗时 / dist 体积 / 公共 API 符号表 snapshot 已存档 |
| V0-3 | 脚手架 | characterization 目录存在且至少 1 条 smoke 可跑（可为 placeholder）|

## Baseline Record（P0 填写）

```yaml
llm_wiki_baseline_commit: _待填_
cycle_count_before: _待填_
tsc_no_emit_ms: _待填_
dist_size_mb: _待填_
public_api_symbols_snapshot: _待填_   # 路径或文件
recorded_at: _待填_
recorded_on_branch: main
```

## 提交建议

- `docs(p0): record refactor baseline`（基线数字 + llm-wiki commit 指针）

## 决策门控

无 ✦ 门控。
