# Interactive UI Refactor Plan — 实际顺序与验证记录

```yaml
plan_for: interactive-ui-review
parent: ./README.md
status: pre-implementation   # 卡已立，等 feature-inventory v1 后开拆
```

## 硬序

```
Architecture Calibration (mode-architecture-calibration) ──► 每个切片先定 shared/interactive/surface/mount/render
        │
        ▼
UI01 (blocker: feature-inventory v0→v1)  ──► 必须先解
        │
        ▼
UI05 改名定稿 ──► 各 controller 抽取（每抽一个：逐 tsc + V5-1 功能验收）
        │
        ▼
UI02 七 controller + state 合一（沿用 P4 capability-context）
        │  贯穿：UI03 seam 纪律（import 只减不增，UI-G7）
        ▼
UI04 render 层切片（deferred，最后评估）
```

## 抽取顺序（v2，按顶层校准重排）

v1 主要按现有方法簇和风险排序。v2 改为按功能 owner 排序：先把业务能力 owner 从 mount 里拿出来，再抽依赖它们的总分派。这样 `InteractiveMode` 才会收敛为 TUI adapter + composition root，而不是继续维护一个小一点的 god file。

| 序 | 切片 | 卡 | 自带状态 | 备注 |
|----|------|----|---------|------|
| -1 | **mode architecture calibration** | — | — | **blocker，已建**：[mode-architecture-calibration.md](./mode-architecture-calibration.md)；先定义 InteractiveMode 终态为 TUI adapter + composition root |
| 0 | **feature-inventory v1** | UI01 | — | **blocker，先做：校全功能清单，而非录 characterization** |
| done | `state/interactive-state` 合一 | UI02 | ~80 字段 | 已落地；local state holder，不升全局 app state |
| done | `image-pipeline-controller` | UI02 | 附件/剪贴板 | 已落地；interactive-only controller |
| done | `self-update-controller` | UI02 | — | 已落地；P5 留 interactive，第二 mode consumer 出现后再评估 `_shell/update` |
| done | `extension-ui-controller` hosts 1/4–4/4 | UI02 | 扩展 prompt/overlay/widget/editor surfaces | 已落地；interactive surface hosts |
| partial | `slash-dispatcher` dispatch table | UI02 | skillCommands | 33 分支 if-chain 已改表驱动；**controller 物理抽取待做** |
| partial | `model-overlay` selection guard | UI02 | — | exact `/model provider/id` 与 overlay select 已统一 ensure provider；controller 物理抽取待做 |
| done | `model-overlay-controller` | UI02 / UI08 | provider-config port | 已落地：interactive controller over ports；只管 interactive model/thinking/provider/scoped selector workflow。可复用 model capability 留在 runtime `model-controller` / `AgentSession`；不含 settings/provider credentials |
| done | `auth-provider-config-controller` | UI02 / UI03 | provider credential/config | 已落地：抽出 `/apikey`、`/login`、`/logout`、OAuth dialog、custom-provider 配置；model-overlay 的 providerConfig port repoint 到该 owner |
| done | `tree-overlay-controller`（UI05 改名）| UI05 | selector local state | 已落地：经 AgentSession/SessionManager facade + narrow context 调 runtime 导航；先抽可降低 slash-dispatcher context |
| done | `settings-overlay-controller` | UI07 | broad settings callbacks | 已落地：`/settings` interactive overlay owner；保留 SettingsManager/AgentSession/theme/editor/render/buddy 底层 owner，经 grouped ports 编排 |
| done | `slash-dispatcher-controller` | UI02 | skillCommands | 已落地：只抽 built-in slash command token dispatch + clearEditor 策略；不碰 onSubmit/persona/bash/streaming/attachment input pipeline |
| in-progress | `input-submit-controller` | UI06 | optimistic/bashMode/排队决策 | 专项评审已完成，正在抽 controller：submit 总分派移出 mount，保留 slash/image/bash/session/render owner 边界；清理已被 slash-dispatcher 覆盖的 standalone slash 死分支 |
| 7 | `_shell/cancellation` | — | sigint/escape/shutdown | 跨 mode candidate；esc 分派接线留 mount，分支委托 owner |
| 8 | `interactive-mode.ts` → mount(post-UI04 目标 <500 行) | — | 根容器 | 退壳；本轮含 handleEvent，未达 500 |
| — | `handleEvent` render 层 | UI04 | 流式/工具/loader | **deferred**，最后；等 controller 和 state ownership 稳定后再切 |

## 纯搬 vs 重写 决策（v1 定稿）

> 原则：**内聚且无明显坏味 → 纯搬**（preserve-check：tsc + 符号 diff + 手测，便宜且强）；
> **有结构坏味/分支爆炸/重复 → 重写**（feature-acceptance：按 feature-inventory 逐条验收）。
> hybrid = 逻辑搬、边界/接线重写。
> **per-feature 不单独标**：feature-inventory 每条的 hybrid 决策 = **继承其 owner 簇**本表的决策（如所有 model-overlay 名下功能继承"hybrid：纯搬 selector/cycle + 选模路径归一化"）。
> **mode-architecture-calibration 优先**：每个切片先归类为 shared capability / interactive controller / interactive surface host / composition wiring / render layer。`InteractiveMode` 是 TUI adapter + composition root；不引 `BaseMode` 继承作为 P5 默认方案。

| 簇 | 决策 | 证据 / 理由 | 风险 | 验收方式 |
|----|------|-----------|------|---------|
| **state/interactive-state** | **纯搬** | ~80 字段机械合并到容器，不动逻辑；"行为不变"是定义性的 | 低 | preserve-check（符号/编译）|
| **image-pipeline** | **纯搬** | 内聚、自带状态(attachments/clipboard)、无明显坏味；类比 P4 bash-runner 先试水 | 低 | preserve-check + 手测粘贴/拖入 |
| **self-update** | **纯搬(逻辑) + interactive 内部拆分** | 逻辑(performUpdate/compareVersion/restart)保持；先拆到 `modes/interactive` 内部 controller，隔离更新流程与渲染。暂**不**落 `core/platform`：self-update 依赖 package update UX、settings、spawn/restart、TUI 提示，不是 platform primitive；仅在 print/rpc/acp 出现第二消费者时再抽 `modes/_shell/update` | 低-中 | preserve-check(逻辑) + 确认 `/update`/`/reinstall` 仍工作 |
| **★ extension-ui** | **重写生命周期协调层，组件接线以搬为主** | ~32 方法里多套 show/hide/dismiss + ad-hoc active prompt/focus restore 是重复坏味。重写目标不是“所有 overlay 统一成栈”，而是拆成：`PromptHost`(select/input/editor/confirm 单活动 prompt，替换旧 prompt 并恢复焦点)、`CustomOverlayHost`(保留 overlay handle/onHandle/options)、`PersistentSurfaceRegistry`(widget/footer/header/status keyed surface)、`EditorComponentAdapter`(`setEditorComponent` 保持 editor text/callback/shortcut/focus)。generic stack 仅在真实嵌套需求出现后再引入 | **中-高** | feature-acceptance：逐 prompt/overlay/surface 类型验收(C 表 + E 表 extension widget)|
| **★ slash-dispatcher** | **重写（限内置命令 dispatch）** | `executeBuiltinSlashCommand` = **188 行 if-else 链 / 33 个 `if (text===\"/x\")` 分支**(CLAUDE.md「分支爆炸是设计信号」)。重写为 **dispatch 表**。输入提交管线（嵌入 `/persona`、bash、streaming steer、附件、extension command 立即执行）先独立验收，避免被 slash 重写误吞 | **中-高** | feature-acceptance：A 表 33 条命令 + F 表 input-submit pipeline |
| **model-overlay** | **hybrid(偏搬 + 选模路径归一化)** | **UI08 边界**：controller 只拥有 interactive TUI 选择流程，不拥有可复用 model capability。`setModel`/`cycleModel`/thinking clamping/API-key validation/default-model persistence/model-select events 继续归 runtime `model-controller` / `AgentSession`；model-overlay 通过 grouped ports 编排。provider 配置不归它，所有主动选模型入口收口到 `ensureProviderConfiguredForSelection(model)` → `AgentSession.setModel` → footer/border/status 更新；配置取消不得切换模型或写默认模型。`showSettingsSelector` 不属于本簇 | 中 | feature-acceptance：B/C 表 model 选择与 thinking/provider→model overlay；覆盖 exact `/model provider/id` 与 overlay 选择；review UI08 second-consumer rule |
| **auth / provider-config** | **hybrid(偏写)** | OAuth/apikey 流程逻辑搬；provider 配置子簇(`ensureProviderConfigured`/`configureCustomProtocolProvider`/`refreshCurrentModelForProvider`/`resolveProviderId`)归此，解 custom-providers 耦合(UI03 seam)。返回“provider/model 已可用”的结果，不直接拥有模型选择 overlay | 中 | feature-acceptance：A 表 login/logout/apikey + C 表 oauth/provider config |
| **settings-overlay**(UI07) | **hybrid(偏搬)** | `showSettingsSelector` 是 TUI settings overlay，不是 model overlay；逻辑多为 callback wiring，可搬，但 context 可能很宽，需按 settings/theme/editor/chat/buddy/session sub-ports 拆 | 中 | feature-acceptance：`/settings` + SettingsSelector 回调逐项 |
| **tree-overlay**(UI05) | **纯搬 + 改名 + facade 委托** | 选择器 UI 逻辑搬；**改名**消歧(UI05) + 经 facade 调 runtime 导航(不 deep import，UI03) | 低-中 | preserve-check(UI) + 确认 `/tree`/`/fork`/`/resume` 行为 |
| **_shell/cancellation** | **hybrid(偏搬)** | sigint/escape/双击时序逻辑**保持**(易回归，不动)；**改进是跨 mode 复用**(print/rpc/acp 去重)→ 改写各 mode call site | 中 | preserve-check(逻辑) + 各 mode 取消 smoke |
| **handleEvent/render**(UI04) | **deferred → 若动则重写** | 流式渲染核心，最敏感；本轮不动 | 高 | (deferred) 动时：D 表逐事件重度验收 |
| **★ input-submit**(UI06) | **重写** | `onSubmit` ~246 行分派,交叉 slash/persona/bash/queue/附件;含死分支(4 命令双处理)。重写为 `input-submit-controller` 总分派,委托各 owner;清死分支。委托目标稳定后(slash/image 之后)再抽 | **中-高** | feature-acceptance：F 表逐条 |
| **mount**(interactive-mode.ts) | **纯搬(退壳)** | 其余抽完后剩组合根;<500 行为 **post-UI04** 目标(本轮含 handleEvent 未达)；行为保持 | 低 | preserve-check |

**决策摘要(v2)**：已完成基础抽取 4 组（state/image/self-update/extension-ui hosts）+ partial 2 组（slash dispatch table / model selection guard）。剩余优先级按 owner 依赖排：model-overlay → auth-provider-config → tree-overlay → settings-overlay → slash-dispatcher controller → input-submit → cancellation → render。controller 集 = **9**（新增 UI07 settings-overlay）。

> 重写集中在**两处真坏味**：slash 的 188 行 if-else、extension-ui 的重复 prompt lifecycle。extension-ui 只重写生命周期协调，不把 widget/footer/header/status/editor replacement 误并进 overlay stack。其余以搬为主、在 seam(UI03)和边界(UI02)上做最小重写。**先做低风险纯搬热身(image/state)，再啃重写。**

## 验证记录（每切片回填）

| 切片 | 落地 commit | V5-1 功能验收 | import 收缩(UI-G7) | 状态 |
|------|------------|-----------|-------------------|------|
| mode architecture calibration | _待提交_ | — | 后续切片必须先按 shared/interactive/surface/mount/render 分类 | ✅ |
| UI01 feature-inventory v1 | _待_ | — | — | ⬜ |
| state 合一 | _待_ | _待_ | _待_ | ⬜ |
| extension-ui host 3/4: CustomOverlayHost | `8bad839` | preserve-check：`showExtensionCustom` 单方法纯搬；ExtensionUIContext.custom 仍同一路径可达；未跑 build/test（低性能机器策略） | `interactive-mode.ts` 删除 custom 方法与 Overlay 类型/Theme import，新增窄 context host | ✅ |
| model-overlay selection guard | `bdb4755` | 行为收紧：`/model provider/id` exact 与 overlay select 均先 ensure provider；配置取消不切换、不写默认模型；构建已由 maintainer 确认通过 | `ModelSelectorComponent` 移除 provider/default-model side effect，caller 统一 apply selected model | ✅ |
| auth-provider-config-controller | `18e7f51` | 构建已由 maintainer 确认通过；覆盖 `/apikey`、`/login`、`/logout`、OAuth login dialog、custom OpenAI/Anthropic-compatible provider 配置、provider→model 选择前置配置 | `interactive-mode.ts` 删除 auth/provider 实现与相关 imports；model-overlay 只依赖 providerConfig port；credential/config ownership 收口到 controller | ✅ |
| tree-overlay-controller | `c78a787` | 构建已由 maintainer 确认通过；覆盖 `/tree`、`/fork`、`/resume`、double-escape tree/fork、session rename、tree label edit、branch summary/cancel | `interactive-mode.ts` 删除 session/tree/fork selector 实现与 selector component imports；controller 只通过 AgentSession/SessionManager + TUI ports 编排 | ✅ |
| settings-overlay-controller | `f1abe35` | 构建已由 maintainer 确认通过；覆盖 `/settings` 打开/取消；auto compact、image、skill command、steering/follow-up、transport、agent-loop、thinking、theme preview/apply、hide thinking、editor/cursor/token stats、buddy/presence toggles | `interactive-mode.ts` 删除 settings selector 实现与 SettingsSelectorComponent/getAvailableThemes imports；controller 只通过 SettingsManager/AgentSession + grouped interactive ports 编排 | ✅ |
| slash-dispatcher-controller | `bce01d2` + `0c96e05` | 构建已由 maintainer 确认通过；覆盖 33 个 built-in slash command token dispatch；unknown slash 返回 false；`clearEditor: false` executor path 不清 editor；`/settings`、`/model`、`/tree`、`/fork`、`/resume` 仍委托 owner | `interactive-mode.ts` 删除 `builtinSlashCommands` map 与 `executeBuiltinSlashCommand`；新增 dispatcher over owner callback ports；不改 input-submit pipeline | ✅ |
| input-submit-controller review | `6c14851` | 已评审：normal submit、built-in slash、extension slash、embedded persona、bash/!!、compaction queue、streaming steer、attachments/images、onInputCallback、rollback；结论为重写分派结构、保留 prompt/image/attachment 语义 | 目标：抽 `setupEditorSubmitHandler` 的 submit 分派；保留 slash-dispatcher/token dispatch 边界，不改变发送给 AgentSession 的文本/图片/附件语义 | ✅ |
| input-submit-controller | _待提交_ | 待 maintainer 构建与 TUI 验收：built-in slash 不进 prompt；extension slash 仍交 AgentSession；嵌入 `/persona` 只处理 message 中部；`!`/`!!` bash；compaction queue；streaming steer；idle submit 图片/附件/rollback/onInputCallback | `interactive-mode.ts` 删除 submit 分派主体；新增 controller over slash/image/bash/session/render ports；清理 `/persona`、`/memory`、`/arminsayshi`、`/resume`、`/quit` standalone 死分支（已由 slash-dispatcher 接管） | ⏳ |
| …（随抽取追加）| | | | |

## 与 P5 runbook 的关系

本表 = 实际执行顺序 + 验证状态；[P5-ui-split.md](../../execution-plan/P5-ui-split.md) = 出口门定义（V5-1…V5-5）。卡片（findings/UIxx）= 每个边界的 why。三者随抽取同步回填（同 P4 的三层：llm-wiki/ownership 表/review 卡）。
