# §4 术语表

> Pencil 生态的规范术语定义。各仓内部文档遇到这些词时必须使用本表定义。

<!--
[WHO]  全生态统一术语定义
[FROM] pencil-platform-charter.md §4 + PROJECT_OVERVIEW.md
[TO]   所有项目文档
[HERE] charter/04-glossary.md — 术语表
-->

---

## 4.1 项目与产品名

| 术语 | 规范定义 | 易混点 |
|------|----------|--------|
| **Pencil** | 生态品牌名，通称 Agent 能力。"调用 Pencil" = "调用某个 PencilAgent"。不是单独项目 | 商业文案缩写可用；技术文档优先用 PencilAgent |
| **nanoPencil** | 引擎项目，仓库名（大驼峰）。包含 `@pencil-agent/nano-pencil` SDK + `nanopencil` CLI | ❌ nanoPencil ≠ "一个 Agent"，它是引擎 |
| **nano-pencil** | npm 包名（短横线）`@pencil-agent/nano-pencil` | "被 Gateway import 的 SDK" 指本词 |
| **nanopencil** | CLI 命令名（全小写）：`nanopencil` | 全局安装后的命令行入口 |
| **PencilAgent** | 配置好的运行单元：`engine + Soul + memory + model + personality`。有身份，由 `pencil/<agent-id>` 标识 | ❌ PencilAgent ≠ nanoPencil 项目 |
| **Pencil-Agent-Gateway** | HTTP 中间件项目 / 仓库 / 服务名 | 旧称 `pencil-gateway` 已废弃 |
| **Asgard Platform** | 多 Agent 平台项目（含 Asgard-api + Asgard-web） | "asgard" / "Asgard" 同义 |
| **nanopencil-editor** | 写作客户端项目 / 仓库 | 别名 "editor" |
| **Pencil-Eidolon** | 浏览器分身插件（Eidolon = 分身/幻像） | Chrome/Edge MV3 |
| **O-Mesh** | 多 Agent 编排引擎 | Orchestrator + Blackboard |
| **Pencil-Evaluate** | Agent 评估框架 | Python + DeepEval |

## 4.2 架构概念

| 术语 | 规范定义 |
|------|----------|
| **EngineAdapter** | Gateway 内对引擎的抽象接口，目前实现是 `NanoPencilEngineAdapter` |
| **RemoteToolTransport** | nano-pencil SDK 内的回调接口，让"调用方拥有工具运行时"模式得以工作 |
| **ToolCorrelation** | Gateway 内进程级表，关联 SSE `pencil.tool_request` 与 HTTP POST `tool_response` |
| **Soul** | 引擎内的人格描述模块（`@pencil-agent/soul-core`）；包含 system prompt、风格 tag、行为默认值 |
| **NanoMem** | 持久记忆引擎（`@pencil-agent/mem-core`）；跨会话记忆沉淀与检索 |
| **PENCILS_HOME** | 文件系统约定根：`~/.pencils/`（环境变量 `PENCILS_HOME` 可覆盖）。每个 PencilAgent 一个 `agents/<id>/` 槽位 |
| **PAAS** | Pencil as a Service — 以"数字生命"为核心的 Agent 基础设施服务化模式 |

## 4.3 协议

| 术语 | 规范定义 |
|------|----------|
| **ACP** | Agent Coding Protocol — 进程间协议，editor / IDE 与 nano-pencil CLI 子进程之间使用 |
| **PCP** | Pencil Client Protocol — editor 与 Rust Server 之间的 WebSocket 内部协议（阶段二原型） |
| **OpenAI 兼容 API** | Gateway 对外协议族：`/v1/chat/completions` + `/v1/models` + `/v1/agents` + SSE |
| **Pencil Tool Callback** | A 线工具回传 — Gateway → caller 走 SSE，caller → Gateway 走 HTTP POST |
| **Channel 协议** | 第三方 IM 适配 — 钉钉 Stream / WeChat XML / Feishu 事件 → Gateway |
| **Blackboard** | O-Mesh 提供的横向通信机制，KV + pub/sub 模式 |

## 4.4 层级术语

| 术语 | 含义 |
|------|------|
| **本体层 (Ontology)** | nanoPencil — Agent 引擎核心 |
| **网关层 (Gateway)** | Pencil-Agent-Gateway — HTTP 服务化 |
| **编排层 (Orchestration)** | O-Mesh — 多 Agent 协作调度 |
| **评估层 (Evaluation)** | Pencil-Evaluate — 能力度量 |
| **平台层 (Platform)** | Asgard-platform — 用户入口 |
| **表现层 (Expression)** | Editor / Game / Lesson — 场景化应用 |
| **渗透层 (Infiltration)** | Pencil-Eidolon — 浏览器分身 |
| **具身层 (Embodiment)** | Pencil-Terminal — 物理世界操作 |

## 4.5 废弃术语

| 术语 | 状态 | 替代 |
|------|------|------|
| `pencil-gateway` | ❌ 废弃 | Pencil-Agent-Gateway |
| `nano-pencil`（指项目名） | ⚠️ 易混 | nano-pencil 仅指 npm 包名，项目名用 nanoPencil |
