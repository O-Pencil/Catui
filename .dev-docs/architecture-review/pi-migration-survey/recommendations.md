# Recommendations

> 落地顺序 + 风险 + 决策树

## TL;DR 决策树

```
你要做什么？
│
├─ 迁移大特性（steer/follow-up 队列）？
│  └─ ⚠️ 候选 1：必须先开 harness-review，写 design doc，再写 test，再改代码
│
├─ 迁移 stdout 接管？
│  └─ ❌ 候选 2：catui 架构不需要
│
├─ 迁移 eventbus？
│  └─ ❌ 候选 3：已有且更好
│
├─ 迁移 Overlay 焦点恢复？
│  └─ 🟡 候选 4+5：建议做，但要写 design doc + test
│
└─ 补 provider？
   └─ 📋 候选 6：单独议题，先盘点用户实际用什么
```

## 推荐落地顺序

### 阶段 0（**你已拍板**的硬约束）

- 不 commit（这次报告本地）
- 不拉 review 入口
- 不动 catui 工作树任何 tracked 文件
- 不改 `.gitignore`

### 阶段 1（**等你点头才动**）

**候选 4 + 5：Overlay 焦点管理** — 这是这次调研**唯一推荐做**的项

**为什么优先**：

1. 改动可控（~180 行 + ~100 行测试）
2. 行为可见（modal 焦点体验直接提升）
3. pi 模式可直接借鉴（不是猜）
4. 不影响其他模块（纯 TUI 改动）
5. 风险低（state machine 简单，副作用小）

**要做的事**：

1. 写 `core/lib/tui/AGENT.md` 里加候选 4+5 的设计草稿
2. 写 test case（必先失败）
3. 改 `core/lib/tui/src/tui.ts`
4. 跑 verify 三件套
5. 按你 commit ordering 偏好拆 commit：
   - `feat(tui): add overlay focus restore state machine`
   - `feat(tui): extend OverlayHandle with focus/unfocus/isFocused`

### 阶段 2（**不建议现在做**）

**候选 1：steer / follow-up 队列** — 价值高但**档位高**

**为什么放后面**：

1. 改 runtime 核心契约
2. 需要先写完整 design doc
3. 需要先和现有 extension host 协调
4. 测试覆盖比候选 4 复杂得多（并发场景）

**什么时候做**：当 catui 有 sub-agent / 长任务的实际痛点时。

### 阶段 3（**独立议题**）

**候选 6：provider 补齐** — 单独跑

**什么时候做**：盘点用户实际用了什么模型后。

## 风险地图

| 候选 | 改动量 | 风险 | 价值 | 推荐 |
|---|---|---|---|---|
| 1. steer/follow-up | ~500-800 行 | 高 | 高 | 阶段 2 |
| 2. stdout 接管 | — | — | 零 | ❌ |
| 3. eventbus | 0 | 零 | 零 | ❌ |
| 4+5. overlay 焦点 | ~180 行 | 中低 | 中 | **阶段 1** |
| 6. provider | 800-1500 行/provider | 中 | 视用户需求 | 阶段 3 |

## 不要做的事

- ❌ 一次性把 pi 的 `AgentHarness` 类搬过来——它和 catui 会话架构不兼容
- ❌ 改 catui 的 bash tool 改成 inherit TTY——会重新引入 pi 那边的复杂度
- ❌ 把这次调研当 review 入口——它是**调研报告**，不是 review
- ❌ 不写 design doc 直接改 runtime——触发 catui AGENTS.md §3 的"public API 变更"

## 我建议下一步

**拍板候选 4 + 5**——这是这次调研**唯一推荐做**的事。

如果你点头，我下一步会：

1. 写 `core/lib/tui/AGENT.md` 草稿（设计文档，不是代码）
2. 写 test case（必先失败）
3. 改 `core/lib/tui/src/tui.ts`
4. 跑 verify 三件套
5. 按你偏好拆 commit

**你拍**：

- (A) 走候选 4+5
- (B) 先开候选 1 的 design doc 阶段（不改代码）
- (C) 单独跑候选 6（provider 盘点）
- (D) 都不做，调研到此为止
- (E) 你有别的方向