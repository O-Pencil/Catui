# nanoPencil 多 Agent 文件系统与协作设计（合并版 v2.1）

> **本文档是 multi-agent 文件系统设计的权威源**——目录布局、env、schema、N/G 任务序列在此。
> 生态级总览（4 项目拓扑、术语、阶段、跨项目工作线）见 [pencil-platform-charter.md](./pencil-platform-charter.md)。
>
> Gateway 侧的具体行动手册见 `Pencil-Agent-Gateway/docs/16-pencils-storage-layout.md`。

---

## 0. 文档导览

### 0.1 这份文档解决什么

nanoPencil 从"单兵 AI 助手"演进到支持**多 Agent 协作平台**的过程中，遇到三个关键问题：

1. 单 agent 的存储路径（`~/.nanopencil/agent/`）不足以容纳多个独立人格的"心智"。
2. 一旦多 Agent 上场，必须解耦"心智"（Agent 私域）与"具身"（项目共享事实），否则跨 Agent 协作会变成"传话筒"。
3. nanoPencil CLI、Pencil-Agent-Gateway、nanopencil-editor 三方需要约定**同一份目录布局**，否则同一份"韩寒 Agent"在 CLI 跑跟在 Gateway 跑会得到两套数据。

本文给出的答案是**一份目录树 + 一套 env + 一组 schema**，让 CLI / Gateway / editor / Asgard 云端读写同一个 `~/.pencils/` 根。

### 0.2 三个核心目标（user 拍板的红线）

1. **nanoPencil 已有功能不变**：单用户 CLI 工作流（`nanopencil` 直接启动、`/login`、`/model`、`/team` 等命令）一字节不动。
2. **做好 MultiAgent 管理的准备**：把所有阻塞多 agent 的硬编码点改造完，但**不强制**用户使用多 agent 模式。
3. **配合 Gateway 实现本地多 Agent 工作**：Gateway 读写的目录与 CLI 完全一致，单进程多 Agent 不再被 SDK 进程级 singleton 卡住。

### 0.3 决策摘要

| 维度 | 决策 |
|---|---|
| 根目录品牌 | **`~/.pencils/`**（env `PENCILS_HOME`；老用户 `NANOPENCIL_HOME` 作为 alias） |
| Agent 数据归属 | **方案 A**：每个 PencilAgent 一个 `agents/<id>/` 槽位，nanoPencil CLI + Gateway 共用 |
| Workspace 位置 | **Agent 之外、与 `agents/` 平级**（具身共享、心智独立） |
| Agent 元数据 | 新增 `agents/<id>/agent.json`（id slug + displayName 中文 + Asgard 联动字段） |
| 云端 Agent 包内容 | **方案 Z**：Soul 模板 + memory seed + tuned settings（即开即用） |
| 私域数据上传 | **绝不**：auth.json / sessions / user-memory 永远本地 |
| Teams 演进 | **重构成 Gateway 协作模型**——teammate 通过 HTTP 调本机 Gateway，不再 in-process spawn |
| 迁移策略 | **保守**：自动检测老路径、保留兼容、提供 `pencils migrate` 命令；不自动 rename |

### 0.4 分工总览：nanoPencil vs Gateway

> 这是本文的核心行动指南——谁做什么、按什么顺序、阻塞在谁。
>
> **范围声明**：本节是 **multi-agent FS 这一具体设计**的实施追踪，使用 N1–N19 / G1–G8 任务 ID。生态级的阶段总览（阶段一→二→三→3.5→四）、跨项目工作线（A/B/C/D/E/F）、4 项目拓扑、术语表等以 [pencil-platform-charter.md](./pencil-platform-charter.md) 为唯一源头。本节"Phase 1/2/3"是 multi-agent FS 设计的内部分期，与 charter 阶段编号不一一对应（multi-agent FS Phase 1–3 全部包含在 charter 阶段 3.5 内完成）。

| 阶段 | nanoPencil 任务 | Gateway 任务 | 状态 | 阻塞关系 |
|------|----------------|-------------|------|---------|
| **Phase 1：基础设施** | N1 `AgentDirContext` 抽象 · N2 `PENCILS_HOME` env 支持 · N3 `team-state-store` env bug 修复 | — | ✅ 已完成 | 无阻塞 |
| **Phase 2：硬编码改造** | N4 persona · N5 session · N6 soul · N7 mcp · N8 audit-log | — | ✅ 已完成 | 依赖 N1 |
| **Phase 3：用户可见** | N9 `--agent <id>` · N10 `agent.json` · N11 `pencils migrate` · N12 切 `CONFIG_DIR_NAME` | G2 ID 校验正则 · G3 注册时写 `agent.json` | ✅ 已完成 | 依赖 N1–N8 |
| **Phase 4：Workspace** | N13 `WorkspaceManager` · N14 `ws_id`派生 · N15 sessions 双轴索引 | G6 `/v1/workspaces` API · `AgentConfig.workspaceId` | ⏳ 待启动 | 依赖 N9 |
| **Phase 5：Teams** | N16 remote teammate · N17 team-state 落 workspace · N18 mailbox→黑板 · N19 移除 legacy | G7 `/v1/teams/<id>/dispatch` | ⏳ 待启动 | 依赖 N13 |
| **Cloud Adopt** | — | G1 `/v1/agents/adopt` 接口 · G4/G8 path hint 更新 · G5 移除 `start-pencil.sh` | 依赖 N10 + Asgard 出包 |
| **清理** | — | G5 移除 env 兜底 · editor 统一 connection schema | 依赖 N9 + N12 |

**关键路径**：N1 → N4-N8 → N9 → N13 → N16。Gateway 的 G1-G8 大部分等 nanoPencil 对应任务完成后才能闭环。

**立即可以做的事（无阻塞）：**
- nanoPencil：N1（`AgentDirContext`）、N2（env 支持）、N3（bug 修复）
- Gateway：G2（ID 校验，已有 schema 定义）

### 0.5 阅读路径建议

- 想理解全貌：从 §1 哲学读到 §8。
- 想着手改 nanoPencil 源码：直接跳 §9。
- 想理解 Gateway 侧已经做了什么：跳 §10。
- 想知道 Teams 怎么演进：跳 §11。
- 担心向后兼容：跳 §13。

---

## 1. 设计哲学：Mind 与 Embodiment 解耦

> 上一版本的核心命题，本版完全保留并扩展。

**Agent (心智)**：拥有独立的灵魂、记忆、偏好、隐私会话。
**Workspace (具身)**：Agent 工作的物理场所，包含项目事实、黑板协作区、共享状态。

### 1.1 为什么必须解耦

- **同一个 Workspace 可被多个 Agent 进入**：Team 场景下，韩寒 + 莫言一起写一本小说，需要共享文件树 / git / 项目规则，但各自保留独立人格。
- **同一个 Agent 可进入多个 Workspace**："我的 default pencil"今天写 repo-A，明天写 repo-B；Agent 的 soul / 长期记忆持续，工作空间事实跟项目走。
- **隐私边界天然落在心智层**：sessions / user memory / auth.json 永远在 `agents/<id>/`，绝不漂到 Workspace 共享区。

### 1.2 反例：把 Workspace 塞进 Agent

如果坚持"agents/<id>/projects/<proj>/"这种嵌套：

- 切项目时丢失上下文。
- Team 协作要把 workspace 状态在 N 个 agent 目录之间同步，永远不一致。
- 两个 Agent 看同一个文件可能看到不同状态。

**所以 Workspace 必须独立于 Agent**。

---

## 2. 最终目录布局

```text
~/.pencils/                                     ← Pencils 生态唯一根（PENCILS_HOME 覆盖）
│
├── .pencils-version                            ← runtime: schema 版本 + 上次迁移时间
├── .migrations/                                ← runtime: pencils migrate 写入的幂等日志
├── .locks/                                     ← runtime: 多进程互斥（CLI + Gateway 同跑）
├── .trash/                                     ← runtime: 软删除回收站（30 天 TTL）
├── .backups/                                   ← runtime: 破坏性操作前自动快照
├── .cache/                                     ← runtime: 可再生数据（model catalogs、http ETag）
│
├── agents/                                     ← 【个体心智】每 Agent 一槽（CLI + Gateway 共用）
│   ├── default/                                ← CLI 单用户兼容槽（自动从 ~/.nanopencil/agent/ 迁移）
│   │   ├── agent.json                          ← 规范元数据（见 §4）
│   │   ├── auth.json                           ← provider keys（绝不上传）
│   │   ├── settings.json                       ← model/temp/maxTurns
│   │   ├── models.json                         ← provider 目录
│   │   ├── soul/                               ← 灵魂演化层
│   │   │   ├── template.json                   ← cloud-adopted 时来自云端，read-mostly
│   │   │   ├── profile.json                    ← 用户演化版本，local source of truth
│   │   │   └── evolutions/                     ← append-only 演化日志
│   │   ├── memory/
│   │   │   ├── seed/                           ← 云端下发的 initial memory（read-only mirror）
│   │   │   └── user/                           ← 本地累积的偏好与记忆
│   │   ├── sessions/                           ← 主存（按 workspace 索引隔离，见 §5.5）
│   │   └── .PENCIL.md                          ← agent 自描述（人读 markdown，给 LLM 看）
│   ├── pencil-01/                              ← 多 pencil 本地手工槽
│   ├── hanhan/                                 ← 云端"领养"槽（id slug；displayName='韩寒'存 agent.json）
│   └── moyan/                                  ← 同上
│
├── workspaces/                                 ← 【具身共享】项目级事实（Agent 平级）
│   └── <ws_id>/                                ← <ws_id> 派生算法见 §5.2
│       ├── manifest.json                       ← bindings + displayName + 创建时间
│       ├── .pencil_context                     ← 项目快照（file tree、git state、LSP 信号）
│       ├── shared_mem.db                       ← O-Mesh 黑板：项目共识（"本项目禁用 Promise.then"）
│       ├── teams/                              ← Team 编排状态（mailbox、transcript、leader 选举）
│       ├── agent-overrides/                    ← Agent×Workspace 交叉偏好（见 §6）
│       │   └── <agent_id>/
│       │       ├── style-overrides.json
│       │       └── memory-overrides/
│       ├── sessions-index/                     ← sessions 副索引（Agent×Workspace tuple）
│       └── policies.json                       ← 写入白名单 / 工具调用范围
│
├── gateway/                                    ← 【调度元数据】Gateway 进程级状态
│   ├── registry/                               ← AgentRegistry 持久化
│   │   └── agents/<id>.json                    ← 每个 PencilAgent 的注册体（POST /v1/agents）
│   ├── channels/                               ← Channel 进程状态（DingTalk dedup、token cache）
│   └── sessions/                               ← Gateway 短期 SSE session 快照
│
├── channels/                                   ← 【感官接口】跨 Agent 共享的长期凭据
│
└── evals/                                      ← 【自省】Pencil-Evaluate 性能 trace + 基线
```

### 2.1 几条不破不立的规则

1. **dot-prefix 全部是 runtime 状态**——用户备份配置时只需 rsync 非 dot 入口。`pencils migrate` 检测未识别的 dot 目录时**保留**而不删（forward-compat）。
2. **`gateway/` 永远不出现 agent 业务数据**——只有元数据。卸载 Gateway 等于删 `gateway/`，不会误删 agent。
3. **业务目录用复数**（agents/ workspaces/ channels/ evals/），单数命名给"单例 / 元数据"（gateway/ shared_mem.db）。
4. **`<id>` 必须 ASCII slug** `^[a-z0-9][a-z0-9._-]{0,63}$`——见 §4.1。

---

## 3. 环境变量层级

```text
PENCILS_HOME                ← 生态根（默认 ~/.pencils）
                              env 别名：NANOPENCIL_HOME（兼容老用户）

PENCILS_AGENTS_DIR          ← agents/ 子树（默认 $PENCILS_HOME/agents）
                              很少需要单独覆盖，给容器场景挂载 PV 用

PENCILS_GATEWAY_DIR         ← gateway/ 子树（默认 $PENCILS_HOME/gateway）

NANOPENCIL_CODING_AGENT_DIR ← 单 agent override（沿用历史，多 pencil 时降为 fallback）
```

派生关系：

```text
PENCILS_HOME = ~/.pencils
  ├── PENCILS_AGENTS_DIR  = $PENCILS_HOME/agents
  └── PENCILS_GATEWAY_DIR = $PENCILS_HOME/gateway
单 agent override = $PENCILS_AGENTS_DIR/<id>
```

只设 `PENCILS_HOME` 是最常用姿势；其余三个仅在罕见拓扑下使用。

---

## 4. `agent.json` 规范元数据（Asgard 联动的关键）

> 用户提出"Agent ID 应该是英文数字、Name 可以是中文，应该有一份 Agent 的元数据存在本地，否则后期无法和 Asgard 平台联动"。这一节给出契约。

### 4.1 ID vs Name 严格分离

- **`<id>`**（机器标识）：必须 `^[a-z0-9][a-z0-9._-]{0,63}$`——小写、字母数字打头、字符集限定 `[a-z0-9._-]`、长度 ≤ 64。**不可变**，是文件系统目录名、Gateway 路由 modelId（`pencil/<id>`）、Asgard 外部关联键，**不是给人看的**。
- **`displayName`**（人看的）：UTF-8 任意字符（中文、emoji、空格 OK）；可改；只在 UI 显示。
- 同一 Agent 的 `<id>` 在云端、本地、Gateway 注册、Asgard 数据库里**永远是同一个值**——因此必须是 ASCII slug，否则跨系统就会 URL 编码 / 大小写归一化 / 文件系统兼容性炸成一团。
- 用户在 UI 里输入"韩寒"时，前端要么要求他另填 `id`，要么自动派生（如 `hanhan` 或 `pencil-${shortHash}`）；不允许"name 当 id 用"。

### 4.2 schema

```jsonc
// ~/.pencils/agents/<id>/agent.json
{
  "version": "1.0.0",
  "id": "hanhan",                              // slug，与目录名一致；不可变
  "displayName": "韩寒",                        // 人读，可中文/emoji
  "description": "70 后小说家的写作助手……",     // 人读，可空
  "createdAt": "2026-05-05T10:00:00Z",
  "updatedAt": "2026-05-05T10:00:00Z",

  "origin": {                                  // 这个 Agent 从哪来
    "type": "local",                           // local | cloud-adopted | imported
    "asgard": {                                // 仅 cloud-adopted 时存在
      "templateId": "hanhan",                  // 云端模板 id（与本地 id 可能同名也可能不同）
      "templateVersion": "1.2.0",              // semver；用户重置模板时对比
      "originUrl": "https://asgard-api.onrender.com",
      "externalId": "asg_pa_12345",            // Asgard 数据库主键，跨实例稳定
      "lastSyncedAt": "2026-05-05T10:00:00Z"
    }
  },

  "tags": ["fiction", "literary"],
  "engine": "nano-pencil",
  "extensions": {}                             // 未来扩展位
}
```

### 4.3 为什么需要 `externalId`

用户在 Asgard UI 里把 `displayName` 从"韩寒"改成"韩寒-2026"，本地 `id` 不变（**id 不可变**，否则目录得搬家），靠 `externalId` 追溯到 Asgard 那条记录。

同一个 Asgard 用户在两台机器上领养"韩寒"模板——两台机器的本地 `id` 可以不同（如 `hanhan` vs `hanhan-mac`），但 `origin.asgard.externalId` 相同，云端能识别为同一身份的两份镜像。

### 4.4 写入路径

| 时机 | 写者 | 改动字段 |
|---|---|---|
| `POST /v1/agents` 注册新 Agent | Gateway register() | id / createdAt / origin.type='local' / engine |
| `PUT /v1/agents/<id>` 更新配置 | Gateway update() | updatedAt / displayName / description / tags |
| `POST /v1/agents/adopt` 领养云端模板 | Gateway adopt() | origin.type='cloud-adopted' / origin.asgard.* |
| Asgard sync（未来）| Gateway sync 接口 | origin.asgard.lastSyncedAt / templateVersion |
| 用户编辑（CLI / editor） | nanoPencil CLI | displayName / description / tags |

**永远不写**：`id`（创建后不可变）、`createdAt`（只读）、`origin.type`（一次性，从 local 升级到 cloud-adopted 走 adopt 接口）。改 id 等价于"删掉这个 agent，新建一个"——走 `pencils rename` 命令显式做（落到 `.backups/`），不能直接改字段。

### 4.5 校验入口

ID 校验必须落在**两个入口**：

1. nanoPencil CLI `loadConfig()` / `--agent <id>` flag 解析时——非法直接报错退出。
2. Gateway `loadConfig()` 装载 agents 时 + `AgentRegistry.register()` 接收 POST 时。

正则：`^[a-z0-9][a-z0-9._-]{0,63}$`。displayName 走 body 的 `name` 字段；body 的 `id` 字段必须是 slug。

### 4.6 与 `.PENCIL.md` 的关系

`.PENCIL.md` 是 nanoPencil CLI 已有的 markdown 形式自描述（人读多于机器读，给 LLM 当 system context）。`agent.json` 是机器读的规范字段（运维 / 集成系统读）。**两者并存**——`.PENCIL.md` 给 LLM 看，`agent.json` 给运维 / Asgard / editor 看。

---

## 5. Workspace 身份模型

> 解决"如果 project 是云端的怎么存"。

### 5.1 manifest schema

```jsonc
// ~/.pencils/workspaces/<ws_id>/manifest.json
{
  "version": "1.0.0",
  "id": "ws_a3f5b9c1",                         // 不可变；rename 不变
  "displayName": "我的小说 / novel-2026",
  "createdAt": "2026-05-05T10:00:00Z",
  "primary": "local-path",                     // bindings 里的哪一项是当前 source of truth
  "bindings": [
    { "type": "local-path", "path": "/Users/lucy/projects/novel" },
    { "type": "git-remote", "url": "git@github.com:lucy/novel.git" },
    { "type": "cloud-uri", "uri": "asgard://workspace/12345", "providerId": "asgard-default" }
  ],
  "extensions": {}
}
```

### 5.2 `<ws_id>` 派生算法（按优先级）

1. 用户显式 `--workspace-id ws_xxx` 指定。
2. 第一个 binding 是 `git-remote` → `ws_${sha256(normalizeRemoteUrl(remote_url)).slice(0,12)}`（同一 git remote 在所有人 / 所有机器上都是同一个 ws_id，自然支持团队共享）。`normalizeRemoteUrl` 在 sha256 前做 URL 归一化（strip protocol、strip `.git` suffix、lowercase host），确保 SSH 和 HTTPS 指向同一仓库时得到相同的 ws_id。
3. 第一个 binding 是 `local-path` → `ws_${sha256(realpath).slice(0,12)}`（同一台机器同一目录稳定；换机器即使路径相同也是新 id，因为 realpath 不同；这是 feature 不是 bug）。
4. 第一个 binding 是 `cloud-uri` → `ws_${sha256(uri).slice(0,12)}`。

### 5.3 四种典型 binding 组合

| 场景 | bindings | primary | 行为 |
|---|---|---|---|
| 纯本地项目 | local-path | local-path | `.pencil_context` 实时反映 fs；shared_mem.db 本地写 |
| 本地 + git 远程 | local-path + git-remote | local-path | 同上；`.pencil_context` 额外记录 git remote/branch；用户克隆到第二台机器时**这是同一个 ws_id** |
| 仅有 git 远程（未克隆）| git-remote | git-remote | `.pencil_context` 是云端拉取的快照；shared_mem.db 仍本地 |
| 纯云端项目（如 Google Doc 风）| cloud-uri | cloud-uri | `.pencil_context` 是云端 capability 描述；shared_mem.db 本地；操作通过 cloud-uri 协议发出 |

### 5.4 云端 Workspace 的同步边界

**严格遵循**：云端提供的**元数据**（项目结构、API capability、协作者列表）可以拉到本地缓存，但**项目级 shared_mem.db / 用户级 sessions** 永远本地。

- 同一团队的 A、B 两人各自连同一个 cloud workspace → 双方各有一份 shared_mem.db，**不自动合并**。如要协同写黑板，走 cloud Asgard backend 中转（v0.x 不做）。
- 这条决策避免了"用户私域数据被悄悄上传"的隐私事故。

### 5.5 Sessions 双轴索引

会话历史既是 Agent 的（"我说过什么"），也是 Workspace 的（"这个项目里发生过什么"）。隐私决定**主存放 Agent 内**，Team 场景需要 Workspace 视角。

- 主存：`agents/<id>/sessions/<sessionId>.jsonl`（完整内容）。
- 副索引：`workspaces/<ws_id>/sessions-index/<sessionId>.json`（只存 metadata：agentId、startTime、ended、turns；**不复制内容**）。
- Team 调度器要看 workspace 全景时聚合副索引；查具体内容仍要回到对应 Agent 目录读，受 Agent 的访问策略限制（同 leader 才能跨 Agent 读）。

---

## 6. 三层 Habits 模型

> 不同 Agent 在不同 Workspace 的偏好如何分层。

### 6.1 三层

```
Layer 1  agents/<id>/                          ← Agent 全局（人格本身的习惯）
                ├── settings.json
                ├── memory/user/                ← 跨项目的偏好沉淀
                └── soul/profile.json

Layer 2  workspaces/<ws>/                      ← Workspace 全局（项目本身的规则）
                ├── shared_mem.db
                ├── policies.json
                └── extensions/

Layer 3  workspaces/<ws>/agent-overrides/<id>/ ← Agent×Workspace 交叉
                ├── style-overrides.json
                ├── memory-overrides/
                └── tool-prefs.json
```

### 6.2 运行时 merge 规则

```text
effective.systemPrompt = Layer1.profile.systemPrompt
                       ⊕ Layer2.policies.extraSystemPromptForAgents[<id>]   (rare)

effective.styleTags    = Layer1.profile.styleTags
                       ⊕ Layer3.style-overrides.extraStyleTags

effective.memory       = Layer1.memory/user/                                (always primary)
                       ∪ Layer3.memory-overrides/                           (project-specific)
                       ∪ Layer2.shared_mem.db                               (project facts as context)
                       ∪ Layer1.memory/seed/                                (cloud seed if any)

effective.tools        = baseTools
                       ⊕ Layer1.extensions/                                  (agent-private skills)
                       ⊕ Layer2.extensions/                                  (project-shared skills)

effective.policies     = Layer2.policies.json (write whitelist, etc.)
                       ⋂ Layer1.policies.json (agent self-restraint)
```

冲突时**精确层赢**：style-overrides 覆盖 styleTags，但 memory 是 union 不是替换。Policies 是 intersection（任一层禁就是禁）。

### 6.3 写入路径

| 写入者 | Layer 1 | Layer 2 | Layer 3 |
|---|---|---|---|
| 用户手工 / `nanopencil` 内 `/style` 命令 | ✓（默认）| ✓ 显式 | ✓ 显式 `--scope=ws` |
| Agent 自身（自我演化）| 写 `evolutions/`，不直接改 profile | ✗（项目事实需要外部确认）| 写 `memory-overrides/`，不直接改 style-overrides |
| Team Dispatcher | ✗ | ✓（黑板写入）| ✗ |
| Gateway adopt 接口 | ✓ 初次落盘 template | ✗ | ✗ |
| Asgard cloud sync | ✓ template 字段 | ✗（云端不存项目事实）| ✗ |

`evolutions/` 是 append-only 演化日志；用户审阅后才"提升"为 `profile.json` 的字段——避免 LLM 自我演化失控。

---

## 7. 云端 + 本地混合：Pencil 包格式

> Asgard 给"韩寒/莫言"这种 cloud-distributed agent 存的内容（方案 Z 决策）。

### 7.1 schema

```jsonc
{
  "templateId": "hanhan",
  "version": "1.2.0",
  "displayName": "韩寒",
  "description": "70 后小说家的写作助手……",
  "soul": {
    "systemPrompt": "你是韩寒……",
    "styleTags": ["sarcastic", "minimalist", "zh-cn-novel"]
  },
  "memorySeed": [                              // initial memory（option Z 核心）
    { "kind": "writing-sample", "title": "三重门 第一章片段", "content": "……", "tags": ["voice", "rhythm"] },
    { "kind": "stylistic-rule", "content": "倾向短句，避免华丽形容词堆叠", "tags": ["voice"] }
    // … 30 条左右
  ],
  "settings": {
    "defaultProvider": "dashscope-coding",
    "defaultModel": "qwen3-coder-plus",
    "temperature": 0.85,
    "memoryMaxTurns": 32
  },
  "compatibility": {
    "minNanoPencilVersion": "1.13.0",
    "minGatewayVersion": "0.2.0"
  }
}
```

### 7.2 领养时本地落盘

| 包字段 | 落到本地哪里 | 后续行为 |
|---|---|---|
| `soul.*` | `agents/<id>/soul/template.json` | template 字段 read-mostly；用户改写复制到 `soul/profile.json` |
| `memorySeed[]` | `agents/<id>/memory/seed/*.json`（每条一文件，按 kind 分目录）| read-only 镜像；新记忆进 `memory/user/` |
| `settings.*` | `agents/<id>/settings.json` | 默认值；用户可改 |
| `templateId / version` | `agents/<id>/agent.json:origin.asgard` | 升级判断 / 兼容矩阵 |
| `compatibility.*` | 不落盘，仅做 admission check | 本地版本不达标时领养拒绝 |

### 7.3 数据归属一览

| 数据类型 | 云端 | 本地 | 同步方向 |
|---|---|---|---|
| Soul 模板 | ✓ source | mirror | cloud → local（adopt）|
| Soul 演化（用户 patch）| ✗ | source | 不同步 |
| Memory seed | ✓ source | mirror | cloud → local（adopt）|
| Memory user（个人偏好）| ✗ | source | 不同步 |
| 项目事实 / 黑板 | ✗ | source | 不同步 |
| Sessions | ✗ | source | 不同步 |
| auth.json | ✗ **绝不上传** | source | 不同步 |
| settings/models | template 默认 | source | template 一次性 |
| Gateway registry | ✗ | source | 不同步 |

**口诀**：心智归 Agent，事实归 Workspace，元数据归 Gateway，私域必本地，认证不出门。

---

## 7.5 Agent 三种形态分类（2026-05-13 增补）

> 这一节区分**平台分发的 SuperAgent**、**用户基于其派生的 Derived Agent**、**用户自定义的 Custom Agent**。doc 16 之前用 template/profile 二分层暗示了这件事，但没显式分类。本节正式定义。

### 7.5.1 三种形态的产品语义

| 形态 | 谁创建 | Soul 可变性 | Memory 可变性 | 典型场景 |
|---|---|---|---|---|
| **SuperAgent** | 平台 / 厂商 | ❌ **immutable**（本地用户无法修改）| ✅ user 层可累积 | "韩寒"、"莫言" 这类厂商调教好的 persona，灵魂和文风是产品差异化的核心，不能被本地用户漂移污染 |
| **Derived Agent** | 用户基于 SuperAgent 派生 | ✅ overridable（用户可加 patch，但 template 层不变）| ✅ user 层可累积 | "我的韩寒-写散文版"——保留韩寒的核心人格，用户加几条个人偏好 |
| **Custom Agent** | 用户从零自创 | ✅ overridable（全权）| ✅ user 层可累积 + **可上传本地 memory** | "我自己的写作伙伴"——从空白开始，soul/memory 完全由用户掌控 |

### 7.5.2 文件系统对照

```text
~/.pencils/agents/

├── hanhan-super/                          ← 平台分发的 SuperAgent
│   ├── agent.json
│   │   {
│   │     "kind": "super",
│   │     "soulPolicy": "immutable",
│   │     "origin": {"type": "platform", "platformId": "asgard"}
│   │   }
│   ├── soul/
│   │   └── template.json                    ← 只读；平台同步；用户写入被拒
│   └── memory/
│       └── seed/                            ← 只读；平台同步
│   （注意：NO profile.json, NO memory/user/ — soul policy 决定）
│
├── asgard-u1-hanhan-derived/              ← 用户从韩寒派生的
│   ├── agent.json
│   │   {
│   │     "kind": "derived",
│   │     "soulPolicy": "overridable",
│   │     "parentTemplateId": "hanhan-super",
│   │     "origin": {"type": "cloud-adopted", "asgard": {...}}
│   │   }
│   ├── soul/
│   │   ├── template.json                    ← 引用父模板的副本，read-mostly
│   │   ├── profile.json                     ← 用户个性化补丁
│   │   └── evolutions/                      ← 演化日志
│   └── memory/
│       ├── seed/                            ← 父模板 seed 副本
│       └── user/                            ← 这个用户的累积
│
└── asgard-u1-my-pencil/                   ← 完全自创
    ├── agent.json
    │   {
    │     "kind": "custom",
    │     "soulPolicy": "overridable",
    │     "origin": {"type": "local"}
    │   }
    ├── soul/
    │   ├── profile.json                     ← 唯一 source of truth
    │   └── evolutions/
    └── memory/
        ├── user/                            ← 主要累积层
        └── imported/                        ← 用户上传的（可选）
```

### 7.5.3 运行时 Soul/Memory merge 规则

| 字段 | super | derived | custom |
|---|---|---|---|
| `systemPrompt` | `template.systemPrompt` | `template.systemPrompt` ⊕ `profile.appendOrPatch` | `profile.systemPrompt` |
| `styleTags` | `template.styleTags` | `template.styleTags` ∪ `profile.styleTags`（去重）| `profile.styleTags` |
| LLM context | + `memory/seed/` | + `memory/seed/` + `memory/user/` | + `memory/user/` + `memory/imported/` |

**Soul policy 强制执行点**（Gateway nano-adapter）：

```ts
// 伪代码
if (agent.kind === 'super' && writeTarget === 'soul/profile.json') {
  throw new ForbiddenError('Soul of SuperAgent is immutable');
}
if (agent.kind === 'super' && writeTarget.startsWith('memory/seed/')) {
  throw new ForbiddenError('Memory seed is platform-controlled');
}
```

### 7.5.4 Asgard 数据库 schema 加 3 个字段

```sql
ALTER TABLE asgard_agents ADD COLUMN kind VARCHAR(16);
    -- 'super' | 'derived' | 'custom'，默认 'custom'
ALTER TABLE asgard_agents ADD COLUMN parent_template_id INTEGER NULL;
    -- FK self-ref；derived 用，其他 NULL
ALTER TABLE asgard_agents ADD COLUMN soul_policy VARCHAR(16);
    -- 'immutable' | 'overridable'，super 默认 immutable，其他 overridable
```

**可见性规则**（Asgard 路由侧）：

- `kind=super` + `is_public=true`：**所有用户可见**（出现在"市场 / SuperAgent 列表"）
- `kind=derived` + `is_public=false`：仅创建者可见（"我的 Agent"列表）
- `kind=custom` + `is_public=false`：同上

### 7.5.5 用户操作流程

```
平台 admin 创建 SuperAgent
   ↓
   ASGARD UI：POST /api/v1/agents/pencil { kind: "super", soul_policy: "immutable", ... }
   ↓
   普通用户在"市场"看到「韩寒 SuperAgent」
   ↓
用户选择 → 三种动作：
   ├─ "试用"           → Asgard 不复制记录，前端直接调 pencil/<super_id> 聊天
   ├─ "派生到我的"     → POST /api/v1/agents/pencil/<super_id>/derive
   │                       Asgard 复制 soul + memory_seed 到新记录
   │                       新 agent: kind=derived, parent=<super_id>, soul_policy=overridable
   │                       用户后续聊天累积到自己的 profile + memory/user/
   └─ "完全自创"       → POST /api/v1/agents/pencil { kind: "custom", soul: {...} }
                          可选附带 memory 文件上传
```

---

## 8. 长期维护原则

> 一旦布局对用户可见，新增容易、删除难。

### 8.1 Schema 版本规则

每个持久化文件首字段都带 `version`（semver），缺省视为 `"0.0.0"`。

- **加字段**：minor 凸；老 reader 必须忽略未知字段。
- **改字段语义**：major 凸；启动时强制 `pencils migrate` 才能继续读。
- **删字段**：先标 `deprecated: true` 一个 minor 周期，再删；删除是 major 凸。
- 所有 reader 必须做 `version <= supportedMax` 检查；高于自己的版本提示用户升级。

### 8.2 命名空间预留清单（位先占好，feature 后补）

| 路径 | 用途 | 优先级 |
|---|---|---|
| `agents/<id>/extensions/` | Agent 私有 skill / MCP / prompt template（覆盖全局）| 中 |
| `agents/<id>/channels.json` | 这个 Agent 在哪些 channel 接收消息（DingTalk / Feishu / WeChat）| 中 |
| `agents/<id>/.activity-log.jsonl` | append-only 操作审计 | 低 |
| `agents/<id>/policies.json` | Agent 工具白名单 / 写入范围 | 中 |
| `workspaces/<ws>/extensions/` | 项目级 MCP（npm-mcp、jira-mcp）| 中 |
| `workspaces/<ws>/agent-overrides/<id>/` | §6 三层 habits | 高 |
| `workspaces/<ws>/.activity-log.jsonl` | 项目维度审计 | 中 |
| `workspaces/<ws>/secrets.enc` | 项目级加密凭据 | 低 |
| `gateway/instances.json` | 多 Gateway 实例发现 | 低 |
| `gateway/.runtime/` | PID 文件、socket fd | 低 |
| `channels/.tokens/` | 跨 Agent 共享的长寿凭据 | 中 |
| `evals/runs/<run_id>/` | 单次评测 trace | 低 |
| `evals/baselines/<agent_id>/` | Agent 能力基线快照 | 低 |
| `<root>/.shared/` | 跨 Agent 跨 Workspace 全局共享 | 低 |

**预留原则**：每个 path 在文档里有一句话说明"如果你看到这个目录，意味着 X feature 已启用"，但**不强制创建**。

### 8.3 长期维护十条铁律

1. **格式三选一**：JSON（配置）/ JSONL（append-only）/ SQLite（索引查询）。新增不要引入第四种。
2. **永远不硬删**：destructive 操作（delete agent / reset soul / drop workspace）都先 `mv` 到 `.trash/<source>-<ts>/`，TTL 30 天后由 `pencils gc` 真删。
3. **写前快照**：`pencils migrate` / `adopt --overwrite` / `reset-template` 之前自动 rsync 到 `.backups/<ts>-<reason>/`。
4. **幂等 migrate**：`pencils migrate` 重跑是 no-op，`.migrations/applied.jsonl` 是 source of truth。
5. **Reader 宽容、Writer 严格**：读到不认识的字段、未知 dot 目录 → 跳过 + warn；写出永远走当前 schema 版本。
6. **路径分隔符**：所有持久化路径用 POSIX `/`；只在面向 OS API 时转 native sep。
7. **大小写敏感性**：`<id>` / `<ws_id>` 全部小写 + `[a-z0-9._-]{1,64}`。中文走 displayName。
8. **路径长度**：避免 Windows MAX_PATH。`<id>` ≤ 64 字符 + 子树深度 ≤ 5。
9. **`pencils doctor` 命令**：定期检测 schema 版本、孤儿 lock、过期 trash、未识别 dot 目录。
10. **公共接口稳定性**：`agents/<id>/`、`workspaces/<id>/`、`auth.json`、`settings.json`、`agent.json`、`manifest.json` 视为公共接口——破坏性改动需要 major bump。其余路径可自由演化。

---

## 9. nanoPencil 仓库改造（按 PR 拆分）

> Step B 评估发现：**34 处 `getAgentDir()` 直接调用 / 53 处含 `getDefaultAgentDir` / 47 处 path-derived `join()` 调用**，分布在 **20 个文件**。但**真正阻塞 multi-agent 的硬编码点只有 7 处**。其余在 boot 期 / TUI 模式，多 agent 不跑那条路。

### 9.1 现状（Step B 调研结果，2026-05-06 实际 grep 验证）

```
✅ 已支持 agentDir 注入（不需要改）                getAgentDir() 调用数
   core/runtime/sdk.ts             createAgentSession({ agentDir? })    2 (+ 2 getDefaultAgentDir)
   core/extensions/loader.ts       loadExtensions(cwd, agentDir=…)      1
   core/keybindings.ts             KeybindingsManager.create(agentDir=…) 1
   core/skills.ts                  loadSkills({ agentDir? })            1
   core/model-registry.ts          ModelRegistry(authStorage, path?)     1

❌ 模块级硬编码（必须改）                           getAgentDir() 调用数
   core/persona/persona-manager.ts  const PERSONAS_DIR=…                2
   core/session/session-manager.ts  join(getDefaultAgentDir(), "sessions") 1
   core/soul-integration.ts         join(getAgentDir(), "soul")         1
   core/mcp/mcp-config.ts           getAgentDir()                       3
   core/mcp/mcp-client.ts           AuthStorage.create(join(getAgentDir())) 1
   extensions/defaults/security-audit/engine/logger.ts                2
   extensions/defaults/team/team-state-store.ts  NANOPENCIL_AGENT_DIR ← latent bug
                                                     小计：~14 处需改

🟡 Boot/TUI 模块级（保留即可）
   config.ts × 10   main.ts × 4   migrations.ts × 4   nanopencil-defaults.ts × 1
   modes/interactive/*              core/utils/shell.ts
```

### 9.2 改造抽象：`AgentDirContext`

新建 `core/agent-dir/agent-dir-context.ts`：

```typescript
export interface AgentDirContext {
  /** Slug id, [a-z0-9._-]{1,64}; matches the directory name. */
  readonly id: string;
  /** Absolute path; trusted to exist or be creatable. */
  readonly path: string;
  /** Optional — if the agent was adopted from cloud, the origin metadata. */
  readonly origin?: AgentOriginMetadata;
}

/** Default context = the legacy single-agent path. */
export function defaultAgentDirContext(): AgentDirContext {
  return { id: "default", path: getAgentDir() };
}

export function agentDirContextOf(id: string, path: string): AgentDirContext {
  return { id, path };
}
```

**改造模板**（每个硬编码点照这个改）：

```typescript
// Before (persona-manager.ts:15)
const PERSONAS_DIR = join(getAgentDir(), "personas");

class PersonaManager {
  list() { return readdir(PERSONAS_DIR); }
}

// After
class PersonaManager {
  constructor(private readonly ctx: AgentDirContext = defaultAgentDirContext()) {}
  private get personasDir() { return join(this.ctx.path, "personas"); }
  list() { return readdir(this.personasDir); }
}
```

要点：**默认参数 = `defaultAgentDirContext()`**，老调用者一行不改也能跑。

### 9.3 PR 拆分清单

#### Phase 1：基础设施（不引入新行为）

| ID | 任务 | 状态 | 复杂度 | 依赖 |
|---|---|---|---|---|
| **N1** | 新增 `AgentDirContext` 抽象 | ✅ | S | — |
| **N2** | `package.json` 加 `PENCILS_HOME` 支持 + `config.ts` 读 `PENCILS_*` env | ✅ | S | — |
| **N3** | `team-state-store.ts` env 名修复 | ✅ | S | — |

#### Phase 2：硬编码点改造（无行为变化，纯重构）

| ID | 任务 | 状态 | 复杂度 | 依赖 |
|---|---|---|---|---|
| **N4** | `persona-manager.ts` 重构成 class 接受 AgentDirContext | ✅ | M | N1 |
| **N5** | `session-manager.ts` 改 ctor 注入 agentDirCtx | ✅ | M | N1 |
| **N6** | `soul-integration.ts` 加形参 | ✅ | S | N1 |
| **N7** | `mcp-config.ts` + `mcp-client.ts` 走注入的 agentDir + authStorage | ✅ | M | N1 |
| **N8** | `security-audit/engine/logger.ts` 接受 agentDir 形参 | ✅ | S | N1 |

#### Phase 3：用户可见的新行为

| ID | 任务 | 状态 | 复杂度 | 依赖 |
|---|---|---|---|---|
| **N9** | `nanopencil --agent <id>` flag | ✅ | M | N1–N8 |
| **N10** | `agent.json` reader/writer | ✅ | S | N1, §4.2 schema |
| **N11** | `pencils migrate` 子命令（保守迁移，默认拷贝）| ✅ | M | N1, N3 |
| **N12** | Default `CONFIG_DIR_NAME` 由 `.nanopencil` 切到 `.pencils` | ✅ | M | N9, N11 |

#### Phase 4：Workspace 一等公民

| ID | 任务 | 复杂度 | 依赖 |
|---|---|---|---|
| **N13** | 新建 `WorkspaceManager`（不替换 `WorktreeManager`，而是上层）| L | N9 |
| **N14** | `<ws_id>` 派生算法（实现 §5.2）；CLI/Gateway 共享 | S | N13 |
| **N15** | sessions 双轴索引（主存 agent，副索引 workspace） | M | N13 |

#### Phase 5：Teams 重构（详见 §11）

| ID | 任务 | 复杂度 | 依赖 |
|---|---|---|---|
| **N16** | Teams "remote teammate" 模式（teammate 走 HTTP → 本机 Gateway）| L | N9, N13 |
| **N17** | `team-state-store` 落 `workspaces/<ws_id>/teams/<team_id>.json` | M | N13, N16 |
| **N18** | mailbox → `shared_mem.db` 黑板事件订阅 | L | N13, N17 |
| **N19** | 移除 `--legacy-team` flag（major bump）| S | N16-18 落地 ≥ 1 个 minor 后 |

### 9.4 测试矩阵

每个 PR 必须保证：

```
                  Single CLI    Multi-pencil    Teams (legacy)   Teams (new)
agent boot       ✓ unchanged   ✓ new           ✓ unchanged      ✓ new
session write    ✓ same path   ✓ per-agent     ✓ shared (old)   ✓ per-agent
persona switch   ✓ unchanged   ✓ per-agent     ✓ unchanged      ✓ per-teammate
mcp config       ✓ unchanged   ✓ per-agent     ✓ unchanged      ✓ per-teammate
soul evolution   ✓ unchanged   ✓ per-agent     ✓ unchanged      ✓ per-teammate
crash recovery   ✓ unchanged   ✓ unchanged     ✗ lose context   ✓ workspace replay
```

**Single CLI 列必须字节级一致**——否则就是回归。

### 9.5 N3 优先级提升

`extensions/defaults/team/team-state-store.ts` 用了 `NANOPENCIL_AGENT_DIR`，与 `config.ts` 的 `NANOPENCIL_CODING_AGENT_DIR` 不一致。**今天没爆只因为默认值都是 `~/.nanopencil/agent/`**；用户一旦覆盖 env 立刻分裂——CLI 数据走过去、Teams 数据还在原处。

**N3 应当作为独立 patch 先合**，不依赖任何其他改造。

---

## 10. Pencil-Agent-Gateway 仓库改造

> Gateway 已经先行落地了几步（Step A），剩下的等 nanoPencil Phase 1–3 完成后补齐。

### 10.1 已落地（Step A，commit `2ea04e9`）

- `AgentConfig.agentDir` 显式字段，`loadConfig()` 解析 `~/` + 相对 config 路径
- 默认 `dataDir = $PENCILS_GATEWAY_DIR`（`~/.pencils/gateway/`）
- 默认 `agentDir = $PENCILS_AGENTS_DIR/<id>`（`~/.pencils/agents/<id>/`）
- 三档 env：`PENCILS_HOME` / `PENCILS_AGENTS_DIR` / `PENCILS_GATEWAY_DIR`
- 别名：`NANOPENCIL_HOME` → `PENCILS_HOME`；`NANOPENCIL_CODING_AGENT_DIR` 仍作 per-agent fallback
- 旧布局检测 + warn（`~/.pencils/<id>/` 有数据 + 新路径未建 → 走旧路径）
- `nano-adapter` 改用 per-instance `this.agentDir`，多 pencil 同进程可行
- 测试覆盖 154/154

### 10.2 待落地（依赖 nanoPencil 改造）

| 任务 | 依赖 | 描述 |
|---|---|---|
| **G1**：`/v1/agents/adopt` 接口 | nanoPencil N10（`agent.json`）+ Asgard 出包能力 | 接收 §7.1 Pencil 包，落到本地 agentDir 后注册 |
| **G2**：`AgentRegistry.register()` ID 校验 | §4.1 正则 | 非法 id 直接 400，不允许中文 dir 名 |
| **G3**：`POST/PUT /v1/agents` body 写 `agent.json` | nanoPencil N10 | 注册时 Gateway 同时落 `agents/<id>/agent.json`；与 nanoPencil 协商谁先写 |
| **G4**：错误信息 path hint 更新 | nanoPencil N12（`.pencils` rebrand 完成）| 当前 `nano-adapter.ts` / `channels/app.ts` 错误信息提示 `nanopencil /login`，路径需同步到新 `~/.pencils/agents/<id>/` |
| **G5**：移除 `start-pencil.sh` env 兜底 | nanoPencil N9（`nanopencil --agent <id>`）| 等 CLI 直接 launch agent slot 后不再需要 shell 包装 |
| **G6**：`/v1/workspaces` 接口 | nanoPencil N13–N14 | 让外部能 POST 创建 workspace；`AgentConfig` 增加 `workspaceId?` 字段；`buildSessionOptions` 传 workspace 信息给引擎 |
| **G7**：`/v1/teams/<team_id>/dispatch` 接口 | nanoPencil N16–N18 | Teams 重构后的 HTTP 协调入口 |
| **G8**：errors / logger.error 中 path 提示更新 | N12 | 把 `~/.nanopencil/agent/` 改 `~/.pencils/agents/<id>/` |

### 10.3 Gateway 自身行动顺序

A、B、D 可并行；C 阻塞 E/F/G；E 阻塞 F：

```
Step A  (Gateway 单方)   ✅ 切根到 ~/.pencils/agents/<id>/，env 兼容别名上线
Step B  (本 doc)         ✅ nanoPencil 源码影响面调研
Step C  (nanoPencil)     N1–N12（详见 §9.3 Phase 1–3）
Step D  (Asgard + Gateway) §7 Pencil 包 schema 定型 + /v1/agents/adopt
Step E  (nanoPencil)     N13–N15 WorkspaceManager + Sessions 双轴
Step F  (nanoPencil)     N16–N19 Teams 切到统一 agents/ + workspace 黑板
Step G  (清理)           Gateway 移除 env 兜底；editor 统一 connection schema
```

### 10.4 SuperAgent / Derived / Custom 产品演进路线（P0–P5）

> 为 §7.5 三种 Agent 形态分类落地的分阶段计划。P0 / P0.5 / P1 已完成。

| 阶段 | 改动 | 范围 | 状态 |
|---|---|---|---|
| **P0** | 每个 Agent 独立 `~/.pencils/agents/<id>/` 目录 + 写 `agent.json` 元数据。Gateway 端 default agentDir 派生从 `getAgentDir()` 改为 `~/.pencils/agents/<config.id>/`；register/update 时调用 `writeAgentMetadata()` 落 doc 16 §11.2.1 schema 的 agent.json | Gateway 单方 | ✅ 已落（2026-05-13, commit `1df2380`）|
| **P0.5** | 防止 nano-pencil DefaultResourceLoader fallback 读 `process.cwd()` 的 AGENTS.md 污染 agent 身份。实际方案（非原计划的 `.PENCIL.md` seed）：在 `nano-adapter.ts` 把 `cwd` 钉死到 `agentDir`，并显式 `await loader.reload()` 让 SDK 把 `systemPromptSource` 提升到 `systemPrompt`——绕过 SDK 不会自动 reload 外部传入 ResourceLoader 的限制 | Gateway 单方 | ✅ 已落（2026-05-13, commit `48fe4ea`）|
| **P1** | Asgard schema 加 `kind` / `parent_template_id` / `soul_policy` 三列；`POST /agents/pencil` 仅接受 `kind=custom`（super 由 ops 注入、derived 走 P2 派生端点）；`PencilAgentDetail` 把三个字段暴露给前端；Asgard→Gateway 的 POST/PUT 体新增 `kind` / `origin` / `parentTemplateId`；Gateway `AgentConfig` 同步加这三字段；`registry.writeAgentMetadata` 不再硬编码 `kind:'custom'`，按收到的值写入 `agent.json` | Asgard + Gateway | ✅ 已落（2026-05-13）|
| **P2** | 派生接口 `POST /api/v1/agents/pencil/<super_id>/derive`——Asgard 复制 super 的 soul template + memory seed 到新 agent 记录（kind=derived, parent=<super_id>）；前端在"市场"页面提供"派生我的副本"按钮 | Asgard + Gateway | ⏳ 待办 |
| **P3** | Gateway 端 soul policy 强制：nano-adapter / agent metadata 读 `agent.json.soulPolicy`（或 `AgentConfig.kind==='super'`），immutable 时禁写 `soul/profile.json` 与 `memory/seed/`；任何破坏性写入返回 403 | Gateway | ⏳ 待办 |
| **P4** | Custom Agent memory 上传——UI 文件上传组件 + Asgard 接 multipart 接口（限格式：JSONL / Markdown / 限大小）+ Gateway 落 `memory/imported/`；仅 custom/derived kind 可调用，super 拒绝 | Asgard UI + Asgard API + Gateway | ⏳ 待办 |
| **P5** | SuperAgent 版本管理——`agent.json.origin.asgard.templateVersion` 字段 + 平台 push 新版本通知；用户在 UI 看到"新版本可用"，可选"采纳"（同步覆盖 `soul/template.json`、保留本地 profile）或"保持当前版本" | Asgard + UI + Gateway | ⏳ 待办 |

### 10.5 P0–P1 已落地的具体行为差异

**P0 — 每 Agent 独立目录（commit `1df2380`）：**

```
Before：
  ~/.pencils/agents/default/          ← 所有 agent 共享这一个目录
  ~/.pencils/gateway/agents/<id>.json ← Gateway 注册体（OK）

After：
  ~/.pencils/agents/default/                  ← nano-pencil CLI 兼容槽
  ~/.pencils/agents/asgard-u1-41c65fc9/       ← UI 建的"Pencil Demo"
  │   └── agent.json
  ~/.pencils/agents/asgard-u1-5e3139d6/       ← UI 建的"测试"
  │   └── agent.json
  ~/.pencils/gateway/agents/<id>.json         ← Gateway 注册体（不变）
```

**P0.5 — Soul 不再被 cwd 污染（commit `48fe4ea`）：**

修前症状：UI 建的"测试 Agent"（soul=`你是雷姆`）问"你是谁"会答"我是 nanopencil 写作助手"——原因是 `DefaultResourceLoader` 构造时把 `systemPrompt` 写到 `systemPromptSource`，必须 `reload()` 才会提升到 `systemPrompt`；SDK 仅在自己 new 的 ResourceLoader 上自动 reload，外部传入的不管，于是 `agent-session` 拿不到 systemPrompt → fallback 到 SDK 默认提示词。修后："雷姆"和"Pencil Demo"各答各的身份。

**P1 — Agent 三态分类落地（2026-05-13）：**

Asgard `asgard_agents` 表加列：

```sql
ALTER TABLE asgard_agents
  ADD COLUMN kind VARCHAR(16) NOT NULL DEFAULT 'custom',
  ADD COLUMN parent_template_id INTEGER NULL,
  ADD COLUMN soul_policy VARCHAR(16) NOT NULL DEFAULT 'overridable';
CREATE INDEX ix_asgard_agents_kind ON asgard_agents(kind);
CREATE INDEX ix_asgard_agents_parent_template_id ON asgard_agents(parent_template_id);
```

Asgard → Gateway 透传：`POST/PUT /v1/agents` 体新增

```json
{
  "kind": "custom",                                  // super | derived | custom
  "parentTemplateId": 42,                            // 仅 derived 出现
  "origin": {
    "type": "asgard",
    "asgardAgentId": "pencil/<gw_id>",
    "ownerUserUuid": "<user.uuid>"
  }
}
```

Gateway `registry.writeAgentMetadata` 写入：

```json
{
  "version": "1.0.0",
  "id": "<gateway_agent_id>",
  "displayName": "...",
  "createdAt": "...",
  "updatedAt": "...",
  "kind": "custom",                  // ← 不再硬编码，按 AgentConfig.kind 取
  "origin": {...},                   // ← 按 AgentConfig.origin 取，缺省 {type:'local'}
  "parentTemplateId": 42,            // ← 仅 derived 写入
  "engine": "nano-pencil",
  "extensions": {}
}
```

`POST /api/v1/agents/pencil` 仅接受 `kind=custom`（其他形态走 P2 派生端点 / ops 注入），避免静默降级用户意图。`_to_pencil_detail` 把三个字段回给前端 UI，方便后续渲染"派生自 X"徽章、锁定 Soul 编辑器等。

soul/memory 等子目录仍**没自动创建**（Gateway 当前还用 in-memory SessionManager），P3 起再补齐。

---

## 11. Teams 重构：从 in-process 到多 Agent 协作

> 用户判断："原有的 team 已经不适合在单实例内执行"——本节给出重构方向。

### 11.1 现状的根本问题

当前 `extensions/defaults/team/`：

- **teammate 不是真 Agent slot**——`team-state-store.ts` 落的是单个 JSON（`{ id, name, label, mode, status, persona, model, ... }`），无独立 soul/memory/sessions/auth。所有 teammate 共享 leader 的 agentDir。
- **协作走 in-memory mailbox**（`team-mailbox.ts`），不是黑板模式。leader 进程崩了，所有未读消息丢失。
- **生命周期跟 leader 进程**——leader 退出 = teammate 全死。
- **跨会话不可恢复**——用户登出再登入，team 上下文丢了。

### 11.2 重构后的新模型

```
                    ┌────────────────────────────────────┐
                    │  Pencil-Agent-Gateway 进程         │
                    │  ────────────────────              │
                    │  AgentRegistry：                   │
                    │   ├── pencil-01  → AgentInstance   │
                    │   ├── pencil-02  → AgentInstance   │
                    │   ├── reviewer   → AgentInstance   │
                    │   └── ...                          │
                    │                                    │
                    │  HTTP /v1/chat/completions         │
                    │  HTTP /v1/teams/<team_id>/dispatch │
                    └─────────────────────┬──────────────┘
                                          │
                    ┌─────────────────────┴──────────────┐
                    │  ~/.pencils/                       │
                    │  ├── agents/                       │
                    │  │   ├── pencil-01/                │
                    │  │   ├── pencil-02/                │
                    │  │   └── reviewer/                 │
                    │  └── workspaces/                   │
                    │      └── <ws_id>/                  │
                    │          ├── teams/                │
                    │          │   └── <team_id>.json    │
                    │          ├── shared_mem.db   ← 黑板 │
                    │          └── sessions-index/       │
                    └────────────────────────────────────┘
```

新模型：
- 每个 teammate ↔ Gateway 里的一个 AgentInstance（独立 agentDir）
- Team 是 workspace 范畴的概念（一个 team 绑一个 workspace）
- 协作走 workspace `shared_mem.db`（黑板）+ Gateway HTTP（同步指令）
- Team 配置（成员、规则、状态）落 `workspaces/<ws_id>/teams/<team_id>.json`
- Leader 是个角色（哪个 agent 当 dispatcher），不是进程绑定

### 11.3 5 阶段迁移

| 阶段 | 行动 | 兼容承诺 |
|---|---|---|
| **F1**（N16）| 加 "remote teammate" 模式：teammate 不再 in-process spawn，而是通过 HTTP 调本机 Gateway（Gateway 必须先起来） | 旧 in-process 模式保留为 `--legacy-team` flag |
| **F2**（N17）| `team-state-store.ts` 落 `~/.pencils/workspaces/<ws_id>/teams/<team_id>.json`，schema 升级（含 member agent ids 列表、rule、leaderId）| 旧 `<dir>/teams/<id>.json` 自动迁移到新位置 |
| **F3**（N18）| `team-mailbox.ts` 改成基于 workspace `shared_mem.db` 的黑板事件订阅 | 旧 in-memory mailbox 在 legacy mode 保留 |
| **F4** | Leader 选举 / 故障转移：基于 Gateway 侧的 `/v1/teams/<id>/leader` 状态 | 单 leader 模式仍可用 |
| **F5**（N19）| 移除 `--legacy-team`；Teams 完全切到多 Agent 进程模型 | major bump 时机；保留 release notes |

每一步可独立发版，不必一口气切。

### 11.4 风险

| 风险 | 触发场景 | 缓解 |
|---|---|---|
| 跨进程依赖 | F1 后 teammate 必须能联到本机 Gateway，端口冲突 / 防火墙会爆 | F1 默认走 unix socket（macOS/Linux）+ 命名管道（Windows）；HTTP 端口是退路 |
| Mailbox 语义差异 | F3 黑板订阅 vs 即时投递的延迟模型不同 | 黑板加 event-bus 抽象层，保留毫秒级轮询作 fallback |
| Leader 选举抖动 | F4 网络抖动导致 leader 频繁切换 | 加最短任期（min-tenure）保护 |

---

## 12. 迁移路径（保守，自动检测 + 一键脚本）

> 演进 4 阶段（v1 文档原命题）的具体化。

### 12.1 第一阶段（Shadow Mode）

引入 `~/.pencils/` 新布局，但代码中通过 env 保留旧路径兼容性。

- nanoPencil：`config.ts` 优先读 `PENCILS_HOME` / `NANOPENCIL_HOME`；fallback 到旧 `~/.nanopencil/agent/`。
- Gateway：已落地（Step A）。

### 12.2 第二阶段（Migration Tool）

新增 `pencils migrate` 子命令：

```bash
$ pencils migrate --dry-run            # 默认开 dry-run，列出将要做的事
检测项                          建议动作
─────────────────────────────────────────────────────
~/.nanopencil/agent/ 存在        → cp -r 到 ~/.pencils/agents/default/ (安全拷贝)
~/.pencils/<id>/ 存在            → cp -r 到 ~/.pencils/agents/<id>/
~/.pencils/gateway/ 不存在        → mkdir
冲突（两侧都有同名 agent）        → 报错退出，不擅自合并

$ pencils migrate --apply              # 实际执行；默认使用拷贝模式
```

**拷贝优先策略 (Copy-first)**：
- 为了确保数据安全，`migrate` 命令默认执行**拷贝 (Copy)** 而非移动 (Move)。
- 原始的 `~/.nanopencil` 目录将作为物理备份保留，直到用户手动确认新环境无误。
- 幂等：重跑 no-op，靠 `~/.pencils/.migrations/applied.jsonl` 判定。
- 快照：操作前自动 rsync 到 `~/.pencils/.backups/<ts>-migrate/`。
- 日志：迁移日志写 `~/.pencils/migrate.log`。

### 12.3 第三阶段（Full PAAS）

- nanoPencil：`nanopencil --agent <id>` flag 上线（N9）；`getAgentDir()` 默认值切到 `~/.pencils/agents/default/`（N12）。
- Gateway：`/v1/agents/adopt` 上线（G1），可领养云端模板。
- editor：connections.yaml 区分 `local-cli` / `gateway-http` 两种 transport。

### 12.4 第四阶段（O-Mesh Integration）

- Workspace 一等公民（N13–N15）。
- Teams 切到去中心化协作模式（N16–N18）。
- 废弃"传话筒"式通信，实现基于 `workspaces/<ws>/shared_mem.db` 的黑板模式。

---

## 13. 兼容承诺与回退策略

### 13.1 nanoPencil 已有功能保留清单（**不破坏的红线**）

| 已有功能 | 保留方式 |
|---|---|
| `nanopencil` 直接启动（无 `--agent` 参数）| 等价 `--agent default`，使用 `~/.pencils/agents/default/`（迁移后）或 `~/.nanopencil/agent/`（迁移前）|
| `/login`、`/model`、`/logout` 等斜杠命令 | 完全不动 |
| `nanopencil` TUI 各种快捷键 / 主题 | 完全不动 |
| `~/.nanopencil/agent/auth.json` 里已有的 OAuth tokens | 迁移命令保留 |
| `NANOPENCIL_CODING_AGENT_DIR` env | 仍生效，作为单 agent override |
| 现有插件 / extensions | 走 `core/extensions/loader.ts`（已支持注入），无改动 |
| `nanopencil /team` 命令（legacy 模式）| 至少跨 1 个 minor 保留 `--legacy-team`，给用户迁移时间 |

**Single CLI 集成测试**：每个 PR 必须包含"无 `--agent` 启动 → 走 default → 行为等价于今天"的回归测试。

### 13.2 回退策略

每一个不可逆操作都需要回退路径：

| 操作 | 回退 |
|---|---|
| `pencils migrate --apply` | 原始 `~/.nanopencil` 目录默认保留，直接删除 `~/.pencils` 即可回退 |
| `agents/<id>/` 删除 | 走 `.trash/agents/<id>-<ts>/`，30 天内可 `pencils trash restore <id>` |
| Soul template 重置 | `.backups/<ts>-reset-soul/`，可 `pencils backup restore` |
| Schema 版本 bump | `pencils migrate --downgrade <version>` 走反向迁移 |
| 彻底废弃旧目录 | 用户确认 `.pencils` 工作正常后，手动执行 `rm -rf ~/.nanopencil` |

### 13.3 弃用窗口

| 接口 | 弃用通知 | 移除窗口 |
|---|---|---|
| `~/.nanopencil/agent/` 旧根 | N12 起 deprecation log | ≥ 3 个 minor 后随 major 移除 |
| `NANOPENCIL_AGENT_DIR` env（非 CODING）| N3 起 warning | 立即（latent bug） |
| `--legacy-team` flag | F1 起 deprecation log | ≥ 1 个 minor 后随 major 移除 |
| `team-state-store` 旧位置 | N17 起警告 | ≥ 1 个 minor 后强制迁移 |

---

## 14. 与 nanoPencil 既有功能的关系（不破坏的清单）

> 第 13.1 的细化展开——具体到代码层面**哪些不动**。

### 14.1 完全不动的代码

- `core/runtime/sdk.ts`（已支持 `agentDir` 注入；调用方默认值不变）
- `core/extensions/loader.ts`（同上）
- `core/keybindings.ts`（同上）
- `core/skills.ts`（同上）
- `core/model-registry.ts`（已支持 `modelsJsonPath`）
- `modes/interactive/*.ts`（TUI 是单 agent 模式）
- `core/utils/shell.ts`、`migrations.ts`、`index.ts`、`nanopencil-defaults.ts`、`main.ts`（boot 期）
- 所有 `extensions/defaults/*` 除了 `team/` 和 `security-audit/engine/logger.ts`

### 14.2 改造后**默认行为**不变的代码

下列文件被改造，但默认参数 = `defaultAgentDirContext()` 兜底，老调用者一行不改也能跑：

- `core/persona/persona-manager.ts`（N4）
- `core/session/session-manager.ts`（N5）
- `core/soul-integration.ts`（N6）
- `core/mcp/mcp-config.ts` + `core/mcp/mcp-client.ts`（N7）
- `extensions/defaults/security-audit/engine/logger.ts`（N8）

### 14.3 行为变化但带 deprecation 期的代码

- `extensions/defaults/team/*`（N3 修 env bug 立即生效；N16–N19 重构有 `--legacy-team` 兼容窗口）
- `config.ts:CONFIG_DIR_NAME`（N12 切到 `.pencils`，旧 `.nanopencil` fallback ≥ 3 个 minor）

---

## 15. 待确认问题

> 以下问题阻塞对应 Phase 的启动。已标注「建议」供决策参考。

1. [ ] **CONFIG_DIR_NAME 切换时机**：是 N12 跟 `nanopencil --agent` 一起发，还是独立 release？
   - *建议*：一起发（N12 依赖 N9 + N11，拆开增加兼容测试成本）
2. [ ] **`AgentDirContext` 的 package 归属**：`core/agent-dir/`（仅 nanoPencil 内部）还是 `packages/agent-core/`（让 Gateway 也能 import）？
   - *建议*：先 `core/agent-dir/`，等 Gateway 实际需要 import 时再提取
3. [ ] **`agent.json` 由谁先写**：CLI（N10）还是 Gateway（G3）？
   - *建议*：CLI 先写（N10 先行），Gateway 读已有的；G3 补写 CLI 没创建的
4. [x] **N3 走紧急 patch** → *建议 yes，latent bug 不依赖任何其他改动*
5. [ ] **`memorySeed` 落盘格式**：per-file JSON / JSONL / mem-core 抽象？
   - *阻塞 G1（adopt 接口），需 nanoPencil mem-core 输入*
6. [ ] **`pencils migrate` 是子命令还是独立脚本**？
   - *建议*：子命令（跟着 npm 发布走，用户不需要额外安装）
7. [x] **`<ws_id>` 派生算法** → §5.2 已定（含 URL 归一化），实现细节在 N14
8. [ ] **workspace 创建时机**：CLI 自动 / Gateway 按需 / 显式 POST？
   - *建议*：CLI 进入含 `.git` 的目录时延迟创建（lazy init）
9. [ ] **Teams Phase 5 优先级**：现在做 vs 等 multi-pencil 稳定后？
   - *建议*：等 Phase 1-3 上线、至少 1 个 minor 稳定后再启动
10. [ ] **Cloud workspace 同步协议**：由 Asgard 还是 Gateway 主导？
    - *建议*：v0.x 不做；等 Pencil 包格式（§7）跑通后再评估
11. [ ] **Agent 自我演化"提升"流程 UI**？
    - *建议*：v0.x 先 CLI `/promote` 命令；editor 面板后续
12. [ ] **命名空间预留清单优先级**：哪些 v0.x 必建？
    - *建议*：v0.x 只建 `agents/<id>/extensions/` + `workspaces/<ws>/agent-overrides/<id>/`；其余 lazy

---

## 16. 关联文档

- 本文档**取代**之前的 [Pencil-Agent-Gateway/docs/16-pencils-storage-layout.md](../../Pencil-Agent-Gateway/docs/16-pencils-storage-layout.md) 与 [docs/17-nanopencil-multi-agent-impact-eval.md](../../Pencil-Agent-Gateway/docs/17-nanopencil-multi-agent-impact-eval.md) 作为唯一权威源。
- 上述两份 Gateway 侧文档已退化为"指向本文的导览"，保留为历史记录。
- [Pencil-Agent-Gateway/issues/0012-gateway-data-directory-alignment.md](../../Pencil-Agent-Gateway/issues/0012-gateway-data-directory-alignment.md) — Step A（agentDir/dataDir 显式化）已落地。
- nanoPencil `config.ts:207` `getAgentDir()` — 改造重心。
- nanoPencil `extensions/defaults/team/` — Phase 5 重构对象。

---

## 17. 修订历史

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-04-30 | v1（80 行精简稿）| 初版：Mind/Embodiment 哲学 + 4 阶段演进路径 |
| 2026-05-05 | **v2（本版）**| 合并 Pencil-Agent-Gateway 仓库 doc 16（完整设计 + 决策）+ doc 17（Step B 评估）；root 改 `~/.pencils/`；新增 agent.json / Workspace manifest / 三层 habits / 长期维护原则 / Gateway 与 nanoPencil 双仓库改造说明 / Teams 5 阶段重构。**自此本文为唯一权威源。** |
| 2026-05-06 | v2.1 | 修正 callsite 数据（34/53/47 而非 72，经实际 grep 验证）；§0.4 新增分工总览表；§5.2 ws_id 派生加 URL 归一化；§15 待确认问题加建议答案。Gateway doc 16 改为行动手册、doc 17 归档。 |
| 2026-05-09 | v2.2 | **Phase 1-3 任务（N1-N12）宣告完成**：正式支持 `--agent <id>`、`agent.json` 元数据、`pencils migrate` 安全拷贝工具；默认根目录切至 `~/.pencils/`；更新文档以符合 release 状态。 |
| 2026-05-13 | v2.3 | 新增 §7.5「Agent 三种形态分类」——SuperAgent / Derived / Custom 的产品语义、文件系统对照、Soul/Memory merge 规则、Asgard schema 字段、用户操作流程。新增 §10.4「P0–P5 产品演进路线」明确分阶段计划。**P0（每 Agent 独立 agentDir + agent.json）已在 Pencil-Agent-Gateway commit `1df2380` 落地**。 |
| 2026-05-13 | v2.4 | **P0.5（Soul 不被 cwd 污染，commit `48fe4ea`）+ P1（Agent 三态分类全链路 schema）落地**：§10.4 P0.5/P1 标 ✅；§10.5 改写为"P0–P1 已落地的具体行为差异"，新增 P0.5 修复说明、P1 Asgard DDL + Gateway/Asgard 透传 contract、Gateway `writeAgentMetadata` 行为变化。P0.5 实际方案与原计划不同：未做 `.PENCIL.md` seed，而是把 `cwd` 钉死到 agentDir + 显式 `resourceLoader.reload()` 绕过 SDK 限制。 |
