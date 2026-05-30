# Pencil 生态 Charter — 导航地图

> **状态**：active（2026-05-23 重组，从单文件拆分为目录）
> **角色**：Pencil 生态全部项目的**单一发展路线源头**
> **宿主**：nanoPencil 仓库 `charter/` 目录

<!--
[WHO]  Pencil 生态全部项目维护者及 AI coding agent
[FROM] 此前散落的三份总览：PROJECT_OVERVIEW.md、agent-projects-relations.md、docs/pencil-platform-charter.md
[TO]   各项目内的实施文档（各仓库 docs/、issues/、tasks/）
[HERE] nanoPencil/charter/ — 跨项目拓扑、术语、阶段、决策、里程碑的唯一源头目录
-->

---

## 这份 Charter 是什么

Charter 解决的核心问题：**一个参与者（人或 AI）在任一仓库工作时，只需读两样东西就能进入状态：**

1. **本 Charter**（生态级）
2. **当前仓的项目内 README / AGENTS.md**（项目级）

在 Charter 之前，生态级事实散落在三个地方，且只覆盖 4 个项目。现在合并到 `charter/` 目录，覆盖全部 10+ 项目。

### 不在 Charter 范围内

Charter **不承载**：
- API 契约细节 → Gateway `docs/02`
- 协议线格式 → Gateway `docs/18`
- 内部架构 → 各项目仓库
- 实施任务书 → 各项目 `tasks/`
- 项目内部术语 → 各项目 README

**判断方法**：一个事实只在一个项目内有意义 → 不进 charter；同时影响 ≥ 2 个项目 → 进 charter。

---

## 文件索引

| 文件 | 内容 | 回答什么 |
|------|------|----------|
| [01-ecosystem.md](./01-ecosystem.md) | 全景 | 有哪些项目、怎么分层、数据怎么流 |
| [02-boundaries.md](./02-boundaries.md) | 边界 | 每个项目是什么、不是什么 |
| [03-relations.md](./03-relations.md) | 关联 | 项目间怎么调用、怎么协作 |
| [04-glossary.md](./04-glossary.md) | 术语 | nanoPencil / PencilAgent / ACP 等词的规范定义 |
| [05-protocols.md](./05-protocols.md) | 协议 | HTTP/SSE、ACP、PCP、Channel 各自定位 |
| [06-roadmap.md](./06-roadmap.md) | 路线 | 阶段一→四的进展、A-F 工作线状态 |
| [07-decisions.md](./07-decisions.md) | 决策 | 影响多个仓库的重大决策记录 |
| [08-pointers.md](./08-pointers.md) | 指针 | 各仓库文档的跳转链接 |

---

## 修改流程

1. 任何对 charter 的修改都是**跨仓影响**的修改，必须通过 nanoPencil 仓库 PR 进行
2. PR 描述应明确：(a) 改动哪个文件/章节、(b) 触发的应用仓更新
3. 合并后由 CI 自动在 5 个核心仓库创建 `[charter-sync]` issue

## 防止重复

各应用仓文档遇到以下内容时，**只放短摘要 + charter 链接**，禁止全文重复：

- 项目拓扑 / 调用链拓扑
- 术语定义（PencilAgent / nano-pencil 等通用术语）
- 阶段总体描述
- 跨仓里程碑进度
- 跨项目决策

各应用仓**可以、应该**有的内容：

- 本项目内部架构（模块、类、文件路径）
- 本项目 API 契约 / 协议线格式
- 本项目实施计划
- 本项目内部业务术语

## 同步检测

**自动层** — `.github/workflows/charter-sync-notify.yml`

push 到 main 且修改了 `charter/` 目录时，自动在以下仓库开 issue：

| 目标仓 | 角色 |
|--------|------|
| `O-Pencil/Pencil-Agent-Gateway` | Gateway docs 引用 charter |
| `O-Pencil/nanopencil-editor` | Editor docs 引用 charter |
| `O-Pencil/Asgard-platform` | 平台元仓库 |
| `O-Pencil/Asgard-api` | 后端实现仓 |
| `O-Pencil/Asgard-web` | 前端实现仓 |

**Opt-out**：commit message 包含 `[skip-charter-sync]` 时不触发。

**人工层**：应用仓 PR 出现大段"属于 charter 的内容" → 先去 charter PR。

---

## 本 Charter 收编了哪些内容

| 源材料 | 处理动作 |
|--------|----------|
| `PROJECT_OVERVIEW.md`（Pencil 根目录）| 10+ 项目全景 → 01-ecosystem；架构层次 → 01-ecosystem；项目详解 → 02-boundaries |
| `agent-projects-relations.md`（Pencil 根目录）| 关联矩阵 → 03-relations；协作模式 → 03-relations |
| `docs/pencil-platform-charter.md`（nanoPencil）| 术语表 → 04-glossary；协议 → 05-protocols；阶段/里程碑 → 06-roadmap；决策 → 07-decisions；指针 → 08-pointers |

---

## 维护者文档

> ⚠ 本章节面向 **nanoPencil 维护者**。生态参与者无需阅读。

维护者内部操作手册、SAL 实验、诊断 SOP、架构审查等文档统一在 `.dev-docs/` 目录维护，通过本 charter 作为统一入口。

| 文档 | 内容 |
|------|------|
| [.dev-docs/README.md](../.dev-docs/README.md) | 维护者手册入口（维护者读什么、从哪开始） |
| [.dev-docs/sal/roadmap.md](../.dev-docs/sal/roadmap.md) | SAL 认知图实验规划 |
| [.dev-docs/diagnosis/sop.md](../.dev-docs/diagnosis/sop.md) | 日常 issue 分诊流程 |
| [.dev-docs/self-awareness/charter.md](../.dev-docs/self-awareness/charter.md) | 自我诊断治理与路线 |
| [.dev-docs/architecture-review/README.md](../.dev-docs/architecture-review/README.md) | Architecture Review Agent 流程 |

**维护者边界合约**：
- 无 cron / 无自动调度；所有 runs 手动 dispatch
- 不写入用户状态（`~/.pencils/agents/<id>/`）
- 不将内部工具注入用户 session（`extensions/builtin/` 外）

---

**Covenant**：本目录是生态级单一源头。维护 charter ↔ 各仓指针的 isomorphism，等价于维护整个生态文档系统的可信度。
