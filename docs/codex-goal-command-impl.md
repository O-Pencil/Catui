# Codex `/goal` 命令实现：抽丝剥骨的完整逻辑

> 目标：一个笨模型读完本文档后，能在 TypeScript 下完整复刻 Codex 的 `/goal` 命令。
> 所有逻辑均来自 OpenAI Codex CLI 源码（`codex-rs/`），逐行提取，零猜测。

---

## 一、Goal 是什么

Goal 是 Codex 的**长期任务管理机制**。用户通过 `/goal <objective>` 设置一个目标，agent 会在 idle 时自动继续工作，直到：
- 目标完成（agent 调用 `update_goal` 标记 `complete`）
- token 预算耗尽（系统自动标记 `budget_limited`）
- 被用户暂停（`/goal pause`）
- agent 判断被阻塞（agent 调用 `update_goal` 标记 `blocked`）
- 用量限制（系统标记 `usage_limited`）

**关键特性**：Goal 持跨 turn 存活。一个 goal 可能驱动数十个 turn 的自动续作。

---

## 二、数据模型

### 2.1 状态枚举

```typescript
type ThreadGoalStatus =
  | "active"          // 正在执行
  | "paused"          // 用户暂停
  | "blocked"         // agent 判断阻塞（需 3 次连续阻塞 turn 才标记）
  | "usage_limited"   // 系统用量限制
  | "budget_limited"  // token 预算耗尽（终态）
  | "complete";       // 完成（终态）
```

**分类**：
- `is_active()`: `status === "active"`
- `is_terminal()`: `status === "budget_limited" || status === "complete"`

### 2.2 Goal 实体

```typescript
interface ThreadGoal {
  thread_id: string;          // 所属会话 ID
  goal_id: string;            // UUID v4，每次 replace/insert 生成新 ID
  objective: string;          // 用户设定的目标描述
  status: ThreadGoalStatus;
  token_budget: number | null; // token 预算上限，null 表示无限
  tokens_used: number;        // 已消耗 token 数
  time_used_seconds: number;  // 已消耗时间（秒）
  created_at: number;         // epoch 毫秒
  updated_at: number;         // epoch 毫秒
}
```

### 2.3 数据库表

```sql
CREATE TABLE thread_goals (
    thread_id TEXT PRIMARY KEY NOT NULL,
    goal_id TEXT NOT NULL,
    objective TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN (
        'active', 'paused', 'blocked',
        'usage_limited', 'budget_limited', 'complete'
    )),
    token_budget INTEGER,           -- nullable
    tokens_used INTEGER NOT NULL DEFAULT 0,
    time_used_seconds INTEGER NOT NULL DEFAULT 0,
    created_at_ms INTEGER NOT NULL, -- epoch 毫秒
    updated_at_ms INTEGER NOT NULL  -- epoch 毫秒
);
```

**关键约束**：`thread_id` 是主键，每个 thread 最多一个 goal。

---

## 三、命令解析

### 3.1 命令格式

```
/goal                          → 显示当前 goal 摘要菜单
/goal <objective>              → 设置/替换 goal
/goal clear                    → 清除 goal
/goal edit                     → 打开编辑器修改 objective
/goal pause                    → 暂停 goal
/goal resume                   → 恢复 paused goal
```

### 3.2 解析逻辑（伪代码）

```typescript
function dispatchGoalCommand(input: string, threadId: string | null): void {
  // 特性门禁检查
  if (!features.enabled("Goals")) return;

  const trimmed = input.trim();

  // 裸 /goal → 显示菜单
  if (trimmed === "") {
    if (threadId) {
      emit(AppEvent.OpenThreadGoalMenu, { threadId });
    } else {
      showInfo(GOAL_USAGE, "No goal is currently set.");
    }
    return;
  }

  // 子命令分派
  const lower = trimmed.toLowerCase();

  if (lower === "clear") {
    if (!threadId) { showUsage(); return; }
    emit(AppEvent.ClearThreadGoal, { threadId });
    return;
  }

  if (lower === "edit") {
    emit(AppEvent.OpenThreadGoalEditor, { threadId });
    return;
  }

  if (lower === "pause") {
    if (!threadId) { showUsage(); return; }
    emit(AppEvent.SetThreadGoalStatus, { threadId, status: "paused" });
    return;
  }

  if (lower === "resume") {
    if (!threadId) { showUsage(); return; }
    emit(AppEvent.SetThreadGoalStatus, { threadId, status: "active" });
    return;
  }

  // 其余文本 → 当作 objective
  const objective = trimmed;
  if (objective === "") {
    showError("Goal objective must not be empty.");
    return;
  }

  // 长度验证
  if (objective.length > MAX_THREAD_GOAL_OBJECTIVE_CHARS) {
    showError(`Goal objective is too long: ${objective.length} characters. Limit: ${MAX_THREAD_GOAL_OBJECTIVE_CHARS}.`);
    return;
  }

  if (!threadId) {
    // session 未启动，排队等待
    queueUserMessage(`/goal ${input}`, QueuedInputAction.ParseSlash);
    return;
  }

  emit(AppEvent.SetThreadGoalObjective, {
    threadId,
    objective,
    mode: "ConfirmIfExists",
  });
}
```

---

## 四、核心操作流程

### 4.1 设置 Goal（`SetThreadGoalObjective`）

这是最复杂的操作。流程如下：

```
用户输入 /goal <objective>
    ↓
解析为 SetThreadGoalObjective { threadId, objective, mode: "ConfirmIfExists" }
    ↓
set_thread_goal_objective()
    ↓
┌─ mode === "ConfirmIfExists"?
│   ├─ YES → 读取现有 goal
│   │   ├─ 有 goal 且非 Complete → 弹出确认对话框 "Replace goal?"
│   │   │   ├─ 用户选 "Replace" → 重新发送 SetThreadGoalObjective { mode: "ReplaceExisting" }
│   │   │   └─ 用户选 "Cancel" → 结束
│   │   ├─ 有 goal 且是 Complete → 直接 ReplaceExisting（不需确认）
│   │   └─ 无 goal → 保持 ConfirmIfExists
│   └─ NO → 继续
│
├─ mode === "ReplaceExisting"?
│   ├─ YES → 先调用 thread_goal_clear() 删除旧 goal
│   └─ NO → 继续
│
├─ 确定 status 和 token_budget:
│   ├─ ConfirmIfExists / ReplaceExisting → (Active, null)
│   └─ UpdateExisting → (status, token_budget)
│
├─ 调用 app_server.thread_goal_set(threadId, objective, status, token_budget)
│   ↓
│   GoalService.set_thread_goal()
│       ↓
│       1. 验证 objective（trim + 长度检查）
│       2. 验证 token_budget（必须 > 0 如果提供）
│       3. 获取 runtime 的 goal_state_permit（防止 idle 续作冲突）
│       4. prepare_external_goal_mutation()
│       ↓
│       ┌─ 有 objective?
│       │   ├─ 读取现有 goal
│       │   │   ├─ 有 → update_thread_goal()（用 expected_goal_id 乐观锁）
│       │   │   └─ 无 → replace_thread_goal()（INSERT OR REPLACE，重置 usage）
│       │   └─ 无 objective?
│       │       ├─ 读取现有 goal（必须存在）
│       │       └─ update_thread_goal()（只改 status/budget）
│       ↓
│       5. 如果改了 objective → fill_empty_thread_preview_if_possible()
│       6. 返回 GoalSetOutcome
│
└─ 显示结果: "Goal active" + usage summary
```

### 4.2 清除 Goal（`ClearThreadGoal`）

```
用户输入 /goal clear
    ↓
clear_thread_goal()
    ↓
1. 获取 goal_state_permit
2. prepare_external_goal_mutation()
3. delete_thread_goal(thread_id) → DELETE FROM thread_goals WHERE thread_id = ?
4. 释放 permit
5. apply_external_goal_clear() → 清除 runtime 状态
6. 返回 cleared: boolean
```

### 4.3 暂停/恢复（`SetThreadGoalStatus`）

```
用户输入 /goal pause 或 /goal resume
    ↓
set_thread_goal_status(thread_id, status)
    ↓
app_server.thread_goal_set(thread_id, null, status, null)
    ↓
GoalService.set_thread_goal() → 只更新 status 字段
```

**暂停的特殊语义**：
- `pause_active_thread_goal()` 只更新 `status = 'active'` 的行
- 但如果目标是 `usage_limited`，也允许更新为 `paused`（覆盖 `budget_limited`）

### 4.4 编辑 Goal（`OpenThreadGoalEditor`）

```
用户输入 /goal edit
    ↓
1. 读取现有 goal
2. 如果无 goal → 显示 "No goal is currently set."
3. 有 goal → 显示编辑器，预填当前 objective
4. 用户提交 → 发送 SetThreadGoalObjective { mode: "UpdateExisting", status, token_budget }
```

**关键逻辑**：编辑时保留原始 status，除非原 status 是 `budget_limited` 或 `complete`，此时重置为 `active`：

```typescript
function editedGoalStatus(status: ThreadGoalStatus): ThreadGoalStatus {
  switch (status) {
    case "active": return "active";
    case "paused":
    case "blocked":
    case "usage_limited": return status;  // 保留
    case "budget_limited":
    case "complete": return "active";     // 重置
  }
}
```

### 4.5 显示 Goal 摘要（`/goal` 裸命令）

```
/goal
    ↓
open_thread_goal_menu()
    ↓
1. app_server.thread_goal_get(thread_id)
2. 无 goal → 显示 GOAL_USAGE + "No goal is currently set."
3. 有 goal → show_goal_summary(goal):
   ┌─────────────────────────────────┐
   │ Goal                            │
   │ Status: active                  │
   │ Objective: Fix the bug in auth  │
   │ Time used: 2m                   │
   │ Tokens used: 12.5K              │
   │ Token budget: 50K               │
   │                                 │
   │ Commands: /goal edit,           │
   │           /goal pause,          │
   │           /goal clear           │
   └─────────────────────────────────┘
```

---

## 五、数据库操作详解

### 5.1 `replace_thread_goal` — 创建/完全替换

```typescript
async function replace_thread_goal(
  threadId: string,
  objective: string,
  status: ThreadGoalStatus,
  tokenBudget: number | null
): Promise<ThreadGoal> {
  const goalId = uuid();
  const now = Date.now();
  // 如果 status 是 active 但预算已耗尽，立即降级
  status = statusAfterBudgetLimit(status, 0, tokenBudget);

  // INSERT OR REPLACE：重置所有 usage 计数
  await db.run(`
    INSERT INTO thread_goals (thread_id, goal_id, objective, status,
      token_budget, tokens_used, time_used_seconds, created_at_ms, updated_at_ms)
    VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)
    ON CONFLICT(thread_id) DO UPDATE SET
      goal_id = excluded.goal_id,
      objective = excluded.objective,
      status = excluded.status,
      token_budget = excluded.token_budget,
      tokens_used = 0,
      time_used_seconds = 0,
      created_at_ms = excluded.created_at_ms,
      updated_at_ms = excluded.updated_at_ms
  `, [threadId, goalId, objective, status, tokenBudget, now, now]);

  return get_thread_goal(threadId);
}
```

### 5.2 `insert_thread_goal` — 仅在 goal 已完成时替换

```typescript
async function insert_thread_goal(
  threadId: string,
  objective: string,
  status: ThreadGoalStatus,
  tokenBudget: number | null
): Promise<ThreadGoal | null> {
  const goalId = uuid();
  const now = Date.now();
  status = statusAfterBudgetLimit(status, 0, tokenBudget);

  // 关键区别：WHERE thread_goals.status = 'complete'
  // 只有已完成的 goal 才会被替换
  const result = await db.run(`
    INSERT INTO thread_goals (...)
    VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)
    ON CONFLICT(thread_id) DO UPDATE SET
      ...
    WHERE thread_goals.status = 'complete'
  `, [...]);

  // 如果 affected rows === 0，说明有未完成的 goal，返回 null
  return result.changes > 0 ? get_thread_goal(threadId) : null;
}
```

### 5.3 `update_thread_goal` — 增量更新

```typescript
async function update_thread_goal(
  threadId: string,
  update: {
    objective?: string;
    status?: ThreadGoalStatus;
    tokenBudget?: number | null;  // null = 不改, Some(null) = 清除
    expectedGoalId?: string;      // 乐观锁
  }
): Promise<ThreadGoal | null> {
  const now = Date.now();

  // 核心 SQL 逻辑（简化版）:
  await db.run(`
    UPDATE thread_goals SET
      objective = COALESCE(?, objective),
      status = CASE
        -- 如果当前是 budget_limited 且新 status 是 paused/blocked，保留当前
        WHEN status = 'budget_limited' AND ? IN ('paused', 'blocked') THEN status
        -- 如果新 status 是 active 且预算已超，强制 budget_limited
        WHEN ? = 'active' AND token_budget IS NOT NULL AND tokens_used >= token_budget
          THEN 'budget_limited'
        ELSE ?
      END,
      token_budget = ?,  -- 如果提供
      updated_at_ms = ?
    WHERE thread_id = ?
      AND (? IS NULL OR goal_id = ?)  -- 乐观锁
  `, [...]);

  if (result.changes === 0) return null;
  return get_thread_goal(threadId);
}
```

### 5.4 `account_thread_goal_usage` — 记账（最关键）

每次 turn 结束或 tool 完成时调用，累加 token 和时间。

```typescript
async function account_thread_goal_usage(
  threadId: string,
  timeDeltaSeconds: number,  // ≥ 0
  tokenDelta: number,        // ≥ 0
  mode: GoalAccountingMode,
  expectedGoalId?: string
): Promise<GoalAccountingOutcome> {
  // 零增量直接返回
  if (timeDeltaSeconds === 0 && tokenDelta === 0) {
    return { kind: "Unchanged", goal: await get_thread_goal(threadId) };
  }

  // mode 决定哪些 status 的 goal 会被更新
  const statusFilter = {
    ActiveStatusOnly: "status = 'active'",
    ActiveOnly: "status IN ('active', 'budget_limited')",
    ActiveOrComplete: "status IN ('active', 'budget_limited', 'complete')",
    ActiveOrStopped: "status IN ('active', 'paused', 'blocked', 'usage_limited', 'budget_limited')",
  }[mode];

  // 预算限制检查的 status 范围
  const budgetCheckFilter = {
    ActiveStatusOnly: "status = 'active'",
    ActiveOnly: "status = 'active'",
    ActiveOrComplete: "status = 'active'",
    ActiveOrStopped: "status IN ('active', 'paused', 'blocked', 'usage_limited', 'budget_limited')",
  }[mode];

  const result = await db.run(`
    UPDATE thread_goals SET
      time_used_seconds = time_used_seconds + ?,
      tokens_used = tokens_used + ?,
      status = CASE
        WHEN ${budgetCheckFilter}
          AND token_budget IS NOT NULL
          AND tokens_used + ? >= token_budget
        THEN 'budget_limited'
        ELSE status
      END,
      updated_at_ms = ?
    WHERE thread_id = ? AND ${statusFilter}
      ${expectedGoalId ? "AND goal_id = ?" : ""}
    RETURNING *
  `, [...]);

  if (result.changes === 0) {
    return { kind: "Unchanged", goal: await get_thread_goal(threadId) };
  }
  return { kind: "Updated", goal: rowToGoal(result.row) };
}
```

### 5.5 `statusAfterBudgetLimit` — 预算检查辅助

```typescript
function statusAfterBudgetLimit(
  status: ThreadGoalStatus,
  tokensUsed: number,
  tokenBudget: number | null
): ThreadGoalStatus {
  if (status === "active" && tokenBudget !== null && tokensUsed >= tokenBudget) {
    return "budget_limited";
  }
  return status;
}
```

---

## 六、自动续作机制（Idle Continuation）

这是 Goal 的核心魔法：当 agent 完成一个 turn 后 idle 时，如果有 active goal，会自动注入续作 prompt 继续工作。

### 6.1 触发链路

```
Agent turn 结束
    ↓
on_thread_idle()
    ↓
runtime.continue_if_idle()
    ↓
1. 检查 goal 是否 active
2. 读取 goal 状态
3. 注入 continuation prompt
4. 触发新 turn
```

### 6.2 续作 Prompt（continuation.md）

```
Continue working toward the active thread goal.

<objective>
{{ objective }}
</objective>

Continuation behavior:
- This goal persists across turns. Ending this turn does not require
  shrinking the objective to what fits now.
- Keep the full objective intact. If it cannot be finished now, make
  concrete progress toward the real requested end state, leave the
  goal active, and do not redefine success around a smaller or easier task.
- Temporary rough edges are acceptable while the work is moving in
  the right direction. Completion still requires the requested end state
  to be true and verified.

Budget:
- Tokens used: {{ tokens_used }}
- Token budget: {{ token_budget }}
- Tokens remaining: {{ remaining_tokens }}

Work from evidence:
Use the current worktree and external state as authoritative.

Fidelity:
- Optimize each turn for movement toward the requested end state.
- Do not substitute a narrower, safer, smaller solution.

Completion audit:
Before deciding that the goal is achieved, treat completion as unproven
and verify it against the actual current state:
- Derive concrete requirements from the objective.
- Preserve the original scope; do not redefine success.
- For every explicit requirement, identify authoritative evidence.
- Treat uncertain or indirect evidence as not achieved.
- Mark complete only when current evidence proves every requirement.

Blocked audit:
- Do not call update_goal with "blocked" the first time a blocker appears.
- Only use "blocked" when the same condition has repeated for 3+ consecutive turns.
- Never use "blocked" merely because work is hard or slow.
```

### 6.3 Budget Limit Prompt（budget_limit.md）

当 token 预算耗尽时注入：

```
The active thread goal has reached its token budget.

<objective>
{{ objective }}
</objective>

Budget:
- Time spent: {{ time_used_seconds }} seconds
- Tokens used: {{ tokens_used }}
- Token budget: {{ token_budget }}

The system has marked the goal as budget_limited, so do not start new
substantive work for this goal. Wrap up this turn soon: summarize useful
progress, identify remaining work or blockers, and leave the user with
a clear next step.

Do not call update_goal unless the goal is actually complete.
```

---

## 七、扩展系统集成（Extension）

### 7.1 工具注册

Goal 扩展注册了 3 个 LLM 工具：

| 工具名 | 用途 | 谁调用 |
|--------|------|--------|
| `get_goal` | 读取当前 goal | LLM |
| `create_goal` | 创建新 goal | LLM（仅用户明确要求时） |
| `update_goal` | 更新 goal status | LLM（仅 complete 或 blocked） |

**关键约束**：LLM 只能标记 `complete` 或 `blocked`，不能 `pause`/`resume`/`budget_limited`。

### 7.2 工具 Schema

```typescript
// get_goal: 无参数
const getGoalTool = {
  name: "get_goal",
  description: "Get the current goal for this thread...",
  parameters: { type: "object", properties: {}, required: [] },
};

// create_goal
const createGoalTool = {
  name: "create_goal",
  description: "Create a goal only when explicitly requested...",
  parameters: {
    type: "object",
    properties: {
      objective: { type: "string", description: "Required. The concrete objective..." },
      token_budget: { type: "integer", description: "Positive token budget..." },
    },
    required: ["objective"],
  },
};

// update_goal
const updateGoalTool = {
  name: "update_goal",
  description: "Update the existing goal. Use only to mark complete or blocked...",
  parameters: {
    type: "object",
    properties: {
      status: {
        type: "string",
        enum: ["complete", "blocked"],
        description: "Set to 'complete' only when objective is achieved...",
      },
    },
    required: ["status"],
  },
};
```

### 7.3 工具执行逻辑

#### `create_goal` 执行

```typescript
async function handleCreateGoal(args: { objective: string; token_budget?: number }) {
  args.objective = args.objective.trim();
  validateObjective(args.objective);
  validateBudget(args.token_budget);

  // insert_thread_goal：只有已完成的 goal 才会被替换
  const goal = await db.insert_thread_goal(
    threadId, args.objective, "active", args.token_budget
  );

  if (!goal) {
    throw new Error("cannot create a new goal because this thread has an unfinished goal");
  }

  // 设置线程预览（如果为空）
  await fillEmptyThreadPreview(threadId, goal.objective);

  // 标记当前 turn 的 goal 为活跃
  accounting.markCurrentTurnGoalActive(goal.goal_id);

  return goalResponse(goal);
}
```

#### `update_goal` 执行

```typescript
async function handleUpdateGoal(args: { status: "complete" | "blocked" }) {
  // 先记账当前进度
  await accountActiveGoalProgress(
    args.status === "complete" ? "ActiveOrComplete" : "ActiveOrStopped",
    callId,
    BudgetLimitedGoalDisposition.ClearActive
  );

  // 更新 status
  const goal = await db.update_thread_goal(threadId, {
    status: args.status,
    expectedGoalId: null,  // 不需要乐观锁
  });

  if (!goal) throw new Error("cannot update goal because this thread has no goal");

  // 清除当前 turn 的 goal 活跃标记
  accounting.clearCurrentTurnGoal();

  // complete 时附带 usage 报告
  return goalResponse(goal, args.status === "complete" ? "Include" : "Omit");
}
```

### 7.4 生命周期钩子

```typescript
// turn 开始时
on_turn_start(turnId) {
  accounting.start_turn(turnId, mode, tokenUsageAtStart);
  if (mode === "Plan") {
    accounting.clearCurrentTurnGoal();  // Plan mode 不计 goal
    return;
  }
  const goal = await db.get_thread_goal(threadId);
  if (goal && (goal.status === "active" || goal.status === "budget_limited")) {
    accounting.markTurnGoalActive(turnId, goal.goal_id);
  }
}

// turn 结束时
on_turn_stop(turnId) {
  await accountActiveGoalProgress(turnId, "ActiveOnly", ClearActive);
  accounting.finishTurn(turnId);
}

// token 使用时
on_token_usage(tokenUsage) {
  accounting.recordTokenUsage(turnId, tokenUsage.total);
}

// tool 完成时
on_tool_finish(toolName, outcome) {
  // 只有 Completed 和 Failed(handler_executed=true) 才计数
  // 跳过 update_goal 工具本身
  if (!shouldCount(outcome) || toolName === "update_goal") return;

  const progress = await accountActiveGoalProgress(turnId, "ActiveOnly", KeepActive);

  // 如果刚变为 budget_limited，注入 budget limit steering prompt
  if (progress.goal.status === "budget_limited") {
    if (accounting.markBudgetLimitReportedIfNew(progress.goal_id)) {
      injectSteeringItem(budgetLimitSteeringItem(progress.goal));
    }
  }
}

// thread idle 时（自动续作触发点）
on_thread_idle() {
  await runtime.continue_if_idle();
}

// turn 出错时
on_turn_error(error) {
  if (error === "UsageLimitExceeded") {
    await stopActiveGoal("UsageLimit");  // → usage_limited
  } else {
    await stopActiveGoal("TurnError");   // → blocked
  }
}
```

---

## 八、Token 记账详解（Accounting）

### 8.1 记账状态

```typescript
interface GoalAccountingState {
  currentTurnId: string | null;
  turns: Map<string, GoalTurnAccounting>;
  wallClock: GoalWallClockAccounting;
  budgetLimitReportedGoalId: string | null;
}

interface GoalTurnAccounting {
  currentTokenUsage: TokenUsage;      // 当前累积
  lastAccountedTokenUsage: TokenUsage; // 上次记账时的快照
  activeGoalId: string | null;
  accountTokens: boolean;
}

interface GoalWallClockAccounting {
  lastAccountedAt: number;  // Instant
  activeGoalId: string | null;
}
```

### 8.2 记账流程

```
Tool 完成 / Turn 结束
    ↓
accountActiveGoalProgress(turnId, mode, budgetDisposition)
    ↓
1. 获取 progress_accounting_lock（Semaphore，防止并发记账）
2. progress_snapshot(turnId):
   - 计算 token_delta = currentTokenUsage.total - lastAccountedTokenUsage.total
   - 计算 time_delta = now - lastAccountedAt
   - 返回 { expectedGoalId, timeDelta, tokenDelta }
3. db.account_thread_goal_usage(threadId, timeDelta, tokenDelta, mode, expectedGoalId)
4. markProgressAccountedForStatus(turnId, snapshot, newStatus, disposition)
   - 更新 lastAccountedTokenUsage
   - 更新 lastAccountedAt
   - 如果 budget_limited 且 disposition === ClearActive → 清除 activeGoalId
```

### 8.3 记账模式

| 模式 | 用途 | 影响的 status |
|------|------|---------------|
| `ActiveStatusOnly` | turn 中的 token 追踪 | 仅 `active` |
| `ActiveOnly` | turn 结束/tool 完成 | `active`, `budget_limited` |
| `ActiveOrComplete` | 标记 complete 时的最终记账 | `active`, `budget_limited`, `complete` |
| `ActiveOrStopped` | 标记 blocked 时的记账 | 所有非终态 |

---

## 九、UI 显示逻辑

### 9.1 时间格式化

```typescript
function formatGoalElapsedSeconds(seconds: number): string {
  seconds = Math.max(0, seconds);
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return `${days}d ${remainingHours}h ${remainingMinutes}m`;
  }

  if (remainingMinutes === 0) return `${hours}h`;
  return `${hours}h ${remainingMinutes}m`;
}
```

### 9.2 Status Line 指示器

```typescript
function goalStatusIndicator(goal: GoalStatusState, now: Instant): GoalStatusIndicator | null {
  switch (goal.status) {
    case "active":
      // 如果有活跃 turn，加上当前 turn 的 elapsed time
      let displayGoal = { ...goal };
      if (activeTurnStartedAt) {
        const baseline = Math.max(goal.observedAt, activeTurnStartedAt);
        const activeSeconds = (now - baseline) / 1000;
        displayGoal.time_used_seconds += activeSeconds;
      }
      return {
        type: "Active",
        usage: goal.token_budget
          ? `${formatTokens(goal.tokens_used)} / ${formatTokens(goal.token_budget)}`
          : formatGoalElapsedSeconds(displayGoal.time_used_seconds),
      };
    case "paused": return { type: "Paused" };
    case "blocked": return { type: "Blocked" };
    case "usage_limited": return { type: "UsageLimited" };
    case "budget_limited":
      return {
        type: "BudgetLimited",
        usage: goal.token_budget
          ? `${formatTokens(goal.tokens_used)} / ${formatTokens(goal.token_budget)} tokens`
          : null,
      };
    case "complete":
      return {
        type: "Complete",
        usage: goal.token_budget
          ? `${formatTokens(goal.tokens_used)} tokens`
          : formatGoalElapsedSeconds(goal.time_used_seconds),
      };
  }
}
```

### 9.3 替换确认对话框

当用户 `/goal <new objective>` 且已有未完成 goal 时：

```typescript
function shouldConfirmBeforeReplacing(goal: ThreadGoal): boolean {
  // Complete 是终态，不需要确认
  if (goal.status === "complete") return false;
  // 其他所有状态都需要确认
  return true;
}

// 弹出选择:
// ┌─────────────────────────────────┐
// │ Replace goal?                   │
// │ New objective: <new objective>  │
// │                                 │
// │ > Replace current goal          │
// │   Set the new objective now     │
// │   Cancel                        │
// │   Keep the current goal         │
// └─────────────────────────────────┘
```

---

## 十、完整状态机

```
                    ┌──────────────────────────────┐
                    │         无 Goal               │
                    └──────────┬───────────────────┘
                               │ /goal <objective>
                               │ create_goal()
                               ▼
                    ┌──────────────────────────────┐
                    │           ACTIVE              │
                    │  (自动续作中)                  │
                    └──┬────┬────┬────┬────┬───────┘
                       │    │    │    │    │
            /goal pause│    │    │    │    │ update_goal(blocked)
                       │    │    │    │    │ (3次连续阻塞后)
                       ▼    │    │    │    ▼
                ┌────────┐  │    │    │ ┌─────────┐
                │ PAUSED │  │    │    │ │ BLOCKED │
                └───┬────┘  │    │    │ └────┬────┘
                    │       │    │    │      │
         /goal resume       │    │    │      │ /goal resume
                    │       │    │    │      │
                    ▼       │    │    │      ▼
                    ┌──────────────────────────────┐
                    │           ACTIVE              │◄──── /goal resume
                    └──┬────┬────┬────┬────┬───────┘      (从 paused/blocked/
                       │    │    │    │    │                usage_limited 恢复)
            超预算      │    │    │    │    │
                       ▼    │    │    │    │
              ┌────────────┐│    │    │    │
              │ BUDGET_    ││    │    │    │
              │ LIMITED    ││    │    │    │
              │ (终态)     ││    │    │    │
              └────────────┘│    │    │    │
                            │    │    │    │
           usage limit      │    │    │    │
                            ▼    │    │    │
                  ┌──────────────┐│    │    │
                  │ USAGE_       ││    │    │
                  │ LIMITED      ││    │    │
                  └──────────────┘│    │    │
                                  │    │    │
              update_goal         │    │    │
              (complete)          │    │    │
                                  ▼    │    │
                        ┌──────────────┐│    │
                        │   COMPLETE   ││    │
                        │   (终态)     ││    │
                        └──────────────┘│    │
                                        │    │
                         /goal clear    │    │
                                        ▼    │
                              ┌──────────────┐
                              │   无 Goal    │
                              └──────────────┘
```

---

## 十一、TypeScript 复刻清单

如果要从零实现，按以下顺序：

### 11.1 数据层

- [ ] 定义 `ThreadGoalStatus` 类型（6 个值）
- [ ] 定义 `ThreadGoal` 接口（9 个字段）
- [ ] 建表 SQL（`thread_goals`，10 列）
- [ ] 实现 `GoalStore` 类：
  - `get_goal(threadId)` → SELECT
  - `replace_goal(threadId, objective, status, tokenBudget)` → INSERT OR REPLACE（重置 usage）
  - `insert_goal(threadId, objective, status, tokenBudget)` → INSERT OR REPLACE（仅 status=complete 时覆盖）
  - `update_goal(threadId, update)` → UPDATE（带乐观锁 + 预算自动降级）
  - `delete_goal(threadId)` → DELETE
  - `account_usage(threadId, timeDelta, tokenDelta, mode, expectedGoalId)` → UPDATE（累加 + 预算检查）
  - `pause_active_goal(threadId)` → UPDATE status WHERE active
  - `usage_limit_active_goal(threadId)` → UPDATE status WHERE active OR budget_limited

### 11.2 命令层

- [ ] 命令解析：`/goal [clear|edit|pause|resume|<objective>]`
- [ ] 长度验证：objective 不超过 MAX_CHARS
- [ ] 子命令分派：clear/edit/pause/resume/设置
- [ ] ConfirmIfExists 逻辑：读取现有 → 非 Complete 弹确认
- [ ] ReplaceExisting 逻辑：先 clear 再 set

### 11.3 工具层

- [ ] `get_goal` 工具：无参数，返回当前 goal
- [ ] `create_goal` 工具：参数 { objective, token_budget? }
  - 验证 objective 非空
  - 验证 budget > 0
  - 调用 insert_goal（未完成 goal 存在时报错）
  - 标记当前 turn goal 活跃
- [ ] `update_goal` 工具：参数 { status: "complete"|"blocked" }
  - 先记账当前进度
  - 更新 status
  - 清除 turn goal 活跃标记

### 11.4 生命周期层

- [ ] `on_turn_start`：读取 goal，标记活跃
- [ ] `on_turn_stop`：记账 + 清除
- [ ] `on_turn_abort`：记账 + 清除
- [ ] `on_turn_error`：停止 goal（usage_limited 或 blocked）
- [ ] `on_token_usage`：记录 token 增量
- [ ] `on_tool_finish`：记账 + budget_limited 时注入 steering prompt
- [ ] `on_thread_idle`：注入 continuation prompt，触发新 turn

### 11.5 Prompt 层

- [ ] `continuation_prompt(goal)`：续作指令（含 objective、budget、completion audit、blocked audit）
- [ ] `budget_limit_prompt(goal)`：预算耗尽收尾指令
- [ ] `objective_updated_prompt(goal)`：objective 编辑后的新指令
- [ ] 三个模板的变量替换：`{{ objective }}`, `{{ tokens_used }}`, `{{ token_budget }}`, `{{ remaining_tokens }}`, `{{ time_used_seconds }}`

### 11.6 UI 层

- [ ] `formatGoalElapsedSeconds(seconds)`：时间格式化（s/m/h/d）
- [ ] `goalStatusLabel(status)`：状态文本
- [ ] `goalUsageSummary(goal)`：一行摘要
- [ ] `goalSummaryLines(goal)`：多行详情 + 可用命令提示
- [ ] `goalStatusIndicator(goal, now, activeTurnStartedAt)`：status line 指示器
- [ ] `shouldConfirmBeforeReplacing(goal)`：替换确认判断
- [ ] `editedGoalStatus(status)`：编辑时的状态保留/重置逻辑
- [ ] 临时会话错误消息

### 11.7 边界条件

- [ ] 临时会话（ephemeral）不支持 goal → 错误消息引导用户
- [ ] Plan mode 不计 goal
- [ ] Review subagent 不注册 goal 工具
- [ ] 并发记账用 Semaphore 保护
- [ ] `expected_goal_id` 乐观锁防止并发更新冲突
- [ ] `budget_limited` 是终态，不被 pause/blocked 覆盖（但可被 resume 从 paused/blocked 恢复）
- [ ] `usage_limited` 可以被 pause 覆盖
- [ ] turn 期间 idle continuation 不能与外部 goal mutation 冲突（goal_state_permit）

---

## 十二、源码文件索引

| 文件 | 职责 |
|------|------|
| `state/src/model/thread_goal.rs` | 数据模型（ThreadGoal, ThreadGoalStatus, ThreadGoalRow） |
| `state/src/runtime/goals.rs` | 数据库操作（GoalStore, GoalUpdate, GoalAccountingMode） |
| `state/goals_migrations/0001_thread_goals.sql` | 建表 SQL |
| `ext/goal/src/lib.rs` | 模块导出 |
| `ext/goal/src/api.rs` | GoalService（TUI↔DB 桥梁） |
| `ext/goal/src/extension.rs` | 生命周期钩子注册（ThreadLifecycle, TurnLifecycle, TokenUsage, Tool） |
| `ext/goal/src/tool.rs` | LLM 工具执行（get/create/update_goal） |
| `ext/goal/src/spec.rs` | 工具 Schema 定义 |
| `ext/goal/src/accounting.rs` | Token/时间记账状态机 |
| `ext/goal/src/steering.rs` | Prompt 模板渲染 + steering 注入 |
| `ext/goal/src/runtime.rs` | GoalRuntimeHandle（线程级 runtime） |
| `ext/goal/src/events.rs` | 事件发射 |
| `ext/goal/src/analytics.rs` | 分析事件 |
| `ext/goal/src/metrics.rs` | 指标上报 |
| `prompts/templates/goals/continuation.md` | 续作 prompt 模板 |
| `prompts/templates/goals/budget_limit.md` | 预算耗尽 prompt 模板 |
| `prompts/templates/goals/objective_updated.md` | objective 编辑 prompt 模板 |
| `tui/src/slash_command.rs` | 命令注册（Goal 枚举变体） |
| `tui/src/chatwidget/slash_dispatch.rs` | 命令分派 |
| `tui/src/app_event.rs` | AppEvent 定义（5 个 goal 相关事件） |
| `tui/src/app/thread_goal_actions.rs` | TUI 层 goal 操作实现 |
| `tui/src/goal_display.rs` | 显示工具函数 |
| `tui/src/chatwidget/goal_menu.rs` | 摘要菜单 UI |
| `tui/src/chatwidget/goal_validation.rs` | objective 验证 |
| `tui/src/chatwidget/goal_status.rs` | Status line 指示器 |
| `app-server/src/request_processors/thread_goal_processor.rs` | JSON-RPC 处理器 |
