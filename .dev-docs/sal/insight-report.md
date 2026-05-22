# NanoMem Insight 洞察报告

> 版本：v1.0  
> 最后更新：2026-03-19  
> 作者：Word

---

## 🎯 概述

**Insight 洞察报告** 是 NanoMem 记忆系统的智能分析功能，通过聚合你的会话历史、工具使用、文件修改、错误模式等数据，生成可视化的 HTML 报告，帮助你：

- 📊 **了解使用模式** - 哪些工具最常用？哪些语言写得最多？
- 🏆 **发现胜利时刻** - 成功解决了哪些问题？
- ⚠️ **识别摩擦点** - 哪些错误反复出现？
- 👤 **开发者画像** - LLM 生成你的编码风格分析
- 💡 **功能建议** - 基于使用模式的改进建议

---

## 🚀 快速开始

### 方式一：独立 CLI

```bash
# 生成完整洞察报告（默认输出到 ./nanomem-insights.html）
nanomem insights

# 指定输出路径
nanomem insights --output ./my-report.html

# 简单模式（仅规则聚合，不使用 LLM）
nanomem insights --simple

# 简单模式 + 自定义输出
nanomem insights --simple --output ./simple-report.html
```

### 方式二：NanoPencil 扩展命令

在 NanoPencil 交互界面中：

```
/mem-insights
```

或指定输出路径：

```
/mem-insights ./reports/insights.html
```

---

## 📊 报告内容

### 1️⃣ 概览统计 (At a Glance)

```
┌─────────────────────────────────────────┐
│  NanoMem Insights Report                │
├─────────────────────────────────────────┤
│  总会话数：42                           │
│  记忆条目：156                          │
│  最后更新：2026-03-19 14:30             │
└─────────────────────────────────────────┘
```

**包含指标：**
- 总会话数 (totalSessions)
- 知识条目数 (knowledge)
- 经验教训数 (lessons)
- 用户偏好数 (preferences)
- 工作条目数 (work)
- 会话片段数 (episodes)
- 综合洞察数 (facets)

---

### 2️⃣ 使用图表 (Charts)

#### 工具使用 TOP10
```
read      ████████████████████  45 次
edit      ███████████████       32 次
bash      ███████████           18 次
grep      ████████              12 次
write     ██████                8 次
find      ████                  5 次
...
```

#### 编程语言分布 TOP8
```
TypeScript   ████████████████████  28 个文件
JSON         ██████████            12 个文件
Markdown     ███████               8 个文件
YAML         ████                  5 个文件
Shell        ██                    3 个文件
...
```

#### 错误类型 TOP8
```
TypeScript 编译错误：TS2345     8 次
命令执行失败：npm install       5 次
文件未找到：ENOENT              3 次
...
```

---

### 3️⃣ 项目领域 (Project Areas)

按项目聚合的进度和目标：

```
┌─────────────────────────────────────────┐
│  nanoPencil                             │
├─────────────────────────────────────────┤
│  会话数：28                             │
│  进度：重构核心模块，迁移 Soul 到扩展层   │
│  目标：完成 P1-P3 优先级任务             │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│  my-web-app                             │
├─────────────────────────────────────────┤
│  会话数：14                             │
│  进度：实现用户认证系统                  │
│  目标：完成 JWT 中间件和测试             │
└─────────────────────────────────────────┘
```

---

### 4️⃣ 胜利与摩擦 (Wins & Friction)

#### 🏆 胜利时刻 (Wins)
已成功解决的问题：
- ✅ JWT 认证中间件实现
- ✅ API 路径配置优化
- ✅ 工具管理器缓存机制
- ✅ Monorepo 结构迁移

#### ⚠️ 摩擦点 (Friction)
重复出现的困难：
- ⚠️ TypeScript 类型推断失败（出现 5 次）
- ⚠️ 测试覆盖率不足（出现 3 次）
- ⚠️ 依赖版本冲突（出现 2 次）

---

### 5️⃣ 开发者画像 (Developer Persona) 🤖

**仅完整模式可用**（需要 LLM）

#### 编码风格分析
```
- 代码冗长度：偏低（倾向简洁表达）
- 抽象层级：中等（平衡可读性和复用性）
- 安全边际：偏高（重视边界检查）
- 探索欲望：中等（稳健优先）
```

#### 人话版总结
```
你是一位注重效率的 TypeScript 开发者，偏好函数式编程风格。
在 42 次会话中，你最常用的是 read 和 edit 工具，说明你倾向于
先理解现有代码再进行修改。你遇到的主要挑战是 TypeScript 复杂
类型推断，但都能通过查阅文档解决。

你的工作模式：先阅读 → 小步修改 → 运行测试 → 迭代优化
```

#### 根因分析
```
问题：TypeScript 类型推断失败反复出现

根因：
1. 泛型约束不够明确
2. 联合类型分支处理不完整
3. 缺少显式类型注解

建议：
- 为复杂泛型添加 extends 约束
- 使用类型守卫处理联合类型
- 在关键位置添加显式类型注解
```

---

### 6️⃣ 功能建议 (Features to Try)

基于你的使用模式：

```
💡 你频繁使用 grep 和 find → 试试语义搜索功能
💡 你经常遇到类型错误 → 启用 /thinking high 模式
💡 你在多个项目间切换 → 试试项目标签过滤
💡 你很少使用 MCP 工具 → 探索数据库和浏览器集成
```

---

## 🔧 技术细节

### 两种模式对比

| 特性 | 简单模式 (`--simple`) | 完整模式 (默认) |
|------|---------------------|----------------|
| LLM 生成 | ❌ 不使用 | ✅ 使用 |
| 开发者画像 | ❌ 无 | ✅ 有 |
| 根因分析 | ❌ 无 | ✅ 有 |
| 人话总结 | ❌ 无 | ✅ 有 |
| 生成速度 | ⚡ 快 | 🐢 较慢 |
| 适用场景 | 快速查看统计 | 深度洞察 |

### 数据来源

Insight 报告聚合以下数据：

```typescript
interface ExportAllResult {
  knowledge: MemoryEntry[];    // 项目知识
  lessons: MemoryEntry[];      // 经验教训
  preferences: MemoryEntry[];  // 用户偏好
  facets: MemoryEntry[];       // 综合洞察（模式/困难）
  work: WorkEntry[];          // 工作目标
  episodes: Episode[];        // 会话片段
  meta: {
    totalSessions: number;
    lastConsolidation?: string;
    version: number;
  };
}
```

### 核心模块

```
packages/mem-core/src/
├── full-insights.ts        # 完整报告聚合 + LLM 叙事
├── human-insights.ts       # 开发者画像 + 人话洞察
├── full-insights-html.ts   # HTML 渲染器（完整版）
├── insights-html.ts        # HTML 渲染器（简化版）
├── extension.ts            # NanoPencil 扩展集成
└── cli.ts                  # 独立 CLI 入口
```

---

## 📝 使用示例

### 示例 1：生成报告并用浏览器打开

```bash
nanomem insights --output ./insights.html
open ./insights.html    # macOS
xdg-open ./insights.html # Linux
start ./insights.html    # Windows
```

### 示例 2：定期生成周报

```bash
# 每周五下午 5 点生成周报
0 17 * * 5 cd ~/projects/my-app && nanomem insights --output ./reports/week-$(date +%Y%m%d).html
```

### 示例 3：在 NanoPencil 会话中查看

```
你：/mem-insights ./reports/march.html

AI: ✅ NanoMem: Generating full insights report...
    ✅ Insights report written to: ./reports/march.html
    
    已生成 3 月洞察报告：
    - 总会话：42 次
    - 主要工具：read (45 次), edit (32 次)
    - 主要语言：TypeScript (28 个文件)
    - 开发者画像：效率优先，函数式风格
    
    用浏览器打开报告查看完整分析 → file://$(pwd)/reports/march.html
```

---

## ⚙️ 配置选项

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `NANOMEM_LOCALE` | 报告语言 | `zh-CN` |
| `NANOMEM_CONFIG_DIR` | 配置目录 | `~/.nanopencil/agent/memory` |

### 本地配置

在 `~/.nanopencil/agent/settings.json` 中：

```json
{
  "nanomem": {
    "insights": {
      "defaultOutput": "./reports/insights.html",
      "enableLLM": true,
      "locale": "zh-CN"
    }
  }
}
```

---

## ❓ 常见问题

### Q: 为什么完整模式很慢？
**A:** 完整模式会调用 LLM 生成开发者画像和根因分析，需要网络请求。可以使用 `--simple` 模式跳过 LLM 部分。

### Q: 报告是空白的怎么办？
**A:** 检查是否有会话数据：
```bash
nanomem stats
```
如果会话数为 0，说明还没有记忆数据。正常使用 NanoPencil 后会自动积累。

### Q: 如何删除旧数据重新生成？
**A:** 清除记忆目录：
```bash
rm -rf ~/.nanopencil/agent/memory/*
```

### Q: 可以自定义报告样式吗？
**A:** 可以修改 `full-insights-html.ts` 中的 HTML 模板和 CSS 样式。

### Q: 支持导出其他格式吗？
**A:** 目前仅支持 HTML。可以通过 `nanomem export` 导出 JSON 后自行处理。

---

## 🔗 相关文档

- [记忆系统.md](记忆系统.md) - NanoMem 整体架构
- [结构.md](结构.md) - 项目结构概览
- [纳诺记忆读写.md](纳诺记忆读写.md) - 记忆读写 API

---

**最后更新:** 2026-03-19  
**维护者:** Word @ nanoPencil Team
