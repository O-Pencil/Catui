# 候选 6：Provider 补齐（独立议题）

> 来源：`pi/packages/ai/src/providers/` (40+ 个)
> 状态：**📋 独立议题，本调研不深入**

## 现状

| 仓库 | Provider 数 | 覆盖 |
|---|---|---|
| catui `core/lib/ai/src/providers/` | 16 | Anthropic / OpenAI / Google / Azure / Bedrock / Copilot |
| pi `packages/ai/src/providers/` | 40+ | 上述 + 国产 + 长尾 |

## catui 缺（pi 有）

- **国产模型**：kimi-coding / moonshotai / zai / xiaomi-token-plan-{ams,sgp,cn} / minimax
- **长尾**：groq / cerebras / deepseek / fireworks / huggingface / nvidia / openrouter / vercel-ai-gateway / xai / opencode
- **其他**：cloudflare-ai-gateway / cloudflare-workers-ai / cloudflare-auth / azure-openai-responses / openai-codex / github-copilot / ant-ling

## 为什么是独立议题

- **每个 provider 是独立 integration**——必须各自走 catui AGENTS.md `feature-workflow.md` 的 §2b 决策
- **不是"迁移"**——是从零写（pi 的实现是它自己的 schema）
- **改动量大**——加 5 个 provider ≈ 800-1500 行代码 + 测试
- **有先决条件**——用户实际用什么模型，决定该补哪些

## 我的建议

**不在这次调研范围**。理由：

1. 调研目标"看 pi 做了什么好的特性和优化"——provider 补齐属于**生态**，不是"好的特性"
2. 你已经有 16 个 provider 覆盖主要模型
3. 加哪个 provider 应该由**用户需求驱动**，不是看 pi 有什么就加什么

## 如果要补

1. **先盘点**——列 catui 用户实际用的模型（看 session 数据 / settings.json / models.json）
2. **列候选**——和 pi 的 provider 列表交叉，得"用户用 + pi 有 + catui 没"的清单
3. **排序**——按安装量 / 调用量排
4. **逐个走** `feature-workflow.md §2b` 决策（每个 provider 一个独立决策）

## 单独跑这个议题时

应该另开一个调研目标，**不**混在"看 pi 做了什么"的报告里。