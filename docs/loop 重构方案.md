# 07 | `/loop` 命令实现与复现指南

> 基于 Claude Code v2.1.88 反编译源码的逆向分析文档。本文目标不是只解释现有代码，而是把 `/loop` 的实现拆成足够小的步骤，让能力较弱的大模型也能按步骤复现出同等功能。

## 目录

1. [一句话总结](#1-一句话总结)
2. [核心文件清单](#2-核心文件清单)
3. [整体数据流](#3-整体数据流)
4. [功能边界](#4-功能边界)
5. [第一层：注册 bundled skill](#5-第一层注册-bundled-skill)
6. [第二层：`/loop` skill prompt](#6-第二层loop-skill-prompt)
7. [第三层：CronCreate 工具](#7-第三层croncreate-工具)
8. [第四层：任务存储](#8-第四层任务存储)
9. [第五层：调度器](#9-第五层调度器)
10. [第六层：REPL 接入](#10-第六层repl-接入)
11. [从零实现步骤](#11-从零实现步骤)
12. [最小可用版本](#12-最小可用版本)
13. [完整版本增强项](#13-完整版本增强项)
14. [测试清单](#14-测试清单)
15. [常见错误](#15-常见错误)
16. [关键结论](#16-关键结论)

---

## 1. 一句话总结

`/loop` 不是一个直接执行定时逻辑的普通命令。它是一个 bundled skill：

```
用户输入 /loop 5m check deploy
    │
    ▼
processSlashCommand 识别为 prompt skill
    │
    ▼
/loop skill 返回一段“请解析参数并调用 CronCreate”的 prompt
    │
    ▼
主模型读取 prompt，调用 CronCreate 工具
    │
    ▼
CronCreate 写入 session 内存或 .claude/scheduled_tasks.json
    │
    ▼
cronScheduler 每秒检查，到点后把 prompt 重新放入队列
    │
    ▼
REPL 像处理普通用户输入一样处理这个 scheduled prompt
```

最重要的设计点：**`/loop` 本身不解析 cron，也不直接调度任务，它把解析规则写进 skill prompt，让模型调用 `CronCreate` 工具。**

---

## 2. 核心文件清单

| 文件 | 作用 |
|------|------|
| `src/skills/bundled/index.ts` | 启动时注册 bundled skills，包含 `/loop` 的 feature gate |
| `src/skills/bundled/loop.ts` | `/loop` skill 的实现，生成解析和调度用 prompt |
| `src/skills/bundledSkills.ts` | bundled skill 注册表，把 skill 转成 `Command` |
| `src/utils/processUserInput/processSlashCommand.tsx` | slash command 分发逻辑，把 `/loop` 转成模型可见 prompt |
| `src/tools/ScheduleCronTool/prompt.ts` | cron 工具的名字、说明、feature gate |
| `src/tools/ScheduleCronTool/CronCreateTool.ts` | 创建定时任务的工具 |
| `src/tools/ScheduleCronTool/CronDeleteTool.ts` | 删除定时任务的工具 |
| `src/tools/ScheduleCronTool/CronListTool.ts` | 列出定时任务的工具 |
| `src/utils/cronTasks.ts` | 任务读写、内存任务、durable 文件任务、jitter 计算 |
| `src/utils/cronScheduler.ts` | 非 React 调度器核心，每秒检查任务是否到期 |
| `src/hooks/useScheduledTasks.ts` | REPL 中挂载 scheduler，把到期任务放入命令队列 |
| `src/tools.ts` | 工具注册中心，把 CronCreate/CronDelete/CronList 加入工具集合 |

---

## 3. 整体数据流

### 3.1 用户创建 loop

```
/loop 5m /standup 1
    │
    ▼
parseSlashCommand(input)
    │
    ▼
getCommand("loop")
    │
    ▼
loop.getPromptForCommand("5m /standup 1")
    │
    ▼
生成 meta user message:
  “解析输入，转 cron，调用 CronCreate”
    │
    ▼
主模型调用:
  CronCreate({
    cron: "*/5 * * * *",
    prompt: "/standup 1",
    recurring: true
  })
    │
    ▼
addCronTask(...)
    │
    ├─ durable=false: 写入 session memory
    └─ durable=true: 写入 .claude/scheduled_tasks.json
```

### 3.2 定时任务触发

```
cronScheduler 每 1 秒 check()
    │
    ▼
计算每个任务 nextFireAt
    │
    ▼
now >= nextFireAt ?
    │
    ├─ 否：等待下一秒
    │
    └─ 是：
        │
        ▼
        onFireTask(task)
        │
        ▼
        enqueuePendingNotification({
          value: task.prompt,
          mode: "prompt",
          priority: "later",
          isMeta: true,
          workload: WORKLOAD_CRON
        })
        │
        ▼
        REPL 队列在空闲时执行该 prompt
```

---

## 4. 功能边界

`/loop` 要支持：

1. `/loop 5m check deploy`
2. `/loop check deploy`
3. `/loop check deploy every 20m`
4. `/loop 1h /standup 1`
5. 空输入时显示 usage
6. 创建后立即执行一次原 prompt
7. 后续按 cron 反复执行
8. 支持取消，提示用户用 `CronDelete`
9. recurring 任务默认 7 天后自动过期

`/loop` 不负责：

1. 直接操作文件
2. 自己实现定时器
3. 自己执行 bash 或 slash command
4. 自己决定权限
5. 自己实现 durable 存储

这些都交给 Cron 工具和 scheduler。

---

## 5. 第一层：注册 bundled skill

入口文件：`src/skills/bundled/index.ts`

关键逻辑：

```typescript
if (feature('AGENT_TRIGGERS')) {
  const { registerLoopSkill } = require('./loop.js')
  registerLoopSkill()
}
```

这说明 `/loop` 被 `AGENT_TRIGGERS` 编译期开关控制。即使注册了，最终是否可用还会由 `isKairosCronEnabled()` 决定。

复现时需要做三件事：

1. 在 bundled skill 初始化入口中引入 `registerLoopSkill`
2. 用 feature gate 包起来
3. 调用 `registerLoopSkill()`

如果没有 feature 系统，最小实现可以直接注册：

```typescript
registerLoopSkill()
```

---

## 6. 第二层：`/loop` skill prompt

核心文件：`src/skills/bundled/loop.ts`

### 6.1 默认间隔

```typescript
const DEFAULT_INTERVAL = '10m'
```

如果用户没有写时间，默认每 10 分钟执行一次。

### 6.2 空输入 usage

空输入返回说明文案，不调用 CronCreate：

```typescript
if (!trimmed) {
  return [{ type: 'text', text: USAGE_MESSAGE }]
}
```

### 6.3 非空输入 buildPrompt

`buildPrompt(args)` 返回一整段给模型的 instructions，核心要求是：

1. 解析 interval 和 prompt
2. 把 interval 转成 cron
3. 调用 `CronCreate`
4. 告知用户 job id 和过期时间
5. 立即执行一次 prompt

关键 prompt 规则：

```text
1. Leading token:
   如果第一个 token 匹配 ^\d+[smhd]$，它就是 interval。

2. Trailing "every" clause:
   如果输入以 every <N><unit> 或 every <N> <unit-word> 结尾，提取为 interval。

3. Default:
   否则 interval = 10m，整个输入都是 prompt。
```

### 6.4 interval 到 cron 的转换

| interval | cron | 说明 |
|----------|------|------|
| `5m` | `*/5 * * * *` | 每 5 分钟 |
| `30m` | `*/30 * * * *` | 每 30 分钟 |
| `1h` | `0 */1 * * *` | 每小时 |
| `2h` | `0 */2 * * *` | 每 2 小时 |
| `1d` | `0 0 */1 * *` | 每天午夜 |
| `30s` | `*/1 * * * *` | 秒级向上取整到分钟 |

注意：cron 最小粒度是分钟，所以 `Ns` 要转换成 `ceil(N/60)m`，至少 1 分钟。

### 6.5 注册 skill

`registerLoopSkill()` 调用 `registerBundledSkill()`：

```typescript
registerBundledSkill({
  name: 'loop',
  description: 'Run a prompt or slash command on a recurring interval...',
  whenToUse: 'When the user wants to set up a recurring task...',
  argumentHint: '[interval] <prompt>',
  userInvocable: true,
  isEnabled: isKairosCronEnabled,
  async getPromptForCommand(args) {
    ...
  },
})
```

这会把 `/loop` 变成一个 `type: 'prompt'` 的 command。

---

## 7. 第三层：CronCreate 工具

核心文件：`src/tools/ScheduleCronTool/CronCreateTool.ts`

### 7.1 输入 schema

`CronCreate` 接收：

```typescript
{
  cron: string,
  prompt: string,
  recurring?: boolean,
  durable?: boolean,
}
```

字段含义：

| 字段 | 默认值 | 含义 |
|------|--------|------|
| `cron` | 无 | 5-field cron 表达式 |
| `prompt` | 无 | 到点后重新送入队列的 prompt |
| `recurring` | `true` | 是否反复执行 |
| `durable` | `false` | 是否写入 `.claude/scheduled_tasks.json` |

### 7.2 validateInput

创建任务前要做四个检查：

1. `parseCronExpression(input.cron)` 必须成功
2. `nextCronRunMs(input.cron, Date.now())` 必须能在一年内找到下一次运行时间
3. 当前任务数量不能超过 `MAX_JOBS = 50`
4. teammate 场景下不能创建 durable cron

伪代码：

```typescript
if (!parseCronExpression(input.cron)) reject
if (nextCronRunMs(input.cron, Date.now()) === null) reject
if ((await listAllCronTasks()).length >= 50) reject
if (input.durable && getTeammateContext()) reject
```

### 7.3 call

真正创建任务：

```typescript
const effectiveDurable = durable && isDurableCronEnabled()
const id = await addCronTask(
  cron,
  prompt,
  recurring,
  effectiveDurable,
  getTeammateContext()?.agentId,
)
setScheduledTasksEnabled(true)
return { id, humanSchedule, recurring, durable: effectiveDurable }
```

`setScheduledTasksEnabled(true)` 很关键。scheduler 启动后会轮询这个 flag，flag 打开后才开始 load/watch/check。

---

## 8. 第四层：任务存储

核心文件：`src/utils/cronTasks.ts`

### 8.1 CronTask 数据结构

```typescript
type CronTask = {
  id: string
  cron: string
  prompt: string
  createdAt: number
  lastFiredAt?: number
  recurring?: boolean
  permanent?: boolean
  durable?: boolean
  agentId?: string
}
```

字段说明：

| 字段 | 说明 |
|------|------|
| `id` | 8 位短 id，来自 `randomUUID().slice(0, 8)` |
| `cron` | 5-field cron |
| `prompt` | 到点后执行的文本 |
| `createdAt` | 创建时间，用于计算第一次 fire 和 missed task |
| `lastFiredAt` | durable recurring 任务上次执行时间 |
| `recurring` | 是否循环 |
| `permanent` | 系统内置任务可永久不过期 |
| `durable` | runtime-only，false 表示 session-only |
| `agentId` | teammate 专用，触发时投递给对应 teammate |

### 8.2 两种存储位置

#### session-only

默认路径，不写磁盘：

```typescript
addSessionCronTask(task)
```

特点：

1. 只在当前进程有效
2. Claude 退出后丢失
3. scheduler 每秒从 bootstrap state 读取
4. 不需要文件锁

#### durable

写入：

```text
<project>/.claude/scheduled_tasks.json
```

特点：

1. 重启后还能恢复
2. 需要文件 watcher
3. 多 Claude session 共享同一个 cwd 时需要 scheduler lock
4. recurring 任务执行后要写回 `lastFiredAt`

### 8.3 addCronTask

伪代码：

```typescript
function addCronTask(cron, prompt, recurring, durable, agentId) {
  const id = randomUUID().slice(0, 8)
  const task = { id, cron, prompt, createdAt: Date.now(), recurring }

  if (!durable) {
    addSessionCronTask({ ...task, agentId })
    return id
  }

  const tasks = await readCronTasks()
  tasks.push(task)
  await writeCronTasks(tasks)
  return id
}
```

---

## 9. 第五层：调度器

核心文件：`src/utils/cronScheduler.ts`

这是非 React 的核心调度器，REPL 和 headless 模式都能复用。

### 9.1 生命周期

源码注释给出的生命周期：

```text
poll getScheduledTasksEnabled() until true
    ↓
load tasks
    ↓
watch .claude/scheduled_tasks.json
    ↓
start 1s check timer
    ↓
on fire, call onFire(prompt)
```

### 9.2 start

启动时：

1. 如果传了 `dir`，说明是 daemon/headless 路径，直接 enable
2. 如果没有传 `dir`，检查 bootstrap flag
3. 如果 `assistantMode` 或磁盘上已有任务，自动打开 flag
4. 否则每秒轮询 `getScheduledTasksEnabled()`

### 9.3 enable

`enable()` 做四件事：

1. 动态 import `chokidar`
2. 获取 scheduler lock
3. `load(true)` 读取 durable tasks
4. watch `.claude/scheduled_tasks.json`
5. `setInterval(check, 1000)`

为什么需要 lock：

```
同一个项目目录可能开两个 Claude
    │
    ├─ 如果没有 lock，两个进程都会读同一个 scheduled_tasks.json
    └─ 同一个任务会被执行两次
```

所以 durable/file-backed tasks 只有 lock owner 会触发。session-only tasks 是进程内存，其他 session 看不到，不需要 lock。

### 9.4 check

`check()` 是调度器核心。

伪代码：

```typescript
function check() {
  if (isKilled?.()) return
  if (isLoading() && !assistantMode) return

  const now = Date.now()
  const jitterCfg = getJitterConfig?.() ?? DEFAULT_CRON_JITTER_CONFIG

  if (isOwner) {
    for (const task of fileTasks) process(task, false)
  }

  if (dir === undefined) {
    for (const task of sessionTasks) process(task, true)
  }
}
```

### 9.5 process(task, isSession)

每个任务的处理逻辑：

```typescript
if (filter && !filter(task)) return
if (inFlight.has(task.id)) return

let next = nextFireAt.get(task.id)

if (next === undefined) {
  if (task.recurring) {
    next = jitteredNextCronRunMs(
      task.cron,
      task.lastFiredAt ?? task.createdAt,
      task.id,
      jitterCfg,
    )
  } else {
    next = oneShotJitteredNextCronRunMs(
      task.cron,
      task.createdAt,
      task.id,
      jitterCfg,
    )
  }
  nextFireAt.set(task.id, next)
}

if (Date.now() < next) return

fire(task)

if (task.recurring && !aged) {
  nextFireAt.set(task.id, jitteredNextCronRunMs(task.cron, now, task.id))
  if (!isSession) markCronTasksFired([task.id], now)
} else {
  remove task
}
```

### 9.6 recurring 过期

默认配置：

```typescript
recurringMaxAgeMs: 7 * 24 * 60 * 60 * 1000
```

也就是 7 天。

过期 recurring task 会再执行最后一次，然后删除。

### 9.7 jitter

jitter 的目的不是功能正确性，而是避免大量用户都在整点触发任务造成流量尖峰。

两类 jitter：

1. recurring：在下一次 cron 时间后加一点确定性延迟
2. one-shot：如果落在 `:00` 或 `:30`，可以提前一点触发

确定性来源：

```typescript
parseInt(taskId.slice(0, 8), 16) / 0x1_0000_0000
```

同一个任务 id 每次计算 jitter 都稳定。

---

## 10. 第六层：REPL 接入

核心文件：`src/hooks/useScheduledTasks.ts`

这个 hook 负责把 scheduler 接到 REPL。

### 10.1 创建 scheduler

```typescript
const scheduler = createCronScheduler({
  onFire: enqueueForLead,
  onFireTask: task => { ... },
  isLoading: () => isLoadingRef.current,
  assistantMode,
  getJitterConfig: getCronJitterConfig,
  isKilled: () => !isKairosCronEnabled(),
})
```

### 10.2 enqueueForLead

普通任务触发后，不是直接执行，而是入队：

```typescript
enqueuePendingNotification({
  value: prompt,
  mode: 'prompt',
  priority: 'later',
  isMeta: true,
  workload: WORKLOAD_CRON,
})
```

这让 scheduled task 和普通用户输入走同一套后续处理流程。

### 10.3 teammate 路由

如果 task 有 `agentId`：

1. 查找对应 teammate task
2. 如果还活着，调用 `injectUserMessageToTeammate`
3. 如果 teammate 已结束，删除这个 cron，避免无限触发

### 10.4 普通主线程任务

没有 `agentId` 时：

1. 往消息列表追加 “Running scheduled task”
2. 调用 `enqueueForLead(task.prompt)`

---

## 11. 从零实现步骤

本节假设你要在一个类似 Claude Code 的项目里复现 `/loop`。

### 步骤 1：定义 CronTask 类型

新建或扩展 `cronTasks.ts`：

```typescript
export type CronTask = {
  id: string
  cron: string
  prompt: string
  createdAt: number
  lastFiredAt?: number
  recurring?: boolean
  permanent?: boolean
  durable?: boolean
  agentId?: string
}
```

### 步骤 2：实现 durable 文件路径

```typescript
const CRON_FILE_REL = join('.claude', 'scheduled_tasks.json')

export function getCronFilePath(root: string): string {
  return join(root, CRON_FILE_REL)
}
```

### 步骤 3：实现 readCronTasks

要求：

1. 文件不存在返回 `[]`
2. JSON malformed 返回 `[]`
3. `tasks` 不是数组返回 `[]`
4. 单个 task 缺字段就跳过
5. cron 无效就跳过

不要因为一个坏 task 让整个 scheduler 崩溃。

### 步骤 4：实现 writeCronTasks

要求：

1. 自动创建 `.claude/`
2. 写入 `{ tasks: [...] }`
3. 移除 runtime-only 字段 `durable`
4. 最后加换行

### 步骤 5：实现 session task store

如果项目已有全局 state，就放进去。否则可以先做模块级变量：

```typescript
const sessionCronTasks: CronTask[] = []

export function addSessionCronTask(task: CronTask) {
  sessionCronTasks.push(task)
}

export function getSessionCronTasks() {
  return [...sessionCronTasks]
}

export function removeSessionCronTasks(ids: string[]) {
  ...
}
```

### 步骤 6：实现 addCronTask

逻辑：

1. 生成短 id
2. 组装 task
3. durable false 写 session store
4. durable true 读文件、push、写回文件
5. 返回 id

### 步骤 7：实现 cron parser

最小版本只需要支持：

1. `*/N * * * *`
2. `0 */N * * *`
3. `0 0 */N * *`

完整版本要支持标准 5-field cron：

```text
minute hour day-of-month month day-of-week
```

必须实现：

```typescript
parseCronExpression(cron): ParsedCron | null
computeNextCronRun(parsed, fromDate): Date | null
nextCronRunMs(cron, fromMs): number | null
```

### 步骤 8：实现 CronCreateTool

工具输入：

```typescript
{
  cron: string
  prompt: string
  recurring?: boolean
  durable?: boolean
}
```

`validateInput`：

1. cron 格式有效
2. 能找到下一次 fire 时间
3. job 数量小于 50

`call`：

1. 调 `addCronTask`
2. 设置 scheduler enabled flag
3. 返回 id 和 human schedule

### 步骤 9：实现 CronDeleteTool

输入：

```typescript
{ id: string }
```

行为：

1. 从 session store 删除
2. 从 durable 文件删除
3. 返回是否删除成功

### 步骤 10：实现 CronListTool

行为：

1. 读取 durable tasks
2. 合并 session tasks
3. 返回 id、cron、prompt、recurring、durable、next fire time

### 步骤 11：实现 createCronScheduler

输入 options：

```typescript
type CronSchedulerOptions = {
  onFire: (prompt: string) => void
  onFireTask?: (task: CronTask) => void
  isLoading: () => boolean
  assistantMode?: boolean
  dir?: string
  isKilled?: () => boolean
}
```

返回：

```typescript
{
  start(): void
  stop(): void
  getNextFireTime(): number | null
}
```

### 步骤 12：scheduler.start

实现：

1. 如果当前没有 enabled，轮询等待
2. enabled 后读取 durable tasks
3. watch 文件变化
4. setInterval 每秒调用 check

最小版本可以不做文件 watch，只每秒同时读取 session 和文件。

### 步骤 13：scheduler.check

实现：

1. killed 则 return
2. loading 且非 assistantMode 则 return
3. 遍历 file tasks
4. 遍历 session tasks
5. 到点则 fire
6. recurring 重新计算下一次
7. one-shot 删除

### 步骤 14：实现 `/loop` skill

创建 `loop.ts`：

```typescript
const DEFAULT_INTERVAL = '10m'

function buildPrompt(args: string): string {
  return `
Parse the input into [interval] <prompt>.
Call CronCreate with cron, prompt, recurring: true.
Then execute the prompt immediately.
Input:
${args}
`
}

export function registerLoopSkill() {
  registerBundledSkill({
    name: 'loop',
    description: 'Run a prompt or slash command on a recurring interval',
    argumentHint: '[interval] <prompt>',
    userInvocable: true,
    getPromptForCommand(args) {
      const trimmed = args.trim()
      if (!trimmed) return [{ type: 'text', text: USAGE_MESSAGE }]
      return [{ type: 'text', text: buildPrompt(trimmed) }]
    },
  })
}
```

### 步骤 15：注册 `/loop`

在 bundled skills 初始化入口：

```typescript
registerLoopSkill()
```

### 步骤 16：注册 Cron tools

在工具注册中心加入：

```typescript
CronCreateTool
CronDeleteTool
CronListTool
```

否则模型看到 `/loop` prompt 后无法调用 `CronCreate`。

### 步骤 17：接入 REPL

在 REPL 顶层 hook 或启动逻辑中：

```typescript
const scheduler = createCronScheduler({
  onFire: prompt => enqueuePendingNotification({
    value: prompt,
    mode: 'prompt',
    priority: 'later',
    isMeta: true,
  }),
  isLoading: () => currentIsLoading,
})

scheduler.start()
```

卸载时：

```typescript
scheduler.stop()
```

---

## 12. 最小可用版本

如果只想先做出能跑的 `/loop`，可以砍掉这些复杂性：

1. 不支持 durable，只做 session-only
2. 不支持 teammate
3. 不支持 missed task
4. 不支持 file watcher
5. 不支持 scheduler lock
6. 不支持 jitter
7. 不支持 GrowthBook feature gate
8. 不支持 one-shot

最小数据流：

```
/loop 5m foo
    │
    ▼
模型调用 CronCreate({ cron: "*/5 * * * *", prompt: "foo", recurring: true })
    │
    ▼
addSessionCronTask
    │
    ▼
setInterval 每秒检查
    │
    ▼
到点 enqueue prompt
```

最小版本必须保留：

1. `/loop` skill
2. `CronCreate`
3. session task store
4. scheduler
5. REPL enqueue

---

## 13. 完整版本增强项

最小版本跑通后，再按顺序加：

### 13.1 CronDelete

用户必须能取消 recurring 任务，否则 loop 会一直跑。

### 13.2 CronList

便于用户查看当前有哪些任务，也便于测试。

### 13.3 durable

加入 `.claude/scheduled_tasks.json`，让任务重启后恢复。

### 13.4 scheduler lock

有 durable 后必须加 lock，否则同目录多个进程会重复触发。

### 13.5 file watcher

监听 `.claude/scheduled_tasks.json` 变化，支持其他进程增删任务。

### 13.6 missed one-shot

Claude 关闭期间错过的一次性任务，启动后不要直接执行，应先问用户是否补跑。

### 13.7 jitter

防止整点和半点流量尖峰。

### 13.8 recurring 自动过期

默认 7 天，防止长期无人管理的 loop 无限运行。

---

## 14. 测试清单

### 14.1 `/loop` prompt 生成

输入：

```text
/loop
```

期望：

1. 返回 usage
2. 不调用 `CronCreate`

输入：

```text
/loop 5m check deploy
```

期望模型调用：

```json
{
  "cron": "*/5 * * * *",
  "prompt": "check deploy",
  "recurring": true
}
```

输入：

```text
/loop check deploy every 20m
```

期望模型调用：

```json
{
  "cron": "*/20 * * * *",
  "prompt": "check deploy",
  "recurring": true
}
```

输入：

```text
/loop check every PR
```

期望：

```json
{
  "cron": "*/10 * * * *",
  "prompt": "check every PR",
  "recurring": true
}
```

### 14.2 CronCreate validation

| 输入 | 期望 |
|------|------|
| `*/5 * * * *` | 通过 |
| `bad cron` | 拒绝 |
| 无未来运行时间 | 拒绝 |
| 已有 50 个任务 | 拒绝 |

### 14.3 session-only 创建

调用：

```typescript
addCronTask('*/5 * * * *', 'hello', true, false)
```

期望：

1. 返回 8 位 id
2. session store 增加 1 个任务
3. `.claude/scheduled_tasks.json` 不变

### 14.4 durable 创建

调用：

```typescript
addCronTask('*/5 * * * *', 'hello', true, true)
```

期望：

1. `.claude/scheduled_tasks.json` 被创建
2. JSON 里有该任务
3. `durable` 字段不写入磁盘

### 14.5 scheduler fire

创建一个下一分钟触发的任务。

期望：

1. 到点前不 enqueue
2. 到点后 enqueue 一次
3. recurring 任务更新下一次 fire time
4. one-shot 任务触发后删除

### 14.6 isLoading gate

设置：

```typescript
isLoading: () => true
assistantMode: false
```

期望：

1. 到点不触发
2. `isLoading` 变 false 后触发

设置：

```typescript
isLoading: () => true
assistantMode: true
```

期望：

1. 到点仍然可以 enqueue

### 14.7 CronDelete

创建任务后删除。

期望：

1. session store 中删除
2. durable 文件中删除
3. scheduler 不再触发

### 14.8 多进程 lock

启动两个 scheduler，指向同一个 `.claude/scheduled_tasks.json`。

期望：

1. 只有 lock owner 触发 durable task
2. 非 owner 不触发 file-backed task
3. owner 停止后，另一个 scheduler 能接管

---

## 15. 常见错误

### 错误 1：把 `/loop` 写成 local command

不要把 `/loop` 写成直接创建任务的 local command。现有设计是 prompt skill，让模型负责解析自然语言并调用 `CronCreate`。

如果写成 local command，会失去：

1. 自然语言解析能力
2. slash command prompt 透传能力
3. 模型立即执行一次 prompt 的能力

### 错误 2：忘记注册 CronCreate 工具

`/loop` prompt 会要求模型调用 `CronCreate`。如果工具没注册，模型只能输出文字，不能真正创建任务。

### 错误 3：创建任务后没打开 scheduler enabled flag

`CronCreate.call()` 必须调用：

```typescript
setScheduledTasksEnabled(true)
```

否则 scheduler 可能一直在等待，不会开始检查任务。

### 错误 4：durable 任务没有 lock

多个 Claude session 共享同一个项目目录时，如果没有 lock，同一个 durable task 会被触发多次。

### 错误 5：recurring 任务从旧时间补跑

recurring 触发后下一次应该从 `now` 重新计算，而不是从上一次理论 fire time 继续追赶。否则应用卡顿或休眠后可能连续快速执行多次。

正确逻辑：

```typescript
newNext = jitteredNextCronRunMs(task.cron, now, task.id)
```

### 错误 6：把 session-only 任务写进文件

默认 `durable=false`。用户没有明确要求跨 session 保留时，不要写 `.claude/scheduled_tasks.json`。

### 错误 7：空 `/loop` 也创建任务

空输入必须显示 usage，并停止。

### 错误 8：没有立即执行一次

现有 `/loop` prompt 明确要求创建后立刻执行 parsed prompt。不要等第一次 cron fire。

---

## 16. 关键结论

`/loop` 的实现可以拆成一句话：

> `/loop` 是一个 prompt skill，它把“自然语言定时请求”翻译成对 `CronCreate` 工具的调用；真正的任务存储、调度、触发和取消都由 Cron 工具链负责。

如果要复现，按这个顺序实现最稳：

1. `CronTask` 类型
2. session-only task store
3. `CronCreate`
4. 简单 scheduler
5. REPL enqueue
6. `/loop` bundled skill
7. `CronDelete`
8. `CronList`
9. durable 文件存储
10. scheduler lock
11. file watcher
12. jitter 和 auto-expiry

这样即使模型能力较弱，也可以每一步只完成一个小模块，并用测试清单逐项验证。
