# caturn 流式输出 + 中断机制

> 学习笔记:agent loop 核心设计
> 写入时间: 2026-08-12
> 本目录: `learning/phase-1-while-loop/`
> 核心代码: `src/agent.ts`

---

## 0. 一句话总结

**流式输出 = 攒 chunk;中断 = 信号检查 + 主动 abort + 保留已收内容 + 区分错误类型。**

---

## 1. 流式输出:为什么不是一行搞定

### 1.1 痛点

OpenAI API 返回的不是完整响应,是**一连串 chunk**。每个 chunk 里:

```typescript
{
  choices: [{
    delta: {
      content: "你",        // 文本片段
      tool_calls: [{        // 工具调用片段
        index: 0,
        id: "call_abc",     // 第一次才有
        function: {
          name: "read",     // 碎片化,可能分多次到
          arguments: "{\"p" // 更碎片化,可能跨多个 chunk
        }
      }]
    },
    finish_reason: null     // 最后一 chunk 才有 "stop" 或 "tool_calls"
  }]
}
```

**模型看到的 content 是一个完整字符串,但 API 返回的是 N 个碎片**。你必须自己拼。

### 1.2 拼装逻辑

**位置**: `src/agent.ts:54-110`

#### 1.2.1 文本 content:简单拼接

```typescript
// src/agent.ts:70-73
if (delta.content) {
  msg.content += delta.content;
  onChunk(delta.content);  // 通知 TUI 实时显示
}
```

`onChunk` 是传给 agentLoop 的回调(caturn.tsx:72 里实现为 `setStreamedContent(prev + chunk)`),实现打字机效果。

#### 1.2.2 tool_calls:按 index 攒

**为什么需要按 index?**

LLM 可能**一次返回多个 tool call**(并行调用),每个 tool call 的参数是碎片化的。比如 "read" 工具的参数 `{"path": "src/agent.ts"}` 可能这样来:

```
chunk 1: tool_calls[0] = { id: "call_1", function: { name: "read", arguments: '{"' } }
chunk 2: tool_calls[0] = { function: { arguments: 'path' } }
chunk 3: tool_calls[0] = { function: { arguments: '":"src/agent.ts"}' } }
```

每个 chunk 只给一小段,**必须按 index 拼**。

`src/agent.ts:74-86`:

```typescript
const toolCallChunks: Record<number, any> = {};  // 按 index 索引

for (const tc of delta.tool_calls) {
  const idx = tc.index;
  if (!toolCallChunks[idx]) {
    // 第一次见到这个 tool call,初始化
    toolCallChunks[idx] = { id: tc.id || '', type: 'function', function: { name: '', arguments: '' } };
  }
  if (tc.id) toolCallChunks[idx].id = tc.id;
  if (tc.function?.name) toolCallChunks[idx].function.name += tc.function.name;
  if (tc.function?.arguments) toolCallChunks[idx].function.arguments += tc.function.arguments;
}

msg.tool_calls = Object.values(toolCallChunks);  // 转回数组
```

**关键点**:
- 用 `Record<number, ...>` 而非数组(避免稀疏数组导致的 `forEach` 跳过)
- `id` 只在第一次 chunk 出现,后续 chunk 不更新
- `name` 和 `arguments` 都是**字符串拼接**,不会重置

#### 1.2.3 finishReason:记录最后一个

```typescript
// src/agent.ts:87
if (chunk.choices[0]?.finish_reason) finishReason = chunk.choices[0].finish_reason;
```

最后一 chunk 的 `finish_reason` 是 `"stop"`(回答完了)或 `"tool_calls"`(要调工具)或 `"length"`(截断了)。循环结束后用这个判断下一步。

### 1.3 拼接完成后的判断

`src/agent.ts:96-110`:

```typescript
messages.push(msg);  // 把完整 assistant 消息塞进历史

if (finishReason === 'tool_calls' && msg.tool_calls.length > 0) {
  // 工具调用,执行后继续循环
  for (const call of msg.tool_calls) {
    if (signal.aborted) throw new AbortError();
    const args = JSON.parse(call.function.arguments);
    onToolCall({ name: call.function.name, args });
    const result = await executeTool(call.function.name, args);
    messages.push({ role: 'tool', tool_call_id: call.id, content: formatReport(result) });
  }
  continue;  // 回到 while(true) 顶部
}

return msg.content;  // 普通回答,退出循环
```

---

## 2. 中断机制:三层防御

### 2.1 痛点

用户按 Esc,你要:
1. 立即停止 stream(不再显示新内容)
2. 关闭 HTTP 连接(节省 token + 网络资源)
3. 保留已流式接收的内容(用户已经看到的不消失)
4. 让 TUI 知道"这是中断,不是错误"
5. 让下一轮对话能继续(消息历史要完整)

### 2.2 三层防御设计

#### 第一层:信号检查(每个 chunk 开头)

`src/agent.ts:62-67`:

```typescript
for await (const chunk of stream) {
  if (signal.aborted) {
    abortedDuringStream = true;
    stream.controller?.abort();  // 关底层 HTTP 连接
    break;
  }
  // ... 处理 chunk
}
```

**为什么每个 chunk 都检查?**

不是每个 chunk 都会来——如果模型正在生成(服务器端),chunk 间隔可能 100ms。如果只检查一次,按 Esc 后还要等下次生成才有反应。**用户体验差**。

#### 第二层:主动 abort 底层 stream

```typescript
stream.controller?.abort();
```

OpenAI SDK 的 stream 对象内部有个 `controller`,调用它的 `abort()` 直接关底层 HTTP 连接。

**为什么需要?**

如果不调,for-await 循环会一直 await 下一个 chunk,虽然 `signal.aborted` 已经是 true,但**底层连接还在**,服务器还在生成,token 还在烧。

**API 不稳定**: `stream.controller` 是 OpenAI SDK 的内部字段,不一定每个版本都有。用 `?.` 兜底。

#### 第三层:保留已收内容到历史

`src/agent.ts:90-94`:

```typescript
if (abortedDuringStream) {
  if (msg.content) messages.push(msg);  // 保留
  throw new AbortError();
}
```

**为什么这么关键?**

如果不 push 进 messages,下一轮对话时:
- 用户看到"我问了啥,模型回了一半"
- 但 messages 数组里**没有那个半截回答**
- 模型以为它没回过,从头继续 → 上下文断裂

push 进去后,内容虽然被截断,但**对话历史完整**。

### 2.3 区分中断 vs 错误

`src/agent.ts:21-27`:

```typescript
export class AbortError extends Error {
  constructor() {
    super('aborted');
    this.name = 'AbortError';
  }
}
```

自定义 error class 让 TUI 能 catch:

`caturn.tsx:96-105`:

```typescript
} catch (err: any) {
  if (err.name === 'AbortError') {
    setStreamedContent((cur) => {
      if (cur) {
        setMessages((prev) => [...prev, { role: 'assistant', content: cur + ' [⏹ 已中断]' }]);
      } else {
        setMessages((prev) => [...prev, { role: 'assistant', content: '⏹ 已中断' }]);
      }
      return '';
    });
  } else {
    setMessages((prev) => [...prev, { role: 'assistant', content: `❌ ${err.message}` }]);
  }
}
```

**两种情况 UI 表现不同**:
- `AbortError`: 显示 "⏹ 已中断"(可能是用户主动行为)
- 其他 error: 显示 "❌ error message"(真的出问题了)

### 2.4 工具执行阶段的中断

`src/agent.ts:100-101`:

```typescript
for (const call of msg.tool_calls) {
  if (signal.aborted) throw new AbortError();
  // ...
}
```

**为什么工具执行也要检查?**

工具可能是慢操作(`bash` 跑命令,`read` 读大文件)。如果用户按 Esc 后,工具还在跑,体验差。

### 2.5 完整中断时序

```
用户按 Esc
  ↓
caturn.tsx:43  abortControllerRef.current.abort()
  ↓
signal.aborted = true
  ↓
[如果正在 stream]
  for-await 循环的下一轮检查到 signal.aborted
  ↓
  stream.controller.abort() → 关 HTTP 连接
  ↓
  abortedDuringStream = true, break
  ↓
  msg.content push 进 messages(保留已收内容)
  ↓
  throw new AbortError()
  ↓
caturn.tsx:96 catch
  ↓
  setMessages([...prev, '⏹ 已中断'])
  ↓
  setBusy(false) ← finally 块
  ↓
TUI 回到空闲状态
```

---

## 3. 关键决策记录

### 3.1 为什么用 AbortController 而不是 cancelToken

AbortController 是 Web API 标准,Node 16+ 原生支持。

旧式 axios 的 `CancelToken` 是过时的。**不要再用**。

### 3.2 为什么 onChunk / onToolCall 是回调,不是 Promise

异步流式输出的**多个事件**(N 个 chunk)在时间上分散,无固定结束点。回调模式天然适配:

```typescript
onChunk(chunk: string) => void     // 调用 N 次
onToolCall(call: { name, args }) => void  // 调用 0..M 次
```

如果用 Promise<Event[]>,得在 stream 结束后批量 emit,丢掉实时性。

### 3.3 为什么不直接 await 完整响应

```typescript
// ❌ 这个写法失去流式
const response = await client.chat.completions.create({ ...messages, stream: false });
console.log(response.choices[0].message.content);
```

**问题**:
- 用户看到的是"等待 N 秒 → 一次性打印",不是打字机
- 超长响应用户不知道还活不活着
- 中断的时候没法做到"保留已收内容"(压根没收到)

**流式是必须的**。

### 3.4 为什么 `stream.controller?.abort()` 用可选链

OpenAI SDK 的 stream 对象文档里没明确说 `controller` 是 public API。**SDK 升级可能改名/删除**。

用 `?.` 兜底,即使 SDK 改了,代码不崩(只是不主动关 HTTP,等服务器自己断)。

### 3.5 中断时为什么不重置 msg

```typescript
// ❌ 错误写法
if (abortedDuringStream) {
  msg = { role: 'assistant', content: '' };  // 清空
  throw new AbortError();
}
```

这样 messages 里就有一条空消息,下一轮对话会有奇怪上下文。

**正确**: 保留 `msg.content` push 进去,模型下一轮能看到"我刚才回了一半"。

---

## 4. 跟 catui 的对比

| 维度 | caturn (src/agent.ts) | catui (core/runtime/agent-session.ts) |
|------|------------------------|--------------------------------------|
| 抽象 | while loop + 回调 | AgentSession + 事件 emitter |
| 中断 | AbortController + AbortError | 子 Agent 用 AbortController,主流程有完整的 stop/cancel 协议 |
| 流式 | 直接 for-await chunk | 同样 for-await,加上 thinking 块的分离 |
| 错误处理 | 单一 AbortError + 普通错误 | 多级区分:用户中断 / 工具错误 / API 错误 / 超时 |
| 持久化 | 无 | `.catui/session/*.jsonl` |
| 工具调度 | 直接 if-else in tool_calls | extensions / MCP 动态注册 |

**caturn 是简化版**。catui 是工业版——但核心机制(流式 + 中断 + 错误分层)是一样的。

---

## 5. 测试覆盖

`test/unit/agent.tsx` 当前测试点。**强烈建议加的测试**:

| 测试 | 验证 |
|------|------|
| 流式文本拼接 | 多个 chunk 的 content 顺序拼成完整字符串 |
| 多 tool call 拼装 | index=0 和 index=1 的 tool_calls 不串 |
| 中断时保留 content | stream 中断后 messages 里有部分内容 |
| 中断时清空 tool_calls | 如果 tool_calls 没拼完,不要 push 进 messages |
| 工具执行中中断 | 第二个 tool call 执行前 abort,只执行第一个 |
| finishReason=stop | 普通回答,正常 return |
| finishReason=tool_calls | 调工具后继续循环 |
| finishReason=length | 截断处理(当前代码没处理,P2 缺陷) |

---

## 6. 已知缺陷

`src/agent.ts:110` —— **finishReason=length 未处理**:

```typescript
if (finishReason === 'tool_calls' && msg.tool_calls.length > 0) {
  // ...
}
return msg.content;  // length 也走这里,直接返回截断的内容
```

如果模型到 `max_tokens` 限制被截断,finishReason 是 `"length"`,当前代码会**假装这是完整回答**返回。

**修法**: 加一个分支,返回时附上警告:"[回答被截断,可能不完整]"。

---

## 7. 参考文件

| 主题 | 路径 |
|------|------|
| agent loop 核心 | `learning/phase-1-while-loop/src/agent.ts` |
| AbortError 定义 | `src/agent.ts:21-27` |
| 流式 chunk 处理 | `src/agent.ts:54-110` |
| 三层中断防御 | `src/agent.ts:62-67` `src/agent.ts:90-94` `src/agent.ts:100-101` |
| TUI 端 catch | `learning/phase-1-while-loop/caturn.tsx:96-105` |
| TUI 端触发 abort | `caturn.tsx:43-44` |
| catui 对照 | `core/runtime/agent-session.ts` |
| catui 流式处理 | `core/lib/ai/...`(具体路径运行时确认) |

---

## 8. 三句话回顾

1. **流式 = 攒 chunk**:`msg.content` 字符串拼接,`tool_calls` 按 index 攒对象
2. **中断 = 三层防御**:信号检查 + 主动 abort 底层 + 保留已收内容
3. **错误 = 区分类型**:AbortError 是用户行为,其他是真错误,UI 表现不同
