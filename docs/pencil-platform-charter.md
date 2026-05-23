# Pencil 生态平台 Charter — 唯一发展路线源头

> **状态**：active（2026-05-21 创建）
> **角色**：本文档是 Pencil 生态四项目的**单一发展路线源头**。所有跨项目级别的事实（拓扑、术语、阶段、决策、里程碑）以本文为准；各项目仓库内仅保留与自身实施相关的细节文档，并显式指回本 charter。
> **宿主**：nanoPencil 仓库。理由——nano-pencil 是引擎核心，上层 Gateway / Asgard / editor 都是它的应用层；charter 放在核心层是最稳的源头。
> **修改流程**：任何对 §2–§8 的修改必须通过 nanoPencil 仓库 PR；上层应用文档发现 charter 失同步时，应在 issue/PR 中引用 charter 路径 + 行号，由 charter 维护者更新。

---

## DIP Metadata

```text
[WHO]  Pencil 生态四项目（nanoPencil / Pencil-Agent-Gateway / Asgard Platform / nanopencil-editor）的维护者，以及在任一仓库工作的 AI coding agent
[FROM] 此前散落在三仓的生态级内容：editor pencil-platform-roadmap §生态全景/术语/阶段，Gateway docs/00 + docs/06，nanoPencil multi-agent-fs §0.4
[TO]   各项目内的实施文档：editor 三模 / Gateway 协议契约 / Asgard 平台 backend / nano-pencil 引擎扩展
[HERE] nanoPencil/docs/pencil-platform-charter.md — 跨项目拓扑、术语、阶段、决策、里程碑的唯一源头
```

---

## 0. 阅读地图

| 章节 | 回答什么 |
|---|---|
| §1 这份文档是什么 | 为什么存在；不在范围内的是什么 |
| §2 生态全景 | 4 个项目长什么样、互相怎么连 |
| §3 项目职责边界 | 谁该做什么、谁不该做什么 |
| §4 术语表 | nanoPencil / nano-pencil / PencilAgent / Pencil / Gateway 等术语的规范定义 |
| §5 协议策略 | HTTP / WebSocket / ACP 各自定位 |
| §6 阶段历史与状态 | 阶段一→二→三→3.5→四 的进展 |
| §7 跨项目里程碑追踪 | 当前活跃工作线（A 工具回传 / B 计费 / C 容器 / D 配置 / E Channel / F Rust）的进度表 |
| §8 跨项目决策记录 | 影响多于一个仓库的重大决策（§16 工具回传五决策等） |
| §9 各仓实施文档指针 | charter 不重复实施细节，但提供跳转 |
| §10 charter 维护规则 | 如何修改、如何防止再次出现重复 |

---

## 1. 这份文档是什么

### 1.1 解决的问题

在 charter 之前，三个仓库各自维护一份"4 项目拓扑 / 术语 / 阶段状态"的描述：

- editor `pencil-platform-roadmap.md` §生态全景 + §术语约定 + §阶段一~四
- Gateway `docs/00-product-boundary.md` §4 四层生态边界 + `docs/06-glossary.md`
- nanoPencil `docs/multi-agent-fs-design.md` §0.4 分工总览

这种"三处各写一份"在阶段三/3.5 已经出现过状态不一致（阶段三 editor 标"当前→近期"时 Gateway 实际已完成）。继续下去成本只升不降。

Charter 把这些**生态级事实**收口到一个文件，让任何参与者（人或 AI）在任一仓只需读两个东西就能进入工作：

1. 本 charter（生态级）
2. 当前仓的项目内 README / AGENTS.md（项目级）

### 1.2 不在范围内

Charter **不承载**以下内容（这些留在各项目仓内）：

- API 契约细节（Gateway docs/02）
- 协议线格式（Gateway docs/18）
- 内部架构（Gateway docs/03、editor RoutedChatProvider 结构）
- 实施任务书（Gateway docs/16 行动手册、editor remote-http-design）
- 内部业务术语（editor 的 Track、Gateway 的 EngineAdapter / ToolCorrelation）

判断方法：**一个事实只在一个项目内有意义 → 不进 charter；同时影响 ≥ 2 个项目 → 进 charter**。

---

## 2. 生态全景

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                              Pencil 生态（4 项目）                                  │
│                                                                                  │
│  ┌──────────────┐   ┌──────────────────┐   ┌──────────────┐   ┌────────────────┐│
│  │  nanoPencil  │   │ Pencil-Agent-    │   │   Asgard     │   │  nanopencil    ││
│  │              │   │   Gateway        │   │   Platform   │   │   -editor      ││
│  │  引擎核心     │   │   HTTP 中间件     │   │   多 Agent    │   │   写作客户端    ││
│  │              │   │                  │   │   平台         │   │                ││
│  │ · 模型对话    │   │ · OpenAI 兼容 API│   │ · 用户/计费   │   │ · Desktop App  ││
│  │ · 记忆系统    │   │ · API Key 鉴权   │   │ · Marketplace │   │ · 三模路由      ││
│  │ · 工具循环    │   │ · SSE 流式       │   │ · PencilAgent │   │   (ACP/PCP/HTTP)││
│  │ · 多模型      │   │ · 多 PencilAgent │   │   backend     │   │ · 富文本编辑    ││
│  │ · Soul 进化   │   │   实例托管        │   │ · Console     │   │ · 工作区管理    ││
│  │ · MCP 集成    │   │ · Channel 子模块  │   │ · 容器编排    │   │                ││
│  │              │   │   (钉钉/微信/飞书)│   │              │   │                ││
│  │ 暴露:         │   │                  │   │ 集成:         │   │ 接入:           ││
│  │ · SDK         │   │ 集成 nano-pencil │   │ · 启 Gateway  │   │ · 本地 ACP     ││
│  │   @pencil-    │   │   SDK            │   │   容器        │   │ · 远程 HTTP    ││
│  │   agent/     │   │ · EngineAdapter  │   │ · HTTP 路由   │   │   (经 Asgard   ││
│  │   nano-pencil│   │   抽象            │   │ · 用量回写    │   │   或直连       ││
│  │ · ACP CLI    │   │                  │   │              │   │   Gateway)     ││
│  │              │   │                  │   │              │   │                ││
│  │ 仓库:         │   │ 仓库:             │   │ 仓库:         │   │ 仓库:           ││
│  │ /workspace/  │   │ /workspace/      │   │ /workspace/  │   │ /workspace/    ││
│  │ nanoPencil   │   │ Pencil-Agent-    │   │ Asgard-      │   │ nanopencil-    ││
│  │              │   │   Gateway        │   │ platform     │   │ editor         ││
│  │              │   │                  │   │ (子模块:      │   │                ││
│  │              │   │                  │   │  Asgard-api   │   │                ││
│  │              │   │                  │   │  Asgard-web)  │   │                ││
│  │              │   │                  │   │              │   │                ││
│  │ 技术栈:       │   │ 技术栈:           │   │ 技术栈:       │   │ 技术栈:         ││
│  │ Node.js + TS │   │ Node.js + Hono   │   │ FastAPI +    │   │ Rust/Tauri +   ││
│  │ + React TUI  │   │                  │   │ React        │   │ React/TS       ││
│  └──────────────┘   └──────────────────┘   └──────────────┘   └────────────────┘│
│                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### 2.1 调用链拓扑

```
                                              ┌─────────────────────────────────┐
   nanoPencil CLI (本地)  ─── ACP ───────────►│    nano-pencil 引擎 (in-proc)    │
                                              └─────────────────────────────────┘

   nanopencil-editor (本地 ACP 模式)  ── ACP ──►  nano-pencil CLI 子进程

   nanopencil-editor (Remote HTTP 模式)  ┐
                                          │
   nanoPencil CLI (远程模式)              ├── HTTP+SSE + API Key ──► Pencil-Agent-Gateway
                                          │                          │
   第三方 OpenAI 客户端                    ┘                          ▼
                                                              ┌─────────────────────┐
                                                              │ PencilAgent 实例    │
                                                              │  = nano-pencil      │
                                                              │  + Soul + Memory    │
                                                              │  + Model + Personal.│
                                                              └─────────────────────┘
                                                              (Gateway 进程内多实例)

   Asgard 用户  ──── HTTP ──►  Asgard Platform  ── HTTP 代理 ──►  Pencil-Agent-Gateway
                                  │
                                  └── 创建 PencilAgent / 用量回写 / 计费

   钉钉 / 微信 / 飞书事件  ──► Pencil-Agent-Gateway 内 Channel 子模块  ──► PencilAgent
                                  (阶段 3.5 落地；长期将拆为 pencil-channel-gateway)
```

---

## 3. 项目职责边界

| 项目 | 是什么 | 不是什么 |
|---|---|---|
| **nanoPencil** | Agent 引擎本体；提供模型对话、工具循环、记忆系统、Soul 进化、MCP 集成；以 `@pencil-agent/nano-pencil` SDK 形式被嵌入，或作为 `nanopencil` CLI 直接运行；暴露 ACP 协议供宿主接入 | 不暴露 HTTP API；不管 API Key / 多租户 / 计费；不是"一个 Agent"——它是"造 Agent 的引擎" |
| **Pencil-Agent-Gateway** | HTTP serving 层；托管多个 PencilAgent 实例；OpenAI 兼容 API + SSE；EngineAdapter 抽象使引擎可替换；通过 PENCILS_HOME 隔离多 Pencil；可独立部署也可被 Asgard 容器编排 | 不是引擎本体（import nano-pencil）；不管用户系统、计费、Marketplace（那是 Asgard）；不直接服务终端用户的写作 UI（那是 editor） |
| **Asgard Platform** | 多 Agent 管理平台；用户系统、API Key 管理、PencilAgent CRUD、用量记录、计费策略、Marketplace；通过 HTTP 代理到 Gateway，不 import Gateway 代码 | 不实现 Agent 引擎；不实现 HTTP serving 协议；不直接管容器进程（编排是阶段四 C 线） |
| **nanopencil-editor** | 写作客户端；Desktop App + Web IDE；三模路由（本地 ACP / 内部 WS / 远程 HTTP）；富文本编辑 + 工作区管理 + Spark Design | 不构建 Agent 实例管理；不实现 HTTP server；不复刻 Asgard 的 PencilAgent 创建 UI |

### 3.1 仓库 / 技术栈速查

| 项目 | 仓库 | 技术栈 | 发布形态 |
|---|---|---|---|
| nanoPencil | `/workspace/nanoPencil`（O-Pencil/nanoPencil） | Node.js + TypeScript | npm: `@pencil-agent/nano-pencil`；二进制：`nanopencil` CLI |
| Pencil-Agent-Gateway | `/workspace/Pencil-Agent-Gateway`（O-Pencil/Pencil-Agent-Gateway） | Node.js + Hono | Docker 镜像；生产部署绑 127.0.0.1 + nginx 反代 |
| Asgard Platform | `/workspace/Asgard-platform`（含子模块 `Asgard-api` / `Asgard-web`） | FastAPI + React | Docker compose；render.yaml 部署 |
| nanopencil-editor | `/workspace/nanopencil-editor`（O-Pencil/nanopencil-editor） | Rust + Tauri + React/TS | Tauri Desktop bundle（NSIS/MSI）；Web build |

---

## 4. 术语表

> 本表是 Pencil 生态的**规范术语**。各仓内部文档遇到这些词时必须使用本表的定义；任何修改/扩展须更新本表。

| 术语 | 规范定义 | 反例 / 易混点 |
|---|---|---|
| **nanoPencil** | 引擎项目，仓库名（大驼峰）。包含 `@pencil-agent/nano-pencil` SDK + `nanopencil` CLI | ❌ 不要把 nanoPencil 当作"一个 Agent" — 它是引擎，不是有身份的实例 |
| **nano-pencil** | npm 包名（短横线）`@pencil-agent/nano-pencil`，从 nanoPencil 仓库发布的引擎 SDK | 文中谈"被 Gateway import 的那个 SDK"指本词 |
| **PencilAgent** | 配置好的运行单元：`nano-pencil engine + Soul + memory + model + personality`。**有身份**，由 `pencil/<agent-id>` 标识，托管在 Gateway 内 | ❌ PencilAgent ≠ nanoPencil 项目；同一份引擎可以同时托管多个 PencilAgent，每个有独立 Soul/memory/model |
| **Pencil** | 通称 Agent 能力，"调用 Pencil" = "调用某个 PencilAgent"。不是单独项目 | 商业文案缩写可用；技术文档优先用 PencilAgent 精确名 |
| **Pencil-Agent-Gateway** | HTTP 中间件项目 / 仓库 / 服务名 | 旧称 `pencil-gateway` 已废弃 |
| **Pencil Agent Gateway** | 上者的人类可读形式（带空格） | 同一物，写作时按文档语境二选一即可 |
| **Asgard Platform** | 多 Agent 平台项目（含 `Asgard-api` FastAPI 后端 + `Asgard-web` React 前端） | "asgard" / "Asgard" 同义 |
| **nanopencil-editor** | 写作客户端项目 / 仓库 | 别名 "editor" 在 charter 上下文清晰 |
| **EngineAdapter** | Gateway 内对引擎的抽象接口，目前实现是 `NanoPencilEngineAdapter`；未来可接其他引擎 | Gateway-internal 概念；nanoPencil 侧不需要知道 |
| **RemoteToolTransport** | nano-pencil SDK 内的回调接口，让"调用方拥有工具运行时"模式得以工作。详见 nanoPencil/docs/remote-tool-register-design.md | A 线 v0.2 的核心引擎侧抽象 |
| **ToolCorrelation** | Gateway 内进程级表，关联 SSE `pencil.tool_request` 与 HTTP POST `tool_response`。Gateway-internal | 不要跟 nano-pencil 侧的 pendingTools 混淆——两者各管一段 |
| **Soul** | 引擎内的人格描述模块（来自 `@pencil-agent/soul-core`）；包含 system prompt 描述、风格 tag、行为默认值 | PencilAgent 定义里的 Soul 字段就来自此 |
| **PENCILS_HOME** | 文件系统约定根：`~/.pencils/`（环境变量 `PENCILS_HOME` 可覆盖）。每个 PencilAgent 一个 `agents/<id>/` 槽位 | 详见 nanoPencil/docs/multi-agent-fs-design.md |
| **PCP (Pencil Client Protocol)** | editor 与 Rust Server 之间的 WebSocket 内部协议（阶段二原型）。**不是**对外生态协议 | 阶段三起对外主线协议是 HTTP+SSE；PCP 仅 editor 内部模式继续维护 |
| **ACP (Agent Coding Protocol)** | 进程间协议，editor / IDE 与 nano-pencil CLI 子进程之间使用 | nano-pencil CLI `--acp` 启动模式 |
| **OpenAI 兼容 API** | Gateway 对外协议族：`/v1/chat/completions` + `/v1/models` + `/v1/agents` 等 + SSE 流式 | 详见 Pencil-Agent-Gateway/docs/02-api-contract.md |

---

## 5. 协议策略

| 协议 | 定位 | 适用场景 | 权威文档 |
|---|---|---|---|
| **HTTP + SSE（OpenAI 兼容）** | **主线协议** — Gateway 唯一对外 API；Asgard 也以此协议对外 | 所有外部客户端、第三方集成；editor Remote HTTP 模式 | Pencil-Agent-Gateway docs/02 |
| **ACP** | 本地直连 — Agent 引擎与宿主进程通信 | editor 本地模式；nanoPencil CLI；IDE 插件 | nanoPencil 项目 ACP mode 实现 |
| **PCP (WebSocket)** | 仅 editor 内部使用 — Rust Server / Desktop PCP 模式 | editor 内部维护，不对外推广 | nanopencil-editor docs/.../pencil-client-protocol.md |
| **Pencil Tool Callback (v0.2)** | A 线工具回传 — Gateway → caller 走 SSE，caller → Gateway 走 HTTP POST | editor Remote HTTP 模式调用本机工具 | Pencil-Agent-Gateway docs/18 + nanoPencil docs/remote-tool-register-design.md |
| **Channel 协议** | 第三方 IM 适配 — 钉钉 Stream / WeChat XML / Feishu 事件 → Gateway HTTP | Gateway 内 channels/ + relays/ 子模块（孵化中） | Pencil-Agent-Gateway docs/13 |

**原则**：对外只暴露 OpenAI 兼容 HTTP，降低所有接入方门槛；内部协议（ACP / PCP / Channel）各自服务特定通路，不互相侵入。

---

## 6. 阶段历史与状态

### 6.1 阶段总览

| 阶段 | 主题 | 主要项目 | 状态 |
|---|---|---|---|
| 一 | 本地 ACP 接入 | editor + nano-pencil | ✅ 已完成 |
| 二 | Agent 服务化原型验证（Rust PCP Server） | editor 母仓 + nano-pencil | ✅ 已完成（原型留作参考，不再扩展） |
| 三 | Gateway 独立 + Asgard 集成 + editor 三模 | 4 项目全部 | ✅ 已完成（2026-05） |
| 3.5 | Channel 阶段一 + Multi-Pencil 隔离 | Gateway + 运维脚本 | ✅ 已完成（2026-05） |
| 四 | 平台化与多租户 | Gateway + Asgard + editor + nano-pencil | 🟡 **当前位置**：A 线进行中 |

### 6.2 阶段详述

#### 阶段一：本地 ACP 接入 ✅
- editor 引入 `agent-client-protocol` crate，实现 ACP Client
- 接入 `nano-pencil --acp` 作为外部 Agent
- 前端事件模型适配，流式渲染、工具调用、权限确认、取消等核心流程可用

#### 阶段二：Rust 原型验证 ✅
- 定义 PCP v1（WebSocket 内部协议）
- editor 母仓构建 `src/apps/server/` Rust 原型
- editor Desktop 双模切换（本地 ACP / 服务 PCP）
- 关键判断：原型证明"Agent 在服务端、工具在客户端"架构可行，但**不会作为生态主线服务延续**——生态主线交给 Pencil-Agent-Gateway（Node.js + Hono）

#### 阶段三：Gateway 独立 + Asgard 集成 + editor 三模 ✅
- **Gateway**：独立仓库 `/workspace/Pencil-Agent-Gateway`，v0.1 API 全集（chat/completions + models + agents CRUD + healthz/readyz），Docker 镜像，生产部署 + nginx 反代，Multi-Pencil 隔离（PENCILS_HOME + agentDir + agent.json），SAFETY_GUARDRAIL
- **Asgard**：`PencilAgentBackend` service，PencilAgent CRUD + Gateway sync + usage logging，SINGLE_USER_MODE JWT+APIKey 双重鉴权
- **editor**：`HttpChatProvider` 落地，`RoutedChatProvider` 升三模（local/service/remote-http），Remote HTTP 配置 UI
- **nano-pencil**：以 `@pencil-agent/nano-pencil` SDK 形态被 Gateway import；CLI ACP 模式继续服务 editor 本地模式

#### 阶段 3.5：Channel 阶段一 + Multi-Pencil 隔离 ✅
- Gateway 内孵化 Channel 适配器（钉钉 Stream / WeChat XML / Feishu 事件）+ REQ-001 主动外发
- Multi-Pencil 架构：`~/.pencils/<id>/` 独立目录（memory / soul / auth / models / settings）；启动脚本 `start-pencil.sh <id> --with-channels`
- 边界声明：Channel 长期归属独立仓库 `pencil-channel-gateway`，目前在 Gateway 内孵化便于将来整体迁出

#### 阶段四：平台化与多租户 🟡 当前
六条候选工作线（A–F），见 §7 跨项目里程碑追踪。

---

## 7. 跨项目里程碑追踪

阶段四并非单一线性流程，而是多条独立的工作线。当前状态：

| 线 | 主题 | 状态 | 主要参与方 |
|---|---|---|---|
| **A** | 工具回传协议（Gateway v0.2） | 🟡 进行中 | Gateway + nanoPencil + editor |
| **B** | 计费与用量闭环 | ⚪ 未启 | Asgard 主导 |
| **C** | 容器隔离与编排（每 Agent 独立容器） | ⚪ 未启 | Asgard + 运维 |
| **D** | Soul/Memory 配置中心 UI | ⚪ 未启 | Asgard + Gateway |
| **E** | Channel Gateway 拆仓 | ⚪ 未启（触发条件未到） | Gateway → 新仓 `pencil-channel-gateway` |
| **F** | Rust 高性能层（可选） | ⚪ 未启 | Gateway 重构 |

### 7.1 A 线：工具回传（Gateway v0.2）

**目标**：消除 editor Remote HTTP 模式的能力断层——让远程 PencilAgent 能像本地 ACP 一样调用 editor 本机的 `read_file` / `write_file` / `bash` / `grep` 等工具。

**形态**：双通道。Gateway → caller 走 SSE `event: pencil.tool_request`；caller → Gateway 走 `POST /v1/agents/:agentId/sessions/:sessionId/tool_response`。WS 与长轮询方案在 §8 决策中被否决。

**协议草案（三处一致同源）**：

| 项目 | 文档 | 角色 |
|---|---|---|
| Pencil-Agent-Gateway | `docs/18-tool-callback-protocol-v0.2.md` | 线协议权威；含 §16 五决策 |
| nanoPencil | `docs/remote-tool-register-design.md` | 引擎侧 `RemoteToolTransport` SDK 接口设计 |
| nanopencil-editor | `docs/technical-proposals/remote-http-chat-provider-design.md` | editor 侧 `HttpChatProvider` 设计；P0 已落地，P1 polish 待办 |

**跨仓里程碑表**：

| 仓库 | 里程碑 | 状态 | 备注 |
|---|---|---|---|
| Pencil-Agent-Gateway | M-tools-1（线协议 + 关联表） | ✅ 已完成（commit `d52589b`，2026-05-21） | MockEngineAdapter 驱动端到端 SSE+POST 回路；211 测试全绿 |
| nanoPencil | N-tools-1（类型 + RemoteToolSource 骨架） | ⏳ 待启动 | 依赖 §8.2 五个开放问题敲定 |
| nanoPencil | N-tools-2（SDK `remoteTools` 接入） | ⏳ 待启动 | 依赖 N-tools-1 |
| nanoPencil | N-tools-3（真实 agent-loop e2e） | ⏳ 待启动 | 依赖 N-tools-2 |
| Pencil-Agent-Gateway | M-tools-2（`NanoPencilEngineAdapter` 绑定） | ⏳ 待启动 | **跨仓阻塞**：依赖 N-tools-2 完成 SDK option |
| Pencil-Agent-Gateway | M-tools-3（lifecycle / 错误码硬化） | ⏳ 待启动 | 依赖 M-tools-2 |
| nanopencil-editor | P1 polish（auth/agent-not-visible UI + session_id 文档身份） | ⏳ 待 Gateway 协议稳定 | 设计文档 §12 已列任务清单 |
| nanopencil-editor | 本机工具注册表 + SSE `pencil.tool_request` 处理 | ⏳ 待启动 | 依赖 M-tools-3；可复用现有 ACP 模式工具运行时 |

**关键交接面**（拆解阻塞用）：
- Gateway `EngineEvent.tool_request` ↔ nano-pencil `RemoteToolInvocation`（结构同构，字段名对齐）
- Gateway `EngineAdapter.provideToolResponse()` ↔ nano-pencil `RemoteToolTransport.invoke()` 返回的 Promise
- editor `HttpChatProvider` 解析 SSE `pencil.tool_request` ↔ Gateway `serializeToolRequestEvent()` 输出

### 7.2 B 线：计费与用量闭环（待启）

**目标**：把 Asgard 已有的 `usage_logging` 雏形扩展为完整闭环——Token 计量、配额、计费策略、用量回查 UI。
**主导**：Asgard，本项目和 nanoPencil 不参与。
**前置文档**：editor `docs/technical-proposals/platform-budget-api.md`（消费方需求）。
**触发条件**：A 线 M-tools-2 完成后，B 线即可并行启动（两线无依赖）。

### 7.3 C–F 线（占位）

均未启动；触发条件与初步范围见 editor `pencil-platform-roadmap.md`（应用层路线版本，将精简为 editor 视角的执行步骤）。

---

## 8. 跨项目决策记录

### 8.1 §16 — A 线工具回传协议五决策（2026-05-20）

| # | 问题 | 决策 | 理由 |
|---|---|---|---|
| 1 | 并行工具调用？ | **否，串行**。同一 (agentId, sessionId) 同时只允许一个 pending tool call | editor 侧工具运行时（FS 锁、bash 进程）串行心智更稳；并行延迟到 v0.2.x |
| 2 | Caller heartbeat？ | **否**。caller 设置足够 timeout_ms，Gateway 守时 | 第三种状态消息增加无谓复杂度 |
| 3 | Asgard 代理 `tool_response`？ | **是**。editor → Asgard → Gateway（两个通道都经 Asgard） | 单一审计链 + 单一 key 边界 |
| 4 | `arguments` 也封 256 KiB？ | **是，对称**。`tool_payload_too_large` 错误码同时覆盖 inbound output 和 outbound arguments | 防止单边滥用 |
| 5 | session 失效是否显式事件？ | **是**。新增 SSE `event: pencil.session_lost`，followed by `[DONE]`；后续 POST 返回 410 | 让 editor UI 能区分"网断"和"服务端清掉 session" |

**权威源**：Pencil-Agent-Gateway docs/18 §16。本表是简版，详细 rationale 在源文档。

### 8.2 nanoPencil N-tools-1 待决问题

启动 N-tools-1 之前需要敲定（见 nanoPencil `docs/remote-tool-register-design.md` §9）：

| # | 问题 | 默认倾向 |
|---|---|---|
| Q-1 | `RemoteToolSource` 源码位置：`core/tools/` vs `packages/agent-core/`？ | `core/tools/`（与其他 ToolSource impl 同处） |
| Q-2 | 远程工具是否走 extension `tool_call` hook？ | 是（它们是普通 AgentTool） |
| Q-3 | Gateway-side `pendingTools` 注册表位置？ | 放在 `NanoPencilEngineAdapter` 内，与 `ToolCorrelation` 分离 |
| Q-4 | `invoke()` 是否携带 schema 化参数？ | 否，传 `Record<string, unknown>`，保持 transport 干净 |
| Q-5 | Soul 是否对远程工具 evolve？ | 是，远程工具与本地工具同等处理 |

待用户拍板后写回 nanoPencil 设计文档 §9，并作为新决策追加到本 charter §8。

### 8.3 阶段三结束时的关键判断（历史记录）

- Rust `src/apps/server/` 原型不作为生态主线服务延续；生态主线服务交给 Pencil-Agent-Gateway（Node.js + Hono）
- 对外主线协议是 OpenAI 兼容 HTTP + SSE + API Key，不再是 PCP WebSocket
- `packages/pencil-client-sdk/` 降级为 editor PCP 模式内部依赖，不作为外部接入主线

---

## 9. 各仓实施文档指针

Charter 不复制实施细节，但提供跳转。当某项 charter 章节标 "见 XYZ"，去 XYZ 找细节。

### 9.1 nanoPencil（本仓）

| 主题 | 文档 |
|---|---|
| 多 Pencil 文件系统设计 | `docs/multi-agent-fs-design.md` |
| 远程工具回传 SDK 接口 | `docs/remote-tool-register-design.md`（A 线 N-tools-1 前置） |
| 引擎内 Agent 三形态 | `docs/multi-agent-fs-design.md` §10.3（SuperAgent / Derived / Custom） |
| 维护者手册 | `docs/maintainer-handbook`（散见 dev-docs） |

### 9.2 Pencil-Agent-Gateway

| 主题 | 文档 |
|---|---|
| 产品边界 / 双部署形态 | `docs/00-product-boundary.md` |
| 开发计划 / 里程碑 / 版本切分 | `docs/01-development-plan.md` |
| OpenAI 兼容 API 契约 | `docs/02-api-contract.md` |
| EngineAdapter / 存储 / 路径安全 | `docs/03-adapter-architecture.md` |
| Asgard / editor 集成 | `docs/04-asgard-editor-integration.md` + `docs/10-editor-integration-guide.md` |
| Multi-Pencil 行动手册 | `docs/16-pencils-storage-layout.md` |
| Channel 集成 | `docs/13-channel-integration.md` + `docs/14-multi-pencil-architecture.md` |
| **工具回传协议 v0.2** | `docs/18-tool-callback-protocol-v0.2.md`（A 线权威协议） |

### 9.3 Asgard Platform

| 主题 | 文档 |
|---|---|
| 平台概述 | `Asgard-platform/README.md` |
| 后端架构审查 | `Asgard-api/ARCHITECTURE_REVIEW.md` |
| 后端开发计划 | `Asgard-api/DEVELOPMENT_PLAN.md` |
| 前端 PRD | `Asgard-web/PRD.md` |

### 9.4 nanopencil-editor

| 主题 | 文档 |
|---|---|
| 应用层路线（editor 视角） | `docs/technical-proposals/pencil-platform-roadmap.md` |
| Remote HTTP Provider 设计 | `docs/technical-proposals/remote-http-chat-provider-design.md` |
| 多 Agent 编排 seam | `docs/technical-proposals/writing-agent-orchestration-seams.md` |
| 平台预算 API 需求 | `docs/technical-proposals/platform-budget-api.md` |
| PCP 内部协议（legacy） | `docs/technical-proposals/pencil-client-protocol.md` |

---

## 10. Charter 维护规则

### 10.1 修改流程

1. 任何对 §2–§8 的修改都是**跨仓影响**的修改，必须通过 nanoPencil 仓库 PR 进行
2. PR 描述应明确：(a) 改动哪个章节、(b) 触发的应用仓更新（editor / Gateway / Asgard 内的对应文档须同步更新指针）
3. 合并 charter 后，由 PR 作者发起 3 个应用仓的"指针同步" PR（如有需要）；其它仓的 maintainer 不允许在没看过 charter PR 的情况下合并指针 PR

### 10.2 防止重复

各应用仓文档遇到以下内容时，**只放短摘要 + charter 链接**，禁止全文重复：

- 4 项目拓扑 / 调用链拓扑
- 术语定义（PencilAgent / nano-pencil / Pencil 等通用术语）
- 阶段一/二/三/3.5/四的总体描述
- 跨仓里程碑（A/B/C 线进度）
- 跨项目决策（§16 等）

各应用仓**可以、应该**有的内容：

- 本项目内部架构（模块、类、文件路径）
- 本项目 API 契约 / 协议线格式（即使影响其它仓，权威定义在产生协议的仓内）
- 本项目实施计划（任务拆分、估算、PR 序列）
- 本项目内部业务术语（Track / EngineAdapter / RoutedChatProvider 等）

### 10.3 同步检测

charter 与各仓应保持**单点真理**。检测漂移的实用方法：

- 在本仓 PR 中如果改动 §2–§4 / §7–§8，CI（暂未自动化）应提示作者检查三个应用仓的对应章节是否需要更新
- 各应用仓 PR 审阅时，如果发现要改动"理论上属于 charter 的内容"，先去 charter PR，回头再做应用仓 PR

### 10.4 旧文档归档

阶段一/阶段二的旧任务书已归档（editor `acp-integration-tasks.md` 等），charter 不重述。当历史决策被 charter 取代时，旧文档保留为历史记录，文件头加 `status: superseded-by-charter §X`。

---

## Appendix A：本 charter 收编了哪些内容

为审计与回滚便利，记录本 charter 创建时吸收的源材料：

| 源材料 | 取的部分 | 处理动作 |
|---|---|---|
| editor `pencil-platform-roadmap.md` §生态全景 | 4 项目拓扑图 | 提升至 charter §2，源文档将改为指针 + editor 自身路线 |
| editor `pencil-platform-roadmap.md` §术语约定 | Pencil 即服务 / Provider / Track 等 | 通用术语提至 charter §4；editor-only 术语（Provider/Track）留在 editor 文档 |
| editor `pencil-platform-roadmap.md` §阶段一~四 | 阶段叙事 | 提至 charter §6.2 + §7；editor 文档保留 editor-side milestone narrative |
| Gateway `docs/00-product-boundary.md` §1-§4 | 核心定义、四层生态边界 | 边界表提至 charter §3；源文档将保留 Gateway-specific 非目标 |
| Gateway `docs/06-glossary.md` §2-§4 | PencilAgent 定义、Caller/Hosted 拓扑 | 提至 charter §4；源文档将瘦身为 Gateway-internal 术语 |
| nanoPencil `docs/multi-agent-fs-design.md` §0.4 | 4 项目分工总览 | 提至 charter §6 / §7；源文档将精简为指针 |

---

**Covenant**：本文档是生态级单一源头。维护 charter ↔ 各仓指针的 isomorphism，等价于维护整个生态文档系统的可信度。任何"只改某个仓不动 charter"的跨仓修改都是 DIP 违例。
