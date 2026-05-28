# §3 项目关联关系

> 项目间依赖、调用、协作的完整矩阵

<!--
[WHO]  项目间关联关系定义
[FROM] agent-projects-relations.md + PROJECT_OVERVIEW.md §七 + pencil-platform-charter.md
[TO]   各项目集成文档、架构设计
[HERE] charter/03-relations.md — 关联关系
-->

---

## 3.1 核心依赖链

```
O-Mesh (编排) → nanoPencil (执行) → Pencil-Evaluate (评估) → 反馈优化
Pencil-Eidolon (浏览器宿主) ← nanoPencil (本地 Kernel) / Gateway (云端 API)
```

## 3.2 关联矩阵

| 源项目 | 目标项目 | 关系类型 | 说明 |
|--------|----------|----------|------|
| Asgard-platform | Pencil-Agent-Gateway | 服务消费 | 通过 OpenAI Compatible API 调用 |
| Asgard-platform | nanoPencil | 实例管理 | 配置和管理多个 PencilAgent 实例 |
| nanoPencil | Pencil-Agent-Gateway | SDK 嵌入 | `@pencil-agent/nano-pencil` 被 Gateway import |
| nanoPencil | O-Mesh | 被编排节点 | 作为 Agent 节点被 O-Mesh 调度 |
| nanoPencil | Pencil-Evaluate | 被评估对象 | Agent 能力量化评估 |
| nanoPencil | Pencil-Terminal | 具身协同 | Terminal 提供物理世界操作能力 |
| O-Mesh | Pencil-Agent-Gateway | 任务分发 | 复杂任务分解后通过网关分发 |
| Pencil-Evaluate | nanoPencil | 反馈优化 | 评估结果驱动本体进化 |
| Pencil-Eidolon | nanoPencil | 本地 Kernel 消费 | Native Messaging / ACP 调用 |
| Pencil-Eidolon | Pencil-Agent-Gateway | 云端 API 消费 | OpenAI 兼容接口调用 |
| Pencil-Eidolon | Pencil-Terminal | 能力互补 | 浏览器 DOM + 本地 Shell 构成完整具身 |
| Pencil-Eidolon | Pencil-Evaluate | 行为采样 | 浏览器场景中的 Agent 表现评估 |
| nanopencil-editor | nanoPencil | ACP 调用 | 本地模式通过 ACP 直连 CLI |
| nanopencil-editor | Pencil-Agent-Gateway | HTTP 调用 | 远程模式通过 OpenAI API |
| Pencil-Game | nanoPencil / Gateway | Agent 接入 | 游戏中的 AI 角色通过 Gateway 调用 |
| Pencil-Lesson | nanoPencil / Gateway | Agent 接入 | 学习场景中的 AI 辅导 |

## 3.3 关联关系图

```mermaid
graph TB
    subgraph 本体层
        NANO[nanoPencil<br/>Agent Kernel<br/>记忆+个性+工具编排]
    end

    subgraph 网关层
        GW[Pencil-Agent-Gateway<br/>HTTP 中间件<br/>多 PencilAgent 托管]
    end

    subgraph 编排层
        OM[O-Mesh<br/>多 Agent 编排<br/>Blackboard 横向通信]
    end

    subgraph 平台层
        ASG[Asgard-platform<br/>用户平台<br/>Marketplace + Console]
    end

    subgraph 表现层
        ED[nanopencil-editor<br/>AI 写作编辑器]
        GAME[Pencil-Game<br/>社会博弈]
        LESSON[Pencil-Lesson<br/>知识习得]
    end

    subgraph 渗透层
        EID[Pencil-Eidolon<br/>浏览器分身<br/>页面感知+DOM 操作]
    end

    subgraph 具身层
        TERM[Pencil-Terminal<br/>文件/Git/Shell]
    end

    subgraph 评估层
        EVAL[Pencil-Evaluate<br/>Agent 评估框架]
    end

    %% 核心关系
    NANO -->|SDK 嵌入| GW
    NANO -->|被编排调度| OM
    NANO -->|本地 Kernel| EID
    NANO -->|被评估对象| EVAL
    NANO <-->|具身协同| TERM

    GW -->|HTTP 代理| ASG
    GW -->|云端 API| EID
    GW -->|Remote HTTP| ED

    ED -->|本地 ACP| NANO

    EVAL -.->|反馈优化| NANO
    EVAL -.->|行为采样| EID

    ASG -->|PencilAgent 管理| GW

    style NANO fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    style GW fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    style EID fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
    style OM fill:#e8f5e9,stroke:#388e3c,stroke-width:2px
    style EVAL fill:#fce4ec,stroke:#c2185b,stroke-width:2px
```

## 3.4 关键协作模式

### 模式 A：单 Agent 深度任务

```
用户 → nanoPencil CLI → 编码实现 → Pencil-Evaluate 评估 → 反馈优化
```

### 模式 B：多 Agent 协作开发

```
用户 → O-Mesh Orchestrator
    ├──→ Node1 (nanoPencil): 设计数据库 Schema
    ├──→ Node2 (nanoPencil): 实现 API 接口（依赖 Node1）
    ├──→ Node3 (nanoPencil): 编写单元测试
    └──→ Node4 (nanopencil-editor): 撰写 API 文档
    ↓
Blackboard 共享 Schema 定义
    ↓
Pencil-Evaluate 评估各节点输出
```

### 模式 C：浏览器渗透交互

```
用户在任意网页打开 Eidolon Side Panel
    ↓
Eidolon 读取当前页面 DOM 上下文
    ↓
本地模式: Native Messaging → nanoPencil（记忆 + 推理）
云端模式: OpenAI 兼容 API → Gateway → PencilAgent
    ↓
返回推理结果或页面动作意图
    ↓
Eidolon 按 origin 权限执行 DOM 动作，Side Panel 反馈结果
```

### 模式 D：平台服务化

```
用户 → Asgard Marketplace → 选择/创建 PencilAgent
    ↓
Asgard → Gateway 创建实例（nano-pencil SDK + Soul + Memory）
    ↓
用户通过 Chat / Console 与 PencilAgent 对话
    ↓
Asgard 记录用量 / 计费
```

## 3.5 技术对接点

| 对接项目 | 接口/协议 | 说明 |
|---------|----------|------|
| nanoPencil ↔ Gateway | SDK import | Gateway import `@pencil-agent/nano-pencil` |
| nanoPencil ↔ O-Mesh | CLI / Stream JSON | O-Mesh Runner 调用 nanoPencil CLI |
| nanoPencil ↔ Pencil-Evaluate | Python SDK | Evaluate 调用 nanoPencil 进行测试 |
| nanoPencil ↔ Eidolon | Native Messaging / ACP | 浏览器插件调用 nanoPencil 作为本地 Brain |
| nanoPencil ↔ Browser Harness | CDP / Python CLI | 通用浏览器工具层（非 Eidolon 场景） |
| Gateway ↔ Asgard | HTTP 代理 | Asgard 通过 HTTP 路由到 Gateway |
| Gateway ↔ Editor | HTTP + SSE (OpenAI Compatible) | 远程模式标准 API |
| Gateway ↔ Eidolon | HTTP + SSE (OpenAI Compatible) | 云端模式标准 API |
| Gateway ↔ Channel | 钉钉 Stream / WeChat XML / Feishu 事件 | IM 集成 |
| 跨项目通信 | Blackboard (KV + pub/sub) | O-Mesh 提供的横向通信机制 |
