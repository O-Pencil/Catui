# Claude Code 主子 Agent 架构拆解

> 源码版本：@anthropic-ai/claude-code@2.1.92
> 目标：让一个模型可以在 catui 中一比一复刻 CC 的 Agent（子代理）系统

---

## 一、一句话概括

CC 的 Agent 工具是一个**进程内子代理生成器**：父 agent 通过 `Agent` tool call 创建一个全新的 `AgentSession`（独立 LLM 循环），子 agent 拥有独立的系统提示、工具集和消息历史，完成后将最后一条 assistant 消息作为结果返回给父 agent。

**不是**子进程、不是 HTTP 调用、不是 IPC——是同一个进程内的异步函数调用，共享同一套 runtime 基础设施。

---

## 二、核心概念映射

| CC 概念 | catui 对应 | 说明 |
|---------|----------------|------|
| `Agent` tool | `SubAgentSpec` + `SubAgentRuntime` | CC 是 LLM 可调用的 tool；catui 是内部 API |
| `Task` (alias) | 无 | CC 中 Agent 的别名 |
| `subagent_type` | `runRole` / agent definition | 决定工具集和系统提示 |
| `run_in_background` | `run_in_background` | 异步执行，输出写文件 |
| `isolation: "worktree"` | `WorktreeManager` | git worktree 隔离 |
| `agentNameRegistry` | `activeAgents` Map | 按名称寻址子 agent |
| Handoff classifier | 无 | CC 独有的安全审查 |

---

## 三、Agent 工具的 JSON Schema

### 3.1 Input Schema（LLM 看到的）

```typescript
// CC 源码中的定义（cli.js 第 3947 行附近）
const AgentInputSchema = z.object({
  description: z.string()
    .describe("A short (3-5 word) description of the task"),

  prompt: z.string()
    .describe("The task for the agent to perform"),

  subagent_type: z.string().optional()
    .describe("The type of specialized agent to use for this task"),

  model: z.enum(["sonnet", "opus", "haiku"]).optional()
    .describe("Optional model override for this agent. Takes precedence over the agent definition's model frontmatter. If omitted, uses the agent definition's model, or inherits from the parent."),

  run_in_background: z.boolean().optional()
    .describe("Set to true to run this agent in the background. You will be notified when it completes."),

  name: z.string().optional()
    .describe("Name for the spawned agent. Makes it addressable via SendMessage({to: name}) while running."),

  team_name: z.string().optional()
    .describe("Team name for spawning. Uses current team context if omitted."),

  mode: z.enum(["acceptEdits", "auto", "bypassPermissions", "default", "dontAsk", "plan"]).optional()
    .describe('Permission mode for spawned teammate (e.g., "plan" to require plan approval).'),

  isolation: z.enum(["worktree"]).optional()
    .describe('Isolation mode. "worktree" creates a temporary git worktree so the agent works on an isolated copy of the repo.'),

  cwd: z.string().optional()
    .describe('Absolute path to run the agent in. Overrides the working directory for all filesystem and shell operations within this agent. Mutually exclusive with isolation: "worktree".'),
});
```

**注意**：
- `cwd` 在最终发送给 LLM 的 schema 中被 omit 掉了（`nzY().omit({cwd:!0})`），但内部处理时仍然接受。
- `run_in_background` 在 `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` 环境变量启用时也会被 omit（`xs1` 函数：`DS6||hx()?q.omit({run_in_background:!0}):q`）。

### 3.2 Output Schema

```typescript
// 同步完成时
type AgentOutputCompleted = {
  agentId: string;
  agentType?: string;
  content: { type: "text"; text: string }[];
  totalToolUseCount: number;
  totalDurationMs: number;
  totalTokens: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number | null;
    cache_read_input_tokens: number | null;
    server_tool_use: {
      web_search_requests: number;
      web_fetch_requests: number;
    } | null;
    service_tier: ("standard" | "priority" | "batch") | null;
    cache_creation: {
      ephemeral_1h_input_tokens: number;
      ephemeral_5m_input_tokens: number;
    } | null;
  };
  status: "completed";
  prompt: string;  // 原始 prompt 文本
};

// 异步启动时
type AgentOutputAsync = {
  status: "async_launched";
  agentId: string;          // 异步 agent 的 ID
  description: string;      // 任务描述
  prompt: string;           // 原始 prompt
  outputFile: string;       // 输出文件路径，可用于检查进度
  canReadOutputFile?: boolean; // 父 agent 是否有 Read/Bash 工具
};

type AgentOutput = AgentOutputCompleted | AgentOutputAsync;
```

---

## 四、AgentDefinition 完整接口

从源码中提取的 `AgentDefinition` 所有字段：

```typescript
interface AgentDefinition {
  // === 必填 ===
  agentType: string;                    // 唯一标识，如 "general-purpose"
  description: string;                  // 一行描述
  whenToUse: string | (() => string);   // ⚠️ 可以是函数！Explore 就是函数引用
  getSystemPrompt: (ctx: { toolUseContext: any }) => string;

  // === 工具控制（二选一） ===
  tools?: string[];                     // 白名单，["*"] = 全部
  disallowedTools?: string[];           // 黑名单

  // === 模型 ===
  model?: string;                       // "sonnet" | "opus" | "haiku" | "inherit"
  effort?: "low" | "medium" | "high" | number;  // 推理努力程度

  // === 权限 ===
  permissionMode?: "acceptEdits" | "auto" | "bypassPermissions" | "default" | "dontAsk" | "plan";

  // === 隔离 ===
  isolation?: "worktree";               // worktree 隔离模式

  // === 后台 ===
  background?: boolean;                 // ⚠️ agent 定义级的后台标志，不同于 run_in_background 参数

  // === Fork 行为 ===
  forksParentContext?: boolean | "turn"; // ⚠️ 文档未提及！控制 fork 时继承哪些父消息
                                          // true = 继承全部父消息
                                          // "turn" = 只继承当前 turn 的消息
                                          // undefined = 不继承

  // === MCP ===
  requiredMcpServers?: string[];        // ⚠️ 文档未提及！需要的 MCP 服务器
  mcpServers?: string[];                // 关联的 MCP 服务器

  // === 其他 ===
  source: "built-in" | "plugin" | "flagSettings" | "userSettings" | "projectSettings";
  baseDir: string;                      // 基础目录
  color?: string;                       // ⚠️ 文档未提及！UI 颜色标识
  maxTurns?: number;                    // 最大轮次
  skills?: string[];                    // 关联的 skills
  initialPrompt?: string;               // 初始提示
  memory?: "user" | "project" | "local"; // 记忆范围
  omitClaudeMd?: boolean;               // 是否跳过 CLAUDE.md
  appendSystemPrompt?: boolean;         // 是否追加系统提示
  hooks?: any;                          // 钩子配置
  filename?: string;                    // 文件名（自定义 agent）
}
```

---

## 五、内置 Agent 类型定义

### 5.1 general-purpose

```typescript
{
  agentType: "general-purpose",
  whenToUse: "General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks. When you are searching for a keyword or file and are not confident that you will find the right match in the first few tries use this agent to perform the search for you.",
  tools: ["*"],           // 所有工具
  source: "built-in",
  baseDir: "built-in",
  getSystemPrompt: hr_,   // 继承主 agent 的系统提示
}
```

**关键**：`tools: ["*"]` 表示通配符——继承父 agent 的全部工具集。

### 5.2 Explore

```typescript
{
  agentType: "Explore",
  whenToUse: Lr_,   // ⚠️ 是函数引用，不是字符串字面量！运行时动态生成
  disallowedTools: ["Agent", "ExitPlanMode", "Edit", "Write", "NotebookEdit"],
  source: "built-in",
  baseDir: "built-in",
  model: "haiku",         // 强制使用 haiku 模型
  omitClaudeMd: true,     // 不加载 CLAUDE.md
  getSystemPrompt: () => Er_(),  // 专用系统提示
}
```

**关键**：
- `disallowedTools` 而非 `tools`——用黑名单而非白名单
- 禁止 `Agent`（不能递归 spawn）
- 禁止 `Edit`/`Write`/`NotebookEdit`（只读）
- 强制 `haiku` 模型（快速、便宜）

### 5.3 Plan

```typescript
{
  agentType: "Plan",
  whenToUse: "Software architect agent for designing implementation plans. Use this when you need to plan the implementation strategy for a task. Returns step-by-step plans, identifies critical files, and considers architectural trade-offs.",
  disallowedTools: ["Agent", "ExitPlanMode", "Edit", "Write", "NotebookEdit"],
  source: "built-in",
  baseDir: "built-in",
  model: "inherit",       // ⚠️ 继承父 agent 的模型，不强制指定
  omitClaudeMd: true,     // ⚠️ 不加载 CLAUDE.md
  getSystemPrompt: () => Rr_(),  // 专用系统提示
}
```

### 5.4 statusline-setup

```typescript
{
  agentType: "statusline-setup",
  whenToUse: "Use this agent to configure the user's Claude Code status line setting.",
  tools: ["Read", "Edit"],  // ⚠️ 只有读和编辑，没有 Bash/Write
  source: "built-in",
  baseDir: "built-in",
  model: "sonnet",           // ⚠️ 指定 sonnet 模型
  color: "orange",           // ⚠️ UI 颜色标识
  getSystemPrompt: () => `You are a status line setup agent for Claude Code...`,
}
```

### 5.5 claude-code-guide

```typescript
{
  agentType: "claude-code-guide",
  whenToUse: `Use this agent when the user asks questions ("Can Claude...", "Does Claude...", "How do I...") about: (1) Claude Code (the CLI tool) - features, hooks, slash commands, MCP servers, settings, IDE integrations, keyboard shortcuts; (2) Claude Agent SDK - building custom agents; (3) Claude API (formerly Anthropic API) - API usage, tool use, Anthropic SDK usage. IMPORTANT: Before spawning a new agent, check if there is already a running or recently completed claude-code-guide agent that you can continue via SendMessage.`,
  tools: bj() ? [e7, pq, Bj, Kh] : [Z_, H9, pq, Bj, Kh],  // ⚠️ 条件工具集，取决于某个运行时标志
  source: "built-in",
  baseDir: "built-in",
  model: "haiku",            // ⚠️ 使用 haiku 模型
  permissionMode: "dontAsk", // ⚠️ 不询问权限
  getSystemPrompt: ({ toolUseContext }) => /* 专用系统提示 */,
}
```

---

## 六、Agent Spawn 完整流程

### 6.1 同步执行路径

```
[1] LLM 输出 tool_use: Agent({ prompt, subagent_type, description, ... })
    ↓
[2] Agent tool handler 被调用
    async call({prompt, subagent_type, description, model, run_in_background, name, team_name, mode, isolation, cwd}, ...)
    ↓
[3] 参数预处理
    - model: 如果 Ay6() 为 true（某些限制模式），忽略 model 参数
    - team_name: 检查是否在 team context 中
    ↓
[4] Team 路径判断
    if (team_name && name) → 走 team teammate spawn 路径（KZK 函数）
    ↓
[5] Agent 类型解析
    if (subagent_type 未指定) {
      if (在 fork worker 中) → 抛错 "Fork is not available inside a forked worker"
      agentDef = PS6（默认 fork agent 定义）
      isFork = true
    } else {
      从 agentDefinitions.activeAgents 中查找匹配的 agentType
      if (找不到) → 抛错 "Agent type 'X' not found"
      if (被 permission rule 拒绝) → 抛错 "Agent type 'X' has been denied"
      agentDef = 找到的定义
      isFork = false
    }
    ↓
[6] MCP 服务器检查
    if (agentDef.requiredMcpServers 有值) {
      等待最多 30 秒让 pending MCP 连接完成
      检查所需 MCP 服务器是否可用
      if (不可用) → 抛错
    }
    ↓
[7] 模型选择
    resolvedModel = JE6(agentDef.model, mainLoopModel, userOverride, permissionMode)
    // 优先级：agent 定义的 model > 用户指定的 model > 主循环的 model
    ↓
[8] 系统提示构建
    if (isFork) {
      // Fork 模式：继承父 agent 的系统提示
      systemPrompt = parentSession.renderedSystemPrompt
      // ⚠️ 如果 renderedSystemPrompt 不存在，走 Lx() 构建
      messages = buildForkMessages(prompt, queryMetadata)
    } else {
      // 普通模式：使用 agent 定义的系统提示
      // ⚠️ 注意：Z18() 会把 worktree path 和 cwd 作为 Notes 注入系统提示
      systemPrompt = Z18([additionalWorkingDirs], model, additionalWorkingDirs)
      // Z18 开头是 "Notes:" 然后列出所有工作目录
      if (agentDef.memory) { /* 加载记忆 */ }
      messages = [userMessage(prompt)]
    }
    ↓
[9] 权限模式确定
    permissionContext = { ...parentPermissionContext, mode: agentDef.permissionMode ?? "acceptEdits" }
    ↓
[10] 工具集确定
     if (isFork) {
       availableTools = parentTools  // 完全继承
       useExactTools = true           // ⚠️ 精确使用父工具，不重新过滤
     } else {
       availableTools = td(permissionContext, mcpTools)  // 根据权限过滤
     }
    ↓
[11] Worktree 创建（如果 isolation === "worktree"）
     worktreeResult = await Xq8(`agent-${agentId.slice(0,8)}`)
     // 详见第七节
    ↓
[12] 异步判断
     // ⚠️ 三个独立的异步触发源：
     // 1. run_in_background 参数（用户显式指定）
     // 2. agentDef.background（agent 定义中的标志）
     // 3. 自动后台化（运行时超时）
     //
     // ⚠️ 限制：In-process teammate 不能用 run_in_background=true 或 background=true
     if (TD() && teamContext && agentDef.background === true) {
       throw Error("In-process teammates cannot spawn background agents.")
     }
     //
     isAsync = (run_in_background === true || agentDef.background === true)
     autoBackgroundMs = czY()  // 默认 120000ms = 2 分钟（如果启用）
     //
     // ⚠️ DS6 = CLAUDE_CODE_DISABLE_BACKGROUND_TASKS 环境变量
     // 如果 DS6 为 true，所有异步能力被禁用
    ↓
[13] 同步执行
     创建 AgentSession（详见第八节）
     迭代 LLM 流：
       while (true) {
         result = await stream.next()
         if (result.done) break
         // 收集消息
         messages.push(result.value)
         // 检查是否应该转为后台
         if (shouldBackground) {
           // 转为异步路径
           break
         }
       }
    ↓
[14] 结果提取
     VS8(messages, agentId, metadata) → AgentOutputCompleted
     - 从最后一条 assistant 消息提取文本
     - 计算 totalTokens, totalToolUseCount, totalDurationMs
     - 提取 usage 统计
     - ⚠️ maxResultSizeChars = 100,000（1e5）字符，超出会被截断
    ↓
[15] 安全审查（auto mode 下）
     // ⚠️ 同步路径直接调用 ES8
     // ⚠️ 异步路径：ES8 在父 agent 读取 outputFile 时触发（延迟审查）
     ES8({ agentMessages, tools, toolPermissionContext, abortSignal, subagentType })
     - 调用 handoff classifier（TS8 函数）检查子 agent 输出
     - classifier 使用一个小模型审查子 agent 的操作
     - 如果 flagged → 返回 SECURITY WARNING 前缀
     - ⚠️ 如果 classifier 不可用（unavailable），返回警告但不阻断
    ↓
[16] Worktree 清理
     if (worktree 存在) {
       if (无变更 && 无新提交) → git worktree remove
       else → 保留（可手动检查）
     }
    ↓
[17] 返回 AgentOutputCompleted 给 LLM
```

### 6.2 异步执行路径

```
[1-11] 同上
    ↓
[12] isAsync = true
    ↓
[13] 创建后台任务
     taskId = dg8({ agentId, description, prompt, selectedAgent, setAppState, toolUseId })
     // 在 AppState 中注册任务
     ↓
     if (name 参数存在) {
       agentNameRegistry.set(name, agentId)  // 注册名称映射
     }
    ↓
[14] 启动异步执行
     OU(sessionMetadata, () =>
       q6(() => LS8({
         taskId, abortController, makeStream, metadata, description,
         toolUseContext, rootSetAppState, agentIdForCleanup,
         enableSummarization, getWorktreeResult
       }))
     )
     // LS8 = 异步 agent runner（详见第八节 8.2）
    ↓
[15] 检查父 agent 是否有 Read/Bash 工具
     canReadOutputFile = tools.some(t => isReadTool(t) || isBashTool(t))
    ↓
[16] 立即返回 AgentOutputAsync
     {
       status: "async_launched",
       agentId,
       description,
       prompt,
       outputFile: lY(agentId),  // <project>/.claude/tasks/<agentId>.output
       canReadOutputFile
     }
```

---

## 七、Worktree 隔离机制

### 7.1 创建（Xq8 函数）

```typescript
async function Xq8(agentId: string, options?: WorktreeOptions) {
  // 1. 注册 worktree 元数据
  zS6(agentId);

  // 2. 检查是否有 hook-based worktree
  if (hM6()) {
    const hookResult = await P58(agentId);
    // hook 可以自定义 worktree 创建逻辑
    return { worktreePath: hookResult.worktreePath, hookBased: true };
  }

  // 3. 获取 worktree 配置
  const config = getWorktreeConfig();
  // symlinkDirectories: 需要 symlink 的目录（如 node_modules）
  // sparsePaths: git sparse-checkout 路径

  // 4. 创建 git worktree
  const worktreePath = path.join(getTempDir(), `agent-${agentId}`);
  const branchName = `agent-${agentId}`;

  await exec(`git worktree add --detach ${worktreePath}`);

  // 5. 处理 sparse checkout（如果配置了）
  if (config.sparsePaths?.length) {
    await exec(`git sparse-checkout set --cone ${config.sparsePaths.join(' ')}`, { cwd: worktreePath });
  }

  // 6. 创建 symlink（如果配置了）
  if (config.symlinkDirectories?.length) {
    for (const dir of config.symlinkDirectories) {
      const src = path.join(projectRoot, dir);
      const dst = path.join(worktreePath, dir);
      if (fs.existsSync(src) && !fs.existsSync(dst)) {
        await fs.symlink(src, dst);
      }
    }
  }

  // 7. 记录 head commit（用于后续变更检测）
  const headCommit = await exec('git rev-parse HEAD', { cwd: worktreePath });

  return {
    worktreePath,
    worktreeBranch: branchName,
    headCommit: headCommit.stdout.trim(),
    gitRoot: projectRoot,
  };
}
```

### 7.2 变更检测（E77 函数）

```typescript
async function E77(worktreePath: string, baselineCommit: string): Promise<boolean> {
  const { dirty, commitsAhead } = await il8(worktreePath, baselineCommit);
  // il8 内部：
  //   dirty = git status --porcelain 输出非空
  //   commitsAhead = git rev-list ${baselineCommit}..HEAD --count
  return dirty || commitsAhead > 0;
}
```

### 7.3 清理（jJ6 函数）

```typescript
async function jJ6(worktreePath: string, branchName: string, gitRoot: string, hookBased?: boolean) {
  if (hookBased) {
    // hook-based worktree 由 hook 负责清理
    const cleanup = await dl8(worktreePath);
    return;
  }

  // 1. 删除 worktree
  await exec(`git worktree remove ${worktreePath} --force`, { cwd: gitRoot });

  // 2. 删除分支（如果存在）
  try {
    await exec(`git branch -D ${branchName}`, { cwd: gitRoot });
  } catch {
    // 分支可能不存在，忽略
  }
}
```

### 7.4 生命周期决策

```
Agent 执行完成
    ↓
worktree 存在？
    ├─ NO → 无操作
    └─ YES → E77(worktreePath, headCommit)
        ├─ 无变更 → jJ6() 清理 worktree
        └─ 有变更 → 保留 worktree，返回 worktreePath 给父 agent
            // 父 agent 可以检查变更，手动决定是否应用
```

---

## 八、AgentSession 创建与执行

### 8.1 同步执行（call 函数内部）

```typescript
// CC 源码中的同步执行路径（简化）
const agentId = generateUUID();

const sessionConfig = {
  agentDefinition: agentDef,
  promptMessages: messages,           // 用户消息
  toolUseContext: parentContext,       // 继承父 agent 的 context
  canUseTool: permissionChecker,      // 权限检查函数
  isAsync: false,
  querySource: `agent:${agentDef.agentType}`,
  model: resolvedModel,
  // ⚠️ override 逻辑比文档描述的更复杂：
  override: isFork
    ? { systemPrompt: parentSystemPrompt }      // Fork: 继承父系统提示
    : agentSystemPrompt && !worktree && !cwd
      ? { systemPrompt: I5(agentSystemPrompt) } // 普通（无 worktree/cwd）: 格式化 agent 系统提示
      : undefined,                               // 有 worktree/cwd: 不 override，让 Z18 处理
  availableTools: isFork ? parentTools : filteredTools,
  // ⚠️ forkContextMessages 取决于 agentDef.forksParentContext：
  forkContextMessages: isFork
    ? agentDef.forksParentContext === "turn"
      ? parentMessages.slice(turnStartIndex)  // "turn": 只继承当前 turn
      : agentDef.forksParentContext === true
        ? parentMessages                       // true: 继承全部
        : undefined                            // undefined: 不继承
    : undefined,
  worktreePath: worktree?.worktreePath,
  description: description,
};

// 创建 LLM 流
const stream = Yx(sessionConfig);

// 迭代执行
const messages = [];
let totalTokens = 0;
let totalToolUseCount = 0;

for await (const event of stream) {
  messages.push(event);

  // 更新进度 UI
  if (elapsed > 2000 && !showedSpinner) {
    setToolJSX(<AgentProgressUI />);
    showedSpinner = true;
  }

  // 检查是否应该转为后台
  if (shouldBackground && taskId) {
    // 转为异步路径
    break;
  }
}

// 提取结果
const result = VS8(messages, agentId, {
  prompt, resolvedAgentModel, isBuiltInAgent, startTime, agentType, isAsync: false
});
```

### 8.2 异步执行（LS8 函数）

```typescript
async function LS8({
  taskId, abortController, makeStream, metadata, description,
  toolUseContext, rootSetAppState, agentIdForCleanup,
  enableSummarization, getWorktreeResult
}) {
  const messages = [];

  try {
    // 1. 创建 token 计数器
    const tokenCounter = c26();
    const toolCounter = l26(toolUseContext.options.tools);

    // 2. 如果需要摘要，注册停止回调
    let stopFn;
    if (enableSummarization) {
      const { stop } = qe6(taskId, agentId, tokenCounter, rootSetAppState);
      stopFn = stop;
    }

    // 3. 创建流并迭代
    const stream = makeStream(/* cacheSafeParams */);

    for await (const event of stream) {
      // 检查 abort
      if (abortController.signal.aborted) break;

      messages.push(event);
      // 更新 token 和 tool 计数
      KK6(tokenCounter, event, toolCounter, toolUseContext.options.tools);

      // 更新任务状态
      _e6(taskId, Pa(tokenCounter), rootSetAppState);

      // 记录工具使用
      const toolUse = NS8(event);
      if (toolUse) {
        yS8(tokenCounter, taskId, toolUseId, description, metadata, toolUse);
      }
    }

    // 4. 提取结果
    const result = VS8(messages, taskId, metadata);

    // 5. 更新任务状态为完成
    hS8(result, rootSetAppState);

    // 6. 清理 worktree
    const worktreeResult = await getWorktreeResult();

    // 7. 清理 agent 注册
    v18(agentId, { agentType: metadata.agentType, description })
      .catch(err => log(`Failed to clear worktree metadata: ${err}`));

    return result;

  } catch (error) {
    // 错误处理
    throw error;
  } finally {
    // 清理
    if (agentIdForCleanup) {
      // 从 activeAgents 中移除
    }
  }
}
```

---

## 九、工具过滤机制

### 9.1 过滤逻辑

```typescript
// 工具过滤的核心函数
function filterToolsForAgent(agentDef, parentTools, permissionContext, mcpTools) {
  // 1. 获取基础工具集
  let tools = td(permissionContext, mcpTools);
  // td = 根据权限模式过滤工具

  // 2. 应用 agent 定义的工具限制
  if (agentDef.tools) {
    // 白名单模式：只保留指定的工具
    if (agentDef.tools.includes("*")) {
      // 通配符：保留所有工具
    } else {
      tools = tools.filter(t => agentDef.tools.includes(t.name));
    }
  }

  if (agentDef.disallowedTools) {
    // 黑名单模式：移除指定的工具
    tools = tools.filter(t => !agentDef.disallowedTools.includes(t.name));
  }

  return tools;
}
```

### 9.2 各类型的工具集

| Agent 类型 | 工具策略 | 具体工具 | 模型 | 其他 |
|-----------|---------|---------|------|------|
| general-purpose | `tools: ["*"]` | 继承父 agent 全部工具 | 继承 | - |
| Explore | `disallowedTools` | 全部 - Agent - ExitPlanMode - Edit - Write - NotebookEdit | haiku | omitClaudeMd |
| Plan | `disallowedTools` | 同 Explore | inherit | omitClaudeMd |
| statusline-setup | `tools` 白名单 | Read, Edit | sonnet | color: orange |
| claude-code-guide | `tools` 条件 | 取决于 bj() 标志 | haiku | permissionMode: dontAsk |

### 9.3 权限模式对工具的影响

```typescript
function td(permissionContext, mcpTools) {
  // permissionContext.mode 可能的值：
  // - "acceptEdits": 默认模式，编辑需要确认
  // - "auto": 自动模式，大部分操作自动批准
  // - "bypassPermissions": 跳过所有权限检查
  // - "plan": 只读 + plan 模式
  // - "dontAsk": 不询问，直接拒绝未授权操作

  let tools = [...builtinTools];

  // 根据模式过滤
  if (permissionContext.mode === "plan") {
    tools = tools.filter(t => isReadOnly(t));
  }

  // 添加 MCP 工具
  tools.push(...mcpTools);

  return tools;
}
```

---

## 十、系统提示构建

### 10.1 普通子 Agent

```typescript
// 子 agent 的系统提示构建
function buildSubAgentSystemPrompt(agentDef, toolUseContext) {
  // 1. 获取 agent 定义的系统提示
  const agentPrompt = agentDef.getSystemPrompt({ toolUseContext });

  // 2. 如果 agent 有 memory 配置，加载记忆
  if (agentDef.memory) {
    const memory = loadMemory(agentDef.memory);
    agentPrompt += `\n${memory}`;
  }

  // 3. 格式化
  return I5(agentPrompt);
  // I5 = 将系统提示格式化为 Anthropic API 消息格式
}
```

### 10.2 Fork 模式

```typescript
// Fork 模式：继承父 agent 的系统提示
function buildForkSystemPrompt(parentSession) {
  // 直接使用父 agent 的 renderedSystemPrompt
  return parentSession.renderedSystemPrompt;
}
```

### 10.3 系统提示的差异

| 场景 | 系统提示来源 | CLAUDE.md | 记忆 | 工作目录注入 |
|------|------------|-----------|------|------------|
| 普通子 agent（无 worktree/cwd） | agentDef.getSystemPrompt() → I5() 格式化 | 取决于 agent 定义 | 取决于 memory 配置 | 无 |
| 普通子 agent（有 worktree/cwd） | Z18() 构建（含 "Notes:" + 工作目录列表） | 取决于 agent 定义 | 取决于 memory 配置 | ✅ 自动注入 |
| Fork 模式 | 父 agent 的 renderedSystemPrompt | 继承父 agent | 继承父 agent | 无 |
| Explore agent | Er_() 专用系统提示 | omitClaudeMd: true | 无 | 无 |

---

## 十一、消息传递协议

### 11.1 父 → 子

```typescript
// 消息构建
const messages = [];

if (isFork) {
  // Fork 模式：包含父 agent 的上下文消息
  messages.push(...buildForkContextMessages(parentMessages, prompt, queryMetadata));
  // buildForkContextMessages 会：
  //   1. 取父 agent 的消息历史
  //   2. 添加用户的新 prompt
  //   3. 添加 query metadata（requestId 等）
} else {
  // 普通模式：只有用户消息
  messages.push({ type: "user", content: [{ type: "text", text: prompt }] });
}
```

### 11.2 子 → 父（同步）

```typescript
// 结果提取（VS8 函数）
function VS8(messages, agentId, metadata) {
  // 1. 获取最后一条 assistant 消息
  const lastAssistant = findLastAssistantMessage(messages);
  if (!lastAssistant) throw new Error("No assistant messages found");

  // 2. 提取文本内容
  let textContent = lastAssistant.message.content.filter(c => c.type === "text");

  // 3. 如果最后一条没有文本，向前搜索
  if (textContent.length === 0) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.type !== "assistant") continue;
      const texts = msg.message.content.filter(c => c.type === "text");
      if (texts.length > 0) {
        textContent = texts;
        break;
      }
    }
  }

  // 4. 统计
  const totalTokens = $W(messages)?.usage?.total_tokens ?? 0;
  const totalToolUseCount = wZz(messages);

  // 5. 构建结果
  return {
    agentId,
    agentType: metadata.agentType,
    content: textContent,
    totalDurationMs: Date.now() - metadata.startTime,
    totalTokens,
    totalToolUseCount,
    usage: $W(messages)?.message?.usage,
    status: "completed",
    prompt: metadata.prompt,
  };
}
```

### 11.3 子 → 父（异步）

异步 agent 的结果通过**文件系统**传递：

```typescript
// 输出文件路径
function lY(agentId) {
  return path.join(qR6(), `${agentId}.output`);
  // qR6() = <project>/.claude/tasks/
}

// 输出文件内容 = 最后一条 assistant 消息的文本
```

父 agent 可以通过 Read 工具读取 `outputFile` 来检查子 agent 的进度。

---

## 十二、安全机制

### 12.1 Handoff Classifier（auto mode）

```typescript
async function ES8({
  agentMessages, tools, toolPermissionContext, abortSignal, subagentType, totalToolUseCount
}) {
  // 只在 auto mode 下运行
  if (toolPermissionContext.mode !== "auto") return null;

  // 构建审查 prompt
  const reviewPrompt = {
    role: "user",
    content: [{
      type: "text",
      text: "Sub-agent has finished and is handing back control to the main agent. Review the sub-agent's work based on the block rules and let the main agent know if any file is dangerous (the main agent will see the reason)."
    }]
  };

  // 调用 classifier
  const result = await TS8(
    [...agentMessages, reviewPrompt],
    tools, toolPermissionContext, abortSignal
  );

  // 记录决策
  d("tengu_auto_mode_decision", {
    decision: result.shouldBlock ? "blocked" : "allowed",
    toolName: "Agent",
    subagentType,
    toolUseCount: totalToolUseCount,
    isHandoff: true,
  });

  if (result.shouldBlock) {
    if (result.unavailable) {
      return "Note: The safety classifier was unavailable when reviewing this sub-agent's work. Please carefully verify the sub-agent's actions and output before acting on them.";
    }
    return `SECURITY WARNING: Sub-agent performed actions that may violate security policy. Reason: ${result.reason}. Review the sub-agent's actions carefully before acting on its output.`;
  }

  return null;  // 安全，无警告
}
```

### 12.2 权限继承

```typescript
// 子 agent 的权限模式
const childPermissionContext = {
  ...parentPermissionContext,
  mode: agentDef.permissionMode ?? "acceptEdits",
  // agent 定义可以覆盖权限模式
  // 但不能比父 agent 更宽松
};
```

### 12.3 递归限制

```typescript
// 在 Fork worker 中不能再次 fork
if (querySource === `agent:builtin:${forkAgentType}` || isForkWorker(messages)) {
  throw new Error("Fork is not available inside a forked worker. Complete your task directly using your tools.");
}

// Team 中 teammate 不能 spawn teammate
if (isTeamContext && name) {
  throw new Error("Teammates cannot spawn other teammates — the team roster is flat.");
}

// In-process teammate 不能 spawn background agent
if (isInProcessTeam && run_in_background === true) {
  throw new Error("In-process teammates cannot spawn background agents.");
}
```

---

## 十三、自动后台化机制

### 13.1 触发条件

```typescript
function czY() {
  // 如果启用了自动后台任务，返回阈值（2 分钟）
  if (U6(process.env.CLAUDE_AUTO_BACKGROUND_TASKS) ||
      S8("tengu_auto_background_agents", false)) {
    return 120000;  // 2 分钟
  }
  return 0;  // 禁用
}
```

### 13.2 转后台流程

```
同步执行中，elapsed > autoBackgroundMs
    ↓
检查条件：
  - 子 agent 还在运行
  - 父 agent 的 UI 可以设置 JSX
    ↓
创建后台任务对象
  taskId = dg8({ agentId, description, prompt, ... })
    ↓
设置 agentNameRegistry（如果 name 存在）
    ↓
中断当前同步迭代
  stream.return(undefined)
    ↓
启动异步继续
  OU(metadata, () => LS8({ ... }))
    ↓
返回 AgentOutputAsync 给父 agent
```

---

## 十四、Agent 注册表与命名

### 14.1 agentNameRegistry

```typescript
// 在 AppState 中维护
agentNameRegistry: Map<string, string>  // name → agentId

// 注册
if (name) {
  setAppState(state => {
    const registry = new Map(state.agentNameRegistry);
    registry.set(name, agentId);
    return { ...state, agentNameRegistry: registry };
  });
}

// 查找（SendMessage 使用）
function findAgentByName(name) {
  return agentNameRegistry.get(name);
}
```

### 14.2 Agent 定义缓存

```typescript
// agentDefinitions 在 AppState 中维护
agentDefinitions: {
  activeAgents: AgentDefinition[],   // 当前可用的 agent 列表
  allAgents: AgentDefinition[],      // 所有 agent（包括不可用的）
  failedFiles?: { path: string, error: string }[],
}

// 加载时机：
// 1. 启动时
// 2. 配置变更时
// 3. 插件加载时

// 来源：
// 1. 内置 agent（fy8()）
// 2. 插件定义的 agent（ao6()）
// 3. 用户自定义 agent（.claude/agents/*.md）
```

---

## 十五、自定义 Agent 定义格式

### 15.1 Markdown 格式（.claude/agents/*.md）

```markdown
---
name: my-agent
description: "A specialized agent for X"
tools: ["Read", "Glob", "Grep"]  # 可选，白名单
disallowedTools: ["Write"]        # 可选，黑名单
model: sonnet                     # 可选
effort: high                      # 可选
permissionMode: plan              # 可选
maxTurns: 10                      # 可选
background: false                 # 可选
memory: project                   # 可选
isolation: worktree               # 可选
skills: ["skill-name"]            # 可选
initialPrompt: "..."              # 可选
appendSystemPrompt: true          # 可选
mcpServers: ["server-name"]       # 可选
---

You are a specialized agent for X.

Your responsibilities:
1. ...
2. ...
```

### 15.2 JSON 格式（插件定义）

```json
{
  "agents": {
    "my-agent": {
      "description": "A specialized agent for X",
      "tools": ["Read", "Glob", "Grep"],
      "prompt": "You are a specialized agent for X...",
      "model": "sonnet",
      "permissionMode": "plan",
      "maxTurns": 10,
      "background": false,
      "memory": "project",
      "isolation": "worktree"
    }
  }
}
```

---

## 十六、Telemetry 事件

```typescript
// Agent 选择
d("tengu_agent_tool_selected", {
  agent_type: agentDef.agentType,
  model: resolvedModel,
  source: agentDef.source,       // "built-in" | "plugin" | "flagSettings"
  color: agentDef.color,
  is_built_in_agent: isBuiltIn(agentDef),
  is_resume: false,
  is_async: isAsync,
  is_fork: isFork,
});

// Agent 完成
d("tengu_agent_tool_completed", {
  agent_type: metadata.agentType,
  model: metadata.resolvedAgentModel,
  prompt_char_count: metadata.prompt.length,
  response_char_count: responseText.length,
  assistant_message_count: messages.length,
  total_tool_use_count: totalToolUseCount,
  duration_ms: Date.now() - metadata.startTime,
  total_tokens: totalTokens,
  is_built_in_agent: metadata.isBuiltInAgent,
  is_async: metadata.isAsync,
});

// Auto mode 决策
d("tengu_auto_mode_decision", {
  decision: "blocked" | "allowed",
  toolName: "Agent",
  subagentType,
  toolUseCount,
  isHandoff: true,
});

// Agent 记忆加载
d("tengu_agent_memory_loaded", {
  scope: agentDef.memory,
  source: "subagent",
});
```

---

## 十七、完整状态机

```
                    ┌─────────────────────────────────────┐
                    │         Agent Tool Called            │
                    └──────────────┬──────────────────────┘
                                   │
                    ┌──────────────▼──────────────────────┐
                    │      Resolve Agent Definition        │
                    │  (subagent_type → AgentDefinition)   │
                    └──────────────┬──────────────────────┘
                                   │
                    ┌──────────────▼──────────────────────┐
                    │      Check Permissions & MCP         │
                    └──────────────┬──────────────────────┘
                                   │
                    ┌──────────────▼──────────────────────┐
                    │      Build System Prompt             │
                    │  (fork: inherit, normal: agentDef)   │
                    └──────────────┬──────────────────────┘
                                   │
                    ┌──────────────▼──────────────────────┐
                    │      Create Worktree?                │
                    │  (isolation === "worktree")          │
                    └──────────────┬──────────────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                     │
    ┌─────────▼─────────┐ ┌───────▼───────┐ ┌──────────▼──────────┐
    │  Sync Execution   │ │  Background   │ │  Team Teammate      │
    │  (default)        │ │  (async)      │ │  (team_name+name)   │
    └─────────┬─────────┘ └───────┬───────┘ └──────────┬──────────┘
              │                    │                     │
    ┌─────────▼─────────┐ ┌───────▼───────┐ ┌──────────▼──────────┐
    │  Create Session   │ │  Create Task  │ │  KZK()              │
    │  Yx(config)       │ │  dg8()        │ │  Team Spawn         │
    └─────────┬─────────┘ └───────┬───────┘ └─────────────────────┘
              │                    │
    ┌─────────▼─────────┐ ┌───────▼───────┐
    │  Iterate Stream   │ │  LS8()        │
    │  for await        │ │  Async Runner │
    └─────────┬─────────┘ └───────┬───────┘
              │                    │
    ┌─────────▼─────────┐ ┌───────▼───────┐
    │  Auto-background? │ │  Write Output │
    │  elapsed > 2min   │ │  File         │
    └─────────┬─────────┘ └───────┬───────┘
              │                    │
    ┌─────────▼─────────┐ ┌───────▼───────┐
    │  VS8() Extract    │ │  Return       │
    │  Result           │ │  async_launched│
    └─────────┬─────────┘ └───────────────┘
              │
    ┌─────────▼─────────┐
    │  Handoff Check    │
    │  (auto mode)      │
    └─────────┬─────────┘
              │
    ┌─────────▼─────────┐
    │  Cleanup Worktree │
    └─────────┬─────────┘
              │
    ┌─────────▼─────────┐
    │  Return Completed │
    └───────────────────┘
```

---

## 十八、复刻清单

### 18.1 数据结构

- [ ] `AgentDefinition` 接口（详见第四节，25+ 字段）
- [ ] `AgentInput` / `AgentOutput` 类型
- [ ] `AgentSessionConfig` 接口
- [ ] `agentNameRegistry` Map
- [ ] `maxResultSizeChars` 常量（100,000）
- [ ] `forksParentContext` 三态逻辑（true/"turn"/undefined）

### 18.2 核心函数

- [ ] `resolveAgentType(subagent_type)` → 查找 agent 定义
- [ ] `filterToolsForAgent(agentDef, parentTools, permissionContext)` → 工具过滤
- [ ] `Z18(additionalWorkingDirs, model)` → 系统提示构建（含工作目录 Notes）
- [ ] `createWorktree(agentId)` → worktree 创建
- [ ] `checkWorktreeDirty(worktreePath, baseline)` → 变更检测
- [ ] `cleanupWorktree(worktreePath, branch, gitRoot)` → worktree 清理
- [ ] `createAgentSession(config)` → 创建 LLM session
- [ ] `extractAgentResult(messages, agentId, metadata)` → 结果提取
- [ ] `checkHandoffSafety(messages, tools, permissionContext)` → 安全审查
- [ ] `Lx()` → 主 session 系统提示构建（fork 模式回退）

### 18.3 工具注册

- [ ] Agent tool 的 JSON Schema 定义
- [ ] Agent tool handler（call 函数）
- [ ] 同步/异步执行路径
- [ ] 自动后台化逻辑
- [ ] `maxResultSizeChars: 1e5` 截断

### 18.4 内置 Agent

- [ ] general-purpose（tools: ["*"]，`whenToUse` 是字符串）
- [ ] Explore（disallowedTools, model: haiku, omitClaudeMd，`whenToUse` 是函数引用）
- [ ] Plan（disallowedTools）
- [ ] statusline-setup
- [ ] claude-code-guide

### 18.5 安全

- [ ] 递归限制（fork 中不能再 fork）
- [ ] Team 限制（teammate 不能 spawn teammate）
- [ ] In-process teammate 不能 spawn background agent
- [ ] 权限继承（不能比父更宽松）
- [ ] Handoff classifier（auto mode 安全审查）
- [ ] Classifier 不可用时的降级处理

### 18.6 持久化

- [ ] 输出文件（`.claude/tasks/<agentId>.output`）
- [ ] Agent 定义缓存（启动时/配置变更时/插件加载时）
- [ ] agentNameRegistry 持久化
- [ ] Worktree 元数据（head commit 用于变更检测）

---

## 十九、与 catui 现有实现的差异

| 维度 | CC | catui |
|------|-----|-----------|
| **工具定义** | LLM 可调用的 tool | 内部 API（SubAgentSpec） |
| **Agent 类型** | 5 个内置 + 自定义 | 2 种模式（research/implement）+ team modes |
| **Worktree** | git worktree add --detach | 同 |
| **异步执行** | 内置 run_in_background | 内置 |
| **自动后台** | 2 分钟阈值 | 无 |
| **安全审查** | Handoff classifier | 无 |
| **Fork 模式** | 继承父 agent 系统提示和消息 | 无 |
| **forksParentContext** | true/"turn"/undefined 三种模式 | 无 |
| **命名注册** | agentNameRegistry | activeAgents Map |
| **输出文件** | .claude/tasks/*.output | .catui/subagent-runs/*.md |
| **系统提示** | 按 agent type 构建 + Z18 注入工作目录 | 按 runRole 构建 |
| **工具过滤** | tools/disallowedTools | createReadOnlyTools/createCodingTools |
| **自定义 Agent** | .claude/agents/*.md | 无 |
| **结果大小限制** | maxResultSizeChars = 100,000 | 无 |
| **background 字段** | agent 定义级 + 参数级，两个独立控制 | 仅参数级 |

---

## 二十、关键源码位置

| 组件 | CC 源码位置（cli.js 行号/函数名） |
|------|-------------------------------|
| 工具名常量 | `H4="Agent"`, `eI="Task"` |
| Input Schema | `lzY`, `nzY`, `xs1`（第 3947 行附近） |
| Output Schema | `izY` |
| Agent handler | `ng8.call()`（第 3947 行附近） |
| 内置 agent 定义 | `fy8()` |
| Agent 类型过滤 | `Mq8()` |
| 工具过滤 | `td()` |
| Worktree 创建 | `Xq8()` |
| 变更检测 | `E77()` → `il8()` |
| Worktree 清理 | `jJ6()` |
| 系统提示构建 | `Z18()`, `Lx()` |
| 结果提取 | `VS8()` |
| 异步 runner | `LS8()` |
| 后台任务创建 | `dg8()` |
| 输出文件路径 | `lY()` → `qR6()` |
| 自动后台阈值 | `czY()` |
| Handoff 审查 | `ES8()` |
| Agent 定义解析 | `mM4()`（markdown）, `uM4()`（JSON） |
| Agent 注册表 | `agentNameRegistry` in AppState |
