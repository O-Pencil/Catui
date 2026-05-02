# nanoPencil 启动性能优化方案

> 文档版本: 2026-05-02
> 状态: 基础设施已完成，待评审后继续 MCP 延迟初始化

---

## 一、目标与原则

### 目标
将冷启动时间从 **~1800ms** 降低到 **<1500ms**（减少 15%+）

### 原则
1. **数据驱动** - 用 benchmark 量化效果，不用主观感受
2. **回归测试** - 任何优化必须通过 benchmark 验证
3. **快速见效优先** - 先做投入产出比高的优化

---

## 二、当前启动流程分析

### 2.1 启动阶段划分（已有 checkpoint）

```
┌─────────────────────────────────────────────────────────────────────┐
│ main_entry (865ms)                                                  │
│   ├── parseArgs() 解析参数                                          │
│   ├── runMigrations() 迁移                                          │
│   └── after_migrations                                             │
│                                                                     │
│   settings_manager_ready (887ms)                                   │
│   ├── SettingsManager.create() 文件 I/O + 锁                        │
│   └── auth_storage_created                                          │
│                                                                     │
│   nanopencil_defaults_ensured (889ms)                               │
│   └── ensureNanopencilDefaultConfig()                              │
│                                                                     │
│   model_registry_created (910ms)                                    │
│   └── ModelRegistry 初始化 (38ms)                                   │
│                                                                     │
│   before_resource_loader_create                                     │
│   └── DefaultResourceLoader 构造                                    │
│                                                                     │
│   resource_loader_reload (1748ms) ← 🔥 优化重点                     │
│   ├── PackageManager.resolve() npm 包扫描                           │
│   ├── loadExtensions() jiti 动态编译扩展                            │
│   └── extensions_loaded                                             │
│                                                                     │
│   before_args_parse_2                                              │
│   args_parsed_2                                                    │
│   cwd_resolved                                                      │
│                                                                     │
│   before_create_agent_session                                      │
│   agent_session_created                                             │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 耗时分布（实测数据）

| 阶段 | 平均耗时 | 占比 | 优化空间 |
|------|---------|------|---------|
| **resource_loader_reload** | ~840ms | **47%** | 🔥 高 |
| model_registry_created | ~40ms | 2% | 中 |
| settings_manager_ready | ~2ms | 0.1% | 低 |
| 其他阶段 | <10ms | <1% | 低 |

### 2.3 瓶颈分析

#### 1. resource_loader_reload (~840ms)
**耗时来源**:
- `PackageManager.resolve()` - npm 包路径解析
- `loadExtensions()` - jiti 动态编译 TypeScript 扩展
- 文件系统 I/O - 读取扩展、主题、提示词模板

**优化方向**:
- [ ] MCP 延迟初始化（不启动服务器直到需要）
- [ ] 扩展懒加载（非交互模式不需要的扩展延迟）
- [ ] Extension 预编译缓存（jiti 结果缓存）

#### 2. model_registry_created (~40ms)
**耗时来源**:
- JSON 解析 models.json
- API key 验证

**优化方向**:
- [ ] 模型信息缓存
- [ ] 延迟验证 API key（首次调用时）

---

## 三、已完成的改动

### 3.1 基础设施（已提交）

#### A. startup-profiler.ts 增强
```typescript
// 新增 API
export function getProfileReport(): ProfileReport      // 生成结构化报告
export async function exportProfile(filePath)          // 导出 JSON
export function compareProfiles(baseline, current)     // 检测回归
```

#### B. benchmark 脚本
```bash
npm run benchmark           # 运行 5 次，显示结果
npm run benchmark:save      # 保存当前为 baseline
npm run benchmark:compare    # 与 baseline 对比
```

#### C. Checkpoint 标记（main.ts）
新增 13 个检查点，覆盖完整启动流程

### 3.2 改动文件列表

```
modified:   utils/startup-profiler.ts  (+161 行)
new file:   scripts/startup-benchmark.cjs (+262 行)
modified:   main.ts                    (+13 行 checkpoint)
modified:   package.json               (+3 行 scripts)
modified:   .gitignore                 (+2 行 .benchmarks/)
```

---

## 四、待实施优化方案

### Phase 1: MCP 延迟初始化（预计收益: 200-400ms）

#### 问题分析
当前启动时同步初始化所有 MCP 服务器：
```typescript
// core/runtime/sdk.ts
await currentMcpManager.initialize();  // 同步启动所有
```

#### 解决方案
MCP 服务器按需启动，首次调用工具时才初始化：
```typescript
// 新增 lazy mode
mcpManager.setLazyMode(true);
// 服务器在首次调用工具时才启动
```

#### 预期效果
- 跳过不使用的 MCP 服务器初始化
- 减少启动时间 200-400ms（取决于配置了多少服务器）

#### 改动文件
- `core/mcp/mcp-client.ts` - 添加延迟初始化逻辑
- `core/runtime/sdk.ts` - 默认启用 lazy mode

---

### Phase 2: 扩展懒加载（预计收益: 100-300ms）

#### 问题分析
启动时加载所有扩展，不管是否需要：
```typescript
// main.ts
await resourceLoader.reload();  // 同步加载所有
```

#### 解决方案
非交互模式不需要的扩展延迟加载：
```typescript
// 启动时只加载必要扩展
await resourceLoader.reload({ 
  lazy: ['team', 'soul', 'browser']  // 这些延迟到首次使用
});
```

#### 预期效果
- 跳过不使用的扩展初始化
- 减少启动时间 100-300ms

---

### Phase 3: Extension 预编译缓存（预计收益: 200-500ms）

#### 问题分析
jiti 每次启动都重新编译 TypeScript 扩展

#### 解决方案
1. 构建时生成扩展的预编译缓存
2. 启动时优先加载缓存，fallback 到 jiti

```typescript
// core/extensions/loader.ts
const cachePath = getExtensionCachePath(extPath);
if (existsSync(cachePath)) {
  return import(cachePath);  // 直接加载，~10ms
}
// Fallback to jiti，~200-500ms
return jiti.import(extPath);
```

#### 预期效果
- 减少扩展加载时间 200-500ms
- 缓存命中率 > 80% 时收益最大

---

## 五、验证方法

### 5.1 Benchmark 命令

```bash
# 1. 建立 baseline
npm run benchmark:save

# 2. 做优化后运行
npm run benchmark:compare

# 3. 输出示例
🚀 Running startup benchmark (5 runs)...
  Run 1/5... ✓ 1750ms (checkpoints: 13)
  ...

📈 Comparison with Baseline
──────────────────────────────────────────────────
  Baseline avg:    1809ms
  Current avg:     1750ms
  Difference:      -59ms (-3.3%)

✅ No regressions detected!
```

### 5.2 回归判定

- 任何阶段耗时增加 > 10% 且 > 10ms → 回归
- 总耗时增加 > 10% → 回归

---

## 六、实施计划

```
Week 1: Phase 1 - MCP 延迟初始化
├── 评审方案 ← 当前节点
├── 实现延迟初始化
├── Benchmark 验证
└── 提交 PR

Week 2-3: Phase 2 - 扩展懒加载
├── 设计懒加载策略
├── 实现 ResourceLoader 懒加载
├── Benchmark 验证
└── 提交 PR

Week 4-5: Phase 3 - 预编译缓存（可选）
├── 设计缓存机制
├── 实现 Jiti 缓存
├── Benchmark 验证
└── 提交 PR
```

---

## 七、风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| 延迟加载导致首次使用慢 | 使用预热机制，在空闲时提前加载 |
| 缓存失效导致行为不一致 | 缓存加版本号，版本变化时清除 |
| Benchmark 不稳定 | 运行 5 次取中位数，std_dev < 10% |

---

## 八、附录

### A. Benchmark 输出格式

```json
{
  "timestamp": "2026-05-02T08:34:09.667Z",
  "runs": 5,
  "wallTime": { "avg": 1809, "min": 1790, "max": 1825, "stdDev": 15 },
  "checkpoints": [
    { "name": "main_entry", "avgMs": 880, "minMs": 870, "maxMs": 890 }
  ],
  "phases": [
    { "name": "resource_loader_reload", "avgMs": 843, "pct": 47 }
  ]
}
```

### B. 相关文件路径

```
utils/startup-profiler.ts    - 性能打点
scripts/startup-benchmark.cjs - Benchmark 脚本
main.ts                       - 启动入口，checkpoint 标记位置
core/mcp/mcp-client.ts        - MCP 客户端
core/runtime/sdk.ts           - SDK 工厂
core/config/resource-loader.ts - 资源加载器
```

### C. 环境要求

- Node.js >= 20
- 至少 5 次连续运行无显著波动（std_dev < 10%）
