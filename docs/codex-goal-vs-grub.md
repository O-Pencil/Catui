# Codex `/goal` vs nanoPencil `/grub`：同源异流的长期任务机制

> 两个系统解决同一个问题：让 AI agent 自主迭代完成复杂任务。
> 但设计哲学、实现路径和约束模型截然不同。

---

## 一、一句话概括

| | Codex `/goal` | nanoPencil `/grub` |
|---|---|---|
| **核心理念** | "设个目标，我 idle 时自动继续" | "设个目标，我每轮严格推进一个 feature" |
| **控制粒度** | token 预算 + 时间 | 迭代轮次 + 连续失败次数 |
| **完成判定** | LLM 自己说了算（但有 completion audit prompt） | feature-list.json 所有项 passes:true 才算完成 |
| **持久化** | SQLite（进程内） | 文件系统（.grub/ 目录） |

---

## 二、命令对比

### 2.1 命令格式

| 操作 | Codex `/goal` | nanoPencil `/grub` |
|------|--------------|-------------------|
| 设置目标 | `/goal <objective>` | `/grub <goal>` |
| 查看状态 | `/goal`（显示摘要菜单） | `/grub status` 或 `/grub status --json` |
| 暂停 | `/goal pause` | 无（只有 stop） |
| 恢复 | `/goal resume` | `/grub resume` |
| 停止 | `/goal clear` | `/grub stop` |
| 编辑 | `/goal edit` | 无（stop 后重新 start） |
| 帮助 | 无（直接显示 usage） | `/grub help` |
| 限制参数 | token_budget（LLM 工具设置） | `--max-iter N`, `--max-fail N` |

### 2.2 命令解析

**Codex**：在 TUI 层解析，通过 `AppEvent` 事件总线分派到 `App` 层的 `thread_goal_actions`。

**nanoPencil**：在扩展层解析，`parseGrubCommand()` 返回类型化的命令对象：

```typescript
type ParsedGrubCommand =
  | { type: "start"; goal: string; maxIterations?: number; maxConsecutiveFailures?: number }
  | { type: "status"; json?: boolean }
  | { type: "stop" }
  | { type: "resume" }
  | { type: "help"; reason?: string };
```

---

## 三、数据模型对比

### 3.1 状态枚举

| Codex `ThreadGoalStatus` | nanoPencil `GrubStatus` | 对应关系 |
|--------------------------|------------------------|----------|
| `active` | `running` | 等价 |
| `paused` | 无 | grub 无暂停概念 |
| `blocked` | `blocked` | 等价（但触发条件不同） |
| `usage_limited` | 无 | grub 无用量限制 |
| `budget_limited` | 无 | grub 无 token 预算 |
| `complete` | `complete` | 等价 |
| 无 | `stopped` | grub 有手动停止 |
| 无 | `failed` | grub 有失败终止 |

**关键差异**：Codex 有 6 种状态，grub 有 5 种。Codex 的 `paused`/`usage_limited`/`budget_limited` 在 grub 中不存在；grub 的 `stopped`/`failed` 在 Codex 中不存在。

### 3.2 实体结构

**Codex `ThreadGoal`**：
```typescript
interface ThreadGoal {
  thread_id: string;
  goal_id: string;           // UUID，每次 replace 生成新 ID
  objective: string;
  status: ThreadGoalStatus;
  token_budget: number | null;
  tokens_used: number;
  time_used_seconds: number;
  created_at: number;        // epoch ms
  updated_at: number;        // epoch ms
}
```

**nanoPencil `GrubTaskState`**：
```typescript
interface GrubTaskState {
  id: string;                        // 8 位 hex
  goal: string;
  locale: "en" | "zh";
  status: GrubStatus;
  phase: "initializer" | "execution"; // ⭐ grub 独有
  startedAt: number;
  updatedAt: number;
  currentIteration: number;          // ⭐ 当前轮次
  awaitingTurn: boolean;             // ⭐ 是否在等 turn 返回
  consecutiveFailures: number;       // ⭐ 连续失败计数
  maxIterations: number;             // 默认 25
  maxConsecutiveFailures: number;    // 默认 3
  maxInitializerFailures?: number;   // 默认 5（初始化阶段更宽容）
  harnessDirectory: string;          // ⭐ .grub/<id>/
  featureChecklistPath: string;
  featureListPath: string;
  stateFilePath: string;
  progressLogPath: string;
  initScriptPath: string;
  featureListBaseline?: FeatureList;
  lastDecision?: GrubDecision;
  lastError?: string;
}
```

**关键差异**：
- Codex 用 token 预算做限制，grub 用轮次和失败次数
- grub 有 `phase`（initializer/execution），Codex 没有
- grub 有完整的 harness 文件系统（feature-list.json、progress-log.md、init.sh），Codex 没有
- grub 有 `consecutiveFailures` 计数和 `lastDecision`/`lastError` 恢复上下文

### 3.3 持久化

| | Codex | nanoPencil grub |
|---|---|---|
| **存储** | SQLite `thread_goals` 表 | JSON 文件 `state.json` |
| **粒度** | 每个 thread 一行 | 每个 task 一个目录 |
| **事务** | SQL 事务保证原子性 | 文件写入（best-effort） |
| **并发** | 行锁 + 乐观锁（`expected_goal_id`） | 内存锁（`GrubController` 单例） |
| **跨会话** | 天然支持（SQLite 持久） | 支持（文件持久 + resume 命令） |

---

## 四、续作机制对比

这是两个系统最核心的差异。

### 4.1 Codex：Idle Continuation（空闲续作）

```
Agent turn 结束 → idle
    ↓
on_thread_idle() 触发
    ↓
检查 goal 是否 active
    ↓
注入 continuation prompt
    ↓
触发新 turn（自动，无需用户干预）
```

**特点**：
- 完全自动，agent idle 就续作
- 续作 prompt 包含 objective、budget 信息、completion audit 规则
- token 预算在每次 tool 完成时实时记账
- budget 耗尽时注入 `budget_limit_prompt` 收尾

### 4.2 nanoPencil grub：Controller Loop（控制器循环）

```
/grub <goal> 启动
    ↓
GrubController.start() → 创建 harness 目录 + state.json
    ↓
injectGrubTurn() → 注入初始化 prompt → 触发 turn
    ↓
Turn 结束 → extractGrubDecision() 解析 <loop-state> 块
    ↓
┌─ status === "continue"?
│   ├─ YES → validateFeatureListAfterTurn()
│   │        → finishTurn(decision) → currentIteration++
│   │        → injectGrubTurn() → 触发下一个 turn
│   └─ NO → status === "complete"?
│       ├─ YES → validateCompletion() → 检查 feature-list 所有 passes:true
│       │        ├─ 全部通过 → stop("complete")
│       │        └─ 有未完成 → 降级为 continue，指定 nextStep
│       └─ status === "blocked" → stop("blocked")
    ↓
失败时 → recordFailure() → consecutiveFailures++
    ↓
consecutiveFailures >= maxConsecutiveFailures → stop("failed")
currentIteration >= maxIterations → stop("failed")
```

**特点**：
- 有明确的初始化阶段（initializer）和执行阶段（execution）
- 每轮必须输出 `<loop-state>` JSON 块
- feature-list.json 是完成的 ground truth，不是 LLM 说了算
- 有 init.sh 每轮验证项目健康状态
- 有 progress-log.md 记录每轮进展

### 4.3 续作 Prompt 对比

**Codex continuation prompt**（52 行）：
```
Continue working toward the active thread goal.
<objective>{{ objective }}</objective>
- This goal persists across turns.
- Keep the full objective intact.
- Temporary rough edges are acceptable.
Budget: Tokens used: X / Token budget: Y / Remaining: Z
Work from evidence: Use current worktree as authoritative.
Completion audit: Derive requirements, verify against actual state.
Blocked audit: 3+ consecutive turns of same blocker before marking blocked.
```

**grub execution prompt**（100+ 行）：
```
[GRUB:<id>:<iteration>]
Autonomous grub goal: <goal>
You are inside a managed grub harness.
1) Run .grub/<id>/init.sh and verify project boots.
2) Read feature-list.json. Pick EXACTLY one feature with passes:false.
3) Implement + verify that single feature end-to-end.
4) Flip ONLY "passes" to true and set "evidence".
5) Append to progress-log.md.
6) End with <loop-state>{"status":"continue|complete|blocked","summary":"...","nextStep":"..."}</loop-state>
```

**关键差异**：
- Codex 的 prompt 侧重"忠实于 objective"和"防止 premature completion"
- grub 的 prompt 侧重"每轮只做一个 feature"和"严格遵守 feature-list 契约"
- Codex 用 XML `<objective>` 包裹用户输入（安全边界）
- grub 用 `<loop-state>` XML 块作为 agent→系统的结构化通信协议

---

## 五、完成判定对比

### 5.1 Codex：LLM 自判 + Prompt 约束

```
LLM 判断任务完成
    ↓
调用 update_goal(status: "complete")
    ↓
系统接受（无额外验证）
    ↓
但如果 continuation prompt 的 completion audit 被严格执行：
- LLM 应该验证每个 requirement
- LLM 应该检查 evidence
- LLM 应该避免 premature completion
```

**问题**：完成判定完全依赖 LLM 的自律。prompt 再严格，LLM 仍可能"偷懒"。

### 5.2 nanoPencil grub：Feature-List 门控

```
LLM 判断任务完成
    ↓
输出 <loop-state>{"status":"complete",...}
    ↓
extractGrubDecision() 解析
    ↓
validateCompletion() 检查：
    ↓
读取 feature-list.json
    ↓
allPassing(list)?
    ├─ YES → 接受 complete
    └─ NO → 降级为 continue，指定下一个 pending feature
```

**关键差异**：grub 有**硬编码的完成门控**。LLM 说"complete"但 feature-list 还有 `passes:false` 的项 → 系统拒绝，强制继续。这不是 prompt 约束，是代码约束。

---

## 六、错误恢复对比

### 6.1 Codex

| 场景 | 处理 |
|------|------|
| Turn 出错（非 usage limit） | `on_turn_error` → stop goal for turn error（→ blocked） |
| Usage limit exceeded | `on_turn_error` → stop goal for usage limit（→ usage_limited） |
| Provider 错误 | turn 内部重试（由 agent-core 处理） |
| 预算耗尽 | 注入 budget_limit_prompt，LLM 收尾 |

### 6.2 nanoPencil grub

| 场景 | 处理 |
|------|------|
| Turn 返回但无 `<loop-state>` | `recordFailure()` → consecutiveFailures++ |
| `<loop-state>` 解析失败 | `recordFailure()` → consecutiveFailures++ |
| feature-list 被非法修改 | `validateFeatureListAfterTurn()` → recordFailure() |
| 连续失败 >= maxConsecutiveFailures | stop("failed") |
| 轮次 >= maxIterations | stop("failed") |
| 初始化阶段连续失败 >= maxInitializerFailures | stop("failed")（更宽容的预算） |

**关键差异**：
- Codex 的错误恢复依赖 provider 级重试和 LLM 自我修正
- grub 有**显式的失败计数器**和**结构化验证**（feature-list diff 检查）

---

## 七、Token 预算 vs 轮次预算

### 7.1 Codex：Token 预算

```typescript
// 创建时设置
create_goal({ objective: "...", token_budget: 50000 });

// 每次 tool 完成时记账
account_thread_goal_usage(threadId, timeDelta, tokenDelta, "ActiveOnly");

// 预算耗尽 → 自动标记 budget_limited
if (tokens_used >= token_budget) {
  status = "budget_limited";
  inject_budget_limit_prompt();  // 告诉 LLM 收尾
}
```

**优点**：精细控制成本，token 是硬通货。
**缺点**：不同 provider 的 token 计费不同，用户难以估算。

### 7.2 nanoPencil grub：轮次预算

```typescript
// 启动时设置
/grub <goal> --max-iter 25 --max-fail 3

// 每轮结束时检查
if (currentIteration >= maxIterations) stop("failed");
if (consecutiveFailures >= maxConsecutiveFailures) stop("failed");
```

**优点**：用户直观理解（"最多跑 25 轮"），不依赖 token 计费。
**缺点**：每轮消耗的 token 可能差异很大，无法精确控制成本。

---

## 八、Harness 文件系统（grub 独有）

grub 创建了一个完整的 harness 目录：

```
.grub/<task-id>/
├── feature-list.json      # 功能清单（ground truth）
├── feature-checklist.md   # 清单的 markdown 可读版
├── progress-log.md        # 每轮进展日志
├── init.sh                # 项目健康检查脚本
└── state.json             # 任务状态持久化
```

### 8.1 feature-list.json

```json
{
  "version": 1,
  "goal": "实现用户认证系统",
  "features": [
    {
      "id": "auth-login-endpoint",
      "category": "functional",
      "description": "POST /auth/login 接受 email+password，返回 JWT",
      "steps": [
        "创建路由和控制器",
        "实现密码哈希验证",
        "生成 JWT token",
        "返回 token 和 user 对象"
      ],
      "passes": false,
      "evidence": null
    }
  ]
}
```

**契约**：
- 初始化阶段：agent 生成 15-40 个 feature，全部 `passes: false`
- 执行阶段：agent 每轮只能改一个 feature 的 `passes` 和 `evidence` 字段
- 其他字段（id、category、description、steps）不可变
- 系统用 `validateFeatureListDiff()` 检查是否有非法修改

### 8.2 init.sh

```bash
#!/bin/bash
pwd
git log --oneline -n 20
tail -5 .grub/*/progress-log.md
grep -c '"passes": true' .grub/*/feature-list.json
npm test  # 项目特定的烟测
```

每轮执行前运行，确保项目健康。

### 8.3 Codex 的对应物

Codex 没有 harness 文件系统。它的"ground truth"是：
- LLM 自己的记忆（上下文窗口内的对话历史）
- continuation prompt 中的 objective 描述
- completion audit prompt 的验证规则

---

## 九、生命周期钩子对比

### 9.1 Codex 的钩子系统

```typescript
// 6 个扩展 trait
ThreadLifecycleContributor: on_thread_start, on_thread_resume, on_thread_idle, on_thread_stop
ConfigContributor: on_config_changed
TurnLifecycleContributor: on_turn_start, on_turn_stop, on_turn_abort, on_turn_error
TokenUsageContributor: on_token_usage
ToolLifecycleContributor: on_tool_finish
ToolContributor: tools()  // 注册 get_goal, create_goal, update_goal
```

### 9.2 nanoPencil grub 的钩子

grub 不使用生命周期钩子。它在扩展入口（`index.ts`）中：
- 注册 `/grub` 命令和补全
- 注册 `user_message` 事件拦截（检测 grub turn 的响应）
- 注册 `session_start` 事件（发现并恢复持久化的任务）
- 手动调用 `injectGrubTurn()` 触发每轮

**关键差异**：Codex 的 goal 是深度集成到 agent 生命周期的；grub 是通过扩展 API 在外层编排的。

---

## 十、设计哲学差异

### 10.1 Codex：信任 LLM + 预算约束

- **信任**：LLM 可以自主判断 complete/blocked
- **约束**：token 预算硬限制
- **恢复**：continuation prompt 的 completion audit 是"建议"而非"强制"
- **哲学**："给 LLM 足够的上下文和规则，让它做出正确判断"

### 10.2 nanoPencil grub：不信任 LLM + 结构化验证

- **不信任**：LLM 说 complete 时，系统验证 feature-list
- **约束**：轮次 + 失败次数
- **恢复**：feature-list diff 检查、结构化 `<loop-state>` 解析
- **哲学**："LLM 是执行者，系统是裁判"

### 10.3 这反映了什么

Codex 是 OpenAI 的产品，倾向于**让模型更强然后信任它**。
grub 是工程团队的工具，倾向于**用结构约束弥补模型的不确定性**。

两种哲学都有道理：
- Codex 的方式在模型足够强时效率更高（少一轮验证就少一轮 token）
- grub 的方式在模型不够强时更可靠（不会 premature completion）

---

## 十一、复刻指南：如何在 nanoPencil 中融合两者

如果你想把 Codex goal 的优点融入 grub，以下是可借鉴的点：

### 11.1 可以直接借鉴的

| Codex 特性 | 融入 grub 的方式 |
|-----------|-----------------|
| Token 预算 | 在 `GrubTaskState` 加 `tokenBudget` 和 `tokensUsed` 字段 |
| 自动续作 | 在 `on_thread_idle` 时检查是否有 running task，自动注入下一轮 |
| 编辑 objective | 加 `/grub edit <new-goal>` 子命令 |
| 暂停/恢复 | 加 `/grub pause` + 状态 `paused` |
| 状态行指示器 | 在 TUI status bar 显示当前 grub task 状态 |
| 记账系统 | 在 `on_tool_finish` 时累加 token 使用 |

### 11.2 不建议借鉴的

| Codex 特性 | 原因 |
|-----------|------|
| LLM 自判 complete | grub 的 feature-list 门控更可靠 |
| SQLite 存储 | 文件系统对 grub 的 harness 模式更自然（可 git 追踪） |
| 6 种状态 | grub 的 5 种 + phase 已经足够表达 |

### 11.3 grub 独有的优势应保留

| 特性 | 为什么重要 |
|------|-----------|
| feature-list.json | 完成的 ground truth，不依赖 LLM 记忆 |
| init.sh | 每轮健康检查，防止退化 |
| progress-log.md | 人类可读的进展记录 |
| initializer/execution phase | 先规划后执行，防止 LLM 直接跳到实现 |
| `<loop-state>` 协议 | 结构化的 agent→系统通信 |
| feature-list diff 验证 | 防止 LLM 偷改清单 |

---

## 十二、总结矩阵

| 维度 | Codex `/goal` | nanoPencil `/grub` | 谁更好 |
|------|--------------|-------------------|--------|
| **命令丰富度** | 6 个子命令 | 5 个子命令 | Codex（有 edit） |
| **状态模型** | 6 种状态 | 5 种状态 + 2 种 phase | grub（phase 更清晰） |
| **续作机制** | idle 自动续作 | controller loop 驱动 | Codex（更无缝） |
| **完成判定** | LLM 自判 | feature-list 门控 | grub（更可靠） |
| **错误恢复** | provider 重试 + LLM 自修 | 结构化失败计数 | grub（更可预测） |
| **成本控制** | token 预算 | 轮次预算 | 各有优劣 |
| **持久化** | SQLite | 文件系统 | 各有优劣 |
| **可审计性** | 低（只有 DB 行） | 高（feature-list + progress-log） | grub |
| **集成深度** | 深（6 个生命周期 trait） | 浅（扩展 API 外层编排） | Codex |
| **模型依赖** | 高（强依赖模型自律） | 低（结构约束兜底） | grub |

**最终结论**：Codex 的 goal 是"给模型自由"，grub 是"给模型笼子"。两者不是好坏之分，是信任边界的差异。grub 的 feature-list 门控是它最大的结构性优势，不应被 Codex 的"信任 LLM"哲学取代。
