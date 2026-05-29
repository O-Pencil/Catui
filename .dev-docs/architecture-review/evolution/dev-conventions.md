# Dev Conventions — 重构后未来开发约规（演进组 · 骨架）

```yaml
group: evolution
status: skeleton
purpose: |
  把候选 D 重构沉淀下来的边界与纪律，固化成长期开发约规，
  使"可长期维护 + 具备扩展"在日常开发中可持续，而非一次性达成后再次劣化。
based_on:
  - ../target-architecture.md   # 候选 D 端态边界
  - ./PARP.md                    # 接缝与生长面纪律
audience: pencil maintainer · 未来贡献者 · arch agent
```

> **文档职责**：维护重构后的长期开发规约。与 F08（quality rule 可执行化）联动——F08 是 CI 守门的实现，本文是规约的"为什么 + 怎么做"。

---

## 1. 顶层目录归属判据（新增代码放哪）

| 放哪 | 判据 | 反例（不要放这里）|
|------|------|------------------|
| `core/<域>/` | nano-pencil 业务核心 | 横切原语（→ platform）、可发布库（→ packages）|
| `core/lib/<lib>/` | 内部库，**当前 0 外部消费者**，不发布 | 有外部消费者（→ packages）|
| `core/platform/` | 横切原语，**无业务知识** | 含业务逻辑 |
| `packages/<pkg>/` | **独立可发布身份**（有外部消费者 或 maintainer 明确战略发布）| 0 消费者的内部库（→ core/lib）|
| `extensions/{builtin,optional}/` | 第一方/可选能力实现 | 稳定第三方 SDK 类型（→ extension-sdk）|

> **packages/ 入场券**（grilling 决议）：独立可发布身份是唯一入场券。例外：maintainer 明确战略保留发布意图（如 soul-core 当前未发但战略保留）——此例外须在 `target-architecture.md` 显式记名，不得隐式违反。

## 2. 依赖方向（单向，CI 守门）

```
modes/ ──► core/ ──► core/platform/        （platform 不依赖业务，反向禁止）
core/ ──► core/lib/                          （lib 不反依赖业务）
packages/mem-core, soul-core ──► packages/extension-sdk   （禁止反向 import host，修 U3）
extensions/ ──► packages/extension-sdk      （扩展只依赖稳定协议，不依赖 host 内部）
```

## 3. 协议生长面纪律（防 PARP 二次重构）

- **`packages/extension-sdk/` 是唯一只增不改的协议生长面**：未来所有 PARP 协议类型（agent-profile / host-adapter / tool-runtime / a2a-bridge / memory-* / soul-* / cognitive-*）只进 extension-sdk。
- **host `index.ts` 永不增长协议类型**：一次收窄到位后，对外只暴露 stable SDK 接口。
- **协议优先 re-export 业界标准**：host-adapter ← ACP；tool-runtime ← MCP；不自造 wire protocol。仅 Continuity 与 Agent Profile schema 为 pencil 自定义。

## 4. 新增可发布包流程（promote）

- 默认放 `core/lib/`；出现真实外部消费者后再 promote。
- 用 `scripts/promote-to-package.ts <name>`：mv 目录 + 生成 package.json/tsconfig.build.json + host 改 `workspace:^` 依赖 + 改 import。
- 发布顺序：`extension-sdk` → `mem-core`/`soul-core` → `nano-pencil`。

## 5. quality rule（与 F08 联动，CI 可执行）

- ≤400 行/文件、≤15 文件/目录、无循环依赖、公共 API 有 JSDoc。
- 例外白名单需带 due date（Q8 决议待定，见 refactor-plan）。
- `scripts/verify-quality.ts` 实现；`.github/workflows/quality.yml` PR 守门。

## 6. 状态

- [x] 约规骨架
- [ ] 与 F08 verify-quality.ts 实现对齐
- [ ] 依赖方向 CI 规则落地
- [ ] promote 流程随 scripts/promote-to-package.ts 落地补全
