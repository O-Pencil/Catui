# §2 项目职责边界

> 每个项目是什么、不是什么、技术栈、发布形态

<!--
[WHO]  每个项目的职责定义
[FROM] pencil-platform-charter.md §3 + PROJECT_OVERVIEW.md §四
[TO]   各项目 README、03-relations
[HERE] charter/02-boundaries.md — 职责边界
-->

---

## 2.1 核心层

### nanoPencil — 本体心智核芯

| 维度 | 定义 |
|------|------|
| **是** | Agent 引擎本体；提供模型对话、工具循环、记忆系统、Soul 进化、MCP 集成、Browser Harness；以 `@pencil-agent/nano-pencil` SDK 形式被嵌入，或作为 `nanopencil` CLI 直接运行；暴露 ACP 协议供宿主接入 |
| **不是** | 不暴露 HTTP API；不管 API Key / 多租户 / 计费；不是"一个 Agent"——它是"造 Agent 的引擎" |
| **技术栈** | Node.js + TypeScript + React TUI |
| **发布** | npm: `@pencil-agent/nano-pencil`；二进制: `nanopencil` CLI |
| **仓库** | `O-Pencil/nanoPencil` |

**核心能力**：
- **NanoMem**: 持久记忆引擎，跨会话记忆沉淀
- **NanoSoul**: 个性进化引擎，自适应性格养成
- **Agent Core**: 状态管理与传输层
- **AI Core**: 统一模型接口层（Anthropic / OpenAI / Gemini / DashScope / Ollama）
- **Tool Extensions**: 文件系统、Shell、MCP、link-world、Browser Harness 等可插拔工具

### Pencil-Agent-Gateway — PAAS 网关层

| 维度 | 定义 |
|------|------|
| **是** | HTTP serving 层；托管多个 PencilAgent 实例；OpenAI 兼容 API + SSE；EngineAdapter 抽象使引擎可替换；PENCILS_HOME 隔离多 Pencil；Channel 子模块（钉钉/微信/飞书） |
| **不是** | 不是引擎本体（import nano-pencil）；不管用户系统、计费、Marketplace（那是 Asgard）；不直接服务终端用户的写作 UI（那是 editor） |
| **技术栈** | Node.js + Hono |
| **发布** | Docker 镜像；生产部署绑 127.0.0.1 + nginx 反代 |
| **仓库** | `O-Pencil/Pencil-Agent-Gateway` |

---

## 2.2 编排层

### O-Mesh — 多 Agent 编排引擎

| 维度 | 定义 |
|------|------|
| **是** | 多 Agent 协作引擎；任务分解与调度；Blackboard 横向通信协议；树状 + 横向通信模式 |
| **不是** | 不实现 Agent 引擎（调度 nanoPencil）；不暴露 HTTP API 给终端用户（通过 Gateway 间接服务） |
| **技术栈** | Rust |
| **发布** | CLI 工具 |
| **仓库** | `O-Pencil/O-Mesh` |

---

## 2.3 评估层

### Pencil-Evaluate — Agent 评估框架

| 维度 | 定义 |
|------|------|
| **是** | LLM 评估框架（类似 Pytest 但专用于 LLM）；多维度指标（Task Completion / Tool Correctness / Goal Accuracy / Knowledge Retention / Plan Adherence）；基准测试 + 报告生成 |
| **不是** | 不实现 Agent 功能；不直接修改 Agent 参数（产出报告，由人/AI 决策优化） |
| **技术栈** | Python + DeepEval |
| **发布** | PyPI 包 |
| **仓库** | `O-Pencil/Pencil-Evaluate` |

**评估维度**：

| 指标 | 说明 |
|------|------|
| Task Completion | Agent 是否完成用户指定的任务 |
| Tool Correctness | 工具调用（文件操作、bash 等）是否正确 |
| Step Efficiency | 完成任务是否走了不必要的步骤 |
| Knowledge Retention | 记忆系统的知识保持能力 |
| Answer Relevancy | 响应与用户问题的相关性 |
| Plan Adherence | 是否按编排计划执行 |

---

## 2.4 平台层

### Asgard-platform — 用户平台层

| 维度 | 定义 |
|------|------|
| **是** | 多 Agent 管理平台；用户系统、API Key 管理、PencilAgent CRUD、用量记录、计费策略、Agent Marketplace、Developer Console；通过 HTTP 代理到 Gateway |
| **不是** | 不实现 Agent 引擎；不实现 HTTP serving 协议；不直接管容器进程（编排是阶段四 C 线） |
| **技术栈** | FastAPI + PostgreSQL + JWT/SSE（后端）；React 19 + Vite + TailwindCSS 4（前端） |
| **发布** | Docker compose；render.yaml |
| **仓库** | `O-Pencil/Asgard-platform`（含子模块 Asgard-api / Asgard-web） |

---

## 2.5 表现层

### nanopencil-editor — 创作表现层

| 维度 | 定义 |
|------|------|
| **是** | AI-Native 写作编辑器；Desktop App + Web IDE；三模路由（本地 ACP / 内部 WS / 远程 HTTP）；富文本编辑 + 工作区管理 + Spark Design |
| **不是** | 不构建 Agent 实例管理；不实现 HTTP server；不复刻 Asgard 的 PencilAgent 创建 UI |
| **技术栈** | Rust + Tauri + React/TypeScript |
| **发布** | Tauri Desktop bundle（NSIS/MSI）；Web build |
| **仓库** | `O-Pencil/nanopencil-editor` |

### Pencil-Game — 社会博弈表现层

| 维度 | 定义 |
|------|------|
| **是** | Agent 在博弈场景中碰撞进化；社交推理 / 狼人杀等博弈游戏；多 Agent 策略博弈 |
| **不是** | 不是通用游戏引擎；不实现 Agent 引擎 |
| **技术栈** | Next.js + React |
| **发布** | Web 应用（Vercel） |
| **仓库** | `O-Pencil/Pencil-Game` |

### Pencil-Lesson — 知识习得表现层

| 维度 | 定义 |
|------|------|
| **是** | 结构化学习与知识沉淀；AI 驱动的个性化学习路径 |
| **不是** | 不是 LMS（学习管理系统）；不实现 Agent 引擎 |
| **技术栈** | Next.js + React |
| **发布** | Web 应用 |
| **仓库** | `O-Pencil/Pencil-Lesson` |

### Pencil-Terminal — 具身环境

| 维度 | 定义 |
|------|------|
| **是** | 物理世界锚点；文件 / Git / Shell 操作；与 nanoPencil 协同提供完整具身能力 |
| **不是** | 不是 Agent 引擎；不是 IDE（编辑能力由 editor 提供） |
| **技术栈** | Go + Electron + TypeScript |
| **发布** | Desktop 应用 |
| **仓库** | `O-Pencil/Pencil-Terminal` |

---

## 2.6 渗透层

### Pencil-Eidolon — 浏览器分身

| 维度 | 定义 |
|------|------|
| **是** | Pencil 在浏览器中的"幻影分身"；页面感知、DOM 操作、Side Panel 交互；双模运行（本地 Native Messaging → nanoPencil；云端 OpenAI 兼容 API → Gateway）；站点授权与用户确认 |
| **不是** | 不是浏览器自动化工具（那是 nanoPencil 的 Browser Harness）；不实现 Agent 引擎；不暴露 HTTP API |
| **技术栈** | React + TypeScript + Chrome Manifest V3（兼容 Edge） |
| **发布** | Chrome Web Store / Edge Add-ons |
| **仓库** | `O-Pencil/Pencil-Eidolon` |

**与 nanoPencil 的边界**：
- `nanoPencil` 是 Kernel，提供模型、记忆、人格、规划和推理
- `Pencil-Eidolon` 是浏览器宿主，拥有页面上下文、站点授权、DOM/Debugger 操作和侧边栏体验
- Browser Harness 在终端/CLI 场景可被 nanoPencil 直接调用；在 Eidolon 场景必须由 Eidolon 仲裁浏览器动作
- `link-world` / `web_search` 属于网络检索路径；真实页面交互、登录态、截图、填写归 Eidolon

---

## 2.7 项目速查矩阵

| 项目 | 层级 | 技术栈 | 发布形态 | GitHub |
|------|------|--------|----------|--------|
| nanoPencil | 本体层 | Node.js + TS | npm / CLI | O-Pencil/nanoPencil |
| Pencil-Agent-Gateway | 网关层 | Node.js + Hono | Docker | O-Pencil/Pencil-Agent-Gateway |
| O-Mesh | 编排层 | Rust | CLI | O-Pencil/O-Mesh |
| Pencil-Evaluate | 评估层 | Python + DeepEval | PyPI | O-Pencil/Pencil-Evaluate |
| Asgard-platform | 平台层 | FastAPI + React | Docker compose | O-Pencil/Asgard-platform |
| nanopencil-editor | 表现层 | Rust/Tauri + React | Desktop / Web | O-Pencil/nanopencil-editor |
| Pencil-Eidolon | 渗透层 | React + Chrome MV3 | Browser Extension | O-Pencil/Pencil-Eidolon |
| Pencil-Game | 表现层 | Next.js + React | Web | O-Pencil/Pencil-Game |
| Pencil-Lesson | 表现层 | Next.js + React | Web | O-Pencil/Pencil-Lesson |
| Pencil-Terminal | 具身层 | Go + Electron | Desktop | O-Pencil/Pencil-Terminal |
