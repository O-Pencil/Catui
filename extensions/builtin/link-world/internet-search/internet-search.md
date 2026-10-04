---
name: internet-search
description: Use this skill when the user needs online search for the latest information, news, or online content. Includes search for Twitter, YouTube, Bilibili, Zhihu, Weibo, XiaoHongShu, and other platforms.
---

# Internet Search

## Trigger conditions

Use this skill when the user requests any of the following:

- Search the internet / online search / web search
- Look up the latest news, current information, recent updates
- Search YouTube, Bilibili, Twitter, XiaoHongShu, Weibo, etc.
- Find the latest discussion on some topic
- Get real-time information or trending content

## Execution steps

### Step 1: Check whether agent-reach is installed

Run the following command to check whether agent-reach is available:

```bash
agent-reach --version
```

### Step 2: If not installed

If the `agent-reach` command is not available, tell the user they need to install it first:

> link-world (agent-reach) is not installed. Please run `/link-world` first to install agent-reach so the internet-search feature works.

### Step 3: If installed

According to the user's request, use the tools defined in `linkworld.md`.

**For the full command reference, see: `extensions/builtin/link-world/linkworld.md`**

| Scenario | Recommended tool | Example command |
|----------|------------------|-----------------|
| Search Twitter/X tweets | xreach | `xreach search "keyword" --json` |
| Parse a YouTube video | yt-dlp | `yt-dlp --dump-json "video URL"` |
| Parse a Bilibili video | yt-dlp | `yt-dlp --dump-json "video URL"` |
| Search Reddit threads | curl | `curl -s "https://reddit.com/r/xxx/search.json?q=keyword"` |
| Search GitHub repos | gh | `gh search repos "keyword" --limit 5` |
| Read web page content | curl + Jina | `curl -s "https://r.jina.ai/page URL"` |
| General web search | Exa (MCP) | `mcporter call 'exa.web_search_exa(query: "keyword", num_results: 5)'` |
| Search XiaoHongShu notes | XiaoHongShu (MCP) | `mcporter call 'xiaohongshu.search_feeds(keyword: "keyword", limit: 5)'` |
| Parse Douyin video | Douyin (MCP) | `mcporter call 'douyin.parse_douyin_video_info(url: "video URL")'` |

### Step 4: Return the result

Organize the search result and return it to the user, including:

- Source platform
- Title
- Content summary
- Link

## Cautions

1. Follow each platform's API usage rules.
2. If you need to log in to a platform for search, make sure the user has configured authentication.
3. If the search fails, try another platform or tell the user the likely cause of the error.
4. YouTube / Bilibili need a specific video URL — they can't be searched by keyword directly.
5. For detailed configuration notes (cookies, proxy, etc.), see `linkworld.md`.
