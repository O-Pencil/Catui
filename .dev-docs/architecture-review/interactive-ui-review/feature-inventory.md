# interactive-mode 功能特性清单 v1

```yaml
doc: feature-inventory
version: v1     # 代码扫全 + 5 主观项已定(含扩展验收 = A 契约 + C 内置手测)；UI01 blocker 解除
parent: ./README.md
purpose: |
  P5 的验收基准（功能验收，非 characterization）+ 维护者特性目录。
  重构后逐条确认「功能正确」，不比对实现。完整度 = 验收强度（UI01 核心风险）。
source_of_truth: modes/interactive/interactive-mode.ts @ 7960 行（拆前快照）
legend:
  owner: 拟拆入的 controller（见 P5 §现状摸底簇表 / gates.md Single-Owner）
  verify: 重构后确认列（⬜ 待验 / ✅ 通过 / ✗ 回归 / ⚠️ 有意变更-已声明）
```

> **怎么用**：每条 = `触发 → 预期行为(验收标准)`。重构后按"触发"复现，确认"预期"成立即 ✅。
> 有意改了行为/符号 → 标 ⚠️ 并在对应 review 卡/Phase 写明（GB-2），不算回归。
> **v0 是反推骨架，maintainer 需校全**（漏列 = 该功能无保护）。

---

## A. Slash 命令（33 条，owner: slash-dispatcher 除非另注）

| 命令 | 触发 | 预期行为(验收标准) | owner | verify |
|------|------|-------------------|-------|--------|
| `/model [term]` | 输入 | 打开模型选择 overlay；带 term 则预过滤 | model-overlay | ⬜ |
| `/scoped-models` | 输入 | 打开 scoped-models 选择器 | model-overlay | ⬜ |
| `/thinking [lvl]` | 输入 | 切换/设置 thinking level | model-overlay | ⬜ |
| `/agent-loop` | 输入 | 切换 agent loop framework | slash-dispatcher | ⬜ |
| `/settings` | 输入 | 打开设置选择器 | settings-overlay/mount | ⬜ |
| `/apikey` | 输入 | 进入 API key 录入流 | auth | ⬜ |
| `/login [provider]` | 输入 | OAuth 登录（带 provider 直登，否则选择器）| auth | ⬜ |
| `/logout` | 输入 | OAuth 登出选择器 | auth | ⬜ |
| `/mcp [args]` | 输入 | 列/启停 MCP server | slash-dispatcher（经 facade，UI03）| ⬜ |
| `/export [path]` | 输入 | 导出会话 HTML | slash-dispatcher | ⬜ |
| `/share` | 输入 | 上传/生成分享链接 | slash-dispatcher | ⬜ |
| `/copy` | 输入 | 复制最后 assistant 文本 | slash-dispatcher | ⬜ |
| `/status` | 输入 | 显示会话/系统状态 | slash-dispatcher | ⬜ |
| `/usage` | 输入 | 显示 token/费用用量 | slash-dispatcher | ⬜ |
| `/name [text]` | 输入 | 设会话名 | slash-dispatcher | ⬜ |
| `/session` | 输入 | 会话信息/操作 | slash-dispatcher | ⬜ |
| `/resume` | 输入 | 打开会话恢复选择器 | tree-overlay | ⬜ |
| `/new` | 输入 | 新建会话（清空）| tree-overlay/lifecycle | ⬜ |
| `/fork` | 输入 | 从用户消息分叉 | tree-overlay | ⬜ |
| `/tree` | 输入 | 打开分支树选择器 | tree-overlay | ⬜ |
| `/changelog` | 输入 | 显示变更日志 | slash-dispatcher | ⬜ |
| `/hotkeys` | 输入 | 显示键位表 | slash-dispatcher | ⬜ |
| `/resources` | 输入 | 显示已加载资源(扩展/技能/主题) | slash-dispatcher | ⬜ |
| `/reload` | 输入 | 重载配置/资源 | slash-dispatcher（runtime reload）| ⬜ |
| `/compact [instr]` | 输入 | 手动压缩上下文(可带指令) | slash-dispatcher（经 AgentSession）| ⬜ |
| `/soul` | 输入 | 显示 soul 状态 | slash-dispatcher | ⬜ |
| `/persona [text]` | 输入 | 切换/显示 persona | slash-dispatcher | ⬜ |
| `/memory` | 输入 | 显示 memory 状态 | slash-dispatcher | ⬜ |
| `/language [lang]` | 输入 | 切换界面语言 | slash-dispatcher | ⬜ |
| `/update` | 输入 | 检查并更新版本 | self-update | ⬜ |
| `/reinstall` | 输入 | 重装 | self-update | ⬜ |
| `/quit` | 输入 | 退出 | _shell/cancellation | ⬜ |
| `/arminsayshi` | 输入 | 彩蛋 | slash-dispatcher | ⬜ |

> 另：扩展注册的 `/command` 经 `isExtensionCommand` 路由到 ExtensionRunner（owner: extension-ui + slash-dispatcher 协作，统一 dispatch 表是 F02/UI02 的 seam 目标）。bash 模式（`!` 前缀）由 `handleBashCommand` 处理（owner: slash-dispatcher）。

---

## B. 键位动作（22 个 AppAction，owner 见注）

| 动作 | 默认键 | 预期行为 | owner | verify |
|------|--------|---------|-------|--------|
| interrupt | `esc` | 中断当前 agent 运行；双击 esc 可触发 tree/配置动作 | _shell/cancellation | ⬜ |
| clear | `ctrl+c` | 清空/退出确认（双击退出）| _shell/cancellation | ⬜ |
| exit | `ctrl+d` | 退出 | _shell/cancellation | ⬜ |
| suspend | `ctrl+z` | 挂起进程 | _shell/cancellation | ⬜ |
| showResources | `ctrl+h` | 显示已加载资源 | slash-dispatcher | ⬜ |
| cycleThinkingLevel | `shift+tab` | 循环 thinking level | model-overlay | ⬜ |
| cycleModelForward | `ctrl+p` | 下一个模型 | model-overlay | ⬜ |
| cycleModelBackward | `shift+ctrl+p` | 上一个模型 | model-overlay | ⬜ |
| selectModel | `ctrl+l` | 打开模型选择器 | model-overlay | ⬜ |
| selectProviderThenModel | `ctrl+shift+l` | provider→模型选择 | model-overlay | ⬜ |
| expandTools | `ctrl+o` | 展开/折叠工具输出 | mount(render) | ⬜ |
| toggleThinking | `ctrl+t` | 显隐 thinking block | mount(render) | ⬜ |
| toggleSessionNamedFilter | `ctrl+n` | 切换会话命名过滤 | tree-overlay | ⬜ |
| externalEditor | `ctrl+g` | 打开外部编辑器 | mount | ⬜ |
| followUp | `alt+enter` | 追加 follow-up 消息 | mount(queue) | ⬜ |
| dequeue | `alt+up` | 取回排队消息 | mount(queue) | ⬜ |
| pasteImage | `ctrl+v` | 粘贴剪贴板图像 | image-pipeline | ⬜ |
| newSession | (无默认) | 新建会话 | tree-overlay/lifecycle | ⬜ |
| tree | (无默认) | 分支树 | tree-overlay | ⬜ |
| fork | (无默认) | 分叉 | tree-overlay | ⬜ |
| resume | (无默认) | 恢复会话 | tree-overlay | ⬜ |
| 附件导航 | 方向键(附件态) | 在附件条上移动/删除 | image-pipeline | ⬜ |

### B-editor. 编辑器层键位（EditorAction，39 个 — 多数属 TUI 库，非 P5 范围）

> `@pencil-agent/tui` 的 `EditorComponent` 自带 39 个 `EditorAction`（光标/删除/选择/翻页/undo/yank…）。
> **绝大多数是纯文本编辑，owner = tui 库，P5 不动、不验收**。只有下面几个与 interactive-mode 行为交叉，需纳入验收：

| EditorAction | 默认键 | 预期 | owner | verify |
|------|--------|------|-------|--------|
| submit | `enter` | 触发输入提交管线（→ F 表）| input-submit | ⬜ |
| newLine | `shift+enter` | 多行换行(不提交) | tui/editor | ⬜ |
| expandTools | `ctrl+o` | 展开工具输出（与 AppAction 同名，确认单一路径）| mount(render) | ⬜ |
| toggleSessionPath | `ctrl+p`(选择器内) | session 选择器:切路径显示 | tree-overlay | ⬜ |
| toggleSessionSort | `ctrl+s`(选择器内) | session 选择器:切排序 | tree-overlay | ⬜ |
| renameSession | `ctrl+r`(选择器内) | session 选择器:重命名 | tree-overlay | ⬜ |
| deleteSession / ...Noninvasive | `ctrl+d`/`ctrl+backspace`(选择器内) | session 选择器:删除 | tree-overlay | ⬜ |
| selectConfirm / selectCancel | `enter` / `esc`,`ctrl+c` | overlay 确认/取消导航 | 各 overlay controller | ⬜ |

> 其余 30 个(cursor*/delete*/page*/copy/yank/undo/jump*)= 纯编辑器,不列入 P5 验收。

---

## C. Overlay / 选择器（owner 见注）

| Overlay | 触发 | 预期行为 | owner | verify |
|---------|------|---------|-------|--------|
| 模型选择器 | `/model` `ctrl+l` | 列模型、选中切换 | model-overlay | ⬜ |
| provider→模型 | `ctrl+shift+l` | 先选 provider 再选模型 | model-overlay | ⬜ |
| scoped-models | `/scoped-models` | 多模型作用域配置 | model-overlay | ⬜ |
| 设置选择器 | `/settings` | 设置项浏览/修改 | settings-overlay/mount | ⬜ |
| 会话恢复选择器 | `/resume` | 列历史会话、恢复 | tree-overlay | ⬜ |
| 分支树选择器 | `/tree` | 树导航、选叶子 | tree-overlay | ⬜ |
| 用户消息选择器 | `/fork` | 选分叉点 | tree-overlay | ⬜ |
| OAuth 选择器 | `/login` `/logout` | 选 provider 登录/登出 | auth | ⬜ |
| 登录对话框 | login 流 | 输入凭据/OAuth 跳转 | auth | ⬜ |
| Provider 配置 | 模型选择或 provider 选择触发 | API key/base URL/custom model 配置归 auth/provider-config；model-overlay 只在配置成功后切换模型并写默认模型，取消配置不得切换或持久化默认模型 | auth/provider-config + model-overlay | ⬜ |
| 更新选项 | `/update` | 选更新方式 | self-update | ⬜ |
| 重试选项 | 更新失败 | 重试/放弃 | self-update | ⬜ |
| 扩展选择器/输入/编辑器/确认/通知/错误 | 扩展 API | 扩展驱动的 prompt/overlay 表面；select/input/editor 为单活动 prompt，custom overlay 保留 handle 语义，notify 不进入 overlay stack | extension-ui | ⬜ |

---

## D. 流式渲染特性（handleEvent，13 事件，owner: mount/render — UI04 deferred）

> **验收粒度(已定)**：本轮 P5 **不动** handleEvent(UI04 deferred)，故 D 用**粗粒度功能验收**——每事件确认"渲染发生且形态对"(如 message_update 增量刷文本、tool_execution_end 出可展开结果)，**不做逐帧/逐态字节比对**。
> 逐态精验(工具展开↔折叠、thinking 显隐、loader 帧)**推迟到 UI04 真正重写 render 层时**再做；那时这些事件才是被改对象，才需要细粒度验收。本轮它们是"保持不变"的旁观者，粗验足够。

| 事件 | 预期渲染 | verify |
|------|---------|--------|
| agent_start | 起 loading/working 动画 + 计时 | ⬜ |
| message_start | 起 streaming assistant 组件 | ⬜ |
| message_update | 增量刷 assistant 文本/thinking/toolCall | ⬜ |
| message_end | 定稿 assistant 消息 | ⬜ |
| tool_execution_start | 起工具执行组件 | ⬜ |
| tool_execution_update | 刷工具进度 | ⬜ |
| tool_execution_end | 定稿工具结果(可展开) | ⬜ |
| agent_end | 停动画/计时，回到 idle | ⬜ |
| auto_compaction_start/end | 压缩 loader + 排队消息提示 | ⬜ |
| auto_retry_start/end | 重试 loader + esc 处理 | ⬜ |

---

## E. 其它特性（owner 见注）

| 特性 | 触发 | 预期 | owner | verify |
|------|------|------|-------|--------|
| 附件/图像管线 | 粘贴/拖入/`ctrl+v` | 加入附件条、随消息发送 | image-pipeline | ⬜ |
| 文本中图像提取 | 含路径文本 | 解析为附件 | image-pipeline | ⬜ |
| 自动补全 | 输入 `/` `@` 等 | 候选提示 | mount(setupAutocomplete) | ⬜ |
| 消息排队/取回 | 运行中输入 | 排队、agent 结束后处理 | mount(queue) | ⬜ |
| 启动版本检查 | 启动 | 后台检查、有新版提示 | self-update | ⬜ |
| buddy pet | 状态变化 | 宠物动画随状态 | mount(buddyPet) | ⬜ |
| 扩展 widget/footer/header | 扩展 API | 注入区域渲染 | extension-ui | ⬜ |
| 会话导航 banner | switch/fork/tree | 顶部提示 | tree-overlay | ⬜ |
| 启动横幅/资源加载展示 | 启动/`/resources` | 欢迎+诊断 | mount | ⬜ |

---

## F. 输入提交管线（owner: `input-submit-controller`（UI06）；slash-dispatcher 只处理内置 `/command` dispatch）

| 特性 | 触发 | 预期 | owner | verify |
|------|------|------|-------|--------|
| 内置 slash 优先处理 | 输入 `/model` 等内置命令 | 命中内置命令后不继续走普通消息提交 | slash-dispatcher + input-submit | ⬜ |
| 嵌入式 persona | 输入 `文本 /persona ...` | 执行 persona 切换，并把前置文本继续作为用户消息提交 | input-submit/persona | ⬜ |
| bash 命令 | 输入 `!cmd` | 执行 bash，不作为普通消息；运行中已有 bash 时保留 editor 文本并提示 | input-submit/bash | ⬜ |
| bash 排除上下文 | 输入 `!!cmd` | 执行 bash 且标记 excludeFromContext | input-submit/bash | ⬜ |
| compaction 期间输入 | compaction 运行中输入普通文本 | 普通文本进入 compaction queue；extension command 仍立即执行 | input-submit/queue | ⬜ |
| streaming steer | agent streaming 时输入文本 | 先乐观渲染用户消息，再以 steer 行为提交 | input-submit/queue | ⬜ |
| streaming 附件 | streaming 时带附件/图片路径输入 | 处理图片；模型不支持图片时丢弃并提示 | input-submit + image-pipeline | ⬜ |
| 普通附件提交 | idle 时带附件/图片路径输入 | 图片进入消息内容；提交后清空附件条并清理临时文件 | input-submit + image-pipeline | ⬜ |
| 外部输入回调 | `onInputCallback` 存在时提交 | 调用 callback，不走 agent prompt | mount/input-submit | ⬜ |
| 提交失败回滚 | 普通消息 prompt 抛错 | 移除对应 optimistic user message 并显示错误 | input-submit/render | ⬜ |

> **⚠️ 已发现冗余坏味(给 slash 重写的证据)**：`/memory`、`/arminsayshi`、`/resume`、`/quit` 在 `executeBuiltinSlashCommand`(L165-180) **和** submit handler(L2808-2827)**两处都有分支**。submit handler 先调 `executeBuiltinSlashCommand` 并在命中时 return(L2782-2784)，故后者那 4 个分支**大概率是不可达死分支**。**slash 重写(UI02)须消除该重复**，验收时确认这 4 条仍只走一条路径(dispatch 表)、行为不变。

---

## 代码已扫全 vs 待 maintainer 主观判断

**v0.5 已从代码确定**（无需你逐行翻 7960 行）：
- ✅ A 的 33 条 = `executeBuiltinSlashCommand` 全分支(标准命令集完整;扩展命令走 `isExtensionCommand`)
- ✅ B 的 22 个 AppAction + B-editor 的相关 EditorAction(其余 30 个纯编辑器已排除)
- ✅ F 的 submit 管线 = `setupEditorSubmitHandler` 实读(persona 嵌入/bash/compaction queue/steer/附件/回滚)
- ✅ 冗余坏味(4 条命令双处理)已标

**已定（2026-06-02）**：

- [x] **per-feature hybrid 决策**：不逐条标，**继承 owner 簇**的决策（见 [refactor-plan §纯搬 vs 重写](./refactor-plan.md)）。
- [x] **D 渲染验收粒度**：本轮**粗粒度功能验收**；逐态精验推迟到 UI04（见 D 段说明）。
- [x] **input-submit 单独立卡**：→ [UI06](./findings/UI06-input-submit-pipeline.md)，抽 `input-submit-controller`；UI07 增补 `settings-overlay-controller` 后 controller 集 = 9。
- [x] **双击 esc / esc 分派归属**：`onEscape` 是单键多目标分派 —— **mount 接线**(判状态后转发)，分支委托 owner(abort→cancellation、空闲双击→tree-overlay、queue 恢复→queue)。见 [gates.md esc 键分派行](./gates.md)。

**仍需你拍板（第 4 点，给你 3 选 1）—— 扩展动态命令/键位/widget 怎么验收**：

| 选项 | 做法 | 优 | 劣 |
|------|------|----|----|
| **A 契约验收(推荐)** | 验 `ExtensionUIContext` **契约**:host 能正确路由"任意注册的命令/widget/overlay",测分派机制而非具体扩展 | 与装了啥扩展无关、稳定、可复现 | 不验具体扩展的端到端 |
| **B fixture 扩展** | 造一个最小**测试扩展**,注册已知 `/cmd` + widget + prompt,对它验收 | 端到端、隔离、可复现 | 要维护 fixture |
| **C 内置扩展手测** | 对随包的内置扩展(interview/loop/plan/team/security-audit/soul…)逐个手跑,确认其命令+UI | 验真实扩展 | 不可自动化、依赖人 |

> **已定:A + C**(2026-06-02)—— A 验"分派契约不破"(自动、稳)+ C 对真实内置扩展(interview/loop/plan/team/security-audit/soul…)手测兜底;B(fixture)等以后要自动化回归再上。

> 校全后此表即 P5 验收门 + 维护者特性目录；每抽一个 controller，回填该 owner 名下功能的 verify 列。
