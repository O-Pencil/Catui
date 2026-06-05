# P6 — 入口与体积（B4）

```yaml
phase: P6
macro_stage: B        # 功能级
batch: B4
status: active-ev04-runtime-validated
risk: medium
depends_on: [P5]
blocks: [P7, P8]
findings: [F06, F07-short]
seams: []
gate: gates.md#门组-b
```

## 目标

lazy 入口分派、browser opt-in、ai lazy provider；改善冷启动与安装体积，**不劣化功能**。

> **专项评审**：P6 代码依赖 P5。P5 entry 稳定后，P6 按 [entry-volume-review/](../entry-volume-review/README.md) 从顶层 entry shape / optional capability / provider loading / package surface 重审并分片落地。

## 进入条件

- [ ] [P5 DoD](./P5-ui-split.md#验证门控dod) 全过

## 任务清单

- [x] 建立 [entry-volume-review/](../entry-volume-review/README.md) 专项评审（EV01–EV05）
- [ ] **F06**：`modes/index.ts` → facade（< 50 行）；`main.ts` → dynamic dispatch
- [x] **F07 短期 / EV03 registration slice**：browser 退出默认加载（metadata optional + `getBuiltinExtensionPaths()` 不返回 browser）；行为变更按 GB-2 记录
- [ ] **F07 短期 / EV03 physical/package slice**：browser `extensions/builtin/` → `extensions/optional/` 或独立包/lazy-extract（✦**Q2** opt-in 形态）
- [x] **EV04 review**：provider lazy matrix 完成；runtime lazy 与 metadata chunking 分离
- [x] **F07 短期 / EV04 runtime slice**：provider runtime lazy resolver（按 `model.api` 首次使用加载 provider implementation；maintainer 验证通过）
- [ ] **F07 短期 / EV04 metadata slice**：`models.generated.ts` provider 分片（generator-backed，后续单独切片）
- [ ] 触碰 SOP §3.3 的变更走 REVIEW（package `files` / 公共 exports）

## 验证门控（DoD）

> 出口以 [gates.md 门组 B](./gates.md#门组-b--功能级出口大阶段二逐域草案--待你定稿) 为准。本域补充（性能项）：

| # | 检查项 | 通过标准 | 门组 B |
|---|--------|---------|--------|
| V6-1 | 冷启动 | ≤ P0 基线（理想下降）| GB-2 |
| V6-2 | 体积 | dist 体积 ≤ P0 基线 | GB-2 |
| V6-3 | 功能 | 全 mode smoke（interactive/print/rpc/acp）通过 | GB-2 |
| V6-4 | browser | registration slice：默认启动不加载完整 browser；轻量 `/browser` fallback 提示 opt-in；显式 `--extension extensions/builtin/browser` 或配置路径仍可加载完整 browser。physical/package slice：按 Q2 决议验证 opt-in 路径可用（注：builtin→optional 改变自动加载，属有意行为变更，按 GB-2 声明）| GB-2 |
| V6-5 | provider lazy | runtime slice：`stream()` 保持同步返回 EventStream；`getModel/getModels/ModelRegistry` 保持同步；provider smoke matrix 覆盖 OpenAI-compatible、OpenAI Responses、Anthropic、Google、Gemini CLI、Bedrock、OAuth/custom provider | GB-2 |
| V6-6 | P5 boundary | P6 code does not touch P5-active interactive files before P5 entry stability is confirmed | GB-1 |

## 提交建议

- `perf(p6): lazy entry + browser optional + ai lazy provider`

## 决策门控

| 门控 | 议题 |
|------|------|
| ✦Q2 | Browser opt-in 形态（独立包 vs lazy-extract vs 现状）|
| ✦Q3 | 若同步收窄 index.ts，与 P8 协调 |

## 参考

- Findings：`../findings/F06-*.md` `F07-*.md`
