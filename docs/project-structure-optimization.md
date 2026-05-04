# nanoPencil 项目结构与构建优化方案

## 1. 现状分析与优化动机

随着 nanoPencil 功能的不断丰富，项目在工程化方面面临以下挑战：
- **整包体积膨胀**：由于 `packages/` 下各模块依赖重复打包，以及缺乏有效的 Tree-shaking，发布产物中存在大量冗余代码。
- **构建链路复杂**：依赖手写的 `bundle-deps.js` 进行模块管理，未充分利用现代 Monorepo 工具。
- **边界模糊**：部分核心逻辑（Core）与扩展逻辑（Extensions）界限不清晰，导致核心包过于沉重。
- **模型能力演进**：随着大模型原生能力的增强（如自带规划、自动澄清），部分原有的 Extension 逻辑应回归 Core 或直接通过 Prompt 实现。

---

## 2. 模块化架构重定义：Core vs Extensions

### 2.1 核心层 (The Core) - “生命体征”
Core 仅包含 Agent 运行所必须的最小化闭环：
- **Runtime**: 任务调度、生命周期管理、工具执行引擎。
- **Memory/Soul**: 长期记忆系统与人格演化引擎。
- **Model Registry**: 多模型适配与统一调用接口。
- **Identity & Auth**: 身份管理与 API 密钥安全存储。

### 2.2 扩展层 (The Extensions) - “技能挂件”
Extension 应具备 **“可插拔”** 与 **“自愈性”**：
- **能力回归原则**：若模型原生能力（如 Claude 3.5 的指令遵循）已能覆盖某个 Extension 的逻辑（如：Requirement Interview），则该 Extension 应被标记为弃用，逻辑回归 Core 的 System Prompt。
- **环境依赖隔离**：凡是涉及外部工具依赖（如 `browser`, `mcp`, `export-html`）的功能，必须以 Extension 形式存在。

---

## 3. 构建流程优化：从 Bundle 到 Tree-shaking

### 3.1 引入 npm workspaces
废弃现有的手动拷贝模式，全面接入 `npm workspaces`：
- 统一管理 `packages/` 下的所有子包。
- 解决依赖碎片化问题，确保所有模块共享同一版本的核心依赖（如 `typescript`, `zod`）。

### 3.2 产物精简 (Build Slimming)
- **源码引用映射**：开发环境通过 `tsconfig` 的 `paths` 直接引用源码，确保实时热更新。
- **发布级压缩**：使用 `tsup` 或 `esbuild` 对发布产物进行混淆与压缩，通过 Tree-shaking 剔除未使用的辅助函数和第三方库代码。
- **惰性加载 (Lazy Loading)**：
  - Extensions 的代码不再随 CLI 启动即加载。
  - 只有当用户显式调用对应命令或模型触发相关工具时，才通过 `import()` 动态加载 Extension。

---

## 4. 目录结构调整建议

```markdown
nanoPencil/
├── packages/              # 核心模块 (独立 NPM 包，内部源码引用)
│   ├── agent-core/        # 运行引擎
│   ├── soul-core/         # 灵魂引擎
│   └── ai/                # 模型适配层
├── core/                  # CLI 业务逻辑核心 (瘦身目标：仅保留路由与管理)
├── extensions/            # 扩展目录
│   ├── standard/          # 标准内置扩展 (如 MCP, Soul)
│   └── feature-rich/      # 厚重型扩展 (如 Browser, Teams)
└── dist/                  # 仅包含 Tree-shaking 后的紧凑产物
```

---

## 5. 实施路线图

1. **短期 (Phase 1)**：清理实验代码（已完成），引入 `npm workspaces` 统一依赖。
2. **中期 (Phase 2)**：实施 Extensions 惰性加载，将 `export-html` 等非核心工具从 `core/` 迁移至 `extensions/`。
3. **长期 (Phase 3)**：引入 `tsup` 进行发布产物压缩，大幅降低 NPM 包体积；定期审计 Extension 逻辑，推行“能力回归 Core”计划。
