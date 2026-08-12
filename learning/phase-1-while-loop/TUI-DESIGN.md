# caturn TUI 层设计

> 学习笔记:ink + React 状态机 + 流式渲染
> 写入时间: 2026-08-12
> 本目录: `learning/phase-1-while-loop/`
> 核心代码: `caturn.tsx`

---

## 0. 一句话总结

**TUI = React 状态机 + 引用同步 + 流式分离渲染 + 键盘事件路由。**

设计三个核心问题:怎么同步 state 给异步回调 / 怎么实现打字机 / 怎么区分中断和错误。

---

## 1. 状态机全景

### 1.1 6 个状态

`caturn.tsx:38-44`:

```typescript
const [messages, setMessages] = useState<ChatMessage[]>([]);         // 已完成消息历史
const [input, setInput] = useState('');                                // 输入框当前内容
const [busy, setBusy] = useState(false);                               // 是否正在生成
const [streamedContent, setStreamedContent] = useState('');            // 实时流式内容(临时)
const messagesRef = useRef<ChatMessage[]>([]);                          // 同步 messages 给异步回调
const abortControllerRef = useRef<AbortController | null>(null);        // 当前请求的中断器
```

### 1.2 状态职责

| 状态 | 类型 | 职责 |
|------|------|------|
| `messages` | `ChatMessage[]` | 已完成的 user / assistant / tool 消息 |
| `input` | `string` | 当前输入框内容 |
| `busy` | `boolean` | 是否正在生成(显示"思考中") |
| `streamedContent` | `string` | 正在流式接收的内容(完成时 push 进 messages) |
| `messagesRef` | `ChatMessage[]` | `messages` 的同步副本,异步回调用 |
| `abortControllerRef` | `AbortController \| null` | 当前请求的中断器 |

### 1.3 状态机图

```
[空闲]
  messages: []
  busy: false
  streamedContent: ''
  ↓ 用户输入并回车
[生成中]
  messages: [user, ...历史]
  busy: true
  streamedContent: '' → 逐字累加
  ↓ 模型输出完成 OR Esc 中断
[回流]
  streamedContent: → push 进 messages
  ↓
[空闲]
  messages: [user, assistant, ...]
  busy: false
  streamedContent: ''
```

**关键**: `streamedContent` 是临时状态,完成时**复制到 messages 然后清空**。不直接在 messages 上累加——打字机效果会让 React 频繁 re-render 整个列表。

---

## 2. 核心问题 1:为什么需要 messagesRef

### 2.1 问题

```typescript
const submit = async () => {
  // ... 这里用 messages 提交给 API
  const apiMessages = [...messagesRef.current.map(...), { role: 'user', content: text }];
  await agentLoop(apiMessages, ...);
};
```

`submit` 是 async 函数,可能在几秒后才执行提交。

**如果在 `submit` 执行前 messages 变了**(比如另一个回调),闭包里的 `messages` 是旧值。

### 2.2 解决方案

`caturn.tsx:46`:

```typescript
useEffect(() => { messagesRef.current = messages; }, [messages]);
```

**每次 messages 变,同步给 ref**。

async 函数里读 `messagesRef.current` 永远拿到最新值。

### 2.3 为什么不用 useRef 直接保存

```typescript
// ❌ 这样会丢更新
const messagesRef = useRef<ChatMessage[]>([]);
const addMessage = (msg) => {
  messagesRef.current = [...messagesRef.current, msg];  // 只更 ref,不更 state
};
```

**问题**: React 不会 re-render,UI 看不到新消息。

**正确做法**: `setMessages` + `useEffect` 同步 ref。React 看到 state 变 → re-render,ref 同步。

### 2.4 为什么不用 useCallback + 依赖 messages

```typescript
const submit = useCallback(async () => {
  const apiMessages = [...messages, ...];  // 用 messages
}, [messages]);  // 依赖 messages
```

**问题**: `messages` 变 → `submit` 重新生成 → 传给 `agentLoop` 的回调闭包也变了。

**好处**: 不用 ref,逻辑直接。

**坏处**: 每次 messages 变,函数重新创建。useEffect 依赖含 `submit` 的也会跟着重渲。

**Phase 1 阶段 ref 简单粗暴**,useCallback 是优化手段。

---

## 3. 核心问题 2:打字机效果

### 3.1 三种渲染策略对比

#### 策略 A:直接更新 messages(❌)

```typescript
const submit = async () => {
  const controller = new AbortController();
  await agentLoop(
    apiMessages,
    (chunk) => {
      setMessages(prev => [...prev, { role: 'assistant', content: ... }]);  // ❌
    },
    ...
  );
};
```

**问题**: 每次 chunk 来都重建整个 messages 数组,React 重新渲染所有消息。100 chunk = 100 次 re-render。

#### 策略 B:增量追加到最后一个消息(⚠️)

```typescript
(chunk) => {
  setMessages(prev => {
    const last = prev[prev.length - 1];
    if (last?.role === 'assistant' && last.streaming) {
      return [...prev.slice(0, -1), { ...last, content: last.content + chunk }];
    }
    return [...prev, { role: 'assistant', content: chunk, streaming: true }];
  });
}
```

**问题**: 仍然每次重建数组,只是少了一次 push。

#### 策略 C:分离 streamedContent(✅)

```typescript
// caturn.tsx:88-92
await agentLoop(
  apiMessages,
  (chunk) => setStreamedContent(prev => prev + chunk),  // 只更流式
  ...
);
```

**好处**:
- `streamedContent` 是字符串,React 用 `===` 比较快
- 完成时只 push 一次进 messages
- 打字机效果只 re-render `streamedContent` 部分,不 re-render 历史

### 3.2 渲染逻辑

`caturn.tsx:120-130`:

```typescript
{messages.map((msg, i) => (
  // 已经完成的消息
  <Box key={i}>...</Box>
))}

{streamedContent && (
  // 正在流式的内容
  <Box>
    <Text color="cyan">caturn ➜</Text>
    <Text>{streamedContent}</Text>
  </Box>
)}

{busy && !streamedContent && (
  // 还没收到第一个 chunk
  <Text color="yellow">💭 思考中...（按 Esc 中断）</Text>
)}
```

**三种分支**:
1. `messages` —— 已完成
2. `streamedContent` —— 正在打字
3. `busy && !streamedContent` —— 还没收到第一个 chunk

### 3.3 完成时的回流

`caturn.tsx:93-100`:

```typescript
await agentLoop(...);

setStreamedContent((cur) => {
  if (cur) setMessages((prev) => [...prev, { role: 'assistant', content: cur }]);
  return '';
});
```

**关键**: `setStreamedContent` 的 updater 函数——React 在 commit 阶段才执行 updater,这时候 `cur` 是最新的 `streamedContent`。

为什么不直接读外面闭包的 `streamedContent`?

```typescript
// ❌ 闭包陷阱
const finalContent = streamedContent;
setStreamedContent('');
// ... 中间可能有别的事件触发 re-render
setMessages((prev) => [...prev, { role: 'assistant', content: finalContent }]);  // 可能是空
```

用 updater 函数保证读到的是最新的 state。

---

## 4. 核心问题 3:三消息类型渲染

### 4.1 ChatMessage 类型

`caturn.tsx:34-38`:

```typescript
type ChatMessage = {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
  toolArgs?: any;
};
```

### 4.2 三种渲染

`caturn.tsx:120-153`:

```typescript
{messages.map((msg, i) => (
  <Box key={i} flexDirection="column" marginBottom={1}>
    {msg.role === 'user' && (
      <Box>
        <Text color="green">你 ➜ </Text>
        <Text>{msg.content}</Text>
      </Box>
    )}
    {msg.role === 'assistant' && (
      <Box flexDirection="column">
        <Text color="cyan">caturn ➜</Text>
        <Box marginLeft={2}>
          <Text>{msg.content}</Text>
        </Box>
      </Box>
    )}
    {msg.role === 'tool' && (
      <Box>
        <Text color="yellow">🔧 {msg.toolName}</Text>
        <Text dimColor>({JSON.stringify(msg.toolArgs)})</Text>
        {msg.content && (
          <Box marginLeft={2}>
            <Text dimColor>↳ {msg.content.slice(0, 200)}{msg.content.length > 200 ? '...' : ''}</Text>
          </Box>
        )}
      </Box>
    )}
  </Box>
))}
```

**设计点**:
- `user` / `assistant` 内容完整显示
- `tool` 只显示**前 200 字**(防止单个 grep 结果占满屏幕)
- 用 `marginLeft={2}` indent 工具结果,层级清晰
- 颜色区分:user 绿 / assistant 青 / tool 黄

### 4.3 为什么要 truncate tool content

`caturn.tsx:148`:

```typescript
<Text dimColor>↳ {msg.content.slice(0, 200)}{msg.content.length > 200 ? '...' : ''}</Text>
```

**问题**: `grep` 搜出 1000 个匹配,渲染全部会撑爆终端。

**修复**: 截断 + 提示。如果用户想看完整,在消息设计上加 "查看完整" 按钮(未来)。

**Phase 1 简化**: 截断到 200 字。

---

## 5. 核心问题 4:键盘事件路由

### 5.1 三种退出路径

`caturn.tsx:48-58`:

```typescript
useInput((_input, key) => {
  if (key.escape) {
    // Esc: 打断当前流式,保留历史
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  } else if (key.ctrl && _input === 'c') {
    // Ctrl+C: 退出整个程序
    if (abortControllerRef.current) abortControllerRef.current.abort();
    exit();
  }
});
```

### 5.2 三种退出方式

| 触发 | 行为 | 用途 |
|------|------|------|
| `Esc` | abort 当前流式 | "模型跑偏了,我要它停" |
| `Ctrl+C` | abort + exit | "我不玩了,退出" |
| 输入 `quit` / `exit` | exit | "礼貌退出" |

### 5.3 为什么用 ink 的 `useInput`

`ink` 是 React 风格的 TUI 框架:

```typescript
useInput((input, key) => {
  // input: 按键的字符
  // key: { escape, ctrl, shift, ... }
});
```

**比 `process.stdin.on('data')` 简单**:
- 自动处理 terminal raw mode
- key 解析(识别 Esc / Ctrl+C / 方向键)
- 跟 React 渲染生命周期配合

### 5.4 ink 的几大 API

```typescript
import { render, Box, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';

const { exit } = useApp();         // 主动退出
useInput((input, key) => {...});   // 键盘事件
<Box flexDirection="column">       // 容器
  <Text color="cyan">caturn</Text> // 文本
</Box>
```

详细 API 见 `~/.local/nodejs/lib/node_modules/catui-agent/dist/extensions/builtin/catpaw/SKILL.md`(skill 系统会展示)。

---

## 6. 错误处理

### 6.1 三种情况

`caturn.tsx:96-113`:

```typescript
} catch (err: any) {
  if (err.name === 'AbortError') {
    // 1. 用户中断
    setStreamedContent((cur) => {
      if (cur) {
        setMessages((prev) => [...prev, { role: 'assistant', content: cur + ' [⏹ 已中断]' }]);
      } else {
        setMessages((prev) => [...prev, { role: 'assistant', content: '⏹ 已中断' }]);
      }
      return '';
    });
  } else {
    // 2. 真的错误
    setMessages((prev) => [...prev, { role: 'assistant', content: `❌ ${err.message}` }]);
  }
} finally {
  // 3. 清理状态
  abortControllerRef.current = null;
  setBusy(false);
}
```

### 6.2 为什么用 `err.name === 'AbortError'`

`AbortError` 是 `src/agent.ts:21-27` 定义的:

```typescript
export class AbortError extends Error {
  constructor() {
    super('aborted');
    this.name = 'AbortError';
  }
}
```

用 `name` 区分,不用 `instanceof`——跨模块的 `instanceof` 在 ESM 下有时不可靠。

### 6.3 finally 的必要性

```typescript
try {
  await agentLoop(...);
} catch (err) {
  // 处理错误
} finally {
  abortControllerRef.current = null;
  setBusy(false);
}
```

**finally 一定执行**——无论正常完成 / 中断 / 错误。

**漏了 finally 的后果**:
- 用户按 Esc → `busy` 仍是 true → 输入框 placeholder 还是 "等待中..." → 用户没法输入新消息
- bug 报告:"按 Esc 之后程序卡死了"

---

## 7. 已知问题

### 7.1 messages 丢失更新风险

`caturn.tsx:46` 的 `useEffect` 同步 ref 是**异步的**——messages 变 → React re-render → useEffect 跑 → ref 更新。

极端情况: `submit` 在 useEffect 跑之前就执行了,ref 还是旧值。

**修复**: 在 `submit` 开头直接同步:

```typescript
const submit = async () => {
  // ... 开头加一行
  messagesRef.current = messages;  // 强制同步
  // ...
};
```

### 7.2 streamedContent 没截断

如果模型返回 10000 字,streamedContent 全部展示,可能撑爆终端。

**修复**: 截断到 N 行(N=50)的滚动窗口,或者只显示最近 N 个字符。

### 7.3 没有自动滚动

ink 默认不自动滚到底部。用户得手动滚。

**修复**: 用 `ink-scroll` 或自己实现 scroll computation。

### 7.4 Esc 多次按会出错

```typescript
if (key.escape) {
  if (abortControllerRef.current) {
    abortControllerRef.current.abort();
    abortControllerRef.current = null;
  }
}
```

**逻辑**: 第一次按 Esc → abort + 清空 ref。第二次按 Esc → ref 是 null,跳过。

**边界**: 如果 agentLoop 里 onChunk 还在跑(setState 异步),可能状态不一致。

**不会崩,但 UI 可能闪一下**。

### 7.5 工具执行时显示不友好

`caturn.tsx:148-152` 显示工具调用:

```typescript
<Text color="yellow">🔧 {msg.toolName}</Text>
<Text dimColor>({JSON.stringify(msg.toolArgs)})</Text>
```

**问题**: `JSON.stringify(args)` 对长 args 不友好。

**修复**: 用 `console.log` 风格,或者展开多行。

---

## 8. 关键决策记录

### 8.1 为什么用 React 而不是直接拼字符串

```typescript
// ❌ 直接拼字符串
console.log('你 ➜ ' + userInput);
console.log('caturn ➜ ' + response);
console.log('🔧 ' + toolName + ' ...');
```

**问题**:
- 不能修改历史(只能尾部追加)
- 流式更新得重写整段
- 颜色 / 边框得自己处理 ANSI 转义码

**React 优势**:
- 增量渲染(只更变了的)
- 声明式(UI = state)
- 组件化(可复用 bubble / input)

### 8.2 为什么 messages 和 streamedContent 分离

**核心**: 性能。

如果只有 messages,每次 chunk 来都重建数组 → React diff 整个列表 → re-render 所有消息。

分离后:
- `streamedContent` 变更 → React 只 re-render 流式部分
- `messages` 只在完成时变更 → 历史部分不重渲

### 8.3 为什么用 useRef 存 AbortController

```typescript
const abortControllerRef = useRef<AbortController | null>(null);
```

**为什么不用 state**:

```typescript
// ❌ 用 state
const [abortController, setAbortController] = useState<AbortController | null>(null);
```

**问题**: `useInput` 是 setState 之外的事件源,React 不知道要 re-render —— state 变了但 UI 没动。

**ref 永远是最新的,不需要 re-render**。

### 8.4 为什么 tools.ts 是命令式而不是声明式

```typescript
// 当前
const apiMessages = [
  { role: 'system', content: SYSTEM_PROMPT },
  ...messages.map(...),
  { role: 'user', content: text },
];
```

**对比 catui**: AgentSession 封装了 messages 的 push / 系统 prompt 注入。

**caturn 简化**: 手动拼。Phase 1 阶段够用。Phase 2+ 抽出 SessionManager。

### 8.5 为什么 input 是 state 而不是 ref

```typescript
const [input, setInput] = useState('');
```

**需求**: 用户输入时实时显示 → 必须 re-render。

**ref 不会触发 re-render**。所以 input 必须用 state。

---

## 9. 跟 catui 的对比

| 维度 | caturn (caturn.tsx) | catui (modes/interactive/) |
|------|---------------------|----------------------------|
| 框架 | ink + React | ink + React |
| 状态管理 | useState + useRef | useReducer + Context |
| 流式 | 分离 streamedContent | 同 |
| 中断 | AbortController | 同 |
| 消息持久化 | 内存 | .catui/session/*.jsonl |
| 滚动 | 无 | ink-scroll |
| Markdown 渲染 | 无 | chalk + syntax highlight |
| 多 tab | 无 | 有 |
| 主题 | 硬编码颜色 | 配置文件 + 切换 |
| 鼠标事件 | 无 | 有 |

**真实差距**: catui 一个 TUI 模式就 5000+ 行。caturn 175 行。

**差距合理**: catui 5 年 + 多人协作,caturn 1 人 1 周。

---

## 10. 测试覆盖

`test/unit/tui.tsx` 现有测试。**建议加的**:

| 测试 | 验证 |
|------|------|
| 三种消息角色 | user / assistant / tool 渲染不同 |
| streamedContent 渲染 | 流式时不重复显示 |
| busy 状态 | true 时显示 "思考中" |
| 中断完成 | AbortError 后显示 "⏹ 已中断" |
| 错误完成 | 普通 error 后显示 "❌ error" |
| Esc 触发 abort | 模拟键盘事件 |
| Ctrl+C 触发 exit | 模拟组合键 |
| 工具结果 200 字截断 | 1000 字内容只显示 200+... |
| messagesRef 同步 | 模拟快速两次 submit |

---

## 11. 参考文件

| 主题 | 路径 |
|------|------|
| TUI 状态定义 | `learning/phase-1-while-loop/caturn.tsx:34-44` |
| 状态同步 ref | `caturn.tsx:46` |
| 键盘路由 | `caturn.tsx:48-58` |
| submit 流程 | `caturn.tsx:60-118` |
| 错误处理 | `caturn.tsx:96-113` |
| 三种消息渲染 | `caturn.tsx:120-153` |
| 流式渲染 | `caturn.tsx:155-168` |
| 启动 | `caturn.tsx:174-180` |
| TUI 测试 | `test/unit/tui.tsx` |
| catui 对照 | `modes/interactive/` |

---

## 12. 三句话回顾

1. **状态机 = messages + streamedContent + busy + 2 个 ref**:分离流式避免频繁重渲
2. **messagesRef 是异步回调的桥梁**:state 更新异步,ref 同步
3. **三消息角色 + 三退出路径 + finally 清理**:错误处理和不变量是 TUI 健壮性的核心
