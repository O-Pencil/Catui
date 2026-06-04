# UI06: 输入提交管线独立成 controller

```yaml
finding_id: UI06
severity: load-bearing
lenses: [locality, risk]
files_primary:
  - modes/interactive/interactive-mode.ts
files_secondary:
  - modes/interactive/controllers/   # 待建
status: selected
```

## Problem

`setupEditorSubmitHandler`（L2775–3021，~246 行）是**输入提交管线**：一条 `onSubmit` 把用户输入分派到 6+ 条路径——内置 slash、嵌入式 `/persona`、bash `!`/`!!`、compaction 期间排队、streaming steer（乐观渲染 + 图像提取）、idle 普通提交（附件）、外部回调、失败回滚。

它**横跨 4 个 owner**：slash-dispatcher、image-pipeline、persona(slash)、queue/steer。摸底里它原标"留 mount"，但：

- 它本身就是 mount 第二大方法（~246 行，仅次于 `handleEvent` 336）。留 mount → mount 永远瘦不下来（[UI04](./UI04-handle-event-render-god.md) + 本管线两块就 ~580 行）。
- 它是**最易回归的集成点**：persona 嵌入、`!!` excludeFromContext、compaction 期"扩展命令立即执行而普通文本排队"、streaming 期乐观渲染 + steer——这些交错分支正是重构最易改坏处（feature-inventory §F 专列）。

## Deletion Test

> 若不独立，提交管线落在哪？

**Result**：留 mount，则 mount 同时是"组合根 + 渲染核心(handleEvent) + 提交分派"三 god 合一。提交逻辑有真状态交互（optimistic queue、bash mode、附件清理）、不散到别处 → 符合 UI-G5"持真行为"，应独立。

## Verdict — SELECTED（抽 `input-submit-controller`）

抽 `modes/interactive/controllers/input-submit-controller.ts`，owns `onSubmit` 分派：

- 它是**分派器**：识别 slash(委托 slash-dispatcher)、persona(委托)、bash(委托)、附件(委托 image-pipeline)、queue/steer(自有)。
- **自有状态**：optimistic user messages、bash mode 标志、compaction/steer 排队决策。
- 经窄 context 调各 owner 能力（slash-dispatcher.tryBuiltin / image-pipeline.extractImages / session.prompt|steer），不接整个 `InteractiveMode`（UI-G2）。

> 与 slash-dispatcher 的边界（关键）：**slash-dispatcher 只判定+执行内置 `/command`**；**input-submit 决定"这行输入是命令/bash/普通消息/排队"的总分派**。slash 重写不得吞掉 submit 管线（feature-inventory §F 单列验收）。

## 排序

属**重写**（分派逻辑会随 slash/extension 命令统一而调整），但**优先级靠后**：先落 state 容器 + slash-dispatcher + image-pipeline，submit 管线在这些 owner 的能力稳定后再抽（否则委托目标未定）。UI07 增补 settings-overlay 后，controller 集为 **9 个**。

## Decision Criteria

- `input-submit-controller` 不接整个 `InteractiveMode`；经窄 context 委托各 owner。
- §F 全部分支逐条功能验收（persona 嵌入 / `!`,`!!` / compaction 排队 vs 扩展立即 / steer 乐观渲染 / 附件 / 回滚 / onInputCallback）。
- 与 slash-dispatcher 边界清晰：submit=总分派，slash=内置命令执行。
- 死分支清除：`/memory`,`/arminsayshi`,`/resume`,`/quit` 在 submit handler 的不可达重复分支移除（feature-inventory §F 坏味）。

## References

- 管线明细：[feature-inventory.md §F](../feature-inventory.md)
- 边界对象：[UI02](./UI02-controller-plan-underscope.md)（controller 集）、slash-dispatcher
- Gate：[gates.md](../gates.md) UI-G2/G3/G5
