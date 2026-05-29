# P6 — 入口与体积（B4）

```yaml
phase: P6
batch: B4
status: pending
risk: medium
depends_on: [P5]
blocks: [P7]
findings: [F06, F07-short]
seams: []
```

## 目标

lazy 入口分派、browser opt-in、ai lazy provider；改善冷启动与安装体积，**不劣化功能**。

## 进入条件

- [ ] [P5 DoD](./P5-ui-split.md#验证门控dod) 全过

## 任务清单

- [ ] **F06**：`modes/index.ts` → facade（< 50 行）；`main.ts` → dynamic dispatch
- [ ] **F07 短期**：browser `extensions/builtin/` → `extensions/optional/`（✦**Q2** opt-in 形态）
- [ ] **F07 短期**：ai provider lazy import（按 `models.json` 配置）
- [ ] 触碰 SOP §3.3 的变更走 REVIEW（package `files` / 公共 exports）

## 验证门控（DoD）

| # | 检查项 | 通过标准 |
|---|--------|---------|
| V6-1 | 冷启动 | ≤ P0 基线（理想下降）|
| V6-2 | 体积 | dist 体积 ≤ P0 基线 |
| V6-3 | 功能 | 全 mode smoke（interactive/print/rpc/acp）通过 |
| V6-4 | browser | 按 Q2 决议验证 opt-in 路径可用 |

## 提交建议

- `perf(p6): lazy entry + browser optional + ai lazy provider`

## 决策门控

| 门控 | 议题 |
|------|------|
| ✦Q2 | Browser opt-in 形态（独立包 vs lazy-extract vs 现状）|
| ✦Q3 | 若同步收窄 index.ts，与 P8 协调 |

## 参考

- Findings：`../findings/F06-*.md` `F07-*.md`
