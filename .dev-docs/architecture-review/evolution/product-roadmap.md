# Product Roadmap（演进组 · 骨架）

```yaml
group: evolution
status: skeleton          # 骨架；待重构组完成后逐项填充与 gate
relationship_to_refactor: |
  本文是"重构后未来开发"的产品演进规划，与重构组（behavior-preserving）完全分离。
  每一项演进都应：(1) 由真实需求 gate；(2) 声明依赖哪个接缝已就绪（见 PARP.md §5）；
  (3) 是候选 D 骨架之上的纯增量，不回改已重构代码。
based_on:
  - ./PARP.md
  - ./industry-protocol-survey.md
audience: pencil maintainer
```

> **文档职责**：维护重构完成后的产品演进方向与排期。**不**定义重构端态（见 `../target-architecture.md`），**不**给重构批次加任务（见 `../refactor-plan.md`）。

---

## 1. 演进项总览（待 gate）

| # | 演进项 | 价值 | 依赖的已就绪接缝 | gate 条件（何时启动）| 是否纯增量 |
|---|--------|------|-----------------|---------------------|-----------|
| E1 | **第三方扩展能力兑现**（user-dir loader + theme registry + extension-sdk 类型）| 直接兑现 README "Plugin system"；服务"扩展能力"目标 | extension-sdk（B0b 已建）| 重构 B0b 完成即可 | ✅ |
| E2 | **PARP Tool Runtime 协议化**（local/mcp/remote/browser 统一）| 工具多 runtime；browser-as-runtime | S1 工具契约判别字段 | 有第二种 runtime 真实需求时 | ✅ |
| E3 | **Continuity 内核**（canonical-state / provenance / merge-policy / prompt-injection-policy）| Memory/Soul 长期自我连续性官方解释权 | S3 mem/soul 依赖反转 | 需要跨插件统一合并/注入策略时 | ✅（新目录）|
| E4 | **Agent Profile**（CLI/browser/remote/editor profile + 声明式 schema）| 配置出不同 PencilAgent | S2 组合根单 config | continuity + tool runtime 就绪后 | ✅（新目录）|
| E5 | **Browser Agent**（Browser Tool Runtime + browser profile）| 把 browser 从普通插件升为 runtime+profile | E2 + E4 | E2/E4 之后 | ✅ |
| E6 | **A2A 跨 runtime 通信**（PencilAgent ↔ PencilAgent）| 多 agent 跨 host | a2a-bridge stub | 有跨 runtime 真实场景时 | ✅ |

> 优先级建议：**E1 最先**（直接兑现 README 承诺、风险最低、不依赖 PARP 深水区）；E3/E4 是 PARP 深水区，按真实需求 gate，不要提前建。

---

## 2. 每项的展开（待填充）

### E1 第三方扩展能力兑现
- 现状缺口：无 user-dir loader（`~/.pencils/extensions/`）、theme 硬编码 3 个、无 extension-sdk 稳定类型包。
- 依赖：B0b 的 `packages/extension-sdk/` + `core/extensions-host/` 4-tier loader。
- 产出：`docs/EXTENSIONS.md` 第三方开发指南 + theme registry + user-dir tier。
- _（待重构完成后展开细节）_

### E2 PARP Tool Runtime 协议化
- _（待 gate 后展开）_

### E3 Continuity 内核
- 边界原则（grilling 已定）：官方定义 canonical state / provenance / merge policy / prompt injection policy；mem-core/soul-core 提供官方基础实现；第三方只插拔 storage / retrieval candidate / soul facet / cognitive model；最终 merge 与自我连续性解释权不外包。
- 人/技术双层映射见 PARP.md 与原 target-arch D5.1 表（已迁移说明）。
- _（待 gate 后做最小设计：canonical-state / merge-policy / prompt-injection-policy）_

### E4 Agent Profile
- schema 参考 Microsoft Agent Framework 1.0 声明式 YAML（GA 2026-04-03）。
- _（待 gate 后展开）_

### E5 Browser Agent
- _（待 gate 后展开）_

### E6 A2A 跨 runtime
- _（远期；a2a-bridge B0 不实现，仅命名占位）_

---

## 3. 状态

- [x] 演进项总览骨架
- [ ] E1 细化（重构 B0b 完成后第一优先）
- [ ] E3/E4 最小设计（按真实需求 gate）
- [ ] 其余按需
