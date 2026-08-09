# Catui Baseline — Current State

> Source: `/Users/cunyu666/Dev/catui`

## Catui 仓库结构（按特性组织）

```
catui/
├── cli.ts, main.ts, config.ts        # CLI 入口
├── core/                             # 核心业务
│   ├── runtime/                      # Agent runtime
│   │   ├── agent-session.ts          # AgentSession class
│   │   ├── event-bus.ts              # EventEmitter 薄壳 + handler-error 派发
│   │   ├── agent-session-runtime.ts
│   │   └── ...
│   ├── lib/                          # 私有工作区库
│   │   ├── agent-core/
│   │   ├── ai/                       # Provider 实现（16 个）
│   │   └── tui/                      # TUI 包（独立但私有）
│   ├── tools/                        # 8 个工具（bash / read / edit / write / grep / find / ls / source）
│   ├── session/                      # 会话持久化
│   ├── model/                        # 模型管理
│   ├── prompt/                       # 提示工程
│   ├── sub-agent/                    # CC-style Agent tool
│   ├── mcp/                          # MCP 协议
│   ├── extensions-host/              # 扩展系统
│   ├── persona/                      # 人格系统（5 个 bundled）
│   └── ...
├── modes/                            # 运行模式
│   ├── interactive/                  # TUI 模式
│   ├── print/                        # stdout 打印模式
│   ├── rpc/                          # RPC 模式
│   └── acp/                          # ACP 模式
├── extensions/                       # 内置扩展
│   ├── builtin/                      # 一方扩展源（interview / grub / loop / soul / token-save / ...）
│   └── optional/                     # 可选扩展
└── packages/                         # 打包的集成
    ├── protocol/                     # 公共协议契约
    ├── mem-core/                     # 持久记忆
    └── soul-core/                    # 人格引擎
```

## 关键事实

### TUI（pi 对比的核心）

`core/lib/tui/src/tui.ts` 读全文：
- ✅ **差量渲染**——和 pi 同等实现，连 `previousLines / firstChanged / lastChanged` 状态机一致
- ✅ **同步输出** `\x1b[?2026h/l`——且**比 pi 做得更细**：
  - pi：直接 wrap
  - catui：`shouldUseSynchronizedOutput()` 函数 + `SYNC_OUTPUT_BLOCKLIST`（`warpterminal` / `waveterm` 已知会卡 2026）
- ✅ **Overlay 系统**——锚点、百分比、margin、可见回调都和 pi 一致
- ✅ **`CURSOR_MARKER`** + IME 候选窗口定位——和 pi 一致
- ✅ **Kitty 图像协议**——`terminal-image.ts` + `isImageLine`
- ✅ **首帧同步渲染**——`start()` 直接 `doRender()`，pi 用 `process.nextTick`；catui 注释明确说"避免首屏撕裂"
- ✅ **Crash 日志 + `CATUI_STRICT_RENDER` 模式**——超宽行渲染时落地 `~/.catui/agent/catui-crash.log`
- ✅ **Force render 早返回**——和 pi 同样的优化
- ❌ **Overlay Focus Restore 状态机**——catui 只保留"栈顶恢复"，pi 有完整的 `eligible / blocked / inactive` 三态
- ❌ **`OverlayHandle.focus() / unfocus() / isFocused()`**——catui 只有 `hide / setHidden / isHidden`

### Bash / 子进程

`core/tools/bash.ts`：
- `spawn(shell, [...args, command], { stdio: ["ignore", "pipe", "pipe"] })`
- **管子捕获 stdout/stderr**，不直接 inherit TTY
- 因此 **catui 不撞"子进程输出乱掉 TUI frame"的问题** → pi 的 `output-guard.ts` 在 catui **没需求**

### EventBus

`core/runtime/event-bus.ts` 全文（37 行）：
- 和 pi 的 `event-bus.ts` **几乎完全相同**
- **唯一差异**：pi 用 `console.error`，catui 用 `emitter.emit("eventbus:handler-error", ...)`
- catui 的设计**更好**——失败进事件流，外部可订阅

### Provider 覆盖

`core/lib/ai/src/providers/`：
- 16 个：anthropic / openai / openai-codex-responses / google / google-vertex / google-gemini-cli / azure-openai-responses / amazon-bedrock / openai-completions / openai-responses / openai-responses-shared / openai-codex-headers / github-copilot-headers / simple-options / transform-messages / register-builtins

pi 的 provider（来自 `ls`）：40+ 个
- catui 缺：kimi-coding / xiaomi-token-plan-* / zai-coding-cn / moonshotai / groq / cerebras / deepseek / fireworks / huggingface / nvidia / openrouter / vercel-ai-gateway / xai / opencode 等

### Persona

5 个 bundled：pencil / aria / lucy / rem / vex（加上 2026-07-01 新增的 sage）

### Skills

`extensions/builtin/discipline/skills/` 下 11 个：domain-modeling / interview / writing-plans / systematic-debugging / test-driven-development / executing-plans / receiving-code-review / handoff / using-git-worktrees / finishing-development-branch / requesting-code-review

## 总结

**catui 不是"需要从 pi 大量迁移"的子项目**——它的 TUI 实现已经和 pi 持平甚至更优。**只有 Overlay 焦点管理这一处有真实差距**。