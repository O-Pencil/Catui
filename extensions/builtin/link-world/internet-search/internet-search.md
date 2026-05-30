---
name: internet-search
description: 当用户需要联网搜索最新信息、新闻、在线内容时使用此技能。包括搜索 Twitter、YouTube、Bilibili、知乎、微博、小红书等平台。
---

# 互联网搜索

## 触发条件

当用户请求以下内容时使用此技能：
- 搜索互联网、联网搜索、网络搜索
- 查找最新新闻、资讯、信息
- 搜索 YouTube、Bilibili、Twitter、小红书、微博等内容
- 查找某个话题的最新讨论
- 获取实时信息或热点内容

## 执行步骤

### 步骤 1：检查 agent-reach 是否安装

运行以下命令检查 agent-reach 是否可用：

```bash
agent-reach --version
```

### 步骤 2：如果未安装

如果 agent-reach 命令不可用，告知用户需要先安装：

> link-world (agent-reach) 未安装。请先运行 `/link-world` 安装 agent-reach 以支持联网搜索功能。

### 步骤 3：如果已安装

根据用户需求，使用 linkworld.md 中定义的工具进行搜索。

**完整命令参考请查阅：extensions/link-world/linkworld.md**

| 场景 | 推荐工具 | 示例命令 |
|------|----------|----------|
| 搜索 Twitter/X 推文 | xreach | `xreach search "关键词" --json` |
| 解析 YouTube 视频 | yt-dlp | `yt-dlp --dump-json "视频URL"` |
| 解析 Bilibili 视频 | yt-dlp | `yt-dlp --dump-json "视频URL"` |
| 搜索 Reddit 帖子 | curl | `curl -s "https://reddit.com/r/xxx/search.json?q=关键词"` |
| 搜索 GitHub 仓库 | gh | `gh search repos "关键词" --limit 5` |
| 读取网页内容 | curl + Jina | `curl -s "https://r.jina.ai/网页URL"` |
| 通用搜索引擎 | Exa (MCP) | `mcporter call 'exa.web_search_exa(query: "关键词", num_results: 5)'` |
| 搜索小红书笔记 | 小红书 (MCP) | `mcporter call 'xiaohongshu.search_feeds(keyword: "关键词", limit: 5)'` |
| 解析抖音视频 | 抖音 (MCP) | `mcporter call 'douyin.parse_douyin_video_info(url: "视频URL")'` |

### 步骤 4：返回结果

将搜索结果整理后返回给用户，包括：
- 来源平台
- 标题
- 内容摘要
- 链接

## 注意事项

1. 遵守平台的 API 使用规范
2. 如需登录平台的搜索功能，确保用户已配置认证信息
3. 如果搜索失败，尝试其他平台或告知用户可能的错误原因
4. YouTube/Bilibili 需要提供具体的视频 URL，不能直接搜索关键词
5. 详细的配置说明（Cookie、代理等）请参考 linkworld.md
