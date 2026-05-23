# Recap 扩展

> 长任务进行中的"认知快照"：让用户随时看到模型当前对目标的理解、已确立的事实、以及等待用户决策的下一步

## 概述

Recap 是一个默认加载的内置扩展，提供 `※ recap:` 形态的元信息消息。在多轮、跨上下文的复杂任务中，用户可以通过 `/recap` 立刻看到一段三段式摘要：

```
※ recap · 412 in / 89 out · ~$0.002
  正在把 widgets-web 从 HSF 2 升级到 @ali/egg-hsfclient@3.15.4，文档已更新到 v1.2，
  本机实测发现 Node 必须从 14 升到 18.20。
  下一步：决定是否把 engines.install-node 也改了。
```

**位置**：`extensions/defaults/recap/`

**特点**：
- 默认 Smart 模式（调模型合成），体验优先
- Free 模式（零 token，纯结构提取）作为降级出口
- 自动触发**默认关闭**，需 `/recap auto on` 显式启用
- 每次 Smart 调用在 UI 上行内显示真实 token 用量与估算费用
- 单次 / 会话 / 日三级预算硬上限，超阈值自动降级到 Free 并通知用户

---

## 设计立场

> 用户**显式输入**命令 = 显式同意付费；**隐式自动**触发必须显式开启。

这两条边界把"功能足够好用"和"不出现意料外消耗"分开来：

- `/recap` 一敲就调模型，体验直接
- 自动 recap 不会自己长出来，必须由用户开关打开

成本透明化、预算保护是**反误伤**机制，不是省钱机制。

---

## 三段式产物结构

每次 recap 必须输出且仅输出三段，顺序固定：

| 段位 | 含义 | 语言要求 |
|---|---|---|
| **当前目标** | 模型对用户正在做的事的理解（一句话） | 跟随用户最近一条消息的语言 |
| **关键事实** | 已确立的具体证据（文件路径、版本号、命令结果、决策） | 行内代码用反引号包裹 |
| **下一步** | 等待用户决策的事，或确认"continue / 继续" | 中文以"下一步："开头，英文以"Next:"开头 |

总长上限：60 英文词 / 120 中文字。没有 markdown 标题、没有寒暄、没有元话术。

---

## 双轨产物

### Smart Recap（`/recap` 默认）

调用 `ctx.completeSimple(system, user)` 让模型合成。

输入构造（控制 token）：

```
[骨架]            ← 先跑一次 Free 提取，作为压缩好的事实清单
[最近 N=10 轮]    ← user + assistant，assistant 截断到 500 字
[最近 5 个工具名] ← 只名字，不带结果
```

骨架做前置压缩是关键。模型不直接读全量会话，输入 token 通常 ≤ 800。

### Free Recap（`/recap --free` 或预算耗尽时降级）

纯结构提取，**不调模型**，耗时 < 10ms：

| 段位 | 抽取来源 |
|---|---|
| 当前目标 | 最近一条 user 消息首句（去指令前缀）／plan 文件的标题段 |
| 关键事实 | 自上次 recap 起触达的文件路径（去重，≤ 5）+ 成功 bash 命令（≤ 3，过滤 `ls/cat/echo`） |
| 下一步 | plan 中最早未勾选 step ／ 最近 assistant 消息的疑问句 ／ 兜底 "Continue / 继续" |

Free 是降级出口，不是默认。但它的存在让"预算用完 = 仍能 recap"成立。

---

## 触发模型

| 触发 | 走 Smart | 走 Free | 默认状态 |
|---|:---:|:---:|---|
| `/recap` 用户主动 | ✅ | — | 永远可用 |
| `/recap --free` 用户主动 | — | ✅ | 永远可用 |
| `turn_end` 节流 | ✅ | — | **默认关闭**，需 `/recap auto on` |
| `session_before_compact` | ✅ | — | **默认关闭**，需 `/recap auto on` |
| 预算耗尽时的 Smart 请求 | — | ✅ | 自动降级 |

**关键不变量**：不存在任何"用户没显式开启的情况下自动调模型"的路径。

自动模式开启时的节流条件（OR 触发）：

- 距上次 recap 已过 ≥ 6 轮 human turns
- 上下文用量自上次 recap 起增长 ≥ 20 个百分点
- `session_before_compact` 必触发一次（不受节流约束）

---

## 命令面

```
/recap                    # Smart，默认。每次调用都付费
/recap --free             # Free，零 token
/recap auto on            # 启用自动触发（首次会确认）
/recap auto off           # 关闭自动触发
/recap status             # 显示本会话/今日的 Smart 调用次数、token 累计、剩余预算
/recap budget reset       # 重置本会话预算（需 confirm）
/recap every <n>          # 调整自动模式的轮数阈值
```

故意**不提供** `/recap auto smart`、`/recap auto free` 这种语法——`auto` 始终对应 Smart，让用户的心智模型简单。

---

## 成本透明化机制

### 行内展示

每次 Smart 渲染的标题行：

```
※ recap · {tokensIn} in / {tokensOut} out · ~${estCost}
```

- `tokensIn / tokensOut`：从 agent-session 的 token 账本读取真值；如果账本不可得，用 `system.length + user.length` 按 4 字符 ≈ 1 token 保守估算，并加 `~` 前缀
- `estCost`：从模型 metadata 中的 cost 字段计算

### 预算硬上限（可配置，默认值如下）

| 维度 | 默认 |
|---|---|
| 单次 Smart 输入 token 上限 | 1200 |
| 单次 Smart 输出 token 上限 | 250 |
| 会话累计 Smart 调用 | 10 次 |
| 会话累计 Smart token | 15000 |
| 日累计 Smart 调用 | 30 次 |
| 日累计 Smart token | 50000 |

超阈值时的行为：

1. 不发起 Smart 调用
2. 自动改跑 Free 并渲染
3. 在 Free 渲染下方加一行提示："Smart budget exhausted (session). Use /recap budget reset to continue."

### 调用前的可感知性

Smart 流水线：

```
[1] 节流 / 预算检查   → 命中预算 → 降级 Free
[2] 构造 Free 骨架   → 0 token
[3] UI 预公示       → ctx.ui.notify("Synthesizing recap (~{est} in tok)…", "info")
[4] completeSimple()
[5] 记账            → 累计到 RecapBudgetState，appendEntry 持久化
[6] 渲染            → 标题行带真实 in/out token + ~$
```

第 3 步的预公示让用户在调用发起前就能看到"我正在花钱"，可以 Ctrl+C 取消。

---

## 与其他扩展的协同

### plan/

Smart Recap 在合成时，如果检测到当前处于 plan mode，会把"下一步"段绑定到 plan 文件中**最早未勾选的 step**，而不是模型自由推断。骨架构造时通过 `api.events` 读取 plan 文件状态。

Free Recap 同样如此。

### grub/

如果会话内有 GRUB_MESSAGE_TYPE 消息，说明正在跑 autonomous harness，"下一步"语义变为"下一次迭代目标"。Smart 的 system prompt 会动态切换措辞。

### soul/

soul 的人格风格会影响 Smart 输出的语气，但不在 MVP 范围。

### presence/btw/

属同一"元信息消息"家族，共享 `customMessageBg` 主题色，UI 视觉一致。

---

## 与 LLM 上下文的关系

`recap` 消息**排除出 LLM 上下文**。具体做法是在 `core/messages.ts` 的 `CUSTOM_MESSAGE_TYPES_EXCLUDED_FROM_CONTEXT` 集合里加入 `"recap"`。

**为什么必须排除**：recap 是给人看的元信息。如果回送给模型，会形成"自我引用回声"——模型把自己的总结当作事实复述，造成信息漂移。

---

## 文件结构

```
extensions/defaults/recap/
├── index.ts                # 入口：命令、hook、renderer 注册
├── recap-extractor.ts      # Free Recap 结构提取（零 token，纯函数）
├── recap-synthesizer.ts    # Smart Recap：包 completeSimple + 预算检查 + 记账
├── recap-budget.ts         # RecapBudgetState、记账、阈值判定、持久化
├── recap-renderer.ts       # ※ recap 渲染（Smart / Free 两种 footer）
├── recap-controller.ts     # 自动模式的节流（自动只跑 Smart，命中预算降级 Free）
├── recap-types.ts          # 类型定义
└── CLAUDE.md               # P2 模块说明
```

每个文件 ≤ 200 行。

---

## 类型契约（核心）

```typescript
type RecapSource = "smart" | "free";

interface RecapEntry {
  source: RecapSource;
  goal: string;          // 当前目标
  facts: string[];       // 关键事实，已分割
  nextStep: string;      // 下一步
  triggeredAt: number;
  trigger: "manual" | "auto-turn" | "auto-compact";
  usage?: {              // 仅 source === "smart" 时存在
    tokensIn: number;
    tokensOut: number;
    estimatedCostUsd: number;
    isEstimated: boolean; // true 表示 in/out 由字符数估算
  };
}

interface RecapBudgetState {
  sessionCalls: number;
  sessionTokens: number;
  dailyCalls: number;
  dailyTokens: number;
  dailyResetAt: number;  // unix ts，过期重置
  lastRecapHumanTurn: number;
  lastRecapContextPct: number;
}

interface RecapSettings {
  autoEnabled: boolean;          // 默认 false
  turnsBetween: number;          // 默认 6
  contextPctDelta: number;       // 默认 0.20
  budgets: {
    perCallTokensIn: number;     // 默认 1200
    perCallTokensOut: number;    // 默认 250
    sessionCalls: number;        // 默认 10
    sessionTokens: number;       // 默认 15000
    dailyCalls: number;          // 默认 30
    dailyTokens: number;         // 默认 50000
  };
}
```

---

## API 依赖（已核实）

| 用途 | 已有 API |
|---|---|
| 注册命令 | `api.registerCommand(name, options)` |
| 监听轮次 | `api.on("turn_end", handler)` |
| 监听压缩 | `api.on("session_before_compact", handler)` |
| 一次性 LLM 调用 | `ctx.completeSimple(system, user)` |
| 读会话历史 | `ctx.sessionManager.getBranch()` / `.getEntries()` |
| 读上下文用量 | `ctx.getContextUsage()` |
| 推送消息 | `api.sendMessage({customType:"recap", content, display:true})` |
| 自定义渲染 | `api.registerMessageRenderer("recap", renderer)` |
| 持久化扩展状态 | `api.appendEntry("recap-state", data)` |
| 排除 LLM 上下文 | `core/messages.ts:24` 集合追加 `"recap"` |
| UI 通知 | `ctx.ui.notify(message, level)` |
| 二次确认 | `ctx.ui.confirm(...)` |

**已核实并解决**：`completeSimple()` 底层返回 `AssistantMessage.usage`（含 token 真值与已计算费用），但旧 wrapper 把它丢弃。M1 在 PR-C（commit `0c1c021`）中新增 `completeSimpleWithUsage(systemPrompt, userMessage): Promise<CompletionResult | undefined>`，recap 直接拿真值，UI 上无需 `~` 前缀。

---

## 合成 Prompt

```
You are producing a brief situational recap for the user mid-task.

Output exactly three short clauses in this order:
1. Current goal (what you understand the user wants — one sentence)
2. Key facts established so far (concrete artifacts: files touched, versions,
   decisions made — comma-separated)
3. Next decision needed from the user (start with "Next:" or "下一步：")

Constraints:
- Match the language of the user's most recent message (Chinese in, Chinese out)
- Wrap inline identifiers in backticks
- No greetings, no meta ("Here's a recap..."), no markdown headers
- 60 words / 120 Chinese chars max total
- If no decision is pending, say "Next: continue / 下一步：继续执行"
- The skeleton below is pre-extracted ground truth; do not contradict it
```

user message 拼装：

```
[skeleton]
Goal: {extractedGoal}
Facts: {extractedFacts.join(", ")}
Next: {extractedNextStep}

[recent turns]
User: ...
Assistant: ... (truncated to 500 chars)
...

[recent tools]
edit, write, bash, bash, grep
```

骨架先行 + 历史辅助。模型在已有事实上润色，而不是从零生成。

---

## 渲染

参照 `extensions/defaults/btw/index.ts` 的 renderer 实现：

```typescript
api.registerMessageRenderer("recap", (msg, _opts, theme): Component => {
  const entry = msg.details as RecapEntry;
  const body = typeof msg.content === "string"
    ? msg.content
    : msg.content
        .filter(c => c.type === "text")
        .map(c => c.text)
        .join("\n");

  const header = entry.source === "smart" && entry.usage
    ? `※ recap · ${entry.usage.isEstimated ? "~" : ""}${entry.usage.tokensIn} in / ${entry.usage.tokensOut} out · ~$${entry.usage.estimatedCostUsd.toFixed(4)}`
    : `※ recap · free`;

  const box = new Box(1, 1, v => theme.bg("customMessageBg", v));
  box.addChild(new Text(theme.fg("dim", header), 0, 0));
  box.addChild(new Spacer(1));
  box.addChild(new Markdown(body, 0, 0, getMarkdownTheme(), {
    color: t => theme.fg("customMessageText", t),
  }));

  const container = new Container();
  container.addChild(new Spacer(1));
  container.addChild(box);
  return container;
});
```

`※` 是 U+203B REFERENCE MARK，等宽终端兼容良好。MVP 复用 `customMessageBg` 主题键；后续可引入独立 `recapBg`。

---

## MVP 分阶段

| 阶段 | 内容 | LLM 风险 |
|---|---|---|
| **M1** | `/recap` Smart 实现 + renderer + 排除 LLM 上下文 + builtin 注册 + 行内成本展示 + 单次预算硬上限 | 用户显式触发，单次有上限 |
| **M2** | Free 路径（`/recap --free` + 预算耗尽降级）+ `recap-extractor` | 零（M2 不引入新 LLM 路径） |
| **M3** | 会话 / 日预算 + `/recap status` + `/recap budget reset` + 持久化 | 加固现有 Smart 路径 |
| **M4** | 自动触发（`/recap auto on/off` + `recap-controller` + 节流） | 用户显式开启后才有，仍受预算约束 |
| **M5** | 与 plan / grub 协同合成 + 主题色 `recapBg` | 零 |

每阶段独立可发、独立回滚。M1 上线即可用 Smart `/recap`，M4 后才有自动行为。

---

## 验收清单

每次发版前确认：

- [ ] 不存在用户未显式调用 / 未显式 `auto on` 的代码路径会触发 `completeSimple`
- [ ] 每次 Smart 渲染必带 token 用量行
- [ ] 预算耗尽时降级到 Free 而非静默继续 Smart
- [ ] `/recap status` 显示真实累计
- [ ] `recap` 在 `CUSTOM_MESSAGE_TYPES_EXCLUDED_FROM_CONTEXT` 集合内
- [ ] P2/P3 同步：`extensions/defaults/CLAUDE.md`、`extensions/defaults/recap/CLAUDE.md`、各源文件 P3 头
- [ ] `npx tsx scripts/verify-dip.ts` 通过

---

## 设计权衡记录

| 选择 | 备选 | 取舍理由 |
|---|---|---|
| Smart 默认 | Free 默认 | 用户显式表态：体验优先于成本 |
| 自动触发默认关 | 自动触发默认开 | 显式调用 = 显式同意；自动是隐式动作，必须显式开启 |
| 行内 token 显示 | 仅 `/recap status` 集中显示 | 单次成本紧贴单次结果，认知负担最低 |
| 三级预算 | 仅单次上限 | 防御反复触发；日上限防御跨会话累积 |
| 骨架先行 + LLM 润色 | 直接喂全量历史 | 控制输入 token；骨架本身就是有用的中间产物（Free 复用） |
| 排除 LLM 上下文 | 进上下文供模型自参考 | 防止自我引用回声 |
| `※` 前缀 | `>` 或其他 | 等宽终端兼容；与 Claude TUI 视觉一致 |

---

## 风险与已知未决

1. ~~**`completeSimple` token usage 回传**~~：已通过 PR-C 解决，新增 `completeSimpleWithUsage` 接口直接拿真值。
2. ~~**`builtin-extensions.ts` 注册路径**~~：已确认是显式 import 路径常量 + `existsSync` 判定的注册表机制，recap 已加入（commit M1）。
3. **多语言切换边界**：用户跨语言切换时 recap 语言应跟随最新一条 user 消息，目前 M1 完全依赖模型对系统提示中 "Match the language of the user's most recent message" 指令的执行；与 presence 扩展的语言检测对齐留到 M5 协同时一并处理。
4. **M1 仅实现 Smart 路径**：design 中的 Free 路径（`/recap --free`）、自动触发（`/recap auto on`）、`/recap status` 累计审计未在 M1 范围。当前 `/recap --smart` 与不带参数的 `/recap` 等价。

---

**Covenant**：本文档与 `extensions/defaults/recap/` 实现保持同构。代码变更时更新本文档，文档变更时同步源文件 P3 头与 P2 索引。
