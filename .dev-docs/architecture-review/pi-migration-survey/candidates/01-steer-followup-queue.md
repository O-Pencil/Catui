# 候选 1：Steer / Follow-up 队列

> 来源：`pi/packages/agent/src/harness/agent-harness.ts`
> 状态：**待你拍板是否开 review**

## 它做什么

允许用户在 agent **正在执行 turn** 时插入新消息，而不是等 turn 结束。三种插入方式：

| 队列 | 触发场景 | 行为 |
|---|---|---|
| `steerQueue` | 用户要"插嘴"——打断当前 turn 的思路 | turn 边界处插入，**中断**当前思路 |
| `followUpQueue` | 用户接着当前思路追加 | turn 结束后立即开始新 turn |
| `nextTurnQueue` | 用户给的下一轮输入 | 在当前 turn **完成后**自动开始下一轮 |

每个队列有 `QueueMode`：`one-at-a-time`（每次只 drain 一条）| `all`（一次性 drain 全部）。

## pi 的实现关键

```typescript
private async drainQueuedMessages(queue: AgentMessage[], mode: QueueMode): Promise<AgentMessage[]> {
  const messages = mode === "all" ? queue.splice(0) : queue.splice(0, 1);
  if (messages.length === 0) return messages;
  try {
    await this.emitQueueUpdate();  // 通知所有订阅者
    return messages;
  } catch (error) {
    queue.unshift(...messages);  // 失败恢复
    throw normalizeHookError(error);
  }
}
```

## 候选状态

- ✅ 真读源文件
- ✅ 对照 catui 现状（`AgentSession` 无此能力）
- ⚠️ 档位：**runtime 改造**（public API 变更）

## 价值

- 高 — 当前 catui 在 turn 中**完全无法**响应用户输入；只能等 turn 结束
- 这对 sub-agent 场景特别有用：用户在等 sub-agent 的同时可以预先给指令

## 风险

| 风险 | 等级 | 说明 |
|---|---|---|
| AgentSession 并发契约变更 | **高** | 现有调用方可能假设"prompt 期间状态稳定" |
| Extension 兼容性 | 中 | 扩展可能 hook 了 prompt 流程 |
| Pending writes 状态污染 | 中 | busy 时的状态变更需要正确序列化 |
| Drain 失败的恢复语义 | 低 | pi 的 unshift 模式可参考 |
| 测试覆盖 | 高 | 需要模拟各种并发场景 |

## 落地路径

1. **必须先**：建 `harness-review/` 专项评审，写 design doc
2. 在 design doc 里回答：
   - 三个队列是否都要，还是只 steer / follow-up 两个？
   - QueueMode 默认值是什么？
   - 失败恢复语义是什么？
   - 现有的 extension hook 怎么和新队列交互？
3. **然后**：写 test case（必须有失败的）
4. **然后**：改 `core/runtime/agent-session.ts` + types
5. **最后**：跑 `verify:dip` / `tsc` / `quality` / `package-boundary`

## 不落地路径（**不能**这样）

- ❌ 直接照搬 pi 的 `AgentHarness` 类——它和 catui 的会话架构不兼容
- ❌ 不写 design doc 直接改 — 触发 catui AGENTS.md §3 的"public API 变更"
- ❌ 不写 test case 直接改 — 触发 catui AGENTS.md §5 的"TDD 门"

## 我的建议

**开 review**。这是一个**真东西**，但需要走 catui AGENTS.md `feature-workflow.md` 的完整 review 流程，不是"迁移特性"。