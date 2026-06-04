# P5 — UI god 拆（B3）

```yaml
phase: P5
macro_stage: B        # 功能级
batch: B3
status: recon          # 摸底完成(2026-06-02)；interactive-ui-review 已建，待 feature-inventory v1 后开拆
risk: medium-high
depends_on: [P4]       # ★ 改串行：P4 runtime 契约稳定后再拆 UI（P4 已 completed 2026-06-02）
blocks: [P6]
findings: [F02, F05-partial]
seams: []
gate: gates.md#门组-b
```

## 目标

拆分 `interactive-mode.ts`（~7958 行）为 controllers + state + mount 入口；P5 **接受重写**，以功能特性清单证明功能正确，而非用 characterization 钉死实现。

> **顶层校准**：P5 的终态不是"把一个大文件机械切片后继续维护同一个 mode god object"。按 [mode-architecture-calibration.md](../interactive-ui-review/mode-architecture-calibration.md) 执行：`InteractiveMode` 收敛为 **TUI adapter + composition root**；shared capability 通过 ports/services 组合，P5 默认不引 `BaseMode` 继承。

## 进入条件

- [ ] [P2 DoD](./P2-cycles-gate.md#验证门控dod) 全过
- [ ] [interactive-ui-review/feature-inventory.md](../interactive-ui-review/feature-inventory.md) 从 v0 校全到 v1（P5 的功能验收基准）
- [ ] [P4 DoD](./P4-runtime-split.md#验证门控dod) 全过（串行：runtime 契约稳定后再拆 UI）

## 任务清单

> 经 [interactive-ui-review](../interactive-ui-review/README.md) 摸底，controller 集从 F02 初稿的 5 个修正为 **9 个 + state 容器**（UI02/UI06/UI07）。其中 slash-dispatcher 已完成 dispatch-table 重写，但 controller 物理抽取仍待做。

- [ ] `modes/_shell/cancellation.ts` 抽出（Q7：只抽 cancellation，跨 mode；esc 分派接线留 mount）
- [ ] `modes/interactive/controllers/`：**9 个 controller**
  - slash-dispatcher（限内置 `/command` dispatch；dispatch table 已完成，controller 抽取待做）/ model-overlay（UI08：只拥有 interactive TUI model-selection workflow，可复用 model capability 继续归 runtime `model-controller` / `AgentSession`，provider 配置只经 port 消费）/ auth + provider-config / settings-overlay（UI07）/ tree-overlay（UI05 改名）/ image-pipeline / **extension-ui**（UI02）/ **self-update**（UI02，P5 先 interactive 内拆）/ **input-submit**（UI06，slash/image 之后抽）
- [ ] 每个切片先按 [mode-architecture-calibration.md](../interactive-ui-review/mode-architecture-calibration.md) 分类：shared capability / interactive controller / interactive surface host / composition wiring / render layer
- [ ] `modes/interactive/state/`：UI 状态合一（~80 字段）
- [ ] `interactive-mode.ts` → mount 入口（**< 500 行为 post-UI04 + input-submit 目标**；第一轮 `handleEvent`(336) + submit handler(~246) 仍留 mount，达不到 500）
- [ ] **F05** 步骤 4-5：扩展类型 UI / commands 部分

## 现状摸底（2026-06-02）

`interactive-mode.ts` = **单一 `InteractiveMode` class，7960 行 / 182 方法 / ~80 个 `this._` 响应式状态字段 / import 头 199 行横跨 18 个 core 内部**。比 `agent-session.ts`（拆前 3550）大 2.2×，是仓库最大非生成 TS 文件。不能盲拆；按下方簇逐个抽、逐个 tsc + V5-1 功能验收。

### 方法簇 → 目标模块（含对 F02 5-controller 计划的偏差）

| 目标模块 | 方法簇（代表，行号）| 自带状态 | 对计划 |
|---------|--------------------|---------|--------|
| **slash-dispatcher.ts** | `executeBuiltinSlashCommand`(3021 调度表) + 各 `handle*Command`(thinking/agentLoop/export/share/copy/status/usage/name/session/changelog/hotkeys/clear/renderDebug/showResources/soul/persona/memory/mcp/language/bash/compact) + `isExtensionCommand` + 彩蛋(armin/daxnuts) | skillCommands | 计划内；dispatch table 已完成，controller 抽取待做 |
| **model-overlay-controller.ts** | interactive TUI model-selection workflow：`cycleThinkingLevel`/`cycleModel`/`handleModelCommand`/`show{Model,Models,ProviderThenModel}Selector`/`showModelsSelector`/`findExactModelMatch`/`getModelCandidates`；实际 model/thinking mutation 继续委托 `AgentSession`/runtime `model-controller`；调用 auth/provider-config 能力确保选中模型可用；**不含 `showSettingsSelector`** | — | 计划内；UI08 约束：第二消费者能力不归 model-overlay |
| **auth-controller.ts / provider-config-controller.ts** | `handleApiKeyCommand`/`getStoredApiKey`/`promptForProviderApiKey`/`handleLoginCommand`/`handleProviderCredentialsCommand`/`showOAuthSelector`/`getLoginSelectorProviders`/`showLoginDialog` + provider 配置簇(`ensureProviderConfigured`/`configureCustomProtocolProvider`/`refreshCurrentModelForProvider`/`resolveProviderId`) | — | 计划内；provider 凭据/连接配置归此，model-overlay 只消费 |
| **settings-overlay-controller.ts** | `showSettingsSelector` + `SettingsSelectorComponent` callbacks（theme/image/buddy/presence/editor appearance/session flags）| — | UI07 新增；不归 model-overlay |
| **session-tree-controller.ts**(UI) | `showUserMessageSelector`/`showTreeSelector`/`showSessionSelector`/`handleResumeSession`/`addSessionNavigationBanner` | — | 计划内（注意与 P4 的 runtime `session-tree-controller` 同名不同层）|
| **image-pipeline-controller.ts** | `handleClipboardImagePaste`/`loadClipboardImageIntoAttachments`/`updateAttachmentsBar`/`deleteAttachment`/`handleAttachmentKeyNavigation`/`processAttachmentFiles`/`extractImagesFromText`/`cleanup{Stale,}Clipboard{Files,Images}` | clipboardImageFiles/clipboardPastePromise/attachments/selectedAttachmentIndex | 计划内 |
| **★ extension-ui-controller.ts** | ~32 方法:`initExtensions`/`setupExtensionShortcuts`/`set/clearExtensionWidget(s)`/`render{Widgets,WidgetContainer}`/`setExtension{Status,Footer,Header}`/`create ExtensionUIContext`/`show/hide/dismissExtension{Selector,Input,Editor,Confirm,Notify,Custom,Error}`/`setCustomEditorComponent`/`hasActiveExtensionPrompt`/`restoreEditorFocusIfPossible` | extensionSelector/Input/Editor + widgetsAbove/Below + terminalInputUnsubscribers | **★ 计划外** — 比多数计划 controller 还大，必须独立 owner |
| **★ self-update-controller.ts** | `checkForNewVersion`/`showNewVersionNotification`/`handleUpdateCommand`/`showUpdateOptions`/`handleReinstallCommand`/`performUpdate`/`showRetryOptions`/`waitForKeyPress`/`restartNanoPencil`/`compareVersion`/`checkAutoUpdateOnStartup` + 顶层 `spawnNpm` | — | **★ 计划外** — P5 先在 interactive 内部拆出 controller；只有出现第二个 mode 消费者时再上移 `modes/_shell`，不落 `core/platform` |
| **_shell/cancellation.ts** | `handleCtrlC`/`handleCtrlD`/`handleCtrlZ`/`checkShutdownRequested` + `shutdown` 的信号部分 | lastSigintTime/lastEscapeTime/shutdownRequested | 计划内（Q7：仅抽 cancellation 跨 mode）|
| **state/interactive-state.ts** | ~80 字段合一:streaming(component/message/customStream)、tools(pendingTools/expanded)、bash(isBashMode/component/pending)、queues(compaction/optimistic)、timers、buddyPet、header/footer 槽 | （状态容器）| 计划内 |
| **保留在 mount(interactive-mode.ts)** | `constructor`/`init`/`run`/`stop`/`setup{Autocomplete,KeyHandlers,EditorSubmitHandler}`/`subscribeToAgent`/**`handleEvent`(3259，单方法 336 行=流式渲染核心)**/`addMessageToChat`/`render{SessionContext,InitialMessages}`/`rebuildChatFromMessages`/working-message+timer 簇/buddyPet 簇/path-format 簇 | UI 根容器引用 | 组合根 |

### 摸底发现（待开 interactive-ui-review 立卡）

| # | 发现 | 影响 |
|---|------|------|
| **UI-1** | **功能特性清单完整度是命门** | P5 接受重写，不用 characterization 钉死实现；V5-1 以 `feature-inventory.md` 逐条验收功能正确。风险从"缺少 golden"转为"清单漏列即无保护" —— 开拆前必须把 v0 校全到 v1 |
| **UI-2** | **F02 的 5-controller 计划欠拆 2 个** | 实际簇暴露 **extension-ui-controller(~32 方法)** 与 **self-update-controller(~12 方法)** 两个计划外 owner；前者比多数计划 controller 还大。等同 P4 评审里 AS09–AS12 对原计划的补充 |
| **UI-3** | **import 泄漏 = seam 清单** | 18 个 core 内部直接 import（custom-providers/agent-session/compaction/mcp-config/persona/model-resolver/resource-loader/...）。每条都是"本应封装在 AgentSession 内的能力泄漏到 UI"。controllers 抽取时应顺带把这些收敛到 **AgentSession facade / 各 controller 的窄 context**（沿用 P4 的 capability-context 模式），而非平移 import |
| **UI-4** | **`handleEvent` 336 行是二级 god** | 流式渲染事件路由本身需要独立"render 层"评估；先随 mount 保留，作为后续切片 |
| **UI-5** | **同名歧义** | UI 侧 `session-tree-controller` 与 P4 runtime 侧 `session-tree-controller` 同名不同层；命名需消歧（如 `tree-overlay-controller`）|

### 下一步（开拆前置）

1. ✅ **已建 [`interactive-ui-review/`](../interactive-ui-review/README.md)**（镜像 runtime-session-review）：发现卡 [UI01–UI08](../interactive-ui-review/README.md#current-finding-set) 已登记，门组 [UI-G0…UI-G11](../interactive-ui-review/gates.md) 定稿，抽取顺序见 [refactor-plan.md](../interactive-ui-review/refactor-plan.md)。
2. **校全 [feature-inventory.md](../interactive-ui-review/feature-inventory.md)**（[UI01](../interactive-ui-review/findings/UI01-tui-characterization-baseline.md)，命门）：v0 已起草(33 命令+22 键位+overlay+渲染特性)，maintainer 校到 v1。P5 **接受重写** → 验收"功能正确"而非字节级 characterization；安全网 = 清单完整度。
3. 评审定稿后按 controller 分批抽：一簇一簇定 **纯搬(preserve-check) vs 重写(功能验收)**，逐 tsc + 逐条功能验收。

## 验证门控（DoD）

> 出口以 [gates.md 门组 B](./gates.md#门组-b--功能级出口大阶段二逐域草案--待你定稿) 为准。本 phase 最高风险是功能清单漏列：P5 接受重写，所以 V5-1 不做 byte-level golden replay，而是逐条功能验收。本域补充：

| # | 检查项 | 通过标准 | 门组 B |
|---|--------|---------|--------|
| V5-1 | 功能正确（硬，接受重写）| [feature-inventory.md](../interactive-ui-review/feature-inventory.md) **逐条验收通过**；**非** characterization（P5 接受重写，见 [UI01](../interactive-ui-review/findings/UI01-tui-characterization-baseline.md)）。有意变更显式声明(GB-2) | GB-2 |
| V5-2 | 边界守恒（硬）| controllers/state 不反向依赖 mount；UI 经窄 context 碰 runtime，**不 deep import core 内部**（[UI-G7](../interactive-ui-review/gates.md)）| **GB-1** |
| V5-3 | 公共 API | mode 对外 API 不变；**有意的内部/符号重写须显式声明(GB-2)**，不要求 diff 为空（接受重写）。**`agent-session.ts` 公共面不应因 UI 收敛而显著变大**（防耦合搬家，UI-G7）| GB-2 |
| V5-4 | 单一职责 | controller 职责单一（行数仅信号）| GB-4 |
| V5-5 | 冒烟 | interactive 完整会话 smoke 通过 | GB-2 |
| V5-6 | 性能不劣化 | 冷启动时间 vs [P0 Baseline](./P0-prepare.md) **不劣化**；controller 设计为**可懒加载**（`_shell` 骨架小而 eager、重 controller 可 lazy，给 [P6](./P6-entry-volume.md) 铺路）| GB-2 |

> **性能范围声明**：P5 是**结构重构，不做性能优化** —— 冷启动/体积的实际优化属 [P6](./P6-entry-volume.md)。P5 对性能只负两件事：**(1) 不劣化**（V5-6）；**(2) 把 controller 拆成可懒加载形态**，为 P6 的 lazy-load 铺路。不得因拆分（更多模块解析/间接）反而拖慢启动。

## 提交建议

- 建议拆 ≤7 个 PR 合入执行分支（按 controller 分批；先低风险纯搬热身 image/state）
- 每 PR 合入前跑 V5-1（该 PR 涉及的功能条）+ V5-2/V5-6 守卫

## 决策门控

无新增 ✦（Q7 已决议：只抽 cancellation）。

## 参考

- Finding：`../findings/F02-interactive-mode-god-file.md`
