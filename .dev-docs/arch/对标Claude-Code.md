# 对标 Claude Code：catui 工具体系

> 本文档记录 catui agent 当前的完整工具清单、参数规格与实现机制，用于与 Claude Code 的工具体系进行横向对比。

---

## 工具架构概览

catui 的工具系统分三层：

| 层级 | 来源 | 数量 | 注册方式 |
|------|------|------|----------|
| **核心工具** | `core/tools/` | 8 | 启动时静态注册到 `allTools` |
| **扩展工具** | `extensions/builtin/` | 28 | 各扩展通过 `api.registerTool()` 动态注册 |
| **MCP 工具** | 外部 MCP Server | 运行时决定 | 通过 `MCPManager` 动态注入 |

**静态定义工具总数：36**

工具注册表由 `ToolOrchestrator`（`core/tools/orchestrator.ts`）统一管理，维护全量 registry 和当前 active 工具列表。

---

## 核心工具（8 个）

源码路径：`core/tools/`

### 1. read

| 项目 | 内容 |
|------|------|
| 描述 | 读取文件内容，支持文本文件和图片（jpg/png/gif/webp） |
| 参数 | `path`（必填）, `offset?`, `limit?` |
| 实现 | 检测 MIME 类型，图片返回 base64 附件；文本按行切分后应用 offset/limit 窗口，再经 `truncateHead` 截断。截断时附带续读提示（如 "Use offset=N to continue"）。成功读取文本文件后填充 `fileStateCache`（LRU 缓存，记录 mtime/内容/offset/limit），供 edit/write 的 staleness 检测使用。支持 AbortSignal。 |
| 工厂 | `createReadTool(cwd, options?)` |

### 2. bash

| 项目 | 内容 |
|------|------|
| 描述 | 执行 bash 命令，返回 stdout/stderr |
| 参数 | `command`（必填）, `timeout?`（秒） |
| 实现 | 以 detached 模式 spawn 用户配置的 shell，stdout/stderr 流式写入内存缓冲区；超限则溢出到临时文件。完成后应用 `truncateTail` 截断尾部输出。支持 `commandPrefix`（别名展开）、`spawnHook`（拦截 spawn 上下文）、`createSandboxHook`（只读子 agent 屏蔽写操作：重定向/rm/mv/git commit/push 等）。超时通过 `killProcessTree` 实现。 |
| 工厂 | `createBashTool(cwd, options?)` |

### 3. edit

| 项目 | 内容 |
|------|------|
| 描述 | 通过精确文本匹配替换文件内容（surgical edit） |
| 参数 | `path`（必填）, `oldText`（必填）, `newText`（必填） |
| 实现 | **两阶段 staleness 检测**：① `validateInput` 检查 `fileStateCache` 中是否存在该文件记录（未 read 则拒绝）；② `execute` 中比较 `fs.stat()` mtime 与缓存 timestamp（外部修改则拒绝并清除缓存）。读取文件后剥离 BOM、统一换行符为 LF，使用 `fuzzyFindText` 模糊定位 oldText，验证唯一性（出现多次则拒绝），执行替换后恢复原始换行符，写回文件并生成 unified diff。成功写入后更新 `fileStateCache`。支持 `beforeWrite` guard hook。 |
| 工厂 | `createEditTool(cwd, options?)` |

### 4. write

| 项目 | 内容 |
|------|------|
| 描述 | 写入文件，不存在则创建，存在则覆盖，自动创建父目录 |
| 参数 | `path`（必填）, `content`（必填） |
| 实现 | **Staleness 检测**：若文件已存在且 `fileStateCache` 有记录，比较 `fs.stat()` mtime 与缓存 timestamp（外部修改则拒绝）；缓存无记录时允许写入（新建文件场景）。解析绝对路径后 `mkdir({ recursive: true })` 创建父目录，UTF-8 写入。成功写入后更新 `fileStateCache`。支持 `beforeWrite` guard hook。 |
| 工厂 | `createWriteTool(cwd, options?)` |

### 5. grep

| 项目 | 内容 |
|------|------|
| 描述 | 搜索文件内容，返回匹配行及文件路径、行号，尊重 .gitignore |
| 参数 | `pattern`（必填）, `path?`, `glob?`, `ignoreCase?`, `literal?`, `context?`, `limit?`（默认 100） |
| 实现 | 委托给 `ripgrep`（`rg`），以 `--json` 模式解析输出流收集匹配事件。context 行通过缓存的文件内容切片获取。每行单独截断到 `GREP_MAX_LINE_LENGTH`，整体经 `truncateHead` 截断。达到 match limit 后 kill rg 进程。支持 `GrepOperations` 接口用于远程执行。 |
| 工厂 | `createGrepTool(cwd)` |

### 6. find

| 项目 | 内容 |
|------|------|
| 描述 | 按 glob 模式查找文件，尊重 .gitignore |
| 参数 | `pattern`（必填）, `path?`, `limit?`（默认 1000） |
| 实现 | 委托给 `fd`（fast finder CLI），以 `--glob --hidden --max-results N` 启动。收集搜索树中所有 `.gitignore` 文件通过 `--ignore-file` 传入。结果转为相对路径后经 `truncateHead` 截断。支持 `FindOperations.glob` 自定义实现绕过 fd。 |
| 工厂 | `createFindTool(cwd)` |

### 7. ls

| 项目 | 内容 |
|------|------|
| 描述 | 列出目录内容，按字母排序，目录加 `/` 后缀，含 dotfiles |
| 参数 | `path?`, `limit?`（默认 500） |
| 实现 | 使用 `readdirSync` + `statSync` 判断目录，`localeCompare` 不区分大小写排序。唯一完全同步的核心工具（无子进程）。 |
| 工厂 | `createLsTool(cwd)` |

### 8. time

| 项目 | 内容 |
|------|------|
| 描述 | 获取当前系统时间，用于时间敏感的问题 |
| 参数 | `timeZone?`（IANA 时区）, `locale?` |
| 实现 | `new Date()` 格式化为四种形式：ISO 8601、locale 人类可读、时区名、epoch 毫秒。无参数时回退到 `Intl.DateTimeFormat` 系统时区。 |
| 工厂 | `createTimeTool()` |

---

## 核心工具 TUI 渲染

### 渲染架构

```
Agent Loop 事件
    ↓
StreamRenderController（事件 → 组件编排）
    ↓
ToolExecutionComponent（渲染决策）
    ├── 内置工具 → formatToolExecution() / renderBashContent()
    └── 扩展工具 → toolDefinition.renderCall() / renderResult()
    ↓
TUI 引擎（差异渲染到终端）
```

两条渲染路径：
- **内置工具**（read/bash/edit/write/grep/find/ls/time）：`ToolExecutionComponent` 内的 `formatToolExecution()` 统一处理，按工具名分支
- **扩展工具**：通过 `ToolDefinition` 接口的 `renderCall()` / `renderResult()` 回调返回自定义 Component 树

### 核心源码

| 文件 | 职责 |
|------|------|
| `modes/interactive/components/tool-execution.ts` | 中心组件：渲染工具调用参数和结果，内置/扩展渲染分发 |
| `modes/interactive/controllers/stream-render-controller.ts` | 事件控制器：将 `AgentSessionEvent` 映射为 UI 动作 |
| `modes/interactive/components/diff.ts` | Diff 渲染：unified diff 着色，行内词级 diff |
| `core/tools/edit-diff.ts` | Edit diff 计算：异步预执行 diff 预览，模糊文本匹配 |
| `modes/interactive/components/bash-execution.ts` | 用户 `!` 命令的独立渲染组件（非 AI bash 工具） |
| `modes/interactive/components/visual-truncate.ts` | 视觉行截断：考虑换行折叠的实际行数计算 |
| `modes/interactive/theme/theme.ts` | 主题系统：工具相关色值 token + `highlightCode()` 语法高亮 |
| `core/export-html/tool-renderer.ts` | HTML 导出渲染器：ANSI → HTML 转换 |

### ToolExecutionComponent 结构

`ToolExecutionComponent` 是 `Container` 子类，构造时创建两个渲染策略：

| 渲染目标 | 使用者 | 说明 |
|----------|--------|------|
| `contentBox: Box` | bash 工具、带自定义渲染器的扩展工具 | 支持视觉行截断（`truncateToVisualLines()`） |
| `contentText: Text` | read/write/edit/grep/find/ls/time | 纯文本 + ANSI 样式 |

决策点在 `shouldUseBuiltInRenderer()`：工具名在 `allTools` 中且 `ToolDefinition` 无自定义 `renderCall`/`renderResult` 时走内置路径。

### 事件驱动的渲染流程

```
1. message_update（流式 token 到达）
   → 遍历 toolCall 内容块
   → 创建新 ToolExecutionComponent 或 updateArgs() 更新已有组件
   → 工具调用 UI 随 token 流逐步出现

2. message_end（assistant 消息结束）
   → 对 pending 工具组件调用 setArgsComplete()
   → 触发 edit diff 异步计算（预览）
   → 若消息被中止/出错，设置所有 pending 工具为 error 结果

3. tool_execution_start
   → 若流式阶段未创建组件（非流式场景），此时创建

4. tool_execution_update
   → updateResult(result, isPartial=true) 更新部分结果

5. tool_execution_end
   → updateResult(result, isPartial=false) 设置最终结果
   → 从 pending 工具 map 中移除
```

### 可见性控制

`shouldRenderToolTrace()` 控制是否显示工具 trace：
- `nanomem_*` 工具：检查 `showMemoryTrace` 设置
- 其他工具：检查 `showWorkingTrace` 设置

### 各工具渲染细节

#### read

| 项目 | 内容 |
|------|------|
| 标题 | `read ~/path/to/file` + 可选 `:startLine-endLine` 行范围 |
| 正文 | 折叠态 10 行 / 展开态全部行 |
| 特性 | `highlightCode()` 语法高亮（语言从文件扩展名推断）；截断警告以 `warning` 色显示 |

#### bash

| 项目 | 内容 |
|------|------|
| 标题 | `bash` + 超时信息 |
| 正文 | 通过 `contentBox` 渲染，视觉行截断为 5 行（折叠态） |
| 特性 | `$ ` 命令前缀；超时显示；`fullOutputPath` 提示完整输出路径；视觉行截断（`truncateToVisualLines()`）考虑换行折叠 |

#### edit

| 项目 | 内容 |
|------|------|
| 标题 | `edit ~/path/to/file:lineNumber`（行号来自 `editDiffPreview.firstChangedLine`） |
| 正文 | 通过 `renderDiff()` 渲染 unified diff |
| 特性 | **异步预执行 diff 预览**：`setArgsComplete()` 触发 `computeEditDiff()`，在工具执行前就展示 diff；执行完成后用 `result.diff` 替换。行内词级 diff：当恰好 1 行删除 + 1 行新增时，使用 `Diff.diffWords()` 高亮变更 token |

#### write

| 项目 | 内容 |
|------|------|
| 标题 | `write ~/path/to/file` |
| 正文 | 折叠态 10 行，语法高亮 |
| 特性 | `writeHighlightCache`：流式写入时增量语法高亮缓存，避免每次 token 到达时全量重新高亮 |

#### ls

| 项目 | 内容 |
|------|------|
| 标题 | `ls ~/path` + 可选 `(limit N)` |
| 正文 | 折叠态 20 行 |

#### find

| 项目 | 内容 |
|------|------|
| 标题 | `find pattern in path` + 可选 `(limit N)` |
| 正文 | 折叠态 20 行 |

#### grep

| 项目 | 内容 |
|------|------|
| 标题 | `grep /pattern/ in path` + 可选 glob 和 limit 信息 |
| 正文 | 折叠态 15 行 |

#### time

| 项目 | 内容 |
|------|------|
| 标题 | 工具名 + `JSON.stringify(args)` |
| 正文 | 通用 fallback 渲染，无特殊处理 |

#### 扩展工具（通用）

| 项目 | 内容 |
|------|------|
| 调用渲染 | `toolDefinition.renderCall(args, theme) => Component` |
| 结果渲染 | `toolDefinition.renderResult(result, { expanded, isPartial }, theme) => Component` |
| 特性 | 扩展提供完整的 Component 工厂，可实现任意 TUI 布局 |

### 背景色状态机

| 状态 | 背景色 token | 说明 |
|------|-------------|------|
| 流式接收中 | `toolPendingBg` | 工具参数正在流式到达 |
| 执行完成 | `toolSuccessBg` | 工具返回成功结果 |
| 执行出错 | `toolErrorBg` | 工具返回错误 |

### Diff 渲染（`renderDiff()`）

| 行类型 | 颜色 token | 特殊处理 |
|--------|-----------|----------|
| 上下文行 | `toolDiffContext`（dim） | 无 |
| 删除行 | `toolDiffRemoved`（red） | 变更 token 加 `theme.inverse()` 反色 |
| 新增行 | `toolDiffAdded`（green） | 变更 token 加 `theme.inverse()` 反色 |

行内词级 diff：当恰好 1 行删除 + 1 行新增时，使用 `Diff.diffWords()` 计算词粒度差异，在 `renderDiff()` 内对变更 token 应用 `theme.inverse()` 反色高亮。

### Edit Diff 预览机制

```
assistant 流式输出 edit 工具参数
    ↓
message_end → setArgsComplete()
    ↓
异步 computeEditDiff(oldText, newText, filePath)
    ├── 读取磁盘文件
    ├── fuzzyFindText() 模糊匹配（处理 BOM、smart quotes、Unicode dash）
    ├── generateDiffString() 生成 unified diff
    └── 返回 { diff, firstChangedLine }
    ↓
TUI 立即显示 diff 预览（工具尚未执行）
    ↓
tool_execution_end → 用 result.diff 替换预览
```

### 语法高亮（`highlightCode()`）

- 使用 `cli-highlight` 库
- 语言从文件扩展名通过 `getLanguageFromPath()` 推断（覆盖 60+ 扩展名）
- 主题色 token：`syntaxComment`、`syntaxKeyword`、`syntaxFunction`、`syntaxVariable`、`syntaxString`、`syntaxNumber`、`syntaxType`、`syntaxOperator`、`syntaxPunctuation`

### 视觉行截断（`truncateToVisualLines()`）

考虑终端换行折叠：创建临时 `Text` 组件 → 渲染 → 取最后 N 视觉行。用于 bash（5 行）和 bash-execution（20 行）的折叠预览。

### HTML 导出

`createToolHtmlRenderer()` 创建 HTML 渲染适配器，调用 `toolDef.renderCall()`/`renderResult()` 后通过 `ansiLinesToHtml()` 将 ANSI 转为 HTML，用于 `/export-html` 和 recap 渲染。

---

## 扩展工具（28 个）

源码路径：`extensions/builtin/`

### Plan 模式工具

#### 9. EnterPlanMode

| 项目 | 内容 |
|------|------|
| 扩展 | `extensions/builtin/plan/` |
| 描述 | 切换到 plan 模式，在编码前设计实现方案 |
| 参数 | 无 |
| 实现 | 保存先前模式，调用 `handlePlanModeTransition` 限制工具权限为只读，设置 `sessionState.mode = "plan"`，更新 TUI 状态栏显示 "PLAN MODE"，返回 plan-workflow 提示文本。 |

#### 10. ExitPlanMode

| 项目 | 内容 |
|------|------|
| 扩展 | `extensions/builtin/plan/` |
| 描述 | 提交计划供审批并开始编码 |
| 参数 | `plan?`, `forceExit?`, `allowedPrompts?`（预批准的工具权限规则数组：`{ tool, prompt }`） |
| 实现 | 验证当前处于 plan 模式。可选写回外部编辑器修改的计划内容。运行计划验证（必需章节检查，`forceExit` 可跳过）。Teammate 上下文下提交计划到 leader 邮箱审批。交互式 UI 下展示计划预览（截断 1200 字符）+ `allowedPrompts` 权限列表，5 级审批选项：**Execute plan (standard)** — 恢复 prePlanMode 继续当前上下文；**Execute plan (elevated)** — 设为 bypassPermissions 模式；**Execute plan (clear context + elevated)** — 清空上下文以计划为初始消息启动新会话（通过 `setPendingClearContextPlan` + `/new`）；**Keep planning** — 拒绝留在 plan 模式；**Reject plan** — 拒绝并反馈。批准后存储 `lastAllowedPrompts` 到会话状态，恢复工具权限。 |

### Cron 定时任务工具（1:1 移植 CC）

> **架构**：5 层 — cron 表达式解析 → 任务 CRUD + jitter → O_EXCL 文件锁 → 调度器核心 → 扩展适配层。完整移植 CC 的 cron/loop 系统，含 chokidar 文件监听、比例 jitter、7 天自动过期、错过任务检测。

#### 11. CronCreate

| 项目 | 内容 |
|------|------|
| 扩展 | `extensions/builtin/loop/` |
| 描述 | 创建定时任务（一次性或循环），1:1 移植 CC CronCreateTool |
| 参数 | `cron`（必填，5 字段表达式）, `prompt`（必填）, `recurring?`（默认 true）, `durable?`（默认 false） |
| 实现 | 验证 cron 表达式 → 检查 1 年内有匹配 → 任务数量上限 50 → `addCronTask` 注册（session-only 存内存 Map，durable 写 `.claude/scheduled_tasks.json`）→ 返回任务 ID、人类可读调度。durable 受 feature gate `isDurableCronEnabled()` 控制。 |

#### 12. CronList

| 项目 | 内容 |
|------|------|
| 扩展 | `extensions/builtin/loop/` |
| 描述 | 列出所有定时任务（文件持久化 + session-only），1:1 移植 CC CronListTool |
| 参数 | 无 |
| 实现 | `listAllCronTasks` 合并文件任务 + session 任务 → 按 teammate 过滤 → 格式化输出：`${id} — ${humanSchedule} (${recurring|one-shot}) [session-only]: ${prompt truncated to 80}`。 |

#### 13. CronDelete

| 项目 | 内容 |
|------|------|
| 扩展 | `extensions/builtin/loop/` |
| 描述 | 按 ID 删除定时任务，1:1 移植 CC CronDeleteTool |
| 参数 | `id`（必填） |
| 实现 | 验证任务存在 → `removeCronTasks` 先扫 session 存储再扫文件。 |

#### 14. /loop 命令（skill 模式）

| 项目 | 内容 |
|------|------|
| 扩展 | `extensions/builtin/loop/` |
| 描述 | `/loop [interval] <prompt>` — 模型中介式定时任务创建，1:1 移植 CC `skills/bundled/loop.ts` |
| 参数 | `interval`（可选，Ns/Nm/Nh/Nd 格式，默认 10m）, `prompt`（要执行的命令） |
| 实现 | `buildLoopPrompt` 生成指导文本 → 模型解析间隔、转换 cron、调用 CronCreate、确认、立即执行。间隔映射：`Nm→*/N * * * *`、`Nh→0 */N * * *`、`Nd→0 0 */N * *`、`Ns→向上取整到 1m`。 |

### Browser 浏览器工具

#### 15. browser

| 项目 | 内容 |
|------|------|
| 扩展 | `extensions/builtin/browser/` |
| 描述 | 通过 Browser Harness CDP bridge 控制用户的真实 Chrome/Edge 浏览器 |
| 参数 | `code`（必填，Python 代码）, `timeout?`（默认 120s）, `name?` |
| 实现 | 构建 Python 环境（PYTHONPATH 指向 vendored Browser Harness），spawn `python3 -m browser_harness.run -c <code>`。尝试多个 Python 候选（python3.11/python3/python）。代码中可使用预导入的 helper：`new_tab()`, `wait_for_load()`, `page_info()`, `capture_screenshot()`, `click_at_xy()`, `js()`, `cdp()` 等。 |

#### 16. browser_admin

| 项目 | 内容 |
|------|------|
| 扩展 | `extensions/builtin/browser/` |
| 描述 | Browser Harness 依赖安装、环境检查、版本查询 |
| 参数 | `action`（`install`/`doctor`/`setup`/`reload`/`version`）, `timeout?`, `name?` |
| 实现 | `install` 动作运行 pip 安装 cdp-use/fetch-use/pillow/websockets；其他动作调用 `python3 -m browser_harness.run --<action>`。 |

### Skill 技能工具

#### 17. skill

| 项目 | 内容 |
|------|------|
| 扩展 | `extensions/builtin/discipline/` |
| 描述 | 列出或加载当前可用的 catui skills |
| 参数 | `name?`（省略则列出所有） |
| 实现 | 无 name 时从 `ctx.getSkills()` 获取全部 skill，按字母排序返回带编号的列表。有 name 时读取对应 markdown 文件（剥离 frontmatter），以 `<skill>` XML 标签返回完整内容。标记 `isConcurrencySafe: true`。 |

### Teach 教学工具

#### 18. teach

| 项目 | 内容 |
|------|------|
| 扩展 | `extensions/builtin/teach/` |
| 描述 | 引导式教学，支持类比和源验证 |
| 参数 | `topic`（必填）, `action`（`start`/`respond`/`status`）, `response?` |
| 实现 | 通过 WeakMap 维护每个命令上下文的 `TeachRuntime` 状态机。`start` 初始化教学会话，`respond` 反馈用户回答推进渐进式教学，`status` 返回当前主题/阶段/级别。结果通过 `formatTeachResult` 格式化并渲染为 TUI 样式框。 |

### AskUserQuestion 结构化提问工具

#### 19. AskUserQuestion

| 项目 | 内容 |
|------|------|
| 扩展 | `extensions/builtin/ask-user-question/` |
| 描述 | 向用户展示结构化多选题，收集偏好、澄清歧义、获取决策 |
| 参数 | `questions`（1-4 个问题，每个含 `question`, `header`, `options`(2-4), `multiSelect?`）, `annotations?`, `metadata?` |
| 实现 | 1:1 移植自 Claude Code AskUserQuestion 工具。单选通过 `ctx.ui.select()` 展示选项（含 "Other (custom answer)"），多选通过 `ctx.ui.confirm()` 逐选项循环。支持 preview 内容（代码片段/ASCII 图表/配置示例）拼接到标题中。唯一性校验：问题文本 + 每题内选项标签不得重复。结果文本格式对齐 CC：`User has answered your questions: "Q1"="A1", ...` |
| 标记 | `isConcurrencySafe: true`, `requiresUI: true` |

### Link-World 互联网接入工具

#### 20. link_world_admin

| 项目 | 内容 |
|------|------|
| 扩展 | `extensions/builtin/link-world/` |
| 描述 | link-world 集成的状态检查与故障排查 |
| 参数 | `action`（`status`/`doctor`/`version`/`install_help`）, `timeout?` |
| 实现 | `install_help` 返回内置安装文档；`status` 检查 agent-reach 安装状态及能力标志；`doctor`/`version` 执行对应 CLI 命令。 |

#### 21. link_world_exec

| 项目 | 内容 |
|------|------|
| 扩展 | `extensions/builtin/link-world/` |
| 描述 | 通过 catui 执行外部 agent-reach CLI |
| 参数 | `args`（字符串数组，必填）, `timeout?` |
| 实现 | 验证 agent-reach 已安装且至少一个参数后，`execFile` 执行 `agent-reach <args>`。 |

#### 22. web_search（条件注册）

| 项目 | 内容 |
|------|------|
| 扩展 | `extensions/builtin/link-world/` |
| 描述 | 高层互联网搜索 |
| 参数 | `query`（必填）, `provider?`, `limit?`, `timeout?` |
| 实现 | 仅当 agent-reach 安装且 advertise `search` 能力时注册。构建 `agent-reach search <query>` 命令执行。 |

#### 23. web_fetch（条件注册）

| 项目 | 内容 |
|------|------|
| 扩展 | `extensions/builtin/link-world/` |
| 描述 | 高层 URL 内容抓取 |
| 参数 | `url`（必填）, `provider?`, `timeout?` |
| 实现 | 仅当 agent-reach 安装且 advertise `fetch` 能力时注册。构建 `agent-reach fetch <url>` 命令执行。 |

### Goal 长时目标管理工具（1 命令 + 3 工具）

> **架构**：9 个源文件 — `goal-types` / `goal-store` / `goal-format` / `goal-prompts` / `goal-controller` / `goal-tools` / `goal-parser` / `goal-command` / `index`。
> 灵感来自 Codex `/goal` 命令：每线程一个持久化目标，idle continuation 自动续轮，token 预算记账与 steering。
> 磁盘持久化路径 `<agentDir>/goals/<threadId>.json`，原子写入（tmp + rename）。

#### 24. `/goal` 命令

| 项目 | 内容 |
|------|------|
| 扩展 | `extensions/builtin/goal/` |
| CC 源码 | `ext/goal/src/commands.rs` + `ext/goal/src/parser.rs` |
| 描述 | 设置、显示、编辑、暂停、恢复或清除当前线程目标 |
| 子命令 | `show` / `clear` / `edit` / `pause` / `resume` / `help`；无子命令时默认 show；自由文本 → set |
| Tab 补全 | `getGoalArgumentCompletions()` — 覆盖 5 个子命令，按前缀过滤 |
| 实现 | `parseGoalCommand()` 解析参数 → `runGoalCommand()` 分发到对应 handler → 调用 `GoalController` 方法 → UI 渲染摘要。set 时若已有未完成 goal 弹出 `ConfirmIfExists` 确认对话框。edit 调用 `ctx.ui.editor()` 打开编辑器。 |

#### 25. get_goal

| 项目 | 内容 |
|------|------|
| 扩展 | `extensions/builtin/goal/` |
| CC 源码 | `ext/goal/src/tool.rs` (get_goal) |
| 描述 | 读取当前线程 goal，无参数 |
| 参数 | 无 |
| 实现 | 从 GoalController.get_goal() 读取 → 返回 status/objective/usage 摘要或 "No goal is currently set." |

#### 26. create_goal

| 项目 | 内容 |
|------|------|
| 扩展 | `extensions/builtin/goal/` |
| CC 源码 | `ext/goal/src/tool.rs` (create_goal) |
| 描述 | 仅当用户明确要求时创建新 goal；已有未完成 goal 时失败 |
| 参数 | `objective`（必填）, `token_budget?` |
| 实现 | validateObjective + validateBudget → GoalController.insert_goal()（仅 status=complete 时覆盖）→ 返回 goal 摘要 |

#### 27. update_goal

| 项目 | 内容 |
|------|------|
| 扩展 | `extensions/builtin/goal/` |
| CC 源码 | `ext/goal/src/tool.rs` (update_goal) |
| 描述 | 仅标记 complete 或 blocked；complete 需实际验证、blocked 需 3 次连续阻塞 |
| 参数 | `status`（必填："complete" \| "blocked"） |
| 实现 | 先记账当前进度 → GoalController.apply_update_goal() → complete 时附带 usage 报告 |

### Goal 扩展运行时

#### 核心源码

| 文件 | 职责 |
|------|------|
| `goal-types.ts` | 数据模型：`ThreadGoalStatus`（active/paused/blocked/usage_limited/budget_limited/complete）、`ThreadGoal`、`GoalRunKind`、`GoalTurnAccounting`、`GoalControllerState`；常量 4000 字符 objective 上限、最小预算 1 |
| `goal-store.ts` | 原子 JSON 持久化层：get / replace / insert / update / delete / account_usage / set_status / usage_limit / stop_as_blocked；tmp+rename 原子写入；按 status 过滤的记账模式（ActiveStatusOnly/ActiveOnly/ActiveOrComplete/ActiveOrStopped） |
| `goal-format.ts` | 格式化：`formatTokens`（人类可读 token 数）、`formatGoalElapsedSeconds`、`goalStatusLabel`、`goalUsageSummary`、`goalSummaryLines`、`goalStatusIndicator`（含 elapsed 计算）、`shouldConfirmBeforeReplacing`、`validateObjective`、`validateBudget` |
| `goal-prompts.ts` | 3 个 steering 模板：`buildContinuationPrompt`（idle 续轮）、`buildBudgetLimitPrompt`（预算耗尽引导）、`buildObjectiveUpdatedPrompt`（目标更新后重对齐）；镜像 codex-rs `prompts/templates/goals/*` |
| `goal-controller.ts` | 每线程运行时：in-process mutex 序列化突变；`on_turn_start`/`on_token_usage`/`on_tool_finish`/`on_turn_end`/`on_turn_abort`/`on_turn_error`/`on_usage_limit` hook 集合；idle continuation followUp 注入；blocked-signal 升级计数器（≥3 次连续阻塞 → 自动标记 blocked）；budget-limit steering 发射 |
| `goal-tools.ts` | 3 个 LLM 工具工厂：`createGetGoalTool`/`createCreateGoalTool`/`createUpdateGoalTool`；TypeBox 参数 schema；GoalToolHost 单例模式跨文件共享 controller |
| `goal-parser.ts` | `/goal` 命令参数解析：自由文本 → set；精确匹配 5 个子命令；`getGoalArgumentCompletions` Tab 补全 |
| `goal-command.ts` | `/goal` slash command handler：show/clear/edit/pause/resume/set 分发；ConfirmIfExists 确认对话框；多行摘要渲染 |
| `index.ts` | 扩展入口：按 `ExtensionAPI`（agent bus）keyed 的 per-thread controller；注册工具/命令/消息渲染器；订阅 session/turn/tool/message 生命周期 hook |

#### 生命周期 Hook 集成

```
session_start → resetIdleContinuationFlag()
session_shutdown → 清理 controller map

turn_start → on_turn_start(runKind, totalTokensAtStart)
  ├─ 非 plan/review 且 goal 为 active/budget_limited → activeGoalId 绑定
  └─ plan/review → activeGoalId = null（不记账）

message_end → on_token_usage(totalTokens)
  ├─ 累加 token delta + time delta → GoalStore.account_usage()
  └─ 跨预算阈值 → 标记 budget_limited + 发射 budget-limit steering

tool_execution_end → on_tool_finish(toolName)
  └─ 跳过 update_goal 工具自身

turn_end → on_turn_end()
  ├─ 最终记账 → clearActiveTurn()
  ├─ goal 为 active → buildContinuationPrompt() → sendUserMessage(followUp)
  ├─ goal 为 paused/blocked → 重置 consecutiveBlocked 计数器
  └─ budget_limited/complete → 发送状态消息

agent_end → getRunningTotalTokens() → 最终对账
agent_result → 检测 loop framework
```

#### Idle Continuation 机制

每次 turn 成功结束且 goal 为 active 时，controller 通过 `api.sendUserMessage(prompt, { deliverAs: "followUp" })` 注入 continuation prompt，使 agent 在下一轮自动继续工作。`idleContinuationDispatched` 标志防止同一轮重复注入。

Continuation prompt 核心指令：
- 保持完整 objective，不因当前轮次能力而缩小目标
- 从当前工作树出发，以实际状态为权威证据
- 完成前必须验证所有需求（completion audit）
- blocked 标记需 ≥3 次连续相同阻塞条件

#### 状态 6 种

| 状态 | 触发方式 | 说明 |
|------|----------|------|
| `active` | `/goal <objective>` 或 `/goal resume` | 正常工作，idle continuation 生效 |
| `paused` | `/goal pause` | 暂停自动续轮 |
| `blocked` | 3 次连续相同阻塞后自动标记，或 `update_goal status=blocked` | 需外部介入 |
| `usage_limited` | 运行时 usage limit 触发 | 资源限制 |
| `budget_limited` | token_budget 耗尽自动标记 | 终端状态，停止续轮 |
| `complete` | `update_goal status=complete` | 目标达成 |

#### TUI 状态指示器

`index.ts` 在 `session_start` 时启动 1s 定时器，通过 `ctx.ui.setStatus("goal", label)` 在底部状态栏显示：
- `goal: active (1.2k / 10k tokens)` — 含 usage
- `goal: paused` / `goal: blocked` / `goal: complete`
- `goal: budget_limited (10k tokens)`

#### 28. /insights（usage report generation）

| 项目 | 内容 |
|------|------|
| 扩展 | `extensions/builtin/insights/` |
| CC 源码 | `src/commands/insights.ts` + `src/insights/` (~3200 行) |
| 描述 | 扫描所有会话 JSONL 文件，提取结构化元数据和 LLM 分析 facets，生成交互式 HTML 报告和终端摘要 |
| 参数 | `/insights`（无参数，slash command 模式） |
| 实现 | **1:1 移植自 CC**（~3200 行源码）。扫描 `~/.catui/agent/sessions/` 下所有会话 JSONL → 提取 `SessionMeta`（工具调用计数、语言分布、token 用量、git 活动、响应时间）→ 通过 LLM 提取 `SessionFacets`（目标类别、成果、满意度、摩擦点）→ 聚合跨会话统计 → 生成 7+ 并行 LLM insight 段落（项目领域分析、交互风格、有效做法、摩擦分析、改进建议、近期展望、趣味结尾、at-a-glance 摘要）→ 输出 HTML 报告含交互式图表（柱状图、直方图、时区感知的时间分布图）→ 终端 markdown 摘要含 at-a-glance insights。 |

#### 29. LSP

| 项目 | 内容 |
|------|------|
| 扩展 | `extensions/builtin/lsp/` |
| CC 源码 | `src/tools/LSPTool/LSPTool.ts` |
| 描述 | 与 LSP 语言服务器交互获取代码智能功能 |
| 参数 | `operation`（9 种：goToDefinition/findReferences/hover/documentSymbol/workspaceSymbol/goToImplementation/prepareCallHierarchy/incomingCalls/outgoingCalls）, `filePath`（必填）, `line`（必填, 1-based）, `character`（必填, 1-based） |
| 实现 | **1:1 移植自 CC**：stdio JSON-RPC 客户端（`vscode-jsonrpc`）→ 多服务器管理器（按文件扩展名路由）→ 服务器发现（`which` 探测 typescript/pyright/rust-analyzer/gopls）→ 崩溃恢复（maxRestarts=3, 指数退避）→ 两步 call hierarchy（prepareCallHierarchy → incomingCalls/outgoingCalls）→ gitignore 过滤（`git check-ignore` 批量 50）→ 10MB 文件大小限制 → `isConcurrencySafe: true`, `isReadOnly: true`。 |

### Task 任务管理工具（7 个）

1:1 移植自 Claude Code TaskCreate/Get/Update/List/Stop/Output + ToolSearch，guidance 文本、评分算法、核心逻辑均与 CC 源码对齐。磁盘持久化路径 `{agentDir}/tasks/{taskListId}/`，每个任务一个 `{id}.json`，高水位标记 `.highwatermark` 防止 ID 复用。原子写入使用 tmp + rename。

#### 30. TaskCreate

| 项目 | 内容 |
|------|------|
| 扩展 | `extensions/builtin/task/` |
| CC 源码 | `src/tools/TaskCreateTool/TaskCreateTool.ts` + `prompt.ts` |
| 描述 | 创建新任务，初始状态 pending |
| 参数 | `subject`（必填）, `description`（必填）, `activeForm?`, `metadata?` |
| 实现 | 通过 task-store 创建任务 → 返回 `{ task: { id, subject } }`。CC 原版有 TaskCreated hooks 和 setAppState 自动展开，catui 简化跳过。 |

#### 31. TaskGet

| 项目 | 内容 |
|------|------|
| 扩展 | `extensions/builtin/task/` |
| CC 源码 | `src/tools/TaskGetTool/TaskGetTool.ts` + `prompt.ts` |
| 描述 | 按 ID 获取任务完整详情，含 blocks/blockedBy 阻塞关系 |
| 参数 | `taskId`（必填） |
| 实现 | 从 task-store 按 ID 读取 → 返回 subject/description/status/blocks/blockedBy |

#### 32. TaskUpdate

| 项目 | 内容 |
|------|------|
| 扩展 | `extensions/builtin/task/` |
| CC 源码 | `src/tools/TaskUpdateTool/TaskUpdateTool.ts` + `prompt.ts` |
| 描述 | 更新任务状态、字段、阻塞关系。支持 status=deleted 删除任务 |
| 参数 | `taskId`（必填）, `status?`, `subject?`, `description?`, `activeForm?`, `owner?`, `metadata?`, `addBlocks?`, `addBlockedBy?` |
| 实现 | 更新基本字段 → metadata 合并（null 删除 key）→ 状态流转 → blocks/blockedBy 依赖管理 → 验证 nudge（3+ 任务完成无验证步骤时提醒）。CC 原版有 TaskCompleted hooks、teammate 邮箱通知、verificationNudgeNeeded 标志，catui 简化。 |

#### 33. TaskList

| 项目 | 内容 |
|------|------|
| 扩展 | `extensions/builtin/task/` |
| CC 源码 | `src/tools/TaskListTool/TaskListTool.ts` + `prompt.ts` |
| 描述 | 列出所有任务及其状态 |
| 参数 | 无 |
| 实现 | 读取所有任务 → 过滤 `_internal` metadata → 解析已完成的 blocker → 返回 `#id [status] subject (owner) [blocked by ...]` 格式 |

#### 34. TaskStop

| 项目 | 内容 |
|------|------|
| 扩展 | `extensions/builtin/task/` |
| CC 源码 | `src/tools/TaskStopTool/TaskStopTool.ts` + `prompt.ts` |
| 描述 | 停止运行中的任务。catui 无后台进程，简化为标记 status=completed |
| 参数 | `task_id`（必填） |
| 实现 | 验证任务存在且未完成 → updateTask(status=completed)。CC 原版有 shell_id 兼容、validateInput 检查 running 状态，catui 简化。 |

#### 35. TaskOutput

| 项目 | 内容 |
|------|------|
| 扩展 | `extensions/builtin/task/` |
| CC 源码 | `src/tools/TaskOutputTool/TaskOutputTool.tsx` |
| 描述 | 获取任务当前状态和详情。CC 原版已标为 Deprecated（建议用 Read 代替）。catui 无后台进程，返回任务状态和描述 |
| 参数 | `task_id`（必填）, `block?`（no-op）, `timeout?`（no-op） |
| 实现 | 从 task-store 获取任务 → 返回 retrieval_status + task 详情。block/timeout 参数为 API 兼容保留，无实际效果。 |

#### 36. ToolSearch

| 项目 | 内容 |
|------|------|
| 扩展 | `extensions/builtin/task/` |
| CC 源码 | `src/tools/ToolSearchTool/ToolSearchTool.ts` + `prompt.ts` |
| 描述 | 通过关键词或 select: 前缀发现工具 |
| 参数 | `query`（必填）, `max_results?`（默认 5） |
| 实现 | **评分算法 1:1 移植自 CC**：MCP 工具名精确匹配 12 分（普通 10）、子串 6/5、searchHint 4、描述 word-boundary 匹配 2、full name fallback 3。支持 `select:A,B,C` 直接选择、`+term` 必需词前缀。CC 原版搜索 deferred tools 并返回 `tool_reference` 块用于 schema 注入；catui 无 deferred 概念，搜索全部工具返回文本描述。 |

---

## 工具分组预设

| 预设名 | 包含工具 | 用途 |
|--------|----------|------|
| `codingTools` | read, bash, edit, write, time | 全功能编码模式 |
| `readOnlyTools` | read, grep, find, ls, time | 只读探索模式（不允许修改文件） |

---

## 横切关注点

### 可插拔操作接口（Pluggable Operations）

所有文件系统工具（read/bash/edit/write/grep/find/ls）均暴露 `*Operations` 接口（如 `ReadOperations`、`BashOperations`），允许将操作委托到远程系统（如 SSH），无需修改工具核心逻辑。

### 输出截断

所有工具统一使用 `truncate.ts` 中的截断工具：
- `truncateHead`：用于只读工具（read/grep/find/ls），截断头部保留尾部
- `truncateTail`：用于 bash 工具，截断尾部保留最新输出
- 同时受行数限制（`DEFAULT_MAX_LINES`）和字节限制（`DEFAULT_MAX_BYTES`）双重约束

### AbortSignal

所有工具支持 AbortSignal，确保取消时正确清理资源。

### 工厂模式

每个工具导出：
- `create*Tool(cwd, options?)` 工厂函数（绑定特定工作目录）
- `*Tool` 单例默认值（绑定 `process.cwd()`）

### TypeBox Schema

所有参数 schema 使用 `@sinclair/typebox` 定义，同时提供运行时验证和 TypeScript 类型推断（`Static<typeof schema>`）。

### Staleness 检测（文件状态保护）

1:1 移植自 Claude Code 的 `readFileState` 机制，防止 edit/Write 覆盖已被外部修改的文件。

| 文件 | 职责 |
|------|------|
| `core/tools/file-state-cache.ts` | LRU 缓存（100 条目 / 25MB 上限），零外部依赖，Map 插入序实现 LRU |
| `core/tools/read.ts` | 成功读取文本文件后填充缓存（`content`, `Math.floor(mtimeMs)`, `offset`, `limit`） |
| `core/tools/edit.ts` | **两阶段检测**：① `validateInput` — 缓存无记录则拒绝（必须先 read）；② `execute` — `fs.stat()` mtime > 缓存 timestamp 则拒绝（外部已修改）。成功写入后更新缓存 |
| `core/tools/write.ts` | 缓存有记录时检查 mtime（过期则拒绝）；缓存无记录时允许写入（新建文件场景）。成功写入后更新缓存 |

缓存 key 使用 `normalize(resolve(path))` 统一路径格式，与 CC 的 `readFileState` 设计一致。

---

## 上下文压缩机制（Compaction）

catui 使用 **LLM 驱动的结构化摘要**来管理上下文窗口，而非简单的截断或滑动窗口。

### 核心源码

| 文件 | 职责 |
|------|------|
| `core/session/compaction/compaction.ts` | 核心压缩逻辑：token 估算、切割点检测、摘要生成 |
| `core/session/compaction/branch-summarization.ts` | 分支导航时的上下文摘要 |
| `core/session/compaction/utils.ts` | 序列化、文件操作追踪、摘要 prompt 模板 |
| `core/runtime/compaction-controller.ts` | `CompactionController`：编排手动/自动压缩，管理 abort slot |
| `core/runtime/agent-session.ts` | `AgentSession`：触发压缩检查，处理 overflow 恢复 |
| `core/lib/ai/src/utils/overflow.ts` | 上下文溢出检测（15+ 提供商的 regex 匹配） |
| `core/messages.ts` | 消息类型定义（`CompactionSummaryMessage`、`BranchSummaryMessage`） |
| `core/platform/config/settings-manager.ts` | 用户可配置的压缩参数 |
| `core/session/session-manager.ts` | 会话持久化；`buildSessionContext()` 从 compaction entry 重建消息 |

### 触发条件

两种触发方式，均在 `AgentSession._checkCompaction()` 中检查：

#### 触发 1：上下文溢出（被动）

LLM 返回超出上下文窗口的错误时触发。`overflow.ts` 通过约 15 条正则匹配各提供商（Anthropic、OpenAI、Google、xAI、Groq、OpenRouter、Cerebras、Mistral、llama.cpp、LM Studio、MiniMax、Kimi 等）的错误消息，包括 z.ai 的"静默溢出"。

```
溢出检测 → 移除错误消息 → 运行自动压缩 → 自动重试当前轮次
```

#### 触发 2：阈值（主动）

每轮 LLM 响应成功后，检查 `contextTokens > contextWindow - reserveTokens`。超过阈值则运行压缩，但不自动重试（用户继续手动操作）。

还有**预提示检查**：在新轮次开始前检测上一轮被中止时是否已溢出。

### 压缩流程

#### Step 1：准备（`prepareCompaction()`）

1. 找到会话中最近的 compaction boundary（首次则从头开始）
2. 估算自上次压缩以来所有消息的 token 总量
3. 调用 `findCutPoint()` 确定切割位置
4. 分离待摘要消息（旧）vs 保留消息（新）
5. 检测切割点是否在轮次中间（split turn），是则额外收集 turn prefix
6. 从消息和先前 compaction details 中提取文件操作记录

#### Step 2：切割点检测（`findCutPoint()`）

```
从最新消息向前遍历 → 累积 token 估算 → 达到 keepRecentTokens 后停止 → 吸附到最近的合法切割点
```

- 合法切割点：user message、assistant message、custom message、bash execution、branch summary、compaction summary
- **永远不在 tool result 处切割**（必须跟随其 tool call）
- Token 估算使用 `chars / 4` 启发式算法

#### Step 3：摘要生成（`compact()`）

待丢弃消息序列化为 `[User]: ...`、`[Assistant]: ...`、`[Tool result]: ...` 格式，包裹在 `<conversation>` XML 标签中。

两种摘要 prompt：

| Prompt | 场景 | 输出结构 |
|--------|------|----------|
| `SUMMARIZATION_PROMPT` | 首次压缩 | Goal → Constraints & Preferences → Progress (Done/In Progress/Blocked) → Key Decisions → Next Steps → Critical Context |
| `UPDATE_SUMMARIZATION_PROMPT` | 已有压缩记录 | 合并新信息到现有摘要，保留先前上下文 |

若切割点在轮次中间，额外运行 `TURN_PREFIX_SUMMARIZATION_PROMPT` 生成简洁的前缀摘要，再与主摘要合并。

LLM 调用使用 `completeSimple()`，`reasoning: "high"`，max token 预算为 `0.8 * reserveTokens`。

#### Step 4：结果构建

`CompactionResult` 包含：
- `summary`：生成的文本摘要
- `firstKeptEntryId`：第一个保留条目的 UUID
- `tokensBefore`：压缩前的 token 总量
- `details`：文件操作记录（`<read-files>` / `<modified-files>` XML 标签）

#### Step 5：会话持久化

`CompactionController.compact()` 调用 `sessionManager.appendCompaction()` 将 `CompactionEntry` 写入 JSONL 会话文件。条目存储摘要文本、`firstKeptEntryId` 指针和 token 计数。

#### Step 6：上下文重建（`buildSessionContext()`）

```
[CompactionSummaryMessage]  ← 摘要注入为特殊 role
[firstKeptEntryId ... compaction entry]  ← 保留的近期消息
[compaction entry ... latest]  ← 最新消息
```

**旧消息永远不会从会话文件中删除** — 它们仅被排除在 LLM 上下文之外。compaction entry 充当指针："此 ID 之前的所有内容已被摘要。"

### 压缩内容的表示

```typescript
interface CompactionSummaryMessage {
  role: "compactionSummary";
  summary: string;        // 结构化摘要文本
  tokensBefore: number;   // 压缩前 token 数
  timestamp: number;
}
```

作为特殊消息 role 注入到上下文最前面，LLM 将其视为上下文设定消息，而非 user/assistant 消息。摘要文本末尾附带文件操作追踪：

```
<read-files>
path/to/file1.ts
path/to/file2.ts
</read-files>

<modified-files>
path/to/changed.ts
</modified-files>
```

### 配置项

| 设置 | 默认值 | 说明 |
|------|--------|------|
| `compaction.enabled` | `true` | 启用/禁用自动压缩 |
| `compaction.reserveTokens` | `16384` | 系统提示 + LLM 响应预留 token。触发条件：`contextTokens > contextWindow - reserveTokens` |
| `compaction.keepRecentTokens` | `20000` | 始终保留的最近消息 token 预算（"窗口"大小） |
| `branchSummary.reserveTokens` | `16384` | 分支导航摘要的预留 token |

可在 `settings.json` 的 `compaction` 键下配置。运行时可通过 `setAutoCompactionEnabled()` 切换，手动触发通过 `compact()`。

### 附加上下文管理机制

| 机制 | 源码 | 说明 |
|------|------|------|
| **溢出检测** | `overflow.ts` | 正则匹配 15+ 提供商的溢出错误，含静默溢出检测 |
| **溢出自动重试** | `retry-coordinator.ts` | 溢出时移除错误消息 → 压缩 → 自动重试 |
| **循环内错误恢复** | `agent-loop.ts` | `recoverModelError` 回调可在循环内触发压缩和重试 |
| **工具结果大小限制** | `agent-loop.ts` | `enforceMaxResultSize()` / `enforceToolResultBatchSize()` 防止单个大输出耗尽上下文 |
| **输出 token 恢复** | `agent-loop-continuations.ts` | 模型达到 max output tokens 时自动继续（1.5x 预算递增） |
| **token 预算续写** | `agent-loop-continuations.ts` | 输出 token 低于目标预算阈值时排队续写消息 |

---

## 自主长时任务引擎（GRUB）

GRUB 是 catui 的内置扩展，提供 **自主长时任务 harness**，灵感来自 Anthropic 的 [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) 模式。通过 `/grub` 命令启动一个跨多轮迭代自主推进目标的 agent，具备磁盘持久化状态，可跨上下文窗口重置和进程重启恢复。

### 核心源码

| 文件 | 职责 |
|------|------|
| `extensions/builtin/grub/index.ts` | 扩展入口：注册 `/grub` 命令、事件 hook、消息渲染器 |
| `grub-controller.ts` | 状态机：驱动自主迭代任务，含持久化状态和完成验证 |
| `grub-types.ts` | 类型定义：`GrubTaskState`, `GrubDecision`, `FeatureItem`, `FeatureList`, `PersistedGrubState` 等 |
| `grub-feature-list.ts` | JSON feature list 读写及 diff 验证（agent 只能改 `passes`/`evidence`） |
| `grub-persistence.ts` | 原子 JSON 持久化（`.grub/<id>/state.json`）、发现、过期清理 |
| `grub-prompts.ts` | Prompt 构建：initializer prompt、coding prompt、每轮 task prompt |
| `grub-harness.ts` | 文件系统 artifact 创建（feature-list.json, progress-log.md, init.sh） |
| `grub-decision.ts` | 解析 assistant 响应中的 `<loop-state>` XML 块为 `GrubDecision` |
| `grub-turn.ts` | 轮次结束编排：验证 feature list、验证完成、决定是否调度下一轮 |
| `grub-parser.ts` | `/grub` 命令解析器（子命令 + 标志） |
| `grub-format.ts` | TUI 用户态状态格式化 |
| `grub-i18n.ts` | 本地化（en/zh） |

### 命令接口

```
/grub <goal>                 # 启动新的自主任务
/grub <goal> --max-iter N    # 限制总迭代轮次（默认 25）
/grub <goal> --max-fail N    # 连续失败 N 次后停止（默认 3）
/grub status [--json]        # 查看当前任务进度
/grub resume                 # 恢复已保存的任务（跨会话）
/grub stop                   # 停止当前任务
/grub help                   # 显示帮助
```

命令解析支持引号、转义、`--` 分隔符、`=` 赋值等 shell 风格语法。Tab 补全覆盖子命令和标志。

### 两阶段自主迭代循环

#### Phase 1：Initializer（初始化阶段）

agent 的唯一任务是建立可执行的 harness 结构，**不做大范围实现**。

产出物：

1. **`feature-list.json`** — 将占位符替换为 15-40 个具体、可测试的 feature 条目
   ```json
   {
     "version": 1,
     "goal": "<用户目标>",
     "features": [
       {
         "id": "kebab-slug",
         "category": "functional|verification|polish",
         "description": "可观察行为",
         "steps": ["可执行", "验证", "步骤"],
         "passes": false
       }
     ]
   }
   ```

2. **`init.sh`** — 启动/烟测脚本（每轮运行以验证项目仍可启动）
   - pwd、git log、progress-log 尾部、feature 进度统计
   - 项目专属烟测命令（用户可覆盖）

3. **`progress-log.md`** — 追加初始化摘要

**自动晋级**：清单结构合法（15-40 feature、kebab-case id、placeholder 已替换）后，harness 自动进入执行阶段。Initializer 阶段不标记任何 feature 通过。

#### Phase 2：Execution（执行阶段）

每轮 agent 必须：

1. 运行 `init.sh` 验证项目仍可启动
2. 读取 `feature-list.json`，**选取恰好一个** `passes: false` 的 feature
3. 端到端实现并验证该 feature
4. **只能修改**该 feature 的 `passes` 和 `evidence` 字段（其他字段不可变）
5. 追加进度日志到 `progress-log.md`
6. 以 `<loop-state>` XML 块结束

```xml
<loop-state>{"status":"continue|complete|blocked","summary":"...","nextStep":"..."}</loop-state>
```

只有当 feature-list 中**所有** feature 都 `passes: true` 时，才能声明 `complete`。过早声明会被降级为 `continue`。

### 关键数据结构

#### GrubTaskState（任务状态）

```typescript
interface GrubTaskState {
  id: string;                    // 8 位 hex ID
  goal: string;                  // 用户目标
  locale: "en" | "zh";           // 语言
  status: "running" | "complete" | "blocked" | "stopped" | "failed";
  phase: "initializer" | "execution";
  startedAt: number;
  updatedAt: number;
  currentIteration: number;      // 当前轮次
  awaitingTurn: boolean;         // 是否正在等待 LLM 响应
  consecutiveFailures: number;   // 连续失败次数
  maxIterations: number;         // 最大轮次（默认 25）
  maxConsecutiveFailures: number; // 执行阶段连续失败上限（默认 3）
  maxInitializerFailures?: number; // 初始化阶段失败上限（默认 5）
  harnessDirectory: string;      // .grub/<id>/
  featureListPath: string;
  progressLogPath: string;
  initScriptPath: string;
  featureListBaseline?: FeatureList; // diff 验证的基线
  lastDecision?: GrubDecision;
  lastError?: string;
}
```

#### FeatureItem（Feature 条目）

```typescript
interface FeatureItem {
  id: string;                              // kebab-case 唯一标识
  category: "functional" | "verification" | "polish";
  description: string;                     // 可观察行为描述
  steps: string[];                         // 可执行验证步骤
  passes: boolean;                         // 是否通过
  evidence?: string;                       // git sha 或简短证明
}
```

#### GrubDecision（轮次决策）

```typescript
interface GrubDecision {
  status: "continue" | "complete" | "blocked";
  summary: string;
  nextStep?: string;  // status=continue 时必填
}
```

### 安全机制

| 机制 | 说明 |
|------|------|
| **Feature List 变异守卫** | `validateFeatureListDiff()` 逐字段比对基线，agent 只能改 `passes`/`evidence`；增删 feature、改 description/category/steps/goal 均被拒绝 |
| **完成守卫** | `validateCompletion()` 检查所有 feature 是否 `passes: true`，过早声明 complete 会被降级为 continue 并提示剩余未完成项 |
| **Initializer 清洗** | `sanitizeInitializerFeatureList()` 自动修正可恢复的卫生问题（goal 不匹配、预标记 passes、游离 evidence），不因此阻塞阶段转换 |
| **阶段感知失败预算** | Initializer 阶段 5 次重试（更宽容），Execution 阶段 3 次连续失败 |
| **迭代上限** | 默认 25 轮（`--max-iter` 可调） |
| **原子持久化** | 写入 `.tmp` 文件后 `renameSync` 原子替换，防止状态文件损坏 |
| **跨会话恢复** | `/grub resume` 扫描 `.grub/<id>/state.json` 发现 `status: "running"` 的任务并恢复 |
| **过期清理** | 扩展加载时自动清理终态（complete/blocked/stopped/failed）超过 30 天的 harness 目录 |

### 目录结构

```
.grub/
└── <8位hex-id>/
    ├── state.json          # 原子持久化的 GrubTaskState（PersistedGrubState 信封）
    ├── feature-list.json   # 结构化 feature 清单（15-40 条）
    ├── progress-log.md     # 人类可读的迭代进度日志
    └── init.sh             # 启动/烟测脚本（每轮执行）
```

### Prompt 策略

| Prompt | 阶段 | 核心指令 |
|--------|------|----------|
| `buildGrubInitializerPrompt()` | Initializer | 只建立 harness，不做实现；产出 15-40 feature 清单；清单结构合法后自动晋级 |
| `buildGrubCodingPrompt()` | Execution | 每轮只做一个 feature；只能改 passes/evidence；运行 init.sh 验证；不能声明完成除非全部通过 |
| `buildGrubTaskPrompt(task)` | 通用 | 根据 phase 动态拼装，含上次决策摘要、恢复提示、harness 文件路径 |

所有 prompt 支持 en/zh 双语输出，由 `locale` 字段控制。

### 决策解析协议

Assistant 响应中的 `<loop-state>` XML 块由 `extractGrubDecision()` 解析：

1. 正则匹配最后一个 `<loop-state>...</loop-state>` 块
2. 剥离 markdown fence（如有）
3. JSON 解析并验证 `status` 字段（必须是 `continue`/`complete`/`blocked`）
4. `status=continue` 时必须提供 `nextStep`
5. `summary` 必须非空

解析失败或缺失视为轮次失败，计入 `consecutiveFailures`。

### 轮次编排流程（`resolveGrubTurn()`）

```
assistant 响应
    ↓
extractGrubDecision() 解析 <loop-state>
    ↓ 失败 → recordFailure() → 重试或停止
validateFeatureListAfterTurn() 验证 feature list 变异
    ↓ 失败 → recordFailure() → 重试或停止
validateCompletion() 验证完成声明
    ↓ 过早完成 → 降级为 continue
finishTurn() 执行状态转换
    ↓
    ├── complete → stop("complete")
    ├── blocked  → stop("blocked")
    ├── 达到迭代上限 → stop("failed")
    └── continue → currentIteration++ → 调度下一轮
```

---

---

# Claude Code 工具体系完整分析

> 源码位置：`/Users/cunyu666/Dev/Claude-Code`
> 版本：`@anthropic-ai/claude-code-source` v2.1.88
> 分析时间：2026-06-11

---

## 核心源码结构

| 文件 | 职责 |
|------|------|
| `src/Tool.ts` | 工具类型定义 `Tool<I,O,P>` 接口 + `buildTool()` 工厂（~800 行） |
| `src/tools.ts` | 工具注册表：`getAllBaseTools()` → `getTools()` → `assembleToolPool()` |
| `src/constants/tools.ts` | 工具名常量 + agent 允许/禁止工具集 |
| `src/tools/` | 44 个工具目录，每个工具独立实现 |

---

## 工具类型系统（Tool Interface）

Claude Code 每个工具实现统一的 `Tool<Input, Output, P>` 接口：

```typescript
type Tool<Input, Output, P> = {
  // 基础标识
  name: string
  aliases?: string[]
  searchHint?: string

  // Schema
  inputSchema: ZodSchema           // Zod v4 运行时验证
  inputJSONSchema?: object         // JSON Schema（MCP 工具用）
  outputSchema?: ZodSchema

  // 行为控制
  maxResultSizeChars: number       // 输出超限则持久化到磁盘
  shouldDefer?: boolean            // 延迟加载（需 ToolSearch 才能发现）
  strict?: boolean                 // API strict mode

  // 生命周期
  call(args, context, canUseTool, parentMessage, onProgress?): Promise<ToolResult<Output>>
  validateInput?(input, context): Promise<ValidationResult>
  checkPermissions(input, context): Promise<PermissionResult>
  description(input, options): Promise<string>
  prompt(options): Promise<string>

  // 行为标记
  isEnabled(): boolean
  isConcurrencySafe(input): boolean
  isReadOnly(input): boolean
  isDestructive?(input): boolean
  interruptBehavior?(): 'cancel' | 'block'
  isSearchOrReadCommand?(input): { isSearch, isRead, isList }
  requiresUserInteraction?(): boolean

  // UI 渲染（React）
  renderToolUseMessage(input, options): ReactNode
  renderToolResultMessage?(output, progressMessages, options): ReactNode
  renderToolUseProgressMessage?(progressMessages, options): ReactNode
  renderToolUseRejectedMessage?(input, options): ReactNode
  renderToolUseErrorMessage?(result, options): ReactNode
  renderGroupedToolUse?(toolUses, options): ReactNode | null

  // 输出格式化
  mapToolResultToToolResultBlockParam(content, toolUseID): ToolResultBlockParam
  toAutoClassifierInput(input): unknown

  // Hook
  preparePermissionMatcher?(input): Promise<(pattern: string) => boolean>
  backfillObservableInput?(input): void
}
```

**`buildTool()` 工厂**提供安全默认值：`isEnabled: true`、`isConcurrencySafe: false`、`isReadOnly: false`、`isDestructive: false`、`checkPermissions: { behavior: 'allow' }`。

### ToolUseContext（工具执行上下文）

每次工具调用传入的上下文，包含：

| 字段 | 说明 |
|------|------|
| `options` | 命令、调试、模型、工具列表、thinkingConfig、mcpClients、agentDefinitions 等 |
| `abortController` | 取消信号 |
| `readFileState` | LRU 缓存，记录文件读取时间戳/内容，用于去重和 staleness 检测 |
| `getAppState() / setAppState()` | 全局应用状态 |
| `setToolJSX` | 更新 UI |
| `messages` | 对话历史 |
| `fileReadingLimits / globLimits` | 资源限制 |
| `toolDecisions` | 权限决策 map（tool call ID → accept/reject） |
| `queryTracking` | 嵌套查询链追踪（agent 调 agent） |
| `contentReplacementState` | 大结果预算管理 |
| `renderedSystemPrompt` | fork 子 agent 共享缓存 |

---

## 完整工具清单（29 个核心 + 20+ 条件工具）

> 每个工具包含：用途（干什么）、源码位置（在哪）、告知模型的内容（怎么用）、实现要点。
> 源码根目录：`/Users/cunyu666/Dev/Claude-Code/`

### 一、文件操作（4 个）

#### 1. Read — 读取文件

| 项目 | 内容 |
|------|------|
| 源码 | `/Users/cunyu666/Dev/Claude-Code/src/tools/FileReadTool/FileReadTool.ts` |
| 用途 | 从本地文件系统读取文件，是 Claude Code 最基础的只读工具 |
| 告知模型 | "Read a file from the local filesystem." + 支持绝对路径读取任意文件、图片(PNG/JPG)、PDF(大文件需 pages 参数)、Jupyter notebook；结果以 `cat -n` 格式返回（行号从 1 开始）；支持 offset/limit 分页 |
| 标记 | `isReadOnly: true`, `isConcurrencySafe: true`, `maxResultSizeChars: Infinity` |
| 参数 | `file_path`(必填), `offset?`, `limit?`, `pages?`(PDF) |
| call() 逻辑 | 读取文本/图片(压缩)/PDF(页面提取)/Notebook → 发现 skill 目录 → `readFileState` 去重（同范围重复读返回 `file_unchanged`）→ UNC 路径安全校验 → 设备文件拦截 → 1 GiB 大小限制 |

#### 2. Edit — 精确文本替换

| 项目 | 内容 |
|------|------|
| 源码 | `/Users/cunyu666/Dev/Claude-Code/src/tools/FileEditTool/FileEditTool.ts` |
| 用途 | 对文件执行精确的字符串搜索替换（surgical edit），是修改文件的首选工具 |
| 告知模型 | "Performs exact string replacements in files." + 必须先 Read 再 Edit；old_string 必须在文件中唯一；保留缩进；支持 replace_all |
| 标记 | `maxResultSizeChars: 100,000` |
| 参数 | `file_path`(必填), `old_string`(必填), `new_string`(必填), `replace_all?` |
| call() 逻辑 | 读取文件 → 验证无并发修改 → `findActualString`(引号归一化处理 smart quotes) → 生成 unified patch → 写入磁盘 → 通知 LSP (didChange + didSave) → 更新 readFileState |

#### 3. Write — 全量写入文件

| 项目 | 内容 |
|------|------|
| 源码 | `/Users/cunyu666/Dev/Claude-Code/src/tools/FileWriteTool/FileWriteTool.ts` |
| 用途 | 将完整内容写入文件（不存在则创建，存在则覆盖），适合创建新文件或完全重写 |
| 告知模型 | "Writes a file to the local filesystem." + 覆盖已有文件；修改已有文件应优先用 Edit；不要主动创建文档/README |
| 标记 | `maxResultSizeChars: 100,000` |
| 参数 | `file_path`(必填), `content`(必填) |
| call() 逻辑 | 发现 skill → 确保父目录存在 → staleness 检测(比对 readFileState) → 写入磁盘 → 通知 LSP → 更新 readFileState |

#### 4. NotebookEdit — 编辑 Jupyter 单元格

| 项目 | 内容 |
|------|------|
| 源码 | `/Users/cunyu666/Dev/Claude-Code/src/tools/NotebookEditTool/NotebookEditTool.ts` |
| 用途 | 编辑 Jupyter notebook (.ipynb) 中的单个单元格，支持替换/插入/删除操作 |
| 告知模型 | "Completely replaces the contents of a specific cell in a Jupyter notebook (.ipynb file) with new source." |
| 标记 | `shouldDefer: true` |
| 参数 | `notebook_path`(必填), `new_source`(必填), `cell_id?`, `cell_type?`, `edit_mode?`(replace/insert/delete) |
| call() 逻辑 | 读取 notebook JSON → 按 cell_id 或 index 查找目标单元格 → 执行 replace/insert/delete → 格式化写回 → 更新 readFileState |

### 二、搜索与发现（2 个）

#### 5. Glob — 文件模式匹配

| 项目 | 内容 |
|------|------|
| 源码 | `/Users/cunyu666/Dev/Claude-Code/src/tools/GlobTool/GlobTool.ts` |
| 用途 | 按 glob 模式快速查找文件，适用于任意规模代码库，返回按修改时间排序的文件路径 |
| 告知模型 | "Fast file pattern matching tool that works with any codebase size. Supports glob patterns like `**/*.js` or `src/**/*.ts`. Returns matching file paths sorted by modification time." |
| 标记 | `isReadOnly: true`, `isConcurrencySafe: true` |
| 参数 | `pattern`(必填), `path?` |
| call() 逻辑 | 调用 glob 工具 → 限制 100 结果 → 路径转相对路径节省 token → 按修改时间排序返回 |

#### 6. Grep — 内容搜索

| 项目 | 内容 |
|------|------|
| 源码 | `/Users/cunyu666/Dev/Claude-Code/src/tools/GrepTool/GrepTool.ts` |
| 用途 | 基于 ripgrep 的强大内容搜索工具，支持正则、多种输出模式、上下文行、类型过滤 |
| 告知模型 | "A powerful search tool built on ripgrep. Supports full regex syntax. Output modes: 'content' (shows matching lines with context), 'files_with_matches' (only file paths), 'count' (match counts). Use Grep instead of grep/rg." |
| 标记 | `isReadOnly: true`, `isConcurrencySafe: true` |
| 参数 | `pattern`(必填), `path?`, `glob?`, `output_mode?`(content/files_with_matches/count), `-A?`, `-B?`, `-C?`, `-i?`, `type?`, `head_limit?`(默认250), `offset?`, `multiline?` |
| call() 逻辑 | 构建 ripgrep 参数(排除 VCS 目录) → 子进程执行 → 按 output_mode 处理(content 带行号/仅文件路径/计数) → head_limit 分页(offset 支持) → 按修改时间排序 |

### 三、Shell 执行（1 个）

#### 7. Bash — 命令执行

| 项目 | 内容 |
|------|------|
| 源码 | `/Users/cunyu666/Dev/Claude-Code/src/tools/BashTool/BashTool.tsx`（~1100 行） |
| 子模块 | `bashSecurity.ts`(安全分析), `bashPermissions.ts`(权限匹配), `shouldUseSandbox.ts`(沙箱决策), `readOnlyValidation.ts`(只读约束), `sedValidation.ts`(sed 编辑安全) |
| 用途 | 执行 bash 命令并返回 stdout/stderr，是 Claude Code 最核心的执行工具，承载了 git、构建、测试等所有 shell 操作 |
| 告知模型 | "Executes a given bash command and returns its output." + 工具偏好(Glob 代替 find、Grep 代替 grep、Read 代替 cat、Edit 代替 sed)；git 操作安全协议(禁止 force push / skip hooks / amend)；沙箱配置；超时设置；后台任务支持 |
| 标记 | 无特殊标记（默认 isConcurrencySafe: false） |
| 参数 | `command`(必填), `description?`, `timeout?`(ms, 默认120000, 最大600000), `run_in_background?`, `dangerouslyDisableSandbox?` |
| call() 逻辑 | 子进程执行 shell 命令 → 沙箱支持(文件系统读写限制 + 网络 host 白名单/黑名单) → 后台执行(完成后通知) → 超时强制终止 → 返回 stdout/stderr/exit code/耗时 |

### 四、Web 操作（2 个）

#### 8. WebFetch — 网页抓取

| 项目 | 内容 |
|------|------|
| 源码 | `/Users/cunyu666/Dev/Claude-Code/src/tools/WebFetchTool/WebFetchTool.ts` |
| 用途 | 抓取 URL 内容，将 HTML 转为 markdown，再用小模型处理内容，用于获取网页信息 |
| 告知模型 | "Fetches content from a specified URL and processes it using an AI model. Converts HTML to markdown. IMPORTANT: If an MCP web fetch tool is available, prefer that. For GitHub URLs, prefer gh CLI via Bash." |
| 标记 | `shouldDefer: true`, `isReadOnly: true`, `isConcurrencySafe: true` |
| 参数 | `url`(必填), `prompt`(必填) |
| call() 逻辑 | 抓取 URL → HTML 转 markdown → 处理重定向(不同 host 返回 redirect 信息) → 用小模型按 prompt 处理内容 → 二进制内容(PDF 等)持久化到磁盘 → 预批准域名放宽限制 → 15 分钟缓存 |

#### 9. WebSearch — 网页搜索

| 项目 | 内容 |
|------|------|
| 源码 | `/Users/cunyu666/Dev/Claude-Code/src/tools/WebSearchTool/WebSearchTool.ts` |
| 用途 | 通过 Anthropic 原生搜索 API 在互联网上搜索信息，返回搜索结果 |
| 告知模型 | "Allows Claude to search the web and use the results to inform responses. CRITICAL: After answering, include a 'Sources:' section. Use the correct year in search queries." |
| 标记 | `shouldDefer: true`, `isReadOnly: true`, `isConcurrencySafe: true` |
| 参数 | `query`(必填), `allowed_domains?`, `blocked_domains?` |
| call() 逻辑 | 创建 `web_search_20250305` API 工具(带域名过滤) → 流式查询模型 → 追踪 server_tool_use 和 web_search_tool_result 事件 → 最多 8 次搜索 → 收集结果(标题+URL) → 报告进度 |

### 五、Agent 与子代理（3 个）

#### 10. Agent — 生成子 Agent

| 项目 | 内容 |
|------|------|
| 源码 | `/Users/cunyu666/Dev/Claude-Code/src/tools/AgentTool/AgentTool.tsx`（~1400 行） |
| 用途 | 启动新的子 agent 处理复杂多步任务，支持多种隔离模式，是 Claude Code 并行能力的核心 |
| 告知模型 | "Launch a new agent to handle complex, multi-step tasks autonomously." + agent 类型及工具访问权限；fork 模式(继承父上下文) vs 新建子 agent(零上下文)；何时 fork vs 新建；prompt 编写技巧；前台/后台执行；worktree/远程隔离 |
| 标记 | `isConcurrencySafe: true` |
| 参数 | `description`(必填), `prompt`(必填), `subagent_type?`, `model?`(sonnet/opus/haiku), `run_in_background?`, `isolation?`(worktree), `cwd?`, `name?`, `team_name?`, `mode?` |
| call() 逻辑 | 生成子 agent 进程(本地 agent / 后台 shell / 远程 agent) → 支持前台/后台执行 → worktree 隔离(git) → 远程隔离(CCR) → teammate 邮箱协调 → fork 模式继承父对话上下文 → 管理生命周期/进度/通知/结果收集 |

#### 11. TaskOutput — 获取后台任务输出

| 项目 | 内容 |
|------|------|
| 源码 | `/Users/cunyu666/Dev/Claude-Code/src/tools/TaskOutputTool/TaskOutputTool.tsx` |
| 用途 | 获取正在运行或已完成的后台任务(shell/agent/远程会话)的输出，已废弃建议用 Read 代替 |
| 告知模型 | "[Deprecated] -- prefer Read on the task output file path" + 别名 AgentOutputTool/BashOutputTool；支持阻塞(等待完成)和非阻塞(检查状态)模式 |
| 参数 | `task_id`(必填), `block?`(默认 true), `timeout?`(ms) |
| call() 逻辑 | 非阻塞模式立即返回状态；阻塞模式每 100ms 轮询直到完成或超时(最长 600s)；按任务类型提取数据(local_bash 取 stdout/stderr/exit code、local_agent 提取最终答案、remote_agent 含命令提示)；标记已通知 |

#### 12. TaskStop — 终止后台任务

| 项目 | 内容 |
|------|------|
| 源码 | `/Users/cunyu666/Dev/Claude-Code/src/tools/TaskStopTool/TaskStopTool.ts` |
| 用途 | 终止正在运行的后台任务，别名 KillShell |
| 告知模型 | "Stops a running background task by its ID. Returns a success or failure status." |
| 标记 | `shouldDefer: true` |
| 参数 | `task_id`(必填) |
| call() 逻辑 | 验证任务存在且处于 running/pending 状态 → 调用 `stopTask()` 终止 → 返回成功/失败 |

### 六、任务管理（5 个）

#### 13. TaskCreate — 创建任务

| 项目 | 内容 |
|------|------|
| 源码 | `/Users/cunyu666/Dev/Claude-Code/src/tools/TaskCreateTool/TaskCreateTool.ts` |
| 用途 | 在任务列表中创建新任务，用于跟踪复杂多步工作的进度 |
| 告知模型 | "Create a new task in the task list." + 何时使用(复杂多步任务、plan 模式、用户请求)；何时不用(单个简单任务)；任务字段(subject/description/activeForm)；创建有效任务的技巧 |
| 标记 | `shouldDefer: true` |
| 参数 | `subject`(必填), `description`(必填), `activeForm?`, `metadata?` |
| call() 逻辑 | 通过 task framework 创建任务 → 执行 TaskCreated hooks → 自动展开 UI 任务列表 → 初始状态 `pending`，无 owner |

#### 14. TaskGet — 获取任务详情

| 项目 | 内容 |
|------|------|
| 源码 | `/Users/cunyu666/Dev/Claude-Code/src/tools/TaskGetTool/TaskGetTool.ts` |
| 用途 | 按 ID 获取任务的完整详情，包括阻塞关系 |
| 告知模型 | "Get a task by ID from the task list. Returns full details: subject, description, status, blocks, blockedBy." |
| 标记 | `shouldDefer: true`, `isReadOnly: true` |
| 参数 | `taskId`(必填) |
| call() 逻辑 | 从 task state store 按 ID 获取任务 → 返回 subject/description/status/blocks(等待此任务的任务)/blockedBy(必须先完成的任务) |

#### 15. TaskUpdate — 更新任务

| 项目 | 内容 |
|------|------|
| 源码 | `/Users/cunyu666/Dev/Claude-Code/src/tools/TaskUpdateTool/TaskUpdateTool.ts` |
| 用途 | 更新任务状态、字段、阻塞关系，是任务生命周期管理的核心 |
| 告知模型 | "Update a task in the task list." + 标记完成/删除/更新字段；状态流转(pending → in_progress → completed)；staleness 警告 |
| 标记 | `shouldDefer: true` |
| 参数 | `taskId`(必填), `status?`, `subject?`, `description?`, `activeForm?`, `owner?`, `metadata?`, `addBlocks?`, `addBlockedBy?` |
| call() 逻辑 | 更新任务字段 → 处理删除(status=deleted) → TaskCompleted hooks → 管理 blocks/blockedBy 依赖关系 → teammate 自动分配 owner → 发送验证 nudge |

#### 16. TaskList — 列出所有任务

| 项目 | 内容 |
|------|------|
| 源码 | `/Users/cunyu666/Dev/Claude-Code/src/tools/TaskListTool/TaskListTool.ts` |
| 用途 | 列出所有任务及其状态，用于查看工作进度和发现被阻塞的任务 |
| 告知模型 | "List all tasks in the task list." + 何时使用：查看可用工作、检查进度、找被阻塞任务、完成任务后找新解锁工作 |
| 标记 | `shouldDefer: true`, `isReadOnly: true` |
| 参数 | 无 |
| call() 逻辑 | 从 task state store 获取所有任务 → 过滤内部任务 → 解析已完成的 blocker → 返回 id/subject/status/owner/blockedBy |

#### 17. TodoWrite — Legacy V1 待办列表

| 项目 | 内容 |
|------|------|
| 源码 | `/Users/cunyu666/Dev/Claude-Code/src/tools/TodoWriteTool/TodoWriteTool.ts` |
| 用途 | 旧版任务管理工具（已被 TaskCreate/Update/List/Get 取代），仅在 V2 未启用时使用 |
| 告知模型 | "Update the todo list for the current session. To be used proactively and often to track progress. Make sure at least one task is in_progress at all times. Always provide both content (imperative) and activeForm (present continuous) for each task." |
| 标记 | `shouldDefer: true` |
| 参数 | `todos`(数组), `metadata?` |
| call() 逻辑 | 整体替换 AppState 中的 todo list → 全部完成时清空列表 → 发送验证 nudge |

### 七、用户交互（1 个）

#### 18. AskUserQuestion — 向用户提问

| 项目 | 内容 |
|------|------|
| 源码 | `/Users/cunyu666/Dev/Claude-Code/src/tools/AskUserQuestionTool/AskUserQuestionTool.tsx` |
| 用途 | 向用户展示多选题以收集偏好、澄清歧义、获取决策，支持 preview 内容 |
| 告知模型 | "Asks the user multiple choice questions to gather information, clarify ambiguity, understand preferences, make decisions or offer them choices." + 支持 multiSelect；推荐选项放首位；plan 模式下不要问"计划准备好没"(用 ExitPlanMode)；preview 支持 markdown/HTML |
| 标记 | `shouldDefer: true`, `requiresUserInteraction: true` |
| 参数 | `questions`(1-4 个问题), 每个含 `question`, `header`, `options`(2-4 个), `multiSelect?`, `annotations?` |
| call() 逻辑 | 返回问题和预配置答案 → 实际用户交互由权限/UI 组件处理 → 支持单选/多选 → 可选 preview 内容(HTML mockup/代码片段/图表) |
| nP 对齐 | ✅ 已 1:1 移植（`extensions/builtin/ask-user-question/`），TUI 映射：select→单选、confirm→多选、input→自定义 |

### 八、代码智能（1 个）

#### 19. LSP — 语言服务器协议

| 项目 | 内容 |
|------|------|
| 源码 | `/Users/cunyu666/Dev/Claude-Code/src/tools/LSPTool/LSPTool.ts` |
| 用途 | 与 LSP 服务器交互获取代码智能功能：跳转定义、查找引用、悬停信息、符号搜索等 |
| 告知模型 | "Interact with Language Server Protocol (LSP) servers to get code intelligence features." + 9 种操作：goToDefinition, findReferences, hover, documentSymbol, workspaceSymbol, goToImplementation, prepareCallHierarchy, incomingCalls, outgoingCalls |
| 标记 | `shouldDefer: true`, `isReadOnly: true`, `isConcurrencySafe: true` |
| 参数 | `operation`(9 种), `filePath`(必填), `line`(必填), `character`(必填) |
| call() 逻辑 | 映射操作到 LSP 方法 → 按需在 LSP 服务器中打开文件 → 发送请求 → 处理两步 call hierarchy 工作流 → 过滤 gitignore 位置 → 格式化响应(文件路径/行号/符号信息) |

### 九、Skill 技能（1 个）

#### 20. Skill — 执行技能

| 项目 | 内容 |
|------|------|
| 源码 | `/Users/cunyu666/Dev/Claude-Code/src/tools/SkillTool/SkillTool.ts` |
| 用途 | 执行 slash-command 技能，支持 inline 和 forked 两种模式，是 Claude Code 可扩展性的核心 |
| 告知模型 | "Execute a skill within the main conversation. BLOCKING REQUIREMENT: invoke the relevant Skill tool BEFORE generating any other response when a skill matches." |
| 参数 | `skill`(必填), `args?` |
| call() 逻辑 | 按名称查找命令 → 处理 slash command 展开(别名/全限定名) → forked 模式启动子 agent / inline 模式注入当前对话 → 追踪 skill 使用分析 → 支持远程 canonical skills |

### 十、Plan 模式（2 个）

#### 21. EnterPlanMode — 进入计划模式

| 项目 | 内容 |
|------|------|
| 源码 | `/Users/cunyu666/Dev/Claude-Code/src/tools/EnterPlanModeTool/EnterPlanModeTool.ts` |
| 用途 | 请求进入 plan 模式，在编码前探索和设计实现方案 |
| 告知模型 | "Requests permission to enter plan mode for complex tasks requiring exploration and design." + 何时使用(新功能/多种方案/架构决策/多文件变更/需求不清)；何时不用(单行修复/明确指令/研究任务)；进入后的行为 |
| 标记 | `shouldDefer: true` |
| 参数 | 无 |
| call() 逻辑 | 更新 AppState 进入 plan 模式 → 准备 plan 模式上下文 → 需要用户批准 |

#### 22. ExitPlanMode — 退出计划模式

| 项目 | 内容 |
|------|------|
| 源码 | `/Users/cunyu666/Dev/Claude-Code/src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts` |
| 用途 | 展示计划供用户审批，获批后恢复编码模式 |
| 告知模型 | "Use this tool when you are in plan mode and have finished writing your plan to the plan file and are ready for user approval." + 从文件读取计划(非参数传入)；不要用 AskUserQuestion 做计划审批 |
| 标记 | `shouldDefer: true`, `requiresUserInteraction: true` |
| 参数 | `allowedPrompts?` |
| call() 逻辑 | 从磁盘读取计划文件 → teammate 计划审批(mailbox) → 恢复 plan 前的权限模式 → auto-mode gate 回退 → 通知 VSCode plan 模式退出 |

### 十一、Worktree 管理（2 个）

#### 23. EnterWorktree — 进入 Worktree

| 项目 | 内容 |
|------|------|
| 源码 | `/Users/cunyu666/Dev/Claude-Code/src/tools/EnterWorktreeTool/EnterWorktreeTool.ts` |
| 用途 | 创建隔离的 git worktree 并切换会话工作目录，用于独立的特性开发 |
| 告知模型 | "Creates an isolated worktree (via git or configured hooks) and switches the session into it." + 仅当用户明确要求时使用；在 `.claude/worktrees/` 创建基于 HEAD 的新 worktree |
| 标记 | `shouldDefer: true` |
| 参数 | `name?` |
| call() 逻辑 | 验证未在 worktree 中 → 查找 git root → 创建 worktree(git 或配置的 hooks) → 切换 CWD → 清除 CWD 依赖缓存 |

#### 33. ExitWorktree — 退出 Worktree

| 项目 | 内容 |
|------|------|
| 源码 | `/Users/cunyu666/Dev/Claude-Code/src/tools/ExitWorktreeTool/ExitWorktreeTool.ts` |
| 用途 | 退出 worktree 会话，保留或删除 worktree，恢复原始工作目录 |
| 告知模型 | "Exits a worktree session created by EnterWorktree and restores the original working directory." + 仅操作本次会话创建的 worktree；action: keep(保留)/remove(删除) |
| 标记 | `shouldDefer: true`, `isDestructive`(action='remove'时) |
| 参数 | `action`(keep/remove), `discard_changes?` |
| call() 逻辑 | 验证 worktree 会话存在 → 统计未提交更改 → keep 保留磁盘 / remove 删除(安全检查) → 终止 tmux session → 恢复原始 CWD → 清除缓存 |

### 十二、Cron 定时任务（3 个工具 + /loop skill + 5 层架构） ✅ 1:1 移植

> **移植范围**：CC 的完整 cron 系统 5 层架构全部移植 — `utils/cron.ts` → `utils/cronTasks.ts` → `utils/cronTasksLock.ts` → `utils/cronScheduler.ts` → `ScheduleCronTool/` + `skills/bundled/loop.ts`。

#### 34. CronCreate — 创建定时任务

| 项目 | 内容 |
|------|------|
| 源码 | `/Users/cunyu666/Dev/Claude-Code/src/tools/ScheduleCronTool/CronCreateTool.ts` |
| 用途 | 调度循环或一次性 prompt 执行，支持 session-only 和持久化两种模式 |
| 告知模型 | "Schedule a prompt to run at a future time -- either recurring on a cron schedule, or once at a specific time." + 标准 5 字段 cron 语法；避免 :00/:30 分钟以分散负载；durable 持久化到 `.claude/scheduled_tasks.json`；session-only 仅内存；REPL 空闲时才触发；循环任务 7 天后自动过期 |
| 标记 | `shouldDefer: true` |
| 参数 | `cron`(必填, 5 字段), `prompt`(必填), `recurring?`(默认 true), `durable?`(默认 false) |
| call() 逻辑 | 验证 cron 表达式 → 检查 1 年内有匹配 → 任务上限 50 → `addCronTask` → 返回 ID + 人类可读调度 |

#### 32. CronDelete — 删除定时任务

| 项目 | 内容 |
|------|------|
| 源码 | `/Users/cunyu666/Dev/Claude-Code/src/tools/ScheduleCronTool/CronDeleteTool.ts` |
| 用途 | 按 ID 取消之前创建的定时任务 |
| 告知模型 | "Cancel a cron job previously scheduled with CronCreate. Removes it from .claude/scheduled_tasks.json (durable jobs) or the in-memory session store (session-only jobs)." |
| 参数 | `id`(必填) |
| call() 逻辑 | 验证任务存在 → `removeCronTasks` 先扫 session 再扫文件 |

#### 33. CronList — 列出定时任务

| 项目 | 内容 |
|------|------|
| 源码 | `/Users/cunyu666/Dev/Claude-Code/src/tools/ScheduleCronTool/CronListTool.ts` |
| 用途 | 列出所有已调度的定时任务（持久化 + session-only） |
| 告知模型 | "List all cron jobs scheduled via CronCreate, both durable (.claude/scheduled_tasks.json) and session-only." |
| 参数 | 无 |
| call() 逻辑 | `listAllCronTasks` 合并 file + session → teammate 过滤 → 格式化输出 |

#### 34. /loop skill — 模型中介式定时任务创建

| 项目 | 内容 |
|------|------|
| 源码 | `/Users/cunyu666/Dev/Claude-Code/src/skills/bundled/loop.ts` |
| 用途 | `/loop [interval] <prompt>` → 解析间隔、转换 cron、调用 CronCreate、确认、立即执行 |
| 实现 | `buildLoopPrompt` 生成指导文本；间隔映射：`Nm→*/N * * * *`、`Nh→0 */N * * *`、`Nd→0 0 */N * *`、`Ns→向上取整到 1m`；默认 10m |

#### 五层架构详解

| 层 | CC 源码 | catui 移植 | 职责 |
|----|---------|-----------------|------|
| 1. Cron 解析 | `src/utils/cron.ts` | `loop/cron/cron-parser.ts` | 5 字段表达式解析、`expandField`（通配符/步进/范围/列表）、`computeNextCronRun`（逐分钟步进，dom/dow OR 语义，DST 处理）、`cronToHuman` |
| 2. 任务 CRUD | `src/utils/cronTasks.ts` | `loop/cron/cron-tasks.ts` | 双后端（文件 `.claude/scheduled_tasks.json` + session 内存 Map）、`addCronTask`/`removeCronTasks`/`markCronTasksFired`/`listAllCronTasks`/`findMissedTasks`、jitter 配置 |
| 3. 文件锁 | `src/utils/cronTasksLock.ts` | `loop/cron/cron-tasks-lock.ts` | O_EXCL 原子创建 `.claude/scheduled_tasks.lock`、PID 存活探测、过期锁自动清理 |
| 4. 调度器 | `src/utils/cronScheduler.ts` | `loop/cron/cron-scheduler.ts` | 1s tick 循环、chokidar 文件监听、锁获取/释放、任务老化（7 天过期）、错过任务检测、jitter 调度 |
| 5. 适配层 | `ScheduleCronTool/` + `skills/bundled/loop.ts` | `loop/cron-tools/` + `loop/loop-skill.ts` | 工具 schema/guidance/execute、/loop 命令解析 |

#### Jitter 算法（1:1 移植）

| 类型 | 策略 | 默认参数 |
|------|------|----------|
| 循环任务 | 正向延迟（区间比例） | `recurringFrac: 0.1`，`recurringCapMs: 15min` |
| 一次性任务 | 反向提前（避开 :00/:30） | `oneShotMaxMs: 90s`，`oneShotMinuteMod: 30` |
| 确定性种子 | taskId hex 前 4 位 → u32 → [0,1) | 同一任务每次重启 jitter 不变 |

### 十三、MCP 集成（2 个）

#### 32. ListMcpResources — 列出 MCP 资源

| 项目 | 内容 |
|------|------|
| 源码 | `/Users/cunyu666/Dev/Claude-Code/src/tools/ListMcpResourcesTool/ListMcpResourcesTool.ts` |
| 用途 | 列出已配置 MCP 服务器提供的资源，每个资源标明来源服务器 |
| 告知模型 | "Lists available resources from configured MCP servers. Each resource object includes a 'server' field indicating which server it's from." |
| 标记 | `shouldDefer: true`, `isReadOnly: true` |
| 参数 | `server_name?` |
| call() 逻辑 | 遍历所有 MCP 客户端 → 获取各服务器资源(LRU 缓存) → 处理断连重连 → 返回合并资源列表(含服务器归属) |

#### 33. ReadMcpResource — 读取 MCP 资源

| 项目 | 内容 |
|------|------|
| 源码 | `/Users/cunyu666/Dev/Claude-Code/src/tools/ReadMcpResourceTool/ReadMcpResourceTool.ts` |
| 用途 | 按服务器名和 URI 读取特定 MCP 资源的内容 |
| 告知模型 | "Reads a specific resource from an MCP server, identified by server name and resource URI." |
| 标记 | `shouldDefer: true`, `isReadOnly: true` |
| 参数 | `server_name`(必填), `uri`(必填) |
| call() 逻辑 | 按名称查找 MCP 客户端 → 发送 `resources/read` 请求 → 拦截二进制 blob 保存到磁盘(带扩展名) → 返回资源内容 |

### 十四、Feature-Flagged 条件工具（20+ 个）

这些工具通过 feature flag 或环境变量条件启用：

| 工具 | 源码路径 | Flag | 用途 |
|------|----------|------|------|
| **REPL** | `src/tools/REPLTool/REPLTool.ts` | `ant` 用户 | REPL 交互模式，允许在对话中执行代码片段 |
| **SuggestBackgroundPR** | `src/tools/SuggestBackgroundPRTool/` | `ant` 用户 | 建议创建后台 PR |
| **SleepTool** | `src/tools/SleepTool/SleepTool.ts` | `PROACTIVE`/`KAIROS` | 等待指定时间后继续 |
| **RemoteTriggerTool** | `src/tools/RemoteTriggerTool/` | `AGENT_TRIGGERS_REMOTE` | 远程触发 agent 执行 |
| **MonitorTool** | `src/tools/MonitorTool/MonitorTool.ts` | `MONITOR_TOOL` | 监控外部状态变化 |
| **SendUserFileTool** | `src/tools/SendUserFileTool/` | `KAIROS` | 向用户发送文件 |
| **PushNotificationTool** | `src/tools/PushNotificationTool/` | `KAIROS` | 推送通知到用户设备 |
| **SubscribePRTool** | `src/tools/SubscribePRTool/` | `KAIROS_GITHUB_WEBHOOKS` | 订阅 GitHub PR 事件 |
| **ConfigTool** | `src/tools/ConfigTool/ConfigTool.ts` | `ant` 用户 | 管理 Claude Code 配置 |
| **TungstenTool** | `src/tools/TungstenTool/` | `ant` 用户 | 实验性功能工具 |
| **OverflowTestTool** | `src/tools/OverflowTestTool/` | `OVERFLOW_TEST_TOOL` | 测试上下文溢出处理 |
| **CtxInspectTool** | `src/tools/CtxInspectTool/` | `CONTEXT_COLLAPSE` | 检查上下文状态 |
| **TerminalCaptureTool** | `src/tools/TerminalCaptureTool/` | `TERMINAL_PANEL` | 捕获终端输出 |
| **WebBrowserTool** | `src/tools/WebBrowserTool/` | `WEB_BROWSER_TOOL` | 浏览器自动化（CDP） |
| **SnipTool** | `src/tools/SnipTool/SnipTool.ts` | `HISTORY_SNIP` | 裁剪对话历史以节省上下文 |
| **ListPeersTool** | `src/tools/ListPeersTool/` | `UDS_INBOX` | 列出 UDS 通信的同伴 agent |
| **WorkflowTool** | `src/tools/WorkflowTool/` | `WORKFLOW_SCRIPTS` | 执行工作流脚本 |
| **PowerShellTool** | `src/tools/PowerShellTool/` | `isPowerShellToolEnabled()` | Windows PowerShell 命令执行 |
| **VerifyPlanExecutionTool** | `src/tools/VerifyPlanExecutionTool/` | `CLAUDE_CODE_VERIFY_PLAN` | 验证计划执行结果 |
| **SendMessageTool** | `src/tools/SendMessageTool/SendMessageTool.ts` | always | 向 teammate 发送消息 |
| **ToolSearchTool** | `src/tools/ToolSearchTool/` | `isToolSearchEnabledOptimistic()` | 发现延迟加载的工具 |
| **TeamCreateTool** | `src/tools/TeamCreateTool/` | `isAgentSwarmsEnabled()` | 创建 agent team |
| **TeamDeleteTool** | `src/tools/TeamDeleteTool/` | `isAgentSwarmsEnabled()` | 删除 agent team |
| **BriefTool** | `src/tools/BriefTool/BriefTool.ts` | always | 简要输出模式 |

---

## 工具注册与过滤机制

### 注册流程

```
getAllBaseTools()
  ↓ 基于 feature flag / env / runtime state 条件组装
getTools(permissionContext)
  ↓ 1. deny rules 移除完全禁止的工具
  ↓ 2. REPL 模式隐藏原始工具
  ↓ 3. isEnabled() 过滤
  ↓ 4. Simple 模式只保留 Bash/Read/Edit
assembleToolPool(permissionContext, mcpTools)
  ↓ 合并内置 + MCP 工具
  ↓ 排序（内置工具作为连续前缀，保证 prompt cache 稳定性）
  ↓ 按名称去重
```

---

## 权限与沙箱系统

### 权限流程

```
1. validateInput()        → 工具自定义输入校验
2. checkPermissions()     → 返回 { behavior: 'allow' | 'deny' | 'ask' | 'passthrough' }
3. permissions.ts         → 通用权限规则（deny/allow/ask）
4. preparePermissionMatcher() → hook if 条件匹配（如 Bash(git *)）
5. filterToolsByDenyRules()   → 在模型看到工具之前移除完全禁止的工具
```

### 权限上下文（ToolPermissionContext）

| 字段 | 说明 |
|------|------|
| `mode` | `'default'` / `'plan'` / `'auto'` / `'bypassPermissions'` / `'acceptEdits'` |
| `alwaysAllowRules` | 始终允许的规则 |
| `alwaysDenyRules` | 始终拒绝的规则 |
| `alwaysAskRules` | 始终询问的规则 |
| `additionalWorkingDirectories` | 额外允许的工作目录 |
| `shouldAvoidPermissionPrompts` | 后台 agent 避免权限提示 |

### 关键权限源码

| 文件 | 职责 |
|------|------|
| `src/utils/permissions/permissions.ts` | 核心权限逻辑 |
| `src/utils/permissions/filesystem.ts` | 文件读写权限检查 |
| `src/tools/BashTool/bashPermissions.ts` | Bash 特定权限 |
| `src/tools/BashTool/bashSecurity.ts` | Bash 安全分析 |
| `src/tools/BashTool/shouldUseSandbox.ts` | 沙箱决策 |

### Agent 工具限制

| 集合 | 包含工具 | 用途 |
|------|----------|------|
| `ALL_AGENT_DISALLOWED_TOOLS` | TaskOutput, ExitPlanMode, EnterPlanMode, AskUserQuestion, TaskStop | 所有 agent 禁止 |
| `ASYNC_AGENT_ALLOWED_TOOLS` | Read, WebSearch, TodoWrite, Grep, WebFetch, Glob, Bash, Edit, Write, NotebookEdit, Skill, ToolSearch, EnterWorktree, ExitWorktree | 异步 agent 允许 |
| `IN_PROCESS_TEAMMATE_ALLOWED_TOOLS` | TaskCreate, TaskGet, TaskList, TaskUpdate, SendMessage, CronCreate, CronDelete, CronList | 进程内 teammate 允许 |
| `COORDINATOR_MODE_ALLOWED_TOOLS` | Agent, TaskStop, SendMessage | 协调者模式允许 |

---

## 工具与对话上下文的交互机制

| 机制 | 说明 | 使用者 |
|------|------|--------|
| `newMessages` | 工具返回额外的 user/system 消息注入对话 | SkillTool, FileReadTool(PDF/图片元数据) |
| `contextModifier` | 修改后续轮次的 ToolUseContext | SkillTool（设置允许工具、model 覆盖、effort 级别） |
| `mapToolResultToToolResultBlockParam` | 将输出转为 API 格式 | 所有工具 |
| `readFileState` | 共享 LRU 缓存：文件读取时间戳 → Read-before-Write/Edit 强制 + 去重 | Read/Edit/Write/NotebookEdit |
| `toolDecisions` | tool call ID → 权限决策 map | 权限系统 |
| `queryTracking` | 链 ID + 深度，追踪嵌套 agent 调用 | AgentTool |
| `contentReplacementState` | 大结果预算管理 | 所有工具 |

---

## 关键设计模式

### 1. Lazy Schema（延迟 Schema）

所有工具使用 `lazySchema(() => z.strictObject({...}))` 推迟 Zod schema 创建，避免模块加载时的不必要编译。

### 2. 工具结果大小管理

`maxResultSizeChars` 控制输出何时持久化到磁盘（而非内联返回）：
- Read: `Infinity`（永不持久化）
- 大多数工具: `100,000`
- Grep: `20,000`

### 3. Staleness 检测

文件修改工具（Edit/Write/NotebookEdit）检查 `readFileState` 时间戳与文件系统 mtime，防止写入过时内容。

### 4. 延迟加载（Deferred Loading）

`shouldDefer: true` 的工具在 API 中以 `defer_loading: true` 发送，需要 `ToolSearchTool` 发现后才能调用。减少初始 prompt token 数量。

### 5. Skill 执行模式

- **Inline**: 消息注入当前对话
- **Forked**: 隔离子 agent，独立 token 预算，`context` 字段控制

### 6. 工具并发安全

`isConcurrencySafe(input)` 标记工具是否可并行执行。只读工具（Read/Glob/Grep/LSP/WebFetch/WebSearch）默认并发安全。

### 7. 输出格式化

`mapToolResultToToolResultBlockParam` 是每个工具将输出转为 Claude API `ToolResultBlockParam` 的唯一出口。大输出的替换策略由 `contentReplacementState` 管理。

---

## catui vs Claude Code 逐工具对齐分析

### 工具数量对比

| 维度 | Claude Code | catui | 差距 |
|------|-------------|------------|------|
| 核心/always-on 工具 | 29 个 | 8 个 | +21 |
| 条件/扩展工具 | 20+ 个（feature-flagged） | 26 个 | +0 |
| MCP 工具 | 原生支持 | 原生支持 | 持平 |
| **总计** | **~50 个** | **32 个** | **约 1.6x** |

### 一、功能对齐（相同/相似能力）

| 能力域 | Claude Code 工具 | catui 工具 | 对齐度 | 差异说明 |
|--------|-----------------|----------------|--------|----------|
| **读文件** | Read | read | 92% | CC 多 PDF/pages 参数、readFileState 去重、1GiB 限制；nP 多图片自动 resize；nP 已实现 fileStateCache 填充 |
| **编辑文件** | Edit | edit | 92% | CC 多 replace_all、LSP 通知；nP 用 fuzzyFindText 模糊匹配；staleness 两阶段检测已对齐（validateInput + mtime） |
| **写文件** | Write | write | 90% | CC 多 LSP 通知；nP staleness 检测已对齐（mtime 比对 + 缓存更新） |
| **Shell 执行** | Bash | bash | 80% | CC 多 run_in_background、description、沙箱决策子模块；nP 多 createSandboxHook、commandPrefix |
| **内容搜索** | Grep | grep | 85% | CC 多 output_mode(content/files_with_matches/count)、offset 分页；nP 多 literal 模式、自动 kill 超限进程 |
| **文件查找** | Glob | find | 80% | CC 用 node 内置 glob（100 结果限制）；nP 用 fd CLI（1000 结果、.gitignore 支持更好） |
| **目录列表** | ls（Bash 内） | ls | 70% | CC 通过 Bash 的 `ls` 实现；nP 有独立 ls 工具，500 条限制，目录 `/` 后缀 |
| **Plan 模式** | Enter/ExitPlanMode | Enter/ExitPlanMode | 95% | 5 级审批（standard/elevated/clear-context/keep-planning/reject）已对齐；`allowedPrompts` 参数已对齐；clear-context 通过 `/new` + `before_agent_start` 注入实现；CC 多 teammate 邮箱审批、CCR web UI 编辑；nP 多 TUI 状态栏 widget + Ctrl+G 快捷键 |
| **Cron 定时** | CronCreate/List/Delete + /loop skill | CronCreate/List/Delete + /loop skill | 99% | 1:1 移植 5 层架构（解析→CRUD→锁→调度器→适配层）；含 jitter、chokidar、O_EXCL 锁、7 天过期、错过任务检测；仅 GrowthBook feature gate 简化为常量 true |
| **Skill** | Skill | skill | 75% | CC 支持 inline/forked 两种执行模式、权限规则；nP 仅加载 markdown 文件内容 |
| **浏览器** | WebBrowserTool（feature-flagged） | browser + browser_admin | 70% | CC 是 feature-flagged 内置；nP 通过 Python Browser Harness CDP bridge，更完整（admin 工具） |
| **Web 搜索** | WebSearch | web_search | 60% | CC 用原生 Anthropic API（8 次搜索上限）；nP 依赖外部 agent-reach CLI |
| **Web 抓取** | WebFetch | web_fetch | 60% | CC 内置 HTML→markdown + 小模型处理 + 15 分钟缓存；nP 依赖外部 agent-reach CLI |
| **任务管理** | TaskCreate/Get/Update/List/Stop/Output + ToolSearch | 同名 7 个工具 | 90% | 1:1 移植 guidance/评分/核心逻辑；差异：无 hooks、无 deferred、无 teammate 邮箱 |
| **LSP** | LSP（9 种操作） | LSP（9 种操作） | 95% | 几乎一致 |
| **Usage Insights** | /insights（~3200 行） | /insights（~3200 行） | 95% | 1:1 移植：JSONL 会话扫描 → SessionMeta 提取 → SessionFacets LLM 分析 → 7+ 并行 insight 段落 → 交互式 HTML 报告（柱状图/直方图/时区时间分布图）+ 终端 markdown 摘要 |

### 二、Claude Code 有、catui 缺失

| 工具 | 能力 | 重要性 | 说明 |
|------|------|--------|------|
| **LSP** | goToDefinition/findReferences/hover/callHierarchy 等 9 种操作 | **高** | ✅ 已实现（`extensions/builtin/lsp/`，9 种操作全覆盖） |
| **NotebookEdit** | Jupyter `.ipynb` 单元格级编辑 | 中 | 数据科学场景刚需；nP 的 read/write 可读写 ipynb 但无单元格语义 |
| **Agent** | 子 agent + subagent_type + worktree 隔离 + 后台 + model 覆盖 | **高** | CC ~1400 行实现；nP 有基础子 agent 但缺 worktree 隔离和后台模式 |
| **TaskOutput** | 后台任务进度/输出查询 | 中 | ✅ 已实现（简化版，无后台进程） |
| **TaskStop** | 终止后台任务 | 中 | ✅ 已实现（简化版，标记 completed） |
| **TaskCreate/Get/Update/List** | 结构化任务管理（V2 含阻塞关系） | **高** | ✅ 已实现（1:1 移植，含磁盘持久化、阻塞关系、guidance 文本） |
| **ToolSearch** | 工具发现（关键词搜索 + select: 直选） | 低 | ✅ 已实现（评分算法 1:1 移植，无 deferred 概念差异） |
| **AskUserQuestion** | 结构化用户交互（多选、preview） | 中 | ✅ 已 1:1 移植（`extensions/builtin/ask-user-question/`），含单选/多选/Other/preview |
| **EnterWorktree/ExitWorktree** | Git worktree 隔离工作区 | 中 | 与 Agent 工具配合实现隔离执行 |
| **ListMcpResources/ReadMcpResource** | MCP 资源发现与读取 | 低 | CC 有独立 MCP 资源工具；nP 通过 MCPManager 管理但无专用工具 |
| **SendMessage** | Teammate 间消息传递 | 中 | CC 的多 agent 协作基础设施 |

### 三、catui 有、Claude Code 缺失

| 工具 | 能力 | 说明 |
|------|------|------|
| **time** | 系统时间感知 | CC 无此工具，依赖 prompt 中注入日期；nP agent 可主动查询时区/时间 |
| **ls** | 独立目录列表工具 | CC 通过 Bash 的 `ls` 实现；nP 独立工具更结构化 |
| **teach** | 引导式教学（类比+源验证） | CC 无教学能力；nP 独有的渐进式知识传授 |
| ~~interview~~ | ~~需求澄清 + 计划压力测试~~ | 已被 AskUserQuestion 替代（1:1 移植 CC 工具） |
| **goal** | `/goal` 长时目标管理 + idle continuation 自动续轮 | CC 无对等能力；灵感来自 codex-rs `/goal`，6 种状态（active/paused/blocked/usage_limited/budget_limited/complete）、token 预算记账、3 个 steering prompt、TUI 状态指示器 |
| **GRUB** | 自主长时任务引擎（feature-list 验证） | CC 无对等能力；nP 独有的两阶段自主迭代 loop，跨会话持久化 |
| **browser_admin** | 浏览器环境管理 | CC 无对等工具；nP 的 Browser Harness 安装/诊断/版本管理 |
| **link_world_admin/exec** | agent-reach CLI 集成 | CC 无对等工具；nP 的外部互联网能力管理层 |

### 四、实现机制差异

| 维度 | Claude Code | catui | 评价 |
|------|-------------|------------|------|
| **Schema 系统** | Zod v4（运行时验证 + TypeScript 推断） | TypeBox（运行时验证 + TypeScript 推断） | 持平，各有生态 |
| **权限模型** | 5 级模式（default/plan/auto/bypass/acceptEdits）+ allow/deny/ask 规则引擎 + preparePermissionMatcher hook | 3 组工具预设（codingTools/readOnlyTools/allTools）+ Plan 模式只读切换（read/grep/find/ls/time/source/LSP/AskUserQuestion）+ allowedPrompts 预批准权限持久化到会话状态 | CC 远更精细 |
| **输出管理** | maxResultSizeChars + 超限自动持久化到磁盘 | truncateHead/truncateTail + 超限溢出到临时文件 | CC 更系统化（per-tool 配置） |
| **Staleness 检测** | readFileState LRU 缓存 + mtime 比对 | fileStateCache LRU 缓存（100 条/25MB）+ mtime 比对 | **已对齐**：两阶段检测（validateInput 缓存存在 + execute mtime 比对） |
| **Read-before-Write/Edit** | 强制检查 readFileState | 强制检查 fileStateCache（edit 的 validateInput 阶段） | **已对齐**：未先 read 的 edit 会被拒绝 |
| **延迟加载** | shouldDefer + ToolSearch 动态发现 | ToolSearch 已实现（搜索全部工具，无 deferred 概念） | CC 减少初始 prompt token；nP 版 ToolSearch 功能可用但无延迟加载优化 |
| **并发安全** | isConcurrencySafe(input) 精细标记 | isConcurrencySafe 标记（部分工具） | CC 更完善 |
| **LSP 通知** | Edit/Write 自动发 didChange + didSave | 无 | CC 保持 LSP 状态同步 |
| **工具结果 API** | mapToolResultToToolResultBlockParam 统一出口 | 工具直接返回结果对象 | CC 更规范化 |
| **UI 渲染** | React 组件（6 种渲染回调） | TUI Container + formatToolExecution 分支 | 各有优势；CC 更灵活，nP 更轻量 |
| **Diff 预览** | 无预执行 diff | Edit 异步预执行 diff 预览 | **nP 领先** |

### 五、优先借鉴建议

| 优先级 | 能力 | 理由 | 实现难度 | 状态 |
|--------|------|------|----------|------|
| **P0** | LSP 工具 | 最大能力缺口；goToDefinition/findReferences/hover 是代码理解基础设施 | 中（需接入 LSP client） | ✅ 已完成 |
| **P0** | Staleness 检测 | Edit/Write 增加 mtime 比对，防止覆盖外部修改 | 低（mtime + 缓存） | ✅ 已完成（fileStateCache + 两阶段检测） |
| **P1** | 结构化任务管理 | TaskCreate/Get/Update/List + 阻塞关系，比无任务系统强很多 | 中 | ✅ 已完成 |
| **P1** | Agent worktree 隔离 | 子 agent 在独立 worktree 中执行，避免污染主工作区 | 中 | |
| **P1** | 权限规则引擎 | 从固定预设升级到 allow/deny/ask 规则 + per-tool 细粒度控制 | 高 | |
| **P2** | Read-before-Write/Edit | 强制先读后写，防止盲覆盖 | 低 | ✅ 已完成（edit 的 validateInput 强制检查） |
| **P2** | 延迟加载 + ToolSearch | shouldDefer + ToolSearch 减少初始 prompt token | 中 | ✅ 已完成 |
| **P2** | NotebookEdit | Jupyter 单元格级编辑 | 低 | |
| **P3** | MCP 资源工具 | ListMcpResources/ReadMcpResource | 低 | |
| **P3** | Agent 后台模式 | run_in_background + TaskOutput/TaskStop | 中 | ✅ TaskOutput/TaskStop 已完成（简化版） |
