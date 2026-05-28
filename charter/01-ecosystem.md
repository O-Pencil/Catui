# §1 生态全景

> 10+ 项目的完整拓扑、架构层次、数据流

<!--
[WHO]  Pencil 生态全部项目的全景视图
[FROM] PROJECT_OVERVIEW.md + pencil-platform-charter.md §2
[TO]   02-boundaries, 03-relations, 各项目 README
[HERE] charter/01-ecosystem.md — 全景总览
-->

---

## 1.1 项目空间结构

```
D:\Projects\Pencil\
├── nanoPencil/                        # 本体心智核芯
├── Pencil-Agent-Gateway/              # PAAS 网关服务
├── O-Mesh/                            # 多 Agent 编排引擎
├── Pencil-Evaluate/                   # Agent 评估框架
├── Asgard-platform/                   # 基础设施/平台层
│   ├── packages/api (Asgard-api)      # FastAPI 后端
│   └── packages/web (Asgard-web)      # React 前端
├── nanopencil-editor/                 # 创作表现层（编辑器）
├── Pencil-Eidolon/                    # 浏览器分身（Chrome/Edge MV3 插件）
├── Pencil-Game/                       # 社会博弈表现层
├── Pencil-Lesson/                     # 知识习得表现层
├── Pencil-Terminal/                   # 具身环境/终端
├── Pencil-Playground/                 # (规划中) 在线实验场
└── Pencil-Eidolon/                    # 浏览器渗透层
```

## 1.2 Git 仓库远端

| 仓库 | GitHub 远端 | 默认分支 | 备注 |
|------|------------|---------|------|
| **nanoPencil** | `O-Pencil/nanoPencil` | `main` | remote 名为 `github` |
| **Pencil-Agent-Gateway** | `O-Pencil/Pencil-Agent-Gateway` | `main` | — |
| **O-Mesh** | `O-Pencil/O-Mesh` | `main` | — |
| **Pencil-Evaluate** | `O-Pencil/Pencil-Evaluate` | `main` | — |
| **nanopencil-editor** | `O-Pencil/nanopencil-editor` | `dev` | 默认分支为 `dev` |
| **Asgard-platform** | `O-Pencil/Asgard-platform` | `main` | 含子模块 |
| **Asgard-api** | `O-Pencil/Asgard-api` | `main` | Asgard 子模块 |
| **Asgard-web** | `O-Pencil/Asgard-web` | `main` | Asgard 子模块 |
| **Pencil-Eidolon** | `O-Pencil/Pencil-Eidolon` | `main` | Chrome/Edge MV3 |
| **Pencil-Game** | `O-Pencil/Pencil-Game` | `main` | — |
| **Pencil-Lesson** | `O-Pencil/Pencil-Lesson` | `main` | — |
| **Pencil-Terminal** | `O-Pencil/Pencil-Terminal` | `main` | 有 dependabot PR |

所有仓库统一归属于 GitHub 组织 **[O-Pencil](https://github.com/O-Pencil)**。

## 1.3 架构层次模型

```
┌─────────────────────────────────────────────────────────────────┐
│                      用户平台层 (Platform)                      │
│              Asgard-platform (用户入口/Agent市场)                │
├─────────────────────────────────────────────────────────────────┤
│                      渗透层 (Infiltration)                      │
│              Pencil-Eidolon (浏览器分身插件)                     │
├─────────────────────────────────────────────────────────────────┤
│                      表现层 (Expression)                        │
│   nanopencil-editor    Pencil-Game    Pencil-Lesson            │
│   (创作表现)            (博弈表现)      (知识习得)               │
├─────────────────────────────────────────────────────────────────┤
│                      网关层 (Gateway)                           │
│              Pencil-Agent-Gateway (HTTP + SSE)                  │
├─────────────────────────────────────────────────────────────────┤
│                      编排层 (Orchestration)                     │
│                     O-Mesh (多 Agent 编排)                      │
├─────────────────────────────────────────────────────────────────┤
│                      本体层 (Ontology)                          │
│                     nanoPencil (心智核芯)                       │
│         NanoSoul (个性) + NanoMem (记忆) + AI Core              │
├─────────────────────────────────────────────────────────────────┤
│                      具身层 (Embodiment)                        │
│              Pencil-Terminal (物理世界操作能力)                  │
├─────────────────────────────────────────────────────────────────┤
│                      评估层 (Evaluation)                        │
│              Pencil-Evaluate (全链路自省与反馈)                  │
└─────────────────────────────────────────────────────────────────┘
```

## 1.4 调用链拓扑

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

   用户浏览器任意页面  ────►  Pencil-Eidolon Side Panel
                               ├── 本地模式: Native Messaging → nanoPencil
                               └── 云端模式: OpenAI 兼容 API → Gateway

   O-Mesh Orchestrator  ────►  调度多个 nanoPencil 实例  ──►  Blackboard 横向通信

   Pencil-Evaluate  ────►  运行评估测试集  ──►  生成能力报告  ──►  反馈优化 nanoPencil
```

## 1.5 核心数据流

```
用户意图
    ↓
┌─────────────────────────────────────────────────────┐
│                  Asgard-platform                     │
│         (Agent Marketplace / Chat / Console)        │
└─────────────────────────────────────────────────────┘
    ↓
┌──────────────────────────────────────┐
│          Pencil-Eidolon              │
│     (浏览器渗透：任意网页中)          │
└──────────────────────────────────────┘
    ↓
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  表现层      │ ←→ │  网关层      │ ←→ │  第三方应用  │
│ (Editor/Game)│    │  (Gateway)  │    │             │
└─────────────┘    └─────────────┘    └─────────────┘
    ↓
┌─────────────┐
│  编排层      │ ←→ O-Mesh Orchestrator
│  (O-Mesh)   │ ←→ Blackboard 横向通信
└─────────────┘
    ↓
┌─────────────┐    ┌─────────────┐
│  本体层      │ ←→ │  具身层      │
│ (nanoPencil)│    │ (Terminal)  │
│ NanoSoul    │    │ 文件/Git/Shell│
│ NanoMem     │    └─────────────┘
└─────────────┘
    ↓
┌─────────────┐
│  评估层      │ → 反馈优化 → 本体层
│ (Evaluate)  │
└─────────────┘
```
