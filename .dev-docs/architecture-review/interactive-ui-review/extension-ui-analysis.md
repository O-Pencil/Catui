# extension-ui 重写分析（实施前）

```yaml
doc: extension-ui-analysis
parent: ./README.md
finding: UI02（extension-ui-controller 计划外、重写）
status: analysis-before-implementation
target: modes/interactive/interactive-mode.ts → controllers/extension-ui/*
nature: 重写（lifecycle 协调层重设计）+ 组件接线纯搬
```

> 这是 extension-ui 这一刀的**实施前分析**。它是 P5 唯一明确"重写"的大簇（UI02），且最易破坏**扩展面向契约**。先把契约、坏味、分解、接缝、风险讲清，定稿后再动代码。

---

## 1. 规模

**31 方法 + 12 状态字段**（interactive-mode 内最大簇）。方法分布 L1300–2332，状态 L277–308。

---

## 2. 硬契约：`ExtensionUIContext`（重写不可破）

`createExtensionUIContext()`（L1811）返回 `ExtensionUIContext`，~25 个方法是**扩展作者直接调用的 API**。重写**必须逐字保留其形状与语义**：

| 类别 | 契约方法 |
|------|---------|
| prompts | `select` `confirm` `input` `notify` |
| 持久面 | `setStatus` `setWidget` `setFooter` `setHeader` |
| custom | `custom`（overlay/inline + onHandle）|
| 编辑器文本 | `pasteToEditor` `setEditorText` `getEditorText` |
| 编辑器替换 | `setEditorComponent` |
| 编辑器 prompt | `editor` `openExternalEditor` |
| 终端 | `setTitle` `onTerminalInput` |
| 主题 | `theme` `getAllThemes` `getTheme` `setTheme` |
| 渲染态 | `setWorkingMessage` `getToolsExpanded` `setToolsExpanded` |

> **`createExtensionUIContext` = 聚合器**：它从多个来源拼出 `ExtensionUIContext`，其中很多**不属 extension-ui**（theme→mount/theme、editor 文本→mount/editor、setTitle→ui、setWorkingMessage/toolsExpanded→`this.state`）。重写后它仍是**唯一装配点**，从 4 个 host + mount 能力拼出同一个契约对象。**验收基准 = 这 25 个方法行为不变。**

---

## 3. 坏味：三套并行的 prompt 生命周期

`showExtension{Selector,Input,Editor}`（+ `confirm` 委托 selector）**骨架逐字相同**：

```
1. if opts.signal.aborted → resolve(undefined)
2. onAbort = () => { hideX(); resolve(undefined) }; signal.addEventListener
3. this.dismissActiveExtensionPrompt(false)        ← 单活动 prompt 不变量
4. this.extensionX = new XComponent(... submit→{hideX;resolve(v)} cancel→{hideX;resolve(undefined)} ...)
5. editorContainer.clear(); addChild(extensionX); ui.setFocus(extensionX); requestRender()
```

配套：`hideX`（→`dismissX`+render）、`dismissX(restoreFocus)`（→清字段+dispose+`remountEditorShell`+`restoreEditorFocusIfPossible`）。

**=9 方法 + 3 协调方法**（`dismissActiveExtensionPrompt` 清全部 3 个；`hasActiveExtensionPrompt`= 三者任一；`restoreEditorFocusIfPossible`= 无活动 prompt 且编辑器挂载时聚焦编辑器）。

**本质**：三种组件（Selector/Input/Editor）插进**同一个"单活动 prompt"槽**。这就是重写目标。

---

## 4. 分解（4 host + 装配器，细化 UI02）

| Host | 责任 | 收编方法 | 自带状态 |
|------|------|---------|---------|
| **PromptHost** | 单活动 prompt 槽：挂进 editorShell、聚焦、submit/cancel/abort→resolve、dismiss→dispose+remount+restore focus | show{Selector,Input,Editor} + hide×3 + dismiss×3 + dismissActiveExtensionPrompt + hasActiveExtensionPrompt | `activePrompt`（合并 extensionSelector/Input/Editor 为单槽）|
| **CustomOverlayHost** | `custom`：overlay（ui.showOverlay/hideOverlay + onHandle）或 inline（挂 editorShell）；保存/恢复编辑器文本 | showExtensionCustom | 无持久态（per-call close 闭包）|
| **PersistentSurfaceRegistry** | keyed 持久面：widget(above/below)/footer/header/status | setExtensionWidget/clearExtensionWidgets/renderWidgets/renderWidgetContainer/setExtensionFooter/setExtensionHeader/setExtensionStatus/resetExtensionUI | extensionWidgetsAbove/Below、widgetContainerAbove/Below、customFooter、customHeader、builtInHeader、headerContainer |
| **EditorComponentAdapter** | `setEditorComponent`：替换编辑器组件，保编辑器 text/callback/shortcut/focus | setCustomEditorComponent | （操作 this.editor/defaultEditor）|

**装配器 `createExtensionUIContext`** 留在 controller，从上述 4 host + mount 能力拼出 `ExtensionUIContext`。

**小件**：终端输入（addExtensionTerminalInputListener/clear + extensionTerminalInputUnsubscribers）并入 controller；扩展加载（initExtensions/setupExtensionShortcuts/getRegisteredToolDefinition）属扩展**运行时**装配，可同controller 但与 UI host 区分。

> **不引泛型 overlay stack**（UI02 决议）：PromptHost 是**单槽**（不是栈）—— 现状就是"一次一个 prompt"，无嵌套需求。真出现嵌套再说。

---

## 5. 接缝：与 editor-shell 的深耦合（设计难点）

extension-ui **重度耦合 editor-shell**：prompt 挂进 `editorContainer`（替换编辑器位），dismiss 要 `remountEditorShell()` 复原。host 需经 **窄 context** 拿这些 mount 能力：

| context 能力 | 用途 |
|-------------|------|
| `getEditorContainer()` | clear/addChild/children.includes |
| `getEditor()` / `getDefaultEditor()` | setText/getText/focus、替换 |
| `remountEditorShell()` | dismiss 后复原编辑器壳 |
| `getUi()`（setFocus/requestRender/showOverlay/hideOverlay/terminal） | 焦点/渲染/overlay |
| `getKeybindings()` | ExtensionEditorComponent / custom factory |
| `getChatContainer()` | showExtensionError 渲染 |
| `showStatus/showError/showWarning` | notify 委托 |
| `getState()`（workingMessageOverride/loadingAnimation/toolOutputExpanded）| setWorkingMessage/getToolsExpanded |
| `getWidgetContainers()`（above/below 槽）| 持久 widget 渲染 |

> **跨 owner 共享**：`restoreEditorFocusIfPossible` 还被 handleEvent（agent_start/end）调用 —— 它依赖 PromptHost 的 `hasActivePrompt()` + editor-shell。重写后 host 暴露 `hasActivePrompt()`，mount 的焦点恢复问 host；或 host 拥有该方法、mount 调它。需明确单一 owner（UI-G3）。

---

## 6. 不属 extension-ui 的"路过"方法（别误收）

| 方法 | 实质 | 去向 |
|------|------|------|
| `shouldRenderToolTrace` | 工具 trace 渲染策略（读 settings）| **render/UI04，非 extension-ui** |
| `showExtensionNotify` | 薄适配（→showStatus/Error/Warning）| 留装配器或薄壳 |
| `showExtensionError` | 扩展错误渲染到 chat | extension-ui（扩展生命周期）|

---

## 7. 重写不变量（验收基准）

1. **`ExtensionUIContext` 25 方法行为逐字不变**（契约硬门）。
2. **单活动 prompt 不变量**：show 任一 prompt 前清掉已存在的（PromptHost 单槽天然保证）。
3. **焦点恢复**：dismiss 后无活动 prompt 且编辑器挂载 → 聚焦编辑器；agent_start/end 的焦点恢复仍正确。
4. **editor-shell 复原**：dismiss/custom 关闭后 `remountEditorShell` + 编辑器文本/焦点复原。
5. **abort 语义**：signal 中止 → resolve(undefined) + 清理 listener。
6. **持久面**：widget/footer/header/status 的 set/clear/render 行为不变；`resetExtensionUI` 清干净。
7. 行为评审：抽取时**主动验**扩展 prompt/overlay/widget（按 A 契约 + C 内置扩展手测，见 [behavior-review-log](./behavior-review-log.md)）。

---

## 8. 建议抽取顺序（host 逐个，逐 tsc + 功能验收）

1. **PersistentSurfaceRegistry**（最独立，纯搬 keyed 面，试水）
2. **PromptHost**（核心重写：3 套生命周期 → 单槽；坏味主战场）
3. **CustomOverlayHost**（per-call，依赖 PromptHost 的 editor-shell 接缝稳定）
4. **EditorComponentAdapter**（编辑器替换）
5. **createExtensionUIContext** 改为从 4 host + mount 能力装配（契约不变验收）
6. 终端输入 + 扩展加载并入 controller

> 每步：`ExtensionUIContext` 契约 diff = 空（或显式声明）；功能验收对应 host 的 prompt/surface 行为；UI-G7 import 收敛。

---

## 9. 待补读（实施时）

- `setCustomEditorComponent` body（L2042–2115）：编辑器替换的 text/callback/shortcut/focus 保留细节。
- `setExtensionWidget`/`renderWidgetContainer`（L1454–1713）：widget 渲染与容器布局。
- `initExtensions`（L1300–1407）：扩展加载与 host 装配点。
- `ExtensionUIContext` 类型定义（extensions-host）：契约的权威形状。
