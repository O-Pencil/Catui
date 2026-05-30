# Issue: cron-tasks.json 存储位置与 TUI cwd 不一致，导致定时任务无法触发

## ID
`issue:cron-tasks-path-mismatch`

## 状态
`open`

## 日期
`2026-05-22`

---

## 问题描述

用户通过 TUI 内 `/loop create` 命令创建 durable cron 任务后，任务配置文件被写入 `~/.nanopencil/cron-tasks.json`，但 nanoPencil TUI 的 cron 调度器实际读取的是 `{api.cwd}/.nanopencil/cron-tasks.json`——两者路径不同，导致调度器读取到旧文件，定时任务从未触发。

### 复现路径

1. 用户在 TUI 中执行 `/loop create "0 9 * * *" <prompt>`，创建一个每天 9 点触发的 GitHub 日报任务
2. 任务创建后，文件写入 `~/.nanopencil/cron-tasks.json`（任务 ID `5cb66040`，包含完整的蕾姆口吻日报 prompt）
3. nanoPencil TUI 从 `/home/minghuazzz/Pencil` 启动（`process.cwd()`），因此 `api.cwd = /home/minghuazzz/Pencil`
4. cron 调度器（`createCronScheduler({ dir: api.cwd })`）读取 `/home/minghuazzz/Pencil/.nanopencil/cron-tasks.json`（旧文件，任务 ID `5b725adf`，内容为旧版 prompt）
5. 每天 9 点调度器检查旧文件中的任务，任务存在但发送命令是 openclaw（早已失效），日报从未正常发出

### 影响

- 所有通过 TUI 创建的 durable cron 任务在多项目工作区中都无法触发
- 用户感知为「定时任务创建成功但从不执行」，诊断困难（两个路径的文件内容不同，不直观）

---

## 根因分析

### 路径层级

```
~/.nanopencil/cron-tasks.json      ← 任务实际写入位置
/home/minghuazzz/Pencil/.nanopencil/cron-tasks.json  ← 调度器读取位置
```

### 代码层面的原因

1. **任务写入时使用了 fallback cwd**：
   `cron-tasks.ts` 中 `addCronTask()` 接收 `projectRoot` 参数。当调用路径没有显式传入 `projectRoot` 时，某些工具（如 `CronCreateTool`）使用 `ctx.cwd`（= `api.cwd` = TUI 进程 cwd），但历史上可能存在另一条代码路径用 `~` 或 `~/.nanopencil` 作为默认值。

2. **调度器读取使用 `api.cwd`**：
   `loop/index.ts` 第 298 行：
   ```typescript
   createCronScheduler({ dir: api.cwd })
   ```
   `api.cwd` 来源为 `ExtensionContext.cwd`，在 TUI 模式下为进程启动目录（TUI 从 `/home/minghuazzz/Pencil` 启动则为 `/home/minghuazzz/Pencil`）。

3. **两个路径不指向同一文件**：
   当 TUI cwd ≠ `~` 时（大多数情况），`~/.nanopencil/` 和 `{cwd}/.nanopencil/` 是两个独立目录，调度器无法看到用户实际创建的任务。

### 关键代码位置

| 文件 | 行 | 说明 |
|------|----|------|
| `extensions/builtin/loop/cron-tools/cron-create-tool.ts` | 51 | `addCronTask(ctx.cwd, {...})` — 传入 ctx.cwd |
| `extensions/builtin/loop/cron/cron-scheduler.ts` | 298 | `createCronScheduler({ dir: api.cwd })` — 使用 api.cwd |
| `extensions/builtin/loop/cron/cron-tasks.ts` | 72 | `CRON_FILE_REL = ".nanopencil/cron-tasks.json"` |
| `core/runtime/agent-session.ts` | 396 | `this._cwd = config.cwd` — 来自 CreateAgentSessionOptions |
| `core/runtime/sdk.ts` | 283 | `const cwd = options.cwd ?? process.cwd()` |

---

## 推荐修复方案

### 方案 A（推荐）：统一存储到 agentDir，与 issue-0012 对齐

> 问题：cron tasks 存储位置分散（`~/.nanopencil` vs `{cwd}/.nanopencil`），与 Issue 0012「Pencils 数据目录统一」的思路一致。

**修改点：**

1. `cron-tasks.ts`：`CRON_FILE_REL` 路径改为相对于 `agentDir`，而非 `projectRoot`
   ```typescript
   // 从
   const CRON_FILE_REL = ".nanopencil/cron-tasks.json";
   // 改为（假设 agentDir 为 ~/.pencils/agents/<id>）
   const CRON_FILE_REL = ".nanopencil/cron-tasks.json";
   // 并在 addCronTask / readCronTasks 中传入 agentDir 而非 cwd
   ```

2. `cron-create-tool.ts`：传入 `ctx.agentDir`（需新增到 ExtensionContext）
   ```typescript
   await addCronTask(ctx.agentDir, { ... })  // agentDir 来自 agentDirContext.path
   ```

3. `loop/index.ts`：`createCronScheduler({ dir: agentDir })`

**优点**：
- 与 issue 0012 的数据存储对齐原则一致
- 每个 agent 的 cron tasks 在统一位置，不会因 cwd 变化而失效
- 解决了跨项目工作区的问题

**缺点**：
- 需要 ExtensionContext 新增 `agentDir` 字段（属于 API 扩展）

---

### 方案 B（简单修复）：任务创建时校验并警告

> 问题：用户不知道任务写到了哪个路径，调度器也未检查文件是否存在。

**修改点：**

1. `addCronTask()` 在写入后验证可读性，读取一次确认写入成功
2. 若读取失败（路径不存在或权限问题），抛出明确错误告知用户
3. cron scheduler 启动时若文件不存在，创建空 `{ tasks: [] }` 并打印日志

**优点**：
- 不改变存储结构，仅增加校验和警告
- 改动小，风险低

**缺点**：
- 没有根治问题，只是让问题更容易发现

---

### 方案 C（无改动）：让调度器同时检查两个路径

> 问题：迁移成本最小，但增加了调度器复杂度。

**修改点：**

cron scheduler 启动时检查两个路径，合并任务列表：
- `{cwd}/.nanopencil/cron-tasks.json`
- `~/.nanopencil/cron-tasks.json`（或 `~/.pencils/agents/<id>/.nanopencil/cron-tasks.json`）

**优点**：
- 用户无需重新创建任务，现有任务自动生效

**缺点**：
- 两个文件可能版本不一致，产生歧义
- 增加了维护复杂度

---

## 推荐

**方案 A（统一到 agentDir）**：从架构层面解决问题，与 issue 0012 方向一致，长期维护成本最低。需要在 `ExtensionContext` 中增加 `agentDir` 字段。

---

## 验证方式

1. 从非 home 目录启动 TUI（如 `cd /project && nanopencil`）
2. 创建 durable cron task
3. 检查 `~/.pencils/agents/<id>/.nanopencil/cron-tasks.json` 有任务写入
4. 检查调度器读取的路径与写入路径一致
5. 手动 `forceDue` 或等待 cron 触发，任务正常执行

---

## 相关 Issue

- Issue 0012: Gateway 数据存储位置与系统目录对齐（nanoPencil 项目内）
- REQ-001-proactive-send: Pencil-Agent-Gateway DingTalk 主动发送（已实现）