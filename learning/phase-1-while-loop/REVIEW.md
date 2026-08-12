# caturn 代码评审

> Phase 1 (while loop + TUI) 阶段性评审
> 评审时间: 2026-08-12
> 评审范围: `learning/phase-1-while-loop/`

---

## 总评

**6 个工具 + while loop agent + ink TUI,600 行不到。Phase 1 阶段该有的样子,做到了。**

清晰、分层、跑得通。不是空壳,有真实的中断、流式、工具调度。代码组织和 catui 顶层一致(P3头注释规范),说明 DIP协议在认真落地。

---

## 好的地方(继续保持)

### 1. 分层是对的

| 文件 | 职责 |
|------|------|
| `caturn.tsx` | TUI 显示 + 输入处理 |
| `src/agent.ts` | agent loop(跨平台共享) |
| `src/tools.ts` | 工具定义 + 执行器 |
| `src/prompts.ts` | system prompt 集中地 |

跟 catui 顶层架构同构。P3 头注释也写了(参考 `src/agent.ts:1-15`、`src/tools.ts:1-15`)。

### 2. agent loop 的中断处理是真的想过的

`src/agent.ts:60-67`

```typescript
for await (const chunk of stream) {
  if (signal.aborted) {
    abortedDuringStream = true;
    stream.controller?.abort(); // 关底层 HTTP 连接(保险)
    break;
  }
  ...
}
```

不只 throw 一个 error,是**主动 abort 底层 HTTP 连接**。而且 `src/agent.ts:90-94` 保留了已收到的 content。这是正确的——大部分人写到这里都会让 stream 跑完才检查,白白浪费 token。

### 3. 工具结构统一

`src/tools.ts:113-117` 定义统一返回结构:

```typescript
// 成功: { ok: true, ... 该工具特有的字段 }
// 失败: { ok: false, error: string }
```

`formatReport` 在 `src/tools.ts:200-216` 统一格式化。比 catui 那套 registry 简陋,但**够用且清晰**。

### 4. system prompt 短而准

`src/prompts.ts:11-15`:

```
你是 caturn,一个简洁的代码助手。可以派 read/edit/write/grep/ls/bash 六个使者协作完成任务。
回答简短直接,不要客套。
改代码用 edit(小改动)而不用 write(整个覆盖)。
搜内容用 grep 而不是 read 整个文件。
```

不啰嗦,直接给规则。

---

## 存在的问题(按优先级)

### P0 - 必修

#### 1. `grep` 工具只支持单文件,不支持目录递归

**位置**: `src/tools.ts:181-191`

```typescript
// ── grep 使者:在文件里搜匹配的字符串 ──
if (name === 'grep') {
  try {
    const content = fs.readFileSync(args.path, 'utf8');
    const matches: Array<{ line: number; content: string }> = [];
    content.split('\n').forEach((line, i) => {
      if (line.includes(args.pattern)) matches.push({ line: i + 1, content: line });
    });
    return { ok: true, matches, count: matches.length, path: args.path };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}
```

**问题**: 传目录直接炸,只能扫单个文件。真实场景里 grep 是**在整个项目里找关键字**。

**对照**: catui 的 grep 工具用 ripgrep,支持目录递归 + glob。

**修复方向**: 改用 `child_process.exec('rg ...')`,或者用 Node `fs.readdirSync` 递归实现。

#### 2. `bash` 没有 timeout,maxBuffer 只有 1MB

**位置**: `src/tools.ts:134-136`

```typescript
const { stdout, stderr } = await execAsync(args.command, {
  cwd: process.cwd(),
  maxBuffer: 1024 * 1024, // 1MB 上限
});
```

**问题**:
- 无 timeout: `sleep 99999` 能把 agent 卡死
- maxBuffer 太小: catui 是 10MB+,1MB 超过会**直接崩整个 agent**(不是返回错误)

**修复**: 加 `timeout: 30000`(30 秒),`maxBuffer: 10 * 1024 * 1024`。

#### 3. `edit` 工具的 oldText 在不同换行符下会失败

**位置**: `src/tools.ts:166-172`

```typescript
const content = fs.readFileSync(args.path, 'utf8');
const occurrences = content.split(args.oldText).length - 1;
if (occurrences === 0) return { ok: false, error: 'oldText 在文件里找不到' };
if (occurrences > 1) return { ok: false, error: `oldText 出现 ${occurrences} 次,请提供更精确的上下文` };
const newContent = content.replace(args.oldText, args.newText);
```

**问题**: Windows 文件是 `\r\n`,旧 Mac 是 `\r`。如果文件是 CRLF 但 oldText 里写的是 `\n`,`split` 数错。

**修复**: 读取时统一 normalize,或者用更宽松的匹配(按行匹配)。

---

### P1 - 强烈建议修

#### 4. messages 数组是直接 mutate 的

**位置**: `src/agent.ts:92` `src/agent.ts:96` `src/agent.ts:105`

```typescript
if (msg.content) messages.push(msg);   // line 92
messages.push(msg);                     // line 96
messages.push({ ... });                 // line 105 (tool result)
```

**问题**: 调用方传进来的数组被改了。`caturn.tsx:77-82` 每次重建 apiMessages 但传的是 `messagesRef.current`——一旦 agent loop 修改了入参,TUI 状态就乱了。

```typescript
// caturn.tsx:77
const apiMessages: any[] = [
  { role: 'system', content: SYSTEM_PROMPT },
  ...messagesRef.current.map((m) => ({ role: m.role, content: m.content })),
  { role: 'user', content: text },
];
```

**修复**: agentLoop 内部用 local copy,或者返回新的 messages 让调用方管理。

#### 5. 没有 session 持久化

**位置**: `caturn.tsx:77-82`(每次重建 messages)

**问题**: 全部在内存里。重启就没了。catui 有 `.catui/session/*.jsonl` 持久化。

**修复**: 加 SessionManager,每轮写入 JSONL,启动时读取。

#### 6. tool result 长度没限制

**位置**: `src/tools.ts:124-125` `src/tools.ts:152`

```typescript
const content = fs.readFileSync(args.path, 'utf8');   // line 124
fs.writeFileSync(args.path, args.content, 'utf8');    // line 152
```

**问题**: 读一个 10MB 的文件,整个塞进 messages,token 爆炸。

**修复**: `read` 加 `limit` / `offset` 参数,或者 truncate 到 N 行。`write` 也类似(content 太大直接爆 context)。

---

### P2 - 锦上添花

#### 7. `tools.ts` 用 `any[]` 和 `any`

**位置**: `src/tools.ts:25` `src/tools.ts:115`

```typescript
export const tools: any[] = [...]                     // line 25
export async function executeTool(name: string, args: any): Promise<any>  // line 115
```

**问题**: Phase 1 OK,但想做产品要换成 discriminated union:

```typescript
type ToolResult =
  | { ok: true; kind: 'read'; content: string }
  | { ok: true; kind: 'write'; bytes: number; path: string }
  | { ok: true; kind: 'edit'; path: string; diff: string }
  | { ok: true; kind: 'grep'; matches: ...; count: number; path: string }
  | { ok: true; kind: 'ls'; items: ...; path: string }
  | { ok: true; kind: 'bash'; stdout: string; stderr: string }
  | { ok: false; error: string };
```

#### 8. 测试文件命名混乱

**位置**: `test/`

```
test/
├── run-all.tsx
├── test-abort.tsx
├── test-abort-app.tsx
├── test-abort-direct.tsx
├── test-abort-flag.tsx
├── test-auto.tsx
├── test-snapshot.tsx
├── test-snapshot-interact.tsx
├── test-stream.tsx
└── unit/
    ├── agent.tsx
    └── tools.tsx
```

**问题**: 四个 abort 测试文件(`test-abort*`)是迭代过程留下的。`test/unit/` 下又新建了一套。到底跑哪个?

**修复**: 删掉散文件,只留 `test/run-all.tsx` 入口 + `test/unit/` 子测试。

#### 9. 没有 slash command

**位置**: `caturn.tsx`(整个文件)

**问题**: 没有 `/model` `/clear` `/compact` 等命令。现在输入框只能发消息。

**修复**: 加 `/` 前缀检测,简单实现 `/clear`(清空 messages)/ `/help`(显示帮助)。

---

## 三个最该立刻修的

按顺序:

1. **`grep` 改成递归 + 支持 glob** — 否则 agent 在真实项目里是瞎子
2. **`bash` 加 timeout + maxBuffer 提到 10MB** — 否则遇到大输出或慢命令就崩
3. **测试结构清理** — `test/` 下的散文件归档或删除,只用 `test/run-all.tsx` 入口

---

## 参考文件路径汇总

| 主题 | 文件:行 |
|------|---------|
| 分层结构 | `learning/phase-1-while-loop/caturn.tsx:1-15`, `src/agent.ts:1-15`, `src/tools.ts:1-15` |
| agent loop 中断 | `src/agent.ts:60-67`, `src/agent.ts:90-94` |
| 工具统一结构 | `src/tools.ts:113-117`, `src/tools.ts:200-216` |
| system prompt | `src/prompts.ts:11-15` |
| grep 单文件缺陷 | `src/tools.ts:181-191` |
| bash 无 timeout | `src/tools.ts:134-136` |
| edit 换行符缺陷 | `src/tools.ts:166-172` |
| messages mutate | `src/agent.ts:92, 96, 105`, `caturn.tsx:77-82` |
| 读文件无限制 | `src/tools.ts:124-125`, `src/tools.ts:152` |
| any 类型 | `src/tools.ts:25, 115` |
| 测试混乱 | `learning/phase-1-while-loop/test/` |

---

## 下一步

**Phase 1 已经毕业了**。代码能跑、能流、能中断、能调工具——超过 90% 学写 agent 的人了。

二选一:

- **A. 修 P0**: 把 grep / bash / 测试结构三个修了再进 Phase 2
- **B. 进 Phase 2**: 会话持久化 + slash command,缺陷边走边补

推荐 A,但你自己定。