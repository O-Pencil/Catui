# P7 — 体积重设计（B5 · 可选）

```yaml
phase: P7
macro_stage: B        # 功能级（可选）
batch: B5
status: optional
risk: high
depends_on: [P6]
blocks: []
findings: [F07-mid]
seams: []
gate: gates.md#门组-b
```

## 目标

先完成 [bundle-redesign-review/](../bundle-redesign-review/README.md) 专项评审，稳定发布产物边界，再决定是否进入体积收缩实现。

P7 原始目标是引入 esbuild 分片构建、拆分 `models.generated.ts`（14505 行）为 per-provider lazy 文件。beta.2-beta.6 暴露出更前置的问题：公网包 / host 内嵌内部库 / tarball 内容 / `exports` 条件必须先稳定，否则任何 bundle 重设计都会把排错面放大。

## 进入条件

- [ ] [P6 DoD](./P6-entry-volume.md#验证门控dod) 全过
- [ ] maintainer 确认进入 B5 窗口（不与 patch release 混发）
- [ ] beta install/runtime smoke 稳定（无 extension-load/package-resolution 错误）

## 任务清单

- [x] 建立 [bundle-redesign-review/](../bundle-redesign-review/README.md) 专项评审（BR01-BR04）
- [ ] **BR01**：发布边界硬化（public packages vs host-embedded private libs；pack/install smoke；publish order）
- [ ] **BR02**：browser asset optionalization（独立包 / lazy-extract / 保持现状的 Q2 决策）
- [ ] **BR03**：`core/lib/ai/models.generated.ts` 按 provider 拆分（仅在 metrics 证明收益后）
- [ ] **BR04**：esbuild 构建管线（deferred；仅在 BR01-BR03 后仍有明确收益时重开）

## 验证门控（DoD）

| # | 检查项 | 通过标准 |
|---|--------|---------|
| V7-1 | 发布边界 | public package / embedded private lib 分类与 tarball 内容一致 |
| V7-2 | 安装冒烟 | fresh global beta install + `nanopencil -v` 无 package/extension load 错 |
| V7-3 | 构建等价 | 产物功能与 P6 等价 |
| V7-4 | 体积 | 若声明 size win，提供 tarball/unpacked before-after 数据 |
| V7-5 | 测试 | 全量测试 + provider 切换 smoke |

## 提交建议

- 独立发版 minor bump 窗口；不与 P1–P6 混在同一 release

## 决策门控

| 门控 | 议题 |
|------|------|
| BR01 | packages 公网依赖 vs core/lib host 内嵌策略是否固化 |
| ✦Q2 | Browser opt-in 形态（独立包 vs lazy-extract vs 现状）|
| ✦Q6 | models.generated 拆 11 文件 vs 运行时 partial parse |
| BR04 | 是否仍需要 esbuild，还是前两刀收益已足够 |

## 参考

- Finding：`../findings/F07-dist-bundle-composition.md`
- Review：`../bundle-redesign-review/README.md`
