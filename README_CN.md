# Catui

![Catui — 你的终端，你的编程伙伴。](assets/readme/header.png)

以终端为主要界面的 AI 编程 Agent，支持项目记忆、persona、可扩展工具和多模型。
使用 TypeScript 与 Node.js 开发，npm 包名为 `catui-agent`。

[English](README.md) · [SDK](docs/sdk.md)

## 开始使用

需要 Node.js 20 或以上版本。

```bash
npm install -g catui-agent
catui
```

通过 `/login` 配置模型提供商，`/model` 选择模型，`/persona` 切换身份与工作风格。
也可以通过环境变量配置凭证；模型可用性取决于配置和账号。
支持 Anthropic、OpenAI、Google、阿里 DashScope/Token Plan 和本地 Ollama 等接入；
具体可用模型取决于配置和账号。

```bash
catui -c                           # 继续上次会话
catui -r                           # 选择历史会话
catui -p "解释这个仓库"             # 单次执行后退出
catui --mode rpc                    # stdio JSON-lines 集成
catui --acp                         # ACP 编辑器集成
catui --serve --host 127.0.0.1      # HTTP/WebSocket 远程控制
catui --help                        # 查看全部参数
```

终端 TUI 是主要入口。仓库也包含远程服务，以及独立的移动端 Web/Capacitor 客户端，
详见[远程模式](docs/remote.md)。根目录构建不会自动构建移动端。

## 当前能力

### 让 Codex 协助当前会话

在 macOS／Linux 上，直接在 Catui 输入 `/bridge start`，首次确认安装连接插件。
然后在 Codex 新开聊天，说“连接我的 Catui 会话，查看进度并帮我验收”。
无需查找扩展路径、填写端口或复制密钥。需要已安装支持插件的 Codex。
连接后，Codex 可发现当前命令及用途，指挥普通任务、Grub、Goal，审核 Plan，
并回答委托的问题。Catui 负责执行，Codex 根据状态、测试和产物验收。
未适配的命令及权限提升仍由本地操作处理，命令目录会明确标注。

`/bridge status` 查看是否已有客户端访问，`/bridge setup` 重试或修复安装，
`/bridge stop` 断开连接。需要持续监工时，再请 Codex 安排定时检查。
详见[连接说明](extensions/optional/session-bridge/README.md)。

### 内置功能

- **工具与会话**：文件读取与编辑、Shell、模型切换、流式响应、历史记录、分支、上下文压缩和 HTML 导出。
- **记忆与身份**：NanoMem 保留项目知识与偏好；persona 定义身份和工作风格。
  **NanoSoul 暂时下线**，不再自动初始化、注入人格或记录交互学习，已有 Soul 数据不删除。
  SDK 中旧的 Soul 参数保留兼容，但不生效。
- **扩展**：内置和用户扩展可注册工具、命令和生命周期钩子；MCP 接入外部工具服务。
  Browser Harness 需要显式启用。
- **工作流**：工程规范技能、规划、子 Agent 与团队、`/goal`、`/grub`、`/loop`、研究及写作技能。
  可通过 `/resources` 查看已加载资源；具体可用能力取决于模式和配置。
- **运行控制**：工具策略、有界恢复、执行轨迹、回放与评估工具，详见[运行轨迹](docs/run-trace-and-replay.md)。

## 默认决策技能

默认启用的 `typesafe` 扩展内置两项技能：

| 技能 | 用途 |
| --- | --- |
| `agent-decision-loop` | 判断下一步需要什么证据，选择工具与参数，检查结果，遇到无进展时调整方法 |
| `typesafe-ai` | 依据上游文档构建 TypeSafe System One 集成，组合类型化判断 |

每个用户回合会附加一段简短的“决策→工具→评估”指引；完整技能按需通过 Skill 工具、
`/skill:agent-decision-loop` 或 `/skill:typesafe-ai` 加载。CLI 各模式和无界面 SDK 都可使用。

日常使用仍调用你配置的模型和已有工具，不需要 TypeSafe 账号，也不会额外调用 TypeSafe API。
开发实际的 TypeSafe 服务集成时才需要对应凭证。技能是行为指导，不代表运行时正确性保证，
也不意味着已经测得模型错误率下降。

原版来自 [typesafe-ai/skills](https://github.com/typesafe-ai/skills)，固定版本并保留 MIT 许可证，
详见[来源记录](extensions/builtin/typesafe/AGENT.md)。`--no-extensions` 关闭目录扩展发现；CLI 显式提供的内置扩展和 `-e` 路径仍会加载。

## 配置与数据

默认配置目录为 `~/.catui/agents/<id>/`，默认 ID 是 `default`。

| 路径 | 用途 |
| --- | --- |
| `auth.json` | 模型提供商凭证 |
| `models.json` | 自定义模型 |
| `settings.json` | 偏好与功能设置 |
| `sessions/` | 会话历史 |
| `extensions/` | 用户扩展 |

`--agent <id>` 选择 Agent，`CATUI_CODING_AGENT_DIR` 可覆盖配置根目录。
更多内联配置见 `/model` 与 `/persona`；SDK 嵌入见 `docs/sdk.md`。
数据在本地持久化不等于所有功能离线：模型提供商、MCP 服务和启用的外部集成可能发送网络请求。

## 本地开发

```bash
npm ci
npm run build
npx tsx cli.ts
```

根 npm workspace 包含三个私有运行库，以及协议和记忆包；`apps/mobile` 使用独立工具链。
`packages/soul-core` 保留为暂停使用的独立源码，不参与根 workspace、应用依赖和构建。

| 目录 | 职责 |
| --- | --- |
| `cli.ts`、`main.ts` | 启动与模式选择 |
| `core/runtime/` | 会话统一入口及按职责拆分的运行时模块 |
| `core/lib/{ai,agent-core,tui}/` | 私有模型、执行循环和终端库 |
| `core/platform/` | 配置、进程与通用基础能力 |
| `modes/` | TUI、Print、RPC、ACP 和远程界面 |
| `extensions/` | 默认及可选产品能力 |
| `packages/{protocol,mem-core}/` | 可发布协议与记忆集成 |
| `test/`、`tests/` | 回归及行为刻画测试 |
| `.dev-docs/`、`llm-wiki/` | 架构决策和生成的代码导航 |

`AgentSession` 保留公开接口；模型切换、生命周期、压缩、队列、事件顺序、运行轨迹、
统计和扩展资源发现由各自模块负责。阅读代码可从[运行时地图](core/runtime/AGENT.md)开始。

改动前遵循 [AGENTS.md](AGENTS.md) 和[功能开发流程](.dev-docs/feature-workflow.md)，运行：

```bash
npm run verify:dip
npm run verify:quality
npm run verify:package-boundary
npm run build
npx tsc --noEmit
npm test
```

定向测试入口见 `package.json`。部分可选集成检查需要凭证或外部服务。
构建与发布是独立操作，发布前阅读[贡献指南](CONTRIBUTING.md)。

## 许可证

[GPL-3.0](LICENSE)。引入的第三方内容保留各自许可证。
