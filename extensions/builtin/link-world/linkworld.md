# link-world — Installation Guide

## For Humans

Copy this to your AI Agent:

```
Install link-world: https://raw.githubusercontent.com/Panniantong/agent-reach/main/docs/install.md
```

> 🛡️ **Security-conscious?** Use safe mode — it won't auto-install system packages:
> ```
> Install link-world (safe mode): https://raw.githubusercontent.com/Panniantong/agent-reach/main/docs/install.md
> Pass the --safe flag during installation.
> ```

---

## For AI Agents

### Goal

Install link-world and all upstream tools so your user's agent has full internet access. After installation, you'll use the upstream tools directly (xreach CLI, yt-dlp, mcporter, gh CLI, etc.) — link-world is just the installer and health checker.

### ⚠️ Boundaries

When fixing issues, stay within these limits:

- **DO NOT** run commands with `sudo` unless the user explicitly approved
- **DO NOT** modify system files outside `~/.agent-reach/`
- **DO NOT** install packages not listed in this guide
- **DO NOT** disable firewalls, security settings, or system protections
- **DO NOT** clone repos, create files, or run commands inside the agent workspace / working directory
- If something requires elevated permissions, **tell the user** what's needed and let them decide

### 📁 Directory Rules

All link-world files go in dedicated directories — **never in the agent workspace**:

| Purpose | Directory | Example |
|---------|-----------|---------|
| Config & tokens | `~/.agent-reach/` | `~/.agent-reach/config.json` |
| Upstream tool repos | `~/.agent-reach/tools/` | `~/.agent-reach/tools/douyin-mcp-server/` |
| Temporary files | `/tmp/` | `/tmp/yt-dlp-output/` |
| Skills | `~/.openclaw/skills/agent-reach/` | SKILL.md |

**Why?** If you clone repos or create files in the workspace, it pollutes the user's project directory and can break their agent over time. Keep the workspace clean.

### Step 1: Install

**Default (fully automatic):**

```bash
pip install https://github.com/Panniantong/agent-reach/archive/main.zip
agent-reach install --env=auto
```

This auto-installs system dependencies (gh CLI, Node.js, mcporter, xreach), configures Exa search, detects environment, and tests all channels.

**Safe mode (no automatic system changes):**

If the user asked for safe mode, or you're on a production machine:

```bash
pip install https://github.com/Panniantong/agent-reach/archive/main.zip
agent-reach install --env=auto --safe
```

Safe mode checks what's installed and tells you what's missing, but doesn't auto-install system packages. You can then install each dependency manually.

**Dry run (preview only):**

```bash
agent-reach install --env=auto --dry-run
```

Shows what would be done without making any changes.

**Read the output carefully**, then run:

```bash
agent-reach doctor
```

### Step 2: Fix what's broken

`agent-reach doctor` shows you which channels are active and which aren't.

Try to get as many channels to ✅ as possible. If something failed during install or shows as ❌/⚠️ in doctor, diagnose the problem and try to fix it — but stay within the boundaries above. If a fix requires elevated permissions or system changes, ask the user first.

Only ask the user when you genuinely need their input (credentials, permissions, etc.).

### Step 3: Configure things that need user input

Some channels need credentials only the user can provide. Based on the doctor output, ask for what's missing:

> 🔒 **Security tip:** For platforms that need cookies (Twitter, XiaoHongShu), we recommend using a **dedicated/secondary account** rather than your main account. Cookie-based auth carries two risks:
> 1. **Account ban** — platforms may detect non-browser API calls and restrict or ban the account
> 2. **Credential exposure** — cookies grant full account access; using a secondary account limits the blast radius if credentials are ever compromised

> 🍪 **Cookie import (universal for all platforms that need login):**
>
> For every platform that needs cookies (Twitter, XiaoHongShu, etc.), **prefer the Cookie-Editor import** — it is the simplest and most reliable approach:
> 1. User logs into the platform in their own browser
> 2. Install the [Cookie-Editor](https://chromewebstore.google.com/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm) Chrome extension
> 3. Click the extension → Export → Header String
> 4. Send the exported string to the Agent
>
> **Local-machine users** can also auto-extract with `agent-reach configure --from-browser chrome` (supports Twitter + XiaoHongShu).

**Twitter search & posting:**
> "To unlock Twitter search, I need your Twitter cookies. Install the Cookie-Editor Chrome extension, go to x.com/twitter.com, click the extension → Export → Header String, and paste it to me."

```bash
agent-reach configure twitter-cookies "PASTED_STRING"
```

> **Proxy notes (for networks that need a proxy, e.g. mainland China):**
>
> The xreach CLI uses Node.js's native `fetch()` and does not honor system proxy env vars (`HTTP_PROXY`/`HTTPS_PROXY`) by default. link-world ships a built-in solution: it auto-installs `undici` (`npm install -g undici`) at install time, and when xreach runs it automatically injects an `EnvHttpProxyAgent` so fetch goes through the user-configured proxy.
>
> **What you (the Agent) need to do:**
> 1. Confirm `undici` is installed globally: `npm list -g undici`; if not: `npm install -g undici`
> 2. Confirm the user has configured a proxy: `agent-reach configure proxy http://user:pass@ip:port`
> 3. link-world handles the rest automatically — no further user action required
>
> If the user reports "fetch failed", see [troubleshooting.md](troubleshooting.md)

**Reddit & Bilibili full access (server users):**
> "Reddit and Bilibili block server IPs. To unlock full access, I need a residential proxy. You can get one at https://webshare.io ($1/month). Send me the proxy address."

```bash
agent-reach configure proxy http://user:pass@ip:port
```

**XiaoHongShu / 小红书 (requires Docker):**
> "XiaoHongShu requires an MCP service, which in turn requires Docker on your machine. Once Docker is installed I'll handle the rest."

```bash
docker run -d --name xiaohongshu-mcp -p 18060:18060 xpzouying/xiaohongshu-mcp
mcporter config add xiaohongshu http://localhost:18060/mcp
```

> On servers we recommend adding a proxy to avoid IP-based risk control:
> `docker run -d --name xiaohongshu-mcp -p 18060:18060 -e XHS_PROXY=http://user:pass@ip:port xpzouying/xiaohongshu-mcp`
>
> **Login method (Cookie-Editor preferred — simplest):**
> 1. User logs into XiaoHongShu in their browser (xiaohongshu.com)
> 2. Use the [Cookie-Editor](https://chromewebstore.google.com/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm) extension to export cookies (JSON or Header String format both work)
> 3. Send the cookie string to the Agent
> 4. The Agent runs the command to complete login:
>
> ```bash
> # JSON format (Cookie-Editor → Export → JSON)
> agent-reach configure xhs-cookies '[{"name":"web_session","value":"xxx","domain":".xiaohongshu.com",...}]'
>
> # Or Header String format (Cookie-Editor → Export → Header String)
> agent-reach configure xhs-cookies "key1=val1; key2=val2; ..."
> ```
>
> **Alternative:** if the local machine has a browser, you can also open http://localhost:18060 and scan the QR code to log in.

**抖音 / Douyin (douyin-mcp-server):**
> "Douyin video parsing requires an MCP service. Once douyin-mcp-server is installed, you can parse videos and fetch watermark-free download links."

```bash
# 1. Install
pip install douyin-mcp-server

# 2. Start the HTTP service (port 18070)
# Option 1: use uv (recommended)
mkdir -p ~/.agent-reach/tools && cd ~/.agent-reach/tools
git clone https://github.com/yzfly/douyin-mcp-server.git && cd douyin-mcp-server
uv sync && uv run python run_http.py

# Option 2: start directly with Python
python -c "
from douyin_mcp_server.server import mcp
mcp.settings.host = '127.0.0.1'
mcp.settings.port = 18070
mcp.run(transport='streamable-http')
"

# 3. Register with mcporter
mcporter config add douyin http://localhost:18070/mcp
```

> No authentication is required for parsing video info and download links.
> To enable the AI voice-recognition transcript-extraction feature, configure a SiliconFlow API Key (`export API_KEY="sk-xxx"`).
>
> See https://github.com/yzfly/douyin-mcp-server for details.

**LinkedIn (optional — linkedin-scraper-mcp):**
> "Basic LinkedIn content is readable via Jina Reader. Full functionality (profile details, job search) requires linkedin-scraper-mcp."

```bash
pip install linkedin-scraper-mcp
```

> **Login method (browser UI required):**
>
> linkedin-scraper-mcp uses a Chromium browser to log in, so it needs to be able to see a browser window.
>
> - **Local machine (has a desktop):** just run:
>   ```bash
>   linkedin-scraper-mcp --login --no-headless
>   ```
>   A browser window pops up; manually log into LinkedIn.
>
> - **Server (no UI):** requires a VNC remote desktop:
>   ```bash
>   # 1. Install and start VNC on the server (skip if already there)
>   apt install -y tigervnc-standalone-server
>   vncserver :1 -geometry 1280x720
>
>   # 2. Connect a VNC client to server-ip:5901
>
>   # 3. In the VNC desktop terminal run:
>   export DISPLAY=:1
>   linkedin-scraper-mcp --login --no-headless
>   ```
>   After you see the browser inside VNC, log in manually. Once login succeeds the session is persisted to `~/.linkedin-mcp/profile/`.
>
> **Start the MCP service after login:**
> ```bash
> linkedin-scraper-mcp --transport streamable-http --port 8001
> mcporter config add linkedin http://localhost:8001/mcp
> ```
>
> See https://github.com/stickerdaniel/linkedin-mcp-server for details.

**Boss直聘 (optional — mcp-bosszp):**
> "Boss直聘 job pages can be read directly. Full search and auto-greet features require mcp-bosszp."

```bash
mkdir -p ~/.agent-reach/tools && cd ~/.agent-reach/tools
git clone https://github.com/mucsbr/mcp-bosszp.git && cd mcp-bosszp
pip install -r requirements.txt && playwright install chromium
```

> **Login method (mobile app QR scan):**
>
> mcp-bosszp uses QR-code login, which requires scanning with the Boss直聘 app.
>
> ```bash
> # 1. Start the MCP service
> python boss_zhipin_fastmcp_v2.py
>
> # 2. Trigger login via MCP (a QR-code image is generated)
> mcporter call 'bosszhipin.start_login()'
>
> # 3. Open the QR-code image in a browser (on a server use http://server-ip:8000/static/qrcode_xxx.png)
> # 4. Scan with the Boss直聘 app to confirm
> ```
>
> After a successful scan the session is auto-saved; afterwards you can search jobs and auto-greet.
>
> Or use Docker: `docker-compose up -d`
>
> See https://github.com/mucsbr/mcp-bosszp for details.

### Step 4: Final check

Run `agent-reach doctor` one final time and report the results to your user.

### Step 5: Set up daily monitoring (OpenClaw only)

If you are running inside **OpenClaw**, ask your user:

> "link-world is installed. Do you want me to set up a daily auto-check task? It will monitor whether these channels are healthy and whether there are new versions. It only notifies you if there's a problem — otherwise it stays quiet."

If the user agrees, create a **cron job** (daily, `sessionTarget: "isolated"`, `delivery: "announce"`) with this task:

```
Run the `agent-reach watch` command.
If the output contains "all healthy", do not notify the user — exit silently.
If the output contains problems (❌ ⚠️) or a new version (🆕), send the full report to the user with a suggested fix.
If a new version is available, ask the user whether to upgrade (upgrade command: `pip install --upgrade https://github.com/Panniantong/agent-reach/archive/main.zip`).
```

If the user wants a different agent to handle it, let them choose.

---

## Quick Reference

| Command | What it does |
|---------|-------------|
| `agent-reach install --env=auto` | Full auto-setup (installs deps + configures) |
| `agent-reach install --env=auto --safe` | Safe setup (no auto system changes) |
| `agent-reach install --env=auto --dry-run` | Preview what would be done |
| `agent-reach doctor` | Show channel status |
| `agent-reach watch` | Quick health + update check (for scheduled tasks) |
| `agent-reach check-update` | Check for new versions |
| `agent-reach configure twitter-cookies "..."` | Unlock Twitter search + posting |
| `agent-reach configure proxy URL` | Unlock Reddit + Bilibili on servers |

After installation, use upstream tools directly. See SKILL.md for the full command reference:

| Platform | Upstream Tool | Example |
|----------|---------------|---------|
| Twitter/X | `xreach` | `xreach search "query" --json` |
| YouTube | `yt-dlp` | `yt-dlp --dump-json URL` |
| Bilibili | `yt-dlp` | `yt-dlp --dump-json URL` |
| Reddit | `curl` | `curl -s "https://reddit.com/r/xxx.json"` |
| GitHub | `gh` | `gh search repos "query"` |
| Web | `curl` + Jina | `curl -s "https://r.jina.ai/URL"` |
| Exa Search | `mcporter` | `mcporter call 'exa.web_search_exa(...)'` |
| 小红书 | `mcporter` | `mcporter call 'xiaohongshu.search_feeds(...)'` |
| 抖音 | `mcporter` | `mcporter call 'douyin.parse_douyin_video_info(...)'` |
| LinkedIn | `mcporter` | `mcporter call 'linkedin.get_person_profile(...)'` |
| Boss直聘 | `mcporter` | `mcporter call 'bosszhipin.search_jobs_tool(...)'` |
| RSS | `feedparser` | `python3 -c "import feedparser; ..."` |
