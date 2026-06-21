# Claude Code TUI 人机交互设计拆解

> 源码版本：@anthropic-ai/claude-code@2.1.92
> 目标：让 catui 复刻 CC 的优秀 TUI 交互设计

---

## 一、一句话概括

CC 的 TUI 是一个 **Ink/React 驱动的终端应用**：极简的单行输入区 + 丰富的消息流渲染 + 内联权限审批 + 实时状态栏，核心理念是"**让用户永远知道发生了什么，永远不需要离开终端**"。

---

## 二、TUI 架构总览

### 2.1 CC 的技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 渲染引擎 | Ink (React for CLI) | Yoga flexbox 布局，虚拟 DOM diff |
| 状态管理 | 自定义 store（类似 Zustand） | `createStore` + `useSyncExternalStore` |
| 键输入 | 自定义状态机 `G64()` | 不依赖 readline，直接处理 stdin 字节 |
| 着色 | chalk | 终端颜色输出 |
| 组件 | Box/Text/Spacer/Ansi/Link/Button | Ink 原语 + 主题感知包装器 |

### 2.2 catui 的技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 渲染引擎 | 自研 Component 树 | `render(width): string[]` + 差量渲染 |
| 状态管理 | Controller 注入（依赖倒置） | 各 Controller 通过 port 接口通信 |
| 键输入 | StdinBuffer + Kitty 协议 | 支持传统 VT + Kitty 键盘协议 |
| 着色 | chalk + cli-highlight | 语法高亮 lazy-loaded |
| 组件 | Container/Component/Overlay | 轻量级，无 React 依赖 |

### 2.3 组件树对比

**CC 组件树**：
```
<AppStateProvider>
  <VoiceProvider>
    <KeyBindingsProvider>
      <PM6 (Transcript/MessageList)>
        <UserMessage />
        <AssistantMessage />
        <ToolUseMessage />      // 每个工具 5 个渲染方法
        <ThinkingMessage />
        <BashOutputMessage />
      </PM6>
      <InputBox />              // TextInput + @ 引用
      <Footer />                // 状态栏
      <PermissionDialog />      // 内联审批
      <Spinner />               // CK 组件
      <NotificationToast />     // 优先级队列
    </KeyBindingsProvider>
  </VoiceProvider>
</AppStateProvider>
```

**catui 组件树**：
```
TUI (root)
  +-- headerContainer (logo, keybinding hints)
  +-- notificationQueue (优先级通知，浮动在顶部)
  +-- chatContainer (CachedContainer，渲染缓存 + 视口裁剪)
  |     +-- UserMessage / AssistantMessage / ToolExecution / ...
  +-- pendingMessagesContainer
  +-- statusContainer
  +-- widgetContainerAbove (extension widgets)
  +-- editorContainer
  |     +-- attachmentsBar (image paste)
  |     +-- EditorBuddyLayout
  |           +-- CustomEditor (input box，slash 命令高亮)
  |           +-- buddySlot (pet sprite)
  +-- widgetContainerBelow
  +-- FooterComponent (status bar)
```

**关键差异**：CC 的权限审批是内联在消息流中的，catui 没有。

---

## 三、输入系统

### 3.1 自定义键解析器（G64 函数）

CC 没有使用 readline 或第三方输入库，而是实现了一个**自定义的字节级键解析器**。

```typescript
// CC 源码中的键解析状态机
function G64(keyParseState, inputByte): [parsedKeys[], newState] {
  // 两种模式：
  // - NORMAL: 普通输入模式
  // - IN_PASTE: 括号粘贴模式（ESC[200~ 开始，ESC[201~ 结束）
  
  // 使用 vT6 tokenizer 处理原始 stdin 字节
  // 支持 x10 鼠标事件
}
```

**超时机制**：
- 普通转义序列：50ms 超时（`NORMAL_TIMEOUT`）
- 粘贴模式：500ms 超时（`PASTE_TIMEOUT`）
- `incompleteEscapeTimer` 处理歧义转义序列

### 3.2 修饰键检测（P64 函数）

```typescript
function P64(paramByte): { shift, meta, ctrl, super } {
  return {
    shift: !!(paramByte & 1),   // Bit 0
    meta:  !!(paramByte & 2),   // Bit 1
    ctrl:  !!(paramByte & 4),   // Bit 2
    super: !!(paramByte & 8),   // Bit 3
  };
}
```

### 3.3 括号粘贴模式

CC 完整支持 bracketed paste，避免粘贴内容被当作命令执行：

```
粘贴开始：ESC[200~  （$64 常量）
粘贴结束：ESC[201~  （w64 常量）
```

在 `IN_PASTE` 模式下，所有输入累积到 `pasteBuffer`，直到结束序列到达。

### 3.4 鼠标事件（D64 函数）

CC 支持两种鼠标协议：
- **SGR 模式**：`ESC[<...M`（按下）/ `ESC[<...m`（释放）
- **X10 模式**：`ESC[M...`

事件结构：`{ kind: "mouse", button, action: "press"|"release", col, row }`

双击/三击检测：通过 `lastClickTime`、`lastClickCol`、`lastClickRow`、`clickCount` 追踪。

### 3.5 输入框组件

CC 的输入框特点：
- **单行默认**：`>` 提示符 + TextInput 组件
- **多行输入**：Shift+Enter（Apple Terminal/tmux）或 `\` + Enter（其他终端）
- **@ 文件引用**：输入文本中的 `@path` 被解析为文件引用
- **光标偏移追踪**：`onChangeCursorOffset` / `onSubmit` / `onChange`
- **vim 模式切换**：INSERT / NORMAL 两种子模式

### 3.6 catui 对标点

| 特性 | CC | catui | 差距 |
|------|-----|-----------|------|
| 键解析 | 自定义状态机（VT 序列） | StdinBuffer + Kitty 协议 | catui 更先进 |
| 修饰键 | 位掩码检测 | Key.ctrl/shift/alt 组合 | 等价 |
| 粘贴模式 | 完整支持 | 完整支持 | 等价 |
| 鼠标事件 | SGR + X10 | Kitty 协议 | catui 更先进 |
| @ 文件引用 | ✅ | ❌ | **catui 缺失** |
| 多行输入 | Shift+Enter / `\`+Enter | 支持 | 等价 |
| 输入框高亮 | slash 命令高亮（suggestion 色） | slash 命令高亮（accent 色） | 等价 |

---

## 四、键盘快捷键体系

### 4.1 两层架构

CC 的键处理分为两层：

**第一层：低层字节解析**（`G64` 函数）
- 处理原始 stdin 字节
- 解析转义序列、修饰键、鼠标事件
- 处理括号粘贴
- 输出结构化 key 事件

**第二层：React 层 action 绑定**（`J1` 函数）
```
J1(actionId, handler, { context, isActive })
```
- 绑定 action ID 到处理函数
- 支持上下文感知（不同 UI 状态下不同快捷键）
- 通过 `KeyBindingsProvider` 注入 React 组件树

### 4.2 KeyBindingsProvider

```typescript
// CC 的键绑定上下文
<KeyBindingsProvider>   // ph8
  {children}
</KeyBindingsProvider>
```

键绑定从 `~/.claude/keybindings.json` 加载，支持用户自定义。

### 4.3 上下文感知（18 个 context）

CC 定义了 18 个输入上下文，不同 UI 状态下激活不同的快捷键：

| Context | 用途 |
|---------|------|
| `app` | 全局应用级 |
| `history` | 历史浏览 |
| `chat` | 聊天输入 |
| `autocomplete` | 自动补全 |
| `confirm` | 确认对话框 |
| `tabs` | Tab 切换 |
| `transcript` | 消息流浏览 |
| `historySearch` | 历史搜索 |
| `task` | 任务管理 |
| `theme` | 主题选择 |
| `help` | 帮助页面 |
| `attachments` | 附件管理 |
| `footer` | 底部状态栏 |
| `messageSelector` | 消息选择器 |
| `diff` | Diff 查看 |
| `modelPicker` | 模型选择 |
| `select` | 通用选择器 |
| `permission` | 权限审批 |

### 4.4 不可重绑定键

CC 将某些键标记为不可重绑定：
- `Ot6` — 错误键（会导致错误的绑定）
- `jU1` — 终端保留键
- `HU1` — macOS 保留键

### 4.5 核心快捷键清单

| 快捷键 | Action | Context | 说明 |
|--------|--------|---------|------|
| `Escape` | cancel | confirm/chat | 取消/退出（双击安全机制） |
| `Ctrl+C` | clear/interrupt | app | 复制文本 / 中断操作 |
| `Ctrl+D` | exit | app | 退出 |
| `Tab` | nextSuggestion | autocomplete | 下一个补全建议 |
| `Shift+Tab` | previousSuggestion | autocomplete | 上一个补全建议 |
| `Enter` | submit | chat | 提交输入 |
| `Shift+Enter` | newline | chat | 换行 |
| `Up/Down` | navigate | history/select | 历史/菜单导航 |
| `Ctrl+R` | refresh | app | 刷新 |
| `q` | quit | select | 快速退出选择器 |

### 4.6 catui 对标点

| 特性 | CC | catui | 差距 |
|------|-----|-----------|------|
| 两层架构 | ✅ | ✅（StdinBuffer + AppAction） | 等价 |
| 可配置 keybindings | ✅ ~/.claude/keybindings.json | ✅ ~/.pencils/keybindings.json | 等价 |
| 上下文感知 | 18 个 context | Controller 级别隔离 | CC 更细粒度 |
| 不可重绑定键 | ✅ 三类保护 | ❌ | **catui 缺失** |
| 快捷键数量 | 20+ | 20+ | 等价 |

---

## 五、Slash 命令系统

### 5.1 注册机制

```typescript
// CC 的命令注册函数 Ow()
Ow({
  name: "model",
  description: "Set AI model for Claude Code",
  aliases: [],
  allowedTools: [...],
  argumentHint: "[model-name]",
  whenToUse: "...",
  userInvocable: true,
  disableModelInvocation: false,
  isEnabled: () => true,
  isHidden: false,
  getPromptForCommand: (args) => "...",
  files: [],
  load: async () => import("./model"),
  context: "local-jsx",
  agent: undefined,
});
```

### 5.2 三种命令类型

| 类型 | 行为 | 示例 |
|------|------|------|
| `prompt` | 注入系统提示给 LLM | `/simplify`, `/debug`, `/review` |
| `local` | 执行本地函数 | `/voice`, `/stickers` |
| `local-jsx` | 渲染 JSX 交互组件 | `/model`, `/effort`, `/export`, `/stats` |

**关键洞察**：`local-jsx` 类型允许命令渲染交互式 UI 组件（选择器、对话框等），这是 CC 的独特设计。

### 5.3 懒加载机制

CC 的命令通过 `load` 函数懒加载：
```typescript
load: async () => import("./model-command")
```
只有在用户首次调用时才加载命令代码，减少启动时间。

### 5.4 Tab 补全

输入 `/` 后自动触发补全：
- Tab 键循环匹配的命令
- `suggestions` / `selectedSuggestion` 状态管理
- 命令支持 `argumentHint` 显示参数提示

### 5.5 完整命令清单

| 命令 | 类型 | 说明 |
|------|------|------|
| `/help` | prompt | 显示帮助 |
| `/clear` | local | 清空对话 |
| `/compact` | prompt | 压缩/摘要对话 |
| `/config` | local-jsx | 打开配置面板 |
| `/cost` | local | 显示费用 |
| `/doctor` | local | 系统健康检查 |
| `/init` | prompt | 初始化 CLAUDE.md |
| `/login` | local | 登录 |
| `/logout` | local | 登出 |
| `/memory` | prompt | 管理记忆文件 |
| `/model` | local-jsx | 切换模型 |
| `/permissions` | local | 管理权限 |
| `/review` | prompt | 代码审查 |
| `/status` | local | 显示状态 |
| `/terminal-setup` | local | 终端集成设置 |
| `/vim` | local | 切换 vim 模式 |
| `/theme` | local-jsx | 切换主题 |
| `/bug` | local | 提交 bug 报告 |
| `/quit` `/exit` | local-jsx | 退出 |
| `/mcp` | local | MCP 服务器管理 |
| `/agents` | local | 列出 agent |
| `/skills` | local | 管理 skills |
| `/update-config` | prompt | 更新配置 |
| `/loop` | prompt | 定时循环执行 |
| `/batch` | prompt | 并行 worktree 批量变更 |
| `/simplify` | prompt | 代码质量审查 |
| `/stats` | local-jsx | 使用统计 |
| `/export` | local-jsx | 导出对话 |
| `/effort` | local-jsx | 设置推理努力程度 |
| `/stuck` | prompt | 诊断卡住的会话 |
| `/brief` | local-jsx | 切换简洁模式 |
| `/voice` | local | 语音模式 |
| `/schedule` | prompt | 定时远程 agent |
| `/advisor` | local-jsx | 配置 advisor 模型 |

### 5.6 命令别名

- `/quit` = `/exit`
- `remote-control` = `rc`
- `plugin` = `plugins`
- `update` = `upgrade`

### 5.7 catui 对标点

| 特性 | CC | catui | 差距 |
|------|-----|-----------|------|
| 命令数量 | 30+ | 30+ | 等价 |
| 命令类型 | 3 种（prompt/local/local-jsx） | 2 种（prompt/local） | **缺 local-jsx** |
| 懒加载 | ✅ | ❌ | **catui 缺失** |
| Tab 补全 | ✅ | ✅（含参数级补全） | catui 更好 |
| 命令别名 | ✅ | ✅ | 等价 |
| argumentHint | ✅ | ✅ | 等价 |

---

## 六、权限审批 UI（重点）

这是 CC 与 catui **最大的设计差异**。catui 的工具执行无需用户确认，CC 有完整的交互式审批系统。

### 6.1 权限模型：三态

每个工具调用返回一个权限结果：

```typescript
interface PermissionResult {
  behavior: "allow" | "ask" | "deny";
  message: string;                    // 解释为什么需要审批
  decisionReason: { type: "mode" | "rule" | "other" | "safetyCheck" };
  updatedInput?: object;              // "allow" 时可修改输入
  blockedPath?: string;               // 路径违规时
  suggestions?: Array<Suggestion>;    // UI 建议操作
}
```

- **allow** — 直接执行，不提示用户
- **ask** — 显示审批对话框，等待用户决定
- **deny** — 直接阻止，不执行

### 6.2 权限模式

| 模式 | 行为 |
|------|------|
| `default` | 每个工具都需要确认 |
| `acceptEdits` | 编辑操作自动允许，破坏性操作需确认 |
| `auto` | ML 分类器自动审批 |
| `plan` | 只读 + plan 模式 |
| `bypassPermissions` | 跳过所有权限检查（危险） |
| `dontAsk` | 拒绝所有需要审批的操作 |

### 6.3 权限规则来源优先级

CC 从 8 个来源检查权限规则，按优先级排序：

1. `policySettings` — 组织策略（只读）
2. `flagSettings` — 功能标志（只读）
3. `command` — CLI 参数（只读）
4. `projectSettings` — `.claude/settings.json`
5. `userSettings` — `~/.claude/settings.json`
6. `localSettings` — `.claude/settings.local.json`
7. `cliArg` — 运行时 CLI 参数
8. `session` — 当前会话

### 6.4 审批对话框

CC 的权限审批是**内联在消息流中的**（非 modal 弹窗）：

```
╭─ Tool: Edit ─────────────────────────────────────╮
│ File: src/auth/login.ts                          │
│                                                   │
│  [Diff preview of the changes]                   │
│                                                   │
│  ┌─────────┐ ┌──────────────┐ ┌────────────────┐ │
│  │  Allow   │ │ Allow Always │ │     Deny       │ │
│  └─────────┘ └──────────────┘ └────────────────┘ │
│                                                   │
│  Suggestions:                                     │
│  • Add src/ to session allowed directories        │
│  • Switch to acceptEdits mode                     │
╰───────────────────────────────────────────────────╯
```

组件：
- `N1` — 对话框容器
- `z1` — 选项选择器（Allow/Deny/Always-Allow）
- `h1` — 输入提示栏（显示可用快捷键）
- `n8` — 按键和弦显示（如 "ctrl+k"）
- `QQ` — 焦点选项指示器

### 6.5 建议操作（Suggestions）

审批对话框可以显示**上下文相关的建议**：

| 建议类型 | 说明 |
|---------|------|
| `addDirectories` | 将目录添加到会话允许列表 |
| `setMode` | 切换权限模式（如切换到 acceptEdits） |
| `addRules` | 持久化权限规则到设置文件 |

### 6.6 只读命令自动审批

CC 的 `QL8()` 函数检查 bash 命令是否只读：

```typescript
// 自动审批的安全命令
const SAFE_READONLY_COMMANDS = [
  "cat", "head", "tail", "ls", "find", "grep", "rg",
  "wc", "diff", "file", "which", "echo", "pwd",
  // ...
];

// 需要审批的危险命令
const DANGEROUS_COMMANDS = [
  "rm", "rmdir", "sed", "mv", "cp", "chmod", "chown",
  // ...
];
```

只读命令自动通过，危险命令需要用户确认。路径验证确保命令只能访问允许的目录。

### 6.7 Diff 预览

审批文件编辑操作时，CC 会展示 **unified diff 预览**：

```
--- a/src/auth/login.ts
+++ b/src/auth/login.ts
@@ -15,7 +15,9 @@
   async function login(email: string, password: string) {
-    const user = await db.findUser(email);
+    const user = await db.findUserByEmail(email);
+    if (!user) throw new AuthError("User not found");
+    
     const valid = await bcrypt.compare(password, user.hash);
```

Diff 引擎支持：
- 字符级 diff
- 词级 diff（`aM4`，使用 Intl segmenter）
- 行级 diff（`sM4`）
- 语法高亮（可通过 `syntaxHighlightingDisabled` 关闭）

### 6.8 Auto Mode 分类器

CC 的 `auto` 模式使用 ML 分类器自动审批工具调用：

```typescript
// TS8 函数：运行 auto mode 分类器
const result = await TS8(
  [...agentMessages, reviewPrompt],
  tools, toolPermissionContext, abortSignal
);
// 返回：{ shouldBlock, reason, model, usage }
```

- 分类器使用小模型审查工具调用
- 追踪 `totalDenials` 和 `consecutiveDenials`
- 分类器不可用时降级为手动审批
- 转录过长时也降级

### 6.9 catui 对标点

| 特性 | CC | catui | 差距 |
|------|-----|-----------|------|
| 权限三态 | allow/ask/deny | allow/deny | **缺 ask（交互式）** |
| 权限模式 | 6 种 | 无模式概念 | **缺失** |
| 审批对话框 | ✅ 内联 | ❌ | **缺失** |
| Diff 预览 | ✅ 审批前 | ✅ 工具渲染中 | 等价但时机不同 |
| 建议操作 | ✅ | ❌ | **缺失** |
| 只读自动审批 | ✅ | ❌ | **缺失** |
| Auto mode 分类器 | ✅ | ❌ | **缺失** |
| 权限规则优先级 | 8 级 | ❌ | **缺失** |

**复刻建议**：这是 catui 最大的 TUI 差距。建议分阶段实现：
1. P0：基础审批对话框（allow/deny + 快捷键）
2. P1：只读自动审批 + 权限模式（default/acceptEdits/auto）
3. P2：建议操作 + 权限规则持久化 + auto mode 分类器

---

## 七、消息渲染管线

### 7.1 Transcript 组件（PM6）

CC 的消息列表组件接收以下 props：

```typescript
PM6({
  messages,                    // 消息数组
  tools,                       // 工具定义
  commands,                    // 命令定义
  verbose,                     // 详细模式
  toolJSX,                     // 工具 JSX 缓存
  toolUseConfirmQueue,         // 审批队列
  inProgressToolUseIDs,        // 执行中的工具 ID
  isMessageSelectorVisible,    // 消息选择器可见性
  conversationId,              // 会话 ID
  screen,                      // 屏幕信息
  streamingToolUses,           // 流式工具使用
  showAllInTranscript,         // 显示全部历史
  isLoading,                   // 加载状态
  renderRange,                 // 渲染范围（虚拟滚动）
  disableRenderCap,            // 禁用渲染上限
})
```

### 7.2 消息类型渲染器

CC 为每种消息类型提供专用渲染器：

| 渲染器 | 函数名 | 用途 |
|--------|--------|------|
| 用户消息 | `Z9K` | 渲染用户输入 |
| 助手消息 | `I9K` | 渲染 LLM 输出 |
| 思考消息 | `Su8` | 渲染 thinking/reasoning |
| Bash 输出 | `PH6` / `g9K` | 渲染命令执行结果 |
| 记忆输入 | `n9K` | 渲染记忆加载 |
| Plan 内容 | `Fu8` | 渲染计划内容 |

### 7.3 工具执行渲染（5 个方法）

每个工具定义必须实现 5 个渲染方法：

```typescript
interface ToolRenderers {
  renderToolUseMessage(input): JSX;           // 正在执行时显示
  renderToolUseProgressMessage(input): JSX;   // 执行进度
  renderToolResultMessage(result): JSX;       // 执行结果
  renderToolUseRejectedMessage(): JSX;        // 被拒绝时显示
  renderToolUseErrorMessage(error): JSX;      // 出错时显示
}
```

### 7.4 Markdown 渲染

CC 使用**终端原生 markdown 渲染器**（非 web markdown 库）：
- 代码块语法高亮
- 表格渲染
- 链接（可点击终端链接）
- 标题、列表、引用

### 7.5 长输出处理（虚拟滚动）

CC 通过 `renderRange` 实现虚拟滚动：

```typescript
// 只渲染可见范围内的消息
const visibleMessages = messages.slice(
  renderRange.start,
  renderRange.end
);
```

- `disableRenderCap` 可禁用渲染上限（用于导出）
- `showAllInTranscript` 显示完整对话历史

### 7.6 catui 对标点

| 特性 | CC | catui | 差距 |
|------|-----|-----------|------|
| 消息类型渲染器 | 6 种 | 类似 | 等价 |
| 工具渲染方法 | 5 个/工具 | per-tool 渲染 | 等价 |
| Markdown | 终端原生 | marked + cli-highlight | 等价 |
| 虚拟滚动 | ✅ renderRange | ✅ CachedContainer（渲染缓存 + 视口裁剪） | 等价 |
| 导出功能 | /export | /export | 等价 |

---

## 八、Spinner 与进度指示

### 8.1 Spinner 组件（CK）

CC 的 spinner 是一个动画组件，在 LLM 思考/工具执行时显示：

```typescript
// 使用方式
createElement(CK, null)  // 显示 spinner
// 后跟文本如 "Installing it2..."
```

### 8.2 可配置的 Spinner Tips 和 Verbs

CC 允许用户自定义 spinner 的显示内容：

```typescript
// 设置项
spinnerTipsEnabled: true,           // 是否显示 tips
spinnerVerbs: {
  mode: "append" | "replace",      // 追加或替换默认 verbs
  verbs: ["Thinking...", "Analyzing...", "Working..."]
},
spinnerTipsOverride: {
  excludeDefault: true,             // 排除默认 tips
  tips: ["Custom tip 1", "Custom tip 2"]
}
```

### 8.3 Agent/子 Agent 进度

CC 在子 agent 执行时显示进度：

```typescript
// Fm8 函数：渲染 skill/agent 进度
// 最多显示最近 3 个 tool use（coz = 3）
// 无进度时显示 "Initializing..."（loz = "Initializing..."）
// verbose 模式下显示全部进度
```

### 8.4 Task activeForm

CC 的 Task 系统支持 `activeForm` 字段：

```typescript
TaskCreate({
  subject: "Run tests",
  activeForm: "Running tests",  // spinner 中显示的文本
});
```

当任务 `in_progress` 时，spinner 显示 `activeForm` 文本（或回退到 `subject`）。

### 8.5 catui 对标点

| 特性 | CC | catui | 差距 |
|------|-----|-----------|------|
| Spinner 动画 | CK 组件 | PencilLoader（钻石旋转） | 等价 |
| Stall 检测 | ❌ | ✅ 3 秒超时变色 | **catui 更好** |
| Tips/Verbs 可配置 | ✅ | ✅（10 条内置 tips，6 秒轮换） | 等价 |
| Agent 进度 | ✅ 最近 3 个 tool use | 类似 | 等价 |
| activeForm | ✅ | ✅（Task 系统） | 等价 |

---

## 九、状态栏 / Footer

### 9.1 状态栏内容

CC 的 footer 显示：

| 信息 | 说明 |
|------|------|
| API key 状态 | 是否已认证 |
| Debug 模式 | 是否启用调试 |
| Vim 模式 | INSERT/NORMAL（vim 模式时） |
| 权限模式 | default/auto/acceptEdits 等 |
| 自动更新状态 | 是否有可用更新 |
| Verbose 模式 | 是否详细输出 |
| 建议 | 上下文相关的操作建议 |

### 9.2 上下文窗口使用率

CC 在状态 JSON 中输出详细的上下文信息：

```typescript
{
  context_window: {
    total_tokens: 200000,
    remaining: 150000,
    used_percentage: 25,
    remaining_percentage: 75,
    input_tokens: 100000,
    output_tokens: 50000,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  }
}
```

### 9.3 Rate Limit 显示

CC 显示 Claude.ai 订阅的 rate limit 信息：

```typescript
{
  rate_limits: {
    "5h": {
      used_percentage: 45,
      resets_at: "2026-06-11T15:00:00Z"
    },
    "7d": {
      used_percentage: 12,
      resets_at: "2026-06-18T00:00:00Z"
    }
  }
}
```

### 9.4 自定义 Statusline

CC 支持用户自定义状态栏：

```bash
# ~/.claude/statusline-command.sh
#!/bin/bash
echo "$(pwd) | $(git branch --show-current) | $(date +%H:%M)"
```

通过 `/statusline` 命令设置，输出被注入到状态栏。

### 9.5 catui 对标点

| 特性 | CC | catui | 差距 |
|------|-----|-----------|------|
| 基础信息 | model/token/cost | model/token/cost/context | 等价 |
| 上下文使用率 | JSON 输出 | 进度条 `[████░░░░]` | **catui 更好** |
| Rate limit | ✅ 5h + 7d | ❌ | **catui 缺失** |
| 自定义 statusline | ✅ shell 脚本 | ❌ | **catui 缺失** |
| Git 分支 | ❌ | ✅ | **catui 更好** |
| 会话名 | ❌ | ✅ | **catui 更好** |

---

## 十、通知系统

### 10.1 优先级队列

CC 的通知系统使用优先级队列：

```typescript
// PK hook
useNotifications()
// 优先级：immediate > high > medium > low
```

### 10.2 自动消失

```typescript
const nK7 = 8000;  // 默认 8 秒后自动消失
```

### 10.3 折叠与失效

- **折叠**：相同 key 的通知合并
- **失效**：新通知替换旧通知（相同 key）

### 10.4 通知渠道

```typescript
type NotificationChannel =
  | "auto"                    // 自动选择
  | "iterm2"                  // iTerm2 通知
  | "iterm2_with_bell"        // iTerm2 + 终端铃声
  | "terminal_bell"           // 终端铃声
  | "kitty"                   // Kitty 通知
  | "ghostty"                 // Ghostty 通知
  | "notifications_disabled"; // 禁用
```

### 10.5 桌面通知集成

CC 集成了多种终端的通知协议：
- **iTerm2**：OSC 9/1337 + Python API
- **Kitty**：OSC 99
- **Ghostty**：版本 >= 1.2.0

### 10.6 catui 对标点

| 特性 | CC | catui | 差距 |
|------|-----|-----------|------|
| 通知队列 | ✅ 4 级优先级 | ✅ NotificationQueue（4 级优先级 + key 去重） | 等价 |
| 自动消失 | ✅ 8 秒 | ✅ 5 秒（status/warning），通知队列 3-12 秒按优先级 | 等价 |
| 折叠/失效 | ✅ | ✅ key 去重 + 连续 status 替换 | 等价 |
| 通知渠道 | 7 种 | ❌ | **catui 缺失** |
| 桌面通知 | ✅ | ❌ | **catui 缺失** |

---

## 十一、Diff 引擎与展示

### 11.1 Zo 类层次

CC 实现了一个完整的 diff 引擎：

```
Zo（基类：字符级 diff，Myers 算法）
  ├── aM4（词级 diff，Intl segmenter 支持）
  ├── sM4（行级 diff）
  ├── qX4（行级 diff，含空白/换行处理）
  └── _X4（数组 diff）
```

### 11.2 Unified Diff 生成（oV6 函数）

```typescript
function oV6(oldText, newText, options): Patch {
  return {
    oldFileName: "...",
    newFileName: "...",
    oldHeader: "...",
    newHeader: "...",
    hunks: [{
      oldStart: 15,
      oldLines: 7,
      newStart: 15,
      newLines: 9,
      lines: [
        "  unchanged line",
        "- removed line",
        "+ added line",
      ]
    }]
  };
}
```

### 11.3 语法高亮

Diff 输出的语法高亮通过 `syntaxHighlightingDisabled` 设置控制：
- 增加行：绿色
- 删除行：红色
- 上下文行：默认色

### 11.4 catui 对标点

| 特性 | CC | catui | 差距 |
|------|-----|-----------|------|
| 字符级 diff | ✅ | ❌ | **catui 缺失** |
| 词级 diff | ✅ Intl segmenter | ✅ Diff.diffWords（逆视频高亮） | 等价 |
| 行级 diff | ✅ | ✅ renderDiff | 等价 |
| 数组 diff | ✅ | ❌ | **catui 缺失** |
| Unified 格式 | ✅ git apply 兼容 | ✅ | 等价 |
| 语法高亮 | ✅ | ✅ | 等价 |

---

## 十二、Vim 模式

### 12.1 editorMode 设置

```typescript
// 检测 vim 模式
function Ot() { return w8().editorMode === "vim"; }

// 设置值
type EditorMode = "normal" | "vim" | "emacs";
```

### 12.2 INSERT / NORMAL 子模式

Vim 模式有两个子模式：
- **INSERT**：正常文本输入
- **NORMAL**：vim 风格导航键

状态在会话信息中报告：`{ vim: { mode: "INSERT" | "NORMAL" } }`

### 12.3 状态栏模式指示器

Footer 显示当前 vim 模式：
```typescript
vimMode: Ot() ? currentMode : undefined
```

### 12.4 Vim 特有的 UI 行为

- INSERT 模式下隐藏取消按钮
- INSERT 模式下显示粘贴指示器
- 使用专用输入组件 `Iw7`（vim）vs `IK`（normal）

### 12.5 catui 对标点

| 特性 | CC | catui | 差距 |
|------|-----|-----------|------|
| Vim 模式 | ✅ | ❌ | **catui 缺失** |
| 模式指示器 | ✅ footer | N/A | 缺失 |
| 切换命令 | /vim | N/A | 缺失 |

---

## 十三、主题与样式系统

### 13.1 语义化颜色 Token

CC 定义了语义化颜色 token：

```typescript
const SEMANTIC_COLORS = [
  "success", "error", "warning", "permission",
  "inactive", "suggestion", "chromeYellow"
];
```

### 13.2 三种主题

- **dark** — 暗色主题（默认）
- **light** — 亮色主题
- **ansi** — 纯 ANSI 色（兼容性最好）

### 13.3 主题感知组件

CC 的 Text 和 Box 组件是主题感知的：

```typescript
// 主题感知 Text
HN_ / T  // 根据当前主题选择颜色

// 主题感知 Box
jN_ / u  // 主题派生的边框/背景色
```

### 13.4 catui 对标点

| 特性 | CC | catui | 差距 |
|------|-----|-----------|------|
| 语义颜色 | 7 个 | 58 个（ThemeColor） | **catui 更丰富** |
| 主题数量 | 3 种 | 3 种（warm/dark/light） | 等价 |
| 主题变量 | ❌ | ✅ 变量引用 | **catui 更好** |
| 256 色回退 | ❌ | ✅ | **catui 更好** |
| 主题验证 | ❌ | ✅ TypeBox schema | **catui 更好** |

**结论**：catui 的主题系统比 CC 更完善，这是优势。

---

## 十四、终端集成

### 14.1 颜色支持检测

CC 的颜色检测层级：

```
FORCE_COLOR 环境变量 (0-3)
  ↓
color=16m/full/truecolor → Level 3 (1600 万色)
  ↓
color=256 → Level 2 (256 色)
  ↓
CI 环境 → Level 1
  ↓
TERM_PROGRAM 检测（iTerm2 v3+ → L3, Apple Terminal → L2）
  ↓
TERM 模式匹配 → Level 1
  ↓
COLORTERM 存在 → Level 1
```

输出格式：`{ level: number, hasBasic: boolean, has256: boolean, has16m: boolean }`

### 14.2 图片协议

CC 支持的终端图片协议：

| 终端 | 协议 |
|------|------|
| iTerm2 | OSC 9/1337 内联图片 |
| Kitty | Kitty graphics protocol |
| WezTerm | 兼容 Kitty |
| Ghostty | 兼容 Kitty（v1.2.0+） |
| tmux | 透传 |
| Windows Terminal | 兼容 |
| VS Code | 兼容 |

### 14.3 剪贴板

**OSC52 协议**：
```typescript
// 通用剪贴板写入
sP(CLIPBOARD, "c", base64data)
```

**平台特定命令**：
- macOS: `pbcopy` / `pbpaste`
- Linux X11: `xclip -selection clipboard`
- Linux Wayland: `wl-copy` / `wl-paste`
- Windows: `clip`

**Tmux 穿透**：
```typescript
// tmux 中包装 OSC52
`ESC Ptmux; ${escapeSequence} ESC \`
```

**图片剪贴板**：
- macOS: `osascript -e 'the clipboard as <<class PNGf>>'`
- Linux: `xclip -selection clipboard -t image/png -o`

### 14.4 终端模式设置

CC 在 raw mode 启用时设置：

```typescript
// 启用
CSI ? 25 h    // 显示光标
CSI ? 1049 h  // 备用屏幕
CSI ? 1006 h  // SGR 鼠标追踪
CSI ? 2004 h  // 括号粘贴

// 禁用（恢复）
CSI ? 25 l
CSI ? 1049 l
CSI ? 1006 l
CSI ? 2004 l
```

### 14.5 超链接支持

CC 检测终端是否支持可点击超链接：
- 检查 `no-hyperlink`、`hyperlink=false` 标志
- 检查终端特定支持（iTerm2 v3+, kitty 等）
- Windows、CI 环境下禁用

### 14.6 catui 对标点

| 特性 | CC | catui | 差距 |
|------|-----|-----------|------|
| 颜色检测 | 多层级 | truecolor/256color | 等价 |
| 图片协议 | 5+ 终端 | Kitty + iTerm2 | 等价 |
| OSC52 剪贴板 | ✅ | ❌ | **catui 缺失** |
| 平台剪贴板 | ✅ | ✅ | 等价 |
| Tmux 穿透 | ✅ | ❌ | **catui 缺失** |
| 鼠标追踪 | ✅ SGR | ✅ Kitty | 等价 |
| 超链接 | ✅ | ❌ | **catui 缺失** |

---

## 十五、错误展示

### 15.1 工具错误

工具执行错误**内联在消息流中**渲染：

```typescript
// FYK 函数渲染工具错误
FYK(toolUseError)
// 使用 D2 组件显示 renderToolUseErrorMessage() 输出
```

### 15.2 配置错误对话框

```typescript
showInvalidConfigDialog({ error })
// 渲染 N1 对话框：
// - 标题："Configuration Error"
// - 颜色："error"
// - 文件路径（粗体）
// - 错误描述
// - 两个选项："Exit and fix manually" / "Reset with default configuration"
```

### 15.3 Rate Limit 错误

通过 `rate_limits` 字段在状态输出中显示：
- 5 小时窗口使用率
- 7 天窗口使用率
- 重置时间

### 15.4 网络错误处理

- `handleOAuth401Error` — OAuth 认证过期
- 连接重试逻辑
- 降级到手动模式

### 15.5 catui 对标点

| 特性 | CC | catui | 差距 |
|------|-----|-----------|------|
| 工具错误 | ✅ 内联 | ✅ 内联 | 等价 |
| 配置错误对话框 | ✅ | ❌ | **catui 缺失** |
| Rate limit 显示 | ✅ | ❌ | **catui 缺失** |
| 网络错误 | ✅ 重试 + 降级 | 类似 | 等价 |

---

## 十六、会话管理 UI

### 16.1 /clear 行为

CC 的 `/clear` 命令：
- 清空对话历史
- 重置消息列表
- **不清除会话持久化**（对话可恢复）
- 视觉上：消息从显示中移除，输入框返回初始状态

### 16.2 自动压缩

CC 支持自动对话压缩：

```typescript
autoCompactEnabled: true,     // 默认启用
autoCompactWindow: "...",     // 压缩窗口
```

压缩产生结构化摘要：
1. Task Overview
2. Current State
3. Important Discoveries
4. Next Steps

### 16.3 消息分组

消息按以下维度分组：
- Agent/Team 上下文（每个 agent 颜色编码）
- 工具调用和结果
- 系统消息 vs 用户/助手消息

### 16.4 导出功能

CC 的 `/export` 命令使用 `zl8()` 函数将消息渲染为纯文本，支持：
- 文件导出
- 剪贴板导出

### 16.5 catui 对标点

| 特性 | CC | catui | 差距 |
|------|-----|-----------|------|
| /clear | ✅ | ✅ | 等价 |
| 自动压缩 | ✅ | ✅ /compact | 等价 |
| 消息分组 | ✅ 颜色编码 | 类似 | 等价 |
| 导出 | ✅ /export | ✅ /export | 等价 |
| 会话树 | ❌ | ✅ /tree /fork | **catui 更好** |

---

## 十七、自动后台化 UI

### 17.1 同步→异步转换的 UI 反馈

当子 agent 超过 2 分钟自动转为后台时：

```
[Agent] Research API patterns... (running in background)
  Output: .claude/tasks/abc123.output
```

### 17.2 Agent 进度面板

CC 的 agent 进度显示：
- 最近 3 个 tool use（非 verbose 模式）
- "Initializing..."（无进度时）
- verbose 模式下显示全部

### 17.3 后台任务完成通知

后台任务完成时通过通知系统提醒：
```typescript
Tt1(taskId, {
  title: "Agent completed",
  status: "completed",
  summary: "Found 3 API patterns"
});
```

### 17.4 catui 对标点

| 特性 | CC | catui | 差距 |
|------|-----|-----------|------|
| 自动后台化 | ✅ 2 分钟 | ❌ | **catui 缺失** |
| 后台进度 | ✅ 文件输出 | ✅ .md 文件 | 等价 |
| 完成通知 | ✅ | ✅ | 等价 |
| 进度面板 | ✅ | 类似 | 等价 |

---

## 十八、复刻优先级清单

### P0（必须复刻）

| 特性 | 理由 | 预估工作量 |
|------|------|-----------|
| **权限审批对话框** | 安全基础，CC 核心交互 | 大 |
| **只读命令自动审批** | 减少审批摩擦 | 中 |
| **权限模式（default/acceptEdits）** | 审批的前提 | 中 |

### P1（应该复刻）

| 特性 | 理由 | 预估工作量 | 状态 |
|------|------|-----------|------|
| **Spinner tips/verbs 可配置** | 低成本高回报 | 小 | ✅ 已完成 |
| **通知优先级队列** | 改善信息层次 | 中 | ✅ 已完成 |
| **Rate limit 显示** | 用户需要知道用量 | 小 | ❌ 未做 |
| **自定义 statusline** | 高级用户需求 | 小 | ❌ 未做 |
| **虚拟滚动** | 长对话性能 | 大 | ✅ 已完成 |
| **配置错误对话框** | 改善错误体验 | 小 | ❌ 未做 |

### P2（可以复刻）

| 特性 | 理由 | 预估工作量 |
|------|------|-----------|
| **Vim 模式** | 特定用户群需求 | 大 |
| **Auto mode 分类器** | 需要 ML 模型 | 大 |
| **词级 diff** | 改善 diff 可读性 | 中 |
| **OSC52 剪贴板** | 远程终端需求 | 小 |
| **超链接支持** | 改善可点击性 | 小 |
| **桌面通知** | 后台任务提醒 | 中 |

---

## 十九、差异对比总结表

| 维度 | CC | catui | 谁更好 |
|------|-----|-----------|--------|
| **TUI 框架** | Ink/React + Yoga | 自研 Component 树 | 各有优劣 |
| **输入处理** | 自定义 VT 解析器 | StdinBuffer + Kitty 协议 | catui |
| **快捷键体系** | 18 个上下文 | Controller 级隔离 | CC 更细粒度 |
| **Slash 命令** | 30+ / 3 种类型 | 30+ / 2 种类型 | CC（有 local-jsx） |
| **权限审批** | ✅ 完整 UI | ❌ 无 | **CC 大幅领先** |
| **消息渲染** | 6 种渲染器 | 类似 | 等价 |
| **Markdown** | 终端原生 | marked + highlight | 等价 |
| **Spinner** | 可配置 tips/verbs | Stall 检测 + tips 轮换 | 各有优劣 |
| **状态栏** | model/token/cost | model/token/cost/context/branch | catui |
| **通知** | 4 级优先级 + 多渠道 | 4 级优先级队列 + 自动消失 | 等价（缺多渠道） |
| **Diff 引擎** | 4 级（字符/词/行/数组） | 行级 + 词级 | CC |
| **Vim 模式** | ✅ | ❌ | CC |
| **主题系统** | 7 色 token / 3 主题 | 58 色 token / 3 主题 | **catui** |
| **终端集成** | OSC52 + 多终端 | Kitty + iTerm2 | CC |
| **会话管理** | /clear /compact | /clear /compact /tree /fork | catui |
| **虚拟滚动** | ✅ renderRange | ✅ CachedContainer | 等价 |

---

## 二十、关键源码位置

| 组件 | CC 源码位置（cli.js 函数名） |
|------|-------------------------------|
| 键解析器 | `G64()` — 字节级状态机 |
| 修饰键检测 | `P64()` — 位掩码解析 |
| 鼠标事件 | `D64()` — SGR/X10 解析 |
| 键码映射 | `W64()` — code → name |
| React 键绑定 | `J1()` — action 注册 |
| 键绑定上下文 | `ph8` — KeyBindingsProvider |
| 默认键绑定 | `ky6()` — 默认定义数组 |
| 动作列表 | `MU1()` — 可用 actions |
| 不可重绑定键 | `Ot6()`, `jU1()`, `HU1()` |
| 权限检查入口 | `OP()` — 主权限检查 |
| 权限评估 | `yJY()` — 完整评估 |
| 工具权限 | `m0K()` — 轻量检查 |
| 只读检测 | `QL8()` — bash 命令安全检查 |
| Auto 分类器 | `TS8()` — ML 模型调用 |
| Spinner | `CK` — 动画组件 |
| Agent 进度 | `Fm8()` — 进度渲染 |
| Transcript | `PM6()` — 消息列表 |
| 用户消息渲染 | `Z9K()` |
| 助手消息渲染 | `I9K()` |
| 思考渲染 | `Su8()` |
| Bash 渲染 | `PH6()`, `g9K()` |
| 工具错误渲染 | `FYK()` |
| 配置错误对话框 | `showInvalidConfigDialog()` |
| Diff 基类 | `Zo` — Myers 算法 |
| 词级 diff | `aM4` — Intl segmenter |
| 行级 diff | `sM4` |
| Unified diff | `oV6()` — patch 生成 |
| 通知系统 | `PK` — useNotifications hook |
| 状态输出 | lines ~1170-1198 |
| 命令注册 | `Ow()` |
| 命令列表 | `dUK()`, `cUK()` |
| 颜色检测 | supports-color 模块 |
| 剪贴板 | `mk_()` — 平台命令 |
| OSC52 | `sP()` — 终端转义 |
| Tmux 穿透 | `Ik_()` |
| 终端模式 | raw mode enable/disable |
| Footer | `beK()` |
| 导出 | `zl8()` |

---

## 二十一、剩余差距总览（2026-06 更新）

经过近期改进（spinner tips、状态自动消失、通知优先级队列、虚拟滚动、slash 命令高亮、word-level diff），catui 与 CC 的 TUI 差距已大幅缩小。

### 仍缺失（按优先级）

| 优先级 | 特性 | 说明 | 工作量 |
|--------|------|------|--------|
| **P0** | 权限审批对话框 | CC 核心交互，catui 完全没有 | 大 |
| **P0** | 只读命令自动审批 | cat/ls/grep 等自动通过 | 中 |
| **P0** | 权限模式 | default/acceptEdits/auto | 中 |
| P1 | Rate limit 显示 | footer 加 5h/7d 用量 | 小 |
| P1 | 自定义 statusline | shell 脚本注入 | 小 |
| P1 | 配置错误对话框 | 配置损坏时交互式修复 | 小 |
| P2 | Vim 模式 | INSERT/NORMAL 子模式 | 大 |
| P2 | OSC52 剪贴板 | 远程终端支持 | 小 |
| P2 | 桌面通知 | iTerm2/Kitty OSC 集成 | 中 |
| P2 | @ 文件引用 | 输入框中 @path 引用文件 | 中 |

### 已追平或领先

| 特性 | 状态 | 说明 |
|------|------|------|
| 输入系统 | **catui 领先** | Kitty 协议 > CC 的 VT 解析 |
| 主题系统 | **catui 领先** | 58 色 token > CC 的 7 色 |
| 状态栏 | **catui 领先** | git 分支 + session 名 + 进度条 |
| 会话管理 | **catui 领先** | /tree /fork > CC |
| Spinner | 已追平 | stall 检测 + tips 轮换 |
| 通知系统 | 已追平 | 4 级优先级 + 自动消失 + key 去重 |
| 虚拟滚动 | 已追平 | CachedContainer 渲染缓存 + 视口裁剪 |
| Slash 命令高亮 | 已追平 | 输入框内 /command 高亮 |
| Diff 引擎 | 已追平 | 行级 + 词级 diff |
| Slash 命令 Tab 补全 | **catui 领先** | 含参数级补全 |
