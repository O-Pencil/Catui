# Methodology

## 调研方法

### 1. 不靠"看目录树 / 凭印象列"

你 AGENTS.md 明确说："audit 类必须读全文，不能靠 snippets"。这次调研：
- pi 的 `agent-harness.ts`（446 行）—— **全文读**
- pi 的 `output-guard.ts`（105 行）—— **全文读**
- pi 的 `event-bus.ts`（37 行）—— **全文读**
- pi 的 `tui.ts`（1715 行）—— **全文读**
- pi 的 `terminal.ts`（500+ 行）—— **全文读**
- catui 的 `core/runtime/event-bus.ts` —— **全文读**
- catui 的 `core/lib/tui/src/tui.ts`（700+ 行）—— **全文读**

### 2. 不靠"挑名字"

`output-guard.ts` 名字看着像"输出守卫"，实际是 **stdout 接管**。这种"名字误导"只有读全文才能发现。

### 3. 候选评估三道筛子

每个候选过三关：

1. **真读源文件**——不是 grep snippets
2. **对照 catui 现状**——grep 对应能力的命中情况
3. **档位判定**——对照 catui AGENTS.md `feature-workflow.md §3` 的触发条件

### 4. 档位映射

| 触发条件 | 调研中的例子 |
|---|---|
| load-bearing 区 | steer/follow-up 队列 → 改 AgentSession 并发契约 |
| >400 行 | pi 的 `agent-harness.ts` 446 行；catui 单文件 ~800 行限制 |
| ≥8 ports | pi TUI 的 OverlayOptions 接口 |
| public API 变更 | 候选 1 / 候选 4 / 候选 5 都涉及 |
| 无明确 owner | — |

## 局限

- **没读 pi 的 provider 集成**（40 个文件，超出审计能力，留给独立议题 6）
- **没读 pi 的 orchestrator**（HTTP/RPC 模式，跟 catui 的 RPC 模式重叠度待评估）
- **没读 pi 的 compaction 实现**（catui 已有自己的 compaction，独立议题）
- **只读源代码 + 看 README/AGENTS.md**——没跑 pi 的 test suite

## 不做的事

- 不 commit
- 不改 catui 任何文件
- 不拉 review 入口
- 不创建 `harness-review/` 等 review 目录
- 不改 `.gitignore`
- 不动 catui 工作树任何 tracked 文件