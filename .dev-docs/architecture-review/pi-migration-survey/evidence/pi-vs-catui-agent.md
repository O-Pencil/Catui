# Agent 层对比：pi `agent-harness.ts` vs catui `AgentSession`

## pi 的 `AgentHarness` 类（抽自 446 行代码）

```typescript
class AgentHarness {
  // === 状态 ===
  private phase: "idle" | "turn" | "compaction" | "branch_summary";
  private runAbortController?: AbortController;
  private runPromise?: Promise<void>;
  private pendingSessionWrites: PendingSessionWrite[] = [];  // busy 时排队
  private steerQueue: UserMessage[] = [];                    // ← 关键能力 1
  private steeringQueueMode: QueueMode;                       // one-at-a-time | all
  private followUpQueue: UserMessage[] = [];                 // ← 关键能力 2
  private followUpQueueMode: QueueMode;
  private nextTurnQueue: AgentMessage[] = [];                // ← 关键能力 3
  private handlers = new Map<string, Set<AgentHarnessHandler>>();

  // === 一等公民方法 ===
  async prompt(text, options?): Promise<AssistantMessage>;
  async skill(name, additionalInstructions?): Promise<AssistantMessage>;
  async promptFromTemplate(name, args?): Promise<AssistantMessage>;
  async steer(text, options?): Promise<void>;                  // ← 候选 1 的核心
  async followUp(text, options?): Promise<void>;               // ← 候选 1 的核心
  async nextTurn(text, options?): Promise<void>;
  async compact(customInstructions?): Promise<...>;
  async navigateTree(targetId, options?): Promise<NavigateTreeResult>;
  async setModel / setThinkingLevel / setTools / setActiveTools
  async abort(): Promise<AbortResult>;
  async waitForIdle(): Promise<void>;

  // === 钩子 ===
  before_provider_request    // 修改 streamOptions
  before_provider_payload    // 修改整个 payload
  after_provider_response    // 响应后置
  before_agent_start         // 在 prompt 前注入额外消息
  context                    // 转换整个 context
  tool_call                  // block / 改写 tool 调用
  tool_result                // 改写 / 终止
  session_before_compact     // 拦截 compaction
  session_before_tree        // 拦截 tree navigation
  session_compact            // compaction 完成
  queue_update               // 队列变化
  abort                      // abort 时
  settled                    // 一切完成
  save_point                 // 持久化点
}
```

## catui 的 `AgentSession` 类（来自 `core/runtime/agent-session.ts`）

`catui` 的 `AgentSession` 是**会话生命周期管理器**，主要职责：
- 包装 core `Agent` from `@catui/agent-core`
- 管理 session persistence via SessionManager
- 处理 model switching、thinking level changes
- 管理 tool execution 和 bash commands
- 协调 compaction
- **为扩展发出事件**

**它和 pi 的 `AgentHarness` 的关键差异**：

| 能力 | pi AgentHarness | catui AgentSession |
|---|---|---|
| `prompt()` / turn 入口 | ✅ | ✅ |
| `compact()` 一等公民 | ✅ | ✅（在 session/compaction/ 下） |
| 消息队列（steer / followUp / nextTurn） | ✅ | ❌ **缺失** |
| `pendingSessionWrites` busy 时排队 | ✅ | ❌ **缺失** |
| Provider 请求前钩子（streamOptions 修改） | ✅ | ❌ |
| tool_call / tool_result 改写 | ✅ | ✅（通过 extension host wrapper） |
| `navigateTree()` 一等公民 | ✅ | ✅（session forking） |
| phase 状态机（idle / turn / compaction / ...） | ✅ | 弱 |

## 候选 1 的具体内容

**只**抽 steer / follow-up / next-turn 三个队列 + QueueMode 配置 + drain 逻辑。**不**抽整个 `AgentHarness` 类。

预计改动：
- `core/runtime/agent-session.ts`：新增 `steerQueue / followUpQueue / nextTurnQueue` + 三个 public 方法
- `core/runtime/types.ts`：新增 `QueueMode` 类型
- `core/runtime/event-bus.ts`：新增 `queue_update` 事件（catui 已有事件总线）
- 测试：模拟"turn 中用户发了 steer / followUp"场景

## 风险

| 风险 | 等级 | 缓解 |
|---|---|---|
| 改 AgentSession 并发契约 | 高 | 必须先写 design doc，再写 test case，再写代码 |
| extension 兼容性 | 中 | 现有扩展通过 `event-bus` 订阅，新增事件是加法不是改法 |
| `drainQueuedMessages` 的失败恢复（unshift 恢复） | 低 | pi 已经验证过模式 |
| 多 turn 间状态污染 | 中 | 用 phase 状态机保证 idle 时才能修改 |

## 档位判定（按 catui `feature-workflow.md` §3）

- ✅ load-bearing 区（runtime 核心）
- ✅ public API 变更（AgentSession 接口）
- ⚠️ 无明确 owner

**结论**：必须**先建 `harness-review/` 专项评审**再动手，**不能**直接 commit。