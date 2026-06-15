<!-- 把每课理解写进学习者 oh-my-wiki 个人 vault 的约定。基于 oh-my-wiki 实测结构。 -->

# kb-integration — 把理解沉淀进个人知识库

学习结果(你的理解/卡点/笔记)写进**学习者自己的 oh-my-wiki vault**,Obsidian 兼容、可视化成知识图谱。本文按 oh-my-wiki 实测结构给出映射约定。**绝不写进 catui 仓库或 `learning-framework/`。**

## vault 在哪

oh-my-wiki 的 HUB 由 `~/.config/llm-wiki/config.json` 的 `hub_path` 决定(默认 `~/wiki`)。内容住在 **topic 子 wiki**:`HUB/topics/catui/`。`/wiki init catui` 会建好下列结构(无需 Obsidian app,但带 `.obsidian/` 配置,可直接用 Obsidian 打开):

```
HUB/topics/catui/
├── _index.md          # 仪表盘:统计 + 概念表 + 快速导航(= 学习进度首页)
├── config.md          # frontmatter(title/description) + Scope/Conventions
├── log.md             # 活动/学习日志(/wiki:ll 写这里)
├── raw/repos/         # 被学对象的引用(catui 仓库指针,immutable)
└── wiki/
    ├── concepts/      # ★ 每个学到的概念一篇(你的理解单元)
    ├── topics/        # C0–C10 大区(可选,把概念归类)
    └── references/    # 速查表(命令/路径/排查清单)
```

## 一个概念 = 一篇 concept 笔记

每教完一个概念,写 `wiki/concepts/<Cx-slug>.md`,**学习者视角**(我理解了什么),不是抄源码:

```markdown
---
title: "C1 Agent Loop 核心"
category: concept
sources:
  - raw/repos/catui.md            # 指向被学仓库
created: 2026-06-15
updated: 2026-06-15
tags: [catui, agent-loop, runtime]
confidence: medium              # 自评:low/medium/high
volatility: warm
summary: "一次 turn 怎么跑:AgentSession.prompt → agent-core Agent → 模型流式→工具→回灌→停。"
---

# C1 Agent Loop 核心

> 我的理解(用我自己的话)…一次对话回合是怎么跑完的。

## 数据流
AgentSession.prompt() (`core/runtime/agent-session.ts:1117`)
→ this.agent.prompt() (`:1270`) → agent-core 的 while 循环 (`core/lib/agent-core/src/agent-loop.ts:303`) …

## 为什么这么写
…(loop 放在 agent-core、session 只驱动的原因)

## 排查入口(坏了先看哪)
- 回合不停/死循环 → `agent-loop.ts:303` while 的停止条件
- 工具没被调用 → 工具编排 `core/tools/orchestrator.ts`

## See Also
[[C0-framework|C0 整体设计]] ([C0](C0-framework.md)) · [[C2-session-context|C2 上下文]] ([C2](C2-session-context.md))
```

**双链约定**(同时给 Obsidian 图谱和 Claude 导航,同一行):
`[[C2-session-context|C2 上下文]] ([C2](C2-session-context.md))`。相邻概念互链,Obsidian 图谱里就长出你的"心智地图"。

**frontmatter** 必填 `title/category/sources/created/updated/tags/summary`;`confidence` 自评(还没懂透就标 low,提醒以后回看)。

## 卡点与发现 → /wiki:ll

每课结束跑:

```
/wiki:ll        # 扫本次会话的 error→fix、被纠正处、新发现,结构化写进 vault 的 log/lessons
```

这把"我哪里卡住了、为什么之前理解错了"也沉淀下来——正是未来排查的金矿。

## 进度与续课(只在个人 vault 内)

- `_index.md` 概念表的状态列 + `log.md` = 个人进度看板。
- cursor = 还没 done 的第一个概念;下次任一 Agent `/wiki:query` 或读 `_index.md` 即知从哪续。
- **每人一份 vault,进度互不影响**;框架与 catui 仓库都不记任何人的进度。

## 可选:导入 teach 的原始记录

若学习者也用了 catui 的 `/teach`,其产物在 `<workspace>/.catui/teach/records/*.md`(已是 markdown)。可 `/wiki:ingest` 把它们并入个人 vault 的 `raw/notes/`,再 compile 成 concept 笔记。teach 代码不改,只是把它的输出当一个源。
