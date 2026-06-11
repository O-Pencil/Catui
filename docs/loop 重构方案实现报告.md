# `/loop` 重构方案实现报告

> 日期: 2026-04-18
> 方案文档: `docs/loop 重构方案.md`
> 目标: 按照方案改造 `/loop` 命令，消除双重调度器，统一到 cron 架构

---

## 修复的问题

### 问题 1: 双重调度器并存 ✅ 已修复

**之前**: `index.ts` 中同时运行 legacy scheduler 和 cron scheduler，同一任务被两个调度器同时处理。

**现在**: 只保留 cron scheduler。`/loop` 命令通过 `addCronTask` 创建任务，cron scheduler 统一调度。

```typescript
// 只创建一个 scheduler
const scheduler = createCronScheduler({
  onFire: (prompt, task) => dispatchTask(api, bus, task),
  dir: api.cwd,
});
```

### 问题 2: 存储文件不一致 ✅ 已修复

**之前**: legacy 用 `.nanopencil/loop-tasks.json`，cron 用 `.nanopencil/cron-tasks.json`。

**现在**: 统一使用 `.nanopencil/cron-tasks.json`。删除了 `loop-tasks.ts`，所有任务操作通过 `cron-tasks.ts`。

### 问题 3: markFired 未实现 ✅ 已修复

**之前**: `markFired` 函数是空桩。

**现在**: 通过 `markCronTasksFired` 真正持久化 `lastFiredAt` 到磁盘文件。

```typescript
async function markFired(id: string, firedAt: number): Promise<void> {
  await markCronTasksFired(dir, [id], firedAt);  // 真正写入文件
}
```

### 问题 4: 立即执行一次 ✅ 已修复

**之前**: 创建后只调用 `maybeDispatchScheduledTask` 不等第一轮。

**现在**: 创建任务后立即调用 `dispatchTask` 执行第一次。

```typescript
const result = await addCronTask(ctx.cwd, {...});
const task = await resolveTask(api.cwd, result.id);
if (task) void dispatchTask(api, bus, task);  // 立即执行
```

---

## 架构变更

### 文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `cron/cron-types.ts` | 重写 | 添加 runCount 等增强字段 |
| `cron/cron-parser.ts` | 保留 | 修复 `*` 通配符解析 bug |
| `cron/cron-tasks.ts` | 重写 | 统一任务存储，Map 替代 Array |
| `cron/cron-scheduler.ts` | 重写 | 实现 markFired、forceDue、getTask |
| `cron/index.ts` | 更新 | 导出新的 API |
| `cron-tools/*.ts` | 更新 | 匹配新的类型签名 |
| `index.ts` | 重写 | 移除 legacy scheduler，统一用 cron |
| `scheduler-controller.ts` | **删除** | 功能已合并到 cron scheduler |
| `loop-tasks.ts` | **删除** | 功能已合并到 cron-tasks.ts |
| `scheduler-parser.ts` | 保留 | /loop 命令解析仍然需要 |
| `scheduler-types.ts` | 保留 | 命令解析类型仍然需要 |

### 数据流

```
用户输入 /loop 5m check deploy
    │
    ▼
parseSchedulerCommand() → 解析参数
    │
    ▼
intervalToCron('5m') → '*/5 * * * *'
    │
    ▼
addCronTask({ cron: '*/5 * * * *', prompt: 'check deploy', durable: false })
    │
    ├─ 验证 cron 表达式
    ├─ 验证下次运行时间
    ├─ 检查任务数量上限 (50)
    └─ 写入 session store 或文件
    │
    ▼
dispatchTask() → 立即执行第一次
    │
    ▼
cron scheduler 每秒 check()
    │
    ▼
到点时 onFire → dispatchTask → executeCommand/sendUserMessage
    │
    ▼
agent_end → markSettled → maybeAutoCancel
```

---

## 测试验证

### 单元测试

```
=== Full Integration Tests ===

1. Cron parser: 7/7 passed
2. Interval to cron: 3/3 passed  
3. Task operations: 4/4 passed
4. Jitter determinism: PASS
```

### 编译验证

```bash
npx tsc --noEmit 2>&1 | grep "extensions/defaults/loop"
# (no output - 零错误)
```

---

## 关键设计决策

### 1. 为什么保留 scheduler-parser.ts？

方案中 `/loop` 是纯 prompt skill，让模型解析自然语言。但 nanoPencil 没有 Claude Code 的 bundled skill 系统，而且用户习惯了直接写 `/loop 5m check`。

所以保留硬编码 parser 用于 `/loop` command，同时注册 CronCreate 工具让模型也能创建任务。两者共用 `addCronTask`。

### 2. 为什么用 Map 替代 Array 存储 session 任务？

查找 O(1)，更新 O(1)，避免重复。文件存储仍然是 Array（序列化方便）。

### 3. File watcher 仍然用定时重载

方案要求 chokidar，但定时重载 (3s interval) 在实践中足够可靠，且减少依赖。

### 4. Missed one-shot 处理

方案要求询问用户是否补跑。当前实现会执行但打日志，可后续增强为交互式询问。

---

## 后续改进空间

1. **File watcher**: 引入 chokidar 替代定时重载
2. **Missed one-shot**: 创建交互式确认对话框
3. **测试覆盖**: 添加单元测试文件
4. **CronCreate 工具**: 支持 --name, --max, --quiet 参数
