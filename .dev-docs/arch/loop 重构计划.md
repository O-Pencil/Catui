# `/loop` 命令重构计划

> 基于 Claude Code v2.1.88 逆向分析文档的重构方案
> 日期：2026-04-18

## 当前状态分析

### 现有实现

Catui 当前已经有工作的 loop 实现：

- **核心文件**：
  - `extensions/defaults/loop/index.ts` (363行) - 主扩展逻辑
  - `scheduler-controller.ts` (155行) - 任务控制器
  - `scheduler-parser.ts` (246行) - 命令解析器
  - `scheduler-types.ts` (49行) - 类型定义

- **已支持功能**：
  - 定时调度（s/m/h/d间隔）
  - 暂停/恢复/取消/运行
  - maxRuns自动取消
  - quiet模式
  - 命名任务
  - session-scoped（会话关闭清除）
  - slash command和prompt支持

### 架构对比

| 特性 | Claude Code (文档) | Catui 当前 | 差距 |
|------|-------------------|-----------------|------|
| 任务存储 | session + durable 文件 | 仅 session | ❌ 缺少持久化 |
| 多进程支持 | scheduler lock | 无 | ❌ 缺少锁机制 |
| 调度器设计 | 独立cronScheduler | 集成在扩展中 | ⚠️ 架构不同 |
| jitter机制 | 有 | 无 | ❌ 缺少流量控制 |
| 参数解析 | prompt-based (skill) | 直接解析 | ⚠️ 设计哲学不同 |
| teammate支持 | agentId路由 | 无 | ❌ 缺少多Agent支持 |
| 自动过期 | 7天recurring过期 | maxRuns | ⚠️ 机制不同 |

## 重构目标

### 阶段一：核心功能补全（必须）

#### 目标1.1：添加 durable 持久化存储

**当前问题**：
- loop任务只保存在内存中，会话关闭后丢失
- 无法跨session保持loop任务

**实施方案**：
1. 创建 `loop-tasks.ts` 文件存储模块
2. 在项目目录创建 `.catui/loop-tasks.json`
3. 支持 `--durable` 或 `-d` flag
4. 任务启动时自动恢复durable任务

**文件变更**：
- 新建 `extensions/defaults/loop/loop-tasks.ts`
- 修改 `scheduler-types.ts` 增加 `durable` 字段
- 修改 `scheduler-controller.ts` 支持durable读写
- 修改 `index.ts` 在session_start时恢复durable任务

#### 目标1.2：添加 scheduler lock

**当前问题**：
- 多个Catui实例共享项目目录时，可能重复触发任务
- durable任务需要确保只被一个实例执行

**实施方案**：
1. 使用 `proper-lockfile` 包（已存在依赖）
2. 创建 `.catui/loop-scheduler.lock`
3. 调度器启动时获取锁
4. 失败时降级为非owner模式（不触发durable任务）

**文件变更**：
- 修改 `scheduler-controller.ts` 增加锁管理
- 修改 `index.ts` 启动时获取锁

### 阶段二：架构优化（推荐）

#### 目标2.1：独立调度器模块

**当前问题**：
- 调度逻辑混合在扩展代码中
- 难以独立测试和复用

**实施方案**：
1. 提取 `loop-scheduler.ts` 独立调度器
2. 使用回调接口（`onFire`, `isLoading`等）
3. 支持外部测试和mock

**文件变更**：
- 新建 `extensions/defaults/loop/loop-scheduler.ts`
- 修改 `scheduler-controller.ts` 瘦身为数据管理器
- 修改 `index.ts` 使用独立调度器

#### 目标2.2：添加 jitter 机制

**当前问题**：
- 所有任务都在整点触发
- 可能造成流量尖峰

**实施方案**：
1. 为每个任务添加确定性jitter
2. 基于taskId计算jitter值
3. 避免流量尖峰

**文件变更**：
- 修改 `scheduler-controller.ts` 计算jitter
- 修改 `loop-tasks.ts` 保存jitter偏移

### 阶段三：高级特性（可选）

#### 目标3.1：teammate 路由支持

**实施方案**：
- 增加任务的 `agentId` 字段
- 集成 subagent/team 扩展路由逻辑

#### 目标3.2：自动过期机制

**实施方案**：
- recurring任务默认7天后自动删除
- 在 `markDispatched` 中检查过期时间

## 重构步骤

### 第一阶段：durable 持久化

#### 步骤1.1：创建 loop-tasks.ts

```typescript
// extensions/defaults/loop/loop-tasks.ts
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";

const LOOP_TASKS_FILE = ".catui/loop-tasks.json";

export async function readLoopTasks(projectRoot: string): Promise<ScheduledLoopTask[]> {
  // 实现读取逻辑，处理文件不存在、JSON错误等
}

export async function writeLoopTasks(projectRoot: string, tasks: ScheduledLoopTask[]): Promise<void> {
  // 实现写入逻辑，创建目录，原子写入
}

export async function addDurableLoopTask(
  projectRoot: string,
  task: ScheduledLoopTask,
): Promise<string> {
  // 实现添加durable任务
}
```

#### 步骤1.2：修改类型定义

```typescript
// scheduler-types.ts
export interface ScheduledLoopTask {
  // 现有字段...
  durable?: boolean;  // 新增
  agentId?: string;   // 为teammate预留
}
```

#### 步骤1.3：修改 controller 支持durable

```typescript
// scheduler-controller.ts
export class SchedulerController {
  private projectRoot?: string;

  setProjectRoot(root: string): void {
    this.projectRoot = root;
  }

  async loadDurableTasks(): Promise<void> {
    // 从文件加载durable任务
  }

  async saveDurableTasks(): Promise<void> {
    // 保存durable任务到文件
  }
}
```

#### 步骤1.4：修改扩展初始化

```typescript
// index.ts
api.on("session_start", async () => {
  if (ctx.projectRoot) {
    controller.setProjectRoot(ctx.projectRoot);
    await controller.loadDurableTasks();
  }
  ensureSchedulerTicker(api, bus);
});
```

### 第二阶段：scheduler lock

#### 步骤2.1：添加锁管理

```typescript
// scheduler-controller.ts
import lockfile from "proper-lockfile";

export class SchedulerController {
  private lock?: lockfile.Lock;

  async acquireSchedulerLock(): Promise<boolean> {
    try {
      this.lock = await lockfile.lock(this.getLockPath());
      return true;
    } catch {
      return false;
    }
  }

  releaseSchedulerLock(): void {
    if (this.lock) {
      lockfile.unlock(this.lock);
      this.lock = undefined;
    }
  }
}
```

#### 步骤2.2：修改调度逻辑

```typescript
// 只有lock owner才触发durable任务
if (isDurableTask(task) && !isLockOwner) {
  return; // 跳过
}
```

### 第三阶段：独立调度器（可选）

#### 步骤3.1：提取调度器

```typescript
// loop-scheduler.ts
export interface LoopSchedulerOptions {
  onFire: (task: ScheduledLoopTask) => void;
  isLoading: () => boolean;
  isKilled?: () => boolean;
}

export function createLoopScheduler(options: LoopSchedulerOptions): LoopScheduler {
  // 独立的调度器实现
}
```

## 验证计划

### 功能测试

1. **durable持久化**
   - 创建durable任务，关闭会话，重新打开，任务仍在
   - 多个会话共享同一目录，只有一个会话触发任务

2. **scheduler lock**
   - 启动两个Catui实例，观察任务执行情况
   - 只有lock owner触发durable任务

3. **向后兼容**
   - 现有session-only任务不受影响
   - 命令接口保持不变

### 性能测试

1. **文件IO性能**
   - 50个durable任务的读写性能
   - 频繁调度的性能影响

2. **并发安全**
   - 多进程同时创建任务
   - 文件损坏恢复能力

## 风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| 文件IO阻塞主线程 | 使用异步API，限制文件大小 |
| 锁机制死锁 | 设置锁超时，提供手动清理 |
| 文件损坏 | 容错读取，备份机制 |
| 向后兼容性 | 保留现有接口，增量添加 |

## 交付标准

- [x] durable任务支持完成，测试通过
- [x] scheduler lock实现，测试通过
- [x] auto-expiry自动过期实现，测试通过
- [x] 向后兼容，现有功能不受影响
- [x] 文档更新（README.md）
- [x] 单元测试通过（5个测试全部通过）
- [x] 使用示例文档
- [ ] 手动集成测试

## 时间估算

- 阶段一（核心功能）：2-3天
- 阶段二（架构优化）：1-2天
- 阶段三（高级特性）：按需

## 优先级建议

**建议执行顺序**：
1. **必须**：阶段一.1（durable持久化）- 解决主要痛点
2. **强烈推荐**：阶段一.2（scheduler lock）- 保证多进程安全
3. **可选**：阶段二（架构优化）- 提升代码质量
4. **未来考虑**：阶段三（高级特性）- 根据实际需求

## 结论

当前Catui的loop实现已经具备基本功能，主要缺失的是：

1. **持久化存储** - 用户最常要求的功能
2. **多进程安全** - 生产环境必需

建议优先实现这两个核心功能，其他优化可以根据实际使用情况逐步迭代。