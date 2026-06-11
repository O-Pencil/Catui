# 06 | `/plan` 命令实现与一比一复现指南

> 基于 Claude Code v2.1.88 反编译源码的逆向分析文档。本文目标是把 Plan Mode 拆成可施工规格：让 GPT-4 级别模型也能按步骤实现出结构和行为接近源码的版本，而不是只理解概念。

## 目录

1. [一句话总结](#1-一句话总结)
2. [必须实现的能力边界](#2-必须实现的能力边界)
3. [核心文件和职责](#3-核心文件和职责)
4. [整体数据流](#4-整体数据流)
5. [最小状态模型](#5-最小状态模型)
6. [`/plan` local-jsx 命令](#6-plan-local-jsx-命令)
7. [Plan 文件系统](#7-plan-文件系统)
8. [权限模式切换](#8-权限模式切换)
9. [EnterPlanModeTool](#9-enterplanmodetool)
10. [ExitPlanModeV2Tool](#10-exitplanmodev2tool)
11. [Plan Mode 附件系统](#11-plan-mode-附件系统)
12. [Plan workflow prompt](#12-plan-workflow-prompt)
13. [Explore Agent 与 Plan Agent](#13-explore-agent-与-plan-agent)
14. [Auto mode 与 Plan mode 的交互](#14-auto-mode-与-plan-mode-的交互)
15. [Teammate 审批流](#15-teammate-审批流)
16. [从零实现顺序](#16-从零实现顺序)
17. [最小可用版本](#17-最小可用版本)
18. [完整版本增强项](#18-完整版本增强项)
19. [测试清单](#19-测试清单)
20. [常见错误](#20-常见错误)
21. [关键结论](#21-关键结论)

---

## 1. 一句话总结

Plan Mode 是一个权限受限的规划状态。进入后，模型只能读取代码和编辑唯一的 plan 文件；完成规划后必须调用 `ExitPlanMode` 请求用户批准，批准后恢复进入前的权限模式并开始实现。

它由六层组成：

```
用户 /plan 或模型 EnterPlanMode
    │
    ▼
切换 toolPermissionContext.mode = "plan"
    │
    ▼
记录 prePlanMode，准备退出时恢复
    │
    ▼
附件系统注入 plan_mode 工作流 prompt
    │
    ▼
模型只读探索 + 写 plan 文件
    │
    ▼
模型调用 ExitPlanMode
    │
    ▼
用户或 team lead 审批
    │
    ▼
恢复 prePlanMode，注入 plan_mode_exit 附件
```

最重要的设计点：**`/plan` 本身只切换状态；真正指导模型如何规划的是附件系统注入的 plan mode prompt；真正退出和审批的是 `ExitPlanModeV2Tool`。**

---

## 2. 必须实现的能力边界

Plan Mode 必须支持：

1. 用户输入 `/plan` 进入 plan mode。
2. 用户输入 `/plan <description>` 进入 plan mode，并把描述作为下一轮模型查询。
3. 模型主动调用 `EnterPlanMode` 进入 plan mode。
4. 已在 plan mode 时，`/plan` 显示当前 plan 文件内容。
5. 已在 plan mode 时，`/plan open` 用外部编辑器打开 plan 文件。
6. 进入 plan mode 后，只允许读操作和编辑 plan 文件。
7. 进入 plan mode 后，附件系统注入 plan workflow 指令。
8. 模型必须把计划写到 plan 文件。
9. 模型必须用 `ExitPlanMode` 请求批准，不能用普通文本问“可以开始吗”。
10. 用户批准后恢复进入前的权限模式。
11. 退出后注入 `plan_mode_exit` 附件，提醒模型现在可以修改文件。
12. 会话恢复、fork、远程会话尽量保留 plan 文件。
13. teammate 可走 leader 审批流。

Plan Mode 不应该：

1. 直接修改业务文件。
2. 在 plan mode 内运行写操作 shell 命令。
3. 让 subagent 调用 `EnterPlanMode`。
4. 让模型在未写 plan 的情况下对 plan-required teammate 退出。
5. 在 channels 环境中进入一个无法退出的 plan mode。

---

## 3. 核心文件和职责

| 文件 | 职责 |
|------|------|
| `src/commands/plan/index.ts` | 注册 `/plan` local-jsx 命令 |
| `src/commands/plan/plan.tsx` | `/plan` 命令主逻辑：进入、显示、打开 plan |
| `src/bootstrap/state.ts` | 保存 plan mode 附件标志、plan slug cache、退出标志 |
| `src/utils/permissions/permissionSetup.ts` | 进入 plan mode 前准备权限上下文 |
| `src/utils/permissions/PermissionUpdate.ts` | 应用 `{ type: 'setMode', mode: 'plan' }` |
| `src/utils/plans.ts` | plan 文件路径、读写、slug、resume/fork 恢复 |
| `src/tools/EnterPlanModeTool/EnterPlanModeTool.ts` | 模型主动进入 plan mode 的工具 |
| `src/tools/EnterPlanModeTool/prompt.ts` | 告诉模型何时应该使用 EnterPlanMode |
| `src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts` | 退出、审批、恢复权限、返回 approved plan |
| `src/tools/ExitPlanModeTool/prompt.ts` | 告诉模型如何调用 ExitPlanMode |
| `src/utils/attachments.ts` | 根据状态生成 `plan_mode` / `plan_mode_exit` 附件 |
| `src/utils/messages.ts` | 把附件转换成模型可见 workflow prompt |
| `src/utils/planModeV2.ts` | Explore/Plan agent 数量、interview phase、实验变体 |
| `src/tools/AgentTool/built-in/exploreAgent.ts` | Explore agent 定义，只读搜索 |
| `src/tools/AgentTool/built-in/planAgent.ts` | Plan agent 定义，只读规划 |
| `src/tools.ts` | 注册 EnterPlanMode 和 ExitPlanMode 工具 |

---

## 4. 整体数据流

### 4.1 用户输入 `/plan`

```
用户输入 /plan [description]
    │
    ▼
processSlashCommand
    │
    ▼
找到 local-jsx command: plan
    │
    ▼
load() -> import('./plan.js')
    │
    ▼
call(onDone, context, args)
    │
    ├─ 当前不在 plan mode
    │     ├─ handlePlanModeTransition(currentMode, 'plan')
    │     ├─ prepareContextForPlanMode(...)
    │     ├─ applyPermissionUpdate(... setMode plan ...)
    │     └─ onDone('Enabled plan mode', { shouldQuery: args 非空且不是 open })
    │
    └─ 当前已在 plan mode
          ├─ 没有 plan 文件 -> onDone('Already in plan mode. No plan written yet.')
          ├─ args[0] === 'open' -> editFileInEditor(planPath)
          └─ 否则 renderToString(<PlanDisplay />)
```

### 4.2 模型主动调用 `EnterPlanMode`

```
模型判断任务复杂
    │
    ▼
调用 EnterPlanMode({})
    │
    ▼
validate: 非 agent context，channels 未启用
    │
    ▼
handlePlanModeTransition(currentMode, 'plan')
    │
    ▼
setAppState(toolPermissionContext.mode = 'plan')
    │
    ▼
tool_result 返回 plan mode 指令摘要
    │
    ▼
下一轮 attachment 注入完整 workflow prompt
```

### 4.3 模型退出 plan mode

```
模型写完 plan 文件
    │
    ▼
调用 ExitPlanMode({})
    │
    ▼
validate: 非 teammate 必须当前 mode === 'plan'
    │
    ▼
checkPermissions
    │
    ├─ teammate -> allow
    └─ 普通用户 -> ask "Exit plan mode?"
    │
    ▼
call()
    │
    ├─ 读取 plan 文件
    ├─ 如果 input.plan 存在，写回 plan 文件
    ├─ teammate required -> 发 leader mailbox，等待审批
    └─ 普通用户 -> 恢复 prePlanMode
    │
    ▼
tool_result:
  User has approved your plan. You can now start coding.
```

---

## 5. 最小状态模型

要实现 Plan Mode，至少需要以下状态字段。

### 5.1 ToolPermissionContext

伪类型：

```typescript
type ToolPermissionContext = {
  mode: 'default' | 'plan' | 'auto' | 'acceptEdits' | 'bypassPermissions'
  prePlanMode?: 'default' | 'auto' | 'acceptEdits' | 'bypassPermissions'
  strippedDangerousRules?: PermissionRule[]
}
```

字段含义：

| 字段 | 作用 |
|------|------|
| `mode` | 当前权限模式 |
| `prePlanMode` | 进入 plan mode 前的模式，退出时恢复 |
| `strippedDangerousRules` | auto/plan 期间临时移除的危险 allow rules |

### 5.2 Bootstrap state

伪类型：

```typescript
type BootstrapState = {
  needsPlanModeExitAttachment: boolean
  hasExitedPlanModeInSession: boolean
  planSlugCache: Map<SessionId, string>
}
```

字段含义：

| 字段 | 作用 |
|------|------|
| `needsPlanModeExitAttachment` | 刚退出 plan mode 时置 true，附件系统消费后清零 |
| `hasExitedPlanModeInSession` | 用于判断重新进入 plan mode 是否需要 reentry 指令 |
| `planSlugCache` | session id -> plan slug，保证同一 session 使用同一 plan 文件 |

### 5.3 关键状态函数

必须提供：

```typescript
function handlePlanModeTransition(fromMode: string, toMode: string): void
function needsPlanModeExitAttachment(): boolean
function setNeedsPlanModeExitAttachment(value: boolean): void
function hasExitedPlanModeInSession(): boolean
function setHasExitedPlanMode(value: boolean): void
function getPlanSlugCache(): Map<SessionId, string>
function getSessionId(): SessionId
```

`handlePlanModeTransition` 逻辑：

```typescript
if (toMode === 'plan' && fromMode !== 'plan') {
  STATE.needsPlanModeExitAttachment = false
}

if (fromMode === 'plan' && toMode !== 'plan') {
  STATE.needsPlanModeExitAttachment = true
}
```

注意：源码中 `ExitPlanModeV2Tool.call()` 也会显式设置：

```typescript
setHasExitedPlanMode(true)
setNeedsPlanModeExitAttachment(true)
```

---

## 6. `/plan` local-jsx 命令

### 6.1 注册文件

文件：`src/commands/plan/index.ts`

```typescript
const plan = {
  type: 'local-jsx',
  name: 'plan',
  description: 'Enable plan mode or view the current session plan',
  argumentHint: '[open|<description>]',
  load: () => import('./plan.js'),
} satisfies Command
```

实现要求：

1. `type` 必须是 `local-jsx`。
2. `name` 必须是 `plan`。
3. `load` 动态 import `./plan.js`。
4. 该 command 必须加入全局 commands 列表。

### 6.2 `call()` 函数签名

文件：`src/commands/plan/plan.tsx`

```typescript
export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  args: string,
): Promise<React.ReactNode>
```

`context` 至少需要：

```typescript
type LocalJSXCommandContext = {
  getAppState(): AppState
  setAppState(updater: (prev: AppState) => AppState): void
}
```

### 6.3 当前不在 plan mode

完整伪代码：

```typescript
const appState = getAppState()
const currentMode = appState.toolPermissionContext.mode

if (currentMode !== 'plan') {
  handlePlanModeTransition(currentMode, 'plan')

  setAppState(prev => ({
    ...prev,
    toolPermissionContext: applyPermissionUpdate(
      prepareContextForPlanMode(prev.toolPermissionContext),
      {
        type: 'setMode',
        mode: 'plan',
        destination: 'session',
      },
    ),
  }))

  const description = args.trim()
  if (description && description !== 'open') {
    onDone('Enabled plan mode', { shouldQuery: true })
  } else {
    onDone('Enabled plan mode')
  }

  return null
}
```

分支含义：

| 输入 | 行为 |
|------|------|
| `/plan` | 进入 plan mode，不立即 query |
| `/plan open` 且当前不在 plan mode | 只进入 plan mode，不打开文件 |
| `/plan 重构认证模块` | 进入 plan mode，并 `shouldQuery: true` |

为什么 `/plan <description>` 要 `shouldQuery: true`：用户提供了任务描述，进入 plan mode 后要立刻让模型开始规划。

### 6.4 当前已在 plan mode

完整伪代码：

```typescript
const planContent = getPlan()
const planPath = getPlanFilePath()

if (!planContent) {
  onDone('Already in plan mode. No plan written yet.')
  return null
}

const argList = args.trim().split(/\s+/)

if (argList[0] === 'open') {
  const result = await editFileInEditor(planPath)
  if (result.error) {
    onDone(`Failed to open plan in editor: ${result.error}`)
  } else {
    onDone(`Opened plan in editor: ${planPath}`)
  }
  return null
}

const editor = getExternalEditor()
const editorName = editor ? toIDEDisplayName(editor) : undefined
const display = (
  <PlanDisplay
    planContent={planContent}
    planPath={planPath}
    editorName={editorName}
  />
)

const output = await renderToString(display)
onDone(output)
return null
```

### 6.5 PlanDisplay 组件

显示结构：

```tsx
<Box flexDirection="column">
  <Text bold>Current Plan</Text>
  <Text dimColor>{planPath}</Text>
  <Box marginTop={1}>
    <Text>{planContent}</Text>
  </Box>
  {editorName && (
    <Box marginTop={1}>
      <Text dimColor>"/plan open"</Text>
      <Text dimColor> to edit this plan in </Text>
      <Text bold dimColor>{editorName}</Text>
    </Box>
  )}
</Box>
```

注意：源码使用 React compiler cache，复现时不需要实现缓存。

---

## 7. Plan 文件系统

核心文件：`src/utils/plans.ts`

### 7.1 文件位置

默认：

```text
~/.claude/plans/{slug}.md
```

如果是 subagent：

```text
~/.claude/plans/{slug}-agent-{agentId}.md
```

如果用户设置了 `plansDirectory`：

```json
{
  "plansDirectory": ".claude/plans"
}
```

则相对于项目根目录解析，且必须位于项目根目录内。

### 7.2 必须实现的 API

```typescript
function getPlanSlug(sessionId?: SessionId): string
function setPlanSlug(sessionId: SessionId, slug: string): void
function clearPlanSlug(sessionId?: SessionId): void
function clearAllPlanSlugs(): void
function getPlansDirectory(): string
function getPlanFilePath(agentId?: AgentId): string
function getPlan(agentId?: AgentId): string | null
async function copyPlanForResume(log: LogOption, targetSessionId?: SessionId): Promise<boolean>
async function copyPlanForFork(log: LogOption, targetSessionId: SessionId): Promise<boolean>
async function persistFileSnapshotIfRemote(): Promise<void>
```

### 7.3 `getPlansDirectory`

伪代码：

```typescript
function getPlansDirectory(): string {
  const settingsDir = getInitialSettings().plansDirectory

  if (settingsDir) {
    const cwd = getCwd()
    const resolved = resolve(cwd, settingsDir)

    if (!resolved.startsWith(cwd + sep) && resolved !== cwd) {
      logError(new Error(`plansDirectory must be within project root: ${settingsDir}`))
      return join(getClaudeConfigHomeDir(), 'plans')
    }

    mkdirSync(resolved, { recursive: true })
    return resolved
  }

  const fallback = join(getClaudeConfigHomeDir(), 'plans')
  mkdirSync(fallback, { recursive: true })
  return fallback
}
```

源码中该函数用 `memoize` 包裹，因为渲染和权限检查会频繁调用。

### 7.4 `getPlanSlug`

伪代码：

```typescript
function getPlanSlug(sessionId = getSessionId()) {
  const cache = getPlanSlugCache()
  let slug = cache.get(sessionId)

  if (!slug) {
    const plansDir = getPlansDirectory()
    for (let i = 0; i < 10; i++) {
      slug = generateWordSlug()
      const filePath = join(plansDir, `${slug}.md`)
      if (!existsSync(filePath)) break
    }
    cache.set(sessionId, slug)
  }

  return slug
}
```

关键规则：

1. slug 延迟生成。
2. 同一 session id 重复调用返回同一个 slug。
3. 最多重试 10 次避免文件名冲突。
4. 生成结果放进 `planSlugCache`。

### 7.5 `getPlanFilePath`

```typescript
function getPlanFilePath(agentId?: AgentId): string {
  const planSlug = getPlanSlug(getSessionId())

  if (!agentId) {
    return join(getPlansDirectory(), `${planSlug}.md`)
  }

  return join(getPlansDirectory(), `${planSlug}-agent-${agentId}.md`)
}
```

### 7.6 `getPlan`

```typescript
function getPlan(agentId?: AgentId): string | null {
  const filePath = getPlanFilePath(agentId)
  try {
    return readFileSync(filePath, 'utf-8')
  } catch (error) {
    if (isENOENT(error)) return null
    logError(error)
    return null
  }
}
```

### 7.7 Resume 恢复

`copyPlanForResume(log, targetSessionId)`：

1. 从消息历史中找 `slug`。
2. `setPlanSlug(targetSessionId, slug)`。
3. 如果 plan 文件还在，返回 true。
4. 如果文件丢失且不是远程环境，返回 false。
5. 如果是远程环境，尝试恢复：
   - 优先从 `file_snapshot` 中找 `key === 'plan'`
   - 否则从消息历史中找 `ExitPlanMode` tool_use input 的 `plan`
   - 否则找 user message 的 `planContent`
   - 否则找 `plan_file_reference` attachment
6. 恢复成功后写回 plan 文件。

### 7.8 Fork 恢复

`copyPlanForFork(log, targetSessionId)`：

1. 从原日志取 original slug。
2. 为 target session 生成新 slug。
3. 把原 plan 文件复制到新 plan 文件。
4. 不复用原 slug，避免 fork 会话互相覆盖。

### 7.9 远程会话 snapshot

`persistFileSnapshotIfRemote()`：

1. 只在远程环境中运行。
2. 读取当前 plan 文件。
3. 写入一条 `system` / `file_snapshot` transcript message。
4. 用于 remote resume 时恢复 plan 文件。

---

## 8. 权限模式切换

核心文件：`src/utils/permissions/permissionSetup.ts`

### 8.1 `prepareContextForPlanMode`

完整伪代码：

```typescript
function prepareContextForPlanMode(context: ToolPermissionContext) {
  const currentMode = context.mode
  if (currentMode === 'plan') return context

  if (feature('TRANSCRIPT_CLASSIFIER')) {
    const planAutoMode = shouldPlanUseAutoMode()

    if (currentMode === 'auto') {
      if (planAutoMode) {
        return { ...context, prePlanMode: 'auto' }
      }

      autoModeStateModule?.setAutoModeActive(false)
      setNeedsAutoModeExitAttachment(true)
      return {
        ...restoreDangerousPermissions(context),
        prePlanMode: 'auto',
      }
    }

    if (planAutoMode && currentMode !== 'bypassPermissions') {
      autoModeStateModule?.setAutoModeActive(true)
      return {
        ...stripDangerousPermissionsForAutoMode(context),
        prePlanMode: currentMode,
      }
    }
  }

  return { ...context, prePlanMode: currentMode }
}
```

### 8.2 行为表

| 进入前模式 | planAutoMode | 结果 |
|------------|--------------|------|
| `plan` | 任意 | 原样返回 |
| `auto` | true | 保持 auto active，记录 `prePlanMode: 'auto'` |
| `auto` | false | 关闭 auto active，恢复危险权限，记录 `prePlanMode: 'auto'` |
| `default` | true | 打开 auto active，剥离危险权限，记录 `prePlanMode: 'default'` |
| `acceptEdits` | true | 打开 auto active，剥离危险权限，记录 `prePlanMode: 'acceptEdits'` |
| `bypassPermissions` | true | 不打开 auto，记录 `prePlanMode: 'bypassPermissions'` |
| 其他 | false | 只记录 `prePlanMode: currentMode` |

### 8.3 应用 mode 更新

进入 plan mode 时不能只改 `mode`，必须先 `prepareContextForPlanMode`，再 `applyPermissionUpdate`：

```typescript
toolPermissionContext: applyPermissionUpdate(
  prepareContextForPlanMode(prev.toolPermissionContext),
  { type: 'setMode', mode: 'plan', destination: 'session' },
)
```

这样才能保留 `prePlanMode` 和 auto mode side effects。

### 8.4 Plan mode 权限规则

复现时至少要保证：

| 工具类别 | Plan mode 行为 |
|----------|----------------|
| FileRead | 允许 |
| Glob/Grep | 允许 |
| FileWrite | 只允许写 plan 文件 |
| FileEdit | 只允许编辑 plan 文件 |
| NotebookEdit | 禁止 |
| Bash/PowerShell | 只允许只读命令 |
| Agent | 允许 Explore/Plan 等只读 agent |
| ExitPlanMode | 允许主线程调用；部分 agent 场景特殊处理 |
| EnterPlanMode | agent context 禁止 |

实现上可以在权限检查层判断：

```typescript
if (context.mode === 'plan') {
  if (tool is readOnly) allow
  if (tool edits file && target === getPlanFilePath(agentId)) allow
  if (tool === ExitPlanMode) allow
  otherwise deny or ask
}
```

---

## 9. EnterPlanModeTool

核心文件：`src/tools/EnterPlanModeTool/EnterPlanModeTool.ts`

### 9.1 工具定义

```typescript
export const EnterPlanModeTool = buildTool({
  name: 'EnterPlanMode',
  searchHint: 'switch to plan mode to design an approach before coding',
  shouldDefer: true,
  isConcurrencySafe: true,
  isReadOnly: true,
})
```

### 9.2 Schema

输入是 strict empty object：

```typescript
const inputSchema = z.strictObject({})
```

输出：

```typescript
{
  message: string
}
```

### 9.3 isEnabled

channels 场景禁用：

```typescript
if ((feature('KAIROS') || feature('KAIROS_CHANNELS')) &&
    getAllowedChannels().length > 0) {
  return false
}
return true
```

原因：channels 用户可能不在 TUI 前，`ExitPlanMode` 审批弹窗会卡住。

### 9.4 call

完整伪代码：

```typescript
async call(_input, context) {
  if (context.agentId) {
    throw new Error('EnterPlanMode tool cannot be used in agent contexts')
  }

  const appState = context.getAppState()
  handlePlanModeTransition(appState.toolPermissionContext.mode, 'plan')

  context.setAppState(prev => ({
    ...prev,
    toolPermissionContext: applyPermissionUpdate(
      prepareContextForPlanMode(prev.toolPermissionContext),
      { type: 'setMode', mode: 'plan', destination: 'session' },
    ),
  }))

  return {
    data: {
      message:
        'Entered plan mode. You should now focus on exploring the codebase and designing an implementation approach.',
    },
  }
}
```

### 9.5 tool_result 映射

标准模式返回：

```text
Entered plan mode...

In plan mode, you should:
1. Thoroughly explore the codebase...
...
Remember: DO NOT write or edit any files yet.
```

interview phase 返回：

```text
Entered plan mode...

DO NOT write or edit any files except the plan file.
Detailed workflow instructions will follow.
```

注意：完整 workflow 不在这里，而在 attachment -> messages.ts 中注入。

---

## 10. ExitPlanModeV2Tool

核心文件：`src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts`

这是 Plan Mode 最复杂的模块。要一比一实现，必须按分支表写。

### 10.1 工具定义

```typescript
export const ExitPlanModeV2Tool = buildTool({
  name: 'ExitPlanMode',
  searchHint: 'present plan for approval and start coding (plan mode only)',
  shouldDefer: true,
  isConcurrencySafe: true,
  isReadOnly: false,
})
```

### 10.2 Schema

源码的公开 input schema 是 strict empty object：

```typescript
const inputSchema = z.strictObject({})
```

但 `call()` 内部会检查：

```typescript
const inputPlan =
  'plan' in input && typeof input.plan === 'string' ? input.plan : undefined
```

原因：CCR web UI 或 permission result 可能把用户编辑过的 plan 放进 `input.plan`。这个字段不是普通模型应该手写的 schema 字段。

输出包含：

```typescript
type Output = {
  plan?: string | null
  isAgent?: boolean
  filePath?: string
  hasTaskTool?: boolean
  planWasEdited?: boolean
  awaitingLeaderApproval?: boolean
  requestId?: string
}
```

### 10.3 requiresUserInteraction

```typescript
requiresUserInteraction() {
  if (isTeammate()) return false
  return true
}
```

含义：

| 场景 | 是否需要本地用户弹窗 |
|------|----------------------|
| 普通用户 | 需要 |
| teammate plan required | 不需要本地弹窗，发给 leader 审批 |
| teammate voluntary plan | 不需要本地弹窗，直接退出 |

### 10.4 validateInput

```typescript
async validateInput(_input, { getAppState, options }) {
  if (isTeammate()) {
    return { result: true }
  }

  const mode = getAppState().toolPermissionContext.mode
  if (mode !== 'plan') {
    logEvent('tengu_exit_plan_mode_called_outside_plan', ...)
    return {
      result: false,
      message:
        'You are not in plan mode. This tool is only for exiting plan mode after writing a plan. If your plan was already approved, continue with implementation.',
      errorCode: 1,
    }
  }

  return { result: true }
}
```

### 10.5 checkPermissions

```typescript
async checkPermissions(input, context) {
  if (isTeammate()) {
    return { behavior: 'allow', updatedInput: input }
  }

  return {
    behavior: 'ask',
    message: 'Exit plan mode?',
    updatedInput: input,
  }
}
```

### 10.6 call 总流程

伪代码：

```typescript
async call(input, context) {
  const isAgent = !!context.agentId
  const filePath = getPlanFilePath(context.agentId)
  const inputPlan =
    'plan' in input && typeof input.plan === 'string'
      ? input.plan
      : undefined
  const plan = inputPlan ?? getPlan(context.agentId)

  if (inputPlan !== undefined && filePath) {
    await writeFile(filePath, inputPlan, 'utf-8').catch(logError)
    void persistFileSnapshotIfRemote()
  }

  if (isTeammate() && isPlanModeRequired()) {
    return await submitPlanToLeader(...)
  }

  restorePermissionMode(context)

  const hasTaskTool =
    isAgentSwarmsEnabled() &&
    context.options.tools.some(t => toolMatchesName(t, AGENT_TOOL_NAME))

  return {
    data: {
      plan,
      isAgent,
      filePath,
      hasTaskTool: hasTaskTool || undefined,
      planWasEdited: inputPlan !== undefined || undefined,
    },
  }
}
```

### 10.7 teammate required 分支

如果 `isTeammate() && isPlanModeRequired()`：

1. 如果没有 plan，抛错：

```typescript
throw new Error(
  `No plan file found at ${filePath}. Please write your plan to this file before calling ExitPlanMode.`,
)
```

2. 生成 `requestId`：

```typescript
generateRequestId('plan_approval', formatAgentId(agentName, teamName || 'default'))
```

3. 写 mailbox：

```typescript
const approvalRequest = {
  type: 'plan_approval_request',
  from: agentName,
  timestamp: new Date().toISOString(),
  planFilePath: filePath,
  planContent: plan,
  requestId,
}

await writeToMailbox(
  'team-lead',
  {
    from: agentName,
    text: jsonStringify(approvalRequest),
    timestamp: new Date().toISOString(),
  },
  teamName,
)
```

4. 如果是 in-process teammate，更新 task 状态为 awaiting approval。
5. 返回：

```typescript
{
  plan,
  isAgent: true,
  filePath,
  awaitingLeaderApproval: true,
  requestId,
}
```

### 10.8 普通退出时恢复权限

核心伪代码：

```typescript
context.setAppState(prev => {
  if (prev.toolPermissionContext.mode !== 'plan') return prev

  setHasExitedPlanMode(true)
  setNeedsPlanModeExitAttachment(true)

  let restoreMode = prev.toolPermissionContext.prePlanMode ?? 'default'

  if (feature('TRANSCRIPT_CLASSIFIER')) {
    if (restoreMode === 'auto' && !isAutoModeGateEnabled()) {
      restoreMode = 'default'
    }

    const restoringToAuto = restoreMode === 'auto'
    const autoWasUsedDuringPlan = autoModeStateModule?.isAutoModeActive() ?? false
    autoModeStateModule?.setAutoModeActive(restoringToAuto)

    if (autoWasUsedDuringPlan && !restoringToAuto) {
      setNeedsAutoModeExitAttachment(true)
    }
  }

  let baseContext = prev.toolPermissionContext

  if (restoreMode === 'auto') {
    baseContext = stripDangerousPermissionsForAutoMode(baseContext)
  } else if (prev.toolPermissionContext.strippedDangerousRules) {
    baseContext = restoreDangerousPermissions(baseContext)
  }

  return {
    ...prev,
    toolPermissionContext: {
      ...baseContext,
      mode: restoreMode,
      prePlanMode: undefined,
    },
  }
})
```

### 10.9 gate fallback notification

如果进入 plan 前是 `auto`，但退出时 auto gate 关闭：

1. 恢复到 `default`。
2. 添加 notification：

```typescript
context.addNotification?.({
  key: 'auto-mode-gate-plan-exit-fallback',
  text: `plan exit -> default · ${gateFallbackNotification}`,
  priority: 'immediate',
  color: 'warning',
  timeoutMs: 10000,
})
```

### 10.10 tool_result 映射

#### teammate 等待审批

```text
Your plan has been submitted to the team lead for approval.

Plan file: <filePath>

What happens next:
1. Wait for the team lead to review your plan
2. You will receive a message in your inbox with approval/rejection
3. If approved, you can proceed with implementation
4. If rejected, refine your plan based on the feedback

Important: Do NOT proceed until you receive approval.

Request ID: <requestId>
```

#### agent 场景

```text
User has approved the plan. There is nothing else needed from you now. Please respond with "ok"
```

#### 空 plan

```text
User has approved exiting plan mode. You can now proceed.
```

#### 普通用户批准

```text
User has approved your plan. You can now start coding. Start with updating your todo list if applicable

Your plan has been saved to: <filePath>
You can refer back to it if needed during implementation.

## Approved Plan:
<plan>
```

如果用户编辑过 plan，标题变成：

```text
## Approved Plan (edited by user):
```

如果当前工具列表有 Agent/Team 工具，还会附加并行任务提示。

---

## 11. Plan Mode 附件系统

核心文件：`src/utils/attachments.ts` 和 `src/utils/messages.ts`

### 11.1 Attachment 类型

必须支持：

```typescript
type Attachment =
  | {
      type: 'plan_mode'
      reminderType: 'full' | 'sparse'
      isSubAgent?: boolean
      planFilePath: string
      planExists: boolean
    }
  | {
      type: 'plan_mode_reentry'
      planFilePath: string
    }
  | {
      type: 'plan_mode_exit'
      planFilePath: string
      planExists: boolean
    }
  | {
      type: 'plan_file_reference'
      planFilePath: string
      planContent: string
    }
```

### 11.2 `getPlanModeAttachments`

生成条件：

1. 当前 `toolPermissionContext.mode !== 'plan'`，返回 `[]`。
2. 如果已有 plan mode attachment 且距离上次不足阈值 human turns，返回 `[]`。
3. 读取 `planFilePath = getPlanFilePath(agentId)`。
4. 读取 `existingPlan = getPlan(agentId)`。
5. 如果 `hasExitedPlanModeInSession()` 且 plan 存在，先加入 `plan_mode_reentry`，然后 `setHasExitedPlanMode(false)`。
6. 计算 full/sparse reminder。
7. 加入 `plan_mode` attachment。

伪代码：

```typescript
async function getPlanModeAttachments(messages, toolUseContext) {
  const mode = toolUseContext.getAppState().toolPermissionContext.mode
  if (mode !== 'plan') return []

  if (messages?.length) {
    const { turnCount, foundPlanModeAttachment } =
      getPlanModeAttachmentTurnCount(messages)

    if (foundPlanModeAttachment &&
        turnCount < PLAN_MODE_ATTACHMENT_CONFIG.TURNS_BETWEEN_ATTACHMENTS) {
      return []
    }
  }

  const planFilePath = getPlanFilePath(toolUseContext.agentId)
  const existingPlan = getPlan(toolUseContext.agentId)
  const attachments = []

  if (hasExitedPlanModeInSession() && existingPlan !== null) {
    attachments.push({ type: 'plan_mode_reentry', planFilePath })
    setHasExitedPlanMode(false)
  }

  const attachmentCount =
    countPlanModeAttachmentsSinceLastExit(messages ?? []) + 1

  const reminderType =
    attachmentCount % FULL_REMINDER_EVERY_N_ATTACHMENTS === 1
      ? 'full'
      : 'sparse'

  attachments.push({
    type: 'plan_mode',
    reminderType,
    isSubAgent: !!toolUseContext.agentId,
    planFilePath,
    planExists: existingPlan !== null,
  })

  return attachments
}
```

### 11.3 human turn 计数

`getPlanModeAttachmentTurnCount(messages)` 从后往前扫描：

1. 只数 human user turns。
2. 不数 `isMeta` user message。
3. 不数 tool_result user message。
4. 遇到最近的 `plan_mode` 或 `plan_mode_reentry` attachment 停止。

这是为了避免 tool loop 中每次工具调用都重复注入 plan prompt。

### 11.4 full/sparse 规则

源码逻辑：

```typescript
const attachmentCount =
  countPlanModeAttachmentsSinceLastExit(messages ?? []) + 1

const reminderType =
  attachmentCount % FULL_REMINDER_EVERY_N_ATTACHMENTS === 1
    ? 'full'
    : 'sparse'
```

含义：第 1、N+1、2N+1 次注入 full，其余 sparse。

### 11.5 `getPlanModeExitAttachment`

退出后一次性注入：

```typescript
async function getPlanModeExitAttachment(toolUseContext) {
  if (!needsPlanModeExitAttachment()) return []

  const appState = toolUseContext.getAppState()
  if (appState.toolPermissionContext.mode === 'plan') {
    setNeedsPlanModeExitAttachment(false)
    return []
  }

  setNeedsPlanModeExitAttachment(false)

  const planFilePath = getPlanFilePath(toolUseContext.agentId)
  const planExists = getPlan(toolUseContext.agentId) !== null

  return [{ type: 'plan_mode_exit', planFilePath, planExists }]
}
```

### 11.6 messages.ts 中的渲染

`plan_mode`：

```typescript
return getPlanModeInstructions(attachment)
```

`plan_mode_reentry`：

```text
You are returning to plan mode after having previously exited it.
A plan file exists at <path>.

Before proceeding:
1. Read existing plan
2. Compare current request
3. Different task -> overwrite
4. Same task -> modify and clean stale parts
5. Always edit plan file before ExitPlanMode
```

`plan_mode_exit`：

```text
## Exited Plan Mode

You have exited plan mode. You can now make edits, run tools, and take actions.
The plan file is located at <path> if you need to reference it.
```

---

## 12. Plan workflow prompt

核心文件：`src/utils/messages.ts`

### 12.1 标准 5 阶段 workflow

`getPlanModeV2Instructions(attachment)` 生成主要 prompt。

开头必须包含硬约束：

```text
Plan mode is active. The user indicated that they do not want you to execute yet -- you MUST NOT make any edits (with the exception of the plan file mentioned below), run any non-readonly tools (including changing configs or making commits), or otherwise make any changes to the system. This supercedes any other instructions you have received.
```

然后给出 plan 文件信息：

```text
No plan file exists yet. You should create your plan at <path> using FileWrite.
```

或：

```text
A plan file already exists at <path>. You can read it and make incremental edits using FileEdit.
```

### 12.2 Phase 1: Initial Understanding

要求：

1. 全面理解用户请求。
2. 搜索可复用函数、工具、模式。
3. 只能使用 `Explore` subagent 类型。
4. 最多启动 `getPlanModeV2ExploreAgentCount()` 个 Explore agents。
5. 单文件/小改动用 1 个 agent。
6. 范围不确定或跨模块时用多个 agent。

### 12.3 Phase 2: Design

要求：

1. 启动 `Plan` agent 设计实现。
2. 默认至少 1 个 Plan agent。
3. trivial task 可以跳过。
4. 最多 `getPlanModeV2AgentCount()` 个 Plan agents。
5. agent prompt 必须包含 Phase 1 的完整背景、文件名、代码路径、约束。

### 12.4 Phase 3: Review

要求：

1. 读取 agents 识别出的关键文件。
2. 确认方案符合用户原始意图。
3. 有疑问时用 `AskUserQuestion`。

### 12.5 Phase 4: Final Plan

要求模型把 plan 写入 plan 文件。

默认 control 版本至少包括：

1. context：为什么要做这个改动。
2. 推荐方案，不列无关替代方案。
3. 需要修改的关键文件路径。
4. 可复用的现有函数和工具，带文件路径。
5. 验证方式，最好是端到端命令。

### 12.6 Phase 5: ExitPlanMode

关键规则：

1. 当计划完成后必须调用 `ExitPlanMode`。
2. 当前 turn 只能以 `AskUserQuestion` 或 `ExitPlanMode` 结束。
3. 不允许普通文本问“这个计划可以吗”。
4. 不允许用 `AskUserQuestion` 请求 plan approval。
5. 只有澄清需求或选择方案时才用 `AskUserQuestion`。

### 12.7 Interview phase

开关函数：

```typescript
function isPlanModeInterviewPhaseEnabled() {
  if (process.env.USER_TYPE === 'ant') return true
  const env = process.env.CLAUDE_CODE_PLAN_MODE_INTERVIEW_PHASE
  if (isEnvTruthy(env)) return true
  if (isEnvDefinedFalsy(env)) return false
  return getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_plan_mode_interview_phase',
    false,
  )
}
```

interview phase 不强制 Explore/Plan agents，而是让模型：

1. 直接读取代码。
2. 逐步写 plan 文件。
3. 遇到决策就问用户。
4. 反复迭代，直到所有歧义解决。
5. 最后调用 `ExitPlanMode`。

首轮要求：

```text
Start by quickly scanning a few key files to form an initial understanding.
Then write a skeleton plan and ask the user your first round of questions.
Don't explore exhaustively before engaging the user.
```

### 12.8 PewterLedger 实验

文件：`src/utils/planModeV2.ts`

变体：

```typescript
type PewterLedgerVariant = 'trim' | 'cut' | 'cap' | null
```

| 变体 | 作用 |
|------|------|
| `null` | control，完整 plan |
| `trim` | 轻度缩短 |
| `cut` | 中度缩短，减少背景 |
| `cap` | 强限制，40 行上限 |

复现最小版本可以先只实现 control。

---

## 13. Explore Agent 与 Plan Agent

### 13.1 Explore Agent

文件：`src/tools/AgentTool/built-in/exploreAgent.ts`

关键定义：

```typescript
const EXPLORE_AGENT = {
  agentType: 'Explore',
  model: process.env.USER_TYPE === 'ant' ? 'inherit' : 'haiku',
  omitClaudeMd: true,
  disallowedTools: [
    'Agent',
    'ExitPlanMode',
    'FileEdit',
    'FileWrite',
    'NotebookEdit',
  ],
}
```

必须保证：

1. 只读。
2. 不能嵌套 Agent。
3. 不能退出 plan mode。
4. 不能写文件。
5. 主要用于快速搜索代码。

### 13.2 Plan Agent

文件：`src/tools/AgentTool/built-in/planAgent.ts`

关键定义：

```typescript
const PLAN_AGENT = {
  agentType: 'Plan',
  model: 'inherit',
  omitClaudeMd: true,
  tools: EXPLORE_AGENT.tools,
  disallowedTools: EXPLORE_AGENT.disallowedTools,
}
```

Plan Agent 的 prompt 要求：

1. 作为软件架构师。
2. 基于 Explore 结果设计方案。
3. 输出分步实现策略。
4. 输出 `Critical Files for Implementation`。
5. 仍然只读，不能写文件。

### 13.3 agent 数量

文件：`src/utils/planModeV2.ts`

```typescript
function getPlanModeV2ExploreAgentCount() {
  if (env CLAUDE_CODE_PLAN_V2_EXPLORE_AGENT_COUNT is 1..10) return env
  return 3
}

function getPlanModeV2AgentCount() {
  if (env CLAUDE_CODE_PLAN_V2_AGENT_COUNT is 1..10) return env
  if (subscriptionType === 'max' && rateLimitTier === 'default_claude_max_20x') return 3
  if (subscriptionType === 'enterprise' || subscriptionType === 'team') return 3
  return 1
}
```

---

## 14. Auto mode 与 Plan mode 的交互

如果实现项目没有 auto mode，可以跳过本节，直接把 `prePlanMode` 恢复为原 mode。

如果有 auto mode，必须实现：

1. `shouldPlanUseAutoMode()`
2. `prepareContextForPlanMode()`
3. `transitionPlanAutoMode()`
4. ExitPlanMode 里的 auto restore/fallback

### 14.1 shouldPlanUseAutoMode

```typescript
return (
  hasAutoModeOptIn() &&
  isAutoModeGateEnabled() &&
  getUseAutoModeDuringPlan()
)
```

### 14.2 settings 中途变化

`transitionPlanAutoMode(context)`：

1. 只在 `mode === 'plan'` 时生效。
2. 如果 `prePlanMode === 'bypassPermissions'`，不激活 auto。
3. 如果 want 和 have 都 true，重新 strip dangerous permissions。
4. 如果 want true have false，打开 auto 并 strip。
5. 如果 want false have true，关闭 auto 并 restore dangerous permissions。

---

## 15. Teammate 审批流

当 teammate 使用 plan mode，分两类。

### 15.1 plan_mode_required teammate

流程：

```
teammate 调用 ExitPlanMode
    │
    ├─ 如果 plan 文件不存在 -> 抛错
    │
    ├─ 生成 plan_approval_request
    │
    ├─ 写入 team-lead mailbox
    │
    ├─ 标记 teammate task awaiting approval
    │
    └─ 返回 awaitingLeaderApproval: true
```

teammate 收到 tool result 后必须停止实现，等待 inbox。

### 15.2 voluntary plan mode teammate

如果不是 required：

1. `requiresUserInteraction()` 返回 false。
2. `checkPermissions()` allow。
3. `call()` 直接恢复权限模式。

---

## 16. 从零实现顺序

如果让 GPT-4 级别模型实现，不要一次让它写全部。按这个顺序分任务。

### 步骤 1：实现状态字段

实现：

1. `toolPermissionContext.mode`
2. `toolPermissionContext.prePlanMode`
3. `needsPlanModeExitAttachment`
4. `hasExitedPlanModeInSession`
5. `planSlugCache`

### 步骤 2：实现 `plans.ts`

实现：

1. `getPlansDirectory`
2. `getPlanSlug`
3. `getPlanFilePath`
4. `getPlan`
5. `clearPlanSlug`

先不实现 resume/fork。

### 步骤 3：实现权限准备函数

实现：

1. `handlePlanModeTransition`
2. `prepareContextForPlanMode`
3. `applyPermissionUpdate({ type: 'setMode' })`

### 步骤 4：实现 `/plan` 命令

实现：

1. `src/commands/plan/index.ts`
2. `src/commands/plan/plan.tsx`
3. `PlanDisplay`
4. `/plan open`

### 步骤 5：实现 Plan Mode 权限拦截

至少保证：

1. 读工具允许。
2. 非 plan 文件写入禁止。
3. plan 文件写入允许。
4. ExitPlanMode 允许。

### 步骤 6：实现 EnterPlanModeTool

实现：

1. empty input schema
2. channels disabled gate
3. agent context 禁止
4. call 切 mode
5. tool_result prompt

### 步骤 7：实现 ExitPlanModeV2Tool

先实现普通用户版本：

1. validate mode 必须是 plan
2. checkPermissions ask
3. 读取 plan
4. 恢复 prePlanMode
5. 返回 approved plan

再补 teammate 和 input.plan。

### 步骤 8：实现 attachment

实现：

1. `plan_mode`
2. `plan_mode_exit`
3. `plan_mode_reentry`
4. human turn throttle

### 步骤 9：实现 workflow prompt

先实现标准 5 阶段。

之后再补：

1. interview phase
2. PewterLedger variants
3. sparse reminders

### 步骤 10：实现 Explore/Plan agents

实现：

1. Explore agent 只读定义
2. Plan agent 只读定义
3. agent count env override

### 步骤 11：实现恢复和远程增强

实现：

1. `copyPlanForResume`
2. `copyPlanForFork`
3. `persistFileSnapshotIfRemote`
4. `plan_file_reference`

---

## 17. 最小可用版本

如果只想先跑通 Plan Mode，保留这些：

1. `/plan` 命令。
2. `toolPermissionContext.mode = 'plan'`。
3. `prePlanMode`。
4. `getPlanFilePath` 和 `getPlan`。
5. 只允许写 plan 文件。
6. `EnterPlanModeTool`。
7. `ExitPlanModeTool` 普通用户流程。
8. `plan_mode` 附件注入一个简单 workflow。

可以暂时省略：

1. auto mode。
2. teammate。
3. resume/fork。
4. remote snapshot。
5. PewterLedger。
6. interview phase。
7. full/sparse 节流。
8. Explore/Plan agent 数量实验。

最小可用数据流：

```
/plan task
    │
    ▼
mode = plan, prePlanMode = oldMode
    │
    ▼
attachment 注入：只能读代码，写 plan 文件
    │
    ▼
模型写 ~/.claude/plans/<slug>.md
    │
    ▼
模型调用 ExitPlanMode
    │
    ▼
用户批准
    │
    ▼
mode = prePlanMode
```

---

## 18. 完整版本增强项

按优先级补：

1. `/plan open`。
2. `plan_mode_exit` 附件。
3. `plan_mode_reentry` 附件。
4. full/sparse 注入节流。
5. Explore/Plan agents。
6. agent count env override。
7. interview phase。
8. auto mode integration。
9. teammate approval。
10. resume/fork plan recovery。
11. remote file snapshot。
12. PewterLedger variants。

---

## 19. 测试清单

### 19.1 `/plan` 基本行为

```text
初始 mode = default
输入 /plan
期望:
- mode = plan
- prePlanMode = default
- onDone('Enabled plan mode')
- shouldQuery 不为 true
```

```text
初始 mode = default
输入 /plan 重构认证模块
期望:
- mode = plan
- prePlanMode = default
- onDone('Enabled plan mode', { shouldQuery: true })
```

```text
初始 mode = plan
没有 plan 文件
输入 /plan
期望:
- onDone('Already in plan mode. No plan written yet.')
```

```text
初始 mode = plan
有 plan 文件
输入 /plan
期望:
- 输出 Current Plan
- 输出 plan path
- 输出 plan content
```

```text
初始 mode = plan
有 plan 文件
输入 /plan open
期望:
- 调用 editFileInEditor(planPath)
- 成功时输出 Opened plan in editor
- 失败时输出 Failed to open plan in editor
```

### 19.2 Plan 文件

测试：

1. 同一 session 多次 `getPlanFilePath()` 返回同一路径。
2. 不同 session slug 不同。
3. `agentId` 存在时文件名包含 `-agent-{agentId}`。
4. `plansDirectory` 越界时 fallback 到 `~/.claude/plans`。
5. `getPlan()` 文件不存在返回 null。
6. `getPlan()` 读错误时 logError 并返回 null。

### 19.3 EnterPlanModeTool

测试：

1. input schema 不接受任何字段。
2. `context.agentId` 存在时抛错。
3. channels active 时 `isEnabled() === false`。
4. call 后 mode 变 plan。
5. call 后 `prePlanMode` 记录旧 mode。

### 19.4 ExitPlanModeV2Tool

普通用户：

1. mode 不是 plan 时 validate 拒绝。
2. mode 是 plan 时 validate 通过。
3. checkPermissions 返回 ask。
4. call 后 mode 恢复 prePlanMode。
5. call 后 `prePlanMode` 清空。
6. call 后 `hasExitedPlanModeInSession = true`。
7. call 后 `needsPlanModeExitAttachment = true`。
8. plan 为空时 tool_result 返回 “approved exiting plan mode”。
9. plan 非空时 tool_result 包含 approved plan。

input.plan：

1. 传入 `input.plan` 时写回 plan 文件。
2. `planWasEdited = true`。
3. tool_result 标题是 `Approved Plan (edited by user)`。

teammate：

1. `requiresUserInteraction()` 返回 false。
2. plan_required 且无 plan 时抛错。
3. plan_required 且有 plan 时写 mailbox。
4. 返回 `awaitingLeaderApproval: true`。

### 19.5 附件系统

测试：

1. mode 非 plan 时不注入 `plan_mode`。
2. mode plan 时注入 `plan_mode`。
3. plan 文件不存在时 `planExists = false`。
4. plan 文件存在时 `planExists = true`。
5. tool loop 中不因为 assistant/tool messages 反复注入。
6. 退出后注入一次 `plan_mode_exit`。
7. `plan_mode_exit` 注入后 flag 清零。
8. 重新进入且 plan 存在时先注入 `plan_mode_reentry`。

### 19.6 权限

Plan mode 中：

| 操作 | 期望 |
|------|------|
| FileRead 任意文件 | 允许 |
| Grep/Glob | 允许 |
| FileWrite plan 文件 | 允许 |
| FileWrite 业务文件 | 拒绝 |
| FileEdit plan 文件 | 允许 |
| FileEdit 业务文件 | 拒绝 |
| Bash `ls` | 允许 |
| Bash `rm file` | 拒绝 |
| ExitPlanMode | 允许/ask |
| EnterPlanMode in agent | 拒绝 |

### 19.7 workflow prompt

检查 `plan_mode` prompt 必须包含：

1. 不允许修改文件，除了 plan 文件。
2. plan file path。
3. Phase 1 Explore。
4. Phase 2 Plan。
5. Phase 3 Review。
6. Phase 4 写 plan 文件。
7. Phase 5 调用 ExitPlanMode。
8. 禁止用文本请求 plan approval。

---

## 20. 常见错误

### 错误 1：只改 mode，不记录 prePlanMode

退出时无法恢复原权限模式。

正确：

```typescript
prepareContextForPlanMode(prev.toolPermissionContext)
```

### 错误 2：`/plan <description>` 没有 `shouldQuery: true`

用户输入任务描述后，模型不会开始规划。

### 错误 3：允许写任意文件

Plan mode 的核心是只读探索。唯一允许写的是 plan 文件。

### 错误 4：把完整 workflow 放进 EnterPlanMode tool_result

源码中 EnterPlanMode 只返回简短说明。完整 workflow 由 attachment 注入。这样 `/plan` 和 `EnterPlanMode` 两种入口能共享同一套指令。

### 错误 5：ExitPlanMode 不走用户审批

普通用户必须通过 `checkPermissions -> ask`。

### 错误 6：ExitPlanMode 不设置 exit attachment flag

退出后模型不知道自己已经可以写文件。

正确：

```typescript
setHasExitedPlanMode(true)
setNeedsPlanModeExitAttachment(true)
```

### 错误 7：plan 文件 slug 每次重新生成

同一 session 必须复用同一个 slug，否则 `/plan` 读不到之前写的 plan。

### 错误 8：subagent 复用主 plan 文件名

subagent plan 文件必须带 `-agent-{agentId}`，否则会覆盖主会话 plan。

### 错误 9：普通文本询问 plan approval

prompt 必须明确禁止：

```text
Do NOT ask about plan approval in text or AskUserQuestion.
Use ExitPlanMode.
```

### 错误 10：teammate required 没 plan 也允许退出

plan_mode_required teammate 必须先写 plan 文件，否则抛错。

---

## 21. 关键结论

要一比一实现 Plan Mode，不要把它当成一个 `/plan` 命令。它实际是一个状态机：

```text
default/auto/acceptEdits/bypassPermissions
    │
    ▼
plan
    │
    ├─ attachment 注入 workflow
    ├─ 权限层限制只读 + plan 文件写入
    ├─ model 写 plan
    └─ ExitPlanMode 审批
    │
    ▼
prePlanMode
```

最小实现先抓住四件事：

1. `prePlanMode` 保存和恢复。
2. plan 文件路径稳定。
3. plan mode 权限只允许读和写 plan 文件。
4. ExitPlanMode 是唯一 plan approval 出口。

完整实现再补：

1. attachment 节流。
2. reentry/exit 附件。
3. Explore/Plan agents。
4. auto mode 交互。
5. teammate 审批。
6. resume/fork/remote recovery。
7. 实验变体。

按本文顺序实现，GPT-4 级别模型可以把每一步当成独立小任务完成，并通过测试清单逐项验证。
