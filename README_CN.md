<div align="center">

<pre>
             *     ,MMM8&&&.            .
                  MMMM88&&&&&    .
                 MMMM88&&&&&&&
     *           MMM88&&&&&&&&
                 MMM88&&&&&&&&
                 'MMM88&&&&&&'
                   'MMM8&&&'      .    _
          |\___/|                      \\
          )     (    |\_/|              ||    '
         =\     /=   )a a '._.-""""-.  //
           )===(    =\T_= /    ~  ~  \//
          /     \     `"`\   ~   / ~  /
          |     |         |~   \ |  ~/
         /       \         \  ~/- \ ~\
         \       /         || |  // /`
     _/\_/\_   _/_/\_/\_/\_((_|\((_//\_/\_/_
  |  |  |  |( (  |  |  |  |  |  |  |  |  |  |
  |  |  |  | ) ) |  |  |  |  |  |  |  |  |  |
  |  |  |  |(_(  |  |  |  |  |  |  |  |  |  |
  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
</pre>

<h1>✎ Catui</h1>

<p><strong>会记忆、能进化的 AI 编程助手</strong></p>

<p>
  <a href="https://www.npmjs.com/package/catui-agent">
    <img src="https://img.shields.io/npm/v/catui-agent.svg?style=flat-square&color=cb3837" alt="npm 版本">
  </a>
  <a href="https://nodejs.org">
    <img src="https://img.shields.io/node/v/catui-agent.svg?style=flat-square&color=339933" alt="Node.js">
  </a>
  <a href="https://www.npmjs.com/package/catui-agent">
    <img src="https://img.shields.io/npm/dm/catui-agent.svg?style=flat-square&color=cb3837" alt="下载量">
  </a>
  <img src="https://img.shields.io/badge/TypeScript-5.0+-blue?style=flat-square&color=3178C6" alt="TypeScript">
  <img src="https://img.shields.io/badge/License-GPL--3.0-green?style=flat-square&color=brightgreen" alt="License">
</p>

<p>
  <a href="#-为什么选择-catui">为什么选择</a> •
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

## 🌟 为什么选择 Catui？

> **会记住你的项目、适应你工作方式的终端编程智能体**

Catui 不只是一个普通的 AI 编程工具。它是专为终端原生开发者打造的 **AI 智能体**，拥有**持久记忆**和**进化性格**。

### 与众不同之处

| | 其他工具 | Catui |
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

> *使用 50 次后，你的 Catui 会和别人的不一样。*

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
npm install -g catui-agent
```

### 首次运行

```bash
catui
```

1. **选择模型** — 从可用提供商中选择
2. **输入 API Key** — 安全存储在 `~/.catui/agents/default/auth.json`
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
catui                    # 开始新会话
catui -c                 # 继续上次会话
catui -r                 # 从历史恢复
catui -m qwen-max        # 使用指定模型
```

### 打印模式（脚本）

```bash
# 单次查询
catui -p "重构为 async/await"

# 管道输入
cat bug-report.md | catui -p "分析这个 Bug"

# 链式命令
catui -p "生成 API" | catui -p "为其编写测试"
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

## 📊 差异点

给其他工具打分的功能矩阵很快会过时，这里只列 Catui 可验证的差异点：

| 差异点 | Catui |
|---|---|
| **持久记忆** | ✅ 项目知识、错误模式、使用偏好跨会话保留 |
| **性格进化** | ✅ 回复风格与编码习惯会随交互逐渐演化 |
| **中文优先** | ✅ 文档、提示词、本地化一等公民支持 |

---

## 🏗️ 架构理念

Catui 建立在三大支柱之上：

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
- **性能持续优化** — `--version`/`--help` 快路径 200ms 内响应；完整启动耗时有基准测试持续跟踪优化

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

- 💬 [讨论区](https://github.com/catui-agent/catui-agent/discussions)
- 🐛 [问题反馈](https://github.com/catui-agent/catui-agent/issues)
- 📝 [更新日志](CHANGELOG.md)

---

## 📄 许可证

GPL-3.0 © [Catui Agent](https://github.com/catui-agent)

---

<div align="center">

**[⬆ 返回顶部](#-catui)**

<sub>用 ❤️ 为终端 dwellers 打造</sub>

</div>
