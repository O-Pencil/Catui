<!--
catui 基础分类课程目录(C0–C10)。这是被学习对象的大纲,不是任何人的学习结果。
锚点为本文撰写时(catui-agent 1.1.10)的事实;教学时应现场用 Read/Grep 核对再讲(file:line 会随代码漂移)。
每个概念字段:为什么这么设计 | 横切关键文件 file:line | P2 DIP 节点 | 排查入口 | 依赖边 | 对应 docs。
-->

# catui 课程目录:基础分类 C0–C10

按**维护者心智模型**横切(非目录)。顺序 = 依赖顺序,定位在前。教学 Agent 据此 + `wizard.md` 裁个性化路径。

> 用法:每节是一课的"大纲卡"。讲之前先 `Read`/`Grep` 核对锚点(代码会动);讲完按 `kb-integration.md` 沉淀进学习者个人 vault。

---

## C0 · 整体设计与框架

- **维护者问题**:这东西整体怎么搭的?我怎么自己找路?
- **为什么这么设计**:四层拓扑(Entry→Core→Tool→Interface)把"入口/核心/能力/呈现"解耦;DIP 三相代码地图让任何人能自助导航,不靠口口相传。
- **横切关键文件**:`cli.ts`(入口)→ `main.ts:5`(args→`CreateAgentSessionOptions`→mode 选择)→ `main.ts:30` `createAgentSession`;`AGENTS.md`(P1 拓扑/目录/子系统);`scripts/verify-dip.ts`(地图同构校验)。
- **P2 DIP 节点**:`core/AGENT.md`、`AGENTS.md`(P1)。
- **DIP 怎么用**:P1=`AGENTS.md` 全局地图;P2=每目录 `AGENT.md` 成员表;P3=每文件头 `[WHO]/[FROM]/[TO]/[HERE]`。从 P1 找子系统 → P2 找文件 → P3 头确认职责。
- **排查入口**:启动行为异常先看 `main.ts` 的 mode 选择;"这能力在哪个目录"查 `AGENTS.md` Directory Structure / Key Subsystems。
- **依赖边**:无(起点)。
- **对应 docs**:`AGENTS.md`。

## C1 · Agent Loop 核心

- **维护者问题**:一次对话回合(turn)到底怎么跑完?
- **为什么这么设计**:把"会话编排"(AgentSession)与"循环本体"(agent-core 的 Agent)分离 —— session 管生命周期/事件/工具装配,agent-core 只跑 prompt→模型→工具→回灌的纯循环,便于复用与测试。
- **横切关键文件**:`core/runtime/agent-session.ts:1117` `prompt()` → `:1270` `this.agent.prompt()`;`core/lib/agent-core/src/agent.ts:173` `class Agent`;循环 `core/lib/agent-core/src/agent-loop.ts:303`(`while(true)`)与 `structured-adaptive-agent-loop.ts:227`;工具编排 `structured-adaptive-tool-orchestration.ts`。
- **P2 DIP 节点**:`core/runtime/AGENT.md`、`core/lib/agent-core/AGENT.md`、`core/lib/ai/AGENT.md`(模型流式)。
- **排查入口**:回合不停/卡住 → `agent-loop.ts:303` 的停止条件;工具调用没触发 → 编排器 `core/tools/orchestrator.ts`;事件没发出 → AgentSession 的事件发射。
- **依赖边**:C0。
- **对应 docs**:`docs/sdk.md`(嵌入视角)。

## C2 · 会话生命周期与上下文

- **维护者问题**:对话历史怎么存、怎么分支、上下文满了怎么办?
- **为什么这么设计**:会话以 jsonl 持久化并支持 branch/fork,使"回到过去/并行尝试"可行;compaction 在上下文窗口将满时摘要历史,避免溢出且尽量不丢信息。
- **横切关键文件**:`core/session/`(SessionManager,持久化/branching);`core/session/compaction/compaction.ts`(`CompactionController`/`compactSession`);`core/session/compaction/branch-summarization.ts`;持久化路径 `~/.catui/agents/<id>/sessions/*.jsonl`。
- **P2 DIP 节点**:`core/session/AGENT.md`。
- **排查入口**:历史丢失/串话 → SessionManager 的 branch 读取;上下文莫名被截 → `compaction.ts` 的触发阈值;fork 后摘要不对 → `branch-summarization.ts`。
- **依赖边**:C1。
- **对应 docs**:`docs/sdk.md`(`./session`、`./session/compaction` 子路径导出)。

## C3 · 模型与 provider

- **维护者问题**:模型从哪来、怎么鉴权、怎么切换?启动链怎么走?
- **为什么这么设计**:ModelRegistry 统一管理多 provider/自定义 provider 与鉴权(API key/OAuth),把"选模型"与"跑模型"解耦;启动时 MCP 改为异步预热以不阻塞 UI。
- **横切关键文件**:`core/model-registry.ts`(ModelRegistry);`core/model-resolver.ts:27`(`resolveCliModel`/`resolveModelScope`);`core/model/custom-providers.ts`;`core/runtime/sdk.ts`(`createAgentSession`、`deferMcpInit`);MCP 异步预热见 `agent-session.ts` 的 `warmupMcpTools()`。
- **P2 DIP 节点**:`core/model/AGENT.md`、`core/runtime/AGENT.md`。
- **排查入口**:模型找不到/选错 → `model-resolver.ts`;鉴权失败 → `custom-providers.ts` / auth.json 读取;启动慢 → `sdk.ts` 的 MCP/soul 初始化(`NANOPENCIL_TIMING=1`/`CATUI_*` 计时)。
- **依赖边**:C1。
- **对应 docs**:`docs/models.md`、`docs/providers.md`、`docs/custom-provider.md`。

## C4 · 工具系统

- **维护者问题**:有哪些工具?工具怎么定义/注册/校验/执行?扩展工具和 MCP 工具怎么并到一张表?
- **为什么这么设计**:用统一 `ToolDefinition` + 编排器,使内置工具、扩展贡献工具、MCP 工具走同一注册/执行/权限路径;MCP 工具用 factory 延迟装配以支持异步与 `/reload`。
- **横切关键文件**:内置工具 `core/tools/{bash,read,edit,write,grep,find,ls,source}.ts`;编排 `core/tools/orchestrator.ts`(`ToolOrchestrator`);装配 `core/runtime/agent-session.ts:280-417`(`customTools`/`mcpToolsFactory`/`_customTools`)、`:2370` `registerTool(AGENT_TOOL_NAME…)`;类型 `ToolDefinition`(来自 `core/extensions-host`)。
- **P2 DIP 节点**:`core/tools/AGENT.md`、`core/mcp/AGENT.md`。
- **排查入口**:工具没出现 → `agent-session` 的工具装配 + `mcpToolsFactory`;参数校验报错 → 该工具的 schema;权限被挡 → 编排器/工具的权限检查。
- **依赖边**:C1。
- **对应 docs**:(无独立手册;并入 `docs/sdk.md`/`docs/extensions.md`)。

## C5 · 扩展系统

- **维护者问题**:扩展怎么被发现/加载?能改什么?内置扩展有哪些?
- **为什么这么设计**:extensions-host 用 loader/runner/wrapper 把第三方能力以受控钩子接入(注册工具/命令/键位/UI、改 prompt/context),不让扩展直接侵入核心。
- **横切关键文件**:`core/extensions-host/{loader,runner,wrapper,types}.ts`;内置 `extensions/builtin/`(`interview/grub/loop/link-world/browser/discipline/mcp/security-audit/soul/token-save/teach`)。
- **P2 DIP 节点**:`core/extensions-host/AGENT.md`、`extensions/AGENT.md`、`extensions/builtin/AGENT.md`。
- **排查入口**:扩展没加载 → `loader.ts` 的发现逻辑;钩子没触发 → `runner.ts` 事件发射;工具被包装后行为异常 → `wrapper.ts`。
- **依赖边**:C4。
- **对应 docs**:`docs/extensions.md`。

## C6 · 子代理与隔离

- **维护者问题**:Agent 工具怎么派子代理?怎么做 git/工作区隔离?
- **为什么这么设计**:子代理在独立 worktree 中跑,避免污染主工作区;registry 管理子代理类型与生命周期。
- **横切关键文件**:`core/sub-agent/`(Agent 工具、registry、worktree 隔离);`core/workspace/`(worktree manager / git 隔离)。
- **P2 DIP 节点**:`core/sub-agent/AGENT.md`、`core/workspace/AGENT.md`。
- **排查入口**:子代理改动丢失/冲突 → `core/workspace/` 的 worktree 创建/清理;派不出子代理 → `core/sub-agent/` 的 registry。
- **依赖边**:C4、C5。
- **对应 docs**:(并入 `docs/sdk.md`)。

## C7 · 运行模式与 TUI

- **维护者问题**:interactive/print/rpc/acp 四模式差别?TUI 怎么渲染?
- **为什么这么设计**:同一 AgentSession 之上挂不同前端(TUI 交互 / 流式 print / IDE 的 rpc / acp),按需懒加载模式以省启动开销;TUI 渲染器对每行宽度有不变量(刚修过窄终端崩溃)。
- **横切关键文件**:`modes/interactive/interactive-mode.ts`、`modes/print/print-mode.ts`、`modes/rpc/rpc-mode.ts`、`modes/acp/acp-mode.ts`;渲染器 `core/lib/tui/src/tui.ts`(差分渲染 + 宽度不变量)。
- **P2 DIP 节点**:`modes/AGENT.md`、`modes/interactive/AGENT.md`、`modes/rpc/AGENT.md`、`modes/acp/AGENT.md`、`core/lib/tui/AGENT.md`。
- **排查入口**:某模式没起来 → `main.ts` mode 选择 + 对应 `*-mode.ts`;TUI 崩/错位 → `core/lib/tui/src/tui.ts` 渲染路径(`CATUI_STRICT_RENDER=1` 暴露超宽行);组件不截断 → 看该组件 render。
- **依赖边**:C1。
- **对应 docs**:`docs/tui.md`、`docs/themes.md`、`docs/keybindings.md`。

## C8 · 提示词工程

- **维护者问题**:system prompt 怎么拼?docs 怎么注入?skills 怎么接?
- **为什么这么设计**:把系统提示组装集中,运行时按需注入项目文档(被问到某功能就指向 `docs/*.md`)与 skills,使能力可发现、可裁剪。
- **横切关键文件**:`core/prompt/system-prompt.ts`(组装;`:308` 列出被引用的 `docs/*.md`);skills 经 `discipline` 扩展 + `skills.ts` 公共导出。
- **P2 DIP 节点**:`core/prompt/AGENT.md`。
- **排查入口**:提示里少了某段 → `system-prompt.ts` 组装顺序;Agent 找不到功能手册 → `docs/` 对应文件是否还是 stub;skill 没生效 → `discipline` 扩展。
- **依赖边**:C1、C5。
- **对应 docs**:`docs/skills.md`、`docs/prompt-templates.md`。

## C9 · 生态集成(只映射)

- **维护者问题**:O-Pencil(GUI)和 Gateway 怎么消费这个核心?有什么集成断点?
- **为什么这么设计**:核心以 `@catui/agent` SDK 形式被 GUI 与网关复用,形成「核心引擎 → GUI 展现 → Gateway 触手」生态。
- **横切关键**:见 `ecosystem-map.md`(三仓契约 + `@pencil-agent/nano-pencil → catui-agent` 漂移)。
- **P2 DIP 节点**:`packages/protocol/AGENT.md`(公共契约);跨仓在 `O-Pencil/`、`Pencil-Agent-Gateway/`。
- **排查入口**:GUI/网关跑不起来或类型对不上 → 下游仍依赖旧包 `@pencil-agent/nano-pencil`(漂移,见 ecosystem-map)。
- **依赖边**:C1、C3。
- **对应 docs**:`docs/sdk.md`、`docs/packages.md`。

## C10 · 平台 / 元层

- **维护者问题**:packages 是什么?遥测/自诊断/wiki 这些"元能力"怎么运转?
- **为什么这么设计**:把可独立演进的能力(协议契约、记忆、人格)抽成 `packages/`;平台层放遥测与诊断;DIP/llm-wiki/self-diagnosis 构成"项目自我认知"的元层。
- **横切关键文件**:`packages/{protocol,mem-core,soul-core}/`;`core/platform/telemetry/`(insforge);`llm-wiki/`(可验证代码投影);`scripts/self-diagnosis/`(反身自学习骨架,尚未可运行)。
- **P2 DIP 节点**:`packages/AGENT.md`、`packages/protocol/AGENT.md`、`packages/mem-core/AGENT.md`、`packages/soul-core/AGENT.md`、`core/platform/telemetry/AGENT.md`。
- **排查入口**:遥测没上报 → `core/platform/telemetry/`;wiki 校验失败 → `npm run wiki:verify`;DIP 报错 → `npm run verify:dip`。
- **依赖边**:C0(元层回到地图本身)。
- **对应 docs**:`docs/packages.md`。
