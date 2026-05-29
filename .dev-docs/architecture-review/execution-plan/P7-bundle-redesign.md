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

引入 esbuild 分片构建；拆分 `models.generated.ts`（14505 行）为 per-provider lazy 文件。

## 进入条件

- [ ] [P6 DoD](./P6-entry-volume.md#验证门控dod) 全过
- [ ] maintainer 确认进入 B5 窗口（不与 patch release 混发）

## 任务清单

- [ ] 引入 esbuild 构建管线（替代/补充现有 tsc 路径）
- [ ] `core/lib/ai/models.generated.ts` 按 provider 拆 11 文件（✦**Q6**）
- [ ] codegen `npm run generate-models` 适配多文件输出
- [ ] 删除 P1 后残留的 vendored 路径问题（若有）

## 验证门控（DoD）

| # | 检查项 | 通过标准 |
|---|--------|---------|
| V7-1 | 构建等价 | 产物功能与 P6 等价 |
| V7-2 | 体积 | dist 体积进一步下降 |
| V7-3 | 测试 | 全量测试 + provider 切换 smoke |

## 提交建议

- 独立发版 minor bump 窗口；不与 P1–P6 混在同一 release

## 决策门控

| 门控 | 议题 |
|------|------|
| ✦Q6 | models.generated 拆 11 文件 vs 运行时 partial parse |

## 参考

- Finding：`../findings/F07-dist-bundle-composition.md`
