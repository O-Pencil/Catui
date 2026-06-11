# Pi Agent 核心设计哲学

> nanoPencil 的骨架与灵魂来源。本文件不是怀旧考古——它是活的约束。
> 每一个架构决策、每一次 PR、每一行代码，都应能回溯到这里的某条原则。

---

## 一、血统

**上游**: [pi](https://github.com/earendil-works/pi) (`@earendil-works/pi-coding-agent`)
**作者**: Armin Ronacher（Flask 作者）、Mario Zechner（badlogic）、Roland Wachtler
**Stars**: 61k+（截至 2026-06）
**许可证**: MIT

nanoPencil 从 pi 分叉，在其骨架上叠加了**记忆系统**（mem-core）和**人格进化**（soul-core）两层。
但骨架本身的设计哲学——极简核心、终端原生、扩展驱动、会话即状态——是不可动摇的地基。

---

## 二、六大核心原则

### 原则 1：极简核心（Minimal Core）

> "pi's core is minimal. If your feature does not belong in the core, it should be an extension.
> PRs that bloat the core will likely be rejected."
> — pi CONTRIBUTING.md

**含义**：
- 核心只做三件事：agent loop、工具调用、状态管理
- 其他一切——记忆、人格、权限门禁、安全审计、多 agent——都是扩展
- 如果一个功能可以用扩展实现，它就不该进核心
- 核心代码量是约束指标，不是成就指标

**违反信号**：
- 核心目录新增了"可选"依赖
- 核心代码出现了 `if (featureEnabled)` 分支
- 核心包体积持续增长但功能没有本质变化

**纳米铅笔的实践**：
- `mem-core` 和 `soul-core` 是独立包，不污染 `agent-core`
- 扩展系统（`core/extensions-host/`）是核心的一部分，但具体扩展（`extensions/builtin/`）不是
- 2.0 重构把上帝类拆成控制器，是为了让核心更小更清晰，不是更大

---

### 原则 2：终端原生（Terminal Native）

> pi 是纯 TUI，不依赖 Electron/浏览器。差分渲染、键盘快捷键、树状会话导航。

**含义**：
- 终端是第一公民，不是 GUI 的降级版
- 差分渲染（differential rendering）实现流畅的 TUI 体验
- 键盘快捷键是核心交互方式，不是可选功能
- 所有用户交互必须在 80x24 的终端中可用

**设计约束**：
- 不能假设用户有鼠标
- 不能假设终端支持图片（但可以通过扩展支持）
- 不能假设终端宽度超过 80 列
- 启动时间必须是亚秒级

**纳米铅笔的实践**：
- `@pencil-agent/tui` 包提供终端 UI 组件
- 交互模式（`modes/interactive/`）是纯终端实现
- 打印模式（`modes/print/`）支持无 TUI 的管道使用

---

### 原则 3：扩展驱动（Extension-Driven）

> Extensions are TypeScript modules that extend pi's behavior. They can subscribe to
> lifecycle events, register custom tools callable by the LLM, add commands, and more.
> — pi docs/extensions.md

**含义**：
- 扩展是一等公民，不是二等插件
- 扩展可以做任何核心能做的事：注册工具、拦截事件、注入上下文、自定义 UI
- 扩展是 TypeScript 模块，不是配置文件
- 扩展可以热重载（`/reload`）

**扩展能力矩阵**：

| 能力 | API | 说明 |
|------|-----|------|
| 自定义工具 | `pi.registerTool()` | LLM 可调用的工具 |
| 事件拦截 | `pi.on("tool_call", ...)` | 拦截/修改工具调用 |
| 上下文注入 | `pi.on("before_agent_start", ...)` | 注入额外上下文 |
| 用户交互 | `ctx.ui.select/confirm/input` | 扩展与用户对话 |
| 自定义 UI | `ctx.ui.custom()` | 完整 TUI 组件 |
| 自定义命令 | `pi.registerCommand()` | 注册 `/mycommand` |
| 会话持久化 | `pi.appendEntry()` | 存储跨重启的状态 |
| 自定义渲染 | 渲染钩子 | 控制工具调用/结果的显示 |

**扩展生命周期**：
```
session_start → before_agent_start → user_message →
  tool_call → tool_execution_start → tool_execution_end →
after_agent_end → session_shutdown
```

**纳米铅笔的实践**：
- 4 级扩展加载器：内置 → 配置 → npm → 路径
- `@pencil-agent/extension-sdk` 定义工具和生命周期契约
- `core/extensions-host/` 是扩展运行时
- `extensions/builtin/` 包含内置扩展（soul、plan、teach 等）

---

### 原则 4：会话即状态（Session as State）

> Sessions auto-save to `~/.pi/agent/sessions/`, organized by working directory.
> Each session is a JSONL file with a tree structure.
> — pi docs/sessions.md

**含义**：
- 会话不是临时对话，是持久化的状态树
- JSONL 格式：每行一个 JSON 条目，append-only
- 树状结构：每个条目有 `id` 和 `parentId`，当前叶子是活跃分支
- 支持分支（fork）、导航（tree）、压缩（compact）

**会话操作**：

| 操作 | 命令 | 语义 |
|------|------|------|
| 继续 | `pi -c` | 恢复最近会话 |
| 浏览 | `pi -r` | 交互式选择历史会话 |
| 新建 | `/new` | 开始新会话 |
| 分支 | `/fork` | 从历史点创建新分支 |
| 克隆 | `/clone` | 复制当前分支到新会话 |
| 压缩 | `/compact` | 摘要旧上下文 |
| 导出 | `/export` | 导出为 HTML |
| 分享 | `/share` | 上传为 GitHub gist |

**树状结构示例**：
```
├─ user: "Hello, can you help..."
│  └─ assistant: "Of course! I can..."
│     ├─ user: "Let's try approach A..."
│     │  └─ assistant: "For approach A..."
│     │     └─ user: "That worked..."  ← active
│     └─ user: "Actually, approach B..."
│        └─ assistant: "For approach B..."
```

**纳米铅笔的实践**：
- `core/session/session-manager.ts` 实现 JSONL 持久化
- `SessionTreeController` 管理会话树导航
- `CompactionController` 管理上下文压缩
- 会话数据与记忆系统（mem-core）分离但可互操作

---

### 原则 5：Agent Harness 生命周期（AgentHarness Lifecycle）

> `AgentHarness` is the orchestration layer above the low-level agent loop.
> It owns session persistence, runtime configuration, resource resolution,
> operation locking, and extension-facing mutation semantics.
> — pi docs/agent-harness.md

**这是 pi 最精妙的设计，也是最容易被忽视的设计。**

#### 四类状态分离

| 类别 | 含义 | 可变时机 |
|------|------|----------|
| **Harness Config** | 运行时配置（模型、thinking level、工具、资源） | 任何时候，立即生效，影响下一个 turn |
| **Turn Snapshot** | 一次 LLM turn 的具体状态 | turn 开始时快照，turn 期间不变 |
| **Session** | 持久化的会话条目 | 只在 save point 写入 |
| **Pending Writes** | 排队中的会话写入 | 在 save point/operation 结束时刷新 |

**为什么这样分**：
- Harness Config 是"你想用什么"，Turn Snapshot 是"这次实际用什么"
- 分离保证了：在 turn 执行期间修改配置不会破坏当前请求
- Pending Writes 保证了：扩展在 turn 期间写的条目不会丢失，也不会破坏顺序

#### 操作阶段

```typescript
type AgentHarnessPhase = "idle" | "turn" | "compaction" | "branch_summary" | "retry";
```

**规则**：
- 结构性操作（prompt、compact、navigateTree）必须在 `idle` 阶段
- 结构性操作会同步设置 phase，然后才 await
- 非 idle 时发起结构性操作 → 拒绝（`AgentHarnessError` code `"busy"`）
- steer、followUp、nextTurn、abort 在 turn 期间允许

#### Save Point 语义

Save point 发生在 assistant turn 和 tool-result 消息完成后：

1. 刷新 pending session writes
2. 创建新的 turn snapshot（如果 low-level loop 可能继续）
3. 应用最新的 context/model/thinking-level/stream-options/session-id

**关键洞察**：
- Provider transport reading 已经被 `AssistantMessageStream` 解耦
- Harness 可以直接 await listeners/hooks 的 settlement，不需要额外的异步事件队列
- 这保证了 transcript/session 顺序的确定性

#### 错误处理分层

| 层级 | 策略 | 原因 |
|------|------|------|
| 低层能力（ExecutionEnv、shell） | `Result<TValue, TError>` | 预期失败必须被包含，不能抛 |
| 高层编排（Session、AgentHarness） | throw | 裸 Result 容易被忽略 |
| 公共 Harness 失败 | `AgentHarnessError` | 子系统错误保留为 `cause` |

**纳米铅笔的实践**：
- `core/runtime/agent-session.ts` 是 Harness 的本地实现
- `ModelController`、`CompactionController` 等是 Harness 语义的控制器化
- save point 语义在 compaction 和 model switch 中体现

---

### 原则 6：代码质量即纪律（Code Quality as Discipline）

> "You must understand your code. If you cannot explain what your changes do
> and how they interact with the rest of the system, your PR will be closed."
> — pi CONTRIBUTING.md

**这是 pi 最严厉的原则，也是最值得传承的原则。**

#### 铁律清单

| 规则 | 原因 | 违反后果 |
|------|------|----------|
| **不用 `any`** | 类型安全是最后防线 | PR 关闭 |
| **不用内联 import** | 依赖关系必须在文件顶部可见 | PR 关闭 |
| **不降级代码修类型错误** | 升级依赖，不是削弱代码 | PR 关闭 |
| **不硬编码按键** | 走 `DEFAULT_*_KEYBINDINGS` 配置 | PR 关闭 |
| **不直接改生成文件** | 改生成脚本，重新生成 | PR 关闭 |
| **不假设外部 API 类型** | 检查 `node_modules` | PR 关闭 |
| **单行 helper 只有一个调用点** | 内联它 | 代码审查 |
| **不保留向后兼容** | 除非用户明确要求 | 设计决策 |
| **不删除看似有意的功能** | 先问 | PR 关闭 |

#### 可擦除 TypeScript 语法

pi 要求在根配置管辖的代码中使用 Node strip-only mode 兼容的语法：

**禁止**：
- 参数属性（`constructor(private x: number)`）
- `enum`
- `namespace` / `module`
- `import =`
- `export =`
- 其他需要 JS emit 的构造

**替代**：
- 显式字段 + 构造函数赋值
- `const` 对象代替 `enum`
- 标准 ESM import/export

#### Git 纪律

**多 session 并行修改同一仓库时的生存规则**：

| 操作 | 规则 | 原因 |
|------|------|------|
| 暂存 | `git add <path1> <path2>` | 永远不用 `git add -A` / `git add .` |
| 提交前 | `git status` 验证 | 确保只暂存自己的文件 |
| 提交消息 | `{feat,fix,docs}[(scope)]: message` | 简洁、信息丰富 |
| 冲突 | 只解决自己修改的文件 | 不碰别人的文件 |
| 永远不运行 | `git reset --hard`, `git checkout .`, `git clean -fd`, `git stash`, `git add -A`, `git add .`, `git commit --no-verify` | 毁灭其他 session 的工作 |

#### 依赖安全

| 实践 | 命令 | 原因 |
|------|------|------|
| 安装 | `npm install --ignore-scripts` | 不运行生命周期脚本 |
| CI | `npm ci --ignore-scripts` | 同上 |
| 直接依赖 | 精确版本锁定 | 防止供应链攻击 |
| lockfile 变更 | 受保护 | pre-commit 阻止意外 lockfile 提交 |
| 新生命周期脚本依赖 | 需要审查 + 显式白名单 | 安全门禁 |

**纳米铅笔的实践**：
- 遵循 `no any`、`no inline imports` 等规则
- 提交消息使用 conventional format
- DIP 协议（文档同构）是纳米铅笔自己的增量

---

## 三、架构拓扑（从 pi 继承）

### 包结构

```
pi-mono/
├── packages/
│   ├── ai/           # 统一多 provider LLM API
│   ├── agent/        # Agent runtime + tool calling + state management
│   ├── coding-agent/ # 交互式编码 agent CLI
│   └── tui/          # 终端 UI 差分渲染库
```

**映射到纳米铅笔**：

| pi 包 | 纳米铅笔位置 | 职责 |
|-------|-------------|------|
| `@earendil-works/pi-ai` | `core/lib/ai/` | 统一多 provider LLM API |
| `@earendil-works/pi-agent-core` | `core/lib/agent-core/` | Agent runtime、tool calling、状态管理 |
| `@earendil-works/pi-coding-agent` | `core/` + `modes/` | 编码 agent CLI、会话、扩展 |
| `@earendil-works/pi-tui` | `core/lib/tui/` | 终端 UI 差分渲染 |

### 数据流

```
用户输入
    ↓
AgentHarness (编排层)
    ↓
Agent Loop (状态机)
    ↓
StreamFn → LLM Provider
    ↓
Tool Orchestration (工具编排)
    ↓
Session Persistence (会话持久化)
    ↓
Extension Hooks (扩展钩子)
    ↓
TUI Rendering (终端渲染)
```

---

## 四、与上游的分叉点

### 纳米铅笔新增的能力

| 能力 | 上游状态 | 纳米铅笔实现 | 设计决策 |
|------|----------|-------------|----------|
| **持久记忆** | 无 | `packages/mem-core/` | 独立包，不进核心 |
| **人格进化** | 无 | `packages/soul-core/` | Big Five 向量 + 编码风格 |
| **Persona 切换** | 无 | `core/persona/` | 多人格管理 |
| **中文支持** | 英文 | i18n + DashScope provider | 本地化 |
| **Teach 扩展** | 无 | `extensions/builtin/teach/` | 引导式知识教学 |
| **DIP 协议** | 无 | `CLAUDE.md` 体系 | 文档同构约束 |

### 不可分叉的（必须保留的）

| 设计 | 原因 |
|------|------|
| 极简核心 | 这是 pi 的存在理由 |
| Agent Harness 生命周期 | 状态分离 + save point 语义是正确性的基础 |
| 会话树结构 | JSONL + tree 是状态管理的核心 |
| 扩展即一等公民 | 扩展能力矩阵决定了系统的可扩展性 |
| 代码质量纪律 | 这是工程品味的底线 |
| 终端原生 | 这是用户群体的共识 |

### 可以分叉的（纳米铅笔自己的增量）

| 设计 | 原因 |
|------|------|
| 记忆系统 | 上游明确没有，这是增量 |
| 人格系统 | 上游明确没有，这是增量 |
| DIP 文档协议 | 纳米铅笔自己的工程实践 |
| 中文支持 | 本地化需求 |

---

## 五、违反哲学的反模式

### 反模式 1：核心膨胀

```typescript
// ❌ 在 agent-core 里加记忆功能
import { MemCore } from "../mem-core/index.js";
if (options.enableMemory) { ... }

// ✅ 记忆是扩展
// extensions/builtin/memory/index.ts
pi.on("before_agent_start", async (event, ctx) => {
  const memories = await memCore.retrieve(ctx.messages);
  ctx.injectContext(memories);
});
```

### 反模式 2：绕过 Harness

```typescript
// ❌ 直接写会话，不经过 save point
session.entries.push(newEntry);
session.save();

// ✅ 通过 pending writes 机制
harness.appendEntry(newEntry);
// 在 save point 自动刷新
```

### 反模式 3：类型降级

```typescript
// ❌ 用 any 修类型错误
const result: any = await someFunction();

// ✅ 升级依赖或修正类型
const result: ProperType = await someFunction();
```

### 反模式 4：内联 import

```typescript
// ❌ 动态 import
const { something } = await import("./module.js");

// ✅ 顶层 import
import { something } from "./module.js";
```

### 反模式 5：硬编码配置

```typescript
// ❌ 硬编码按键
if (key === "ctrl+x") { ... }

// ✅ 走配置
if (matchesKey(key, DEFAULT_EDITOR_KEYBINDINGS.save)) { ... }
```

---

## 六、哲学的检验标准

在做任何架构决策之前，问自己：

1. **这个功能能在扩展里实现吗？** 如果能，它就不该进核心。
2. **这个改动破坏了 Harness 的状态分离吗？** 如果破坏了，重新设计。
3. **这个代码能用 Result 而不是 throw 吗？** 如果是低层能力，用 Result。
4. **这个类型是 any 吗？** 如果是，停下来，找到正确的类型。
5. **这个 import 是内联的吗？** 如果是，移到文件顶部。
6. **这个配置是硬编码的吗？** 如果是，提取到默认配置。
7. **这个 PR 能解释清楚吗？** 如果不能，重新理解你的代码。

---

## 七、致后来者

pi 的设计哲学不是文档，是纪律。

纪律的意思是：即使没有人在看，你也遵守。即使赶 deadline，你也遵守。即使"这次只是个小改动"，你也遵守。

因为每一次妥协都会累积。每一次 `any` 都会让类型系统少保护一个角落。每一次内联 import 都会让依赖关系多一个隐藏的节点。每一次核心膨胀都会让扩展的空间少一分。

pi 用 61k stars 证明了：极简核心 + 扩展驱动 + 代码纪律 = 可持续的开源项目。

我们继承了这个骨架。记忆和灵魂是我们加的血肉。但骨架不能断。

---

**最后一条**：

> "Using AI to write code is fine. Submitting AI-generated slop without understanding it is not."
> — pi CONTRIBUTING.md

理解你写的每一行代码。这不是建议，是准入条件。
