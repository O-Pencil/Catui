# slash-dispatcher 重写分析（实施前）

```yaml
doc: slash-dispatcher-analysis
parent: ./README.md
finding: UI02（slash-dispatcher 重写）/ refactor-plan 决策表
nature: 重写（限内置命令 dispatch；分支爆炸 → dispatch 表）
target: modes/interactive/interactive-mode.ts executeBuiltinSlashCommand
status: analysis-before-implementation
```

> rewrite-acceptance 的第二个工作示例。瞄准的 smell = **分支爆炸**（CLAUDE.md「能删的分支胜过写对的分支」）。

---

## 1. 坏味

`executeBuiltinSlashCommand`（~190 行）= **33 个 `if (text === "/x" ...)` 线性扫描**。每次提交一条 `/command` 要顺序比对最多 33 次。这是 Rigidity（加命令要插 if 块）+ 分支爆炸。

---

## 2. 重写目标：dispatch 表

```ts
type SlashCommandHandler = (text: string, clear: () => void) => void | Promise<void>;

private readonly builtinCommands: Record<string, SlashCommandHandler> = {
  "/settings": (_t, clear) => { this.showSettingsSelector(); clear(); },
  "/scoped-models": async (_t, clear) => { clear(); await this.showModelsSelector(); },
  "/model": async (t, clear) => {
    const s = t.startsWith("/model ") ? t.slice(7).trim() : undefined;
    clear(); await this.handleModelCommand(s);
  },
  // … 33 条
};

private async executeBuiltinSlashCommand(text, options?): Promise<boolean> {
  if (!text.startsWith("/")) return false;
  const clearEditor = options?.clearEditor ?? true;
  const clear = () => { if (clearEditor) this.editor.setText(""); };
  const sp = text.indexOf(" ");
  const cmd = sp === -1 ? text : text.slice(0, sp);     // 命令 token
  const handler = this.builtinCommands[cmd];
  if (!handler) return false;
  await handler(text, clear);
  return true;
}
```

**33 个 `if` 线性扫描 → 1 个 Map 查找（O(n)→O(1)）**。新增命令 = 加一条表项（声明式），不再插 if 块。

---

## 3. 忠实性（逐条保留，不是简化）

| 陷阱 | 处理 |
|------|------|
| **`clear()` 时机每条不同**（action 前/后）| **表项闭包内含完整原 body**（含 clear 在原位置）。如 `/new` = `clear(); await handleClearCommand()`；`/settings` = `showSettingsSelector(); clear()` |
| **参数提取每条不同**（`/model` slice(7) vs `/compact` slice(9) vs `/export`/`/thinking`/`/mcp` 传全 text）| 表项闭包内做原样提取/传参 |
| **sync vs async**（部分 await）| handler 返回 `void | Promise<void>`，dispatcher `await` |

> 表是"声明式路由 + 每条原 body"，不动 handler 本身 → 行为逐条不变（除下方 ★）。

---

## 4. ★ 决策点 1：`/export` 的裸 startsWith

原：`if (text.startsWith("/export"))` → `/exportfoo` 也被当 /export。其余命令都是 `=== "/x" || startsWith("/x ")`，token 解析**完全等价**。唯独 /export 的裸 startsWith 会被 token 解析归一化（`/exportfoo` → 不匹配 → 返回 false → 当普通消息）。

- **A 归一化（推荐）**：/export 也走 token 匹配（`=== "/export" || startsWith("/export ")`）。`/exportfoo` 不再误判。**这是 GB-2 声明的行为微变**，且本身是修原 laxness（应该写成带空格的）。
- **B 保留**：表里给 /export 特判 startsWith，钉住原行为（连 laxness 一起）。

> 推荐 A：纯结构重写顺带修一个 1 行的 laxness，显式声明即可。你定。

---

## 5. ★ 决策点 2：原地重写 vs 抽独立文件

dispatcher 要分发到 **33 个 handler**（散在未来的 model-overlay / auth / self-update / mount leaf）。

- **原地重写（推荐）**：表 + dispatcher **留在 InteractiveMode**，表项直接 `this.handleX`。**立即拿到重写价值**（消分支爆炸），**不引 33 能力的 service-locator context**（违 UI-G2）。
- **现在抽文件**：context 需 33 个 handler 能力 = service-locator，**反而引入新坏味**（rewrite-acceptance 明确反对"拿一个 smell 换另一个"）。

> 推荐**原地重写**。**文件抽取自然延后**到 handler 们收编进 controller（model-overlay / auth / slash-leaf）之后 —— 那时表项变成 `controller.X`，dispatcher 的 context 才窄（分发到几个 controller,非 33 方法）。这也符合"先消坏味、边界稳了再搬"。

---

## 6. 边界（别吞 input-submit，UI06）

`executeBuiltinSlashCommand` 由 submit handler（`setupEditorSubmitHandler`）调用。本刀**只改 dispatch 机制**，**不碰 submit 管线**（persona 嵌入 / bash / steer / 附件 / 死分支）。input-submit 是独立刀（UI06）。slash 重写不得越界。

---

## 7. rewrite-acceptance（实测，commit `<slash-dispatcher>`）

**决策**：① A（/export 归一化 + GB-2 声明）· ② 原地重写（表为 InteractiveMode 字段）。

| 尺子 | before | after(实测) |
|------|--------|------------|
| `if (text===…)` 分支数 | **33**（线性扫描）| **0**（`builtinSlashCommands[cmd]` Map 查找）|
| dispatch 复杂度 | O(n) | **O(1)** |
| `executeBuiltinSlashCommand`（命令派发的命令式代码）| **~187 行 if-链** | **~22 行 dispatcher**（解析 token → 查表 → 调）|
| 加一条命令 | 在 187 行 if-链里找位置插块 | **加一条声明式表项** |
| 命令体（clear 时机 / 参数提取 / sync-async）| — | **逐条保留**（表项闭包含原 body）|
| 行为 | — | 逐条不变，唯 **`/export` 归一化**（`/exportfoo` 不再误判，GB-2 声明）|
| 文件总行数 | — | 6253 → 6231（−22；LOC 非本刀目标，结构是）|
| service-locator | — | **无**（原地，表项 `this.handleX`；文件抽取延后到 handler 收编进 controller）|
| 新 finding | — | **无**（声明式表，非 Premature Abstraction）|

**判决**：瞄准的**分支爆炸**消除（33→0，O(n)→O(1)），命令体逐条保留,唯一行为变更（/export 归一化）已 GB-2 声明,未引 service-locator/新坏味 → **重写成立**。

> 边界守恒：submit handler（`setupEditorSubmitHandler`）里的 5 个 `if (text === "/…")`（persona 嵌入 + /memory,/arminsayshi,/resume,/quit 死分支）**未触碰** —— 属 input-submit（UI06），本刀不越界。死分支由 UI06 清。

---

## 待办（实施后）

- [x] 决策 1（A）+ 决策 2（原地）已定并实现。
- [x] 建表 33 条 + 改 dispatcher。
- [ ] 行为评审：A 表 33 命令抽样跑（尤其带参的 /model x、/compact x、/export path、/login provider；及 /export 归一化后 /exportfoo 走普通消息）。
