<div align="center">

<pre>
                .-~~~~~~~~~-._       _.-~~~~~~~~~-.
            __.'              ~.   .~              `.__
          .'//                  \./                  \\`.
        .'//                     |                     \\`.
      .'// .-~""""""""""""""-._     |     _,-""""""""""""""~-. \\`.
    .'//.-"                 `-.  |  .-'                 "-.\\`.
  .'//______.============-..   \ | /   ..-============.______\\`.
.'______________________________\|/______________________________`.
</pre>

<h1>✎ NanoPencil</h1>

<p><strong>The AI Coding Agent That Remembers & Evolves</strong></p>

<p>
  <a href="https://www.npmjs.com/package/@pencil-agent/nano-pencil">
    <img src="https://img.shields.io/npm/v/@pencil-agent/nano-pencil.svg?style=flat-square&color=cb3837" alt="npm version">
  </a>
  <a href="https://nodejs.org">
    <img src="https://img.shields.io/node/v/@pencil-agent/nano-pencil.svg?style=flat-square&color=339933" alt="Node.js">
  </a>
  <a href="https://www.npmjs.com/package/@pencil-agent/nano-pencil">
    <img src="https://img.shields.io/npm/dm/@pencil-agent/nano-pencil.svg?style=flat-square&color=cb3837" alt="Downloads">
  </a>
  <img src="https://img.shields.io/badge/TypeScript-5.0+-blue?style=flat-square&color=3178C6" alt="TypeScript">
  <img src="https://img.shields.io/badge/License-GPL--3.0-green?style=flat-square&color=brightgreen" alt="License">
</p>

<p>
  <a href="#-why-nanopencil">Why NanoPencil?</a> •
  <a href="#-features">Features</a> •
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-documentation">Docs</a>
</p>

<p>
  <a href="./README.md"><img src="https://img.shields.io/badge/English-Active-blue?style=flat-square" alt="English"></a>
  <a href="./README_CN.md"><img src="https://img.shields.io/badge/中文-切换-orange?style=flat-square" alt="中文"></a>
</p>

</div>

---

## 🌟 Why NanoPencil?

> **"The only AI coding assistant that truly learns from you"**

NanoPencil isn't just another AI coding tool. It's a **terminal-native AI agent** with **persistent memory** and **evolving personality** — designed for developers who live in the terminal.

### What Makes It Different?

| | Other Tools | NanoPencil |
|---|---|---|
| **Memory** | ❌ Starts fresh every session | ✅ Remembers your projects, preferences, and coding style |
| **Personality** | ❌ Generic responses | ✅ Evolves a unique personality based on your interactions |
| **Terminal Native** | ❌ GUI wrappers or plugins | ✅ Pure TUI built for terminal workflows |
| **Model Freedom** | ❌ Vendor lock-in | ✅ 10+ providers, switch instantly |
| **Offline Ready** | ❌ Cloud dependent | ✅ Local models via Ollama |

---

## ✨ Features

### 🧠 Persistent Memory (NanoMem)
Your projects have context. So should your AI.

- **Project Knowledge** — API endpoints, database schemas, architecture decisions
- **Error Patterns** — Remembers bugs and their solutions  
- **User Preferences** — Coding style, naming conventions, framework choices
- **Smart Retrieval** — Automatically recalls relevant context when needed

### 💫 AI Personality Evolution (NanoSoul)
Your AI assistant develops its own character.

- **Big Five Traits** — Openness, Conscientiousness, Extraversion, Agreeableness, Neuroticism
- **Coding Style** — Verbosity, abstraction level, safety margins
- **Domain Expertise** — Frontend, Backend, DevOps, AI/ML specializations
- **Emotional States** — Confidence, curiosity, flow state

> *After 50 sessions, your NanoPencil will code differently than anyone else's.*

### 🎨 Beautiful TUI
A terminal interface that feels alive.

- **Three Themes** — Dark, Light, and Warm (eye-friendly)
- **Smooth Animations** — Breathing pencil loader
- **Intuitive Navigation** — Vim-like keybindings, fuzzy search
- **Real-time Streaming** — Watch the AI think in real-time

### 🔌 MCP Protocol Support
Extend with the Model Context Protocol.

Built-in tools include:
- 📁 Filesystem operations
- 🌐 HTTP requests (Fetch)
- 🎭 Browser automation (Puppeteer)
- 🗄️ Database queries (SQLite)
- 🔧 Git operations

### 🌐 Multi-Model Support
Use the best model for each task.

- 🇨🇳 **Alibaba DashScope / Token Plan** — Qwen, GLM, MiniMax, DeepSeek text models
- 🤖 **OpenAI** — GPT-4, GPT-3.5
- 💬 **Anthropic** — Claude 3 Opus/Sonnet/Haiku
- 🔍 **Google** — Gemini Pro/Ultra
- 🏠 **Local** — Ollama (Qwen, Llama, Mistral, etc.)

---

## 🚀 Quick Start

### Installation

```bash
npm install -g @pencil-agent/nano-pencil
```

### First Run

```bash
nanopencil
```

1. **Select your model** — Choose from available providers
2. **Enter API key** — Securely stored in `~/.nanopencil/agent/auth.json`
3. **Start coding** — Just type what you want to build

### Example Session

```
You: Create a JWT authentication middleware for Express

AI: [Analyzing project structure...]
    [Creating auth.middleware.ts...]
    [Adding TypeScript types...]
    [Writing tests...]
    
    ✅ Done! Created:
    - src/middleware/auth.middleware.ts
    - src/types/auth.d.ts
    - tests/auth.middleware.test.ts
    
    Features:
    • JWT verification with RS256
    • Refresh token rotation
    • Role-based access control
    • Rate limiting integration
```

---

## 🎮 Usage

### Interactive Mode

```bash
nanopencil                    # Start new session
nanopencil -c                 # Continue last session
nanopencil -r                 # Resume from history
nanopencil -m qwen-max        # Use specific model
```

### Print Mode (Scripts)

```bash
# Single query
nanopencil -p "Refactor this to use async/await"

# Pipe input
cat bug-report.md | nanopencil -p "Analyze this bug"

# Chain commands
nanopencil -p "Generate API" | nanopencil -p "Write tests for it"
```

### Slash Commands

| Command | Description |
|---------|-------------|
| `/model` | Switch AI model |
| `/thinking` | Adjust reasoning depth |
| `/fork` | Branch conversation |
| `/tree` | Browse session history |
| `/memory` | View project memories |
| `/soul` | Check AI personality |
| `/settings` | Configure preferences |
| `/export` | Save as HTML |

---

## 📊 Comparison

| Feature | NanoPencil | Cursor | Claude Code | Aider |
|---------|:----------:|:------:|:-----------:|:-----:|
| Terminal Native | ✅ | ❌ | ✅ | ✅ |
| Persistent Memory | ✅ | ❌ | ❌ | ❌ |
| AI Personality | ✅ | ❌ | ❌ | ❌ |
| Session Branching | ✅ | ✅ | ✅ | ❌ |
| Multi-Model | ✅ | ✅ | ❌ | ✅ |
| MCP Support | ✅ | ❌ | ✅ | ❌ |
| Offline Mode | ✅ | ❌ | ❌ | ✅ |
| Chinese Optimized | ✅ | ❌ | ❌ | ❌ |

---

## 🏗️ Architecture Philosophy

NanoPencil is built on three pillars:

```
┌─────────────────────────────────────────┐
│           🧠 COGNITIVE LAYER            │
│    (Memory + Personality + Context)     │
├─────────────────────────────────────────┤
│           🔧 TOOL LAYER                 │
│  (File Ops + Bash + Search + MCP)       │
├─────────────────────────────────────────┤
│           🎨 INTERFACE LAYER            │
│       (TUI + Themes + Keybindings)      │
└─────────────────────────────────────────┘
```

**Design Principles:**
- **Terminal First** — No Electron, no browser, pure terminal
- **Privacy First** — Local storage, no telemetry, your data stays yours
- **Extensible** — Plugin system for tools, themes, and behaviors
- **Fast** — Sub-second startup, instant response

---

## 📚 Documentation

- [Installation Guide](docs/INSTALL.md)
- [Configuration](docs/CONFIG.md)
- [Memory System](docs/记忆系统.md)
- [MCP Guide](docs/MCP集成指南.md)
- [Keybindings](docs/KEYBINDINGS.md)
- [Extensions](docs/EXTENSIONS.md)

---

## 🌍 Community

- 💬 [Discussions](https://github.com/pencil-agent/nano-pencil/discussions)
- 🐛 [Issues](https://github.com/pencil-agent/nano-pencil/issues)
- 📝 [Changelog](CHANGELOG.md)

---

## 📄 License

MIT © [Pencil Agent](https://github.com/pencil-agent)

---

<div align="center">

**[⬆ Back to Top](#-nanopencil)**

<sub>Built with ❤️ for terminal dwellers everywhere</sub>

</div>
