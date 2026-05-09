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

<p><strong>会记忆、能进化的 AI 编程助手</strong></p>

<p>
  <a href="https://www.npmjs.com/package/@pencil-agent/nano-pencil">
    <img src="https://img.shields.io/npm/v/@pencil-agent/nano-pencil.svg?style=flat-square&color=cb3837" alt="npm 版本">
  </a>
  <a href="https://nodejs.org">
    <img src="https://img.shields.io/node/v/@pencil-agent/nano-pencil.svg?style=flat-square&color=339933" alt="Node.js">
  </a>
  <a href="https://www.npmjs.com/package/@pencil-agent/nano-pencil">
    <img src="https://img.shields.io/npm/dm/@pencil-agent/nano-pencil.svg?style=flat-square&color=cb3837" alt="下载量">
  </a>
  <img src="https://img.shields.io/badge/TypeScript-5.0+-blue?style=flat-square&color=3178C6" alt="TypeScript">
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square&color=brightgreen" alt="License">
</p>

<p>
  <a href="#-为什么选择-nanopencil">为什么选择</a> •
  <a href="#-核心特性">核心特性</a> •
  <a href="#-快速开始">快速开始</a> •
  <a href="#-文档">文档</a>
</p>

<p>
  <a href="./README_CN.md"><img src="https://img.shields.io/badge/中文-当前-orange?style=flat-square" alt="中文"></a>
  <a href="./README.md"><img src="https://img.shields.io/badge/English-Switch-blue?style=flat-square" alt="English"></a>
</p>

</div>

---

## 🌟 为什么选择 NanoPencil？

> **"唯一一个真正懂你的 AI 编程助手"**

NanoPencil 不只是一个普通的 AI 编程工具。它是专为终端原生开发者打造的 **AI 智能体**，拥有**持久记忆**和**进化性格**。

### 与众不同之处

| | 其他工具 | NanoPencil |
|---|---|---|
| **记忆能力** | ❌ 每次会话从零开始 | ✅ 记住你的项目、偏好和编码风格 |
| **个性特征** | ❌ 千篇一律的回复 | ✅ 根据互动进化出独特性格 |
| **终端原生** | ❌ GUI 包装或插件 | ✅ 纯 TUI，为终端工作流而生 |
| **模型自由** | ❌ 厂商锁定 | ✅ 10+ 提供商，秒速切换 |
| **离线可用** | ❌ 依赖云端 | ✅ Ollama 本地模型 |

---

## ✨ 核心特性

### 🧠 持久记忆系统 (NanoMem)
你的项目有上下文，你的 AI 也应该有。

- **项目知识** — API 端点、数据库结构、架构决策
- **错误模式** — 记住 Bug 及其解决方案
- **用户偏好** — 编码风格、命名规范、框架选择
- **智能检索** — 自动召回相关上下文

### 💫 AI 性格进化 (NanoSoul)
你的 AI 助手会形成自己的性格。

- **大五人格** — 开放性、尽责性、外向性、宜人性、神经质
- **编码风格** — 代码冗长度、抽象层级、安全边际
- **领域专长** — 前端、后端、DevOps、AI/ML 专业化
- **情绪状态** — 信心、好奇心、心流状态

> *使用 50 次后，你的 NanoPencil 会和别人的不一样。*

### 🎨 精美 TUI 界面
一个会呼吸的终端界面。

- **三种主题** — Dark、Light、Warm（护眼模式）
- **流畅动画** — 铅笔呼吸加载动画
- **直观导航** — 类 Vim 快捷键，模糊搜索
- **实时流式** — 实时观看 AI 思考过程

### 🔌 MCP 协议支持
通过模型上下文协议无限扩展。

内置工具包括：
- 📁 文件系统操作
- 🌐 HTTP 请求 (Fetch)
- 🎭 浏览器自动化 (Puppeteer)
- 🗄️ 数据库查询 (SQLite)
- 🔧 Git 操作

### 🌐 多模型支持
为每个任务选择最佳模型。

- 🇨🇳 **阿里百炼** — 通义系列（代码优化）
- 🤖 **OpenAI** — GPT-4、GPT-3.5
- 💬 **Anthropic** — Claude 3 Opus/Sonnet/Haiku
- 🔍 **Google** — Gemini Pro/Ultra
- 🏠 **本地** — Ollama (Qwen、Llama、Mistral 等)

---

## 🚀 快速开始

### 安装

```bash
npm install -g @pencil-agent/nano-pencil
```

### 首次运行

```bash
nanopencil
```

1. **选择模型** — 从可用提供商中选择
2. **输入 API Key** — 安全存储在 `~/.pencils/agents/default/auth.json`
3. **开始编码** — 输入你想构建的内容

### 示例会话

```
你: 创建一个 Express 的 JWT 认证中间件

AI: [分析项目结构...]
    [创建 auth.middleware.ts...]
    [添加 TypeScript 类型...]
    [编写测试...]
    
    ✅ 完成！创建了：
    - src/middleware/auth.middleware.ts
    - src/types/auth.d.ts
    - tests/auth.middleware.test.ts
    
    特性：
    • RS256 JWT 验证
    • 刷新令牌轮换
    • 基于角色的访问控制
    • 速率限制集成
```

---

## 🎮 使用方法

### 交互模式

```bash
nanopencil                    # 开始新会话
nanopencil -c                 # 继续上次会话
nanopencil -r                 # 从历史恢复
nanopencil -m qwen-max        # 使用指定模型
```

### 打印模式（脚本）

```bash
# 单次查询
nanopencil -p "重构为 async/await"

# 管道输入
cat bug-report.md | nanopencil -p "分析这个 Bug"

# 链式命令
nanopencil -p "生成 API" | nanopencil -p "为其编写测试"
```

### 斜线命令

| 命令 | 描述 |
|---------|-------------|
| `/model` | 切换 AI 模型 |
| `/thinking` | 调整推理深度 |
| `/fork` | 分支对话 |
| `/tree` | 浏览会话历史 |
| `/memory` | 查看项目记忆 |
| `/soul` | 查看 AI 性格 |
| `/settings` | 配置偏好 |
| `/export` | 导出为 HTML |

---

## 📊 功能对比

| 特性 | NanoPencil | Cursor | Claude Code | Aider |
|---------|:----------:|:------:|:-----------:|:-----:|
| 终端原生 | ✅ | ❌ | ✅ | ✅ |
| 持久记忆 | ✅ | ❌ | ❌ | ❌ |
| AI 性格 | ✅ | ❌ | ❌ | ❌ |
| 会话分支 | ✅ | ✅ | ✅ | ❌ |
| 多模型 | ✅ | ✅ | ❌ | ✅ |
| MCP 支持 | ✅ | ❌ | ✅ | ❌ |
| 离线模式 | ✅ | ❌ | ❌ | ✅ |
| 中文优化 | ✅ | ❌ | ❌ | ❌ |

---

## 🏗️ 架构理念

NanoPencil 建立在三大支柱之上：

```
┌─────────────────────────────────────────┐
│           🧠 认知层                      │
│    (记忆 + 性格 + 上下文)                 │
├─────────────────────────────────────────┤
│           🔧 工具层                      │
│  (文件操作 + Bash + 搜索 + MCP)          │
├─────────────────────────────────────────┤
│           🎨 界面层                      │
│       (TUI + 主题 + 快捷键)               │
└─────────────────────────────────────────┘
```

**设计原则：**
- **终端优先** — 无 Electron，无浏览器，纯终端
- **隐私优先** — 本地存储，无遥测，你的数据属于你
- **可扩展** — 工具、主题、行为的插件系统
- **极速** — 亚秒启动，即时响应

---

## 📚 文档

- [安装指南](docs/INSTALL.md)
- [配置说明](docs/CONFIG.md)
- [记忆系统](docs/记忆系统.md)
- [MCP 指南](docs/MCP集成指南.md)
- [快捷键](docs/KEYBINDINGS.md)
- [扩展开发](docs/EXTENSIONS.md)

---

## 🌍 社区

- 💬 [讨论区](https://github.com/pencil-agent/nano-pencil/discussions)
- 🐛 [问题反馈](https://github.com/pencil-agent/nano-pencil/issues)
- 📝 [更新日志](CHANGELOG.md)

---

## 📄 许可证

MIT © [Pencil Agent](https://github.com/pencil-agent)

---

<div align="center">

**[⬆ 返回顶部](#-nanopencil)**

<sub>用 ❤️ 为终端 dwellers 打造</sub>

</div>
