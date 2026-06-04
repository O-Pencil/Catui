# Behavior Review Log

```yaml
doc: behavior-review-log
parent: ./README.md
purpose: |
  第三评审层。结构评审(UI/AS 卡)问"边界对不对";功能验收(feature-inventory)问
  "功能还在不变吗";本日志问"功能本身对不对" —— 主动挖每个核心功能的真实 bug。
  纯搬/抽象会忠实保留 main 既有 bug;抽取该功能时顺带做行为评审,挖出即修(GB-2 声明)。
trigger: 每抽取/触碰一个核心功能时，对它做一次主动行为评审（不只"是否搬动正确"）。
why_needed: |
  P4(agent-session)是纯搬+抽象，从未主动审过行为，因此把 main 既有 bug 原样保留。
  结构正确 ≠ 行为正确。本日志补上这一层，并可回溯（P4 各核心功能待补行为评审）。
```

> 每条 = `现象(phenomenon) → 根因(essence) → 修复(commit, GB-2) → 状态`。
> 行为评审发现的修复是**有意行为变更**，按 GB-2 显式声明，不属于纯搬。

---

## image-pipeline（P5 首刀，2026-06-02/03）

抽取时 + maintainer 实测中挖出 **5 个 main 既有 bug / UX 缺陷**，均已 GB-2 修复：

| # | 现象 | 根因 | 修复 | 状态 |
|---|------|------|------|------|
| B1 | `/new` 后附件栏不清，残留旧图 | `handleClearCommand` 等清了 chat/streaming 却漏了附件 | `clearAttachments()` 接入所有会话切换点 (`2840395`) | ✅ |
| B2 | 单张图时方向键无响应、无法删除 | 旧逻辑只在 `length>1` 才拦截 ↑↓；`selectedIndex` 卡在 -1 → Del 永不触发 | 重设计 `handleAttachmentKeyNavigation`：↑ 进栏/导航/Del (`4e67d7e`) | ✅ |
| B3 | 一轮对话结束后附件栏不清，下次粘贴堆积成第二张 | 仅在 submit 清；"agent 读磁盘文件"路径下附件从未被消费 | `agent_end` 也清附件 (`4e67d7e`) | ✅ |
| B4 | 有文本输入时无法用方向键选附件（含多行） | 进栏判据先用 `isEditorEmpty` 再用 `isEditorSingleLine`，都拒多行 | 终版：`isEditorCursorAtTop`（光标在首视觉行即进栏）；为此给 tui `Editor` 加公共 `isCursorOnFirstVisualLine()`（`Editor.state` 为 private）(`52c982f` → tui 改动) | ✅ |
| B5 | 对话结束栏清空但磁盘路径还在；新粘贴复用旧图文件名 | `clearAttachments`/`takePendingAttachments` 重置 seq→0 但不删盘文件 → 新粘贴复用 `_np_clipboard_image_1.png` | `clearAttachments` 同时删盘文件 (`52c982f`) | ✅ |

> 非代码 bug（记录以备追溯）：图片"未送达模型" → 实为自定义端点/模型不支持视觉；nanoPencil 发送链正确（paste→attachment→userContent→provider image_url）。换支持视觉的端点后正常。

### 交互模型（梳理后定稿）

附件栏在编辑器**上方**。
- **粘贴** → 图入栏（暂存，不阻塞输入）。可继续打字；**发送时随消息带走并清栈**。
- **进栏选择**：**光标在首视觉行**时按 **↑** 进栏，选中最近一张；栏内 ↑/↓ 移动，**越界退栏**（键交还编辑器/历史）。多行文本时 ↑ 先把光标移到首行，再按 ↑ 进栏 —— 不破坏多行编辑。
- **删除**：栏内按 Del/Backspace 删选中。
- **清空**：发送时清 + **一轮对话结束(agent_end)清** + 会话切换清；清栈**同时删盘文件**（避免文件名复用）。
- 实现：经 tui `Editor.isCursorOnFirstVisualLine()`（新增公共方法，考虑软折行）+ context `isEditorCursorAtTop`（带单行回退）。多行已支持，无遗留取舍。

---

## extension-ui 4 host（P5，2026-06-03）

抽取后行为评审。契约 `ExtensionUIContext`（25 方法）= 验收基准。按 [rewrite-acceptance](./rewrite-acceptance.md) 的 **A 契约 + C 内置扩展**：

| host | 性质 | C 测试路径（内置扩展/命令）| A 契约 | 状态 |
|------|------|---------------------------|--------|------|
| **PromptHost** | **重写** | **`interview`（select+input+confirm 一次全走）**；`/apikey`/provider 配置(input)；`/login`(selector)；`/mcp`(input)；`plan`(editor) | select/confirm/input/editor 形状不变 | ⬜ 待 maintainer 跑 |
| PersistentSurfaceRegistry | 纯搬 | `team`/`plan`（setWidget/setStatus/setFooter/setHeader）| setWidget/Footer/Header/Status | ⬜ |
| CustomOverlayHost | 纯搬 | **无内置扩展用 `api.ui.custom`** → 仅 A 契约（代码审已确认逐字搬）| custom（overlay/inline + onHandle）| ✅ A only |
| EditorComponentAdapter | 纯搬 | **无内置扩展用 `setEditorComponent`** → 仅 A 契约（代码审已确认）| setEditorComponent | ✅ A only |

**PromptHost 重点验收项**（重写，最敏感）：
- [ ] 弹 selector/input/confirm/editor → 显示正常；选/输/确认 → 正确 resolve（值回到扩展）。
- [ ] esc / cancel → resolve undefined，**编辑器焦点恢复**（restoreEditorFocusIfPossible）。
- [ ] 弹出时编辑器位被占，关闭后**编辑器壳复原**（remountEditorShell）。
- [ ] 连弹两个 prompt → **单活动槽**（旧的被替换，不叠加）。
- [ ] timeout（扩展设了的话）→ 自动 dismiss。

> `custom`/`setEditorComponent` 无内置消费者：按 rubric，纯搬 + 无 C 路径 → A 契约（faithful 代码审）即验收充分；后续若有 optional 扩展用到再补 C。

## 待补：P4 核心功能回溯行为评审

P4 是纯搬+抽象，以下核心功能**只验过"不变"，未主动审过"对不对"**，建议逐个补行为评审（同上模式）：

- [ ] model set/cycle/restore（ModelController）
- [ ] compaction 手动/自动（CompactionController）
- [ ] session new/switch/fork（SessionLifecycleController）
- [ ] tree 导航 + 分支摘要（SessionTreeController）
- [ ] bash 执行 + 队列（BashRunner）
- [ ] 工具运行时合并/包装（ToolRuntimeController）

> 触发时机：可在各自被再次触碰时做，或集中一轮。发现即修（GB-2），记录于
> `runtime-session-review/behavior-review-log.md`（待建）。
