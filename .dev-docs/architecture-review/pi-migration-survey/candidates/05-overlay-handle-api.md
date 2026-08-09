# 候选 5：OverlayHandle 完整 API（**新发现**）

> 来源：`pi/packages/tui/src/tui.ts` 的 `OverlayHandle`
> 状态：**🟡 建议跟候选 4 一起做**

## 现状对比

### pi

```typescript
interface OverlayHandle {
  hide(): void;
  setHidden(hidden: boolean): void;
  isHidden(): boolean;
  focus(): void;                                  // ← 显式聚焦
  unfocus(options?: { target: Component | null }): void;  // ← 显式失焦
  isFocused(): boolean;                           // ← 查询
}
```

### catui

```typescript
interface OverlayHandle {
  hide(): void;
  setHidden(hidden: boolean): void;
  isHidden(): boolean;
}
```

## 三个缺失方法的作用

### `focus()`

```typescript
// 业务代码：用户搜到结果后，自动聚焦到结果列表
showOverlay(resultsList);
resultsList.focus();  // 立刻聚焦
```

替代 `setFocus(component)`，更明确"这是 overlay 的焦点操作"。

### `unfocus(options?)`

```typescript
// 业务代码：modal 关闭时把焦点送回指定组件
modal.unfocus({ target: editorComponent });
```

替代 `setFocus(target)`，语义更清晰。

### `isFocused()`

```typescript
// 业务代码：根据 modal 焦点状态切换 UI
if (modal.isFocused()) showHint("按 Esc 关闭");
else showHint("");
```

## 价值

- **低~中** — API 完整性提升，业务代码更明确
- 单独做的价值不大；**跟候选 4 一起做**是顺水推舟

## 落地路径

和候选 4 **同一个 commit**。

## 改动量估计

~30 行 TypeScript（实现三个方法）。测试可以共用候选 4 的 fixture。

## 我的建议

**做候选 4 的时候顺手做掉**。不单独开 review。