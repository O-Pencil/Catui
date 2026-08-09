# Pi Architecture — What Got Read

> Source: `/Users/cunyu666/Dev/pi/packages/*/src`

## Pi 5 个 Package

```
pi/
├── agent/                # Agent runtime (harness 抽象、compaction、session、skills)
│   └── src/
│       ├── agent-loop.ts
│       ├── agent.ts
│       ├── harness/
│       │   ├── agent-harness.ts      ← 446 行，重点读
│       │   ├── compaction/
│       │   ├── session/
│       │   ├── skills.ts
│       │   ├── system-prompt.ts
│       │   └── prompt-templates.ts
│       ├── proxy.ts
│       ├── node.ts
│       ├── types.ts
│       └── index.ts
├── ai/                   # 多 provider LLM 适配层
│   └── src/
│       ├── providers/    ← 40+ provider (anthropic / openai / google / bedrock / kimi-coding / xiaomi / zai ...)
│       ├── api/
│       ├── auth/
│       ├── images-api-registry.ts
│       └── models.generated.ts       ← 自动生成，**禁止手改**
├── coding-agent/         # CLI 入口 + Core 业务
│   └── src/
│       ├── core/
│       │   ├── event-bus.ts          ← 37 行，重点读
│       │   ├── output-guard.ts       ← 105 行，重点读（**名字误导**）
│       │   ├── agent-session.ts
│       │   ├── bash-executor.ts
│       │   ├── compaction/
│       │   ├── telemetry.ts          ← Privacy-First 立场下 catui 不补
│       │   ├── project-trust.ts
│       │   └── ...
│       ├── modes/
│       │   ├── interactive/
│       │   ├── print-mode.ts
│       │   └── rpc/
│       └── cli.ts
├── orchestrator/         # 子进程 supervisor + RPC
│   └── src/
│       ├── supervisor.ts
│       ├── rpc-process.ts
│       ├── ipc/
│       └── radius.ts
└── tui/                  # 终端 UI 包（独立发布）
    └── src/
        ├── tui.ts                    ← 1715 行，重点读
        ├── terminal.ts               ← 500+ 行，重点读
        ├── keyboard-protocol.ts
        ├── terminal-image.ts         ← Kitty 图像协议
        ├── terminal-colors.ts
        └── components/
```

## 读了的源文件（带行数）

| 文件 | 行数 | 用途 |
|---|---|---|
| `packages/agent/src/harness/agent-harness.ts` | 446 | 候选 1（steer/follow-up 队列）的源头 |
| `packages/coding-agent/src/core/event-bus.ts` | 37 | 候选 3（已存在）的对照 |
| `packages/coding-agent/src/core/output-guard.ts` | 105 | 候选 2（证伪）的源头 |
| `packages/tui/src/tui.ts` | 1715 | 候选 4 / 5（Overlay 焦点管理）的源头 |
| `packages/tui/src/terminal.ts` | ~500 | Kitty 协议协商、ANSI 转义 |

## 没读但建议下一轮读的

- `packages/agent/src/harness/compaction/` — catui 已有 compaction，独立议题
- `packages/coding-agent/src/core/bash-executor.ts` — catui 有自己的 bash.ts，**结构可能不同**
- `packages/ai/src/providers/{kimi-coding,xiaomi,zai}*` — 候选 6（provider 补齐）的源头
- `packages/orchestrator/src/supervisor.ts` — catui 的 sub-agent 系统可能借鉴过

## Pi 的发布节奏

- 包名：`@earendil-works/pi-coding-agent`、`@earendil-works/pi-agent-core`、`@earendil-works/pi-ai`、`@earendil-works/pi-tui`
- 实际**发布到 npm**，不只是研究项目
- 这意味着它的设计选择**经过了用户压力测试**，不是凭空的"应该这么设计"

## Pi 的 Git 工作流（来自 AGENTS.md）

- 多个 pi session 可同时跑在同一 cwd，每个改不同文件
- commit / push 严格按 Git 协议，锁文件变更要 `PI_ALLOW_LOCKFILE_CHANGE=1`
- **不在 deps 锁文件上加 lifecycle scripts**——需要白名单

## 跟 catui 的关系

catui 仓库根目录的 `.catui/agents/default/personas/aria/skills/` 等位置直接包含 `aria` 等 persona；**"catui 由 nanopencil 而来"是你之前说过的话**，**pi 是 catui 的父项目**（这次调研里第一次明确）。所以这次调研本质是**子项目向父项目看齐**，但结论是：**大多数特性 catui 已经看齐了，只有 2 处 Overlay 子能力值得借鉴**。