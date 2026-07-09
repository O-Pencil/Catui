# Handoff: bash pre-execution approval gate

```yaml
handoff_id: bash-pre-execution-approval-handoff
status: not-started   # 本会话未启动实质代码工作；目标超 budget 被中断
created_at: 2026-07-05
session_ended_at: 2026-07-05
goal_token_budget: 50K
goal_token_used: 177K   # 远超，session budget_limited
```

## TL;DR — 下一会话接手时先看这段

**前置 context**：用户最早报告 `npx create-x` / `npm init` 等交互式命令在 TUI 里"看上去永远卡住、不知道里面在干啥"。session 里做了 3 件事：

1. **Layer 1**（已落地 main，commit `1f1b2b5`）:`core/tools/bash.ts` 把 `stdio[0]` 从 `'ignore'` 改成 `'pipe'` + 加 30s stdin grace timer。**解决了"永远 hang"，但没解决"看不到提示"和"无法回答 y/N"**。
2. **复盘 + ADR reopen**（已落地 main）:`.dev-docs/architecture-review/bash-stdin-pipe-decision/ADR.md` status 改 `implemented-but-reopened`，标了 reopen reason 和 reference hermes-agent。
3. **本 ADR（Layer 2 + 3）**：本会话**未启动**——开了个空目录，goal 设了，5 个任务建了，但**没写一行代码**。

**下一会话接手要做**：建新 ADR `bash-pre-execution-approval-decision` + 落地 DANGEROUS_PATTERNS + TUI 选择器（hermes-agent 风格）。

---

## 知识保留（不能丢，要交给下一会话）

### 1. 诊断锁定

**`core/tools/bash.ts:130` 改前 stdio 配置**：`["ignore", "pipe", "pipe"]`

- **修复前**：read -p 立即 EOF + 报错
- **Layer 1 修复后**：read -p 等 30s 后 stdin.end() + exit=1（**已用 `test-real-bash-debug.mjs` 验证 30087ms**）
- **用户实际看到的**：模型根据输出推断"立即 EOF"，但实际 30s 干等，体验差
- **后续要做的**：**不能让用户干等 30s**——必须在 spawn 前拦截（hermes 路径）

### 2. hermes-agent 关键参考

参考模板在 `D:/Projects/Pencil/Template-github/hermes-agent`：

| 文件 | 行号 | 是什么 | nanoPencil 要照搬什么 |
|------|------|--------|-------------------|
| `hermes_cli/callbacks.py:186-241` | `approval_callback(cli, command, description) -> str` | TUI 选择器 + 60s 超时 → 默认 deny | ✅ 选 5 选项 + view |
| `tools/approval.py:498+` | `DANGEROUS_PATTERNS` 列表 (~60 正则) | 危险命令分类（rm -rf / sudo / dd / SQL DROP / curl\|sh 等）| ✅ 选子集（npx / npm install -g / ssh / Git Bash 专属） |
| `hermes_cli/cli_commands_mixin.py:1629` | `set_approval_callback(self._approval_callback)` | 把 callback 注册到 agent | ✅ 经 ExtensionContext 加 `setApprovalDecision` |
| 失败处理 `callbacks.py:239-241` | 无 callback → `return "deny"` | 默认 deny（fail-closed）| ✅ 严格 |

**关键设计原则（hermes）：**

- **不是 stdin-time bridge**——是 **pre-execution gate**
- **fail-closed**（默认 deny）
- **session persistence**（"always" 选项写入 config）
- **serialization**（`_approval_lock` 防止并发子代理同时弹选择器）
- **长命令 view 选项**（>70 字加 view）

### 3. nanoPencil 已有可复用的 surface API（避免造新 API）

按 ADR `../bash-stdin-pipe-decision/ADR.md` 列出：

| API | 在哪 | 能做什么 |
|-----|------|---------|
| `ExtensionUIContext.confirm(title, message, opts)` | `core/extensions-host/types.ts:131` | 已经能做"y/N"二选一弹框 |
| `ExtensionUIContext.select(title, options, opts)` | `core/extensions-host/types.ts:128` | 多选弹框，**这就是 TUI 选择器原型** |
| `ExtensionUIContext.notify(message, type)` | `core/extensions-host/types.ts:139` | 显示信息（可放"命令被拦截"提示）|
| `ctx.api.on('tool_execution_start', handler)` | runner hooks | 在 tool 执行前 hook——**这是拦截点** |

**关键洞察**：`tool_execution_start` 是 pre-execution 的事件，但**已经 spawn 了**——需要在更早一层拦。nanoPencil 当前 bash tool 没有"execute approval"事件，必须**新建一个 `tool_execution_approval` 事件**或在 bash.ts 内部拦。

### 4. nanoPencil **当前没有的危险模式 baseline**

按 hermes 的 DANGEROUS_PATTERNS 拆出 nanoPencil 应有子集：

```
1. 删除类：rm -r / rm -rf / rm -f / cmd del / PowerShell Remove-Item
2. 权限类：chmod 777 / chmod -R 777 / chown -R root
3. 磁盘类：dd if= / mkfs / > /dev/sd
4. 系统类：systemctl stop/restart / kill -9 -1 / pkill -9 / killall -KILL
5. SQL 类：SQL DROP / SQL DELETE FROM without WHERE / SQL TRUNCATE
6. 网络类：curl | bash / wget | sh / eval $(curl ...) / shell -c
7. shell-injection：python -e / perl -e / ruby -e / node -e
8. fork bomb：:(){ :|:& };:
9. 加固 npm/npx（这是用户痛点）：npm install -g / npx create-* / npm uninstall -g
10. git 危险推送：git push -f origin main / git push --force-with-lease
```

**注意**：hermes 列表里有 ~60 条，nanoPencil 可选 ~20-30 条——**砍掉 SSH/SQL/PowerShell 专属**（用户环境用 Git Bash 为主），**保留通用项**。

### 5. 上次会话里已经勘察过的代码位置

| 文件 | 行号 | 内容 |
|------|------|------|
| `modes/interactive/interactive-mode.ts:2140` | `createExtensionUIContext().setWorkingMessage` | ExtensionUIContext 注入点 |
| `modes/interactive/controllers/stream-render-controller.ts:336` | `case "tool_execution_start"` | tool start 事件处理 |
| `core/tools/bash.ts:130` | `stdio: ["ignore", "pipe", "pipe"]` | **已修复为 `["pipe", "pipe", "pipe"]` + 30s timer** |
| `core/tools/bash.ts:262` | `createBashTool(cwd, options?)` | bash tool 工厂 |
| `core/extensions-host/types.ts:115-141` | ExtensionUIContext 完整接口 | ✅ 有 `confirm` 和 `select` |
| `core/extensions-host/runner.ts:189` | setWorkingMessage stub（run 模式）| 给 mcp/persistence 留接口用 |
| `tests/presence-opening.test.ts:129-246` | mock setWorkingMessage 用例 | 给新 callback 提供 mock 样式参考 |

### 6. 实施顺序（已建的 5 个任务）

```
#19 建 ADR bash-pre-execution-approval-decision
  ↓ 产出 .dev-docs/architecture-review/bash-pre-execution-approval-decision/ADR.md
#20 在 bash tool 加危险模式识别
  ↓ 改 core/tools/bash.ts: 加 DANGEROUS_PATTERNS + 检测方法
#21 TUI 选择器组件
  ↓ 改 modes/interactive/components/ 新建 approval-selector.ts
  + 改 core/extensions-host/types.ts: 加 setApprovalDecision 接口
#22 接入 bash tool spawn 前 hook
  ↓ 在 bash.ts: 检查危险模式 → 弹选择器 → once/always → 继续；deny → 取消
#23 写 ADR + 回归 + 五道门
  ↓ scripts/_scratch/bash-approval-regression.mjs
  ↓ npm run verify:all
```

### 7. 验收门 + 复杂度预算

| 指标 | 限 |
|------|---|
| 单文件行数 | < 800 |
| 新文件数 | < 8 |
| ADR 文件 | 1 |
| P2 AGENT.md 更新 | 2（core/tools/, modes/interactive/components/）|
| P3 头 | 每个新 .ts 加 |
| 五道门 | verify:dip / verify:quality / verify:package-boundary / build / tsc --noEmit |
| 真实回归 | (1) 危险命令弹选择器 (2) 非危险 fast-path 不弹 (3) once → 立即执行 (4) deny → 不执行 (5) always → 写 config 但本会话不实现 (6) 60s 超时 → 默认 deny |

---

## 下一会话起步清单

下一会话里第一件事（**不要重做**）：

```bash
# 1. 看一眼现有 commit 是否还在 main
cd D:/Projects/Pencil/nanoPencil
git log --oneline -3
# 应该看到 1f1b2b5 fix(bash-tool): keep stdin pipe with 30s grace timer

# 2. 看 ADR reopened 状态
head -15 .dev-docs/architecture-review/bash-stdin-pipe-decision/ADR.md
# 应该看到 status: implemented-but-reopened

# 3. 看空 ADR 目录
ls .dev-docs/architecture-review/bash-pre-execution-approval-decision/
# 应该看到 HANDOFF.md（本文件）

# 4. 看任务清单是否还在（如果 dispatcher 用同一 agent）
# 5 个任务，状态 pending，因为本会话未启动
```

**然后开新 worktree**（按 `using-git-worktrees` skill）：

```bash
git worktree add -b feature/bash-approval-gate .worktrees/bash-approval-gate HEAD
cd .worktrees/bash-approval-gate
```

走 #19 → #20 → #21 → #22 → #23 顺序。

---

## 不要重复犯错的提示

下次会话别再：

1. **别再把 stdin timer 当作"完成"**——它是兜底，不是修复
2. **别再用 grep 找匹配项**——你有可能误把"出现字符串"当成"功能存在"
3. **别再写完代码立刻宣称"完成"**——按 feature-workflow §5 跑五道门 + 真实回归
4. **别再过度乐观**——代码改对 ≠ 用户问题解了（30s timer 改对了，但你看不到 ≠ 你修好了）

---

## 资源清单（接手时直接打开）

- ADR reopened: `.dev-docs/architecture-review/bash-stdin-pipe-decision/ADR.md`
- 本 handoff: `.dev-docs/architecture-review/bash-pre-execution-approval-decision/HANDOFF.md`
- Layer 1 修复: `core/tools/bash.ts:130-180` (stdio + stdinTimer)
- Layer 1 复现脚本: `scripts/_scratch/interactive-bash-repro/compare.mjs`
- Layer 1 真实回归: `scripts/_scratch/test-real-bash-debug.mjs`
- Layer 1 创建的沙盒: `scripts/_scratch/bash-stdin-regression.mjs`
- hermes-agent 参考: `D:/Projects/Pencil/Template-github/hermes-agent/`
  - `hermes_cli/callbacks.py:186-241` （approval_callback）
  - `tools/approval.py:498+` （DANGEROUS_PATTERNS）
  - `hermes_cli/cli_commands_mixin.py:1591-1736` （set_approval_callback 注册）

---

*本 handoff 由上一会话（goal 超 budget）记录，目标是为下一会话提供完整接手起点。任何新会话开局只需读本文件即可恢复完整 context。*
