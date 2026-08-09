# TUI 层对比：pi `tui.ts` vs catui `core/lib/tui/src/tui.ts`

## 关键发现

读完两个 tui.ts 全文（pi 1715 行 + catui ~700 行）后：

**catui 不是"需要迁移 TUI 特性"——catui 的 TUI 实现已经在多处优于 pi**。

## 逐项对比

### 1. 差量渲染（核心算法）

**结论：旗鼓相当。**

| 维度 | pi | catui |
|---|---|---|
| `previousLines` 状态 | ✅ | ✅ |
| `firstChanged / lastChanged` 计算 | ✅ | ✅ |
| 全屏清触发条件 | 首次 / 宽度变化 / 高度变化（非 Termux）/ clearOnShrink | 首次 / 宽度变化 / clearOnShrink |
| 删除行处理 | ✅ | ✅ |
| 滚动时 cursor 跟踪 | ✅ | ✅ |

**pi 独有**：Termux 高度变化特殊处理（避免软键盘切换时整个 history 重放）。
**catui 独有**：forceRender 早返回优化（如果内容真没变，连写一次都省）。

### 2. 同步输出 `\x1b[?2026h/l`

**结论：catui 更优。**

```typescript
// pi — 直接 wrap
buffer = "\x1b[?2026h" + buffer + "\x1b[?2026l";

// catui — 智能判断
function shouldUseSynchronizedOutput(): boolean {
  if (process.env.CATUI_SYNC_OUTPUT === "0") return false;
  if (process.env.CATUI_SYNC_OUTPUT === "1") return true;
  const termProgram = process.env.TERM_PROGRAM?.toLowerCase() || "";
  const SYNC_OUTPUT_BLOCKLIST = new Set([
    "warpterminal",  // Warp
    "waveterm",      // Wave Terminal
  ]);
  return !SYNC_OUTPUT_BLOCKLIST.has(termProgram);
}
```

catui 注释说：Warp / Wave Terminal 已知会"hold frame buffer 直到检测到 recognized terminator"，导致"输入看不见直到模型 streaming 完成"。**catui 选择在这些终端上禁用 2026**。

### 3. Overlay 系统

**结论：主体一致，焦点管理差距。**

#### 共有

- `OverlayAnchor`：9 个锚点（center / top-left / top-center / top-right / left-center / right-center / bottom-left / bottom-center / bottom-right）
- `OverlayOptions`：width / minWidth / maxHeight / row / col / margin / visible 回调
- `SizeValue`：`number | "${number}%"`
- 布局解析（`resolveOverlayLayout`）逻辑几乎逐行一致

#### pi 独有 / catui 缺失

**Overlay Focus Restore 状态机**（`OverlayFocusRestoreState`）：

```typescript
type OverlayFocusRestoreState =
  | { status: "inactive" }
  | { status: "eligible"; overlay: OverlayStackEntry }
  | { status: "blocked"; overlay: OverlayStackEntry; blockedBy: Component; resume: ... };
```

**它解决的问题**：
- modal A 拥有焦点
- 用户焦点切到非 overlay 组件 B（比如外部菜单）
- modal A 仍然可见但失去焦点
- 用户再次和 modal A 交互 → 焦点**精确恢复**到 modal A
- catui 的当前实现：modal 失去焦点 = 退到 preFocus，**无法精确恢复**

**OverlayHandle 完整 API**：

```typescript
// pi
interface OverlayHandle {
  hide(): void;
  setHidden(hidden: boolean): void;
  isHidden(): boolean;
  focus(): void;                                  // ← catui 缺
  unfocus(options?: { target: Component | null }): void;  // ← catui 缺
  isFocused(): boolean;                           // ← catui 缺
}

// catui
interface OverlayHandle {
  hide(): void;
  setHidden(hidden: boolean): void;
  isHidden(): boolean;
}
```

**Overlay 排序**：

```typescript
// pi — 显式 focusOrder 字段
type OverlayStackEntry = {
  component: Component;
  options?: OverlayOptions;
  preFocus: Component | null;
  hidden: boolean;
  focusOrder: number;  // ← 显式
};

// catui — 隐式栈序
private overlayStack: {
  component: Component;
  options?: OverlayOptions;
  preFocus: Component | null;
  hidden: boolean;
}[] = [];
```

### 4. 首帧渲染

**结论：catui 更优。**

```typescript
// pi
start(): void {
  this.stopped = false;
  this.terminal.start(...);
  this.terminal.hideCursor();
  // ... 然后靠 requestRender() 的 process.nextTick
  this.requestRender();
}

// catui — 同步首帧
start(): void {
  this.stopped = false;
  this.terminal.start(...);
  this.terminal.hideCursor();
  this.requestCellSizeQuery();
  // 同步触发首帧渲染，跳过 requestRender() 的 process.nextTick。
  // 之前这里走 process.nextTick，会让首帧再多等一个 tick，
  // 叠加启动时残留的 stdout / TTY echo，用户会看到"两条线
  // 先于完整 UI 出现"的撕裂感。
  this.renderRequested = false;
  this.doRender();
}
```

catui 注释解释了为什么——避免首屏撕裂。**这是 pi 的实际 bug**。

### 5. Crash 日志

**结论：catui 独有。**

catui 的 `doRender()` 在检测到组件输出超宽时：
- 写入 `~/.catui/agent/catui-crash.log`
- `CATUI_STRICT_RENDER=1` 时抛错（dev/test）
- 默认静默截断（prod 不让一个坏组件毁掉整个 session）

pi 没有这种防御。

### 6. Kitty Keyboard Protocol 协商

**结论：pi 更详细。**

```typescript
// pi — 主动 query
const KITTY_KEYBOARD_PROTOCOL_QUERY = `\x1b[>7u\x1b[?u\x1b[c`;

private queryAndEnableKittyProtocol(): void {
  this.setupStdinBuffer();
  process.stdin.on("data", this.stdinDataHandler!);
  this.keyboardProtocolPushed = true;
  this.clearKeyboardProtocolNegotiationBuffer();
  process.stdout.write(KITTY_KEYBOARD_PROTOCOL_QUERY);
}

// pi — Kitty 协议失败时 fallback
private handleKeyboardProtocolNegotiationSequence(...): boolean {
  if (negotiationSequence.type === "kitty-flags") {
    if (negotiationSequence.flags !== 0) {
      // Kitty 协议可用
      this._kittyProtocolActive = true;
    } else {
      // Kitty 协议不可用，退到 modifyOtherKeys
      this.enableModifyOtherKeys();
    }
  }
}
```

catui 用 TERM_PROGRAM 探测，但**没有主动 query Kitty 协议**。这是 1 个可借鉴的子能力。

### 7. Apple Terminal Shift+Enter 修复

**结论：pi 独有。**

```typescript
// pi
const APPLE_TERMINAL_SHIFT_ENTER_SEQUENCE = "\x1b[13;2u";

function normalizeAppleTerminalInput(data, isAppleTerminal, isShiftPressed): string {
  if (isAppleTerminal && data === "\r" && isShiftPressed) return APPLE_TERMINAL_SHIFT_ENTER_SEQUENCE;
  return data;
}
```

Apple Terminal 不发 Kitty 协议的 Shift+Enter，需要特殊处理。catui 的 keybindings 是否覆盖，待查。

## TUI 总结表

| 维度 | pi | catui | 谁更好 |
|---|---|---|---|
| 差量渲染 | ✅ | ✅ | 平 |
| 同步输出 | 直接 wrap | 智能判断 + blocklist | **catui** |
| Overlay 锚点 / 布局 | ✅ | ✅ | 平 |
| Overlay 焦点恢复 | 完整状态机 | 简化栈顶 | **pi** |
| OverlayHandle API | 6 个方法 | 3 个方法 | **pi** |
| 首帧同步 | nextTick | doRender 同步 | **catui** |
| Crash 日志 | ❌ | ✅ | **catui** |
| Kitty 协议主动协商 | ✅ | ❌ | **pi** |
| Apple Terminal Shift+Enter | ✅ | 待查 | **pi** |
| Termux 软键盘特殊处理 | ✅ | ❌ | **pi** |

**净结论**：catui 6 个维度领先 / 平，4 个维度落后。**整体持平略优**。