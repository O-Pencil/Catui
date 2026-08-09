# 候选 4：Overlay Focus Restore 状态机（**新发现**）

> 来源：`pi/packages/tui/src/tui.ts` 的 `OverlayFocusRestoreState`
> 状态：**🟡 唯一真东西，待你拍板是否落地**

## 这个问题在 catui 怎么解决的（缺失）

```typescript
// catui 当前逻辑
hideOverlay(): void {
  const overlay = this.overlayStack.pop();
  if (!overlay) return;
  const topVisible = this.getTopmostVisibleOverlay();
  this.setFocus(topVisible?.component ?? overlay.preFocus);
  this.requestRender();
}

// 当 overlay 失去焦点时：
//   catui：focused overlay → 退到 preFocus
//   pi：focused overlay → 退到 preFocus，但记住 overlay → 如果 overlay 又可见，恢复焦点到 overlay
```

**场景**：

1. 用户打开 modal A，modal A 拿到焦点
2. 用户点击 modal A 外面（焦点去到编辑器）
3. modal A 仍然可见
4. 用户按 Tab 想回 modal A ——
   - **catui**：焦点去到下一个 overlay 或编辑器（**无法精确回到 modal A**）
   - **pi**：焦点**精确回到 modal A**

## pi 的实现

```typescript
type OverlayFocusRestoreState =
  | { status: "inactive" }
  | { status: "eligible"; overlay: OverlayStackEntry }       // overlay 可见，可恢复焦点
  | { status: "blocked"; overlay: OverlayStackEntry;         // overlay 可见，但被其他组件挡着
      blockedBy: Component;
      resume: OverlayBlockedFocusResume };

type OverlayBlockedFocusResume =
  | { status: "restore-overlay" }
  | { status: "focus-target"; target: Component | null };
```

**三态机**：

| 状态 | 含义 | 触发转移 |
|---|---|---|
| `inactive` | 没有 overlay 需要恢复焦点 | 进入 eligible / blocked |
| `eligible` | overlay 可见且可恢复焦点 | overlay 隐藏 / 被挡 → blocked |
| `blocked` | overlay 可见但被挡 | 障碍消失 → eligible |

**触发恢复的入口**：`handleInput()` 里检查 `restoreState.status === "eligible"` → 自动 `setFocus(overlay.component)`。

## 价值

- **中** — 修复 catui 的"modal 焦点丢失"问题
- 对编辑器 + 命令面板这种"overlay 短暂失去焦点"的场景特别有用
- 对 keyboard-driven 用户明显——Tab / Esc 的体验直接提升

## 风险

| 风险 | 等级 | 缓解 |
|---|---|---|
| 状态机复杂度 | 中 | pi 的实现可以**逐字翻译**，模式简单 |
| 现有 overlay 用户代码 | 低 | `setFocus()` 行为不变，**只增加自动恢复** |
| 测试覆盖 | 高 | 必须测"modal 短暂失焦 → 自动恢复"等场景 |

## 落地路径

1. 写 design doc，明确三态转移条件
2. 写 test case（模拟 overlay → 非 overlay → 重新交互的场景）
3. 改 `core/lib/tui/src/tui.ts`：
   - 加 `OverlayFocusRestoreState` 类型
   - 加 `overlayFocusRestore` 字段
   - 改 `setFocusInternal` / `handleInput` 处理恢复逻辑
4. 同步 `core/lib/tui/AGENT.md` P2 member list
5. 跑 verify 三件套

## 改动量估计

~150 行 TypeScript + ~100 行测试。

## 我的建议

**这是这次调研最值得做的一个候选**。改动可控、行为可见、有现成的 pi 模式可参考、风险低。

但**仍然要走 review 流程**——因为改的是 `core/lib/tui` 的核心类，且涉及 catui 当前 P2 member list 的扩展。