# caturn 工具层设计

> 学习笔记:6 工具全貌 + 跟 catui 对照 + 未来扩展
> 写入时间: 2026-08-12
> 本目录: `learning/phase-1-while-loop/`
> 核心代码: `src/tools.ts`

---

## 0. 一句话总结

**工具 = 模型的手。定义告诉模型"你能派谁",执行器告诉代码"谁去干活",格式化决定给模型看啥报告。**

caturn 6 工具够用但不完整,真实项目里需要补 find + 修 grep + 加超时。

---

## 1. caturn 工具全景

### 1.1 工具分类

| 类别 | 工具 | 作用 |
|------|------|------|
| **文件读** | `read` | 读文件全部内容 |
| **文件写** | `write` | 覆盖写入文件 |
| **文件改** | `edit` | 精确替换文件里某段 |
| **搜索** | `grep` | 在文件里搜字符串 |
| **浏览** | `ls` | 列目录 |
| **执行** | `bash` | 跑 shell 命令 |

### 1.2 工具结构

每个工具由三部分组成(`src/tools.ts`):

```typescript
// 1. 定义(tools 数组里的一项) - 告诉模型你有什么
{
  type: 'function',
  function: {
    name: 'read',
    description: '读一个文件的全部内容。传文件路径。',
    parameters: { type: 'object', properties: { ... }, required: [...] }
  }
}

// 2. 执行器(executeTool 的分支) - 真的去干活
if (name === 'read') {
  const content = fs.readFileSync(args.path, 'utf8');
  return { ok: true, content };
}

// 3. 格式化(formatReport 的分支) - 把结果变成给模型看的字符串
if (result.content !== undefined) return result.content;
```

### 1.3 现有工具速查表

| 工具 | 定义行 | 执行行 | 格式化行 | 状态 |
|------|--------|--------|---------|------|
| `read` | `src/tools.ts:30-37` | `src/tools.ts:121-128` | `src/tools.ts:203` | ⚠️ 无长度限制 |
| `bash` | `src/tools.ts:39-46` | `src/tools.ts:131-144` | `src/tools.ts:215-216` | ⚠️ 无 timeout,maxBuffer 1MB |
| `write` | `src/tools.ts:48-58` | `src/tools.ts:147-156` | `src/tools.ts:204` | ⚠️ 无长度限制 |
| `edit` | `src/tools.ts:60-82` | `src/tools.ts:159-176` | `src/tools.ts:205` | ⚠️ 换行符 bug |
| `grep` | `src/tools.ts:64-82` | `src/tools.ts:179-191` | `src/tools.ts:206-210` | ❌ 不支持目录 |
| `ls` | `src/tools.ts:84-94` | `src/tools.ts:194-203` | `src/tools.ts:211-214` | ✅ OK |

---

## 2. catui 工具分层(对照参考)

### 2.1 catui 的工具分类

| 类别 | catui 工具 | 作用 |
|------|-----------|------|
| **文件读** | `read` | 支持 limit/offset,大文件分页 |
| **文件写** | `write` | 自动创建父目录 |
| **文件改** | `edit` | 用 ripgrep 找精确位置,处理多匹配 |
| **搜索** | `grep` | 用 ripgrep,支持目录递归 + glob |
| **搜索** | `find` | 用 fd,按文件名搜索 |
| **浏览** | `ls` | 用 ls(隐藏文件控制) |
| **执行** | `bash` | 5 分钟 timeout,10MB maxBuffer |
| **分析** | `source` | 加载文件到 context(语义搜索) |

### 2.2 关键差异

| 维度 | caturn | catui |
|------|--------|-------|
| 搜索后端 | 自己写 readFileSync | ripgrep(`rg`) |
| 找文件后端 | `ls` | `fd` |
| read 大文件 | 一次性整个读 | limit/offset 分页 |
| bash timeout | 无 | 300 秒 |
| bash maxBuffer | 1MB | 10MB |
| 写文件 | 一次性写 | 支持增量 |
| 工具注册 | 硬编码数组 | 动态 + 扩展系统 |

**catui 用现成的 CLI 工具(rg / fd)而不是 Node 原生 fs**,因为:
- 快(ripgrep C++ 实现,Node fs 比不上)
- 支持 glob / 正则 / 排除规则
- 流式输出,适合大文件

---

## 3. caturn 工具层的关键设计原则

### 3.1 描述决定一切

模型**只看 description 决定要不要调用这个工具**。描述写错,工具白给。

#### 好的描述

**caturn 的 `read`** (`src/tools.ts:33`):
```typescript
description: '读一个文件的全部内容。传文件路径。'
```

**问题**: 太笼统。"读一个文件的全部内容"——如果文件 100MB,模型不知道会爆炸。

**catui 的 `read`**(参考):
```
Read a file from the local filesystem. Supports offset/limit for large files.
- For large files, start with offset 0 and limit 100 lines
- Returns numbered lines (cat -n format)
- Cannot read binary files, use bash with `file` instead
```

**包含**:
- 触发场景(读文件)
- 大文件处理建议(offset/limit)
- 输出格式(行号)
- 限制(不能读二进制)

#### 错误描述

```typescript
// ❌ 反例
description: 'A useful tool'
description: 'Read function'
description: 'For reading files'
```

模型不知道**什么时候用**、**怎么用**、**输出是啥**。

### 3.2 参数描述要具体

```typescript
// ❌ 笼统
parameters: { path: { type: 'string' } }

// ✅ 具体
parameters: {
  path: {
    type: 'string',
    description: 'Absolute path to the file. Use forward slashes on all platforms.'
  }
}
```

参数描述影响模型传值的准确性。

### 3.3 错误要带上下文

```typescript
// ✅ caturn 的 edit 思路是对的
if (occurrences === 0) return { ok: false, error: 'oldText 在文件里找不到' };
if (occurrences > 1) return { ok: false, error: `oldText 出现 ${occurrences} 次,请提供更精确的上下文` };
```

模型看到这个错误,**知道怎么修**——下次传更精确的 oldText。

**反例**:
```typescript
return { ok: false, error: 'edit failed' };
```

模型一脸懵。

### 3.4 输出要人话

`src/tools.ts:200-216`:

```typescript
if (result.matches !== undefined) {
  if (result.count === 0) return `No matches for pattern in ${result.path}`;
  return result.matches.map((m: any) => `${m.line}:${m.content}`).join('\n');
}
```

`line:content` 格式(`grep -n` 风格),模型能直接理解。**不要 JSON 序列化整个对象塞给模型**——token 浪费 + 模型还要解析。

### 3.5 工具要原子化

**好的工具**:
- `read`: 只读一个文件
- `grep`: 只搜,不读全部
- `edit`: 只改一段

**反例**:
```typescript
// ❌ 一个工具做太多事
{
  name: 'read_and_grep',
  description: '读文件并搜内容',
  parameters: { path, pattern, ... }
}
```

模型不知道该用 `read` 还是 `read_and_grep`。**导致误用**。

---

## 4. 6 工具现状评估

### 4.1 够用吗

**Phase 1 阶段:够用。**

Phase 2 进真实项目:**不够**。

### 4.2 三大缺口

#### 缺口 1:`grep` 不支持目录递归

**当前**(`src/tools.ts:179-191`):只支持单文件。

**真实场景**: 模型要在整个项目里搜 "TODO",或者找所有引用某个函数的地方。

**修复**(用 ripgrep):

```typescript
{
  type: 'function',
  function: {
    name: 'grep',
    description: '在文件或目录里搜索匹配的字符串。支持目录递归、glob 过滤、行号显示。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件或目录路径' },
        pattern: { type: 'string', description: '要搜索的文字或正则' },
        glob: { type: 'string', description: '可选,文件过滤,如 **/*.ts' },
      },
      required: ['path', 'pattern'],
    },
  },
},

// 执行器
if (name === 'grep') {
  const args = ['rg', '--no-heading', '--line-number'];
  if (args.glob) args.push('--glob', args.glob);
  args.push(args.pattern, args.path);
  const { stdout } = await execAsync(args.join(' '));
  return { ok: true, content: stdout, count: stdout.split('\n').length - 1 };
}
```

#### 缺口 2:没有 `find`(按文件名搜)

catui `find` 工具的存在说明:**有真实需求**。

场景: "找 tests 目录下所有 test_*.test.ts 文件"。

```typescript
{
  type: 'function',
  function: {
    name: 'find',
    description: '按文件名搜索文件。支持 glob 模式。',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: '文件名 glob 模式,如 **/*.test.ts' },
        path: { type: 'string', description: '搜索起点,默认当前目录' },
      },
      required: ['pattern'],
    },
  },
},
```

实现: `fd <pattern> <path>` 或 Node `fs.readdirSync` 递归。

#### 缺口 3:`read` 无长度限制

**当前**(`src/tools.ts:124`): `fs.readFileSync(args.path, 'utf8')` 一次读完。

**问题**: 10MB 文件 → 10MB token。

**修复**(参考 catui):

```typescript
parameters: {
  path: { type: 'string' },
  offset: { type: 'number', description: '起始行号,0-based' },
  limit: { type: 'number', description: '读取行数,默认 100' },
}

// 执行器
const content = fs.readFileSync(args.path, 'utf8');
const lines = content.split('\n');
const start = args.offset || 0;
const end = args.limit ? start + args.limit : lines.length;
const slice = lines.slice(start, end).map((l, i) => `${start + i + 1}  ${l}`).join('\n');
return { ok: true, content: slice, totalLines: lines.length };
```

---

## 5. 工具描述的对照表

学习写 description 时,对比 caturn vs catui:

| 工具 | caturn | catui |
|------|--------|-------|
| `read` | "读一个文件的全部内容" | "Read a file... For large files, start with offset 0 and limit 100 lines" |
| `bash` | "执行一个 shell 命令,返回 stdout 和 stderr" | "Execute a shell command... For long-running commands, use timeout; max 5 min" |
| `edit` | "精确替换文件里某段文字" | "Performs exact string replacement... oldText must match exactly once; provide more context if multiple matches" |
| `grep` | "在文件里搜索匹配的文字" | "Search file contents with ripgrep... supports regex, glob, multiline" |
| `ls` | "列出一个目录下的所有文件和子目录" | "List directory contents... supports hidden files, glob patterns" |

**catui 的描述有 3 个共性**:
1. **说明触发场景**(什么时候用)
2. **给出使用建议**(参数怎么填)
3. **列出限制**(不支持什么)

caturn 的描述只有 1(说明功能),缺 2 和 3。

---

## 6. 扩展工具的实现路径

### 6.1 简单路径:加硬编码工具

适合 6 个工具 → 10 个工具阶段。

直接在 `src/tools.ts:25` 的 `tools` 数组追加 + `executeTool` 加 if-else。

### 6.2 中等路径:工具注册表

适合 10+ 工具阶段。

```typescript
type ToolDefinition = {
  name: string;
  description: string;
  parameters: any;
  execute: (args: any) => Promise<any>;
  format: (result: any) => string;
};

class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

  register(tool: ToolDefinition) {
    this.tools.set(tool.name, tool);
  }

  getDefinitions(): any[] {
    return Array.from(this.tools.values()).map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }

  async execute(name: string, args: any): Promise<any> {
    const tool = this.tools.get(name);
    if (!tool) return { ok: false, error: `未知工具: ${name}` };
    return await tool.execute(args);
  }

  format(name: string, result: any): string {
    const tool = this.tools.get(name);
    if (!tool) return JSON.stringify(result);
    return tool.format(result);
  }
}
```

每个工具写成独立文件,注册进 Registry。

### 6.3 高级路径:动态发现(Skill 层类似)

catui 的做法——`core/extensions-host/loader.ts` 扫描 `extensions/`,动态加载工具定义。

```
tool 工具
  ↓
definition 在拓展目录里
  ↓
loader 启动时扫描
  ↓
executor 运行时调用
```

**Phase 5+ 再考虑**。Phase 1-4 硬编码 + 注册表够用。

---

## 7. 关键决策记录

### 7.1 为什么 6 个工具,不是 3 个

3 个工具(读 / 写 / bash)看起来够用,但**模型会过度依赖 bash**——所有事都用 `bash` 跑,绕过了工具语义。

工具分层让模型**有明确选择**:
- 想改一小段 → `edit`(而不是 write 整个重写)
- 想搜内容 → `grep`(而不是 read 整个文件)
- 想跑命令 → `bash`(而不是写 Node 脚本)

**减少 token 浪费,提升准确度**。

### 7.2 为什么用 `if-else` 而不是 `Map`

```typescript
// 当前
if (name === 'read') { ... }
if (name === 'bash') { ... }
```

`if-else` 比 `Map` 直观,IDE 跳转方便,加新工具的开发摩擦小。

**6 个工具阶段不优化**。超过 15 个工具再换 Map。

### 7.3 为什么 result 用 "ok: true/false" 统一结构

```typescript
{ ok: true, content: '...' }     // 成功
{ ok: false, error: '...' }      // 失败
```

**好处**:
- `formatReport` 一行判断 `if (!result.ok) return error`
- 调用方处理错误统一
- 类型如果做 discriminated union 也容易

### 7.4 为什么 formatReport 用"字段判断"而不是"类型判断"

```typescript
if (result.content !== undefined) return result.content;  // read
if (result.bytes !== undefined) return `WROTE ${result.bytes} bytes`;  // write
```

**当前 OK**,但**脆弱**——如果两个工具都用 `content` 字段,会误判。

**修复方向**: 改用 `result.kind` 显式标记:

```typescript
{ ok: true, kind: 'read', content: '...' }
{ ok: true, kind: 'write', bytes: 100, path: '...' }
```

`formatReport` 改成 `if (result.kind === 'read')`。

### 7.5 工具描述的语言

**当前用中文**(`src/tools.ts:34-93`)。模型理解中文 OK,但**英文 description 更稳**——训练数据里中文 function calling 例子少。

**建议**: description 改成英文,保持 catui 一致。

---

## 8. 测试覆盖

`test/unit/tools.tsx` 现有测试。**建议加的**:

| 测试 | 验证 |
|------|------|
| `read` 大文件 | truncate 到指定行数 |
| `bash` timeout | 5 秒后抛错或 abort |
| `bash` 超大输出 | 超过 maxBuffer 优雅返回错误而非崩溃 |
| `edit` 0 匹配 | 返回 "oldText 找不到" |
| `edit` N 匹配 | 返回 "oldText 出现 N 次" |
| `edit` 换行符 | 文件 CRLF + oldText LF,仍能匹配 |
| `grep` 目录 | 递归搜索多个文件 |
| `grep` glob | 只搜 .ts 文件 |
| `grep` 0 匹配 | 返回 "No matches for ..." |
| `ls` 不存在目录 | 返回 error 而不崩 |
| `write` 大内容 | truncate 或返回警告 |
| 未知工具 | 返回 "未知工具: xxx" |

---

## 9. 跟 catui 的 caturn 特有差异

### 9.1 caturn 没考虑但 catui 实现的

| 特性 | catui | caturn |
|------|-------|--------|
| 工具权限控制 | 按工具/路径白名单 | 无 |
| 危险命令拦截 | `rm -rf /` 等 | 无 |
| 输出脱敏 | API key / token 自动 mask | 无 |
| 执行前确认 | 某些工具要求用户确认 | 无 |
| 工具统计 | 调用次数 / token 消耗 | 无 |
| 工具测试 | mock 工具 + 集成测试 | 真实执行 |

**Phase 2+ 要补的**:
- 危险命令拦截(防止 `rm -rf`)
- API key 自动 mask(防止泄露)
- 工具调用次数统计

### 9.2 caturn 反而比 catui 简单的地方

```typescript
// caturn executeTool
export async function executeTool(name: string, args: any): Promise<any> {
  if (name === 'read') { ... }
  // ...
  return { ok: false, error: `未知工具: ${name}` };
}
```

**一行函数完成**。catui 的 `core/tools/executor.ts` 有几十行 + extension hook + 权限检查 + 统计 + 错误包装。

**简化是对的**。先把核心跑通,再补周边。

---

## 10. 参考文件

| 主题 | 路径 |
|------|------|
| 6 工具定义 | `learning/phase-1-while-loop/src/tools.ts:25-94` |
| 6 工具执行器 | `src/tools.ts:113-198` |
| Result 格式化 | `src/tools.ts:200-216` |
| 工具测试 | `test/unit/tools.tsx` |
| catui 对照 | `core/tools/(bash|read|edit|write|grep|find|ls|source).ts` |
| catui 工具注册 | `core/extensions-host/loader.ts` |
| 一句话总结 | `learning/phase-1-while-loop/REVIEW.md` |

---

## 11. 三句话回顾

1. **6 工具够用但有缺口**:grep 不支持目录 / 没 find / read 无长度限制
2. **description 决定一切**:模型只看 description 决定调用,写错白给
3. **当前阶段硬编码 OK**:超过 15 个工具再换注册表,Phase 5+ 再考虑动态发现
