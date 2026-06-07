# P7 — 体积重设计（B5 · 可选）

```yaml
phase: P7
macro_stage: B        # 功能级（可选）
batch: B5
status: closed-as-gated
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
- [x] **BR01**：发布边界硬化（public packages vs host-embedded private libs；`verify:package-boundary`/dist smoke；publish order）
- [x] **BR02**：browser extension packaging 评审（UX-first；Browser Harness 属于 Browser extension 能力，不先拆 raw asset package）
- [x] **BR03**：`core/lib/ai/models.generated.ts` 评审（metrics-gated；保留同步 catalog API；不因 14k 行数直接拆）
- [x] **BR04**：esbuild 构建管线评审（reviewed-deferred；收益主要是 build speed/file count/minify，P7 不直接 bundle）

## 收口结论

P7 当前关闭为 **closed-as-gated**：

- 已落地 BR01 发布边界守卫。
- BR02-BR04 不进入当前代码实现。
- 后续若重开，必须按 [bundle-redesign-review/closure.md](../bundle-redesign-review/closure.md) 的 reopen matrix 提供 metrics / UX / 验收依据。

## 验证门控（DoD）

| # | 检查项 | 通过标准 |
|---|--------|---------|
| V7-1 | 发布边界 | public package / embedded private lib 分类与 tarball 内容一致 |
| V7-1a | 静态守卫 | `npm run verify:package-boundary` 通过 |
| V7-1b | 产物守卫 | capable machine 上 build 后 `npm run verify:package-boundary:dist` 通过 |
| V7-2 | 安装冒烟 | fresh global beta install + `nanopencil -v` 无 package/extension load 错 |
| V7-2a | Browser 默认缺省 | fresh host install 下 browser 不默认加载，`/browser` 仍是清晰发现入口 |
| V7-2b | Browser 显式启用 | 显式 opt-in 后 `/browser status` 可运行；用户不需要理解内部 harness/package 拆分 |
| V7-3 | 构建等价 | 产物功能与 P6 等价 |
| V7-4 | 体积 | 若声明 size win，提供 tarball/unpacked before-after 数据 |
| V7-4a | Model metadata | 若拆 `models.generated.ts`，提供 startup/import/churn 指标，并证明 `getModel/getModels/getProviders` 行为不变 |
| V7-4b | Esbuild | 若引入 esbuild，先证明 transpile-only 不改变 dist 拓扑、声明输出、extension loader、provider lazy 和 package-boundary 守卫 |
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
- Closure：`../bundle-redesign-review/closure.md`
