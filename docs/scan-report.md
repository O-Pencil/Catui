# catui vs Claude Code — 代码扫描报告

> 自动扫描：每 30 分钟对照 CC 源码逐模块检查，记录缺陷与改进建议。

---

## 2026-06-12 — Task 系统全面扫描

扫描范围：`extensions/builtin/task/` 全部文件 + `modes/interactive/components/task-status-panel.ts`

### 1. task-store.ts — 并发与数据完整性

| 严重度 | 发现 |
|--------|------|
| **CRITICAL** | **无文件锁。** CC 使用 `proper-lockfile`（30 次重试退避）序列化跨进程并发写入。catui 无任何锁机制。两个并发 `createTask` 可能读到相同的 `findHighestTaskId`，产生重复 ID，后写覆盖前写。 |
| **WARNING** | **无 `updateTaskUnsafe` 变体。** CC 区分 locked/unlocked 更新路径以避免级联操作死锁（如 `deleteTask` 持有列表锁时调用 `updateTask`）。catui 的 `deleteTask` 调用 `updateTask` 会重新从磁盘读取——竞争条件下可能丢失中间写入。 |
| **INFO** | **`writeHighWaterMark` 非原子。** CC 同样用普通 `writeFile`，行为一致。但 HWM 写入和 `deleteTask` 中的 `unlink` 不在同一个临界区，崩溃时可能出现 HWM 已更新但文件未删除。 |
| **INFO** | **`listTasks` 是 O(N) readFile。** 两者都 readdir + N×readFile，无分页或缓存。持平。 |

### 2. TaskCreateTool

| 严重度 | 发现 |
|--------|------|
| **CRITICAL** | **缺少 `executeTaskCreatedHooks`。** CC 在创建后运行生命周期钩子，如果任何阻塞钩子失败则回滚（删除任务）。catui 无钩子系统。 |
| **WARNING** | **无 auto-expand UI 信号。** CC 创建任务时调用 `context.setAppState({ expandedView: 'tasks' })` 自动展开面板。catui 不会自动打开面板。 |
| **INFO** | 无 `isConcurrencySafe` / `shouldDefer` / `isReadOnly` 注解。CC 特有的工具元数据，取决于 agent 框架是否需要。 |

### 3. TaskUpdateTool

| 严重度 | 发现 |
|--------|------|
| **CRITICAL** | **缺少 `executeTaskCompletedHooks`。** CC 运行完成钩子并在钩子失败时阻止状态变更。catui 无条件应用更新。 |
| **WARNING** | **缺少 teammate 自动 owner 分配。** CC 在 swarm 模式下移动到 `in_progress` 时自动设置 `owner = getAgentName()`。 |
| **WARNING** | **缺少 teammate 邮箱通知。** CC 在 owner 变更时调用 `writeToMailbox`。 |
| **WARNING** | **验证提示仅文本。** CC 返回结构化 `verificationNudgeNeeded: boolean`，catui 嵌入为文本字符串。 |

### 4. TaskListTool

| 严重度 | 发现 |
|--------|------|
| **INFO** | 功能等价。过滤 `_internal` 元数据，解析已完成的阻塞者，输出格式一致。 |

### 5. TaskGetTool

| 严重度 | 发现 |
|--------|------|
| **INFO** | 功能等价。CC 有 Zod schema 验证和旧状态迁移（`open` → `pending`），catui 做基础属性检查。遗留数据可能返回 `null`。 |

### 6. TaskStopTool / TaskOutputTool

| 严重度 | 发现 |
|--------|------|
| **INFO** | catui 特有工具，CC 无直接等价物。实现正确。 |

### 7. task-status-panel.ts — TUI 组件

| 严重度 | 发现 |
|--------|------|
| **WARNING** | **无 `RECENT_COMPLETED_TTL_MS`（30s）逻辑。** CC 的 `TaskListV2` 追踪任务完成时间，30s 内保持视觉突出。catui 对所有已完成任务一视同仁。 |
| **WARNING** | **无 teammate 颜色/活动显示。** CC 显示每个 teammate 的颜色和实时活动描述。 |
| **INFO** | **已有 5s auto-hide。** catui 已实现全部完成后 5 秒自动清理，与 CC 一致。 |

### 8. useTasksV2 / TasksV2Store（catui 缺失）

| 严重度 | 发现 |
|--------|------|
| **CRITICAL** | **无响应式数据层。** CC 的 `TasksV2Store` 单例使用 `fs.watch` + `onTasksUpdated` 信号 + 5s 轮询兜底 + 防抖驱动 UI。catui 仅有进程内信号，无文件监听、无轮询。外部进程（子 agent）修改 task 文件时面板不会更新。 |

---

### 汇总

| 严重度 | 数量 |
|--------|------|
| CRITICAL | 4（无文件锁、缺创建钩子、缺完成钩子、无响应式数据层） |
| WARNING | 6（无 updateTaskUnsafe、无 auto-expand、无 teammate 特性×2、无 recency 追踪、无 auto-hide） |
| INFO | 6 |

**优先修复项：**
1. 添加文件级锁（proper-lockfile 或类似方案）到 `createTask` 和 `updateTask`
2. 实现 task 创建/完成事件的钩子执行管线
3. 添加 `fs.watch` + 轮询兜底以支持跨进程变更通知
4. 移植 CC 的 30s recency 追踪逻辑

---

## 2026-06-12 — ToolExecutionComponent 渲染系统扫描

扫描范围：`modes/interactive/components/tool-execution.ts` + `diff.ts` + `visual-truncate.ts`

### 架构对比

CC 使用 React 组件树 + 每个 Tool 独立的 `UI.tsx` 模块，渲染分为 `renderToolUseMessage` / `renderToolResultMessage` / `renderToolUseErrorMessage`。catui 使用单体 `ToolExecutionComponent`（886 行）通过大 switch 处理所有内置工具，自定义工具走 `renderCall/renderResult`。设计合理但结构不同。

### 1. Read 工具

| 严重度 | 发现 |
|--------|------|
| **INFO** | 功能等价。两者都显示路径+行范围，折叠截断 10 行，有语法高亮。CC 用 `FilePathLink`（可点击），catui 用下划线样式。 |

### 2. Write 工具

| 严重度 | 发现 |
|--------|------|
| **HIGH** | **缺少 write-over-existing-file 的 diff 渲染。** CC 区分 create vs update，对覆盖已有文件显示结构化 diff（`FileEditToolUpdatedMessage`）。catui 始终显示内容预览，覆盖场景下用户看不到改了什么。 |
| **INFO** | 两者都显示前 10 行 + 语法高亮 + 行数统计。 |

### 3. Edit 工具

| 严重度 | 发现 |
|--------|------|
| **MEDIUM** | **diff 无语法高亮和行号。** CC 使用 Rust NAPI `ColorDiff` 模块生成带语法高亮的结构化 diff + gutter 行号。catui 的 `renderDiff` 是纯着色文本 + word-level diff，无语法高亮、无行号。 |
| **MEDIUM** | **不支持 `replace_all` 和 `edits[]`（hashline edits）。** CC 的 edit 工具支持批量编辑，catui 仅支持单次 oldText/newText 替换。 |
| **INFO** | `computeEditDiff` 异步预览 + `setArgsComplete` 触发时机正确。edit 的 args 完整性检测逻辑合理。 |

### 4. Bash 工具

| 严重度 | 发现 |
|--------|------|
| **LOW** | **无 `sed -i` 命令检测。** CC 检测 sed 原地编辑命令并渲染为文件编辑 diff。catui 统一按 bash 输出处理。 |
| **LOW** | **无后台任务支持（ctrl+b）。** CC 支持 bash 后台执行，catui 无此功能。 |
| **INFO** | `truncateToVisualLines` 实现正确，5 行预览 + 展开/折叠逻辑与 CC 等价。超时显示、截断警告都已覆盖。 |

### 5. Grep/Glob/Find/ls

| 严重度 | 发现 |
|--------|------|
| **MEDIUM** | **Grep 输出无模式区分。** CC 支持三种输出模式（`content`/`files_with_matches`/`count`）各有专属渲染。catui 统一按原始文本处理。 |
| **INFO** | 截断逻辑（15-20 行）与 CC 一致。entry/result limit 警告已覆盖。 |

### 6. Diff 渲染（diff.ts）

| 严重度 | 发现 |
|--------|------|
| **MEDIUM** | **无 diff 内语法高亮。** CC 的 `StructuredDiff.tsx` 在 diff hunk 内做语法高亮 + gutter 行号 + `WeakMap` 渲染缓存。catui 154 行的 `diff.ts` 做行级 + word-level diff，纯着色文本。 |
| **INFO** | word-level diff（`diffWords`）实现正确，inverse 样式标记变更 token。 |

### 7. 图片处理

| 严重度 | 发现 |
|--------|------|
| **INFO** | Kitty 协议转换（非 PNG → PNG）+ `imageFallback` 降级逻辑完整，与 CC 等价。 |

### 8. 流式部分更新

| 严重度 | 发现 |
|--------|------|
| **INFO** | `WriteHighlightCache` 增量语法高亮缓存设计高效。前 50 行全量刷新 + 后续行单行高亮，平衡了性能和正确性。 |

---

### 汇总

| 严重度 | 数量 |
|--------|------|
| HIGH | 1（write 覆盖文件无 diff） |
| MEDIUM | 3（diff 无语法高亮、不支持 replace_all/edits[]、grep 无模式区分） |
| LOW | 2（sed -i 检测、后台任务） |
| INFO | 6 |

**优先修复项：**
1. Write 覆盖已有文件时显示 diff 而非内容预览
2. Diff 渲染增加语法高亮和行号
3. Edit 工具支持 `replace_all` 和 `edits[]` 批量编辑

---

## 2026-06-12 — Slash Command 系统扫描

扫描范围：`core/slash-commands.ts` + `slash-command-catalog.ts` + `modes/interactive/controllers/slash-dispatcher-controller.ts` + `modes/interactive/slash-command-arguments.ts`

### 1. 命令注册与发现

| 严重度 | 发现 |
|--------|------|
| **MEDIUM** | **无 `aliases` 支持。** CC 支持命令别名快捷方式，catui 无此功能。 |
| **MEDIUM** | **无 `isEnabled`/`availability`/`isHidden` 字段。** CC 支持功能开关、权限过滤、隐藏命令。catui 的内置命令类型缺少这些元数据。 |
| **INFO** | `buildSessionSlashCommands()` 合并内置、扩展、prompt 模板、skills 的逻辑正确。扩展命令名与内置命令冲突检测已覆盖。 |

### 2. 命令解析

| 严重度 | 发现 |
|--------|------|
| **MEDIUM** | **无集中式解析器。** CC 有专用 `parseSlashCommand()` 产出 `{ commandName, args, isMcp }`。catui 在 dispatcher 中内联 `text.indexOf(" ")` + 各 handler 手动 `text.slice(N).trim()` 硬编码偏移量，脆弱且重复。 |
| **LOW** | **不支持 MCP 命令语法。** CC 支持 `/tool (MCP) args` 格式，catui 无此解析。 |

### 3. 命令执行与错误处理

| 严重度 | 发现 |
|--------|------|
| **HIGH** | **Dispatcher 无 try/catch。** `SlashDispatcherController.execute()` 第 84-106 行无任何错误边界。async handler（如 `/model`、`/mcp`）失败时产生未处理的 promise rejection，可能导致会话崩溃。 |
| **INFO** | CC 有完整的执行管线：abort controller、进度消息、遥测事件、`MalformedCommandError`/`AbortError` 类型异常。catui 均缺失但非阻塞。 |

### 4. 自动补全

| 严重度 | 发现 |
|--------|------|
| **LOW** | **无模糊匹配。** CC 使用 Fuse.js 加权多键匹配（name/parts/aliases/description）。catui 仅 `startsWith` 前缀匹配。 |
| **LOW** | **无使用频率排序。** CC 根据历史使用频率提升排序。 |
| **INFO** | 7 个内置命令的参数补全（model/thinking/mcp/language/persona 等）实现正确。 |

### 5. 帮助文本生成

| 严重度 | 发现 |
|--------|------|
| **MEDIUM** | **无 `/help` 命令。** 用户无法通过 slash 命令查看帮助。CC 有专用 `help` 命令渲染完整命令参考。 |
| **INFO** | `getLocalizedCommands()` 提供 i18n 支持 + 8 个分类标签，`formatSlashCommandDescription()` 渲染正确。 |

### 6. 缺失命令 vs CC

CC 有 ~90+ 命令，catui 有 35 个。显著缺失：`help`、`clear`、`config`、`cost`、`diff`、`doctor`、`review`、`commit`、`init`、`permissions`、`hooks`、`effort`、`resume`（会话选择器）、`vim`、`theme`、`color`、`files`、`branch`、`plan`、`skills`、`plugin`、`tasks`、`stats` 等。

---

### 汇总

| 严重度 | 数量 |
|--------|------|
| HIGH | 1（dispatcher 无 try/catch） |
| MEDIUM | 4（无 aliases、无 isEnabled/availability、无集中式解析器、无 /help） |
| LOW | 3（无 MCP 语法、无模糊匹配、无使用频率排序） |
| INFO | 3 |

**优先修复项：**
1. Dispatcher 添加 try/catch 错误边界，防止 async handler 崩溃会话
2. 实现集中式 `parseSlashCommand()` 解析器
3. 添加 `/help` 命令

---

## 2026-06-12 — Persona 系统扫描

扫描范围：`core/persona/persona-manager.ts` + `core/platform/config/resource-loader.ts` + `modes/interactive/interactive-mode.ts`（persona 切换逻辑）+ `extensions/builtin/presence/`

> 注：CC 无 persona/身份管理系统，此系统为 catui 原创扩展。以下对比侧重实现质量和缺陷检查。

### 1. PersonaManager CRUD

| 严重度 | 发现 |
|--------|------|
| **INFO** | **`"general"` 死代码。** `normalizePersonaId` 第 23 行 `if (!trimmed) return "general"` 永远不会执行，因为 `getActivePersonaId` 在无状态时返回 `"vex"`。注释说 "returning to general" 但实际行为是返回 "vex"。 |
| **INFO** | **`listPersonas` 重复 normalize。** 已经 normalize 的目录名会被再次 normalize，如果目录名含被剥离字符（如 `.`）可能导致误判。防御性但可能困惑用户。 |
| **INFO** | `writeFileSync` 用于所有写入，单线程 REPL 循环下无并发风险，但无原子写入（tmp+rename）。 |

### 2. Resource Loader 完整性保护

| 严重度 | 发现 |
|--------|------|
| **MEDIUM** | **默认 persona `vex` 绕过完整性保护。** 条件 `if (activePersonaId && pencilPathToLoad === personaPencilPath)` — 当 `activePersonaId` 是 `"vex"` 且用户创建了 `vex/` 目录时，persona PENCIL.md 会被加载但**不附加完整性保护块**，因为 `"vex"` 是 truthy 值通过了检查。应额外排除默认 persona ID。 |
| **INFO** | `seenPaths` 去重防止重复包含。persona PENCIL.md 优先级高于全局 `.PENCIL.md` 的逻辑正确。 |

### 3. Persona 切换

| 严重度 | 发现 |
|--------|------|
| **MEDIUM** | **无 env var 清理机制。** `CATUI_JUST_SWITCHED_PERSONA` 标志设置后无过期/清理。会话崩溃时该标志在 `process.env` 中永久残留。 |
| **INFO** | `switchPersona` fork 会话 + 设置 4 个 env var + reload 的流程设计扎实。`applyPersonaFromSessionIfAny` 在会话恢复时正确重新应用 persona。 |

### 4. Presence / 问候扩展

| 严重度 | 发现 |
|--------|------|
| **INFO** | **无缺陷。** 从 PENCIL.md `## Presence` 读取 persona 特定的开场/空闲问候行，回退到 i18n 默认值。错误处理一致 try/catch + 静默降级。定时器在会话关闭时正确清理。30s 防抖防止刷屏。 |

---

### 汇总

| 严重度 | 数量 |
|--------|------|
| MEDIUM | 2（默认 persona 绕过完整性保护、env var 无清理） |
| INFO | 5（死代码、重复 normalize、非原子写入、切换流程扎实、presence 无缺陷） |

**优先修复项：**
1. `resource-loader.ts` 完整性保护条件排除默认 persona ID（`vex`）
2. `CATUI_JUST_SWITCHED_PERSONA` 标志添加消费后清理

---

## 2026-06-12 — Extensions Host 系统扫描

扫描范围：`core/extensions-host/` 全部文件（loader.ts、runner.ts、types.ts）

### 1. 扩展加载与发现

| 严重度 | 发现 |
|--------|------|
| **INFO** | 4 层发现机制（项目级、全局、显式配置路径、npm opt-in）设计合理。`jiti` 加载 TS/JS 扩展，`Promise.all` 并行加载，错误收集不中断。 |
| **INFO** | CC 有完整的 marketplace 生态（注册表、依赖解析、版本控制、黑名单、自动更新）。catui 缺失这些但非阻塞——当前规模不需要 marketplace。 |

### 2. 工具注册与冲突解决

| 严重度 | 发现 |
|--------|------|
| **MEDIUM** | **工具名冲突静默丢弃。** `getAllRegisteredTools()` 使用先注册先得策略，第二个同名工具被静默跳过，无诊断警告。命令/快捷键冲突有警告，工具冲突没有。`runner.ts` 第 388-394 行。 |
| **INFO** | CC 不向插件暴露工具注册 API，避免了此问题。catui 的工具注册是更丰富的 API 表面的一部分。 |

### 3. Hook 执行管线

| 严重度 | 发现 |
|--------|------|
| **HIGH** | **`emitToolCall` 缺少 try/catch。** `runner.ts` 第 922 行的 `emitToolCall` 未包裹错误处理，handler 抛异常会向上冒泡未处理。其他 emit 方法（`emitToolResult`、`emitContext`）都有 catch。**不一致且有崩溃风险。** |
| **MEDIUM** | **缺失 ~8 个生命周期事件。** CC 有 `SubagentStart`、`SubagentStop`、`TaskCreated`、`TaskCompleted`、`FileChanged`、`CwdChanged`、`WorktreeCreate`、`WorktreeRemove` 等，catui 均缺失。 |
| **INFO** | 其他 hook 路径的错误隔离良好：每个 handler 独立 try/catch，错误路由到 `emitError()` 不中断管线。`before_agent_start` 有 1500ms 超时 + 限频警告。 |

### 4. MCP 服务器集成

| 严重度 | 发现 |
|--------|------|
| **INFO** | catui 将 MCP 委托给内置扩展（`builtin/mcp`），扩展宿主无直接 MCP 感知。分离干净但意味着无 MCP 特定的错误处理或生命周期管理。CC 将 MCP 深度集成到插件生命周期中。 |

### 5. 扩展 API 表面

| 严重度 | 发现 |
|--------|------|
| **INFO** | catui 的 API 显著比 CC 更丰富：事件订阅、工具/命令/快捷键/标志注册、UI 上下文（对话框、组件、编辑器）、会话管理、模型控制、Provider 注册、一次性 LLM 补全、OAuth。CC 通过声明式 manifest 补偿。 |

### 6. 扩展崩溃错误处理

| 严重度 | 发现 |
|--------|------|
| **MEDIUM** | **`loadExtensionFromFactory` 无错误处理。** `loader.ts` 第 331 行，factory 抛异常直接传播，而 `loadExtension`（第 302 行）有 catch。不一致。 |
| **INFO** | 其他路径错误隔离良好：加载时 try/catch 收集错误、hook handler 独立 catch、`wrapToolWithExtensions` 捕获 tool_call/tool_result 钩子错误。无沙箱/进程隔离。 |

### 7. 其他缺失

| 严重度 | 发现 |
|--------|------|
| **LOW** | **无热重载机制。** CC 有 `clearPluginHookCache()` + `setupPluginHookHotReload()`。catui 需手动触发 reload。 |
| **LOW** | **无循环依赖检测。** CC 有 `dependencyResolver.ts` 处理依赖图。 |

---

### 汇总

| 严重度 | 数量 |
|--------|------|
| HIGH | 1（`emitToolCall` 缺 try/catch） |
| MEDIUM | 3（工具名冲突静默、缺失生命周期事件、factory 加载无 catch） |
| LOW | 2（无热重载、无循环依赖检测） |
| INFO | 5 |

**优先修复项：**
1. `emitToolCall` 添加 try/catch 错误隔离（与其他 emit 方法一致）
2. 工具名冲突添加警告日志
3. `loadExtensionFromFactory` 添加 try/catch

---

## 2026-06-12 — Interactive Mode Controller 扫描

扫描范围：`modes/interactive/interactive-mode.ts` + `modes/interactive/controllers/` 全部控制器

### 1. 并发保护

| 严重度 | 发现 |
|--------|------|
| **HIGH** | **无 QueryGuard 等价机制。** CC 使用 3 状态 `QueryGuard`（`idle`→`dispatching`→`running`）+ 代计数器防止双重提交。catui 的主循环是简单的 `while(true)` + `await session.prompt()`，`onSubmit` 回调与主循环之间存在竞态窗口。`isStreaming()` 检查部分缓解但不完全——在 idle 检查和 `await handleIdleSubmit` 之间仍有事件交错的可能。 |

### 2. Compaction 期间消息队列

| 严重度 | 发现 |
|--------|------|
| **MEDIUM** | **无优先级队列。** CC 使用统一优先级队列（`now`/`next`/`later`），确保系统通知不饿死用户输入。catui 的 `compactionQueuedMessages` 是纯 FIFO 数组，无优先级区分。 |
| **LOW** | **无可恢复的编辑器缓冲。** CC 的 `popAllEditable` 允许通过快捷键将排队消息恢复到编辑器。catui 缺失此功能。 |

### 3. 中止/中断处理

| 严重度 | 发现 |
|--------|------|
| **MEDIUM** | **Ctrl+C 静默丢弃输入。** `InterruptController.handleCtrlC` 单击时清空编辑器，用户已输入的文本被丢弃且无法撤销。CC 保留输入缓冲区。 |
| **LOW** | **无后台 agent kill 支持。** CC 有 `chat:killAgents` 双击确认停止后台子 agent。catui 缺失。 |
| **INFO** | 中断优先级排序（loader abort > streaming abort > bash abort > bash-mode exit > double-tap tree/fork）设计合理。Ctrl+Z 挂起已实现。 |

### 4. 错误恢复

| 严重度 | 发现 |
|--------|------|
| **MEDIUM** | **无 auto-compaction 熔断器。** CC 有 `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3`，连续失败后停止重试。catui 无此限制，反复 compaction 失败会无限浪费 API 调用。 |
| **MEDIUM** | **无瞬态错误重试。** 429 限流、网络超时等错误直接展示给用户，无自动重试逻辑。CC 有 auto-retry with exponential backoff。 |
| **INFO** | `handleIdleSubmit` 捕获 `promptAfterRender` 错误并回滚 optimistic message，`flushCompactionQueue` 在错误时恢复排队消息。基本错误恢复已覆盖。 |

### 5. 优雅关闭

| 严重度 | 发现 |
|--------|------|
| **MEDIUM** | **无 failsafe 定时器。** `shutdown()` 向扩展发送 `session_shutdown`（5s 超时），但如果扩展 handler 永久阻塞，进程会挂起。CC 有 failsafe timer + SIGKILL 兜底。 |
| **LOW** | **无终端模式清理。** CC 退出时清理 alt-screen、Kitty keyboard、focus reporting、bracketed paste。catui 仅 drain 输入 1s + `process.exit(0)`，异常退出时终端状态可能泄漏。 |

### 6. Optimistic UI

| 严重度 | 发现 |
|--------|------|
| **LOW** | **仅回滚首个 optimistic message。** 多次快速提交时如果第二个失败，只回滚第一个。CC 的 React 状态协调处理更干净。 |
| **INFO** | `StreamRenderController.message_start` 正确检测并去重 optimistic messages。回滚逻辑 `rollbackFirstOptimisticUserMessageIfMatches` 实现正确。 |

### 7. 会话生命周期

| 严重度 | 发现 |
|--------|------|
| **LOW** | **无会话后台/前台切换支持。** CC 有 `useSessionBackgrounding` 处理前后台转换。catui 缺失。 |
| **INFO** | `SessionManager` 持久化会话状态，`session_shutdown` 事件正确传播到扩展。主循环结构合理。 |

---

### 汇总

| 严重度 | 数量 |
|--------|------|
| HIGH | 1（无 QueryGuard 并发保护） |
| MEDIUM | 5（无优先级队列、Ctrl+C 丢弃输入、无 compaction 熔断器、无瞬态重试、无 failsafe 定时器） |
| LOW | 4（无可恢复缓冲、无 agent kill、无终端清理、optimistic 回滚不完整） |
| INFO | 3 |

**优先修复项：**
1. 实现 QueryGuard 或等价的提交互斥机制，防止双重提交竞态
2. Auto-compaction 添加熔断器（连续失败 N 次后停止）
3. Ctrl+C 单击时保留编辑器输入缓冲区

---

## 2026-06-12 — Stream Render Controller 扫描

扫描范围：`modes/interactive/controllers/stream-render-controller.ts` + `streaming-preview.ts` + `task-status-panel.ts`

### 1. 事件处理完整性

| 严重度 | 发现 |
|--------|------|
| **INFO** | 所有核心生命周期事件已覆盖：`agent_start`、`message_start/update/end`、`tool_execution_start/update/end`、`agent_end`、`auto_compaction_start/end`、`auto_retry_start/end`、`sub_agent_*`。 |
| **INFO** | CC 有 `StreamingToolExecutor` 并行处理单条消息中的多个 tool call。catui 通过 `has()` 守卫顺序处理，行为一致。 |
| **LOW** | **无 `tool_execution_cancel` 事件处理。** CC 可取消执行中的工具。catui 仅通过 abort 路径（`agent_end` + `stopReason === "aborted"`）处理。 |

### 2. 内存泄漏与清理

| 严重度 | 发现 |
|--------|------|
| **MEDIUM** | **`taskUpdateUnsubscribe` 未在 `agent_end` 清理。** `onTasksUpdated` 订阅在 `agent_start` 创建但 `agent_end` 不取消。闭包（捕获 `state`、`ui`、`statusContainer`）跨 turn 存活。`agent_start` 的 `?.()` 取消前一个订阅可缓解顺序场景，但 crash/force-quit 时泄漏。 |
| **INFO** | `agent_end` 清理全面：停止 loader、移除 streamingComponent、清空 pendingTools、移除 sub-agent/plan/task/streaming-preview 面板、clearAttachments。 |

### 3. Auto-Compaction/Retry 覆盖层

| 严重度 | 发现 |
|--------|------|
| **MEDIUM** | **`auto_compaction_start` 清空整个 `statusContainer`。** 这会同时销毁 loader、streaming preview 和 task panel。CC 的 React 声明式渲染是替换而非销毁。catui 的命令式模型中 task panel 在 compaction 期间丢失，直到下次 `onTasksUpdated` 回调才重建。 |
| **INFO** | Escape handler 交换逻辑正确：保存当前 handler → 安装 abort handler → 恢复。`agent_start` 处理 retry handler 残留的边界情况也已覆盖。 |

### 4. Sub-Agent 面板集成

| 严重度 | 发现 |
|--------|------|
| **INFO** | 正确。sub-agent 事件内联处理，懒创建面板，`agent_end` 正确清理面板和状态。 |

### 5. Task Status Panel（新增）

| 严重度 | 发现 |
|--------|------|
| **LOW** | **Auto-hide 定时器有微竞态。** 全部完成后 5 秒定时器重置 task list，但如果新 `agent_start` 在定时器前触发，旧定时器可能在新 turn 中触发。`resetTaskList` 是幂等的所以无数据损坏，但面板可能闪烁。 |
| **INFO** | 信号订阅 + 磁盘重读 + 优先级排序 + 自动隐藏逻辑整体正确。 |

### 6. Streaming Preview（新增）

| 严重度 | 发现 |
|--------|------|
| **INFO** | 正确且最小化。`message_update` 时更新最后 3 行文本，`agent_end` 清理。无内部状态，无泄漏风险。 |

### 7. 对比 CC Spinner/StatusLine

| 严重度 | 发现 |
|--------|------|
| **INFO** | CC 的 `Spinner.tsx` 有多种模式（thinking/streaming/tool）、shimmer 动画、teammate 树、token 计数器、预算追踪。catui 的 `PencilLoader` 是单一工作指示器。预期差异——TUI 架构限制。 |
| **INFO** | CC 的 `StatusLine.tsx` 显示模型名、工作区、成本、上下文用量、限流、vim 模式等。catui 通过 `surface.showStatus()` 临时显示。功能差距但非正确性问题。 |

---

### 汇总

| 严重度 | 数量 |
|--------|------|
| MEDIUM | 2（taskUpdateUnsubscribe 未清理、compaction 清空 statusContainer） |
| LOW | 2（tool_execution_cancel 缺失、auto-hide 定时器微竞态） |
| INFO | 7 |

**优先修复项：**
1. `agent_end` 中添加 `this.taskUpdateUnsubscribe?.()` 清理订阅
2. `auto_compaction_start` 保留 task panel 和 streaming preview，仅替换 loader

---

## 2026-06-12 — Autocomplete 系统扫描

扫描范围：`core/lib/tui/src/autocomplete.ts` + `modes/interactive/slash-command-arguments.ts` + TUI editor 集成

### 1. Slash 命令名自动补全

| 严重度 | 发现 |
|--------|------|
| **MEDIUM** | **自定义 fuzzy 质量不如 Fuse.js。** CC 用 Fuse.js + 缓存索引 + 多级排序（exact name > exact alias > prefix name > prefix alias > fuzzy）。catui 用自定义 `weightedFuzzyFilter`，无 alias 支持、无 part-key 分割（如 `com-mit`）、无缓存索引。每次按键重新过滤全量命令列表。 |
| **MEDIUM** | **`weightedFuzzyFilter` 有 bug 风险。** 字段不匹配时 `Infinity` 被计入分数，但只要任一字段匹配就 `hasMatch = true`——可能产生仅 description 匹配而 name 不匹配的反直觉结果。 |
| **INFO** | 命令名匹配权重（name 3、description 0.5）合理。结果上限 10 个可接受。 |

### 2. Slash 命令参数自动补全

| 严重度 | 发现 |
|--------|------|
| **INFO** | **比 CC 更丰富。** catui 有 7 个命令的专用参数补全（model/thinking/agent-loop/mcp/language/persona/login），CC 无等价模块。结构清晰，token-index 上下文正确。 |
| **LOW** | **纯前缀匹配。** `/model son` 不匹配 `claude-sonnet`。CC 的命令建议用 Fuse.js fuzzy 匹配。 |

### 3. 文件路径自动补全

| 严重度 | 发现 |
|--------|------|
| **HIGH** | **同步 I/O 阻塞事件循环。** `readdirSync` 和 `spawnSync(fd)` 每次 Tab/@ 触发都阻塞 TUI 线程。CC 用 async git + Rust native nucleo 索引 + 渐进式查询 + 后台刷新。 |
| **HIGH** | **无 LRU 缓存。** 每次 Tab 都重新读目录。CC 有 500 条目 5 分钟 TTL 的 LRU 缓存。 |
| **MEDIUM** | **`readdirSync` 路径无 `.gitignore` 过滤。** `fd` 路径默认遵守 `.gitignore` 但 `fd` 可能未安装。CC 有完整的 `.ignore`/`.rgignore` 模式支持。 |
| **MEDIUM** | **无后台刷新。** CC 有 5 节流的后台缓存刷新 + 渐进式索引构建。catui 无此机制。 |
| **INFO** | 评分逻辑（exact > prefix > substring > path-substring）合理。结果上限 20 个。 |

### 4. 补全显示与键盘导航

| 严重度 | 发现 |
|--------|------|
| **LOW** | **无 shell history ghost text。** CC 有 `!` 前缀的历史命令内联预览。catui 缺失。 |
| **LOW** | **无 MCP resource/agent 建议。** CC 的统一弹出框包含 MCP 资源和 agent 建议。 |
| **LOW** | **选择状态不跨重建保留。** CC 有 `getPreservedSelection` 在建议列表变化时保留选中项。catui 每次重置。 |
| **INFO** | `CombinedAutocompleteProvider` 同时提供 `getSuggestions` 和 `applyCompletion`，TUI editor 层处理弹出框渲染和键盘绑定。 |

---

### 汇总

| 严重度 | 数量 |
|--------|------|
| HIGH | 2（同步 I/O 阻塞、无 LRU 缓存） |
| MEDIUM | 3（fuzzy 质量、fuzzy bug 风险、无 gitignore 过滤） |
| LOW | 4（纯前缀匹配、无 shell history、无 MCP 建议、选择不保留） |
| INFO | 3 |

**优先修复项：**
1. 将 `spawnSync(fd)` 替换为异步调用 + LRU 缓存（500 条目 5 分钟 TTL）
2. `readdirSync` 路径添加 `.gitignore` 过滤
3. `weightedFuzzyFilter` 修复 Infinity 分数 bug，或迁移到 Fuse.js

---

## 2026-06-12 — Session Management 扫描

扫描范围：`core/runtime/session-manager.ts` + `modes/interactive/controllers/session-lifecycle-controller.ts`

### 1. 会话创建与持久化

| 严重度 | 发现 |
|--------|------|
| **HIGH** | **无原子写入。** `appendFileSync` 直接写目标文件，crash 时可能产生部分 JSON 行导致损坏。CC 用 `ftruncate` 做安全原地编辑。`_rewriteFile()` 用 `writeFileSync` 全量覆盖，无 tmp+rename 模式，中断时会话被毁。 |
| **MEDIUM** | **无预写备份。** CC 有 tombstone + 50MB 大小守卫。catui 的 `_rewriteFile()` 直接覆盖，无备份。 |
| **INFO** | JSONL 格式 + 会话头（id/timestamp/cwd/parentSession）设计合理。`parseSessionEntries` 跳过格式错误行可缓解数据丢失但不防止静默损坏。 |

### 2. 会话恢复

| 严重度 | 发现 |
|--------|------|
| **HIGH** | **状态恢复严重不完整。** CC 恢复：文件历史、归属状态、成本追踪、worktree 上下文、todo 列表、agent 类型、模型覆盖。catui 仅恢复 model + thinking level。 |
| **MEDIUM** | **不恢复 agent 类型。** CC 跨会话持久化和恢复 agent 类型，catui 缺失。 |
| **MEDIUM** | **不恢复 todo/task 列表。** CC 从会话恢复 todo 状态，catui 的 task 系统与会话管理无集成。 |
| **INFO** | `switchSession` 正确断开 agent → 加载文件 → 重建 SessionContext → 恢复 model/thinking → 重连。流程合理但恢复内容不足。 |

### 3. 会话 Fork/Branch

| 严重度 | 发现 |
|--------|------|
| **INFO** | **比 CC 更丰富。** 基于树的 append-only 分支结构 + leaf 指针 + branch summary + 标签保留，设计优秀。CC 用更简单的扁平转录。 |
| **LOW** | **无内容替换记录转发。** CC fork 时复制 `ContentReplacementRecord`，catui 不追踪内容替换。 |
| **LOW** | **无会话所有权守卫。** CC fork 时剥离 worktree session 防止误删，catui 无此保护。 |

### 4. 会话列表/切换

| 严重度 | 发现 |
|--------|------|
| **MEDIUM** | **列表性能差。** `listAll()` 解析所有 JSONL 文件提取元数据。CC 用 head/tail 读取 + 缓存。大量会话时 catui 会很慢。 |
| **MEDIUM** | **无会话删除。** `SessionManager` 无 `delete()` 方法。CC 支持 tombstone 删除。 |

### 5. 会话清理

| 严重度 | 发现 |
|--------|------|
| **HIGH** | **完全缺失。** 无 TTL、无修剪、无最大会话数限制。会话无限增长，磁盘用量失控。CC 有 `cleanupPeriodDays` 设置 + 退出时清理。 |

### 6. 消息存储格式

| 严重度 | 发现 |
|--------|------|
| **INFO** | 类型化条目系统（`SessionMessageEntry`、`CustomMessageEntry`、`CompactionEntry`、`BranchSummaryEntry`、`ModelChangeEntry`、`ThinkingLevelChangeEntry`、`LabelEntry`）结构优秀，比 CC 更类型化。 |

### 7. 错误恢复

| 严重度 | 发现 |
|--------|------|
| **MEDIUM** | **部分损坏时静默丢失数据。** 单个损坏行导致 `loadEntriesFromFile` 丢失该行之后的所有条目。CC 用分段读取处理更优雅。 |
| **MEDIUM** | **`_rewriteFile` 无备份。** 覆盖前不保存旧版本，中断时会话永久丢失。 |

---

### 汇总

| 严重度 | 数量 |
|--------|------|
| HIGH | 3（无原子写入、状态恢复不完整、无会话清理） |
| MEDIUM | 6（无预写备份、不恢复 agent/todo、列表性能差、无删除、损坏数据丢失、rewrite 无备份） |
| LOW | 2（无内容替换转发、无所有权守卫） |
| INFO | 2 |

**优先修复项：**
1. `_rewriteFile` 改用 tmp+rename 原子写入
2. 添加会话清理机制（TTL + 最大数量）
3. 扩展状态恢复范围（至少恢复 task 列表和 agent 类型）

---

## 2026-06-12 — Provider/Model 系统扫描

扫描范围：`core/model-registry.ts` + `core/runtime/model-controller.ts` + `core/lib/ai/src/stream.ts` + `core/runtime/retry-coordinator.ts`

> 注：catui 支持 20+ provider，CC 仅支持 4 个 Anthropic 变体。以下侧重高可用性和缺陷检查。

### 1. Provider 注册与发现

| 严重度 | 发现 |
|--------|------|
| **INFO** | **比 CC 更丰富。** `ModelRegistry` 合并内置模型 + `models.json` 自定义 + 远程 `/models` 端点发现。支持懒加载 provider、发现缓存 TTL、自定义协议（Anthropic-compat、OpenAI-compat）。CC 仅 env-var 选择单一 provider。 |

### 2. 模型选择与切换

| 严重度 | 发现 |
|--------|------|
| **MEDIUM** | **无 529 过载自动降级。** CC 在连续 3 次 529 后自动从 Opus 降级到 Sonnet。catui 无等价机制——过载时直接报错给用户。 |
| **INFO** | 模型循环（`cycleModel` 前后切换）、thinking level 耦合、OAuth token 验证、glob 模式过滤——比 CC 更精细。 |

### 3. 重试逻辑与限流处理

| 严重度 | 发现 |
|--------|------|
| **MEDIUM** | **重试次数过低。** Stream 层 3 次重试 vs CC 的 10 次。瞬态 provider 中断时 catui 过早放弃。 |
| **MEDIUM** | **无 529 专项处理。** CC 将 529（overloaded）作为独立错误类 + 连续计数 + 模型降级。catui 的 `retry-coordinator.ts` regex 仅匹配消息文本中的 "overloaded"，不处理原始状态码 529。 |
| **MEDIUM** | **`Retry-After` 仅从错误消息文本解析。** CC 从 HTTP 响应头通过 SDK 读取。provider 实现中未解析实际 HTTP 头。 |
| **LOW** | **无持久/无人值守重试模式。** CC 支持长时间运行会话的无限重试（5 分钟退避上限 + 6 小时重置上限）。 |
| **LOW** | **无 `x-should-retry` 头支持。** OpenRouter、Vercel Gateway 等 provider 实现此头，catui 未利用。 |
| **INFO** | 指数退避（1s 基础、30s 上限）+ jitter + 可重试错误分类（429/5xx/ECONNRESET/ETIMEDOUT）基本正确。 |

### 4. 错误处理完整性

| 严重度 | 发现 |
|--------|------|
| **MEDIUM** | **错误分类不够细。** CC 有 ~25 种类型化错误（rate-limit 类型检测、overage、prompt-too-long + token gap、PDF 错误、图片大小、tool_use/tool_result 不匹配、OAuth 撤销、组织禁用等）。catui 用基础 regex 分类。 |
| **INFO** | 上下文溢出检测覆盖 14 种 provider 模式（Anthropic/OpenAI/Google/xAI/Groq/OpenRouter/llama.cpp/LM Studio 等），比 CC 更广。 |

### 5. 模型成本追踪

| 严重度 | 发现 |
|--------|------|
| **INFO** | `calculateCost()` 按每百万 token 定价计算 input/output/cache 成本，实现正确。 |

### 6. 上下文溢出检测

| 严重度 | 发现 |
|--------|------|
| **INFO** | 14 种 regex 模式 + 静默溢出检测（usage input vs context window）。多 provider 覆盖与 catui 的多 provider 使命一致，优于 CC。 |

---

### 汇总

| 严重度 | 数量 |
|--------|------|
| MEDIUM | 4（无 529 降级、重试次数低、Retry-After 仅文本解析、错误分类不细） |
| LOW | 2（无持久重试、无 x-should-retry） |
| INFO | 5 |

**优先修复项：**
1. Stream 重试次数从 3 提升到 5-6，支持配置覆盖
2. 添加 529 专项处理 + 连续计数 + 自动模型降级
3. Provider 实现中解析 HTTP `Retry-After` 响应头

---

## 2026-06-12 — Buddy/Pet 系统扫描

扫描范围：`modes/interactive/components/buddy/` 全部文件，对照 CC `src/buddy/` 模块（types.ts, sprites.ts, companion.ts, CompanionSprite.tsx, useBuddyNotification.tsx 等）

### 架构对比

CC 有 7 个文件按职责分离（types, sprites, companion logic, prompt injection, React rendering, notifications），深度集成到 React REPL。catui 有 2 个专用文件（`pet-sprites.ts`, `editor-buddy-layout.ts`），使用 TUI 命令式组件模型，结构更简洁。

### 1. 正确性缺陷

| 严重度 | 发现 |
|--------|------|
| **BUG** | **闪烁动画仅在 idle + frame 0 时生效。** `startAnimation()` tick 函数在 `this.state !== "idle" \|\| this.currentFrame !== 0` 时直接 return。虽然 `setState()` 会重置 frame 为 0 使闪烁恢复，但 blink timer 在 2500ms 固定间隔运行，无生命周期感知（TUI 挂起时仍在运行）。 |
| **BUG** | **blinkResetTimer 无重复保护。** `tick` 内 `setTimeout` 设置 `this.blinkResetTimer` 但不检查是否已有 pending timer。理论上可能产生重叠 timer（虽然当前 guard 使可能性极低）。 |
| **BUG** | **Sprite frame 取模无边界检查。** `this.sprite.states[this.state]` 理论上可能返回 `undefined`（如果 state 被运行时篡改）。TypeScript 编译时阻止，但运行时可变性存在风险。 |

### 2. 缺失错误处理

| 严重度 | 发现 |
|--------|------|
| **MEDIUM** | **无终端宽度适配。** CC 有 `MIN_COLS_FOR_FULL_SPRITE = 100`，窄终端自动折叠为单行表情。catui 的 `EditorBuddyLayout` 始终渲染 30 字符宽的 sprite 列，在 <50 列终端上会破坏布局。 |
| **MEDIUM** | **Speech bubble 存储但从未渲染。** `setSpeechBubble(text)` 保存文本并触发 re-render，但 `render()` 方法从不包含 `this.speechBubble`。这是死代码——数据写入无输出。 |
| **LOW** | **`buddySpecies` 无范围校验。** SettingsManager 保存整数索引，用户可设置任意数字。`ALL_SPRITES[spriteIndex % ALL_SPRITES.length]` 防崩溃，但无合理范围验证。 |

### 3. 高可用性

| 项目 | catui | CC | 评价 |
|------|-----------|-----|------|
| 状态持久化 | SettingsManager 持久化 `buddyEnabled`/`buddySpecies` | 全局 config 存储 `companion`（name+personality+hatchedAt） | 持平 |
| 确定性生成 | 无（用户手动选 sprite index） | `hash(userId)` → Mulberry32 PRNG → 同用户始终同 companion | **CC 优势**：抗配置篡改 |
| Timer 清理 | `dispose()` 清理 blink interval + reset timer | React effect cleanup | 持平 |
| 崩溃恢复 | 重启为 idle 状态 | 从 config 读取 + bones 重新生成 | 持平（均可接受） |

### 4. CC 功能差距

**关键缺失：**

| 功能 | CC | catui |
|------|-----|-----------|
| 物种多样性 | 18 种（duck, goose, blob, cat, dragon, octopus...） | 仅 6 种猫变体 |
| 稀有度系统 | 5 级稀有度 + 加权随机 + 视觉指示 | 无 |
| 确定性生成 | `hash(userId)` → 同用户始终同 companion | 手动选择 index |
| 孵化/命名 | `/buddy` 触发孵化，LLM 生成名字+性格 | 无孵化流程，名字硬编码 |
| Speech bubble 渲染 | 完整气泡（自动换行、淡出动画、尾部方向） | `setSpeechBubble()` 存在但从未显示 |
| 宠物互动 | `/buddy pet` 触发爱心动画 | 无 |
| 静音选项 | `companionMuted` config | 无（仅启用/禁用） |
| 系统提示注入 | Companion 名字+物种注入 LLM system prompt | 无 |
| 反应系统 | `fireCompanionObserver` 分析对话生成反应 | 无 |
| 帽子/眼睛/闪光 | 8 种帽子、6 种眼睛、1% 闪光变体 | 无 |
| Stats 系统 | 5 项统计（DEBUGGING, PATIENCE, CHAOS...） | 无 |

**中等缺失：**
1. 无 `/buddy` slash command
2. 无 LLM 集成（companion 不知道自己的存在）
3. 无 footer 选择器集成
4. 无窄终端自动折叠
5. 无 fullscreen 浮动气泡

### 5. 代码质量对比

**catui 优势：**
- 更简洁的架构（2 文件 vs CC 的 7 文件），适合当前功能范围
- 清晰的 JSDoc 头部（WHO/FROM/TO/HERE 模式）
- 干净的关注点分离（BuddyPetComponent 自包含，EditorBuddyLayout 处理布局）

**catui 弱点：**
- **死代码**：`speechBubble` 字段和 `setSpeechBubble()` 方法从未在渲染中使用
- **魔法数字**：`IDLE_BLINK_INTERVAL_MS=2500`, `BUDDY_COLUMN_WIDTH=30` 缺乏文档说明
- **动画单一**：6 个 sprite 全部使用相同的 2 帧动画（眨眼交替），CC 每物种有 3 帧 + 不同 fidget 模式
- **硬编码 sprite 数据**：内联字符串数组，未与渲染逻辑分离。CC 使用 `{E}` 占位符模板系统支持眼睛替换

### 汇总

| 严重度 | 数量 |
|--------|------|
| BUG | 3（闪烁 timer 生命周期、重叠 timer 风险、frame 边界） |
| MEDIUM | 3（无窄终端适配、speech bubble 死代码、species 范围无校验） |
| LOW | 1 |

**优先修复项：**
1. 实现 speech bubble 渲染（数据已存储但从未显示——功能性缺陷）
2. 添加窄终端适配（<80 列时隐藏或折叠 sprite 列）
3. 清理或接入 `setSpeechBubble()` 死代码
4. 考虑添加 `/buddy` slash command 提供基本控制

---

## 2026-06-12 — Keybindings 系统扫描

扫描范围：`core/lib/tui/src/keybindings.ts`, `core/lib/tui/src/keys.ts`, `core/platform/keybindings.ts`, 对照 CC `src/keybindings/` 模块（defaultBindings.ts, parser.ts, match.ts, resolver.ts, loadUserBindings.ts, validate.ts, reservedShortcuts.ts）

### 架构对比

catui 使用两层架构：Tier 1 Editor Keybindings（编辑器级动作）+ Tier 2 App Keybindings（应用级动作），通过全局单例 `EditorKeybindingsManager` 分发。CC 使用统一的上下文感知系统（18 个上下文），基于 React Context + Hooks 声明式绑定，支持多键和弦序列（如 `ctrl+k ctrl+s`）。

### 1. 正确性缺陷

| 严重度 | 发现 |
|--------|------|
| **MEDIUM** | **全局可变单例反模式。** `globalEditorKeybindings` 通过 `setEditorKeybindings()` 设置。若 `create()` 被多次调用（如 session 切换），持有旧引用的组件会静默使用过期绑定。CC 通过 React Context 传播变更。 |
| **MEDIUM** | **不支持 unbind/null-action。** `EditorKeybindingsConfig` 类型为 `KeyId \| KeyId[]`，无法取消默认绑定。CC 的 schema 支持 `z.null()` 取消默认。 |
| **MEDIUM** | **Alt+Enter 在 Kitty 协议激活时返回 false。** `keys.ts` 第 761-778 行：当 Kitty 协议激活且 CSI-u 序列不匹配时直接返回 false，无 fallback。对比 `shift+enter` 有 `\x1b\r` 和 `\n` 回退。 |
| **LOW** | **F-Key 修饰符全部拒绝。** `keys.ts` 第 968-985 行：所有带修饰符的 F 键组合（如 Ctrl+F5、Shift+F12）直接返回 false。CC 无此限制。 |

### 2. 缺陷

| 严重度 | 发现 |
|--------|------|
| **HIGH** | **用户配置无校验。** `loadFromFile()` 对 `JSON.parse` 错误静默返回 `{}`，action 名称拼写错误被完全忽略。CC 使用 Zod schema 校验，检查无效上下文/动作/重复键/保留快捷键，提供可操作错误信息。 |
| **MEDIUM** | **无热重载。** CC 用 chokidar 监听 `keybindings.json` 变更并自动重载。catui 仅启动时读取一次，用户必须重启才能生效。 |
| **MEDIUM** | **无冲突检测。** 无法检测用户配置的键绑定是否与其他绑定冲突。CC 的 `validate.ts` 检查同上下文内的重复键和保留快捷键。 |
| **MEDIUM** | **配置错误无恢复。** CC 的 `loadUserBindings.ts` 有多层错误处理（解析错误、结构校验、原始 JSON 重复键检测）。catui 任何错误都返回空对象，丢失所有用户自定义且无诊断信号。 |
| **LOW** | **双 Escape 映射歧义。** `keys.ts` 第 1092 行：`\x1b\x1b` 映射为 `ctrl+alt+[` 而非 `meta+escape`，可能混淆期望双 Escape 为独立键的用户。 |

### 3. 高可用性

| 项目 | catui | CC | 评价 |
|------|-----------|-----|------|
| 配置监听 | 无 | chokidar 文件监听 + 500ms 稳定阈值 + 订阅模型 | **CC 优势** |
| 错误降级 | 静默返回空对象 | 始终返回有效结果（默认+用户合并 或 纯默认），日志+通知系统警告 | **CC 优势** |
| 诊断工具 | `docs/keybindings.md` 全部 TODO | `/doctor` 命令集成 + 通知系统警告 | **CC 优势** |
| Schema 验证 | 无 | JSON Schema + `$schema` 字段供编辑器自动补全 | **CC 优势** |

### 4. CC 功能差距

**关键缺失：**

| 功能 | CC | catui |
|------|-----|-----------|
| 上下文感知绑定 | 18 个上下文（Global, Chat, Autocomplete, Settings...），同一键在不同上下文有不同含义 | 仅 2 层（editor + app），无上下文概念 |
| 多键和弦序列 | 支持 `ctrl+k ctrl+s` 等序列，1 秒超时 | 无 |
| 用户自定义 JSON | `~/.claude/keybindings.json` + schema 校验 + `/keybindings` 命令 | 读取 `keybindings.json` 但无校验、无命令、无文档 |
| 命令绑定 | 支持 `"ctrl+k": "command:help"` 绑定到 slash command | 无 |
| 平台感知默认值 | Windows `alt+v` 粘贴、macOS 保留 Cmd+C/V 等 | 平台无关 |
| 保留快捷键感知 | `NON_REBINDABLE`/`TERMINAL_RESERVED`/`MACOS_RESERVED` 三级 | 无 |
| 平台感知显示 | macOS 显示 "opt" 其他显示 "alt"、"cmd" vs "super" | 原始修饰符名称 |
| 配置热重载 | chokidar 监听 + 订阅模型 | 无 |
| JSON Schema | 自动生成供编辑器验证 | 无 |
| `/doctor` 集成 | 显示键绑定问题 | 无 |

### 5. 代码质量对比

**catui 优势：**
- **类型安全 KeyId**：模板字面量类型提供编译时安全性，优于 CC 的运行时校验
- **Key 辅助对象**：`Key.ctrl("c")`, `Key.ctrlShift("p")` 提供优秀的 IDE 自动补全
- **Kitty 协议支持**：完整支持 flag 2（按键释放/重复）、flag 4（备用键）、非拉丁布局基础键回退
- **Kill ring 和 undo**：Emacs 风格的 kill ring 和带合并的 undo 系统

**catui 弱点：**
- 全局可变状态（单例模式脆弱）
- 无配置校验（盲目信任用户输入）
- 300+ 行 `matchesKey()` switch 语句同时处理 legacy 和 Kitty 序列，CC 的结构化解析+匹配更清晰
- `docs/keybindings.md` 全部 TODO

### 汇总

| 严重度 | 数量 |
|--------|------|
| HIGH | 1（配置无校验——静默吞错） |
| MEDIUM | 6（全局单例、无 unbind、Alt+Enter bug、无热重载、无冲突检测、无错误恢复） |
| LOW | 3（F-Key 限制、双 Escape 映射、文档空） |

**优先修复项：**
1. 添加 `keybindings.json` 校验（至少检查 action 名称有效性 + 重复键警告）
2. 修复 Alt+Enter 在 Kitty 协议下的 fallback
3. 实现配置热重载（chokidar 监听文件变更）
4. 添加上下文感知绑定（至少区分 Autocomplete/Settings/Chat 上下文）

---

## 2026-06-12 — Memory 系统扫描

扫描范围：`packages/mem-core/` 全部文件（engine.ts, store.ts, store-v2.ts, scoring.ts, types.ts 等）+ `extensions/builtin/memory/extension.ts`，对照 CC `src/memdir/` 模块（teamMemPaths.ts, teamMemPrompts.ts, memoryTypes.ts, memoryAge.ts, extractMemories.ts, autoDream.ts, sessionMemory.ts）

### 架构对比

catui 实现了认知记忆架构：5 层记忆（episode, facet, semantic, procedural, state）+ 图链接系统 + 嵌入索引 + 渐进三层注入（active/cue/dormant）+ 艾宾浩斯间隔重复。CC 实现了文件记忆系统：Markdown 文件 + YAML frontmatter + MEMORY.md 索引，由 LLM 自身通过工具管理。

**核心区别：** catui 的记忆由代码引擎自动提取/管理（更自动化但不透明），CC 的记忆由 LLM 直接读写文件（更透明但依赖模型判断）。

### 1. 正确性缺陷

| 严重度 | 发现 |
|--------|------|
| **CRITICAL** | **`saveV2Snapshot` 并发竞态（store-v2.ts:128-138）。** 7 个存储文件通过 `Promise.all` 并行写入。进程崩溃时部分文件写入新数据、部分保留旧数据，存储不一致。无 WAL、无原子多文件提交、无版本校验。 |
| **HIGH** | **`writeJson` 非原子写入（store.ts:28-30）。** 直接调用 `writeFile`，崩溃时文件损坏。`grub-persistence.ts` 正确使用 tmp+rename 模式，但核心 `store.ts` 未使用。 |
| **MEDIUM** | **`ensureDir` 竞态（store.ts:14-15）。** `existsSync` + `mkdir` 存在竞态窗口。`mkdir({recursive:true})` 本身安全，但 `existsSync` 检查多余。 |
| **MEDIUM** | **`reinforceEntries` 读-改-写竞态（engine.ts:2218-2231）。** 加载全量条目 → 内存修改 → 全量写回。并发调用 `getMemoryInjection`（如 `before_agent_start`）可能互相覆盖。 |
| **LOW** | **`getMemoryInjection` 缩进异常（engine.ts:500-501）。** 方法体多一级缩进，疑似复制粘贴残留。 |

### 2. 缺陷

| 严重度 | 发现 |
|--------|------|
| **HIGH** | **`readJson` 静默吞错（store.ts:18-26）。** catch 块返回 fallback 值，无法区分"文件不存在"和"文件损坏"。无日志、无诊断。CC 有路径遍历攻击防护（280+ 行校验）、悬空符号链接检测、`ELOOP` 检测。 |
| **HIGH** | **`forgetEntry` 传入 `Infinity` 作为 max（engine.ts:1550）。** 删除条目时禁用驱逐限制，条目数永不封顶。应使用类别配置的 max 值。 |
| **MEDIUM** | **`buildRuntimeMemoryView` 冗余双重过滤（engine.ts:2084）。** `byType(runtimeEntries, "fact").filter(entry => entry.type === "fact")` — 第二次过滤是无操作的复制粘贴残留。 |
| **MEDIUM** | **`extractAndStore` 无 AbortSignal 传播（engine.ts:207-245）。** 6 个并行 save 调用无法取消。session 关闭时无法中断提取。 |
| **MEDIUM** | **无损坏恢复。** JSON 文件截断（如磁盘满）时静默作为空数组处理，整个类别的记忆存储丢失。 |

### 3. 高可用性

| 项目 | catui | CC | 评价 |
|------|-----------|-----|------|
| 原子写入 | 非原子 `writeFile` | 模型通过 Write 工具写入（tmp+rename） | **CC 优势** |
| 路径安全 | 无校验 | 280+ 行路径遍历防护、符号链接检测、Unicode 攻击防护 | **CC 优势** |
| 并发控制 | 无文件锁 | `tryAcquireConsolidationLock()` 跨 session 锁 | **CC 优势** |
| 维护前备份 | `createMaintenanceBackup` 完整备份 | 无 | **catui 优势** |
| 启动维护 | `runStartupMaintenance` 去重+迁移+归档 | 无等价物 | **catui 优势** |
| 崩溃恢复 | JSON 截断 → 数据丢失 | 文件损坏 → 诊断+降级 | **CC 优势** |
| 会话记忆 | 仅 session 结束时保存 episode | `sessionMemory.ts` 中途更新工作记忆 | **CC 优势** |

### 4. CC 功能差距

**关键缺失：**

| 功能 | CC | catui |
|------|-----|-----------|
| 文件化记忆+LLM 自管理 | LLM 通过文件工具读写 MEMORY.md + 主题文件 | 代码引擎管理 JSON blob，LLM 无直接控制 |
| MEMORY.md 可读索引 | 人类可读索引+文件链接，可直接编辑 | JSON blob 不透明，不可浏览/编辑/版本控制 |
| Team 记忆+范围隔离 | 完整 private/team 范围、符号链接安全、跨用户同步 | 仅有范围类型定义，无实现 |
| Session 工作记忆 | 中途更新的工作记忆文件 | 仅 session 结束保存 episode |
| 子进程提取 | fork 子进程共享 prompt cache，用工具写入 | 同步 fire-and-forget，无 cache 共享 |
| 记忆新鲜度警告 | 47 天前的记忆 → "声明可能过时" | 无等价物 |
| LLM 相关性选择 | Sonnet 侧查询选 top 5 | 评分算法（时间衰减+重要性+标签），无 LLM |
| `/remember` 技能 | 审查记忆全景，建议升级/降级 | 无 |
| 安全：路径遍历防护 | 280+ 行防护（空字节、URL 编码、Unicode 规范化、符号链接循环） | 无 |

**catui 独有优势：**

| 功能 | catui | CC |
|------|-----------|-----|
| 认知记忆模型 | 5 层架构+图链接+冲突检测 | 扁平文件，无结构关系 |
| 艾宾浩斯间隔重复 | `R = e^(-t*ln2/S)` 强度随回忆增长 | 无 |
| 渐进三层注入 | Active（完整）→ Cue（摘要）→ Dormant（不注入） | 一层（选中或未选中） |
| 嵌入索引语义搜索 | 哈希嵌入向量相似度搜索 | LLM 文本选择 |
| 归档/复活系统 | 过时记忆归档，相关查询时自动复活 | 无归档概念 |
| 冲突检测+解决 | 检测冲突记忆，建议合并/降级/忘记/标记情境 | 无 |
| 洞察报告 | 完整 HTML 报告（模式、挣扎、根因分析） | 无 |
| 双提取 | LLM + 正则启发式回退 | 仅 LLM |
| I18n | 中英文 | 仅英文 |
| 双时间模型 | `created`（摄入时间）+ `eventTime`（事件时间） | 仅文件修改时间 |

### 5. 代码质量对比

**catui 优势：**
- 优秀的 JSDoc 标注（WHO/FROM/TO/HERE 约定）
- 完整测试覆盖（test/ 目录 20+ 测试文件）
- 良好的类型定义+向后兼容迁移路径（如 `migrateEntry`）

**catui 弱点：**
- `engine.ts` 2,397 行 — God class，职责过多
- 错误处理不一致：部分方法 throw、部分返回 null、部分静默 catch
- `forgetEntry` 用 `Infinity` 作为 max，疑似 bug
- 2084 行双重过滤，复制粘贴残留

### 汇总

| 严重度 | 数量 |
|--------|------|
| CRITICAL | 1（saveV2Snapshot 并发竞态） |
| HIGH | 3（非原子写入、readJson 静默吞错、forgetEntry Infinity max） |
| MEDIUM | 4（ensureDir 竞态、reinforceEntries 竞态、冗余过滤、无 AbortSignal） |
| LOW | 1（缩进异常） |

**优先修复项：**
1. `store.ts` 的 `writeJson` 改用 tmp+rename 原子写入（`grub-persistence.ts` 已有参考实现）
2. `saveV2Snapshot` 添加顺序写入或事务日志
3. `forgetEntry` 使用类别配置的 max 替代 `Infinity`
4. `readJson` 增加日志区分文件不存在 vs 文件损坏
5. `extractAndStore` 支持 AbortSignal 传播

---

## 2026-06-12 — Diff/Patch 系统扫描

扫描范围：`core/tools/edit.ts`, `core/tools/edit-diff.ts`, `core/tools/write.ts`, `core/tools/file-state-cache.ts`, `modes/interactive/components/diff.ts`, `modes/interactive/components/tool-execution.ts`，对照 CC `src/tools/FileEditTool/` + `src/utils/diff.ts` + `src/utils/fileHistory.ts` + `src/components/diff/DiffDialog.tsx`

### 1. 正确性缺陷

| 严重度 | 发现 |
|--------|------|
| **CRITICAL** | **Fuzzy 匹配静默修改整个文件内容。** `edit-diff.ts:110-116` 将 `contentForReplacement` 设为 `fuzzyContent`（规范化后）。替换操作作用于规范化内容，导致整个文件的尾随空格被剥离、智能引号转 ASCII、Unicode 破折号转连字符。CC 的 `findActualString` 仅规范化匹配区域。Markdown 硬换行（两尾随空格）会被静默破坏。 |
| **HIGH** | **Write 工具存储错误的过期时间戳。** `write.ts:116-119` 使用 `Date.now()` 而非 `postWriteStat.mtimeMs`。`Date.now()` 远大于 `mtimeMs`，导致过期检查 `currentStat.mtimeMs > cachedState.timestamp` 几乎永不触发，过期检测完全失效。 |
| **MEDIUM** | **出现次数计数双重规范化。** `edit.ts:175-177` 对已规范化的内容再次调用 `normalizeForFuzzyMatch` 计数。若 `normalizeForFuzzyMatch` 相对于 `normalizeToLF` 非幂等（当前是，但契约未文档化），可能产生错误计数。 |
| **MEDIUM** | **错误类型不一致。** `edit.ts:119` 构造 `new Error("File not found")`，但 `edit.ts:255` 直接 reject 原始 error 对象。行为正确但代码风格不一致。 |
| **LOW** | **空字符串处理未验证。** CC 校验 `old_string === ''` 仅在创建新文件时有效。catui 无此守卫，`fuzzyFindText` 查找空字符串行为未测试。 |

### 2. 缺陷

| 严重度 | 发现 |
|--------|------|
| **HIGH** | **无 `replace_all` 参数。** CC 支持 `replace_all: boolean` 替换所有出现。catui 在多处出现时直接拒绝（`edit.ts:179-189`）。LLM 重命名变量（出现 10 次）时 CC 一次调用即可，catui 需 10 次或每次提供足够上下文。 |
| **HIGH** | **无文件历史/快照/回滚系统。** CC 有 1116 行的 `fileHistory.ts`：版本备份、每轮快照、完整回滚、session resume 支持。catui **零等价物**——编辑出错只能手动恢复。这是两个系统间最大的功能差距。 |
| **MEDIUM** | **无 API token 反净化。** CC 的 `DESANITIZATIONS` 映射将 `<fnr>` 还原为 `<function_results>`、`\n\nH:` 还原为 `\n\nHuman:`。LLM 输出的 `old_string` 包含净化 token 时 CC 透明处理，catui 会静默 "String not found"。 |
| **MEDIUM** | **无引号风格保留。** CC 的 `preserveQuoteStyle` 检测弯引号并保持一致。catui 将弯引号规范化为 ASCII 后不恢复，编辑区域与文件其余部分引号风格不一致。 |
| **MEDIUM** | **无 UTF-16LE 编码检测。** CC 检测 UTF-8/UTF-16LE 编码和 LF/CRLF 行尾。catui 仅规范化 CRLF→LF，编辑 UTF-16LE 文件会损坏。 |
| **MEDIUM** | **无大文件保护。** CC 定义 `MAX_EDIT_FILE_SIZE = 1 GiB` 防止 OOM。catui 无等价守卫。 |
| **MEDIUM** | **无 diff 计算超时。** CC 定义 `DIFF_TIMEOUT_MS = 5_000`。catui 使用 `Diff.diffLines` 无超时，大文件可能长时间阻塞事件循环。 |
| **LOW** | **Abort signal handler 泄漏风险。** `edit.ts:97-107` 的 abort handler 在某些 early return 分支未清理。`{ once: true }` 最终会清理，但 `removeEventListener` 仅在部分分支调用。 |
| **LOW** | **无 Jupyter notebook 守卫。** CC 拒绝编辑 `.ipynb` 文件并引导至 `NotebookEditTool`。catui 无此守卫，编辑 notebook 可能静默损坏。 |

### 3. 高可用性

| 项目 | catui | CC | 评价 |
|------|-----------|-----|------|
| 文件历史/快照 | **无** | `fileHistory.ts` 1116 行：版本备份、轮次快照、完整回滚、session resume | **CC 压倒性优势** |
| 回滚能力 | 无 | `fileHistoryRewind` 恢复所有文件到任意快照 | **CC 压倒性优势** |
| 结构化补丁输出 | 纯文本 diff | `structuredPatch` 数组（hunk 对象） | **CC 优势** |
| Diff 浏览 UI | 内联 `renderDiff()` | `DiffDialog.tsx` 键盘导航、文件列表、hunk 渲染 | **CC 优势** |
| 编辑预览 | `computeEditDiff` 预执行 diff 预览 | 无等价物（diff 后执行计算） | **catui 优势** |
| 可插拔后端 | `EditOperations`/`WriteOperations` 接口支持 SSH | 无等价抽象 | **catui 优势** |
| LRU 缓存 | `FileStateCache` 双维淘汰（条目+字节） | 简单方法 | **catui 优势** |
| 遥测 | 无 | `tengu_edit_string_lengths`, `tengu_file_changed` 等 | **CC 优势** |

### 4. CC 功能差距

| 功能 | CC | catui |
|------|-----|-----------|
| `replace_all` 参数 | 支持 | 不支持 |
| 多编辑输入（edits 数组） | `getPatchForEdits` 支持链式编辑+冲突检测 | 仅单编辑 |
| API token 反净化 | `DESANITIZATIONS` 映射 | 无 |
| 弯引号保留 | `preserveQuoteStyle` | 无 |
| UTF-16LE 编码检测 | `readFileSyncWithMetadata` | 无 |
| 大文件保护 | 1 GiB 限制 | 无 |
| Diff 超时 | 5 秒 | 无 |
| Jupyter 守卫 | 拒绝 `.ipynb` | 无 |
| 文件历史/快照/回滚 | 完整系统 | **无** |
| 结构化补丁输出 | hunk 数组 | 纯文本 |
| 轮次 diff 聚合 | `useTurnDiffs` hook | 无 |
| `/diff` 命令+对话 UI | `DiffDialog.tsx` | 无 |
| LSP 集成 | didChange/didSave | 无 |
| UNC 路径安全守卫 | 有 | 无 |
| 编辑去重 | `areFileEditsInputsEquivalent` | 无 |
| 输入规范化层 | `normalizeFileEditInput` | 无 |

### 5. 代码质量对比

**catui 优势：**
- 可插拔后端接口（`EditOperations`/`WriteOperations`）支持远程文件系统
- `FileStateCache` 纯 LRU 实现，双维淘汰（条目数+字节数）
- `computeEditDiff` 预执行 diff 预览，CC 无等价物
- `editDiffPreview` 模式在工具执行前异步计算 diff 提供即时视觉反馈

**catui 弱点：**
- `edit.ts` 的 Promise wrapper 是反模式（async IIFE 内嵌 `new Promise`）
- Fuzzy 匹配过度规范化——规范化整个文件而非仅匹配区域
- `detectLineEnding` 检测逻辑微妙：混合行尾时返回先出现的而非主导的

### 汇总

| 严重度 | 数量 |
|--------|------|
| CRITICAL | 1（fuzzy 匹配静默损坏整个文件） |
| HIGH | 3（write 时间戳错误、无 replace_all、无文件历史） |
| MEDIUM | 7（双重规范化、错误类型、API 反净化、引号保留、UTF-16LE、大文件、diff 超时） |
| LOW | 3（空字符串、abort 泄漏、Jupyter 守卫） |

**优先修复项：**
1. **CRITICAL**: 修复 fuzzy 匹配——仅规范化匹配区域，替换后映射回原始内容
2. **CRITICAL**: 修复 write 工具时间戳——使用 `postWriteStat.mtimeMs` 替代 `Date.now()`
3. **HIGH**: 添加 `replace_all` 参数
4. **HIGH**: 实现最小文件历史系统（至少支持每轮备份+单文件回滚）
5. **HIGH**: 返回结构化 patch 输出（hunk 数组）

---

## 2026-06-12 — Git 集成系统扫描

扫描范围：`core/tools/bash.ts`（sandbox git 模式）、`utils/git.ts`（URL 解析）、`core/workspace/worktree-manager.ts`，对照 CC `src/utils/git.ts` + `src/utils/git/` + `src/tools/BashTool/readOnlyValidation.ts` + `src/tools/BashTool/bashPermissions.ts` + `src/utils/gitDiff.ts` + `src/tools/shared/gitOperationTracking.ts`

### 架构对比

CC 有 ~8000 行 git 集成，分层清晰：核心工具（git.ts）、文件系统级状态读取（gitFilesystem.ts）、配置解析（gitConfigParser.ts）、gitignore 管理、diff 计算、只读命令验证（~50 条目）、bash 权限守卫、操作追踪。catui 仅有一个 sandbox regex 阻止 git 写操作 + `WorktreeManager` 管理子代理工作区。

### 1. 安全缺陷

| 严重度 | 发现 |
|--------|------|
| **CRITICAL** | **无 bare-repo 攻击检测。** CC 有 `isCurrentDirectoryBareGitRepo()` + 5 层防御（git 内部路径写入检测、cd+git 组合命令阻止、管道段检测）。catui **零防护**——攻击者可构造恶意仓库通过 hooks 执行任意代码。 |
| **CRITICAL** | **无 cd+git 组合命令阻止。** CC 的 `bashPermissions.ts` 阻止包含 `cd` 和 `git` 的复合命令，`bashCommandHelpers.ts` 检测管道段中的 cd+git。catui 无等价防护。 |
| **HIGH** | **Sandbox regex 漏洞百出。** `bash.ts:461` 的 regex 未阻止：`git stash push/drop/pop/apply`、`git branch -d/-D`、`git tag -d`、`git config --global`、`git gc`、`git clean -f`、`git update-ref`、`git restore`。CC 的 `GIT_READ_ONLY_COMMANDS` 有 ~50 条目+逐 flag 校验。 |
| **HIGH** | **无 git 命令规范化。** `NO_COLOR=1 git commit -m "fix"` 绕过 catui regex（期望 `\bgit\s+` 开头）。CC 的 `isNormalizedGitCommand()` 先 `stripSafeWrappers()` 去除环境变量/timeout/nice 等再匹配。 |
| **HIGH** | **无 git-internal 路径写入检测。** CC 检测对 `.git/` 目录的写入尝试。catui 无此防护。 |
| **MEDIUM** | **无只读命令白名单。** CC 对 ~25 个 git 子命令定义安全 flag 白名单（如 `git diff` 允许 `--stat`/`--name-only`/`-p` 但阻止 `--output`）。catui 无显式白名单，`git status`/`git diff`/`git log` 可能被 regex 误伤。 |

### 2. 正确性缺陷

| 严重度 | 发现 |
|--------|------|
| **HIGH** | **无临时 git 状态检测。** CC 的 `isInTransientGitState()` 检查 `MERGE_HEAD`/`REBASE_HEAD`/`CHERRY_PICK_HEAD`/`REVERT_HEAD` 文件。合并/变基期间工作树包含非用户意图的变更，diff 输出会误导。catui 无等价物。 |
| **MEDIUM** | **`utils/git.ts` 文件名误导。** 该文件仅做 git URL 解析（用于包管理），与 git 仓库操作无关。CC 的同名文件是完整的 git 操作模块。 |
| **MEDIUM** | **`findGitRoot` 缺失。** CC 的 `findGitRoot` 向上遍历目录树找 `.git`，LRU 缓存，处理 worktree/submodule。catui 完全依赖 git 子进程发现仓库状态，更慢且无法同步调用。 |

### 3. 高可用性

| 项目 | catui | CC | 评价 |
|------|-----------|-----|------|
| Git 状态缓存 | 无，每次查询 spawn 子进程 | 双层：同步 LRU + `fs.watchFile` 监听 `.git/HEAD`/`.git/config` | **CC 压倒性优势** |
| 状态快照 | 无 | `preserveGitStateForIssue()` 捕获 merge-base、patch、未跟踪文件、format-patch | **CC 优势** |
| Worktree 安全 | `createGitWorktree()` 直接信任 git 结果 | `resolveCanonicalRoot()` 验证 gitdir 链接、symlink、bare-repo | **CC 优势** |
| Stash 操作 | 无 | `stashToCleanState()` 先 stage 未跟踪文件再 stash 防数据丢失 | **CC 优势** |
| Worktree 创建 | 直接 `git worktree add`，不 stash 变更 | stash-to-clean-state 后创建 | **CC 优势** |

### 4. CC 功能差距

**关键缺失：**

| 功能 | CC | catui |
|------|-----|-----------|
| Git commit/PR 指令 | system prompt 中完整安全协议+分步指令（HEREDOC、并行 status/diff/log、force push 警告） | 无 |
| 只读命令验证 | ~50 条目 + 逐 flag 白名单 + 回调验证器 | 单 regex（漏洞百出） |
| Git 操作追踪 | 278 行：commit/push/cherry-pick/merge/rebase 检测 + OTLP 计数 + session-PR 自动关联 | 无 |
| 文件系统 git 状态 | `GitFileWatcher` 监听 `.git/HEAD`/`.git/config` + LRU 缓存 | 无 |
| `.git/config` 解析器 | 轻量解析器（大小写不敏感 section、转义、引号值） | 无 |
| Gitignore 管理 | `isPathGitignored()`、`addFileGlobRuleToGitignore()` | 无 |
| Bare-repo 安全 | 5 层防御 | 无 |
| 暂态状态检测 | MERGE_HEAD/REBASE_HEAD/CHERRY_PICK_HEAD/REVERT_HEAD | 无 |
| 单文件 git diff | `fetchSingleFileGitDiff()` 对比 merge-base | 仅本地文件 diff |
| 安全 ref 名验证 | `isSafeRefName()` 拒绝路径遍历/元字符/前导破折号 | 无 |

### 5. 代码质量对比

**catui 优势：**
- `WorktreeManager` 封装了完整的快照工作流（创建→检测→生成 patch→应用→清理）

**catui 弱点：**
- Sandbox regex 单点防护，无规范化、无白名单、无深层防御
- `WorktreeManager` 混合关注点（临时目录+快照+git worktree+变更检测+patch 生成+应用+清理）
- `utils/git.ts` 文件名误导

### 汇总

| 严重度 | 数量 |
|--------|------|
| CRITICAL | 2（bare-repo 攻击、cd+git 组合命令） |
| HIGH | 4（sandbox regex 漏洞、无命令规范化、无 git-internal 路径检测、无暂态状态检测） |
| MEDIUM | 3（无只读白名单、文件名误导、无 findGitRoot） |
| LOW | 0 |

**优先修复项：**
1. **CRITICAL**: 实现 bare-repo 攻击检测 + cd+git 组合命令阻止
2. **CRITICAL**: 重写 sandbox git 模式——从 regex 升级为白名单+逐 flag 校验
3. **HIGH**: 添加 git 命令规范化（去除环境变量/安全包装器后匹配）
4. **HIGH**: 添加暂态 git 状态检测（MERGE_HEAD/REBASE_HEAD 等）
5. **HIGH**: 在 system prompt 中添加 git commit/PR 安全指令

---

## 2026-06-12 — Theme/样式系统扫描

扫描范围：`core/theme-contract.ts`, `modes/interactive/theme/theme.ts`, `modes/interactive/theme/{dark,light,warm}.json`, `modes/interactive/components/theme-selector.ts`, 对照 CC `src/utils/theme.ts` + `src/utils/systemTheme.ts` + `src/components/design-system/` + `src/ink/colorize.ts` + `src/ink/styles.ts`

### 架构对比

catui 使用 JSON 文件+TypeBox schema 验证+`globalThis` Proxy 跨模块共享+自定义 ANSI 渲染器。CC 使用 React Context（ThemeProvider）+ 硬编码 TypeScript 主题对象+ThemedText/ThemedBox 组件抽象。

**catui 独有优势：** JSON 文件主题（用户可自定义）、`vars` 变量系统、TypeBox schema 验证。
**CC 独有优势：** 无自定义主题支持但有 daltonized（色盲友好）主题、auto 模式实时终端检测、预览+取消工作流。

### 1. 正确性缺陷

| 严重度 | 发现 |
|--------|------|
| **MEDIUM** | **`getThemeExportColors` 变量解析路径损坏。** `theme.ts:872-882` 使用 `value.startsWith("$")` 检查变量引用，但主题 JSON 的 `vars`/`colors` 系统不使用 `$` 前缀（裸名引用如 `"accent"`）。`$`-prefix 分支永远不会匹配，export colors 中的变量引用会原样返回字面量字符串。`resolveThemeColors`（line 291）使用正确的裸名解析，但 `getThemeExportColors` 走了错误路径。 |
| **LOW** | **`getCliHighlightTheme` 缓存失效逻辑误导。** `theme.ts:923-929` 用对象身份比较 (`!==`)，但 `theme` 是 Proxy，身份始终相同。缓存实际上通过闭包动态读取 `globalThis[THEME_KEY]` 所以结果正确，但意图不清晰，首次切换后每次都会不必要地重建缓存对象。 |
| **LOW** | **`isLightTheme` 过于简单。** 仅检查 `themeName === "light"`，自定义浅色主题不会被识别。CC 补偿了 `auto` 模式查询终端背景亮度。 |

### 2. 缺陷

| 严重度 | 发现 |
|--------|------|
| **MEDIUM** | **主题 watcher 错误静默吞没。** `theme.ts:738,758-760` catch 块无日志无用户通知。CC 至少通过 ThemePicker UI 通知用户。 |
| **MEDIUM** | **自定义主题目录扫描无预验证。** `getAvailableThemes()` 将所有 `.json` 文件加入列表，损坏文件会出现在列表中但选择时回退到 dark，无诊断信号。 |
| **MEDIUM** | **主题 watcher rename 事件原子保存竞态。** 使用原子保存（tmp+rename）的编辑器会触发 rename fallback，文件不存在时回退到 dark 并永久关闭 watcher。用户需重新选择主题才能恢复。 |
| **LOW** | **模块级可变状态无清理保证。** `BUILTIN_THEMES`、`currentThemeName`、`themeWatcher` 等都是模块级变量，多 loader 加载时状态分裂。`globalThis` Proxy 仅缓解 theme 实例的共享问题。 |

### 3. 高可用性

| 项目 | catui | CC | 评价 |
|------|-----------|-----|------|
| 主题持久化 | `settingsManager.setTheme()` 存储主题名 | `saveGlobalConfig` | 持平 |
| 错误恢复 | 回退到 dark | 回退到 dark + ThemePicker UI | **CC 优势** |
| Auto 模式 | `COLORFGBG` 启动时读取，静态 | OSC 11 实时查询 + `systemThemeWatcher` 动态切换 | **CC 优势** |
| 自定义主题 | JSON 文件+文件 watcher | 不支持自定义主题 | **catui 优势** |
| 预览+取消 | `onThemePreview` 直接应用，取消不回退 | `setPreviewTheme` + `cancelPreview` 可逆工作流 | **CC 优势** |
| 色盲友好 | 无 | `light-daltonized`/`dark-daltonized` 主题 | **CC 优势** |
| 16 色终端 | 256 色回退（hexTo256） | 专用 `light-ansi`/`dark-ansi` 16 色主题 | **CC 优势** |

### 4. CC 功能差距

| 功能 | CC | catui |
|------|-----|-----------|
| 色盲友好主题 | `light-daltonized`/`dark-daltonized`（蓝橙替代红绿） | 无 |
| ANSI-only 16 色主题 | `light-ansi`/`dark-ansi` | 无（仅 256 色回退） |
| Auto 模式+实时检测 | OSC 11 查询 + systemThemeWatcher | `COLORFGBG` 启动时读取 |
| 预览+取消工作流 | `setPreviewTheme`/`savePreview`/`cancelPreview` | 直接应用，取消不回退 |
| Shimmer 动画颜色 | `claudeShimmer`/`permissionShimmer`/`warningShimmer` 等 | 无 |
| Agent 专用颜色 | `red_FOR_SUBAGENTS_ONLY` 等 | 无 |
| 结构化文本样式 | `TextStyles` 类型（对象式样式组合） | 直接 ANSI 字符串 |
| ThemedText/ThemedBox | 自动解析主题键的组件抽象 | 手动 `theme.fg("accent", text)` |
| Hover 颜色上下文 | `TextHoverColorContext` | 无 |
| Rate limit/Memory 颜色 | `rate_limit_fill`/`memoryBackgroundColor` 等 | 无 |
| 选区背景色 | `selectionBg` | 无 |
| 原生语法高亮 | `color-diff-napi` | `cli-highlight`（功能较少） |

### 5. 代码质量对比

**catui 优势：**
- `theme-contract.ts` 纯类型无导入，干净的 contract/implementation 分离
- JSON 文件主题 + TypeBox schema 提供编译时+运行时双重保证
- `vars` 变量系统减少主题文件中的重复
- 主题验证失败时的详细错误信息（列出缺失的 color token）
- `cli-highlight` 懒加载优化启动性能

**catui 弱点：**
- `getThemeExportColors` 的 `$`-prefix 解析路径损坏
- `ThemeImpl` 预计算 ANSI 转义字符串，返回的部分应用字符串无法进一步组合
- Global Proxy 模式不寻常，可能混淆贡献者
- `docs/themes.md` 全部 TODO
- 无主题系统单元测试

**CC 弱点：**
- 主题定义硬编码在 TypeScript 中（600+ 行颜色值），不支持自定义主题
- Theme 类型 80+ 属性，命名不一致（如 `claudeBlue_FOR_SYSTEM_SPINNER`）
- 编译后的 React 输出（`_c` memo cache）提交到源码中

### 汇总

| 严重度 | 数量 |
|--------|------|
| MEDIUM | 4（export colors 解析损坏、watcher 错误吞没、无预验证、rename 竞态） |
| LOW | 3（缓存失效逻辑、isLightTheme 过于简单、模块级可变状态） |

**优先修复项：**
1. 修复 `getThemeExportColors` 的变量解析——使用裸名引用替代 `$`-prefix
2. 主题 watcher 的 rename 事件添加文件重建延迟检测（避免原子保存触发 fallback）
3. 添加主题预览+取消工作流（预览时暂存原主题，取消时恢复）
4. 添加 auto 模式——至少在启动时用 OSC 11 查询终端背景

---

## 2026-06-12 — TUI 框架核心扫描

扫描范围：`core/lib/tui/src/` 全部文件（tui.ts, terminal.ts, component.ts, container.ts, text.ts, input.ts, spacer.ts, box.ts, select-list.ts, utils.ts, overlay.ts 等），对照 CC `src/ink/` + `src/components/design-system/`

### 架构对比

**根本性差异：** CC 使用 React + Yoga 布局引擎 + 基于 Int32Array 的 cell 级屏幕缓冲 + 差异渲染。catui 使用命令式类组件 + `render(width): string[]` 返回文本行 + 字符串级差异渲染。CC 有完整的 CSS Flexbox 布局、事件系统、鼠标支持、文本选择、虚拟滚动。catui 仅手动垂直堆叠。

### 1. 正确性缺陷

| 严重度 | 发现 |
|--------|------|
| **MEDIUM** | **`visibleWidth()` ANSI 剥离 regex 不完整。** `utils.ts:125-131` 的 regex `\x1b\[[0-9;]*[mGKHJ]` 仅处理有限 CSI 终端字节。CC 使用 `strip-ansi` 库处理所有 CSI 序列。包含光标移动（`\x1b[3B`）、设备属性等序列时宽度计算错误，可能导致渲染崩溃。 |
| **MEDIUM** | **Tab 宽度硬编码为 3 空格。** `text.ts:68` 和 `utils.ts:121` 全局 3 空格。CC 使用标准 8 列 tab-stop 对齐。非标准 tab 导致对齐错位。 |
| **MEDIUM** | **Select-list 仅支持 `startsWith` 过滤。** `select-list.ts:47` 仅匹配开头。CC 支持完整子串/fuzzy 匹配。用户无法通过输入中间字符查找选项。 |
| **LOW** | **`Spacer.render()` 返回空字符串。** `spacer.ts:31` 返回 `""` 而非 `" ".repeat(width)`。在 Box 内有背景时由 `applyBg` 填充，但作为 Container 直接子项时创建宽度为 0 的"隐形"行。 |
| **LOW** | **`Input.render()` prompt 硬编码为 `"> "`。** `input.ts:433` 不可配置。CC 通过 props 接受任意 prompt。 |
| **LOW** | **`Text.render()` 空文本返回不一致。** 文本为空且 paddingY=0 时可能返回 `[]` 或 `[""]`，取决于代码路径。 |
| **LOW** | **`TUI.doRender()` 崩溃路径先 stop 再 throw。** `tui.ts:1123-1134` 先调用 `this.stop()` 再 throw，终端状态不一致。 |

### 2. 缺陷

| 严重度 | 发现 |
|--------|------|
| **HIGH** | **无事件系统。** CC 有完整 DOM 式事件模型（capture/bubble、stopPropagation、ClickEvent/FocusEvent/KeyboardEvent/InputEvent）。catui 组件仅接收原始键字符串，无事件对象、无冒泡、无捕获阶段。无法实现鼠标输入、焦点导航、事件委托。 |
| **HIGH** | **无布局引擎。** CC 使用 Yoga（CSS Flexbox：row/column、flex-grow/shrink/basis、align/justify/wrap、position、overflow、margin/padding/border/gap、百分比 sizing）。catui 仅手动垂直堆叠，Box 仅有 paddingX/paddingY/bgFn。这是最大的架构差距。 |
| **HIGH** | **无 ScrollBox/虚拟滚动。** CC 的 `overflow: scroll` 支持虚拟滚动、viewport 裁剪、sticky scroll、scroll-to-element、DECSTBM 硬件滚动优化。catui 无法处理长内容而不全量重渲染。 |
| **MEDIUM** | **无崩溃恢复/终端状态保护。** CC 有 AlternateScreen、信号处理器（SIGINT/SIGTERM）恢复终端状态。catui 依赖调用方调用 `TUI.stop()`，未处理异常时终端留在 raw mode+隐藏光标。 |
| **MEDIUM** | **`ProcessTerminal.stop()` 不排空输入。** `terminal.ts:254-291` 恢复 raw mode 前不调用 `drainInput()`。缓冲的 Kitty 协议响应可能泄漏到父 shell。 |
| **MEDIUM** | **`parseCellSizeResponse()` 无超时处理。** `tui.ts:597` 部分转义序列未完成时立即放弃，终端响应缓冲区可能被当作用户输入消费，产生幻影按键。 |
| **MEDIUM** | **`Box.setBgFn()` 缓存检测用采样值。** `box.ts:103` 用 `bgFn("test")` 采样。两个不同 bgFn 对 "test" 输出相同但对实际内容输出不同时缓存过期。 |
| **LOW** | **非 TTY 环境无优雅降级。** `ProcessTerminal` 未检查 `process.stdout.isTTY` 就调用 `setRawMode(true)`，管道输出时崩溃。 |
| **LOW** | **无 SIGCONT 处理。** `Ctrl+Z` + `fg` 后终端尺寸可能过期。 |

### 3. 高可用性

| 项目 | catui | CC | 评价 |
|------|-----------|-----|------|
| 布局引擎 | 无（手动堆叠） | Yoga CSS Flexbox | **CC 压倒性优势** |
| 屏幕缓冲 | 字符串级 diff | Int32Array cell 级+damage tracking+双缓冲 | **CC 压倒性优势** |
| 事件系统 | 原始字符串 passthrough | DOM 式 capture/bubble+完整事件类型 | **CC 压倒性优势** |
| 虚拟滚动 | 无 | ScrollBox+viewport culling+硬件滚动 | **CC 优势** |
| 崩溃恢复 | 依赖调用方 stop() | 信号处理器+AlternateScreen | **CC 优势** |
| 鼠标支持 | 无 | SGR 鼠标追踪+hit-test | **CC 优势** |
| 文本选择 | 无 | Selection+NoSelect+clipboard | **CC 优势** |
| 终端兼容性 | Kitty 协议+blocklist+同步输出 | Kitty+XTVERSION 探测+更多 bug 规避 | 持平 |
| 文档 | WHO/FROM/TO/HERE JSDoc | 最少文件级文档 | **catui 优势** |
| 调试 | 多级 debug+崩溃日志 | 性能检测+重绘调试 | 持平 |

### 4. CC 功能差距（主要项）

| 功能 | CC | catui |
|------|-----|-----------|
| CSS Flexbox 布局 | Yoga：row/column、flex-grow/shrink/basis、align/justify/wrap、position、overflow | 手动垂直堆叠 |
| React 组件模型 | JSX+reconciler+hooks | 命令式类+render(width) |
| 8 种文本换行 | wrap/wrap-trim/end/middle/truncate-* | 仅 word wrap |
| ScrollBox | 虚拟滚动+viewport culling+sticky scroll+硬件滚动 | 无 |
| Alternate Screen | 进入/退出+鼠标追踪+主屏保留 | 无 |
| 鼠标支持 | SGR 追踪+hit-test+mouseenter/mouseleave | 无 |
| 文本选择/复制 | Selection+NoSelect+highlight+clipboard | 无 |
| 搜索高亮 | 逐 cell 搜索高亮+当前位置追踪 | 无 |
| 焦点管理 | FocusManager+focus stack+tabIndex+autoFocus | 单一 focused 布尔值 |
| 事件系统 | capture/bubble+stopPropagation+ClickEvent/FocusEvent/KeyboardEvent | 原始字符串 |
| OSC 8 超链接 | cell 级超链接+HyperlinkPool | 无 |
| BiDi 文本 | reorderBidi() | 无 |
| Cell 级差异渲染 | diffEach() Int32Array+damage tracking+blit 优化 | 字符串行级 diff |
| 屏幕缓冲 | Int32Array packed cells+CharPool/StylePool/HyperlinkPool+双缓冲 | 无 |
| 完整 SGR 样式 | color/bg/bold/dim/italic/underline/strikethrough/inverse/opacity+StylePool | bgFn 回调 |
| 图片渲染 | Kitty/iTerm2 内联图片 | 独立 Image 组件 |
| 性能检测 | commit/yoga/render/scroll timing+重绘调试 | 仅文件 debug 日志 |
| 进度报告 | OSC 9;4 终端任务栏进度 | 无 |
| NoSelect 组件 | 排除选择区域 | 无 |
| Soft wrap 追踪 | 逐行 softWrap 位图 | 无 |

### 5. 代码质量对比

**catui 优势：**
- 优秀的 WHO/FROM/TO/HERE JSDoc 文档（CC 缺少文件级文档）
- 清晰的 barrel exports 和模块组织
- 回归测试覆盖（image line 检测、regional indicator 宽度、overlay 样式泄漏）
- 多级调试（CATUI_DEBUG_RENDER/REDRAW/TUI_DEBUG）

**catui 弱点：**
- 字符串级渲染——比较渲染字符串做 diff 是 O(n) per line per frame，CC 比较 packed 64-bit 整数（cache-friendly，可 SIMD 优化）
- 无布局和渲染分离——每个组件同时负责两者（CC 分离为 yoga layout → output rendering → screen diffing 三阶段）
- 手动 ANSI 解析（regex）——CC 使用 `@alcalzone/ansi-tokenize` 正确处理所有 ANSI 序列类型
- `visibleWidth()` 缓存无大小限制——CC 的 `charCache` 超过 16384 条目时清空

### 汇总

| 严重度 | 数量 |
|--------|------|
| HIGH | 3（无事件系统、无布局引擎、无虚拟滚动） |
| MEDIUM | 6（ANSI 剥离不完整、tab 硬编码、startsWith 过滤、无崩溃恢复、stop 不排空、cellSize 无超时、bgFn 采样） |
| LOW | 5（Spacer 空字符串、Input prompt 硬编码、Text 空文本、doRender 崩溃、非 TTY、SIGCONT） |

**优先修复项：**
1. **HIGH**: 修复 `visibleWidth()` ANSI 剥离——使用完整的 ANSI 解析库或扩展 regex 覆盖所有 CSI 序列
2. **HIGH**: Tab 宽度改为 8 空格（标准 tab-stop）或实现 tab-stop 对齐
3. **HIGH**: Select-list 改为子串/fuzzy 匹配
4. **MEDIUM**: `ProcessTerminal.stop()` 添加 `drainInput()` 调用
5. **MEDIUM**: 添加 SIGINT/SIGTERM 信号处理器恢复终端状态

**注意：** 布局引擎、事件系统、虚拟滚动等是架构级差距，需要长期规划而非简单修复。

---

## 2026-06-12 — Config/Settings 系统扫描

扫描范围：`core/platform/config/settings-manager.ts` (1309行), `auth-storage.ts`, `resolve-config-value.ts`, `resource-loader.ts`, `config.ts`, 对照 CC `src/utils/settings/` (12文件) + `src/utils/config.ts` (1824行)

### 架构对比

catui 使用 2 层配置（global + project）+ 单一 `SettingsManager` 大类（1309 行）。CC 使用 5 层配置 cascade（user→project→local→flag→policy）+ 12 文件精细分离（types/cache/validation/changeDetector/mdm）+ Zod v4 schema 验证。

### 1. 正确性缺陷

| 严重度 | 发现 |
|--------|------|
| **HIGH** | **`resolveConfigValue` 将环境变量未设置误作字面字符串。** `resolve-config-value.ts:22`：`process.env[config]` 未设置时返回 config 本身（如 `"MY_API_KEY"`）而非 `undefined`。API key 字段会静默使用变量名作为 key，产生混淆的 401 错误。空字符串 env var 也因 `||` 被视为"未设置"。 |
| **HIGH** | **Settings.json 无 schema 验证。** `settings-manager.ts:429` 直接 `JSON.parse` + `as Settings` 类型断言。拼写错误（`"defaltProvider"`/`"showImags"`）被静默忽略，用户无反馈。CC 使用 Zod v4 + `.safeParse()` + 人类可读错误+建议+文档链接。 |
| **MEDIUM** | **`deepMergeSettings` 仅合并一层。** `settings-manager.ts:162-190` 浅展开 `{...base, ...override}`。当前两层嵌套刚好正确，但三层嵌套（如 `settings.nanomem.autoDream.enabled`）会丢失 base 值。CC 用 `lodash.mergeWith` 真正递归深合并。 |
| **LOW** | **`getClearOnShrink` 读取旧 env var 前缀。** `settings-manager.ts:1147` 使用 `PI_CLEAR_ON_SHRINK`（旧前缀），其余代码用 `CATUI_*`。迁移未完成。 |

### 2. 缺陷

| 严重度 | 发现 |
|--------|------|
| **HIGH** | **无配置文件变更监听。** 无 chokidar/fs.watch。多实例（两个终端）修改 settings.json 时互相无感知，静默不一致。CC 有 `changeDetector.ts` (489行)：chokidar 监听+写入稳定性阈值(1s)+删除宽限期(1.7s)+自写检测(5s)+ConfigChange hooks。 |
| **HIGH** | **无配置写入前备份。** 直接覆盖写入，断电/崩溃时永久丢失。CC 每次写入前创建时间戳备份（`~/.claude/backups/`），保留最近 5 个，损坏文件单独备份（`.corrupted.*`）并提供恢复指令。 |
| **HIGH** | **无损坏恢复。** JSON 解析失败时静默回退到默认值，用户无通知，无备份恢复尝试。CC 的恢复流程：备份损坏文件→搜索最近备份→stderr 输出恢复指令→记录分析事件→`wouldLoseAuthState` 守卫防止覆盖好的缓存配置。 |
| **MEDIUM** | **`withLock` 首次创建竞态。** `settings-manager.ts:214-242` 仅在文件存在时加锁。两个进程首次创建 settings.json 时都跳过锁，同时写入，一个丢失。`withLockAsync` 使用 `lockfile.lockSync` 阻塞事件循环。 |
| **MEDIUM** | **SettingsManager 1309 行 God class。** 合并了类型定义、深合并、文件存储、内存存储、迁移逻辑、40+ getter/setter。CC 拆分为 12 个文件各司其职。 |
| **LOW** | **Setter 代码大量重复。** ~30 个 setter 遵循相同模式（初始化嵌套对象→赋值→markModified→save）。可用 `setNestedField(scope, path, value)` 辅助函数消除。 |

### 3. 高可用性

| 项目 | catui | CC | 评价 |
|------|-----------|-----|------|
| 配置源层数 | 2（global/project） | 5（user/project/local/flag/policy） | **CC 优势** |
| Schema 验证 | 无（JSON.parse + as） | Zod v4 + safeParse + 错误消息+建议+文档链接 | **CC 压倒性优势** |
| 文件变更监听 | 无 | chokidar + 写入稳定性+删除宽限+自写检测 | **CC 压倒性优势** |
| 写入备份 | 无 | 时间戳备份+最近 5 个+损坏隔离 | **CC 压倒性优势** |
| 损坏恢复 | 静默回退默认值 | 备份损坏→搜索最近→恢复指令→守卫 | **CC 优势** |
| MDM/企业策略 | 无 | macOS plist/Windows registry/远程托管 | **CC 优势** |
| 缓存架构 | 无缓存（每次读磁盘） | 三级缓存（session/source/file） | **CC 优势** |
| 本地覆盖 | 无 localSettings | `localSettings` 自动加入 .gitignore | **CC 优势** |
| 配置工具 | 无 | ConfigTool（LLM 读写配置） | **CC 优势** |
| Storage 接口 | `SettingsStorage` 接口+InMemory 实现 | 无等价抽象 | **catui 优势** |
| 文档 | WHO/FROM/TO/HERE JSDoc | 向后兼容性文档 | 持平 |

### 4. CC 功能差距

| 功能 | CC | catui |
|------|-----|-----------|
| Zod schema 验证 | 100+ 字段+类型强制+枚举+regex+自定义验证器 | 无 |
| 5 层配置 cascade | user→project→local→flag→policy | 2 层（global/project） |
| 文件变更监听 | chokidar+debounce+grace periods+内部写检测 | 无 |
| 配置备份+恢复 | 时间戳备份+损坏隔离+恢复指令 | 无 |
| MDM 企业策略 | macOS plist/Windows registry/远程托管 | 无 |
| ConfigChange hooks | 设置变更前后钩子 | 无 |
| 验证错误消息 | 人类可读+建议+文档链接 | 无 |
| Gitignore 自动添加 | localSettings 自动加入 .gitignore | 无 |
| ConfigTool | LLM 通过工具读写设置 | 无 |
| Auth-loss 守卫 | 检测损坏读取，拒绝覆盖 | 无 |
| Settings with sources API | `getSettingsWithSources()` 显示来源 | 无 |
| Schema JSON URL | 发布到 schemastore.org 供 IDE 自动补全 | 无 |
| 三级缓存 | session/source/file 级缓存 | 无 |
| `--setting-sources` CLI | 过滤活动源 | 无 |
| Cowork 模式 | 独立 `cowork_settings.json` | 无 |
| 远程托管设置 | API 获取企业设置 | 无 |
| 重入守卫 | `insideGetConfig` 防无限递归 | 无 |

### 5. 代码质量对比

**catui 优势：**
- `SettingsStorage` 接口+`InMemorySettingsStorage` 测试实现（仓库模式）
- 每个设置有专用 getter/setter（明确可审计）
- WHO/FROM/TO/HERE JSDoc 文档

**catui 弱点：**
- SettingsManager 1309 行 God class
- ~30 个 setter 大量重复代码
- `save()` vs `saveProjectSettings()` 不对称
- 混合同步/异步无清晰策略（`withLockAsync` 内部用 `lockSync` 阻塞事件循环）

**CC 弱点：**
- `config.ts` 1824 行单体文件
- `GlobalConfig` 类型 100+ 字段（许多是一次性追踪标志）

### 汇总

| 严重度 | 数量 |
|--------|------|
| HIGH | 4（resolveConfigValue 误返回、无 schema 验证、无文件监听、无备份/恢复） |
| MEDIUM | 3（深合并仅一层、withLock 竞态、SettingsManager 过大） |
| LOW | 2（旧 env var 前缀、setter 重复） |

**优先修复项：**
1. **CRITICAL**: 修复 `resolveConfigValue`——env var 未设置时返回 `undefined`，空字符串也应视为有效值
2. **CRITICAL**: 添加 Settings Zod schema 验证——至少验证字段存在性和类型
3. **HIGH**: 写入前创建备份（至少保留最近 1 个）
4. **HIGH**: 添加 chokidar 文件变更监听（至少支持多实例同步）
5. **HIGH**: 损坏恢复——JSON 解析失败时搜索备份并通知用户

---

## 2026-06-12 — LLM 通信层扫描

扫描范围：`core/lib/ai/src/`（stream.ts, api-registry.ts, types.ts, utils/event-stream.ts, providers/*.ts, overflow.ts, debug-logger.ts），对照 CC `src/services/api/claude.ts` (3400行) + `withRetry.ts` (823行) + `errors.ts` (1208行) + `errorUtils.ts` + `client.ts`

### 架构对比

catui 使用模块化 provider 架构：每个 provider 独立文件+统一接口+懒加载注册。CC 使用单体 `claude.ts`（3400行）+ 独立重试/错误分类/客户端构造文件。catui 架构更清洁，但 CC 的错误处理和重试逻辑远更完善。

### 1. 正确性缺陷

| 严重度 | 发现 |
|--------|------|
| **CRITICAL** | **重试时丢弃部分事件。** `stream.ts:396-399`：`if (attempt === 0) { outerStream.push(event); }` 重试时不转发中间事件。消费者看到事件中途停止，无终止事件，然后什么都没有，直到重试成功或终止。无重试进行中的信号。CC 在 API 调用级别重试，部分结果从不到达消费者。 |
| **HIGH** | **`mapStopReason` 对未知值 throw。** `anthropic.ts:916`：注释说"handle gracefully"但代码 throw Error，会崩溃流并产生用户错误消息。 |
| **HIGH** | **OpenAI `mapStopReason` 的 `never` 检查。** `openai-completions.ts:907-911`：`const _exhaustive: never = reason; throw`。OpenAI 定期添加新 `finish_reason` 值，会直接崩溃流。 |
| **MEDIUM** | **Bedrock `mapStopReason` 静默映射未知值为 "error"。** `amazon-bedrock.ts:688`：避免崩溃但用户看到错误而非正常处理。 |

### 2. 缺陷

| 严重度 | 发现 |
|--------|------|
| **HIGH** | **无 HTTP 级错误分类。** 重试逻辑用 regex 匹配错误消息字符串。CC 有 40+ 具体错误分类分支：SSL/TLS 证书错误、HTTP 状态码（401/403/408/413/429/529 等子类别）、Provider 特定错误（Bedrock/Vertex/Azure auth）、内容错误（prompt too long/PDF/image size）、CloudFlare HTML 清理、OAuth token 撤销检测。 |
| **HIGH** | **无 401 auth token 刷新。** CC 在 401/403 时自动刷新 OAuth token 并重建客户端。catui 用过期 token 重试，浪费重试次数。 |
| **HIGH** | **无过期连接检测。** CC 检测 ECONNRESET/EPIPE 禁用连接池。catui 用同一池化连接重试。 |
| **MEDIUM** | **无 529 过载专项处理。** CC 有连续错误追踪+fallback 模型触发+持久重试模式+fast-mode 冷却。catui 当作普通可重试错误。 |
| **MEDIUM** | **无 `x-should-retry` 响应头。** CC 读取此头决定是否重试。catui 完全忽略响应头。 |
| **MEDIUM** | **无 context overflow 自动恢复。** CC 检测 `max_tokens` 溢出后自动调整参数重试。catui 检测到但不重试。 |
| **MEDIUM** | **无速率限制头解析。** CC 读取 `anthropic-ratelimit-unified-reset` 等待实际重置时间。catui 无速率限制感知。 |
| **LOW** | **`debug-logger.ts` 使用同步 `appendFileSync`。** 每次日志调用阻塞事件循环。`rotateIfNeeded` 用 `require("fs")` 而非已导入的 `fs`。 |

### 3. 高可用性

| 项目 | catui | CC | 评价 |
|------|-----------|-----|------|
| 最大重试次数 | 3 | 10（可配置） | **CC 优势** |
| 529 过载处理 | 通用可重试 | 连续追踪+fallback+持久模式+fast-mode | **CC 压倒性优势** |
| Auth token 刷新 | 无 | 401/403 自动刷新 OAuth | **CC 压倒性优势** |
| 过期连接处理 | 无 | ECONNRESET/EPIPE 检测+禁用连接池 | **CC 优势** |
| Context overflow | 检测但不恢复 | 自动调整 max_tokens 重试 | **CC 优势** |
| 模型 fallback | 无 | Opus→Sonnet 持续 529 降级 | **CC 优势** |
| 速率限制头 | 无 | 读取 `anthropic-ratelimit-*` | **CC 优势** |
| 持久/无人重试 | 无 | 无限重试+心跳+6 小时重置 | **CC 优势** |
| 错误分类 | 字符串匹配 | 40+ 具体类型+人类可读消息 | **CC 压倒性优势** |
| Provider 架构 | 模块化+懒加载+统一接口 | 单体 claude.ts | **catui 优势** |
| 类型安全 | TypeScript 泛型 | 类型安全但耦合 Anthropic | 持平 |

### 4. CC 功能差距

| 功能 | CC | catui |
|------|-----|-----------|
| 529 过载处理 | 连续追踪+fallback 模型+持久重试+fast-mode | 通用可重试 |
| Auth token 刷新 | OAuth 401 自动刷新+客户端重建 | 无 |
| 过期连接检测 | ECONNRESET/EPIPE+连接池禁用 | 无 |
| Context overflow 恢复 | 自动调整 max_tokens 重试 | 检测不恢复 |
| 模型 fallback | Opus→Sonnet 持续 529 | 无 |
| 速率限制头 | `anthropic-ratelimit-unified-reset` | 无 |
| 持久无人重试 | 无限重试+心跳+5 分钟退避+6 小时重置 | 无 |
| 40+ 错误分类 | SSL/HTTP/Provider/Content/OAuth | 字符串 regex |
| CloudFlare HTML 清理 | 错误页面→可读消息 | 无 |
| 流式 VCR/录制 | `withStreamingVCR` 回放 | 无 |
| 客户端请求 ID | UUID 超时关联 | 无 |
| API 超时配置 | `API_TIMEOUT_MS` 环境变量 | SDK 默认 |
| Prompt cache 断裂检测 | 记录 cache 状态，检测断裂 | 无 |
| Microcompact/自适应上下文 | API 上下文管理 | 无 |
| Tool use/result 配对验证 | `ensureToolResultPairing` 去重 | 仅 transform-messages |
| 快速模式 | 速度切换+冷却 | 无 |
| Anti-distillation | 假 tool 注入 | 无 |

### 5. 代码质量对比

**catui 优势：**
- 模块化 provider 架构：每个 provider 独立文件+统一接口
- TypeScript 泛型类型安全（`Model<TApi>`, `StreamFunction<TApi, TOptions>`）
- 懒加载 provider 注册
- `EventStream` 类设计良好（异步迭代+final-result 追踪）
- `overflow.ts` 检测全面（14+ provider 特定模式）
- WHO/FROM/TO/HERE JSDoc 文档

**catui 弱点：**
- `stream.ts` 重试包装器复杂且有部分事件丢弃 bug
- 错误处理薄弱——错误仅字符串化推送
- `debug-logger.ts` 同步 `appendFileSync` 阻塞事件循环
- 无结构化错误类型——一切为 `AssistantMessage` + `errorMessage: string`

**CC 弱点：**
- `claude.ts` 3400 行单体
- 耦合 Anthropic 特定 API 和 beta headers
- feature-flag 条件散布

### 汇总

| 严重度 | 数量 |
|--------|------|
| CRITICAL | 1（重试丢弃部分事件） |
| HIGH | 4（mapStopReason throw×2、无错误分类、无 auth 刷新、无过期连接检测） |
| MEDIUM | 4（529 无专项、无 x-should-retry、无 overflow 恢复、无速率限制头） |
| LOW | 1（同步日志） |

**优先修复项：**
1. **CRITICAL**: 修复重试时部分事件丢弃——重试前发送"重试中"信号或缓冲完整流
2. **HIGH**: `mapStopReason` 对未知值降级为 `"end_turn"` 而非 throw
3. **HIGH**: 添加 401/403 auth token 刷新（至少支持 OAuth provider）
4. **HIGH**: 添加结构化错误分类（至少区分 401/429/529/network）
5. **MEDIUM**: 重试次数从 3 提升到 10
6. **MEDIUM**: 添加 529 连续追踪+模型 fallback

---

## 2026-06-12 — Agent Core 主循环扫描

扫描范围：`core/lib/agent-core/src/`（agent-loop.ts 1158行, agent.ts 737行, types.ts 463行, errors.ts 201行, continuations.ts, tool-results.ts, stream-events.ts, structured-adaptive-*.ts）+ `core/runtime/`（agent-session.ts, compaction-controller.ts, retry-coordinator.ts），对照 CC `src/query.ts` (1736行) + `src/QueryEngine.ts` + `src/utils/conversationRecovery.ts` (598行) + `src/query/stopHooks.ts`

### 架构对比

catui 有两套循环：标准 `agent-loop.ts`（1158行）和 `structured-adaptive-agent-loop.ts`（弱模型兼容）。CC 有 `query.ts`（1736行）+ 独立模块（stopHooks/toolOrchestration/StreamingToolExecutor/transitions）。catui 错误层次更优（AgentError 类层次 vs CC 的字符串匹配），但 CC 的上下文管理远更完善。

### 1. 正确性缺陷

| 严重度 | 发现 |
|--------|------|
| **MEDIUM** | **`endWithLoopError()` 缺少 `turn_end` 事件。** `agent-loop.ts:190-218`：错误路径发射 `message_start`/`message_end` 但不发射 `turn_end`，导致 `agent_result` 事件携带 `turnCount:0`/`toolCallCount:0`，即使已执行多轮。正常路径（line 500）始终发射 `turn_end`。 |
| **MEDIUM** | **`isStreaming` 守卫非重入安全。** `agent.ts:476`：`prompt()` 检查 `isStreaming` 后 throw，但无锁。两个并发 `prompt()` 调用在微任务中可同时通过检查。CC 用单线程 generator 模式避免。 |
| **MEDIUM** | **`waitForAssistantStream` abort 时可能泄漏资源。** `agent-loop.ts:709-717`：返回 "aborted" 时不调用 `responseIterator.return()`。对比 line 750 的逐事件 abort 有显式清理。流迭代器可能未正确清理。 |
| **LOW** | **`resolveRunningPrompt` 内存保留风险。** `agent.ts:548-549`：若 `_runLoop` 在 finally 前抛出异常，promise 永不 settle，`waitForIdle()` 永久挂起。 |

### 2. 缺陷

| 严重度 | 发现 |
|--------|------|
| **HIGH** | **无响应式压缩（reactive compaction）。** CC 的 `reactiveCompact` 在 413/prompt-too-long 时压缩上下文立即重试，支持多层策略（context collapse drain → reactive compact → surface error）。catui 仅有手动压缩+API 调用前检查，`recoverModelError` 最多重试 1 次。 |
| **HIGH** | **无多层上下文管理。** CC 有 snipCompact（历史裁剪）+ microcompact（tool-result 级压缩）+ contextCollapse（旧消息归档）+ autoCompact。catui 仅有全量压缩。长 session 中 tool results 仅截断不总结。 |
| **HIGH** | **无会话恢复中断检测。** CC 的 `deserializeMessagesWithInterruptDetection()` 检测 session 中断轮次并注入 "Continue from where you left off" 合成消息。catui 有 session 持久化但无中断检测。 |
| **MEDIUM** | **标准循环无流式工具执行。** CC 的 `StreamingToolExecutor` 在流式传输期间就开始执行工具。catui 标准循环等待完整响应后批量执行（line 936-1060）。仅 structured-adaptive 路径有早期执行。 |
| **MEDIUM** | **无 fallback 模型。** CC 的 `FallbackTriggeredError` 在模型过载时自动切换。catui 仅通过 `recoverModelError` 单次重试。 |
| **MEDIUM** | **无 529 指数退避重试。** CC 有 10 次重试+指数退避+前台/后台策略+无人值守模式。catui 的 `RetryCoordinator` 较简单。 |
| **LOW** | **无 tool-result 持久化替换。** CC 的 `toolResultStorage` 用引用替换大结果并持久化。catui 恢复 session 时需全量保留在内存。 |
| **LOW** | **无文件历史快照。** CC 保存 `FileHistorySnapshot` 恢复文件状态缓存。catui 无文件状态缓存。 |

### 3. 高可用性

| 项目 | catui | CC | 评价 |
|------|-----------|-----|------|
| 响应式压缩 | 无（仅手动+预检查） | 413 时自动压缩+多层策略 | **CC 压倒性优势** |
| 多层上下文 | 全量压缩 | snip/micro/contextCollapse/auto | **CC 压倒性优势** |
| 会话恢复 | SessionManager 持久化 | 中断检测+"Continue"注入 | **CC 优势** |
| 流式工具执行 | 仅弱模型路径 | 标准路径支持 | **CC 优势** |
| Fallback 模型 | 无 | 自动切换 | **CC 优势** |
| 重试策略 | 基本重试 | 10 次+指数退避+per-source 策略 | **CC 优势** |
| Tool-result 预算 | 截断 | 引用替换+持久化 | **CC 优势** |
| 错误层次 | AgentError 类层次 | 字符串匹配 | **catui 优势** |
| 类型系统 | 显式 Transition/Policy/Result 类型 | 散布在各处 | **catui 优势** |
| 多 Provider | streamProxy+多 provider | 仅 Anthropic | **catui 优势** |
| 能力接口 | 窄 capability interfaces（DI） | 大 context 对象直接传递 | **catui 优势** |

### 4. CC 功能差距

| 功能 | CC | catui |
|------|-----|-----------|
| 响应式压缩 | 413 时自动压缩+多层恢复 | 无 |
| Microcompact | tool-result 级智能压缩 | 仅截断 |
| Context collapse | 旧消息渐进归档 | 无 |
| Snip compact | 历史裁剪 | 无 |
| 流式工具执行 | 标准路径流式期间执行 | 仅弱模型路径 |
| Fallback 模型 | 自动模型切换+签名剥离 | 无 |
| 529/429 指数退避 | 10 次+退避+per-source 策略 | 基本 |
| 会话恢复中断检测 | `detectTurnInterruption` | 无 |
| Tool-result 预算 | 内容替换+磁盘持久化 | 截断 |
| 文件历史快照 | `FileHistorySnapshot` | 无 |
| Session 记忆提取 | extractMemories+autoDream | 无 |
| Prompt 建议 | 有 | 无 |
| Skill 发现预取 | 有 | 无 |

### 5. 代码质量对比

**catui 优势：**
- `AgentError` 类层次（NetworkError/RateLimitError/ContextOverflowError 等）+ `classifyApiError()` + `retriable` 标志
- 显式类型定义（AgentLoopTransition/AgentRunPolicy/AgentRunResult）
- 能力接口模式（`session-context.ts` 窄接口替代完整 AgentSession）
- WHO/FROM/TO/HERE JSDoc 文档

**catui 弱点：**
- `agent-loop.ts` 1158 行处理一切（循环控制+工具执行+流式+错误恢复+后续+转向+stop hooks+token 预算）
- 标准循环用 `let` 变量追踪状态（CC 用 State 对象+immutable-at-boundary）
- 标准循环无流式工具执行（仅弱模型路径有）

### 汇总

| 严重度 | 数量 |
|--------|------|
| HIGH | 3（无响应式压缩、无多层上下文、无会话恢复中断检测） |
| MEDIUM | 5（turn_end 缺失、isStreaming 竞态、abort 泄漏、无流式工具、无 fallback、无 529 退避） |
| LOW | 3（resolveRunningPrompt、tool-result 持久化、文件历史快照） |

**优先修复项：**
1. **HIGH**: 实现响应式压缩——413/prompt-too-long 时自动压缩并重试
2. **HIGH**: 标准循环支持流式工具执行（tool_use 块到达时即开始执行）
3. **HIGH**: 添加会话恢复中断检测（resume 时检测中断轮次+注入继续消息）
4. **MEDIUM**: 修复 `endWithLoopError()` 发射 `turn_end` 事件
5. **MEDIUM**: 添加 fallback 模型机制
6. **MEDIUM**: 重试策略升级为 10 次+指数退避

**注意：** catui 在错误层次、类型系统、多 Provider 支持方面优于 CC，这些是架构优势应保持。

---

## 2026-06-12 — Prompt 构建 / System Message 系统扫描

扫描范围：`core/prompt/system-prompt.ts` (325行), `core/runtime/prompt-assembly.ts`, `core/prompt/prompt-templates.ts`, `core/sub-agent/agent-prompt-builder.ts`, `core/session/compaction/compaction.ts`, 对照 CC `src/constants/prompts.ts` (~915行) + `src/utils/systemPrompt.ts` + `src/utils/systemPromptSections.ts` + `src/services/compact/prompt.ts` + `src/services/SessionMemory/prompts.ts`

### 架构对比

catui 使用扁平管线：单一 `buildSystemPrompt()` 函数（325行）+ `.md` 模板系统。CC 使用深度分层+缓存感知架构：~20 个 section 函数+5 级优先级 cascade（override>coordinator>agent>custom>default）+ memoized section+静态/动态边界标记+session memory 系统。

### 1. 正确性缺陷

| 严重度 | 发现 |
|--------|------|
| **MEDIUM** | **`customPrompt` 路径忽略 extension tool guidance。** `system-prompt.ts:80-112`：当 `customPrompt` 存在时，`extensionToolsGuidance` 参数被接受但从未注入。扩展提供的工具指导在自定义 prompt（如 pencil.md）激活时丢失。 |
| **MEDIUM** | **Extension 工具名称冲突无验证。** `system-prompt.ts:128-138`：扩展工具若与内置工具同名，内置描述静默胜出。无名称唯一性验证。 |
| **LOW** | **`parseCommandArgs` 不支持反斜杠转义。** `prompt-templates.ts:28-59`：处理单/双引号但无 `\` 转义支持。 |

### 2. 缺陷

| 严重度 | 发现 |
|--------|------|
| **HIGH** | **无 prompt cache 感知。** CC 有 `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` 标记分离静态（可全局缓存）vs 动态内容+`systemPromptSection()` memoization+`shouldUseGlobalCacheScope()`。catui 每轮从头重建完整 prompt，无法利用 Anthropic prompt caching，API 成本显著增加。 |
| **HIGH** | **无 token 预算/上下文窗口感知。** `buildSystemPrompt()` 构建单一字符串无 token 估计。CC 有 `getCharBudget()` + `formatCommandsWithinBudget()` 截断 skill 列表到 1% 上下文窗口。catui 的 `formatSkillsForPrompt()` 无大小限制，大量 skills 时可能消耗大量上下文。 |
| **MEDIUM** | **压缩 prompt 缺少 "no tools" 前言。** CC 的 compact prompt 包含 `CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.`。catui 的 `compaction.ts:443` 无此警告，模型可能在总结时尝试工具调用。 |
| **MEDIUM** | **无 `formatCompactSummary()` 后处理。** CC 剥离 `<analysis>` 标签+替换 `<summary>` 为可读标题。catui 返回原始模型输出。 |
| **MEDIUM** | **`buildSystemPrompt` 同步阻塞。** CC 的 `getSystemPrompt()` async 并行调用 skills/env/settings。catui 同步构建，无法并行加载 memory、计算 env info。 |
| **LOW** | **customPrompt 路径 section 顺序/条件不一致。** skill section 的门控条件在 custom 和 default 路径间微妙不同。 |

### 3. 高可用性

| 项目 | catui | CC | 评价 |
|------|-----------|-----|------|
| Prompt caching | 无感知，每轮全量重建 | 静态/动态边界+memoized section+cache scope | **CC 压倒性优势** |
| Session memory | 无 | 9 结构化 section+自定义模板+token 预算 | **CC 压倒性优势** |
| 压缩元数据 | 原始 summary | transcript 路径+保留消息标记+继续指令 | **CC 优势** |
| 部分压缩 | 仅全量 | full/partial(from/to)/partial_up_to | **CC 优势** |
| 环境信息 | 日期+工作目录 | git 状态+平台+shell+OS+model+knowledge cutoff | **CC 优势** |
| 模板系统 | `.md` 文件+frontmatter | 函数式 section+testable | 持平 |
| I18n | 中英文扩展 prompt | 仅英文 | **catui 优势** |

### 4. CC 功能差距

| 功能 | CC | catui |
|------|-----|-----------|
| Prompt cache 感知 | 静态/动态边界+memoized section+cache scope | 无 |
| 5 级优先级 cascade | override>coordinator>agent>custom>default | 二元（custom/default） |
| 品牌 SystemPrompt 类型 | `asSystemPrompt()` 不可变数组 | 普通字符串 |
| 环境信息 section | git/平台/shell/OS/model/knowledge cutoff | 日期+目录 |
| Session memory | 9 结构化 section+自定义模板 | 无 |
| 语言偏好 | `getLanguageSection()` | 无 |
| 输出样式系统 | `getOutputStyleSection()` | 无 |
| 网络风险指令 | `CYBER_RISK_INSTRUCTION` | 无 |
| 操作谨慎 section | 可逆性+爆炸半径+确认时机 | 极简指导 |
| system-reminder 标签感知 | 显式告知模型 | 无 |
| Scratchpad 目录 | session 专用临时目录 | 无 |
| MCP 指令 | `getMcpInstructionsSection()` | 无 |
| Function result 清除 | `getFunctionResultClearingSection()` | 无 |
| 主动/自主模式 prompt | 详细自主工作指令 | grub 扩展部分覆盖 |
| Knowledge cutoff | 告知模型截止日期 | 无 |
| Tool 反模式指导 | "When NOT to use" 详细说明 | 极简 |
| Brief 模式 | `BRIEF_PROACTIVE_SECTION` | 无 |
| Token budget prompt | 告知模型目标 token 数 | 无 |
| Fork 子代理指导 | "When to fork"/"Don't peek"/"Don't race" | 仅 notes 注入 |
| Skill 预算截断 | `formatCommandsWithinBudget()` 1% 上下文 | 无限制 |
| 记忆提取 prompt | 结构化记忆+MEMORY.md 索引 | 无 |
| 压缩 no-tools 前言 | `CRITICAL: TEXT ONLY` | 无 |
| 压缩后处理 | 剥离 analysis 标签+格式化 | 原始输出 |
| Section 并行解析 | `resolveSystemPromptSections()` 并行+缓存 | 同步全量 |

### 5. 代码质量对比

**catui 优势：**
- WHO/FROM/TO/HERE JSDoc 文档
- `.md` 模板+frontmatter 系统灵活
- 扩展 prompt 有良好 i18n 支持（teach/grub）
- XML 转义（`escapeXml()`）正确

**catui 弱点：**
- `buildSystemPrompt()` 325 行单体函数+两条代码路径
- 无 prompt 内容测试覆盖（仅一个 soul 测试文件）
- 硬编码 prompt 字符串（CC 拆分为 15+ 可测试函数）
- 无 `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` 概念
- `docs/prompt-templates.md` 全部 TODO

**CC 弱点：**
- `prompts.ts` 915 行 section 函数虽分解但仍庞大
- 某些 section 命名不一致（`getSimpleDoingTasksSection` vs `getActionsSection`）

### 汇总

| 严重度 | 数量 |
|--------|------|
| HIGH | 2（无 prompt cache 感知、无 token 预算） |
| MEDIUM | 4（customPrompt 忽略扩展工具、名称冲突无验证、压缩无 no-tools、无后处理、同步阻塞） |
| LOW | 2（转义支持、section 条件不一致） |

**优先修复项：**
1. **HIGH**: 实现 prompt cache 感知——至少分离静态/动态边界，静态部分每轮复用
2. **HIGH**: 添加 token 预算——skill 列表截断到上下文窗口的 1%
3. **MEDIUM**: 压缩 prompt 添加 `NO_TOOLS_PREAMBLE`
4. **MEDIUM**: 压缩结果后处理——剥离 analysis 标签
5. **MEDIUM**: 修复 `customPrompt` 路径注入 extension tool guidance
6. **MEDIUM**: 添加环境信息 section（git 状态+平台+shell+OS+model）

**已完成 21 轮扫描。** 所有核心子系统已覆盖。

---

## 2026-06-12 — Tool 注册/管理框架扫描

扫描范围：`core/tools/orchestrator.ts` (135行), `core/runtime/tool-runtime-controller.ts`, `core/extensions-host/wrapper.ts`, `core/extensions-host/loader.ts`, `core/lib/agent-core/src/types.ts` (AgentTool 定义), `core/lib/agent-core/src/structured-adaptive-tool-orchestration.ts`, 对照 CC `src/Tool.ts` (~40 方法), `src/tools.ts`, `src/services/tools/toolExecution.ts` (1750行), `src/services/tools/toolHooks.ts`, `src/services/tools/toolOrchestration.ts`, `src/utils/toolResultStorage.ts` (1040行), `src/utils/toolSearch.ts`, `src/utils/toolSchemaCache.ts`

### 架构对比

catui 工具框架分层清晰（agent-core/types → extensions-host/types → orchestrator → tool-runtime-controller），但 `ToolOrchestrator` 仅 135 行 Map 包装器。CC 有 12 文件深度集成：执行管线 1750 行、hook 系统、权限模型、结果持久化 1040 行、延迟工具发现、schema 缓存。

### 1. 正确性缺陷

| 严重度 | 发现 |
|--------|------|
| **MEDIUM** | **`registerTool` 静默覆盖同名工具。** `orchestrator.ts:104`：`this._toolRegistry.set(name, tool)` 无碰撞检测或警告。CC 的 `assembleToolPool` 用 `uniqBy` 保留首个注册工具+MCP 去重日志。 |
| **MEDIUM** | **默认活跃工具列表硬编码。** `tool-runtime-controller.ts:126-128`：`["read", "bash", "edit", "write", "time"]` 写死 5 个。新增基础工具需手动更新。CC 动态从 `getAllBaseTools()` + `isEnabled()` 构建。 |
| **MEDIUM** | **扩展工具无名称前缀强制。** `loader.ts:156`：直接存储 `definition.name`，可能与基础工具碰撞。CC 用 `mcp__<server>__<tool>` 前缀防止碰撞。 |
| **LOW** | **`replaceTools` 静默裁剪过期活跃工具。** `orchestrator.ts:50-56`：新工具集不包含旧活跃名时静默丢弃，无日志。 |

### 2. 缺陷

| 严重度 | 发现 |
|--------|------|
| **HIGH** | **无 input schema 校验。** CC 在每次工具调用前用 Zod `safeParse` 校验，返回结构化错误（哪个参数错、什么类型、期望什么）。catui 仅有基础 `validateToolArguments()`，无丰富错误消息供模型修正。 |
| **HIGH** | **无工具结果磁盘持久化。** CC 的 `toolResultStorage.ts` (1040行) 超限时保存到磁盘+预览+路径引用。catui 仅截断，大结果永久丢失。 |
| **HIGH** | **无权限模型。** CC 有规则权限+hook 权限+交互提示+自动模式分类器+拒绝追踪+OTel 日志。catui 仅有基础 `canUseTool` 回调返回 allow/deny。 |
| **MEDIUM** | **扩展 wrapper 丢失非 Error 类型。** `wrapper.ts:123`：`throw new Error(message || String(err))` 包装任何非 Error 值为通用 Error，丢失原始类型。CC 保留 AbortError/ShellError/TelemetrySafeError。 |
| **MEDIUM** | **标准循环无 abort 信号检查。** CC 在每次工具执行前检查 `signal.aborted`。catui 标准循环的批量工具调用中，中断时剩余工具可能仍执行。 |
| **MEDIUM** | **无 prompt cache 优化。** CC 缓存 schema+排序工具池+内容替换状态。catui 每次重新渲染 schema，可能破坏 prompt cache。 |
| **LOW** | **`tools-manager.ts` 重复 JSDoc。** 第 31-32 行 `DEFAULT_NETWORK_TIMEOUT_MS` 有两个相同 JSDoc 块，复制粘贴残留。 |

### 3. 高可用性

| 项目 | catui | CC | 评价 |
|------|-----------|-----|------|
| 工具结果持久化 | 截断 | 磁盘保存+预览+路径引用+session 恢复 | **CC 压倒性优势** |
| 权限模型 | 基础回调 | 规则+hook+分类器+交互+拒绝追踪 | **CC 压倒性优势** |
| Hook 系统 | tool_call/tool_result | PreToolUse/PostToolUse/PostToolUseFailure/PermissionDenied | **CC 优势** |
| Schema 缓存 | 无 | session 级缓存防止 cache bust | **CC 优势** |
| 内容替换状态 | 无 | 跨 turn 字节一致重放保护 prompt cache | **CC 优势** |
| 延迟工具加载 | 无 | ToolSearchTool 按需发现 | **CC 优势** |
| 预算执行 | 逐工具截断 | 每消息 200K 总预算+最大持久化 | **CC 优势** |
| 扩展系统 | 4 层加载器+host-agnostic SDK | MCP 命名+连接生命周期 | 持平 |
| TypeBox schema | 运行时类型验证 | Zod | 持平 |

### 4. CC 功能差距

| 功能 | CC | catui |
|------|-----|-----------|
| ~40 方法 Tool 类型 | isReadOnly/isDestructive/isOpenWorld/checkPermissions/prompt()/toAutoClassifierInput 等 | ~8 属性 |
| 工具搜索/延迟加载 | ToolSearchTool 按需发现，支持数百 MCP 工具 | 无 |
| Pre/Post hook 系统 | allow/deny/ask+输入修改+继续阻止+失败 hook+PermissionDenied | tool_call/tool_result |
| 多层权限 | 规则权限+hook+分类器+交互+拒绝追踪 | 基础回调 |
| 结果磁盘持久化 | 超限保存+预览+路径引用 | 截断 |
| Prompt cache 优化 | schema 缓存+排序工具池+内容替换状态 | 无 |
| 每消息预算 | 200K 总预算 | 逐工具截断 |
| 拒绝规则预过滤 | 模型可见前移除被拒工具 | 仅 activeToolNames |
| 协调器模式工具过滤 | COORDINATOR_MODE_ALLOWED_TOOLS 等 | canUseTool 回调 |
| MCP 原生集成 | mcp__server__tool 命名+连接生命周期+auth 恢复 | 扩展包装 |
| Tool 预设 | --tools flag+预设 | 无 |
| Feature-gated 注册 | bun:bundle feature() 死代码消除 | 无条件注册 |
| 集中常量 | toolLimits.ts 50K/100K/400K/200K | 分散 |

### 5. 代码质量对比

**catui 优势：**
- 清晰的关注点分离（4 层架构）
- 扩展系统设计良好（4 层加载器+host-agnostic SDK）
- TypeBox schema 运行时验证
- 结构化自适应循环的批处理逻辑清晰

**catui 弱点：**
- `ToolOrchestrator` 过薄（135 行 Map 包装器，无验证/碰撞检测/事件/生命周期）
- `ToolRuntimeController.build()` 60 行处理一切
- 扩展 wrapper 双重包装交互不清晰
- 硬编码默认工具列表
- 命名不一致（ToolDefinition/AgentTool/RegisteredTool/ToolInfo）

### 汇总

| 严重度 | 数量 |
|--------|------|
| HIGH | 3（无 schema 校验、无结果持久化、无权限模型） |
| MEDIUM | 5（名称覆盖、硬编码列表、无前缀、wrapper 类型丢失、无 abort 检查、无 cache 优化） |
| LOW | 2（replaceTools 静默裁剪、重复 JSDoc） |

**优先修复项：**
1. **HIGH**: 实现工具结果磁盘持久化（超限时保存+预览+路径引用）
2. **HIGH**: 添加 input schema 校验（Zod safeParse + 结构化错误消息）
3. **HIGH**: 实现基础权限模型（至少支持规则权限+交互提示）
4. **MEDIUM**: `registerTool` 添加碰撞检测+日志
5. **MEDIUM**: 默认活跃工具列表从注册表动态构建
6. **MEDIUM**: 扩展工具添加名称前缀防止碰撞

---

**已完成 22 轮扫描。** 工具框架已覆盖。

---

## Round 23 — Notification System（通知系统）

**扫描时间**: 2026-06-12
**扫描模块**: `modes/interactive/components/notification-queue.ts`, `interactive-mode.ts` (showStatus/showError/showWarning), `stream-render-controller.ts`
**对比**: CC `src/services/notifier.ts`, `src/ink/useTerminalNotification.ts`, `src/context/notifications.tsx`, `src/hooks/useNotifyAfterTimeout.ts`, `src/hooks/notifs/` (16 hooks)

### 1. 架构对比

| 维度 | catui | Claude Code |
|------|-----------|-------------|
| 框架 | 自定义 TUI（`@pencil-agent/tui`）命令式 `Container`/`Text` | React + Ink |
| 队列模型 | 多可见（同时 3 条），按优先级+时间排序 | 单条显示 + 优先级队列 |
| 去重策略 | key 替换 | key 去重 + `fold` 合并器 + `invalidates` |
| 渲染 | `Text` 组件通过 `tui.requestRender()` | React state 驱动 |
| 桌面通知 | 无 | 多通道（iTerm2/Kitty/Ghostty/BEL）自动检测 |
| 空闲检测 | 无 | `useNotifyAfterTimeout` 6 秒阈值 |
| 进度条 | 无 | OSC 9;4 终端进度条 |
| 通知钩子 | 无 | 16+ 专用钩子（rate limit, deprecation, MCP, LSP 等） |
| 扩展 API | `notify(message, type)` → 委托 showStatus | `addNotification(Notification)` 完整队列集成 |
| 后台任务通知 | 无（task panel 存在） | `collapseBackgroundBashNotifications` 合并 |
| 状态消息风格 | 聊天内文本 5s 自动消失 | Prompt footer overlay + 队列 |

### 2. 正确性缺陷

**Defect 1 — `scheduleDismiss` 忽略自定义 `duration`（BUG）**
`notification-queue.ts` L126-131：`scheduleDismiss` 始终使用 `PRIORITY_DURATION[item.priority]`，即使 `options.duration` 已设置。dedup 替换路径（L86-96）重新调度时丢失自定义 duration，导致通知提前或延迟消失。

**Defect 2 — `showStatus` 去重竞态**
`interactive-mode.ts` L2300：连续状态消息更新同一 `lastStatusText` 组件。如果 status 后紧跟 error，status 可能在用户阅读前被覆盖。

### 3. 高可用差距

| 差距 | 影响 | 严重度 |
|------|------|--------|
| 无桌面/OS 通知 | 后台任务完成时用户切到其他窗口会完全错过 | **CRITICAL** |
| 无空闲检测通知 | 长时间任务完成后无法提醒不在终端的用户 | **CRITICAL** |
| 无终端响铃（BEL） | 无法产生可听反馈 | **HIGH** |
| 无终端进度条 | iTerm2/Ghostty dock 图标无进度显示 | **MEDIUM** |
| 无后台 bash 完成通知 | 后台命令静默完成 | **LOW**（task panel 部分覆盖） |
| 无钩子式通知扩展 | 无法自定义通知回调（如发 Slack） | **MEDIUM** |
| 无可配置通知通道 | 用户无法选择首选通知方式 | **MEDIUM** |

### 4. CC 功能差距

| CC 功能 | catui 状态 | 严重度 |
|---------|----------------|--------|
| 桌面通知（iTerm2/Kitty/Ghostty/BEL） | 未实现 | **CRITICAL** |
| 空闲检测延迟通知 | 未实现 | **CRITICAL** |
| 终端响铃 | 未实现 | **HIGH** |
| 终端进度条（OSC 9;4） | 未实现 | **MEDIUM** |
| 通知钩子（用户自定义回调） | 未实现 | **MEDIUM** |
| `fold` 合并器 | 未实现 | **LOW** |
| `invalidates` 跨通知消除 | 未实现 | **LOW** |
| 16+ 上下文通知钩子 | 未实现（缺少对应子系统） | **MEDIUM** |
| 可配置通知通道偏好 | 未实现 | **MEDIUM** |
| 通知分析追踪 | 未实现 | **LOW** |
| 背景 bash 通知合并 | 未实现 | **LOW** |

### 5. catui 优势

- **多可见队列**：同时显示 3 条通知（CC 仅 1 条），信息密度更高
- **Buddy 宠物集成**：`showError` 触发宠物气泡反馈，比纯文字更生动
- **4 级优先级 + 不同超时**：immediate 3s / high 5s / medium 8s / low 12s，比 CC 统一 8s 更精细
- **队列容量 20 条**：比 CC 单条显示更不容易丢失通知

### 汇总

| 严重度 | 数量 |
|--------|------|
| CRITICAL | 2（无桌面通知、无空闲检测） |
| HIGH | 1（无终端响铃） |
| MEDIUM | 4（无进度条、无钩子、无可配置通道、无上下文钩子） |
| LOW | 3（无 fold/invalidates、无后台合并、自定义 duration bug） |

**优先修复项：**
1. **CRITICAL**: 实现桌面通知服务（先支持终端自动检测 + BEL 降级）
2. **CRITICAL**: 添加空闲检测通知（长任务完成后 6s 无输入触发桌面通知）
3. **HIGH**: 添加终端 BEL 响铃支持（最简单的可听反馈）
4. **MEDIUM**: 实现 OSC 9;4 进度条报告
5. **MEDIUM**: 修复 `scheduleDismiss` 自定义 duration bug
6. **MEDIUM**: 添加通知钩子扩展点

---

**已完成 23 轮扫描。** 通知系统已覆盖。

---

## Round 24 — Sub-agent System（子代理系统）

**扫描时间**: 2026-06-12
**扫描模块**: `core/sub-agent/`（15 个文件）, `core/workspace/worktree-manager.ts`, `extensions/builtin/subagent/`, `extensions/builtin/team/`
**对比**: CC `src/tools/AgentTool/`（10+ 文件）, `src/utils/worktree.ts`, `src/utils/forkedAgent.ts`, `src/tasks/LocalAgentTask/`

### 1. 架构对比

| 维度 | catui | Claude Code |
|------|-----------|-------------|
| 架构风格 | 清晰分层（types/backend/runtime/tool/registry） | 较单体（AgentTool.tsx ~1400 行） |
| 子进程后端 | 仅存根（echo 循环） | 远程 CCR 支持（ant-only） |
| Fork 系统 | 基础 `forksParentContext` | 完整 fork + cache 共享 + 行为指令 + worktree 通知 |
| Team 系统 | 独立扩展（mailbox/tasks/transcripts） | 集成在 AgentTool（`spawnTeammate` + swarm） |
| Worktree 工具 | `WorktreeManager` 类 + snapshot 降级 | hook 支持 + slug 验证 + symlink 优化 |
| 代理摘要/进度 | 无 | `startAgentSummarization()` + AgentSummary 服务 |
| 安全分类器 | 正则启发式 | LLM 转录分类器（`classifyYoloAction`） |
| 代理记忆 | 引用但未深度实现 | 完整（snapshots, project scope） |
| 代理 UI | 基础 `sub-agent-panel.ts` | React 组件（TeammateSpinnerTree, AgentsList） |
| Feature gating | 无 | GrowthBook feature flags |

### 2. 正确性缺陷

**Defect 1 — `SubAgentRuntime.spawn()` 清理竞态（LOW）**
`sub-agent-runtime.ts` L32-34：`handle.result().finally()` 删除 `activeAgents` 条目。如果 `result()` 在 `spawn()` 返回 handle 前解析，handle 会立即从 map 中移除。实际风险低（异步执行保证安全窗口）。

**Defect 2 — 子进程后端是非功能存根（MEDIUM）**
`subprocess-backend.ts` + `subprocess-worker.ts`：worker 线程仅运行 echo 循环，不执行 LLM 查询。已导出但无实际功能，调用方可能误用。

**Defect 3 — SendMessage 工具是空操作（HIGH）**
`send-message-tool.ts` L93-98：TODO 注释确认消息未实际注入到运行中的 agent。LLM 调用后会认为消息已发送，但实际未送达。

**Defect 4 — Handoff 分类器使用正则而非 LLM（MEDIUM）**
`agent-handoff-safety.ts` L122-168：正则匹配 `curl|sh`、`rm -rf /` 等模式，无法检测细微安全违规。`part.args` 可能是对象而非字符串，`JSON.stringify` 可能不匹配。

**Defect 5 — Worktree 清理创建新 WorktreeManager 实例（LOW）**
`agent-tool.ts` L590：`config.worktreeManager ?? new WorktreeManager()` 创建无状态的新实例，依赖 `resolveWorktreeOwner()` 降级。

**Defect 6 — 后台代理完成无通知（MEDIUM）**
`agent-output-persistence.ts`：写入输出文件但无机制提醒父代理。CC 有 `enqueueAgentNotification()` 注入用户消息。

**Defect 7 — 名称注册表持久化竞态（MEDIUM）**
`agent-registry.ts` L166-205：`loadNameRegistry()` 在构造函数中异步加载，首次 `resolve()` 调用时注册表可能尚未就绪。

### 3. 高可用差距

| 差距 | 影响 | 严重度 |
|------|------|--------|
| 无代理恢复/重放 | 崩溃后状态丢失 | **HIGH** |
| 无进程崩溃恢复 | 子进程存根无实际隔离 | **HIGH** |
| 无 worktree mtime 更新 | 恢复的 worktree 可能被清理 | **MEDIUM** |
| 无过期 worktree 清理 | 孤儿 worktree 堆积 | **MEDIUM** |
| 无前台→后台提升 | 运行中代理无法转后台 | **MEDIUM** |
| 无代理进度摘要 | 长时间代理无中间反馈 | **MEDIUM** |

### 4. CC 功能差距

| CC 功能 | catui 状态 | 严重度 |
|---------|----------------|--------|
| Fork 子代理（cache 共享、行为指令、worktree 通知） | 基础 `forksParentContext` | **HIGH** |
| LLM 转录分类器 | 正则启发式 | **HIGH** |
| 代理恢复（transcript 持久化+重建） | 未实现 | **HIGH** |
| 后台代理通知注入 | 未实现 | **HIGH** |
| 远程/CCR 代理执行 | 未实现 | **LOW**（ant-only） |
| 代理颜色管理+分组 UI | 基础 | **LOW** |
| 代理记忆系统（snapshots, project scope） | 引用但未实现 | **MEDIUM** |
| Skill 预加载 | 未实现 | **LOW** |
| 代理 frontmatter hooks | 未实现 | **LOW** |
| 代理 MCP 服务器初始化 | 引用但未连接 | **MEDIUM** |
| Perfetto 追踪 | 基础 telemetry | **LOW** |
| Tool result cache 稳定性 | 未实现 | **MEDIUM** |
| Query source 追踪 | 未实现 | **LOW** |
| 前台代理注册 | 未实现 | **MEDIUM** |
| Team swarm 集成 | 独立扩展 | **MEDIUM** |

### 5. catui 优势

- **清晰分层架构**：types/backend/runtime/tool/registry 5 层分离，比 CC 的单体 AgentTool.tsx 更易维护
- **独立 Team 扩展**：mailbox + task store + transcript writer 模块化设计
- **Agent 定义注册表**：磁盘持久化名称注册表，CC 仅内存
- **Snapshot worktree 降级**：非 git 仓库时自动降级到目录复制

### 汇总

| 严重度 | 数量 |
|--------|------|
| HIGH | 4（SendMessage 空操作、无恢复、无通知注入、Fork 不完整） |
| MEDIUM | 7（子进程存根、正则分类器、无进度摘要、无 MCP 初始化、无记忆、无前台注册、名称注册竞态） |
| LOW | 4（清理竞态、worktree 新实例、远程执行、UI 差距） |

**优先修复项：**
1. **HIGH**: 实现 SendMessage 实际消息投递
2. **HIGH**: 实现后台代理完成通知注入
3. **HIGH**: 完善 Fork 子代理（cache 共享 + 行为指令）
4. **HIGH**: 实现代理恢复机制（transcript 持久化 + 重建）
5. **MEDIUM**: 连接代理 MCP 服务器初始化
6. **MEDIUM**: 添加前台代理注册 + 进度追踪

---

**已完成 24 轮扫描。** 子代理系统已覆盖。

---

## Round 25 — Skills System（技能系统）

**扫描时间**: 2026-06-12
**扫描模块**: `core/skills.ts`, `core/slash-commands.ts`, `core/runtime/slash-command-catalog.ts`, `core/runtime/agent-session.ts` (skill expansion)
**对比**: CC `src/skills/loadSkillsDir.ts`, `src/skills/bundledSkills.ts`, `src/skills/bundled/` (17+), `src/tools/SkillTool/`, `src/utils/argumentSubstitution.ts`, `src/tools/AgentTool/runAgent.ts`

### 1. 架构对比

| 维度 | catui | Claude Code |
|------|-----------|-------------|
| 核心类型 | `Skill`（6 字段：name/desc/filePath/baseDir/source/disableModelInvocation） | `Command`（15+ 字段：name/desc/whenToUse/argumentHint/allowedTools/model/effort/context/hooks/paths 等） |
| 加载路径 | 同步扫描 `~/.pencils/agent/skills/` + `.catui/skills/` | 异步扫描 managed/user/project/additional/legacy 5 级目录 + 动态发现 |
| 系统提示注入 | XML `<available_skills>` 列表，模型用 read 工具按需加载 | `Skill` 工具注册，模型可主动调用任意 skill |
| 用户调用 | `/skill:name args` → 读文件 + 包装 `<skill>` XML | `/skill-name` → `processSlashCommand()` + 模型可调 `Skill` 工具 |
| 参数替换 | 无（args 原始拼接） | 完整（`$ARGUMENTS`/`$0`-`$N`/命名 `$foo` + shell-quote） |
| Agent 预加载 | `AgentDefinition.skills` 已声明但未使用 | `runAgent.ts` 解析 skill 名称 + 加载内容 + 注入 `initialMessages` |
| 条件激活 | 无 | `paths` frontmatter（gitignore 模式匹配） |
| 动态发现 | 无 | 从编辑文件路径向上遍历发现嵌套 skill 目录 |
| 内置 skills | 无 | 17+（simplify/verify/debug/skillify/remember/loop 等） |
| MCP 集成 | 无 | MCP skill bridge + 远程发现 |
| 缓存失效 | 无 | `skillsLoaded` signal + `clearSkillCaches()` |

### 2. 正确性缺陷

**Defect 1 — Agent `skills` 字段是死代码（HIGH）**
`agent-definition.ts` L137：`skills` 已声明并从 frontmatter 解析，但 `agent-tool.ts` 从未读取或使用。Agent 生成时 skill 列表被静默忽略。CC 在 `runAgent.ts` L577-646 预加载 skills 到 `initialMessages`。

**Defect 2 — `_expandSkillCommand` 跳过参数替换（HIGH）**
`agent-session.ts` L1241-1268：读取 skill 文件、剥离 frontmatter、包装 `<skill>` XML，但：
- 不执行 `$ARGUMENTS` / 命名参数替换
- 不遵守 `allowed-tools` 限制
- 不遵守 `model` 覆盖
- 不执行 `!` 代码块中的 shell 命令
- 不处理 `context: fork` 隔离执行
用户调用的 skill 中 `$ARGUMENTS` 占位符保持原样文本。

**Defect 3 — 同步阻塞 I/O 加载 skills（MEDIUM）**
`core/skills.ts`：所有文件系统操作使用 `readFileSync`/`readdirSync`/`statSync`。CC 使用异步 `fs/promises` + `Promise.all` 并行加载。大型 skill 目录会阻塞事件循环。

**Defect 4 — 无缓存失效信号（MEDIUM）**
`resource-loader.ts`：CC 创建 `skillsLoaded` signal 供其他模块订阅。catui 无等效机制——skill 变更后系统提示和命令目录直到下次完整重载才更新。

**Defect 5 — 空描述 skill 静默丢弃（LOW）**
`core/skills.ts` L266：`frontmatter.description` 为空时 skill 被静默丢弃，无用户可见警告。

### 3. 高可用差距

| 差距 | 影响 | 严重度 |
|------|------|--------|
| 无动态 skill 发现 | 子目录中的 skills 不可发现 | **HIGH** |
| 无条件 skill 激活 | 无法按文件类型范围激活 skills | **MEDIUM** |
| 无定向 skill 缓存重载 | skill 变更需完整重载 | **MEDIUM** |
| 同步阻塞文件 I/O | 大目录加载时 UI 卡顿 | **MEDIUM** |

### 4. CC 功能差距

| CC 功能 | catui 状态 | 严重度 |
|---------|----------------|--------|
| `Skill` 工具（模型主动调用） | 未实现 | **HIGH** |
| `whenToUse` 指导字段 | 未实现 | **HIGH** |
| 参数替换（`$ARGUMENTS`/命名参数） | 未实现 | **HIGH** |
| `allowed-tools` 执行限制 | 未实现 | **MEDIUM** |
| 每 skill `model` 覆盖 | 未实现 | **MEDIUM** |
| `context: fork` 隔离执行 | 未实现 | **MEDIUM** |
| skill 内 `hooks` | 未实现 | **MEDIUM** |
| `paths` 条件激活 | 未实现 | **MEDIUM** |
| 内置 skills（17+） | 无 | **LOW** |
| MCP/plugin skill 集成 | 未实现 | **LOW** |
| `user-invocable` 标志 | 未实现 | **LOW** |
| 每 skill `effort` 设置 | 未实现 | **LOW** |
| 权限系统 | 未实现 | **MEDIUM** |
| 预算感知 skill 列表 | 未实现 | **LOW** |
| `skillRoot` 文件提取 | 未实现 | **LOW** |
| `version` 字段 | 未实现 | **LOW** |
| 使用追踪/分析 | 未实现 | **LOW** |

### 5. catui 优势

- **realpath 去重**：`realpathSync` 解析符号链接避免重复，与 CC 对齐
- **扩展系统集成**：skills 可通过扩展路径加载
- **XML 包装格式**：`<skill>` 标签清晰界定 skill 内容边界

### 汇总

| 严重度 | 数量 |
|--------|------|
| HIGH | 3（skills 死代码、无参数替换、无动态发现） |
| MEDIUM | 6（同步 I/O、无缓存失效、无条件激活、无 allowed-tools、无 fork 执行、无 hooks） |
| LOW | 5（空描述丢弃、无内置 skills、无 MCP 集成、无版本、无预算列表） |

**优先修复项：**
1. **HIGH**: 在 `agent-tool.ts` 中连接 `AgentDefinition.skills` 预加载
2. **HIGH**: 实现 `_expandSkillCommand` 参数替换（`$ARGUMENTS`/命名参数）
3. **HIGH**: 添加 `whenToUse` 到 `Skill` 接口并在系统提示中展示
4. **HIGH**: 构建 `Skill` 工具供模型主动调用
5. **MEDIUM**: 切换 skill 加载到异步 I/O + 并行读取
6. **MEDIUM**: 添加 `allowed-tools` 执行限制

---

**已完成 25 轮扫描。** 技能系统已覆盖。

---

## Round 26 — Cron/Scheduler System（定时任务系统）

**扫描时间**: 2026-06-12
**扫描模块**: `extensions/builtin/loop/cron/`（cron-parser.ts, cron-tasks.ts, cron-scheduler.ts, cron-tasks-lock.ts）, `extensions/builtin/loop/cron-tools/`（cron-create/delete/list-tool.ts）, `extensions/builtin/loop/loop-skill.ts`, `extensions/builtin/loop/index.ts`
**对比**: CC `src/utils/cron.ts`, `src/utils/cronTasks.ts`, `src/utils/cronScheduler.ts`, `src/utils/cronTasksLock.ts`, `src/utils/cronJitterConfig.ts`, `src/tools/ScheduleCronTool/`, `src/skills/bundled/loop.ts`, `src/hooks/useScheduledTasks.ts`

### 1. 架构对比

**核心评估：catui 的 cron 系统是 CC 的忠实 1:1 移植。**

| 组件 | CC | catui | 对齐度 |
|------|-----|-----------|--------|
| Cron 解析器 | `src/utils/cron.ts` | `cron-parser.ts` | 1:1 |
| 任务存储 | `src/utils/cronTasks.ts` | `cron-tasks.ts` | 1:1 |
| 调度器核心 | `src/utils/cronScheduler.ts` | `cron-scheduler.ts` | 1:1 |
| 调度器锁 | `src/utils/cronTasksLock.ts` | `cron-tasks-lock.ts` | 1:1 |
| Jitter 配置 | `src/utils/cronJitterConfig.ts` | 硬编码默认值 | 部分 |
| CronCreate 工具 | `CronCreateTool.ts` | `cron-create-tool.ts` | 1:1 |
| CronDelete 工具 | `CronDeleteTool.ts` | `cron-delete-tool.ts` | 1:1 |
| CronList 工具 | `CronListTool.ts` | `cron-list-tool.ts` | 1:1 |
| /loop skill | `src/skills/bundled/loop.ts` | `loop-skill.ts` | 1:1 |
| REPL 集成 | `useScheduledTasks` React hook | 扩展 `index.ts` | 架构不同 |

**关键结构差异**：CC 使用 React hook（`useScheduledTasks`）+ 优先级队列（`enqueuePendingNotification` priority `'later'`）。catui 使用扩展架构 + `api.sendUserMessage(prompt, { deliverAs: "followUp" })`。

**Session 任务状态**：CC 存储在集中式 bootstrap state（`STATE.sessionCronTasks`）。catui 存储在模块级 `Map<string, CronTask>`。两种方式对各自架构都正确。

### 2. 正确性缺陷

**Defect 1 — `removeCronTasks` 行为分歧（MEDIUM）**
`cron-tasks.ts` L248-260：catui 总是先扫描 session store，然后条件读取文件。CC 在 `dir === undefined` 时才扫描 session store。当 `dir` 已提供且任务 ID 同时存在于 session 和文件时，session 删除会短路导致文件副本残留。

**Defect 2 — `readCronTasks` 静默吞错（LOW）**
`cron-tasks.ts` L112-156：catui 使用 `catch { return [] }` 静默忽略所有错误。CC 使用 `isFsInaccessible(e)` 区分权限错误并调用 `logError(e)`。损坏或权限拒绝的 cron 文件对用户不可见。

**Defect 3 — 工具输入缺少 `semanticBoolean`（LOW）**
`cron-create-tool.ts`：CC 用 `semanticBoolean()` 包装 `recurring`/`durable` 参数（接受布尔值和字符串 "true"/"false"）。catui 使用 `Type.Boolean()`，模型传字符串时可能拒绝。

**Defect 4 — `DEFAULT_MAX_AGE_DAYS` 硬编码（LOW）**
`prompt.ts` L15：catui 硬编码 `7`。CC 从 `DEFAULT_CRON_JITTER_CONFIG.recurringMaxAgeMs` 派生。当前值相同但未来可能分歧。

**Defect 5 — Issue 0013 路径不匹配（INFO）**
`issues/0013-cron-tasks-path-mismatch.md`：历史问题记录，durable cron 写入路径 vs 读取路径不一致。当前代码已使用 `ctx.agentDir`/`api.agentDir` 统一，但 issue 状态仍为 open。

### 3. 高可用差距

| 差距 | 影响 | 严重度 |
|------|------|--------|
| 无分析/调试日志 | 生产环境无法诊断 cron 问题 | **MEDIUM** |
| 无运行时 jitter 调优 | :00 负载峰值无法分散 | **MEDIUM** |
| 无 `isKilled` 门控 | 无法远程停止已运行的调度器 | **LOW** |
| 无崩溃时锁释放注册 | SIGKILL 后锁文件孤儿化（PID 探测可恢复） | **LOW** |
| 无 `DISABLE_CRON` 环境变量 | 无法本地禁用 cron | **LOW** |

### 4. CC 功能差距

| CC 功能 | catui 状态 | 严重度 |
|---------|----------------|--------|
| Teammate 集成（agent 归属/隔离/清理） | `agentId` 字段存在但无工具/调度器逻辑 | **HIGH** |
| `setScheduledTasksEnabled` 协调 | 仅内部轮询 | **MEDIUM** |
| 工作负载归因（`WORKLOAD_CRON` 标签） | 无 | **MEDIUM** |
| 优先级队列（`isMeta` + `priority: 'later'`） | `sendUserMessage` followUp | **MEDIUM** |
| 事件追踪（fire/missed/expired） | 无 | **LOW** |
| `isConcurrencySafe`/`isReadOnly` 标志 | 扩展 API 不支持 | **LOW** |
| GrowthBook 动态配置 | 硬编码默认值 | **LOW** |

### 5. catui 优势

- **扩展架构集成**：通过扩展 API 暴露，比 React hook 更模块化
- **1:1 忠实移植**：cron 解析、next-run 计算、jitter 算法、锁协议、调度器 tick 循环功能完全一致
- **简化参数模型**：`dir` 参数必需而非可选，减少歧义

### 汇总

| 严重度 | 数量 |
|--------|------|
| HIGH | 1（无 teammate 支持） |
| MEDIUM | 4（removeCronTasks 行为分歧、无分析日志、无 jitter 调优、无优先级队列） |
| LOW | 6（静默吞错、无 semanticBoolean、硬编码天数、无 killswitch、无崩溃锁释放、无 DISABLE_CRON） |

**优先修复项：**
1. **HIGH**: 实现 teammate cron 归属/隔离/清理逻辑
2. **MEDIUM**: 修复 `removeCronTasks` 行为与 CC 对齐
3. **MEDIUM**: 添加 cron 分析事件（fire/missed/expired）
4. **MEDIUM**: 实现 `readCronTasks` 错误分类（区分权限错误）
5. **LOW**: 添加 `semanticBoolean` 包装器

---

**已完成 26 轮扫描。** 定时任务系统已覆盖。

---

## Round 27 — Plan System（计划系统）

**扫描时间**: 2026-06-12
**扫描模块**: `extensions/builtin/plan/`（8 文件：index.ts, enter-plan-mode-tool.ts, exit-plan-mode-tool.ts, plan-file-manager.ts, plan-permissions.ts, plan-validation.ts, plan-agents.ts, teammate-approval.ts）, `modes/interactive/components/plan-mode-panel.ts`
**对比**: CC `src/tools/EnterPlanModeTool/`, `src/tools/ExitPlanModeTool/`, `src/utils/plans.ts`, `src/plan/`, `src/components/` (plan UI)

### 1. 架构对比

| 维度 | catui | Claude Code |
|------|-----------|-------------|
| 实现位置 | 扩展模块（`extensions/builtin/plan/`） | 核心工具 + 工具模块 + React UI（6+ 目录） |
| 状态存储 | WeakMap + session entries（`PLAN_CUSTOM_TYPE`） | 全局 AppState + ToolPermissionContext |
| 权限门控 | `tool_call` 事件拦截器返回 `{ block: true }` | 每工具 `isReadOnly()` + 分类器集成 |
| UI 框架 | 自定义 TUI（`ctx.ui.select()` 字符串选择） | React Ink（Select 组件 + 权限对话框） |
| A/B 测试 | 无 | `PewterLedgerVariant` 实验框架 |
| 子代理集成 | `plan-agents.ts` 定义 Explore/Plan 提示 | `planAgent.ts` + `exploreAgent.ts` 内置代理 |
| Plan 文件管理 | `~/.catui/plans/{slug}.md`（adjective-noun slug） | `~/.claude/plans/{slug}.md`（`generateWordSlug()`） |
| 工作流 | 5 阶段顺序 + 访谈模式（env var 门控） | 5 阶段顺序 + 访谈模式（feature flag 门控） |

### 2. 正确性缺陷

**BUG 1 — `getPlanSlug` 碰撞后返回冲突 slug（MEDIUM）**
`plan-file-manager.ts` L211-216：10 次重试全部命中已存在文件时，`slug` 保持最后一个已存在值，返回后会覆盖或冲突。应添加 timestamp/UUID 降级。

**BUG 2 — `ExitPlanMode` select 回退路径静默（LOW）**
`exit-plan-mode-tool.ts` L327：非预期选择值静默降级为 "standard" 模式。`ctx.ui.select()` 返回 `undefined` 时仍会调用 `handlePlanModeExit` 清除 widget，模型可能无明确指引。

**BUG 3 — 测试不覆盖审批流程（LOW）**
`test/plan-mode.test.ts` L217：`select: async () => undefined` 从未测试实际审批选择路径，只测试降级行为。

**DEFECT 1 — `ALL_BLOCKED_TOOLS` 包含死名称（LOW）**
`plan-permissions.ts` L18-26：`write_file`/`edit_file`/`replace`/`create_file`/`delete_file` 不是实际工具名（实际为 `write`/`edit`），集合部分为死代码。

**DEFECT 2 — Plan 验证正则过于宽松（LOW）**
`plan-validation.ts` L9-14：只需标题包含 "Context"/"Approach"/"Files"/"Test" 即通过，无实质内容验证。

**DEFECT 3 — `getPlansDirectory` 缓存竞态（LOW）**
`plan-file-manager.ts` L168-193：模块级缓存变量在并发调用时可能返回过期值。

### 3. 高可用差距

| 差距 | 影响 | 严重度 |
|------|------|--------|
| 无远程会话 plan 快照 | 远程会话崩溃后 plan 丢失 | **HIGH** |
| 无消息历史 plan 恢复 | 无法从 ExitPlanMode 输入重建 plan | **HIGH** |
| 文件系统 mailbox 无锁 | 并发写入可能损坏（标记 `@deprecated`） | **MEDIUM** |
| 无 auto-compaction plan 保留 | 上下文压缩时 plan 内容可能丢失 | **MEDIUM** |
| 模块级 `pendingPlan` 进程全局 | 多会话共享进程时互相覆盖 | **MEDIUM** |

### 4. CC 功能差距

| CC 功能 | catui 状态 | 严重度 |
|---------|----------------|--------|
| React TUI 审批对话框 | 字符串 select | **MEDIUM** |
| Plan 拒绝消息组件 | 无（仅抛错误文本） | **LOW** |
| Plan-to-implement 消息 | 无（plan 作为纯文本嵌入工具结果） | **LOW** |
| Auto-mode 集成（分类器+电路断路器） | 仅有 `prePlanMode` | **HIGH** |
| A/B 测试框架 | 无 | **LOW** |
| 远程会话 plan 快照持久化 | 无 | **HIGH** |
| 从消息历史恢复 plan | 无 | **HIGH** |
| Feature-flagged 代理数量 | 仅 env var | **LOW** |
| Ant/External 用户提示区分 | 单一提示 | **LOW** |
| 动态工具列表（`hasEmbeddedSearchTools`） | 硬编码工具名 | **LOW** |
| `allowedPrompts` 权限集成 | Schema 接受但未执行 | **MEDIUM** |
| TeamCreateTool 并行提示 | 无 | **LOW** |
| 子代理专用 plan 指令 | 基础（通过提示文本） | **LOW** |

### 5. catui 优势

- **扩展架构封装**：作为自包含扩展模块，比 CC 分散在 6+ 目录更易维护
- **WeakMap 状态管理**：比全局 AppState 更安全，避免跨会话泄漏
- **事件拦截权限门控**：统一的 `tool_call` 事件处理比逐工具 `isReadOnly()` 更集中
- **访谈模式**：已实现（虽为 env var 门控），CC 同样支持

### 汇总

| 严重度 | 数量 |
|--------|------|
| HIGH | 3（无远程快照、无 plan 恢复、无 auto-mode 集成） |
| MEDIUM | 5（slug 碰撞、mailbox 无锁、无 compaction 保留、进程全局状态、allowedPrompts 未集成） |
| LOW | 7（select 回退、测试不足、死工具名、宽松验证、缓存竞态、无拒绝 UI、无 A/B 测试） |

**优先修复项：**
1. **HIGH**: 实现 plan 文件恢复机制（从 ExitPlanMode 输入 + 消息历史重建）
2. **HIGH**: 实现 auto-compaction plan 保留（注入 `plan_file_reference` 附件）
3. **HIGH**: 集成 auto-mode 分类器到 plan 模式
4. **MEDIUM**: 修复 `getPlanSlug` 碰撞降级（添加 timestamp/UUID）
5. **MEDIUM**: 修复 `ALL_BLOCKED_TOOLS` 使用实际工具名
6. **MEDIUM**: 添加 `allowedPrompts` 权限系统集成

---

**已完成 27 轮扫描。** 计划系统已覆盖。

---

## Round 28 — Image Handling（图片处理）

**扫描时间**: 2026-06-12
**扫描模块**: `utils/mime.ts`, `utils/photon.ts`, `modes/utils/image-resize.ts`, `modes/utils/image-convert.ts`, `modes/utils/clipboard-image.ts`, `core/lib/tui/src/terminal-image.ts`, `core/lib/tui/src/components/image.ts`, `modes/interactive/controllers/image-pipeline-controller.ts`
**对比**: CC `src/tools/FileReadTool/imageProcessor.ts`, `src/utils/imageResizer.ts`, `src/utils/imagePaste.ts`, `src/utils/screenshotClipboard.ts`, `src/utils/imageStore.ts`, `src/utils/imageValidation.ts`, `src/components/ClickableImageRef.tsx`

### 1. 架构对比

| 维度 | catui | Claude Code |
|------|-----------|-------------|
| 图像处理引擎 | Photon（Rust/WASM）+ `fs.readFileSync` monkey-patch | Sharp（原生 Node）+ NAPI 降级 |
| 终端图片显示 | Kitty 图形协议（分块+图片 ID）+ iTerm2 内联 | 纯文本 `[Image #N]` 可点击链接 |
| 压缩策略 | Lanczos3 缩放 → 质量递减 → 尺寸递减 | 渐进缩放 → 调色板 PNG（64 色）→ JPEG 多质量 → 超压缩降级 |
| 剪贴板 I/O | Wayland/X11/macOS（同步 `spawnSync`） | macOS/Linux/Windows（异步 + 原生快速路径） |
| 图片持久化 | 写入项目 cwd，会话结束清理 | `~/.claude/image-cache/` LRU 200 张 + 跨会话清理 |
| Token 感知 | 无（固定 4.5MB 限制） | `compressImageBufferWithTokenLimit()` 映射 token 预算到字节 |
| API 验证 | 无 | `validateImagesForAPI()` 硬门控 5MB base64 |
| Windows 支持 | 无 | 完整 PowerShell 剪贴板 |
| 多格式解析 | PNG/JPEG/GIF/WebP 头部直接解析（无需完整解码） | Sharp 元数据（需完整解码） |
| 截图导出 | 无 | `screenshotClipboard.ts` ANSI→PNG→剪贴板 |
| 多 provider 测试 | 11 家 provider 单元测试 | 无 |

**catui 优势：终端内联图片渲染** — Kitty/iTerm2 像素级渲染，CC 仅文本引用。

### 2. 正确性缺陷

**CRITICAL — `convertToPng()` 忽略输入格式**
`image-convert.ts` L13-44：始终调用 `image.get_bytes()` 返回 PNG。4.9MB JPEG 输入会产生 15MB+ PNG，远超 API 5MB base64 限制。无转换后大小检查，不尝试保留 JPEG 格式。

**HIGH — `convertToPng()` 在剪贴板管道中无大小守卫**
`clipboard-image.ts` L72-91：BMP 转 PNG 后无大小检查，大 BMP 产生的 PNG 直接流入 LLM。

**HIGH — 同步剪贴板读取阻塞事件循环**
`clipboard-image.ts` L93-119：`spawnSync()` 阻塞最多 3000ms。CC 使用异步 `execFileNoThrowWithCwd()`。

**MEDIUM — `resizeImage()` Photon 失败时静默返回原图**
`image-resize.ts` L68-80：WASM 加载失败时返回 `wasResized: false`，静默传递超大图片。CC 抛出 `ImageResizeError`。

**MEDIUM — `getPngDimensions()` 未验证 IHDR 块类型**
`terminal-image.ts` L208-227：检查 PNG 签名但未验证字节 8-11 的 IHDR 块类型，损坏 PNG 可能产生错误尺寸。

**LOW — 图片管道写入项目 cwd**
`image-pipeline-controller.ts` L343-349：`_np_clipboard_image_N.png` 写入项目根目录，崩溃后残留污染 git status。

**LOW — `tryBothFormats()` 每次分配双倍缓冲区**
`image-resize.ts` L118-136：同时生成 PNG 和 JPEG 缓冲区再选小的，大图片时内存/CPU 翻倍。

### 3. 高可用差距

| 差距 | 影响 | 严重度 |
|------|------|--------|
| 无 API 级大小验证 | 超大图片到达 API 后返回不透明错误 | **HIGH** |
| Photon 失败静默降级 | 超大图片未经压缩直接发送 | **HIGH** |
| 同步剪贴板 I/O | 大截图阻塞事件循环 3s | **HIGH** |
| 无 magic bytes 格式检测 | 仅依赖 `file-type` 库嗅探 | **MEDIUM** |
| 剪贴板文件清理竞态 | 崩溃后项目目录残留临时文件 | **MEDIUM** |
| 无空图片守卫 | 0 字节输入静默通过 | **MEDIUM** |

### 4. CC 功能差距

| CC 功能 | catui 状态 | 严重度 |
|---------|----------------|--------|
| API 边界大小验证（`validateImagesForAPI`） | 未实现 | **HIGH** |
| Token 预算感知压缩 | 未实现（固定 4.5MB） | **HIGH** |
| Windows 剪贴板支持 | 未实现 | **HIGH** |
| 持久化图片存储（LRU 200 张） | 写入项目 cwd | **MEDIUM** |
| 剪贴板图片提示（焦点恢复通知） | 未实现 | **MEDIUM** |
| 多阶段压缩管道（调色板 PNG + 多质量 JPEG） | 简化管道 | **MEDIUM** |
| 截图到剪贴板（ANSI→PNG） | 未实现 | **MEDIUM** |
| ANSI→PNG 转换 | 未实现 | **MEDIUM** |
| 原生剪贴板模块（macOS NAPI ~5ms） | 同步 spawn ~1.5s | **LOW** |
| BMP magic bytes 检测 | 仅 Wayland 路径 | **LOW** |
| macOS 截图路径薄空格处理 | 未实现 | **LOW** |
| 设备文件阻塞守卫 | 未实现 | **LOW** |

### 5. catui 独有优势

- **终端内联图片渲染**：Kitty + iTerm2 像素级显示，CC 无此能力
- **11 provider 图片测试**：Anthropic/OpenAI/Google/Mistral/Bedrock 等全面覆盖
- **Base64 头部直接解析**：无需完整解码即可获取 PNG/JPEG/GIF/WebP 尺寸
- **Wayland 优先检测**：Linux 剪贴板先尝试 wl-paste 再降级 xclip
- **`isImageLine()` 检测**：Kitty/iTerm2 图片行回归测试

### 汇总

| 严重度 | 数量 |
|--------|------|
| CRITICAL | 1（convertToPng 格式膨胀） |
| HIGH | 4（无 API 验证、无 token 压缩、同步 I/O、无 Windows） |
| MEDIUM | 6（静默降级、IHDR 验证、空守卫、magic bytes、清理竞态、多阶段压缩） |
| LOW | 5（cwd 文件、双缓冲区、NAPI、BMP 检测、设备守卫） |

**优先修复项：**
1. **CRITICAL**: 修复 `convertToPng()` 保留 JPEG 格式（使用 `get_bytes_jpeg()`）
2. **HIGH**: 添加 `validateImagesForAPI()` API 边界大小验证
3. **HIGH**: 将剪贴板读取改为异步（替换 `spawnSync`）
4. **HIGH**: 添加 `resizeImage()` 空图片 + Photon 失败守卫
5. **MEDIUM**: 将剪贴板临时文件写入 `os.tmpdir()` 而非项目 cwd
6. **MEDIUM**: 添加 Windows PowerShell 剪贴板支持

---

**已完成 28 轮扫描。** 图片处理已覆盖。

---

## Round 29 — Sandbox/Security System（沙箱/安全系统）

**扫描时间**: 2026-06-12
**扫描模块**: `core/tools/bash.ts`（sandbox hook L452-628）, `extensions/builtin/security-audit/`（DangerDetector, Interceptor, AuditLogger）, `core/sub-agent/agent-handoff-safety.ts`, `core/sub-agent/agent-tool-filter.ts`
**对比**: CC `src/utils/sandbox/sandbox-adapter.ts`（986 行）, `src/utils/permissions/`, `src/tools/BashTool/bashSecurity.ts`, `src/utils/permissions/yoloClassifier.ts`, `src/utils/permissions/dangerousPatterns.ts`

### 1. 架构对比

| 维度 | catui | Claude Code |
|------|-----------|-------------|
| 安全范式 | **审计导向** — 应用层 regex 屏障 | **执行导向** — OS 级沙箱 + 多层防御 |
| OS 级沙箱 | 无 | Seatbelt（macOS）+ bwrap（Linux/WSL2） |
| 文件系统限制 | Regex-only，审计模式下不强制 | 内核级 denyRead/denyWrite/allowWrite glob 支持 |
| 网络限制 | 无 | 域名 allow/deny 列表 + 代理端口 + unix socket |
| 命令分析 | 正则匹配（~15 模式） | Tree-sitter AST 解析 + 23+ 注入检测 + 语义分析 |
| 权限模式 | 2 种（plan + default） | 6 种（default/plan/acceptEdits/bypassPermissions/dontAsk/auto） |
| 权限规则 | 配置白名单 | 10+ 来源的 allow/deny/ask 规则管道（tool-level/prefix/exact/wildcard） |
| AI 分类器 | 无（仅启发式） | 两阶段 LLM 分类器 + 转录上下文 |
| 危险命令模式 | ~15 regex | 50+ 模式（含 zsh builtins/进程替换/控制字符/unicode 空白） |
| Git 安全 | 仅 force push（审计模式） | bare repo 攻击防护 + cd+git 阻断 + worktree 检测 + 命令后擦除 |
| 路径验证 | 无 | 完整路径约束 + 重定向分析 + 危险文件保护 |
| 拒绝追踪 | 无 | 连续拒绝追踪 + 总拒绝限制 + 自动降级到提示 |
| 策略锁定 | 无 | 策略锁定设置不可本地覆盖 |
| 子代理分类器 | 启发式（7 模式） | 完整 LLM 分类器 |

### 2. 正确性缺陷

**CRITICAL — 无 OS 级沙箱**
`core/tools/bash.ts`：命令通过 `child_process.spawn(detached: true)` 以完整用户权限执行。Regex 沙箱是唯一屏障，足够聪明的 LLM 可轻易绕过。

**CRITICAL — Regex 沙箱可被绕过**
`bash.ts` L452-474：`SANDBOX_BLOCKED_PATTERNS` 存在已知缺口：
- `git stash push/drop/pop/apply` 未阻断
- `git branch -d/-D` 未阻断
- `git tag -d`、`git config --global`、`git clean -f`、`git update-ref`、`git restore` 未阻断
- `>` 重定向正则有根本缺陷（`\s>` 匹配多字符序列内部）

**HIGH — 无命令注入检测**
无 tree-sitter AST 解析，无 shell-quote 验证，无 backtick/替换检测。CC 有 23+ 安全检查类别。

**HIGH — 无网络限制**
`curl`、`wget`、`nc` 等网络工具可自由建立出站连接。

**HIGH — 无文件系统路径限制**
无机制将写入限制在项目目录内。`DangerDetector` 在审计模式下仅信息性记录。

**HIGH — Regex 命令分词不可靠**
`tokenizeSimpleShell`（L578-624）不处理：进程替换 `<(cmd)`、算术扩展 `$(( ))`、brace 展开 `{a,b,c}`、heredocs `<<EOF`。

**MEDIUM — 沙箱消息 shell 注入**
`bash.ts` L500-503：`blockedMessage` 通过模板字面量插入 shell 命令，自定义消息未消毒。

**MEDIUM — 安全审计默认仅审计**
`interface.ts` L198：`enableInterception: false` 默认值意味着即使检测到危险命令也不拦截。

### 3. 高可用差距

| 差距 | 影响 | 严重度 |
|------|------|--------|
| 安全审计扩展加载失败无降级 | 安全门控静默丢失 | **HIGH** |
| 审计日志同步 I/O | 每次工具调用阻塞事件循环 | **MEDIUM** |
| 沙箱 hook 异常时命令可能仍执行 | 路径解析失败绕过沙箱 | **HIGH** |
| 后台任务 Map 进程重启丢失 | 孤儿临时文件未清理 | **LOW** |
| 无违规聚合存储 | 审计模式违规仅日志不汇总 | **MEDIUM** |

### 4. CC 功能差距

| CC 功能 | catui 状态 | 严重度 |
|---------|----------------|--------|
| OS 级沙箱（Seatbelt/bwrap） | 无 | **CRITICAL** |
| 文件系统写入限制 | Regex-only | **CRITICAL** |
| 网络域名限制 | 无 | **CRITICAL** |
| Regex 沙箱可绕过 | 仅 regex | **CRITICAL** |
| 命令注入检测（23+ 检查） | 无 | **HIGH** |
| Tree-sitter AST 分析 | 无 | **HIGH** |
| AI 权限分类器 | 无 | **HIGH** |
| 权限模式（6 种 vs 2 种） | 仅 2 种 | **HIGH** |
| allow/deny/ask 规则管道 | 仅白名单 | **HIGH** |
| Git 安全守卫 | 仅 force push | **HIGH** |
| 路径约束验证 | 无 | **HIGH** |
| Sed 约束检查 | 无 | **MEDIUM** |
| 命令操作符处理 | 无 | **MEDIUM** |
| 多源设置配置 | 单一 env var | **MEDIUM** |
| 子代理 LLM 分类器 | 启发式 | **MEDIUM** |
| 危险文件保护 | 无 | **MEDIUM** |
| 拒绝追踪 | 无 | **MEDIUM** |
| 策略锁定 | 无 | **MEDIUM** |
| 排除命令特性 | 无 | **LOW** |
| Auto-mode AI | 无 | **LOW** |

### 5. catui 优势

- **扩展架构安全审计**：作为扩展模块可独立启用/禁用，比 CC 内嵌更灵活
- **三级拦截模式**：audit/confirm/strict 可按需选择
- **事件驱动**：通过 `tool_call` 事件统一拦截，不侵入工具代码

### 汇总

| 严重度 | 数量 |
|--------|------|
| CRITICAL | 4（无 OS 沙箱、无 FS 限制、无网络限制、regex 可绕过） |
| HIGH | 7（无注入检测、无 AST、无 AI 分类器、权限模式不足、无规则管道、Git 安全不足、无路径验证） |
| MEDIUM | 7（shell 注入、审计默认值、扩展降级、同步 I/O、沙箱恢复、违规存储、子代理分类器） |
| LOW | 3（审计日志明文、后台任务清理、排除命令） |

**优先修复项：**
1. **CRITICAL**: 集成 OS 级沙箱（至少 bwrap for Linux，seatbelt for macOS）
2. **CRITICAL**: 添加网络域名限制（至少支持 `allowedDomains` 配置）
3. **HIGH**: 实现 tree-sitter AST 命令分析替代 regex
4. **HIGH**: 添加 allow/deny/ask 权限规则管道
5. **HIGH**: 完善 Git 安全守卫（bare repo、cd+git、branch -d 等）
6. **MEDIUM**: 修复安全审计默认启用拦截（`enableInterception: true`）

---

**已完成 29 轮扫描。** 沙箱/安全系统已覆盖。

---

## Round 30 — CLI Entry Point（CLI 入口）

**扫描时间**: 2026-06-12
**扫描模块**: `cli.ts`, `cli/args.ts`, `main.ts`
**对比**: CC `src/entrypoints/cli.tsx`, `src/main.tsx`（Commander.js + 50+ 选项 + 50+ 子命令）

### 1. 架构对比

| 维度 | catui | Claude Code |
|------|-----------|-------------|
| 入口文件 | `cli.ts`（`#!/usr/bin/env node`） | `src/entrypoints/cli.tsx` |
| 参数解析 | 手写 for 循环（~80 个 else-if 分支） | Commander.js（`@commander-js/extra-typings`） |
| 子命令路由 | 手动 if/else 匹配 `args[0]`（4 个子命令） | Commander `.command().action()` 树（50+ 子命令） |
| 快速路径 | 2 个（`--version`/`--help`） | ~15 个（version/daemon/bridge/bg/templates/runners/worktree 等） |
| 版本常量 | 运行时磁盘读取 `package.json` | 编译时内联 `MACRO.VERSION` |
| 启动 profiling | `profileCheckpoint()` | `profileCheckpoint()`（相同模式） |
| 初始化系统 | 内联在 `main()` 函数中 | 独立 `init()`（memoized） |
| Feature gating | 运行时 `APP_NAME` 检查 | 编译时 `feature()` DCE |
| 扩展 flag 发现 | 两阶段解析（核心→扩展加载→重解析） | 扩展在 commander 解析后加载 |
| 预导入并行 | 无 | `startMdmRawRead()` + `startKeychainPrefetch()` |

### 2. 正确性缺陷

**Defect 1 — 未知 flag 静默忽略（MEDIUM）**
`cli/args.ts` L299-310：`--modle` 等拼写错误无警告。CC 的 Commander.js 默认对未知选项报错。

**Defect 2 — `process.exit(1)` 无优雅关闭（LOW）**
`main.ts` L541/588/683/909/997/1118：致命错误使用裸 `process.exit(1)`，清理处理器（session 状态写入、输出刷新）可能不运行。CC 有 `gracefulShutdown()` + `registerCleanup()` 系统。

**Defect 3 — `process.exitCode = 1` 无显式退出（LOW）**
`main.ts` L336/344/373/432：设置 `exitCode` 但不调用 `process.exit()`，依赖事件循环排空。

**Defect 4 — 版本显示磁盘 I/O（LOW）**
`cli.ts` L17-25：`--version` 快速路径读取并解析 `package.json`。CC 使用编译时内联常量零导入。

**Defect 5 — `--cwd ~` 不展开（LOW）**
`main.ts` L200-204：`resolveWorkingDirectory` 调用 `path.resolve()` 不展开 `~`。`--cwd ~/projects` 解析为 `<cwd>/~/projects`。

**Defect 6 — `--mode` 无值验证（LOW）**
`cli/args.ts` L149-153：`--mode` 接受 `text`/`json`/`rpc`，但无效值静默忽略无警告。

### 3. 高可用差距

| 差距 | 影响 | 严重度 |
|------|------|--------|
| 无自动更新检查 | 用户无法得知新版本 | **HIGH** |
| 无 `doctor` 命令 | 无法诊断安装问题 | **MEDIUM** |
| 无优雅关闭系统 | 错误退出可能丢失 session 状态 | **MEDIUM** |
| 无远程管理设置/企业策略 | 无法集中推送配置 | **MEDIUM** |
| 无 telemetry | 最小可观测性 | **LOW** |

### 4. CC 功能差距

| CC 功能 | catui 状态 | 严重度 |
|---------|----------------|--------|
| Commander.js CLI 框架 | 手写 80 分支 parser | **HIGH** |
| 50+ 子命令（mcp/auth/plugin/doctor/task/auto-mode 等） | 4 个子命令 | **HIGH** |
| 自动更新机制（npm/Homebrew/winget） | 无 | **HIGH** |
| `doctor` 健康检查 | 无 | **MEDIUM** |
| `auth login/status/logout` | env vars + models.json | **MEDIUM** |
| `mcp serve/add/remove/list/get` | 默认开启无 CLI 管理 | **MEDIUM** |
| `--output-format stream-json` | `--mode json`（基础） | **MEDIUM** |
| `--permission-mode` | `--no-tools`/`--tools` | **MEDIUM** |
| 编译时 feature gating DCE | 运行时检查 | **MEDIUM** |
| 预导入并行（MDM + keychain） | 无 | **MEDIUM** |
| `--bare` 轻量模式 | `--offline`（仅网络） | **LOW** |
| `--settings` 运行时加载 | 仅 `settings.json` | **LOW** |
| `plugin marketplace` 生命周期 | 基础 install/remove | **LOW** |
| `--json-schema` 结构化输出 | 无 | **LOW** |
| `~` 展开 | 不支持 | **LOW** |

### 5. catui 优势

- **两阶段扩展 flag 解析**：先解析核心 flag → 加载扩展 → 再解析扩展 flag，比 CC 的单一阶段更灵活
- **零依赖参数解析**：无外部库依赖，bundle 更小
- **快速路径延迟导入**：`--version`/`--help` 在 `import("./main.js")` 前退出，与 CC 模式一致

### 汇总

| 严重度 | 数量 |
|--------|------|
| HIGH | 3（无 CLI 框架、子命令不足、无更新机制） |
| MEDIUM | 7（未知 flag 静默、无 doctor、无优雅关闭、无企业策略、无 auth CLI、无 MCP CLI、无 stream-json） |
| LOW | 6（exitCode、版本 I/O、tilde、mode 验证、bare、settings） |

**优先修复项：**
1. **HIGH**: 添加 `update`/`upgrade` 子命令（npm registry 版本检查 + 自动更新）
2. **HIGH**: 添加未知 flag 警告（至少 `console.warn`）
3. **MEDIUM**: 实现 `gracefulShutdown()` 清理注册系统
4. **MEDIUM**: 添加 `doctor` 健康检查命令
5. **MEDIUM**: 添加 `auth login/status/logout` 子命令
6. **LOW**: 修复 `--cwd ~` 展开

---

**已完成 30 轮扫描。** CLI 入口已覆盖。

---

## Round 31 — Plugin/Extension Loading Framework（插件/扩展加载框架）

**扫描时间**: 2026-06-12
**扫描模块**: `core/extensions-host/loader.ts`（4 层发现 + jiti 加载）, `core/extensions-host/runner.ts`（生命周期+事件）, `core/extensions-host/types.ts`（1474 行类型定义）, `core/extensions-host/wrapper.ts`（工具包装）, `builtin-extensions.ts`（25+ 内置扩展注册）
**对比**: CC `src/utils/plugins/pluginLoader.ts`, `src/types/plugin.ts`, `src/utils/plugins/installedPluginsManager.ts`, `src/utils/plugins/marketplaceManager.ts`, `src/utils/plugins/pluginAutoupdate.ts`, `src/utils/plugins/pluginPolicy.ts`, `src/commands/plugin/`（17 文件 300K+）

### 1. 架构对比

| 维度 | catui | Claude Code |
|------|-----------|-------------|
| 发现模型 | 4 层（项目/全局/配置路径/npm） | 3 层（session/marketplace/builtin） |
| 加载机制 | `jiti`（TS JIT 导入） | 标准 Node.js `import()` |
| 扩展契约 | 导出工厂函数 `(api) => void` | 结构化清单 `plugin.json` + markdown 命令 |
| 事件/Hook 系统 | 30+ 类型化事件 + 编程式处理器 | 20+ matcher-based hooks + JSON 配置 |
| 注册能力 | 工具/命令/事件/快捷键/flag/消息渲染器/provider | Markdown 命令 + hooks + MCP/LSP 服务器 |
| 内置扩展 | 25+（`builtin-extensions.ts` + 风险元数据） | 内置插件注册表 |
| 启用/禁用 | 无（内置扩展始终加载） | 完整 enable/disable + 持久化 |
| 版本管理 | 无 | 版本化缓存 + V1/V2 迁移 + 回滚 |
| 自动更新 | 无 | 后台自动更新 + 通知 |
| Marketplace | 无（仅 npm 层发现） | 完整 marketplace 系统 + UI |
| 企业策略 | 无 | 策略强制/禁用 + 黑名单 |
| UI 管理 | 配置文件 | `/plugin` 交互式 UI（17 文件） |
| 沙箱 | 无（同进程完整 API 访问） | 无 |
| 依赖解析 | 无 | `dependencyResolver.ts` |
| 每插件配置 | 共享 Settings | `pluginOptionsStorage.ts` + UI |
| 错误类型 | `{ path, error }` 扁平字符串 | 20+ 变体判别联合 |

### 2. 正确性缺陷

**Defect 1 — 内置扩展无法禁用（HIGH）**
`builtin-extensions.ts` L129-362：`getBuiltinExtensionPaths()` 无条件推送所有 `defaultEnabled` 扩展。`settings.extensions[]` 仅添加不减去。用户无法禁用 `team` 等内置扩展。

**Defect 2 — 并行加载隐藏顺序依赖（MEDIUM）**
`loader.ts` L348-383：`Promise.all` 并行加载，但 SAL 必须在 NanoMem 之前加载（L141-147），diagnostics 必须首先加载（L130-135）。实际执行顺序不确定。

**Defect 3 — 无扩展级沙箱（HIGH）**
扩展在同进程中运行，拥有完整 Node.js/Bun API 访问。`ExtensionAPI.exec()` 提供直接 shell 执行能力。`riskLevel` 元数据仅为信息性不强制执行。

**Defect 4 — `before_agent_start` 超时静默丢弃（MEDIUM）**
`runner.ts` L276-292：处理器超时（默认 1500ms）后静默跳过，仅限频控制台警告。关键扩展的系统提示注入可能被静默丢失。

**Defect 5 — `emitToolCall` 未捕获处理器错误（MEDIUM）**
`runner.ts` L922-943：与 `emitToolResult`（L872-920 有 try/catch）不同，`emitToolCall` 的单个处理器异常会传播并阻断后续处理器。

### 3. 高可用差距

| 差距 | 影响 | 严重度 |
|------|------|--------|
| 无热重载 | 扩展更改需重启 session | **MEDIUM** |
| 无版本管理/回滚 | npm 更新后无迁移路径 | **HIGH** |
| 无健康监控/熔断器 | 持续失败的扩展永远记录错误 | **MEDIUM** |
| 无资源隔离 | 共享 EventBus，内存泄漏影响所有扩展 | **MEDIUM** |
| 仅 `before_agent_start` 有超时 | 其他事件处理器无超时保护 | **MEDIUM** |

### 4. CC 功能差距

| CC 功能 | catui 状态 | 严重度 |
|---------|----------------|--------|
| Marketplace/商店系统 | 仅 npm 层发现 | **HIGH** |
| 插件启用/禁用 UI | 配置文件 | **HIGH** |
| 插件版本化 + 缓存管理 | 无 | **HIGH** |
| 插件自动更新 | 无 | **HIGH** |
| 企业策略强制 | 无 | **HIGH** |
| 插件黑名单 | 无 | **HIGH** |
| 插件依赖解析 | 无 | **MEDIUM** |
| 每插件配置存储 | 共享 Settings | **MEDIUM** |
| 结构化清单验证 | 工厂函数检查 | **MEDIUM** |
| 插件错误类型判别 | 扁平字符串 | **MEDIUM** |
| `clearPluginCache()` | 无 | **MEDIUM** |
| 插件回滚 | 无 | **MEDIUM** |

### 5. catui 独有优势

- **更强大的扩展 API**：编程式工具注册、类型化事件、TUI 组件、provider 注册、LLM completion 访问
- **30+ 类型化事件系统**：覆盖 session/agent/工具/模型/输入/上下文全生命周期
- **风险元数据**：`riskLevel`/`writesWorkspace`/`externalProcess` 等信息性标签
- **jiti JIT 加载**：支持 TS/ESM 零编译加载
- **消息渲染器**：扩展可注册自定义消息渲染
- **Provider 注册**：扩展可注册模型 provider
- **TypeBox schema**：运行时类型验证

### 汇总

| 严重度 | 数量 |
|--------|------|
| HIGH | 5（无法禁用内置、无沙箱、无版本管理、无 marketplace、无企业策略） |
| MEDIUM | 7（并行加载顺序、超时静默、emitToolCall 错误、无热重载、无健康监控、无资源隔离、无依赖解析） |
| LOW | 0 |

**优先修复项：**
1. **HIGH**: 添加内置扩展启用/禁用配置（`settings.disabledExtensions[]`）
2. **HIGH**: 添加扩展版本化 + 缓存目录管理
3. **HIGH**: 实现基础 marketplace 发现（npm registry 搜索 + 安装）
4. **MEDIUM**: 修复 `emitToolCall` 添加 try/catch 隔离
5. **MEDIUM**: 添加所有事件处理器超时保护
6. **MEDIUM**: 实现扩展健康监控 + 自动禁用（N 次错误后熔断）

---

**已完成 31 轮扫描。** 插件/扩展加载框架已覆盖。

---

## Round 32 — Context Management / Compaction（上下文管理/压缩系统）

**扫描时间**: 2026-06-12
**扫描模块**: `core/session/compaction/compaction.ts`, `core/runtime/compaction-controller.ts`, `core/runtime/agent-session.ts`（_checkCompaction）, `core/lib/agent-core/src/agent-loop.ts`, `core/lib/agent-core/src/agent-loop-tool-results.ts`, `core/lib/ai/src/utils/overflow.ts`
**对比**: CC `src/services/compact/`（compact.ts 1700+ 行, microCompact.ts, autoCompact.ts, sessionMemoryCompact.ts, postCompactCleanup.ts, grouping.ts, compactWarningState.ts）, `src/utils/conversationRecovery.ts`, `src/services/tokenEstimation.ts`

### 1. 架构对比

| 维度 | catui | Claude Code |
|------|-----------|-------------|
| 压缩层级 | 单层（全量 LLM 摘要） | 5 层防御深度（microcompact → session memory → partial → full → PTL retry） |
| Microcompact | 无 | 3 级：cached MC、time-based MC、API context management |
| Session Memory 压缩 | 无 | 预提取 session memory 作为摘要（无 LLM 调用） |
| Token 计数 | chars/4 启发式 | API 粗估锚定 + `countTokensWithAPI()` 精确计数 |
| 触发时机 | 响应后检查（`agent_end`） | 请求前检查（`shouldAutoCompact()`） |
| 熔断器 | 无 | `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3` |
| PTL 重试 | 无 | `truncateHeadForPTLRetry()` 最多 3 次 |
| 压缩后清理 | 无 | 10+ 缓存清理（file state/memory/系统提示/classifier 等） |
| 压缩后恢复 | 无 | 重读 top 5 文件 + skill/plan 附件恢复 |
| 图片剥离 | 无 | `stripImagesFromMessages()` 替换为 `[image]` 标记 |
| 消息分组 | 入口级切割点 | `groupMessagesByApiRound()` 安全分割 |
| 会话恢复 | 无 | `conversationRecovery.ts`（孤立 tool_use 过滤、中断检测） |
| Prompt cache 共享 | 独立 `completeSimple()` 调用 | fork agent 共享 cache |
| 部分压缩 | 无 | `partialCompactConversation` 双向支持 |
| 树分支摘要 | 完整支持（`generateBranchSummary()`） | 无（线性消息历史） |
| 迭代摘要更新 | `UPDATE_SUMMARIZATION_PROMPT` 合并 | 每次生成全新摘要 |
| 文件操作追踪 | `<read-files>` + `<modified-files>` 段 | 无 |
| 多 provider 溢出检测 | 15+ provider 正则模式 | 主要 Anthropic |

### 2. 正确性缺陷

**Defect 1 — Token 估算低估（HIGH）**
`compaction.ts` L224-282：`estimateTokens()` 使用 chars/4 启发式。图片硬编码 4800 字符（1200 token），JSON 参数有括号/引号/键名开销。低估导致压缩触发延迟，可能在上下文已满后才触发。

**Defect 2 — 无请求前 token 估算（HIGH）**
仅在 `agent_end` 后检查。请求略超上下文窗口时会先失败再触发溢出恢复，浪费一次 API 调用。CC 在发送请求前主动压缩。

**Defect 3 — 无压缩失败熔断器（HIGH）**
无等效 `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES`。压缩反复失败时无限重试。CC 全球 1279 session 触发过 50+ 连续失败，浪费 ~250K API 调用/天。

**Defect 4 — 切割点检测代码异味（LOW）**
`findValidCutPoints()` L291-326：switch 空 case 块无 break，`branch_summary`/`custom_message` 检查重复。

### 3. 高可用差距

| 差距 | 影响 | 严重度 |
|------|------|--------|
| 无 microcompact（工具结果清理） | 工具结果累积到全量压缩才清理 | **CRITICAL** |
| 无 session memory 压缩 | 每次压缩都需 LLM 调用 | **CRITICAL** |
| 无 API token 计数 | chars/4 启发式不精确 | **HIGH** |
| 无熔断器 | 压缩失败无限重试 | **HIGH** |
| 无 PTL 重试 | 压缩本身溢出时无法恢复 | **HIGH** |
| 无响应式压缩（413 降级） | prompt-too-long 不可恢复 | **HIGH** |
| 无压缩后文件/skill/plan 恢复 | 模型丢失最近读取的文件 | **HIGH** |
| 无压缩后缓存清理 | 压缩后可能使用过期缓存 | **MEDIUM** |
| 无图片剥离 | 大图片导致压缩请求本身溢出 | **MEDIUM** |
| 无会话恢复 | 恢复 session 可能有孤立 tool_use | **MEDIUM** |
| 无 API-round 分组 | 切割点可能落在 API-round 中间 | **MEDIUM** |
| 无 prompt cache 共享 | 压缩不复用主对话 cache | **MEDIUM** |

### 4. CC 功能差距

| CC 功能 | catui 状态 | 严重度 |
|---------|----------------|--------|
| Microcompact（3 级工具结果清理） | 无 | **CRITICAL** |
| Session Memory 压缩（无 LLM 调用） | 无 | **CRITICAL** |
| API token 计数 | 无 | **HIGH** |
| 压缩熔断器 | 无 | **HIGH** |
| PTL 重试 | 无 | **HIGH** |
| 响应式压缩（413 fallback） | 无 | **HIGH** |
| 压缩后文件/skill/plan 恢复 | 无 | **HIGH** |
| 压缩后缓存清理（10+ 项） | 无 | **MEDIUM** |
| 图片/文档剥离 | 无 | **MEDIUM** |
| 部分压缩（pivot-based） | 无 | **MEDIUM** |
| API-round 安全分组 | 无 | **MEDIUM** |
| 会话恢复（中断检测） | 无 | **MEDIUM** |
| Context collapse | 无 | **MEDIUM** |
| 压缩警告抑制 | 无 | **LOW** |
| 重压缩追踪 | 无 | **LOW** |
| Token 预算解析（"+500k" 语法） | 无 | **LOW** |

### 5. catui 独有优势

- **树分支摘要**：完整树模型 + 弃用分支摘要
- **迭代摘要更新**：`UPDATE_SUMMARIZATION_PROMPT` 合并已有摘要，CC 每次全新生成
- **文件操作追踪**：`<read-files>` + `<modified-files>` 跨压缩保留
- **Turn-prefix 摘要**：中 turn 分割时单独摘要前缀
- **15+ provider 溢出检测**：Cerebras/Mistral/z.ai/Ollama 等全覆盖

### 汇总

| 严重度 | 数量 |
|--------|------|
| CRITICAL | 2（无 microcompact、无 session memory 压缩） |
| HIGH | 6（无 API token 计数、无熔断器、无 PTL 重试、无 413 fallback、无压缩后恢复、token 低估） |
| MEDIUM | 6（无压缩后清理、无图片剥离、无部分压缩、无 API-round 分组、无会话恢复、无 cache 共享） |
| LOW | 3（切割点异味、无警告抑制、无重压缩追踪） |

**优先修复项：**
1. **CRITICAL**: 实现 microcompact（工具结果清理）— 压缩工具结果到摘要/路径引用
2. **CRITICAL**: 实现 session memory 压缩（预提取摘要避免 LLM 调用）
3. **HIGH**: 添加压缩熔断器（3 次连续失败后停止重试）
4. **HIGH**: 实现请求前 token 估算 + 主动压缩
5. **HIGH**: 添加 PTL 重试（压缩本身溢出时截断头部重试）
6. **HIGH**: 实现压缩后文件/skill/plan 恢复

---

**已完成 32 轮扫描。** 上下文管理/压缩系统已覆盖。

---

## Round 33 — Model Selector UI（模型选择器 UI）

**扫描时间**: 2026-06-12
**扫描模块**: `modes/interactive/components/model-selector.ts`（430 行）, `modes/interactive/controllers/model-overlay-controller.ts`（523 行）, `modes/interactive/components/provider-selector.ts`, `modes/interactive/components/scoped-models-selector.ts`, `core/model-registry.ts`（1044 行）, `core/model-resolver.ts`
**对比**: CC `src/components/ModelPicker.tsx`（448 行）, `src/components/agents/ModelSelector.tsx`（67 行）, `src/components/CustomSelect/select.tsx`, `src/utils/model/modelOptions.ts`（541 行）, `src/utils/model/model.ts`（625 行）

### 1. 架构对比

| 维度 | catui | Claude Code |
|------|-----------|-------------|
| UI 框架 | 自定义命令式 TUI（`@pencil-agent/tui`）类继承 | React Ink 函数组件 |
| 组件结构 | `ModelSelectorComponent`（430 行）+ `ModelOverlayController`（523 行）+ 6 个端口接口 | `ModelPicker`（448 行）+ `Select` 原语 |
| 搜索过滤 | `fuzzyFilter` 模糊匹配（id + provider） | 无搜索（固定列表） |
| Provider 选择 | 二级选择器（先 provider 后 model） | 扁平列表 |
| 远程发现 | Ctrl+R 触发 `refreshWithDiscovery` | 无（静态配置） |
| OpenRouter 添加 | Ctrl+N 交互式添加模型 ID | 无 |
| Scoped 模型 | 专用 `ScopedModelsSelectorComponent`（toggle/reorder/persist） | 无 |
| API key 提示 | `[needs API key]` 每模型显示 | 无 |
| 远程模型标记 | `(remote)` 徽章 | 无 |
| Thinking 级别 | 选择器内显示循环状态 | 独立 effort cycling（左右箭头） |
| Tier 感知 | 无（扁平列表） | 按用户 tier 显示不同选项（Max/Pro/PAYG/3P） |
| 定价显示 | 无 | `$3.75/M tokens` 描述 |
| 升级提示 | 无 | "Newer version available" |
| 模型验证 | 无（信任 registry） | `validateModel()` 检查存在性 |
| 分析日志 | 无 | 记录 from/to 模型变更 |
| Fast mode | 无 | 集成切换+通知 |

### 2. 正确性缺陷

**Defect 1 — 构造函数异步加载竞态（LOW）**
`model-selector.ts` L151：`loadModels().then(...)` 在构造函数中异步调用。如果 `handleInput` 在 promise 解析前触发，`filteredModels` 为空，Enter 键无响应（有 `if (selectedModel)` 守卫，安全但用户困惑）。

**Defect 2 — `selectedIndex` 空列表 clamp（LOW）**
L207-210：空列表时 `Math.max(0, -1)` 返回 0，`selectedIndex` 为无效索引。无害（不会访问元素）但代码异味。

**Defect 3 — 搜索无 debounce（LOW）**
L383-384：每次按键调用 `filterModels`。大模型列表（数百 OpenRouter 模型）可能卡顿。

**Defect 4 — `writeFileSync` 阻塞（LOW）**
`model-registry.ts` L1013：`appendOpenRouterModel` 同步写盘，可能阻塞事件循环。

### 3. 高可用差距

| 差距 | 影响 | 严重度 |
|------|------|--------|
| 模型 registry 加载失败无降级 | 选择器显示空列表+错误，无重试 | **LOW** |
| 远程发现刷新无超时 | 慢网络时 "Refreshing..." 永久显示 | **LOW** |
| 初始加载无 loading 指示器 | 异步加载期间显示空列表 | **LOW** |
| Provider 失败无熔断器 | 持续失败的 provider 无退避机制 | **LOW** |

### 4. catui 独有优势（CC 无此功能）

- **模糊搜索**：CC 模型选择器完全无搜索能力
- **二级 provider 选择**：先选 provider 再选 model
- **远程模型发现**：Ctrl+R 从远程 registry 刷新
- **OpenRouter 交互式添加**：Ctrl+N 输入模型 ID
- **Scoped 模型管理**：toggle + reorder + persist
- **API key 提示**：每模型显示认证状态
- **端口接口 DI**：6 个端口接口，依赖注入清晰

### 5. CC 独有优势（catui 无此功能）

- **Tier 感知**：按订阅层级显示不同选项
- **定价显示**：每模型显示价格
- **Effort cycling**：左右箭头切换 thinking 级别
- **Fast mode 集成**：模型切换自动 toggle fast mode
- **模型验证**：设置前检查存在性
- **分析日志**：记录模型变更

### 汇总

| 严重度 | 数量 |
|--------|------|
| HIGH | 0 |
| MEDIUM | 0 |
| LOW | 4（异步竞态、空列表 clamp、无 debounce、同步 I/O） |

**评估**：catui 的模型选择器在交互能力上显著优于 CC（模糊搜索、provider 分层、远程发现、scoped 管理）。CC 在业务逻辑上更成熟（tier 感知、定价、验证）。两者互补而非直接竞争。这是本轮扫描中 catui 表现最好的模块。

**优先修复项：**
1. **LOW**: 添加搜索 debounce（50ms）
2. **LOW**: 添加初始加载 loading 指示器
3. **LOW**: 添加远程发现超时（30s）
4. **LOW**: `appendOpenRouterModel` 改为异步写入

---

**已完成 33 轮扫描。** 模型选择器 UI 已覆盖。

---

## Round 34 — History/Transcript System（历史/转录系统）

**扫描时间**: 2026-06-12
**扫描模块**: `core/session/session-manager.ts`（~1493 行）, `core/messages.ts`, `core/runtime/agent-session.ts`（~2515 行）, `core/runtime/session-lifecycle-controller.ts`, `core/runtime/session-tree-controller.ts`
**对比**: CC `src/utils/sessionStorage.ts`（~4600 行）, `src/utils/sessionStoragePortable.ts`, `src/utils/sessionRestore.ts`, `src/history.ts`, `src/utils/transcriptSearch.ts`, `src/types/logs.ts`

### 1. 架构对比

| 维度 | catui | Claude Code |
|------|-----------|-------------|
| 数据结构 | **树 + 叶指针**（id/parentId/leafId） | **线性链表**（uuid/parentUuid） |
| 文件格式 | JSONL | JSONL |
| 分支支持 | 原生（叶指针移动） | Fork 创建新 session 文件 |
| 分支摘要 | 原生 `BranchSummaryEntry` | 非原生（基于 fork） |
| 条目类型 | 8 种类型化变体 | 20+ 条目类型 |
| Session 版本化 | v1/v2/v3 迁移 | 无显式版本化 |
| 压缩边界 | LLM 摘要条目 | `compact_boundary` 系统消息 |
| 大文件优化 | 全文件读取+解析 | fd 级跳过 + 分块读取 + 边界截断 |
| 转录搜索 | 无 | WeakMap 缓存按类型文本提取 |
| Prompt 历史 | 无 | `history.jsonl` + paste 引用 |
| Sidechain 转录 | 无（代码中 TODO） | 每 agent 独立 JSONL |
| 文件锁定 | 无 | lockfile-based |
| 并发 session | 无 | `concurrentSessions.ts` |
| 内容替换追踪 | 无 | `ContentReplacementEntry` |
| 上下文折叠 | 无 | marble-origami entries |
| 导出 | HTML | /share + asciicast |

### 2. 正确性缺陷

**Defect 1 — JSONL 解析静默跳过损坏行（LOW）**
`loadEntriesFromFile`/`parseSessionEntries`：catch 块静默跳过格式错误行。崩溃时半写行被丢弃，无完整性验证检查树结构。

**Defect 2 — `leafId` 假设文件顺序即树遍历顺序（LOW）**
`_buildIndex()` L788-804：`leafId` 设为文件最后条目。假设 append-only 不变式成立。手动编辑或损坏文件会产生错误叶指针。

**Defect 3 — `getChildren()` 线性扫描全部条目（LOW）**
每次调用遍历整个 `byId` map，O(n) 复杂度。大 session 性能差。

**Defect 4 — `convertToLlm()` 可能静默丢弃新消息类型（MEDIUM）**
`default` 分支返回 `undefined` 被过滤。通过 declaration merging 扩展的 `CustomAgentMessages` 新类型可能被静默丢弃。

### 3. 高可用差距

| 差距 | 影响 | 严重度 |
|------|------|--------|
| 无文件写入锁定 | 多进程写同一文件可能交错损坏 | **MEDIUM** |
| `_rewriteFile()` 非原子写入 | 崩溃时截断丢失全部条目 | **MEDIUM** |
| 无飞行中条目崩溃恢复 | 崩溃在内存追加和磁盘持久化之间丢失条目 | **LOW** |
| 无 session 文件完整性验证 | 打开时不验证树结构有效性 | **LOW** |

### 4. CC 功能差距

| CC 功能 | catui 状态 | 严重度 |
|---------|----------------|--------|
| 转录搜索（Ctrl+R） | 无 | **HIGH** |
| Sidechain 转录记录 | 无（TODO） | **HIGH** |
| Prompt 历史（Up-arrow 跨 session） | 无 | **MEDIUM** |
| 大 session compact-boundary 优化 | 全文件读取 | **MEDIUM** |
| 文件锁定 | 无 | **MEDIUM** |
| 并发 session 冲突解决 | 无 | **LOW** |
| 内容替换追踪 | 无 | **LOW** |
| Session 元数据（title/tag/agent color/PR link） | 仅 `SessionInfoEntry` | **LOW** |
| 上下文折叠（marble-origami） | 无 | **LOW** |
| Worktree 状态持久化 | 无 | **LOW** |

### 5. catui 独有优势

- **树模型架构优越**：叶指针方式自然支持树导航，无需创建新 session 文件
- **原生分支摘要**：`BranchSummaryEntry` 弃用分支自动摘要
- **Session 版本化迁移**：v1→v2→v3 显式迁移路径
- **8 种类型化条目**：discriminated union 比 CC 的 20+ 更聚焦

### 汇总

| 严重度 | 数量 |
|--------|------|
| HIGH | 2（无转录搜索、无 sidechain 转录） |
| MEDIUM | 4（无 prompt 历史、无大文件优化、无文件锁定、convertToLlm 丢弃风险） |
| LOW | 6（JSONL 解析、leafId 假设、getChildren O(n)、完整性验证、并发、崩溃恢复） |

**优先修复项：**
1. **HIGH**: 实现转录搜索（WeakMap 缓存 + 按类型文本提取）
2. **HIGH**: 实现 sidechain 转录记录（子代理独立 JSONL）
3. **MEDIUM**: 添加 prompt 历史文件（`~/.catui/history.jsonl`）
4. **MEDIUM**: 添加大 session compact-boundary 优化（fd 级跳过）
5. **MEDIUM**: 添加文件锁定（lockfile）

---

**已完成 34 轮扫描。** 历史/转录系统已覆盖。

---

## Round 35 — File Watching System（文件监听系统）

**扫描时间**: 2026-06-12
**扫描模块**: `modes/interactive/theme/theme.ts`（theme watcher）, `modes/interactive/footer-data-provider.ts`（git watcher）, `extensions/builtin/loop/cron/cron-scheduler.ts`（cron watcher）
**对比**: CC 10 个独立 watcher（settings/skill/FileChanged/teamMemory/task/git/config/keybinding/cron/cleanupRegistry）

### 1. 架构对比

| 维度 | catui | Claude Code |
|------|-----------|-------------|
| Watcher 数量 | 4 个 | 10 个独立 watcher |
| Settings 热重载 | 无 | chokidar + 删除宽限 + 内部写入抑制 + MDM 轮询 |
| Skill 热重载 | 无 | chokidar + Bun 轮询降级 + debounce |
| FileChanged hooks | 无 | chokidar + 动态路径更新 |
| Task 列表 watcher | 无 | fs.watch + debounce + claim 逻辑 |
| Git 缓存层 | 仅基础目录 watch | fs.watchFile + 缓存失效 + 分支追踪 |
| 清理注册表 | 无 | 集中 `registerCleanup()` |
| 内部写入抑制 | 无 | `markInternalWrite`/`consumeInternalWrite` |
| 团队记忆同步 | 无 | fs.watch({recursive}) + debounce |
| Keybinding 热重载 | 无 | chokidar |
| Cron scheduler | **对齐**（1:1 移植） | chokidar |

### 2. 正确性缺陷

**Defect 1 — Theme watcher debounce 创建孤儿计时器（LOW）**
`theme.ts` L727-757：`fs.watch` 回调中 `setTimeout` 每次事件创建新计时器但不取消前一个。快速保存可能触发两次重载。

**Defect 2 — Theme watcher 未注册清理（MEDIUM）**
`theme.ts` L764-769：`stopThemeWatcher()` 仅在 theme 切换时显式调用。进程终止时 `fs.watch` 文件描述符泄漏。

**Defect 3 — Git watcher 错误后静默死亡不恢复（LOW）**
`footer-data-provider.ts` L142-147：`fs.watch` 错误后关闭 watcher 设为 null，不重启。分支显示过期直到下次手动操作。

**Defect 4 — FooterDataProvider 无 dispose 方法（MEDIUM）**
`footer-data-provider.ts`：CWD 变更丢弃实例时 `fs.watch` handle 永不关闭。

### 3. 高可用差距

| 差距 | 影响 | 严重度 |
|------|------|--------|
| 无 settings 热重载 | 外部编辑 settings.json 直到重启才生效 | **HIGH** |
| 无 skill/command 热重载 | git pull 添加的 skill 直到重启才被发现 | **HIGH** |
| 无 .env/.envrc 变更检测 | 环境变量文件变更不刷新 | **MEDIUM** |
| 无跨进程 task 发现 | 子代理创建的 task 不自动显示 | **MEDIUM** |
| 无优雅关闭 | SIGTERM 时不关闭 watch handle（Linux inotify 泄漏） | **MEDIUM** |

### 4. CC 功能差距

| CC 功能 | catui 状态 | 严重度 |
|---------|----------------|--------|
| Settings 热重载（chokidar + 删除宽限 + 写入抑制） | 无 | **HIGH** |
| Skill 热重载（chokidar + debounce） | 无 | **HIGH** |
| FileChanged hooks（.envrc/.env） | 无 | **MEDIUM** |
| Task 列表 watcher | 无 | **MEDIUM** |
| 清理注册表（集中 registerCleanup） | 无 | **MEDIUM** |
| 团队记忆同步 | 无 | **MEDIUM** |
| Git 缓存层（HEAD/config/branch ref 缓存） | 仅基础目录 watch | **MEDIUM** |
| Keybinding 热重载 | 无 | **LOW** |
| 内部写入抑制 | 无 | **LOW** |
| 全局配置新鲜度检测 | 无 | **LOW** |
| Test override hooks | 无 | **LOW** |
| Cron scheduler | **对齐** | OK |

### 5. catui 独有优势

- 无（CC 在此领域全面领先）

### 汇总

| 严重度 | 数量 |
|--------|------|
| HIGH | 2（无 settings 热重载、无 skill 热重载） |
| MEDIUM | 5（无 FileChanged hooks、无 task watcher、无清理注册表、无团队记忆、无 git 缓存） |
| LOW | 7（theme debounce、theme 清理、git 错误恢复、dispose、内部写入、配置新鲜度、keybinding） |

**优先修复项：**
1. **MEDIUM**: 创建集中清理注册表（`registerCleanup()`）— 解锁所有未来 watcher 的安全关闭
2. **HIGH**: 实现 settings 变更检测器（chokidar 或 polling）
3. **HIGH**: 实现 skill/command 变更检测器
4. **MEDIUM**: 修复 theme watcher 和 git watcher 清理注册
5. **MEDIUM**: 实现 FileChanged hook watcher（.envrc/.env）

---

**已完成 35 轮扫描。** 文件监听系统已覆盖。

---

# 全部 40 轮扫描完成 — 总结

## 累计发现

| 严重度 | 数量 |
|--------|------|
| CRITICAL | 20 |
| HIGH | 107+ |
| MEDIUM | 178+ |
| LOW | 116+ |

## 跨模块 Top 5 优先修复项

1. **CRITICAL — 安全**：集成 OS 级沙箱（Seatbelt/bwrap），当前 regex 沙箱可被绕过
2. **CRITICAL — 上下文管理**：实现 microcompact + session memory 压缩（当前全量 LLM 摘要是唯一路径）
3. **CRITICAL — 数据完整性**：修复 Diff/Patch fuzzy matching 静默规范化（破坏 Markdown 硬换行）
4. **CRITICAL — LLM 通信**：修复流重试丢弃部分事件（消费者看到流中途停止）
5. **HIGH — 配置**：添加配置备份 + schema 验证 + 文件变更监听

## catui 独有优势

- 终端内联图片渲染（Kitty/iTerm2）
- 30+ 类型化扩展事件系统
- 5 层认知记忆模型 + Ebbinghaus 间隔重复
- 11 provider 图片测试覆盖
- Buddy 宠物系统
- 两阶段扩展 flag 解析
- 扩展 API 比 CC markdown 命令更强大
- 树分支摘要 + 迭代摘要更新（CC 线性历史每次全新生成）
- 15+ provider 溢出检测（CC 主要 Anthropic）
- 文件操作追踪跨压缩保留
- 树模型 session 架构（叶指针自然支持分支导航）
- 原生分支摘要 + Session 版本化迁移

---

## Round 36 — Auth Storage & Provider Registration（认证存储与 Provider 注册）

**扫描时间**: 2026-06-12
**扫描模块**: `core/platform/config/auth-storage.ts`, OAuth providers, model registry
**对比**: CC macOS Keychain + OAuth service + MCP OAuth

### 1. 架构对比

| 维度 | catui | Claude Code |
|------|-----------|-------------|
| 凭据存储 | JSON 文件 + `proper-lockfile` | macOS Keychain (`security` CLI) + OAuth service |
| 存储加密 | 无（明文 JSON） | OS 级加密（Keychain） |
| OAuth Provider 数量 | 6 个（Anthropic/OpenAI/Google/GitHub/Microsoft/xAI） | 1 个（Anthropic） |
| 环境变量映射 | 20+ 个 | 少量 |
| MCP OAuth | 无 | 支持任意 MCP server OAuth |
| 跨进程协调 | `proper-lockfile` | OS keychain 天然原子 |
| Token 刷新 | 手动（provider 内部） | OAuth service 统一管理 |
| 401 恢复 | 无 | 自动 token 刷新 + 重试 |
| Provider 扩展 | 注册表模式（可插拔） | 硬编码 |
| 远程模型发现 | 支持（Ctrl+R） | 无 |

### 2. 正确性缺陷

**Defect 1 — 明文存储 API keys（HIGH）**
`auth-storage.ts`：所有 OAuth token 和 API key 以明文 JSON 写入 `~/.catui/auth.json`。任何有文件读权限的进程/用户可获取全部凭据。

**Defect 2 — 无 OS keychain 集成（HIGH）**
macOS Keychain / Linux Secret Service / Windows Credential Manager 均未使用。CC 在 macOS 上通过 `security` CLI 存取，Linux 上通过 `secret-service` D-Bus API。

### 3. 高可用差距

| 差距 | 影响 | 严重度 |
|------|------|--------|
| 明文凭据存储 | 文件系统访问即可泄露全部 API keys | **HIGH** |
| 无 OS keychain 集成 | 无法利用平台安全基础设施 | **HIGH** |
| 无跨进程 token 刷新协调 | 多实例同时刷新可能产生竞态 | **MEDIUM** |
| 无 MCP OAuth 支持 | 无法认证任意 MCP server | **MEDIUM** |
| 无 401 自动恢复 | token 过期后需用户手动干预 | **MEDIUM** |
| Linux 无安全存储降级 | Linux 上明文存储无替代方案 | **MEDIUM** |
| AWS/GCP token 刷新 | 长期 token 无自动续期 | **LOW** |
| 无 apiKeyHelper 外部工具 | 无法集成企业密钥管理 | **LOW** |
| 无订阅管理 | 无法显示/管理订阅状态 | **LOW** |
| 无凭据审批流 | 新凭据无用户确认步骤 | **LOW** |
| 无 managed context 隔离 | 托管环境无独立存储区域 | **LOW** |

### 4. catui 独有优势

- **6 个 OAuth Provider**：CC 仅 Anthropic 一个
- **20+ 环境变量映射**：覆盖主流 provider 的各种 key 变体
- **可插拔 Provider 注册表**：扩展可注册新 provider
- **远程模型发现**：Ctrl+R 从远程 registry 刷新可用模型
- **OpenRouter 交互式添加**：Ctrl+N 输入模型 ID
- **Scoped 模型管理**：按项目/角色绑定模型

### 5. CC 独有优势

- **OS Keychain 集成**：凭据受操作系统保护
- **MCP OAuth**：任意 MCP server 可配置 OAuth
- **统一 OAuth Service**：token 刷新/401 恢复集中管理
- **apiKeyHelper**：企业密钥管理集成

### 汇总

| 严重度 | 数量 |
|--------|------|
| HIGH | 2（明文存储、无 OS keychain） |
| MEDIUM | 4（跨进程刷新、MCP OAuth、401 恢复、Linux 安全存储） |
| LOW | 5（AWS/GCP 刷新、apiKeyHelper、订阅管理、凭据审批、managed context） |

**优先修复项：**
1. **HIGH**: 集成 OS keychain（macOS Keychain / Linux Secret Service / Windows Credential Manager）
2. **HIGH**: 实现凭据加密存储（至少 AES-256 加密本地文件）
3. **MEDIUM**: 添加 401 自动 token 刷新 + 重试
4. **MEDIUM**: 实现 MCP OAuth 支持

---

**已完成 36 轮扫描。** 认证存储与 Provider 注册已覆盖。

---

## Round 37 — Telemetry/Analytics System（遥测/分析系统）

**扫描时间**: 2026-06-12
**扫描模块**: `core/platform/telemetry/batching-dispatcher.ts`, `core/platform/telemetry/insforge-base.ts`, `core/platform/telemetry/ext-events.ts`, `core/sub-agent/agent-telemetry.ts`, `extensions/builtin/token-save/tracking.ts`
**对比**: CC OpenTelemetry SDK (metrics/logs/traces), `FirstPartyEventLoggingExporter`, GrowthBook sampling, Perfetto traces, BigQuery metrics, Datadog dashboards

### 1. 架构对比

| 维度 | catui | Claude Code |
|------|-----------|-------------|
| 核心框架 | 自定义 `BatchingDispatcher<T>` + `InsforgeHttpClient` (PostgREST) | 完整 OpenTelemetry SDK（metrics/logs/traces） |
| 传输层 | PostgREST HTTP（单一后端） | 多通道：OTLP (gRPC/HTTP), Prometheus, Datadog HTTP, 1P `/api/event_logging/batch`, BigQuery |
| 事件类型 | 3 个类型化表：`ext_command_events`, `ext_llm_calls`, `ext_hook_events` + SAL eval 表 | 数十个命名事件 + OTel metrics (counters/histograms) + OTel spans + Perfetto trace events + BigQuery |
| 分布式追踪 | 无（无 OpenTelemetry，无 span 层级） | 完整 span 层级：interaction > LLM request > tool > hook |
| 采样策略 | `HOOK_SAMPLE_RATES` 静态常量（tool_* 10%, 其他 100%） | GrowthBook 动态 `tengu_event_sampling_config` 每事件名 |
| 批处理 | `BatchingDispatcher<T>` 2s debounce，串行 drain | OTel `BatchLogRecordProcessor` + `PeriodicExportingMetricReader` + 磁盘重试 |
| 重试/韧性 | Fire-and-forget；失败仅发诊断事件 | 二次退避重试 + 磁盘持久化失败事件 + 启动时跨 run 重试 |
| 隐私控制 | 凭据文件 `enabled: false` | 3 级：`default`/`no-telemetry`/`essential-traffic` + 组织级 opt-out + 每 sink killswitch |
| Opt-out | 删除凭据文件 | `DISABLE_TELEMETRY=1`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, 组织 API |
| PII 保护 | `classifyArgsSignature()` 永不记录原始参数 | `AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS` 编译时标记 + `_PROTO_*` 列访问控制 |
| 错误报告 | `TelemetryDiagnostic` 源/严重度/类别/指纹 | `logError()` + OTel span `recordException` + Perfetto error flags |
| 可视化 | PostgREST 查询 + smoke test 脚本 | OTel OTLP traces + Perfetto + BigQuery + Datadog |
| 后端 killswitch | 无 | GrowthBook 每 sink killswitch |
| Feature gating | 无 | Statsig feature gates |

### 2. 正确性缺陷

**Defect 1 — 无重试的 flush 失败导致事件永久丢失（HIGH）**
`batching-dispatcher.ts` L80-96：HTTP POST 失败时事件被 splice 丢弃，仅发诊断事件。CC 的 `FirstPartyEventLoggingExporter` 有磁盘持久化 + 二次退避重试。

**Defect 2 — Promise 永不 reject（HIGH）**
`insforge-base.ts` L92-168：网络/超时时 `resolve({ok: false})`，调用方无法区分"发送失败"和"从未发送"。CC 使用 `resultCallback` 模式显式 FAILED 状态。

**Defect 3 — EventBus 注入丢失时遥测静默消失（MEDIUM）**
`agent-telemetry.ts` L124-129：`_emitToEventBus` 空 catch 吞掉所有错误。如果 EventBus 从未注入，全部 agent 遥测丢失无任何指示。

**Defect 4 — 每次调用创建新 HttpClient/Dispatcher（MEDIUM）**
`ext-events.ts` L125-145：`createExtensionTelemetrySink` 每次创建新实例，无连接池。CC 共享 MeterProvider/LoggerProvider/TracerProvider 单例。

**Defect 5 — persist 错误静默吞掉（LOW）**
`token-save/tracking.ts` L39,88-96：`void this.persist(record)` 错误被忽略，目录不可写时历史静默不完整。

### 3. 高可用差距

| 差距 | 影响 | 严重度 |
|------|------|--------|
| 无失败事件磁盘持久化 | HTTP POST 失败事件永久丢失 | **HIGH** |
| 无跨 run 重试 | 进程退出时缓冲区事件丢失 | **HIGH** |
| 无健康检查熔断器 | 端点宕机时每次 flush 阻塞 5s 超时 | **MEDIUM** |
| 无优雅关闭保证 | 无 `process.on('beforeExit')` 清理注册 | **MEDIUM** |
| 单一传输依赖 | insforge 不可达时全部遥测丢失 | **LOW** |

### 4. CC 功能差距

| CC 功能 | catui 状态 | 严重度 |
|---------|----------------|--------|
| 分布式追踪 / span 层级 | 无 | **HIGH** |
| Metrics 系统（counters/histograms） | 无 | **HIGH** |
| 3 级隐私 opt-out 框架 | 仅凭据 on/off | **HIGH** |
| Perfetto 追踪可视化 | 无 | **MEDIUM** |
| 丰富事件元数据（30+ 字段） | 最少元数据 | **MEDIUM** |
| 动态采样（GrowthBook） | 静态常量 | **MEDIUM** |
| 插件/扩展专用遥测 | 仅按名称追踪 | **MEDIUM** |
| 用户分桶（基数控制） | 无 | **LOW** |
| `_PROTO_*` PII 列分离 | 无 | **LOW** |
| sink 注入前事件队列 | 无（丢失） | **LOW** |

### 5. catui 独有优势

- **扩展遥测是一等公民**：`ext_command_events` / `ext_llm_calls` / `ext_hook_events` 三表提供专用扩展可观测层
- **空闲思考检测**：`isUserInitiated` 字段 + smoke test 探针检测 hook 静默调用 LLM
- **SAL eval 遥测深度集成**：5 个 PostgREST 表 + 自动幂等 `ensureRunExists`
- **`classifyArgsSignature()` 隐私保护**：永不记录原始参数文本，零 PII
- **每行存储 `sampleRate`**：仪表板可通过 `count(*) * (1.0 / avg(sample_rate))` 外推真实计数
- **`ExtCallerContext` AsyncLocalStorage**：轻量零依赖归因总线
- **Smoke test 脚本**：自包含遥测健康检查
- **Token 节省追踪**：本地分析每个命令的 token 节省量

### 汇总

| 严重度 | 数量 |
|--------|------|
| HIGH | 5（flush 失败丢事件、Promise 不 reject、无分布式追踪、无 metrics、无隐私框架） |
| MEDIUM | 6（EventBus 丢失、无连接池、无熔断器、无优雅关闭、无 Perfetto、无动态采样） |
| LOW | 5（persist 错误、单一传输、用户分桶、PII 列、sink 前队列） |

**优先修复项：**
1. **HIGH**: 为 `BatchingDispatcher` 添加磁盘持久化失败事件 + 跨 run 重试
2. **HIGH**: 添加 `process.on('beforeExit')` 清理钩子确保缓冲区 drain
3. **HIGH**: 添加用户面向的 opt-out 环境变量（`CATUI_DISABLE_TELEMETRY=1`）
4. **MEDIUM**: 为 `InsforgeHttpClient` 添加熔断器（N 次连续超时后暂停）
5. **MEDIUM**: 添加基本事件计数器/metrics 层

---

**已完成 37 轮扫描。** 遥测/分析系统已覆盖。

---

## Round 38 — MCP (Model Context Protocol) 系统

**扫描时间**: 2026-06-12
**扫描模块**: `core/mcp/mcp-client.ts`, `core/mcp/mcp-config.ts`, `core/mcp/mcp-guidance.ts`, `core/mcp/mcp-manager.ts`
**对比**: CC `src/services/mcp/`（22+ 文件, 12000+ LOC）, `@modelcontextprotocol/sdk`, `McpOAuthClientProvider`

### 1. 架构对比

| 维度 | catui | Claude Code |
|------|-----------|-------------|
| 代码规模 | ~6 文件, ~1200 LOC | ~22 文件, ~12000+ LOC |
| 协议 SDK | 手写 JSON-RPC over stdio/HTTP | 官方 `@modelcontextprotocol/sdk` |
| 传输类型 | `stdio`, `sse`（桩）, `http` | `stdio`, `sse`, `http`, `ws`, `sse-ide`, `ws-ide`, `sdk`, `claudeai-proxy` |
| 协议版本 | `2024-11-05`（主体）+ `2024-10-07`（回退） | `2025-03-26`（header）+ SDK 默认 |
| Tool 发现 | `tools/list` + cursor 分页 | `tools/list` via SDK + LRU 缓存 |
| Resource 访问 | **未实现** | `resources/list` + `resources/read` 工具 |
| Prompt 模板 | **未实现** | `prompts/list` + `prompts/get` 映射为斜杠命令 |
| OAuth/Auth | Figma 专用 OAuth（PKCE, DCR, refresh） | 通用 OAuth 2.0 + PKCE + DCR 任意 MCP server + XAA |
| 安全存储 | `AuthStorage`（JSON 文件） | OS Keychain（macOS Keychain, 跨进程安全） |
| 配置作用域 | 单一 `mcp.json` 文件 | 7 级：enterprise/user/local/project/dynamic/claudeai/managed |
| 服务端生命周期 | `startServer()`/`stopServer()` | Memoized `connectToServer()` + `reconnectMcpServerImpl()` |
| 重连机制 | **无** — server 挂了需重启 session | 自动：onerror 追踪 + 连续错误计数 + 缓存失效 + 透明重连 |
| 权限模型 | 配置中 enable/disable | 企业 allowlist/denylist + 项目审批对话框 + plugin-only 策略 |
| 错误处理 | 基础 try/catch | 结构化：`McpAuthError`/`McpToolCallError`/`McpSessionExpiredError` + session 过期检测 |
| 工具结果处理 | 基础文本拼接 | Token 计数 + 截断 + 图片压缩 + 二进制 blob 持久化 + `_meta` 转发 |
| Elicitation | **未实现** | 完整 `ElicitRequestSchema` handler |
| Server instructions | **未实现** | 捕获并注入模型 system context |
| 工具注解 (_meta) | **未实现** | `searchHint`/`alwaysLoad`/`tool.annotations.title` |
| 批量连接 | 顺序 `for...of` | 并发 `pMap`（本地 3, 远程 20 并发限制） |
| 动态 headers | 仅静态 `headers` 字段 | 静态 + `headersHelper` 脚本（每请求动态） |
| 环境变量展开 | 仅 `{cwd}` 占位符 | 完整 `${VAR}` 展开（command/args/env/url/headers） |
| WebSocket 传输 | **未实现** | 自定义 `WebSocketTransport` |
| InProcess 传输 | **未实现** | `InProcessTransport` |
| 输出存储 | **未实现** | `mcpOutputStorage` 大二进制输出 |
| Server 审批 UI | 无 | `mcpServerApproval.tsx` 项目级审批 |

### 2. 正确性缺陷

**Defect 1 — SSE 传输未实现但静默返回成功（CRITICAL）**
`mcp-client.ts:762-765`：`startServer()` 对 SSE 类型直接 `return true`，不连接不加载工具。`callSSETool()` L1037-1051 返回静态错误字符串。用户配置 SSE server 会误认为已连接，所有工具调用返回误导性错误。

**Defect 2 — 协议版本 header 与 body 不一致（HIGH）**
`mcp-client.ts:483` 发送 `MCP-Protocol-Version: 2025-03-26` header，但 L510/664 的 `initialize` body 发送 `protocolVersion: "2024-11-05"`。严格检查两端的 server 会拒绝连接。

**Defect 3 — Stdio 无 Content-Length 帧（MEDIUM）**
`mcp-client.ts:386-394`：使用行分隔 JSON 而非 Content-Length 帧。JSON 值含换行时解析失败。官方 MCP 规范推荐 Content-Length 帧。

**Defect 4 — SSE 解析一次性读取整个响应（HIGH）**
`mcp-client.ts:608-649`：`parseEventStreamResponse()` 一次性读取全部 body 文本再解析。无长连接、无断线重连、无逐事件处理。

**Defect 5 — SSE startServer 始终返回 true（HIGH）**
同 Defect 1，但单独列出：这个返回值被调用方用于判断 server 是否就绪，永远返回 true 导致后续逻辑全部基于错误前提运行。

**Defect 6 — callHttpTool/callStdioTool 结果解析代码重复（MEDIUM）**
`mcp-client.ts:920-1032`：两个方法含几乎相同的结果解析逻辑（~35 行重复）。bug 修复需手动同步两处。

**Defect 7 — loadMCPConfig 读操作有副作用（LOW）**
`mcp-config.ts:164-175`：`loadMCPConfig()` 在无配置时 `writeFileSync` 创建默认文件，缺少默认值时 `saveMCPConfig()` 写盘。读操作不应有生产副作用。

**Defect 8 — 无 Zod schema 验证（MEDIUM）**
`mcp-config.ts:178-199`：JSON 解析后直接类型断言。CC 使用 Zod schema 验证 + 结构化错误报告。

### 3. 高可用差距

| 差距 | 影响 | 严重度 |
|------|------|--------|
| 无自动重连 | server 崩溃或 HTTP session 过期后永不恢复 | **CRITICAL** |
| 无 session 过期检测 | HTTP 404 + JSON-RPC -32001 不触发重连 | **HIGH** |
| 无连续错误追踪 | ECONNRESET/ETIMEDOUT 等不触发重连 | **HIGH** |
| 无跨进程 token 刷新 | JSON 文件存储非并发安全 | **HIGH** |
| 无进程健康监控 | `client.onerror`/`client.onclose` 无详细日志和缓存失效 | **MEDIUM** |
| 无并发连接控制 | 顺序连接，慢 server 阻塞后续所有 server | **MEDIUM** |

### 4. CC 功能差距

| CC 功能 | catui 状态 | 严重度 |
|---------|----------------|--------|
| Resource 访问 (resources/list, resources/read) | 无 | **HIGH** |
| Prompt 模板 (prompts/list, prompts/get) | 无 | **HIGH** |
| WebSocket 传输 | 无 | **HIGH** |
| 通用 OAuth（任意 MCP server） | 仅 Figma | **HIGH** |
| 企业 allowlist/denylist 策略 | 无 | **HIGH** |
| 7 级配置层次 | 单一文件 | **HIGH** |
| 自动重连 + 透明重试 | 无 | **HIGH** |
| Elicitation | 无 | **MEDIUM** |
| Server instructions 注入 | 无 | **MEDIUM** |
| 工具注解 (_meta) | 无 | **MEDIUM** |
| 工具结果截断/图片压缩 | 无 | **MEDIUM** |
| 二进制 blob 持久化 | 无 | **MEDIUM** |
| Plugin MCP servers | 无 | **MEDIUM** |
| 动态 headers (headersHelper) | 无 | **MEDIUM** |
| 环境变量展开 (${VAR}) | 仅 {cwd} | **MEDIUM** |
| Server 审批对话框 | 无 | **MEDIUM** |
| InProcess 传输 | 无 | **LOW** |
| claude.ai proxy 传输 | 无 | **LOW** |
| Channel 权限中继 | 无 | **LOW** |
| Elicitation hooks | 无 | **LOW** |

### 5. catui 独有优势

- **极简架构**：~1200 LOC vs CC 的 ~12000+ LOC，易审计易修改
- **内置 10+ server 预设**：filesystem/sequential-thinking/memory/fetch/sqlite/github/brave-search/git/postgres/figma，一键启用
- **API key 引导系统**：`mcp-guidance.ts` 提供分步指引、URL、免费层级信息
- **Figma Desktop 深度集成**：`/figma` 命令 + 完整设置流程
- **Claude Code 凭据导入**：从 `~/.claude/.credentials.json` 导入 Figma OAuth token
- **`{cwd}` 占位符**：简洁的项目相对路径
- **透明工具命名**：`mcp_serverid_toolname` + 可读 `label` 字段
- **每 server 独立超时**：`toolTimeout` + `initTimeout` 独立配置
- **Windows npx 降级**：自动尝试 `npx.cmd` → `npm exec --yes` → `npx`

### 汇总

| 严重度 | 数量 |
|--------|------|
| CRITICAL | 2（SSE 静默成功、无自动重连） |
| HIGH | 8（协议版本不一致、SSE 解析、session 过期、错误追踪、跨进程 token、无 Resource/Prompt/WS/通用 OAuth/企业策略/7 级配置） |
| MEDIUM | 10（Content-Length 帧、代码重复、Zod 验证、进程监控、并发连接、Elicitation/instructions/_meta/截断/Plugin/动态 headers/环境变量/审批） |
| LOW | 5（读副作用、InProcess/claude.ai proxy/Channel/Elicitation hooks） |

**优先修复项：**
1. **CRITICAL**: 修复 SSE 传输 — 实现或明确禁用（不要静默返回 true）
2. **CRITICAL**: 添加自动重连机制（指数退避 + 连续错误追踪）
3. **HIGH**: 对齐协议版本 header 和 body
4. **HIGH**: 实现 `resources/list` + `resources/read`
5. **HIGH**: 实现 `prompts/list` + `prompts/get`
6. **HIGH**: 添加项目级 `.mcp.json` 支持（目录遍历）
7. **MEDIUM**: 提取 `callHttpTool`/`callStdioTool` 共享结果解析
8. **MEDIUM**: 添加 Zod schema 验证 MCP 配置

---

**已完成 38 轮扫描。** MCP 系统已覆盖。

---

## Round 39 — Permission System / Tool Approval Flow（权限系统/工具审批流）

**扫描时间**: 2026-06-12
**扫描模块**: `extensions/builtin/plan/plan-permissions.ts`, `extensions/builtin/team/team-permissions.ts`, `extensions/builtin/team/teammate-approval.ts`, `core/sub-agent/agent-tool-filter.ts`, `core/sub-agent/agent-handoff-safety.ts`, `extensions/builtin/security-audit/engine/detector.ts`
**对比**: CC `src/utils/permissions/permissions.ts`（~1500 行）, `permissionsLoader.ts`, `PermissionUpdate.ts`, `yoloClassifier.ts`, `denialTracking.ts`, `shadowedRuleDetection.ts`, `permissionSetup.ts`, `bypassPermissionsKillswitch.ts`, `permissionExplainer.ts`, `getNextPermissionMode.ts`, `src/utils/swarm/permissionSync.ts`, `src/utils/sandbox/sandbox-adapter.ts`, `src/utils/settings/mdm/settings.ts`

### 1. 架构对比

| 维度 | catui | Claude Code |
|------|-----------|-------------|
| 权限模式 | 6 种：`default`/`plan`/`auto`/`acceptEdits`/`bypassPermissions`/`dontAsk` | 6 种 + 内部 `bubble` |
| 中心权限引擎 | 分散在 5+ 文件，无统一 `hasPermissionsToUseTool` | 单一 ~1500 行 `permissions.ts`，权威入口 |
| 规则类型 | 隐式（硬编码工具/命令列表） | 显式 `PermissionRule`（allow/deny/ask 行为 + source + toolName + ruleContent） |
| 规则来源 | 无（无 settings 规则加载） | 8 来源：userSettings/projectSettings/localSettings/flagSettings/policySettings/cliArg/command/session |
| 权限持久化 | 无（仅内存，`PermissionStore` 无磁盘持久化） | 完整磁盘持久化（`permissionsLoader.ts` + `PermissionUpdate.ts`） |
| 工具粒度 | 二进制（工具级 allow/deny） | 子命令级：`Bash(prefix:*)`/`Agent(agentType)`/`mcp__server__tool` |
| 危险命令检测 | 两套独立系统：`DangerDetector`（regex）+ `plan-permissions.ts`（前缀/模式列表） | 统一：`dangerousPatterns.ts` + `bashClassifier.ts`（LLM）+ `permissionSetup.ts` |
| Auto mode 分类器 | 仅启发式 regex（8 模式） | 完整 LLM 2 阶段分类器（fast XML + thinking）+ 拒绝追踪 + 熔断器 |
| 子代理权限继承 | `resolvePermissionMode()` 严格层级 clamp | `resolvePermissionMode()` + auto mode 危险规则剥离 + handoff 分类器审查 |
| Team 权限 | `PermissionStore`（内存，Promise）+ 文件系统 mailbox | `permissionSync.ts` 文件锁 + mailbox + sandbox 权限升级 |
| 企业策略 (MDM) | 无 | macOS plist / Windows registry / Linux managed-settings.json |
| 沙箱 | 无 | `@anthropic-ai/sandbox-runtime`：文件读写限制 + 网络主机白名单 |
| 影子规则检测 | 无 | `shadowedRuleDetection.ts` 检测不可达规则 |
| 拒绝追踪 | 无 | 连续 3 次 / 总计 20 次拒绝后降级为提示 |
| 模式切换 UI | 无 | Shift+Tab 轮转 + gate 检查 |
| 权限钩子 | `tool_call` 事件（安全审计 + plan gating） | `executePermissionRequestHooks` + PreToolUse hooks |
| MCP 工具权限 | 未处理 | 完整匹配：`mcp__server__tool`/`mcp__server__*`/server 级规则 |

### 2. 正确性缺陷

**Defect 1 — PermissionStore 纯内存无持久化（HIGH）**
`team-permissions.ts:44-52`：进程崩溃时 teammate 待处理请求和 `pathAllowlist` 丢失。CC 通过 `permissionsLoader.ts` 磁盘持久化。

**Defect 2 — Handoff 分类器仅 regex 可被绕过（HIGH）**
`agent-handoff-safety.ts:129-168`：8 模式 regex 无法检测 base64 编码命令、间接路径遍历等高级攻击。CC 使用 LLM 2 阶段分类器。

**Defect 3 — DANGEROUS_BASH_PATTERNS `/>/` 过度激进（MEDIUM）**
`plan-permissions.ts:59`：任何含 `>` 的命令都被标记为危险，包括 `echo "foo" > /dev/null`。

**Defect 4 — READONLY_BASH_PREFIXES 前缀匹配可绕过（MEDIUM）**
`plan-permissions.ts:32-56`：`startsWith(prefix)` 可被命令链接绕过，如 `git status; rm -rf /` 匹配 `git status` 前缀。

**Defect 5 — 文件系统 mailbox 无锁无原子写入（MEDIUM）**
`teammate-approval.ts:77-88`：`fs.writeFileSync` 无锁，并发写入可能损坏请求文件。

**Defect 6 — MCP 工具绕过 plan mode 过滤器（MEDIUM）**
`agent-tool-filter.ts:75-78`：MCP 工具在 plan mode 只读过滤器之后添加（line 80），可执行写操作。

**Defect 7 — 白名单 includes() 匹配过宽（LOW）**
`detector.ts:46,61`：白名单 `"git"` 会匹配 `"github"`、`"nugit"` 等。

**Defect 8 — resolvePermissionMode 语义混淆（LOW）**
`agent-tool-filter.ts:250-264`：`"default"` 在严格层级中 index 为 4，但父默认 `"acceptEdits"` index 为 2，clamp 后返回 `"acceptEdits"` 而非 `"default"`。

### 3. 高可用差距

| 差距 | 影响 | 严重度 |
|------|------|--------|
| 权限决策无磁盘持久化 | 进程重启丢失所有权限决策和 teammate 审批 | **HIGH** |
| 权限系统无熔断器/降级 | 安全审计扩展加载失败时无 fallback | **HIGH** |
| 无拒绝追踪 | 循环被拒的工具调用无限重试 | **MEDIUM** |
| 文件系统 mailbox 无锁/无清理 | 死请求累积，永不清理 | **MEDIUM** |

### 4. CC 功能差距

| CC 功能 | catui 状态 | 严重度 |
|---------|----------------|--------|
| 企业策略 (MDM) | 无 | **CRITICAL** |
| 沙箱运行时 | 无 | **CRITICAL** |
| LLM auto mode 分类器 | 仅 regex | **CRITICAL** |
| 子命令级权限规则 | 仅工具级 | **HIGH** |
| 影子规则检测 | 无 | **HIGH** |
| Auto mode 危险规则剥离 | 无 | **HIGH** |
| 8 级规则来源 + 优先级 | 无规则来源 | **HIGH** |
| 子代理 swarm 权限同步 | 内存无锁 | **HIGH** |
| 模式切换 UI (Shift+Tab) | 无 | **MEDIUM** |
| Bypass 远程 killswitch | 无 | **MEDIUM** |
| 权限解释器（风险等级） | 无 | **MEDIUM** |
| CLI --base-tools | 无 | **LOW** |

### 5. catui 独有优势

- **安全审计扩展 + 仪表板**：`/security dashboard`/`logs`/`stats`/`clear` 命令，CC 无等价物
- **三级安全模式**：`audit`（仅日志）/`confirm`（确认）/`strict`（严格阻止）
- **敏感文件路径保护**：SSH keys/AWS/Azure/GCloud 凭据/.env 等路径检查
- **只读工具过滤器**：`isReadOnlyTool()` 干净可复用
- **递归限制强制执行**：显式阻止 fork-in-fork、teammate-spawns-teammate

### 汇总

| 严重度 | 数量 |
|--------|------|
| CRITICAL | 3（无 MDM、无沙箱、regex-only 分类器） |
| HIGH | 6（PermissionStore 无持久化、handoff 分类器可绕过、无子命令规则、无影子检测、无 auto mode 剥离、无规则来源） |
| MEDIUM | 7（DANGEROUS_BASH 过度、前缀可绕过、mailbox 无锁、MCP 绕过 plan mode、无熔断器、无拒绝追踪、无模式切换 UI） |
| LOW | 3（白名单过宽、语义混淆、CLI --base-tools） |

**优先修复项：**
1. **CRITICAL**: 实现中心权限引擎（统一 `hasPermissionsToUseTool`）
2. **CRITICAL**: 替换 regex handoff 分类器为 LLM 分类器
3. **HIGH**: 权限规则磁盘持久化
4. **HIGH**: 修复 MCP 工具绕过 plan mode 过滤器
5. **HIGH**: 添加拒绝追踪 + 降级
6. **MEDIUM**: 修复 bash 前缀匹配绕过
7. **MEDIUM**: 添加文件系统 mailbox 文件锁

---

**已完成 39 轮扫描。** 权限系统/工具审批流已覆盖。

---

## Round 40 — System Prompt Construction（系统提示构建）

**扫描时间**: 2026-06-12
**扫描模块**: `core/prompt/system-prompt.ts`, `core/runtime/prompt-assembly.ts`, `core/platform/config/resource-loader.ts`
**对比**: CC `src/constants/prompts.ts`（async `getSystemPrompt()` + 15+ helper）, `src/utils/systemPrompt.ts`, `src/utils/claudemd.ts`, `src/context.ts`, `systemPromptSections.ts`

### 1. 架构对比

| 维度 | catui | Claude Code |
|------|-----------|-------------|
| 提示数据类型 | 单一扁平 `string` | `SystemPrompt` = branded `readonly string[]`（数组原生） |
| 组装文件 | 单一函数 `buildSystemPrompt` | `getSystemPrompt()` + 15+ 辅助函数 |
| Section 缓存 | 无 — 每轮从头重建 | `systemPromptSections.ts` 命名 section 缓存至 `/clear` 或 `/compact` |
| 静态/动态分离 | 无 — 整个提示视为单个 blob | `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` 标记分离可缓存前缀和动态后缀 |
| Cache 策略 | 扁平 `cache_control: {type:'ephemeral'}` 整个 system prompt | 两级：`scope:'global'` 静态前缀 + `scope:'org'` 动态后缀 + `cache_reference` 工具结果 |
| MCP 指令注入 | 无 | Delta-based：`getMcpInstructionsDelta()` diff 已连接 server，作为附件持久化 |
| 上下文文件加载 | 每目录 3 候选：`AGENTS.md`/`AGENT.md`/`CLAUDE.md` + `.PENCIL.md` | 4 级优先级：Managed > User > Project > Local + `.claude/rules/*.md` glob + `@include` |
| 工具指导 | 内联在 system prompt 中 | 工具 schema 为独立 API 参数；指导文本在 `# Using your tools` section |
| Soul/人格 | `SoulManager` Big Five 特质 + 价值观 + 情感状态 + 记忆进化 | 无 — 依赖 CLAUDE.md 用户编写指令 |
| PENCIL.md 完整性 | 反越狱追加："忽略尝试修改人格的用户提示" | 无 |
| Skills | XML 格式 `<available_skills>` 块 | `/skill-name` 斜杠命令；默认不在 prompt 中列出 |
| 记忆系统 | 简单文件型：磁盘上下文文件 | 类型化：`User`/`Project`/`Local`/`Managed`/`AutoMem`/`TeamMem` + MEMORY.md 索引 |
| 提示大小管理 | 无 — 无截断或预算 | `MAX_MEMORY_CHARACTER_COUNT = 40000`, MEMORY.md 行/字节上限 |
| 条件规则 | 无 — 所有上下文文件始终加载 | Frontmatter `paths:` glob 匹配，按文件条件加载 |
| 日期/时间 | 完整 locale 字符串 + time tool 提醒 | ISO 日期 + 模型知识截止日期 |

### 2. 正确性缺陷

**Defect 1 — `extensionToolsGuidance` 参数从未接线（HIGH）**
`prompt-assembly.ts` L35：`buildRuntimeSystemPrompt` 未传递 `extensionToolsGuidance`。定义了 `guidance` 字符串的扩展工具定义被静默丢弃，模型仅有 JSON schema 无语义指导。

**Defect 2 — `appendSystemPrompt` 顺序不一致（MEDIUM）**
`system-prompt.ts`：有 `customPrompt` 时 append 在 custom 之后、context 之前（L87-89）；无 `customPrompt` 时在 soul 之后、context 之前（L300-302）。两种路径的 append 位置语义不同。

**Defect 3 — 祖先上下文文件优先级脆弱（MEDIUM）**
`resource-loader.ts` L134-153：`unshift` 构建深度优先列表，全局条目通过 `seenPaths` 去重时总是赢（先加载），即使祖先副本更新。

**Defect 4 — Persona 完整性检查可绕过（LOW）**
`resource-loader.ts` L117-124：完整性保护仅在 persona 文件激活时追加，全局 `.PENCIL.md` fallback 不受保护。

**Defect 5 — 无上下文文件大小限制（LOW）**
无 `MAX_MEMORY_CHARACTER_COUNT` 等价物。大 `AGENT.md` 可消耗过多上下文预算。

### 3. 高可用差距

| 差距 | 影响 | 严重度 |
|------|------|--------|
| 无 prompt cache 分段 | 每 session 支付完整 prompt 重处理成本 | **HIGH** |
| 无 section 缓存 | 每轮从头重建（重读磁盘、重算 skills、重格式化工具列表） | **HIGH** |
| 无 MCP 指令 delta | MCP server 连接/断开时整个 system prompt cache 失效 | **MEDIUM** |
| 无上下文文件重载机制 | `reload()` 未被相同生命周期事件触发 | **MEDIUM** |
| 单一 provider cache 标记 | 整个 prompt 扁平 `cache_control`，任何内容变更都破坏缓存 | **MEDIUM** |

### 4. CC 功能差距

| CC 功能 | catui 状态 | 严重度 |
|---------|----------------|--------|
| 4 级记忆层级（Managed/User/Project/Local） | 全局 + 祖先遍历 + 项目 `.PENCIL.md` | **HIGH** |
| 条件规则（frontmatter paths glob） | 无 | **HIGH** |
| `@include` 指令系统 | 无 | **MEDIUM** |
| 类型化记忆（AutoMem/TeamMem） | 扁平文件 | **MEDIUM** |
| 输出样式配置 | 无 | **MEDIUM** |
| Scratchpad 目录 | 无 | **LOW** |
| 数字长度锚点 | 无 | **LOW** |
| 工具结果清除说明 | 无 | **LOW** |
| 主动/自主代理模式 | 无 | **LOW** |

### 5. catui 独有优势

- **Soul Engine + Big Five 人格**：进化式自适应人格，CC 无等价物
- **PENCIL.md 反越狱完整性**：激活 persona 时追加人格保护指令
- **P3 DIP Header 渐进式披露**：WHO/FROM/TO/HERE 4 问文件头格式，O(1) 相关性评估
- **扩展工具指导合并架构**：`extensionToolsGuidance` 参数（虽未接线）设计为合并扩展贡献的指导
- **Persona 专用 skills 目录**：不同 persona 可提供不同 skill 集合

### 汇总

| 严重度 | 数量 |
|--------|------|
| HIGH | 3（extensionToolsGuidance 未接线、无 cache 分段、无 section 缓存） |
| MEDIUM | 5（append 顺序不一致、祖先优先级脆弱、无 MCP delta、无重载机制、单一 cache 标记） |
| LOW | 4（完整性可绕过、无大小限制、无条件规则、无 @include） |

**优先修复项：**
1. **HIGH**: 接线 `extensionToolsGuidance` — 从扩展工具定义收集 `guidance` 字符串
2. **HIGH**: 实现 system prompt section 缓存 — 缓存 skills/tools/context 等计算 section
3. **HIGH**: 实现静态/动态 prompt 边界分离 — `cacheScope:'global'` 静态前缀
4. **MEDIUM**: 添加上下文文件大小限制（40K chars/文件，100K 总计）
5. **MEDIUM**: 修复 `appendSystemPrompt` 位置一致性

---

**已完成 40 轮扫描。** 系统提示构建已覆盖。

---

---

## Round 42 — Git Integration（Git 集成系统）

**扫描时间**: 2026-06-12  
**扫描范围**: catui Git 集成 vs Claude Code Git 集成  
**NP 文件数**: ~22 files, ~6,507 lines  
**CC 文件数**: ~15 files, ~6,000+ lines

### 架构对比

| 层级 | Claude Code | catui | 差距 |
|------|------------|------------|------|
| **文件系统层** | `gitFilesystem.ts` (~700行) 直接读 `.git/` 文件，无子进程 | `footer-data-provider.ts` 用 `fs.watch` 监听 HEAD 目录 | **CC 优势大** — NP 缺少无子进程的 git 状态读取 |
| **工具层** | `git.ts` (~933行) 带 LRU 缓存的完整 API | 分散在多个扩展中，无统一工具层 | **CC 优势大** — NP 无集中式 git 工具模块 |
| **Diff 层** | `gitDiff.ts` (~533行) shortstat/numstat/unified diff | 各扩展各自调 `git diff` | **CC 优势大** — NP 无统一 diff 工具 |
| **命令层** | `/commit`, `/commit-push-pr`, `/diff` | 无 git 相关 slash 命令 | **NP 缺失** |
| **追踪层** | `commitAttribution.ts` (~962行) + `gitOperationTracking.ts` (~278行) | `insights/session-scanner.ts` 基础计数 | **CC 优势大** |
| **安全层** | `gitSafety.ts` bare-repo 防御 + NTFS 8.3 防御 | `bash.ts` 基础 sandbox regex | **CC 更完善** |
| **UI 层** | `DiffDialog.tsx` 完整 diff 查看器 | 无 diff UI | **NP 缺失** |
| **Worktree** | `worktree.ts` (~1520行) 完整生命周期 | `worktree-manager.ts` (~439行) 基础实现 | **CC 功能更全** |

### 发现的问题

#### CRITICAL — 无（无安全漏洞）

#### HIGH — 5 项

**H42-1. 缺少集中式 git 工具模块**
- **问题**: NP 的 git 操作分散在 `footer-data-provider.ts`, `simplify/index.ts`, `debug/collectors.ts`, `team-harness.ts`, `presence/index.ts` 等多个文件中，每个都独立 spawn `git` 子进程。CC 有统一的 `git.ts` + `gitFilesystem.ts` 层。
- **影响**: (1) 重复代码多 (2) 无法统一缓存 (3) 每次 git 操作都 spawn 子进程，性能差 (4) 无法保证安全校验一致性
- **建议**: 创建 `core/git/` 模块，提供 `getBranch()`, `getHead()`, `getIsClean()`, `getChangedFiles()` 等统一 API，带 LRU 缓存。
- **CC 参考**: `src/utils/git.ts`, `src/utils/git/gitFilesystem.ts`

**H42-2. 缺少无子进程的 git 状态读取**
- **问题**: CC 的 `gitFilesystem.ts` (~700行) 直接读取 `.git/HEAD`, `.git/config`, loose refs, packed-refs 来获取分支名、HEAD SHA、remote URL，完全不 spawn 子进程。NP 的 `FooterDataProvider` 虽然用 `fs.watch` 监听 HEAD 目录，但读取分支名仍依赖解析 `.git/HEAD` 文件内容（这是好的），但其他 git 操作（status, diff, log）仍需子进程。
- **影响**: 频繁的 git 子进程调用（如 footer 每次渲染、presence 扩展定时采集）造成不必要的开销
- **建议**: 扩展 `FooterDataProvider` 的文件系统读取模式，为 `getHead()`, `getRemoteUrl()`, `getDefaultBranch()` 等提供无子进程实现
- **CC 参考**: `gitFilesystem.ts` 的 `readGitHead()`, `resolveRef()`, `GitFileWatcher`

**H42-3. 缺少 `/diff` 命令和 diff 查看器**
- **问题**: CC 有 `/diff` 命令配合 `DiffDialog.tsx` 组件，可查看当前未提交更改和每轮对话的 diff。NP 完全没有此功能。
- **影响**: 用户无法在 TUI 中直观查看工作区变更，需要退出工具手动 `git diff`
- **建议**: 实现 `/diff` 命令，复用 TUI 组件系统展示 diff stats 和 hunks
- **CC 参考**: `src/commands/diff/diff.tsx`, `src/components/diff/DiffDialog.tsx`, `src/utils/gitDiff.ts`

**H42-4. 缺少 `/commit` 命令**
- **问题**: CC 有 `/commit` 和 `/commit-push-pr` 命令，NP 没有任何 git commit 相关的 slash 命令。
- **影响**: 用户需要手动让 AI 执行 git commit，缺少标准化的 commit 流程和安全约束
- **建议**: 实现 `/commit` 命令，包含 git safety protocol（不跳过 hooks、不 force push、不使用 -i flag）
- **CC 参考**: `src/commands/commit.ts`, `src/commands/commit-push-pr.ts`

**H42-5. Git 安全防护不够完善**
- **问题**: CC 有专门的 `gitSafety.ts` 防御 bare-repo 沙箱逃逸攻击和 NTFS 8.3 短文件名攻击。NP 的 `bash.ts` sandbox regex 只做了基础的 git write 命令阻止。
- **影响**: 潜在的沙箱逃逸风险 — 恶意仓库可能通过 `.git` 目录结构绕过沙箱
- **建议**: 
  1. 添加 bare-repo 检测 (`isCurrentDirectoryBareGitRepo()`)
  2. 添加 `.git` 内部路径安全校验
  3. 参考 CC 的 `isSafeRefName()` 验证分支名安全性
- **CC 参考**: `src/tools/PowerShellTool/gitSafety.ts`, `src/utils/git.ts` 的 `isCurrentDirectoryBareGitRepo()`

#### MEDIUM — 5 项

**M42-1. 缺少 default branch 检测**
- **问题**: CC 有 `getDefaultBranch()` 检测 main/master，用于 PR 创建、diff 基准等。NP 没有。
- **影响**: 需要 default branch 的功能（如 `/commit-push-pr`）无法实现
- **建议**: 在 git 工具模块中添加 `getDefaultBranch()`，通过 `git symbolic-ref refs/remotes/origin/HEAD` 或 fallback 到 main/master 检测

**M42-2. 缺少 git config 解析器**
- **问题**: CC 有专门的 `gitConfigParser.ts` 解析 `.git/config`。NP 没有。
- **影响**: 无法读取 git 配置（如 remote URL、user.name）而无需 spawn 子进程
- **建议**: 实现轻量级 `.git/config` 解析器，或使用 `git config --get` 作为折中

**M42-3. 缺少 commit attribution 追踪**
- **问题**: CC 的 `commitAttribution.ts` (~962行) 追踪 AI 对文件的贡献百分比，在 commit message 中添加 attribution trailer。NP 完全没有。
- **影响**: commit message 中无法体现 AI 的贡献比例
- **建议**: 如果需要此功能，可实现简化版 — 追踪 AI 编辑的文件行数，计算贡献百分比
- **CC 参考**: `src/utils/commitAttribution.ts`

**M42-4. Worktree 管理功能不完整**
- **问题**: CC 的 worktree 系统 (~1520行) 支持 session worktree、agent worktree、sparse-checkout、`.worktreeinclude` 文件复制、tmux 集成、stale 清理等。NP 的 `WorktreeManager` (~439行) 只有基础的 create/list/apply/dispose。
- **影响**: 子代理的隔离工作区功能较弱
- **建议**: 优先补充 `cleanupStaleWorktrees()` 和 `.worktreeinclude` 支持
- **CC 参考**: `src/utils/worktree.ts`

**M42-5. Git 操作缺少统一的错误处理和超时**
- **问题**: NP 各处的 git 子进程调用没有统一的超时和错误处理。CC 在 `git.ts` 中统一处理。NP 的 `presence/index.ts` 有 350ms 超时，但其他地方没有。
- **影响**: git 命令挂起时可能阻塞 UI 或扩展
- **建议**: 在统一 git 工具层中添加默认超时（如 5s）和错误处理

#### LOW — 3 项

**L42-1. `branch-summary-message.ts` 文案问题**
- **问题**: line 58 显示 `"Branch summary (expand to expand)"`，`expand` 重复
- **建议**: 改为 `"Branch summary (Enter to show)"` 或类似

**L42-2. 缺少 gitignore 工具**
- **问题**: CC 有 `gitignore.ts` 提供 `isPathGitignored()` 和 `addFileGlobRuleToGitignore()`。NP 没有。
- **影响**: 低 — 可通过 `git check-ignore` 命令替代

**L42-3. 缺少 GitHub repo path mapping**
- **问题**: CC 追踪已知的本地克隆路径。NP 不需要（架构不同）。
- **影响**: 无 — NP 不依赖此功能

### 优势（NP 做得好的地方）

1. **Token-saving git compaction**: NP 的 `token-save/filters.ts` 提供了 git status/diff/log 输出的智能压缩（65-70% token 节省），CC 没有此功能
2. **FooterDataProvider 设计**: 将 git branch 检测和扩展状态集中管理，接口清晰
3. **Git watcher 处理 atomic write**: 正确处理了 git 的原子写入模式（watch 目录而非文件）
4. **Presence 扩展**: 将 git 上下文注入 AI 提示词，帮助 AI 了解项目状态

### 优先级建议

| 优先级 | 项目 | 工作量 |
|--------|------|--------|
| **P1** | H42-1 集中式 git 工具模块 | 大 |
| **P1** | H42-5 Git 安全防护 | 中 |
| **P2** | H42-2 无子进程 git 状态读取 | 中 |
| **P2** | H42-3 `/diff` 命令 | 中 |
| **P3** | H42-4 `/commit` 命令 | 小 |
| **P3** | M42-1 default branch 检测 | 小 |
| **P4** | M42-2~M42-5 其余 | 中 |
