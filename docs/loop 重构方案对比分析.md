# `/loop` 重构方案 vs 当前实现对比分析

> 生成时间: 2026-04-18
> 方案文档: `docs/loop 重构方案.md` (基于 Claude Code v2.1.88 反编译)
> 当前实现: `extensions/defaults/loop/` (已按方案改造)

---

## 改造进度

### 已完成 (2026-04-18)

- ✅ 创建 cron 核心模块 (`cron/` 目录)
  - `cron-types.ts` - CronTask 类型定义
  - `cron-parser.ts` - 标准 5-field cron 解析、interval 转 cron、jitter 计算
  - `cron-tasks.ts` - 统一任务存储（session-only + durable 文件）
  - `cron-scheduler.ts` - 独立调度器（非 React，支持 lock + file watch）
  - `index.ts` - cron 模块公共 API

- ✅ 创建 Cron 工具链 (`cron-tools/` 目录)
  - `cron-create-tool.ts` - CronCreate 工具
  - `cron-delete-tool.ts` - CronDelete 工具
  - `cron-list-tool.ts` - CronList 工具

- ✅ 创建 `/loop` skill (`skill/SKILL.md`)
  - 符合 nanoPencil skill 规范
  - 包含 interval 转 cron 规则
  - 包含 CronCreate 使用指南

- ✅ 修改 `index.ts` 入口
  - 注册 CronCreate/CronDelete/CronList 工具
  - 接入独立 cron scheduler
  - 保留现有增强功能（--name, --max, --quiet, pause/resume）
  - `/loop` command 内部使用 cron 工具链创建任务

- ✅ 编译通过，构建成功

### 待完成

- ⚠️ File watcher 当前使用简单的定时重载替代 chokidar
- ⚠️ 缺少自动化测试
- ⚠️ 模型直接调用 CronCreate 的路径需要验证

---

## 逐层对比

### 1. 架构设计

| 维度 | 重构方案 | 改造后实现 | 状态 |
|------|---------|-----------|------|
| `/loop` 本质 | prompt skill + cron tools | extension command + cron tools | ⚠️ 部分一致 |
| Cron 工具链 | CronCreate/Delete/List | ✅ CronCreate/Delete/List | ✅ 已实现 |
| 独立调度器 | cronScheduler | ✅ createCronScheduler | ✅ 已实现 |
| 任务存储 | cronTasks.ts | ✅ cron-tasks.ts | ✅ 已实现 |
| Jitter | 确定性 jitter | ✅ deterministicJitter | ✅ 已实现 |
| Scheduler Lock | proper-lockfile | ✅ proper-lockfile | ✅ 已实现 |
| File Watcher | chokidar | ⚠️ 定时重载 | ⚠️ 简化实现 |
| `/loop` skill | bundled skill | ✅ SKILL.md | ✅ 已实现 |

### 2. 关键差异说明

**保留差异（有意为之）**：
1. `/loop` 仍是 extension command 而非 pure prompt skill
   - 原因：nanoPencil 没有 Claude Code 的 bundled skill 注册系统
   - 替代方案：创建了 SKILL.md 让模型了解如何使用 CronCreate
   - 好处：保留 --name, --max, --quiet, pause/resume 等增强功能

2. File Watcher 使用定时重载替代 chokidar
   - 原因：减少依赖，简化实现
   - 影响：文件变化感知延迟从即时变为 5 秒

**已消除的差异**：
1. ✅ 创建了独立的 cron 核心模块
2. ✅ 创建了 CronCreate/Delete/List 工具
3. ✅ 创建了独立调度器
4. ✅ 实现了 jitter 防流量尖峰
5. ✅ 实现了 scheduler lock 防多进程重复
6. ✅ 实现了 7 天自动过期

---

## 文件清单

### 新增文件

| 文件 | 说明 |
|------|------|
| `extensions/defaults/loop/cron/cron-types.ts` | CronTask 等类型定义 |
| `extensions/defaults/loop/cron/cron-parser.ts` | Cron 解析器 + interval 转换 + jitter |
| `extensions/defaults/loop/cron/cron-tasks.ts` | 统一任务存储（session + durable） |
| `extensions/defaults/loop/cron/cron-scheduler.ts` | 独立 cron 调度器 |
| `extensions/defaults/loop/cron/index.ts` | Cron 模块公共 API |
| `extensions/defaults/loop/cron-tools/cron-create-tool.ts` | CronCreate 工具 |
| `extensions/defaults/loop/cron-tools/cron-delete-tool.ts` | CronDelete 工具 |
| `extensions/defaults/loop/cron-tools/cron-list-tool.ts` | CronList 工具 |
| `extensions/defaults/loop/cron-tools/index.ts` | Cron 工具导出 |
| `extensions/defaults/loop/skill/SKILL.md` | `/loop` skill 文档 |

### 修改文件

| 文件 | 说明 |
|------|------|
| `extensions/defaults/loop/index.ts` | 注册 cron 工具 + 接入新 scheduler |

### 保留不变（增强功能）

| 文件 | 说明 |
|------|------|
| `scheduler-types.ts` | 增强功能类型定义 |
| `scheduler-parser.ts` | 增强功能命令解析 |
| `scheduler-controller.ts` | 增强功能调度控制 |
| `loop-tasks.ts` | 增强功能持久化存储 |

---

## 总结

改造后的 `/loop` 命令现在：
1. **遵循方案的核心架构**：有独立的 cron 核心模块、工具链、调度器
2. **保留增强功能**：--name, --max, --quiet, pause/resume 等超出方案的功能
3. **编译通过**：所有 TypeScript 类型检查通过
4. **构建成功**：npm run build 无错误

主要妥协：
- `/loop` 仍是 command 而非纯 prompt skill（受限于 nanoPencil 架构）
- File watcher 使用简化实现（定时重载替代 chokidar）
- 缺少自动化测试（方案有完整的测试清单）
