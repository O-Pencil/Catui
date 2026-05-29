# Industry Protocol & Runtime Survey — 2026-05-28

```yaml
phase: 3a-supplementary
produced_at: 2026-05-28T08:50:00Z
status: draft
purpose: |
  为 target-architecture.md §3.5 PARP 抽象提供业界对标证据。
  回答："PARP 是新发明的协议，还是已有协议的组合契约？"
  结论：是后者。PARP 五层中 3 层（Host Adapter / Tool Runtime / Host↔Host）
  已有事实标准（ACP / MCP / A2A），1 层（Agent Profile）有多个工业框架对位，
  仅 1 层（Continuity）业界普遍留白——这是 pencil 的真正差异化点。
relationship_to_target_arch: |
  本文是 target-architecture.md §3.5 与 top-level-structure-review.md §5.5
  的"引用源"。本文不直接定义 PARP；PARP 权威定义仍在 target-architecture.md。
  本文只回答："为什么 PARP 不应自造协议，应当对位 MCP/ACP/A2A"。
audience: pencil maintainer · arch agent · 未来 PARP RFC 作者
```

> **文档职责**：本文是 Phase 3a 在 grilling 期间发现"PARP 命名风险被误解为造轮子"后补做的业界证据层。
> 不维护 PARP 定义，不维护目录树，不维护迁移路径——只回答"业界已有什么、PARP 与之关系是什么"。
>
> **覆盖范围**：3 个 Agent 协议标准（ACP/MCP/A2A）+ 5 个 Agent Runtime 框架（LangGraph/OpenAI Agents SDK/Microsoft Agent Framework/Vercel AI SDK/Continue.dev）+ 3 篇直接对位论文。调研时间窗：2026-05-28 上午。

---

## 1. 调研动机

target-architecture.md §3.5 提出 PARP（Pencil Agent Runtime Protocol）作为候选 D 之上的产品架构解释层，组合公式：

```text
PencilAgent =
  Agent Loop + Tool Runtime + Agent Profile
  + Continuity + Host Adapter + Permission Policy
```

grilling 期间出现一个真实风险：**PARP 字面读起来像"又一个 wire protocol"**——若维护者或外部贡献者误以为 PARP 要重新定义 Editor↔Agent、Host↔Tool、Host↔Host 的传输层，会得出"造轮子"的判断并拒绝。

本文用业界证据回答两个问题：

1. PARP 五层中**哪些层业界已有事实标准**？这些标准应被 PARP 直接采纳而非重复发明
2. PARP 真正独立的贡献是什么？这部分需要 pencil 自己定义

---

## 2. 业界已有协议标准（直接对位 PARP 三层）

### 2.1 ACP — Agent Client Protocol（Host Adapter 层的事实标准）

| 属性 | 内容 |
|------|------|
| 维护方 | Zed Industries → agentclientprotocol/agent-client-protocol（Apache License）|
| 角色定位 | Editor ↔ Agent 之间的标准接口（"the LSP for AI coding agents"）|
| 协议版本 | v1 stable |
| 传输 | JSON-RPC 2.0 over stdio（local subprocess integration）|
| 2026 现状 | ACP Registry 上线，已收录 Claude Code、Codex CLI、GitHub Copilot CLI、OpenCode、Gemini CLI 等；JetBrains IDE 2025 末加入支持；社区 Neovim / Emacs / VS Code 集成完备；Zed 1.0 已于 2026-04-29 发布 |
| nanoPencil 现状 | 已对接：`@agentclientprotocol/sdk@^0.16.1`（见 `nanoPencil/package.json:88`）；`modes/acp/` 是 ACP host adapter 实现 |

**与 PARP 的关系**：PARP 的"Editor Host Adapter" = ACP 本身。`packages/extension-sdk/host-adapter.ts` 不应自定义 editor↔agent 接口，应直接 re-export ACP 类型。

### 2.2 MCP — Model Context Protocol（Tool Runtime 层的事实标准）

| 属性 | 内容 |
|------|------|
| 维护方 | Anthropic 主推，modelcontextprotocol/* GitHub org，2025-11-25 spec |
| 角色定位 | Host application ↔ Tool/Resource server 之间的标准接口 |
| 架构 | Client-server，一个 host 多个 isolated MCP client sessions，stateful JSON-RPC channel |
| 传输 | stdio（本地 server，Claude Desktop / Claude Code 默认）+ Streamable HTTP（2025-11 spec 引入，取代旧 SSE）|
| 认证 | OAuth 2.1（2025-06 spec 起，OAuth Resource Server 模型，`.well-known` endpoints）|
| 2026 现状 | 97M+ monthly SDK downloads；81k+ GitHub stars；Anthropic / OpenAI / Google / Microsoft / AWS 全部原生支持；2026 roadmap 聚焦 stateless 操作 + session migration + agent-to-agent + 企业级 audit/SSO/gateway |
| nanoPencil 现状 | 已对接：`core/mcp/mcp-client.ts` + `core/mcp/mcp-config.ts`；extensions/defaults/mcp 集成 |

**与 PARP 的关系**：PARP 的 Tool Runtime 五种实现（local / remote / browser / mcp / hosted）中，**remote / mcp / hosted 三种应当统一为 MCP transport**。`packages/extension-sdk/tool-runtime.ts` 应明确声明"远程工具调用 = MCP"，不再造新 wire protocol。

### 2.3 A2A — Agent2Agent Protocol（Host↔Host / Cross-Runtime 层的事实标准）

| 属性 | 内容 |
|------|------|
| 维护方 | Google 2025-04 announce → 2025 中 donated to Linux Foundation；a2aproject/A2A GitHub |
| 角色定位 | Agent ↔ Agent 跨 framework / 跨 vendor 通信 |
| 协议版本 | v1.2 stable（2026-05 时点）|
| 传输 | HTTP / Server-Sent Events / JSON-RPC 2.0 |
| 核心原语 | AgentCard at `/.well-known/agent.json`（JSON 文档描述 agent 能力与认证要求）|
| 2026 现状 | 150+ 组织生产使用（Salesforce / SAP / ServiceNow / Deutsche Bank 等）；native support 已落地 Google ADK、LangGraph、CrewAI、LlamaIndex、Semantic Kernel；MS Agent Framework 1.0 通过 A2A 实现 .NET ↔ Python 互通 |
| nanoPencil 现状 | 未对接；team / sub-agent 扩展是 in-process 多 agent，不跨 runtime |

**关键观察 — 给 PARP Continuity 层划边界**：

> A2A 规范明确声明："agents exchange information **without** access to each other's internal state, memory, or tools."（见 a2a-protocol.org/latest/specification/）

这条声明等于把"跨 agent 共享 memory / personality / canonical state"的设计空间**整个留白**。PARP 的 `core/continuity/` 在 A2A 划定的"不外包"区域内工作，**两者不冲突**：A2A 管 agent 之间的协议化通信；PARP Continuity 管单个 PencilAgent 内部的连续性内核。

**与 PARP 的关系**：未来 PencilAgent 之间通信（CLI PencilAgent ↔ Gateway PencilAgent ↔ Editor PencilAgent）应走 A2A，不应自造跨 host 协议。`packages/extension-sdk/` 应预留 `a2a-bridge.ts`（B0 不必实现，留命名占位即可）。

---

## 3. 相邻的 Agent Runtime 框架（Agent Profile 层的工业对位）

### 3.1 LangGraph — 命名上最直接的对位

LangChain 官方博客标题为 **"Building LangGraph: Designing an Agent Runtime from first principles"**——与 PARP（Pencil Agent Runtime Protocol）命名完全同形。

定位："low-level supporting infrastructure for any long-running, stateful workflow or agent"。

**差异分析**：
- LangGraph 偏 **graph orchestration**（节点 / 边 / 状态机），强调 durable execution、HITL、tool composition
- PARP 偏 **profile composition**（loop + tool runtime + continuity + host adapter + permission 五元组合）
- 两者不冲突；LangGraph 是工作流编排引擎，PARP 是多形态 agent 标准化契约
- 已通过 A2A 对接生态

### 3.2 OpenAI Agents SDK — 四原语映射

| OpenAI 原语 | 文档位置 | PARP 对应层 |
|------------|---------|-----------|
| `Agent` | `openai.github.io/openai-agents-python/agents/` | Agent Profile |
| `Tool` | 同上 tools/ | Tool Runtime |
| `Handoff` | 同上 handoffs/ | Profile 间 transfer（PARP 未明确，可补）|
| `Guardrail` | 同上 guardrails/ | Permission Policy |

**对 PARP 的直接启示**：OpenAI 把 handoff "represented as tools to the LLM"（如 `transfer_to_refund_agent`）——这告诉 PARP，profile 之间的切换可以**走 tool runtime 接口**，不需要新协议。

Guardrails 双模式（parallel / blocking）+ input/output 双侧检查，可直接被 PARP `permission-policy` 模仿。

### 3.3 Microsoft Agent Framework 1.0（GA 时点 2026-04-03）

业界最接近 PARP 完整抽象的工业框架：

| MS Agent FW 概念 | 引用 | PARP 对应 |
|----------------|------|-----------|
| "Agents as first-class primitives with instructions, tools, memory, and state that are **pluggable at the agent level**" | devblogs.microsoft.com/agent-framework/microsoft-agent-framework-version-1-0/ | Agent Profile（含 continuity 局部）|
| Graph workflow engine（吸收 AutoGen orchestration concepts）| 同上 | 不直接对位（pencil 不做多 agent 编排）|
| 声明式 YAML 定义 agent + workflow | 同上 | **直接可参考的落地形态**——B0 `core/agent-profile/` 可以模仿 |
| Magentic-One / sequential handoffs / group chat 三种 orchestration pattern | 同上 | 未来扩展方向 |
| 跨 runtime 通过 A2A | 同上 | 印证"A2A 是 Host↔Host 事实标准" |
| First-party connectors: Foundry / Azure OpenAI / OpenAI / Anthropic / Bedrock / Gemini / Ollama | 同上 | 与 packages/ai providers 同形 |

**直接启示**：PARP `core/agent-profile/` 的 schema 可直接抄 MS Agent Framework 1.0 的 YAML 结构；时间窗口正好衔接（MS GA 2026-04-03，nanoPencil B0 在 2026-05 后启动）。

### 3.4 Vercel AI SDK 6 — TypeScript 同语言对位

- 原语：`Agent` / `ToolLoopAgent`（"first-class autonomous-loop support — multi-step planning, stop conditions, tool sequencing"）
- 核心理念："Define your agent once with its model, instructions, and tools, then use it across your entire application"——与 PARP profile 思想完全一致
- 优势：streaming UI 一等公民
- 缺点：不管 continuity；不管 host adapter（只是个库）

**对 PARP 启示**：profile 应当是**可命名、可复用、可在多个 host 间共享**的对象，不是"启动时拼装的临时配置"。

### 3.5 Continue.dev — 顶层结构同形（已被 target-architecture §5.5 引用）

`core/` + `packages/`（含 `continue-sdk`）+ `extensions/{vscode,intellij,cli}` —— 与候选 D 拓扑完全相同。

两个具体细节给 PARP Host Adapter 提供活样本：
- VS Code 扩展 **embeds Core directly**（in-process host adapter）
- IntelliJ **通过独立 binary process + stdin/stdout JSON**（out-of-process host adapter，与 ACP 同模式）

**这就是 PARP Host Adapter 抽象的工程证据**：同一 Core 通过不同 host adapter 适配不同 IDE，对应 ACP 的设计意图。

---

## 4. 学术论文（两篇直接对位）

### 4.1 arXiv 2604.03515 — "Inside the Scaffold: A Source-Code Taxonomy of Coding Agent Architectures"（2026-04）

13 个开源 coding agent 在锁定 commit 上的源码级分类。**三层 × 12 维度**：

| 论文三层 | 12 维度示例 | PARP 对应 |
|---------|------------|-----------|
| Control Architecture | loop primitive / planning strategy / multi-attempt policy | Agent Loop + Agent Profile（loop policy 部分）|
| Tool and Environment Interface | tool count / edit format / execution isolation / sandbox | Tool Runtime + Host Adapter |
| Resource Management | context compaction / state management / multi-model routing | Continuity |

**核心发现 1（背书 PARP 的组合公式）**：5 个 loop 原语（ReAct / generate-test-repair / plan-execute / multi-attempt retry / tree search）"function as composable building blocks"，**11/13 agents 组合多个原语而非依赖单一控制结构**——直接背书 PARP 把 agent 表达为"原语组合"而非"单一架构"的思想。

**核心发现 2（背书 PARP 的 Continuity 选择）**：
- **收敛维度**（外部约束主导）：tool capability categories / edit formats / execution isolation
- **发散维度**（开放设计问题）：context compaction / state management / multi-model routing

PARP Continuity 层落在**发散维度**——这意味着标准化阻力大但价值最高。pencil 在 `core/continuity/` 投入自定义内核（canonical state / merge policy / prompt injection policy）是**有论文支撑的合理选择**，因为业界协议无人填补此空白。

### 4.2 arXiv 2603.05344 — "Building AI Coding Agents for the Terminal: Scaffolding, Harness, Context Engineering, and Lessons Learned"（OpenDev）

提出四层架构：Entry & UI / Agent Core / Tool & Context / Persistence。

**关键概念分离（与 PARP 高度同构）**：

> **Scaffolding** = 构造期（before first prompt）：system prompt、tool schemas、subagent registry 的 eager initialization
>
> **Harness** = 运行期：ReAct loop、approval、context compaction、session persistence

明确分离 4 个概念：
- Agent Loop（Extended ReAct with explicit thinking/critique phases）
- Tool Runtime（Registry-based dispatch with schema filtering）
- Host Adapter（Provider abstraction enabling multi-model routing）
- **Profile/Configuration（per-workflow LLM selection via five specialized model roles）**

**这是除 PARP 外业界最完整的对齐**。OpenDev 提出"五种专门模型角色"的 profile 概念，与 PARP profile = (loop policy + tool runtime + continuity + host adapter + permission) 同源——只是 PARP 维度更全（OpenDev 主要是 model role profile，PARP 是完整 agent 形态 profile）。

### 4.3 arXiv 2512.10398 — "Confucius Code Agent: Scalable Agent Scaffolding for Real-World Codebases"

可作为 PARP scaffolding 部分（系统 prompt 装配、skill 注册）的参考。本调研未深读。

---

## 5. 工业博客（PARP 的"思想前辈"）

| 来源 | URL | 关键观点 | 对 PARP 启示 |
|------|-----|---------|-------------|
| LangChain "Anatomy of an Agent Harness" | langchain.com/blog/the-anatomy-of-an-agent-harness | 一个中央 ReAct loop + 7 子系统（message queue / prompt composition / tool registry / safety / context engineering / memory / session）| 子系统列表可作为 PARP 内部模块 checklist |
| Addy Osmani "Agent Harness Engineering" | addyosmani.com/blog/agent-harness-engineering/ | "every piece of code, configuration, and execution logic that isn't the model itself"; "10 focused tools outperform 50 overlapping ones" | PARP 应避免 tool runtime 过度泛化；保持工具列表 minimal |
| Browser-use "The Bitter Lesson of Agent Harnesses" | browser-use.com/posts/bitter-lesson-agent-harnesses | 模型能力上升，harness 抽象会被压缩；最有韧性的是 **filesystem + 通用 tool runtime + 简单 loop** | PARP 长期不应在 loop 层堆 ceremony；保持 minimal |
| Aakash Gupta "2025 Was Agents. 2026 Is Agent Harnesses" | aakashgupta.medium.com | 2026 是 harness 年——HITL / filesystem / tool orchestration / sub-agent coordination 四件套 | PARP 时间窗口正当其时 |

---

## 6. PARP 五层 × 业界覆盖矩阵（核心结论）

| PARP 层 | 已有事实标准 | 工业框架抽象 | 学术覆盖 | **PARP 的独立贡献** |
|---------|-------------|------------|---------|-------------------|
| **Agent Loop** | — | LangGraph / OpenAI Agents SDK / Vercel AI SDK / MS Agent FW 全部成熟 | Scaffold paper 5 原语 | **无独立贡献**——应直接复用现有原语；不发明新 loop primitive |
| **Tool Runtime** | **MCP** 已成事实标准 | 所有框架都有 tool registry | Scaffold paper 收敛维度 | 应声明"MCP = remote tool runtime branch"；local tool runtime 留 pencil 自定义但接口与 MCP 同形 |
| **Agent Profile** | — | OpenAI Agents / MS Agent FW (YAML) / Vercel Agent 都有 | OpenDev "5 specialized roles" | PARP 可贡献：**显式的 profile = loop + runtime + continuity + host + permission 五元组合公式** + 声明式 YAML schema（参考 MS Agent FW 1.0）|
| **Host Adapter** | **ACP** 已成事实标准 | Continue.dev 双 host 实现 | OpenDev 提及但未深 | 应声明"ACP = editor host adapter; HTTP/SSE = remote host adapter (走 A2A 形态)"；CLI host adapter 留 pencil 自定义 |
| **Continuity** | **A2A 明确放弃** ("without access to memory/state/tools")；MCP 不管；ACP 不管 | LangGraph state / MS memory 都浅 | OpenDev 双 memory 提及；Scaffold paper 发散维度 | **★ 这是 PARP 真正独立的贡献**——业界协议全部留白；canonical state + provenance + merge policy + prompt injection policy 值得独立 RFC |
| **Permission Policy** | — | OpenAI Guardrails / MS approval / Anthropic skill permissions | Scaffold paper 提及 sandbox | 应吸收 OpenAI Guardrails 双模式（parallel/blocking）+ input/output 双侧检查；不重新发明 |

**一句话总结**：PARP 五层中 **4 层应当对位已有标准**（ACP / MCP / A2A / OpenAI Guardrails 形态），**仅 Continuity 一层是 pencil 的真正原创贡献**。这与 grilling 期间的修订（"官方保留连续性内核解释权，不外包给插件"）方向一致。

---

## 7. 对 target-architecture.md 的具体修订建议

| 位置 | 修订动作 | 措辞建议 |
|------|---------|---------|
| §3.5 PARP 章节开头 | 加一段"PARP 不是新 wire protocol" | "PARP is **not** a new wire protocol; it is a composition contract over MCP (Tool Runtime) + ACP (Editor Host Adapter) + A2A (Host↔Host) plus pencil-defined Continuity & Profile layers." |
| §3.5.2 五层协议边界表 | 增加"业界对位标准"列 | Agent Loop=internal; Tool Runtime=**MCP**; Agent Profile=internal (参考 MS Agent FW YAML); Host Adapter=**ACP** + future A2A; Continuity=**pencil 独有**; Permission=internal (参考 OpenAI Guardrails 形态) |
| §3.5.3 工具协议 | 在 `AgentToolProtocol` 接口后补一句 | "对于 `runtime: 'remote' \| 'mcp' \| 'hosted'`，wire format 直接采用 MCP；`runtime: 'local' \| 'browser'` 由 pencil 内部实现但接口与 MCP 同形。" |
| §3.5.4 与候选 D 的关系 | 在 `packages/extension-sdk/` 列表上加一行 | "extension-sdk 的协议文件应是**对 MCP/ACP/A2A 的 re-export 或薄封装**，而非自造类型；唯一真正自定义的协议契约是 `continuity-*` 系列与 `agent-profile.ts`。" |
| §4 目录树 `packages/extension-sdk/src/` | 补充注释 | `host-adapter.ts` ← re-export ACP types + 自定义 CLI host adapter；`tool-runtime.ts` ← re-export MCP types + 自定义 local/browser runtime；新增 `a2a-bridge.ts`（B0 可只留 stub） |
| §6 决策点 | 新增 Q15 | "Q15 — PARP 命名是否引发'造轮子'误解？决议：在文档显式声明 PARP = composition contract over MCP/ACP/A2A；命名不变" |

## 8. 对 top-level-structure-review.md 的具体修订建议

| 位置 | 修订动作 |
|------|---------|
| §5.5 业界对标 | 扩展为两部分：**5.5.A 项目布局对标**（保留现有 OpenClaw / Continue / Codex / Nanobot / Aider 表）+ **5.5.B 协议标准对标**（新增 ACP / MCP / A2A + LangGraph / OpenAI Agents SDK / MS Agent Framework / Vercel AI SDK；引用本文 §2–§3）|
| §6.D.1.1 PARP 段落 | 在 PARP 一句话定义后插入引用："业界证据与五层对位详见 `industry-protocol-survey.md` §6 覆盖矩阵" |

---

## 9. 来源清单（按引用顺序）

### 协议标准
- ACP — [zed.dev/acp](https://zed.dev/acp)；GitHub [agentclientprotocol/agent-client-protocol](https://github.com/agentclientprotocol/agent-client-protocol)；[ACP Registry — Zed Blog](https://zed.dev/blog/acp-registry)
- MCP — [Specification 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25)；[Anthropic engineering: Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)
- A2A — [Specification](https://a2a-protocol.org/latest/specification/)；GitHub [a2aproject/A2A](https://github.com/a2aproject/A2A)；[Google Developers Announcement](https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/)

### 工业框架
- LangGraph — [Building LangGraph from first principles](https://www.langchain.com/blog/building-langgraph)；[langchain-ai/langgraph](https://github.com/langchain-ai/langgraph)
- OpenAI Agents SDK — [openai-agents-python docs](https://openai.github.io/openai-agents-python/)；handoffs / guardrails 子页
- Microsoft Agent Framework 1.0 — [DevBlogs Version 1.0 announcement](https://devblogs.microsoft.com/agent-framework/microsoft-agent-framework-version-1-0/)
- Vercel AI SDK 6 — [vercel.com/blog/ai-sdk-6](https://vercel.com/blog/ai-sdk-6)
- Continue.dev — [DeepWiki: continuedev/continue](https://deepwiki.com/continuedev/continue)

### 论文
- Inside the Scaffold — [arXiv 2604.03515](https://arxiv.org/abs/2604.03515)
- Building AI Coding Agents for the Terminal — [arXiv 2603.05344](https://arxiv.org/html/2603.05344v1)
- Confucius Code Agent — [arXiv 2512.10398](https://arxiv.org/html/2512.10398v5)

### 工业博客
- LangChain "Anatomy of an Agent Harness" — [langchain.com/blog/the-anatomy-of-an-agent-harness](https://www.langchain.com/blog/the-anatomy-of-an-agent-harness)
- Addy Osmani "Agent Harness Engineering" — [addyosmani.com/blog/agent-harness-engineering/](https://addyosmani.com/blog/agent-harness-engineering/)
- Browser-use "Bitter Lesson of Agent Harnesses" — [browser-use.com/posts/bitter-lesson-agent-harnesses](https://browser-use.com/posts/bitter-lesson-agent-harnesses)
- Aakash Gupta "2025 Was Agents. 2026 Is Agent Harnesses" — [aakashgupta.medium.com](https://aakashgupta.medium.com/2025-was-agents-2026-is-agent-harnesses-heres-why-that-changes-everything-073e9877655e)

---

## 10. 调研边界与后续

**本文不做什么**：
- 不实现任何代码；不修订 target-architecture.md / top-level-structure-review.md（只给出 §7 / §8 建议）
- 不深读 arXiv 2512.10398；不验证 ACP/MCP/A2A 规范的每个字段
- 不评估 LangGraph / OpenAI Agents SDK 是否值得作为 dependency 引入 nanoPencil

**后续工作**：
1. maintainer 审阅本文 §7 / §8 建议；同意后由 Arch Agent 落到 target-architecture / top-level-structure-review
2. 若 PARP Continuity 层未来要独立化（如发表 RFC、对外推广），本文可作为相关比对章节的草稿
3. B0 批次执行时，`packages/extension-sdk/host-adapter.ts` 与 `tool-runtime.ts` 应直接引入 `@agentclientprotocol/sdk` 与 `@modelcontextprotocol/sdk` 的类型，按本文 §7 表执行

---

## 11. 状态

- [x] 协议标准调研（ACP / MCP / A2A）
- [x] 工业框架调研（LangGraph / OpenAI / MS / Vercel / Continue）
- [x] 论文调研（Scaffold taxonomy / OpenDev terminal agent）
- [x] 覆盖矩阵（§6）
- [x] 对核心文档的修订建议（§7 / §8）
- [ ] maintainer 审阅
- [ ] target-architecture.md §3.5 落地修订
- [ ] top-level-structure-review.md §5.5 落地修订
