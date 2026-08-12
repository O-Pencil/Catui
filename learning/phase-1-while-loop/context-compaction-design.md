# 上下文压缩策略设计文档

> **FROM**: Claude Code（单路 LLM 摘要）+ Grok Build（两阶段预取 + 分段持久化）
> **TO**: 你（学习者）：理解 agent 长会话的上下文压缩架构，能自己实现
> **WHY**: Phase 1 的 caturn 没有历史、没有压缩——这是后续加多轮对话后的下一个核心能力

---

## 一、为什么需要压缩

LLM 的 context window 是有限的（Sonnet 200K、Grok 128K、O1 200K…）。一个 agent 会话跑了几十轮、调了几百次工具后，messages 数组一定会爆。

压缩的本质：**把整本日记浓缩成一页摘要 + 保留最新几条对话，让模型能继续工作。**

```
压缩前：[system, user1, assistant1, tool1, user2, assistant2, tool2, ... N条 ...]
压缩后：[system, 摘要, 最新3条]  ← 模型拿到这个还能继续干活
```

---

## 二、核心抽象：CC 骨架

Claude Code 的压缩策略最简单，是理解整个问题的起点。

### 2.1 架构一览

```
┌─────────────────────────────────────────────────────────┐
│  每次用户输入                                           │
│       ↓                                                 │
│  messages.push(userMsg)                                 │
│       ↓                                                 │
│  估算总 tokens → 超过阈值？                              │
│       ├─ 否 → 直接调模型                                 │
│       └─ 是 → 跑压缩管道（见下）                          │
│              ↓                                          │
│  替换 messages = [system, 摘要, 最新几条]                 │
│              ↓                                          │
│  调模型（现在 messages 很短了）                            │
└─────────────────────────────────────────────────────────┘
```

### 2.2 触发条件

```
context_window = 模型最大上下文（如 200K）
buffer = 13K tokens（给压缩本身留的空间）
threshold = context_window - buffer  ← 到这个点就压缩

if (estimated_tokens(messages) >= threshold) {
  compact()
}
```

### 2.3 压缩管道（单路）

```
Step 1: 把完整 messages 喂给模型，带着压缩 prompt
Step 2: 模型输出结构化摘要（9 个 section）
Step 3: 从原始 messages 中提取最新几条用户消息（≤20K tokens）
Step 4: 拼接：[system, 摘要前缀, 摘要, 最新消息]
Step 5: 用这个新数组完全替换旧 messages
```

### 2.4 摘要模板（9 个 section）

```
<analysis>
  模型的思考草稿区——会被剥离，不进入上下文
</analysis>
<summary>
1. Primary Request and Intent
2. Key Technical Concepts
3. Files and Code Sections（含完整代码片段）
4. Errors and Fixes
5. Problem Solving
6. All User Messages（全部非工具结果的用户消息）
7. Pending Tasks
8. Current Work（具体到文件名、函数名）
9. Optional Next Step（带原文引用）
</summary>
```

### 2.5 关键代码骨架（JS 伪代码）

```javascript
async function autoCompact(messages) {
  // 1. 构建压缩请求
  const compactMessages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...messages,
    { role: 'user', content: COMPACT_PROMPT },
  ];

  // 2. 调模型生成摘要
  const summary = await callModel(compactMessages);
  const extracted = extractSummary(summary); // 取出 <summary> 里的内容

  // 3. 保留最新几条用户消息
  const recentMessages = getRecentUserMessages(messages, { maxTokens: 20_000 });

  // 4. 替换
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: SUMMARY_PREFIX + extracted },
    ...recentMessages,
  ];
}
```

### 2.6 Token 估算

```javascript
// 快速估算（不用调 API）
function estimateTokens(text) {
  return Math.ceil(text.length / 4);  // ~4 bytes per token
}

// JSON 等密集格式更挤
function estimateTokensForFileType(ext) {
  switch (ext) {
    case 'json': case 'jsonl': return 2;
    default: return 4;
  }
}

// 消息级估算
function estimateMessageTokens(msg) {
  if (typeof msg.content === 'string') return estimateTokens(msg.content);
  // 复杂 content block（tool_use, image 等）单独处理
  return estimateTokens(JSON.stringify(msg.content));
}
```

---

## 三、Grok Build 升级：两阶段预取压缩

CC 的骨架跑通了，但它有个问题：**压缩本身很贵也很慢**——要调一次模型生成几千 token 的摘要，用户得等着。

Grok Build 的解法：**提前在后台跑，用户无感知。**

### 3.1 架构：Pass 1 + Pass 2

```
正常对话中……
  使用量到达 75%（threshold 85% 前 10 个百分点）
       ↓
  ┌──────────────────────────────────────────┐
  │  Pass 1（后台，用户无感知）                │
  │  把前 95% 的历史摘要成 NOTE₁               │
  │  缓存：{ note1, prefix_len, fingerprint }  │
  └──────────────────────────────────────────┘
       ↓
  用户继续对话……使用量到达 85%
       ↓
  ┌──────────────────────────────────────────┐
  │  Pass 2（阻塞，用户可见）                  │
  │  检查：缓存的 fingerprint 还匹配吗？        │
  │    ├─ 是 → NOTE₁ + 最新 5% → 快速压缩      │
  │    └─ 否 → 退化为单路（跟 CC 一样）         │
  └──────────────────────────────────────────┘
```

### 3.2 Pass 1 后台预计算

```javascript
// 触发条件
if (usagePercent >= threshold - 10) {
  spawnBackgroundPass1();
}

async function spawnBackgroundPass1() {
  if (pass1InProgress) return;
  pass1InProgress = true;

  // 拆分对话：前 95% + 后 5%
  const splitPoint = Math.floor(messages.length * 0.95);
  const prefix = messages.slice(0, splitPoint);

  // 后台生成摘要（不影响用户交互）
  const note1 = await summarize(prefix, { sections: 9 });

  // 缓存结果 + 前缀指纹
  pass1Cache = {
    note1,
    prefixLen: splitPoint,
    fingerprint: hash(prefix),  // 用于检测对话是否被修改
    modelSlug: currentModel,
  };

  pass1InProgress = false;
}
```

### 3.3 Pass 2 实时应用

```javascript
async function twoPassCompact(messages) {
  // 检查缓存是否可用
  if (pass1Cache && pass1Cache.modelSlug === currentModel) {
    const currentFingerprint = hash(messages.slice(0, pass1Cache.prefixLen));
    if (currentFingerprint === pass1Cache.fingerprint) {
      // 缓存有效 → 快速路径
      const tail = messages.slice(pass1Cache.prefixLen);
      const summary = await summarizeTail(pass1Cache.note1, tail);
      return buildCompactedHistory(summary, tail);
    }
  }

  // 缓存失效 → 退化为单路
  return singlePassCompact(messages);
}
```

### 3.4 Pass 2 的精简 prompt（5 个 section）

因为 NOTE₁ 已经覆盖了前 95% 的详细信息，Pass 2 只需要：

```
<summary>
1. Primary Request and Intent（最近的变化）
2. Key Technical Concepts（新增的）
3. Errors and Fixes（最近遇到的）
4. Problem Solving（最近解决的）
5. Current Work（衔接 NOTE₁ 的断点）
</summary>
```

比 9 个 section 少很多——Files、User Messages、Pending Tasks 这些 NOTE₁ 里已经有了，不用重复。

### 3.5 指纹失效机制

对话是活的——用户可能删消息、改方向、回滚。如果 Pass 1 缓存的指纹和当前对话不一致，缓存就作废：

```javascript
function fingerprintPrefix(items) {
  // 简单版本：哈希 item 数量 + 最后一条的内容
  return hash(items.length + items[items.length - 1]?.content);
}

// 复杂版本（Grok 实际用的）：
// 遍历前缀的每个 item，取 variant tag + text content 的哈希
// 这样即使只改了一条的文本，指纹也会变
```

---

## 四、Grok Build 升级：分段持久化

摘要压缩的致命问题：**压缩完了就丢了。** 模型之后想回头看某条工具输出、某个代码片段，找不到了。

Grok Build 的 Segments 模式：**把压缩前的对话分段写成 markdown 持久化到磁盘。**

### 4.1 目录结构

```
workspace/.catui/compaction/
├── INDEX.md              # 目录 + 每段的统计
├── segment_001.md        # 第 1 段对话（压缩前的前 95%）
├── segment_002.md        # 第 2 段对话（第二次压缩时）
└── segment_003.md        # …
```

### 4.2 单段 markdown 结构

```markdown
# Segment 001

## Metadata
- **Time**: 2026-08-12T01:30:00Z
- **Turns**: 47
- **Tools Used**: read, bash, edit, write
- **Files Touched**: src/main.ts, src/utils.ts

## Stats
- **Tokens**: 156,000
- **Duration**: 23 minutes

## Conversation

### Turn 1
**User**: 帮我看看 src/main.ts 里 agentLoop 的实现
**Assistant**: 好的，让我先读一下……

### Turn 2
...
```

### 4.3 压缩后的 system reminder

压缩完之后，告诉模型可以去哪里找细节：

```
Full verbatim rollouts of previous segments are available at
.compaction/segment_*.md. See .compaction/INDEX.md for a table
of contents. Use read_file or grep to recover specific details
(exact code, file paths, tool outputs) if this summary is
insufficient. Do NOT modify these files.
```

### 4.4 实现

```javascript
async function persistSegment(messages, segmentNumber) {
  const dir = '.catui/compaction';
  await fs.mkdir(dir, { recursive: true });

  const content = buildSegmentMarkdown(messages, segmentNumber);
  await fs.writeFile(`${dir}/segment_${String(segmentNumber).padStart(3, '0')}.md`, content);

  await updateIndex(segmentNumber);
}

function buildSegmentMarkdown(messages, num) {
  let md = `# Segment ${String(num).padStart(3, '0')}\n\n`;
  md += buildMetadataSection(messages);
  md += buildStatsSection(messages);
  md += buildConversationBody(messages, { maxCharsPerTurn: 2000 });
  return md;
}
```

---

## 五、完整架构：CC 骨架 + Grok 升级

```
┌──────────────────────────────────────────────────────────────┐
│  每次用户输入                                                │
│       ↓                                                      │
│  messages.push(userMsg)                                      │
│       ↓                                                      │
│  estimated = estimateTokens(messages)                        │
│       ↓                                                      │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  前置检查：usage >= threshold - 10%？                │    │
│  │    ├─ 是 + Pass 1 没在跑 → spawnBackgroundPass1()    │    │
│  │    └─ 否 → 跳过                                     │    │
│  └─────────────────────────────────────────────────────┘    │
│       ↓                                                      │
│  estimated >= threshold？                                    │
│    ├─ 否 → 直接调模型                                        │
│    └─ 是 → 跑压缩管道：                                      │
│            ↓                                                 │
│       ┌──────────────────────────────────────┐              │
│       │  1. 检查 Pass 1 缓存                 │              │
│       │     ├─ 有效 → Pass 2（NOTE₁ + 尾部）  │              │
│       │     └─ 无效 → 退化为单路              │              │
│       │            ↓                         │              │
│       │  2. 分段持久化（Segments 模式）       │              │
│       │     persistSegment(oldMessages)      │              │
│       │            ↓                         │              │
│       │  3. 替换 messages                     │              │
│       │     [system, 摘要, 最新几条,           │              │
│       │      system_reminder(含分段路径)]     │              │
│       └──────────────────────────────────────┘              │
│            ↓                                                 │
│  调模型                                                      │
└──────────────────────────────────────────────────────────────┘
```

---

## 六、实现优先级（从简单到复杂）

| 阶段 | 能力 | 工作量 |
|---|---|---|
| **Phase 2A** | CC 骨架：单路 LLM 摘要压缩 | 1-2 小时 |
| **Phase 2B** | Token 估算函数（bytes/4） | 30 分钟 |
| **Phase 2C** | 自动触发（threshold 检查） | 30 分钟 |
| **Phase 3A** | Pass 1 后台预取 | 2-3 小时 |
| **Phase 3B** | Pass 2 快速路径 + 指纹验证 | 1-2 小时 |
| **Phase 4** | 分段持久化（Segments） | 2 小时 |

Phase 2A 做完就能跑——先有一条跑通的路，再加备选路和加速。

---

## 七、源码路径索引（Agent 写代码时直接抄这些）

### 7.1 Claude Code — `/Users/cunyu666/Dev/Claude-Code/`

| 概念 | 路径 | 关键行 / 说明 |
|---|---|---|
| 压缩主逻辑 | `src/services/compact/compact.ts` | `compactConversation()` ~387行起；历史替换、附件注入、post-compact 消息构建 |
| 压缩 prompt | `src/services/compact/prompt.ts` | `BASE_COMPACT_PROMPT` ~61行起；9 section 模板 + NO_TOOLS_PREAMBLE |
| 自动触发 | `src/services/compact/autoCompact.ts` | `getAutoCompactThreshold()`、`AUTOCOMPACT_BUFFER_TOKENS = 13_000` |
| 微压缩（工具输出截断） | `src/services/compact/microCompact.ts` | 单条 tool output 截断，middle-out |
| Token 估算 | `src/services/tokenEstimation.ts` | `roughTokenCountEstimation()` bytes/4；`countTokensViaHaikuFallback()` API 精确计数 |
| 会话历史读写 | `src/history.ts` | `addToHistory()`、`getHistory()`、`removeLastFromHistory()` |
| 系统上下文生成 | `src/context.ts` | `getSystemContext()`、`getUserContext()`、git status 注入 |
| Post-compact 清理 | `src/services/compact/postCompactCleanup.ts` | 压缩后恢复文件内容、plan、skills |
| 分组（按 API round） | `src/services/compact/grouping.ts` | `groupMessagesByApiRound()` |
| Session memory 压缩 | `src/services/compact/sessionMemoryCompact.ts` | 记忆系统的独立压缩路径 |
| QueryEngine（压缩边界） | `src/QueryEngine.ts` | `compact_boundary` 消息处理、SDK 对接 |

### 7.2 Grok Build — `/Users/cunyu666/Dev/grok-build/`

| 概念 | 路径 | 关键行 / 说明 |
|---|---|---|
| 压缩主逻辑 | `crates/codegen/xai-grok-shell/src/session/compaction.rs` | `run_compact_inner()` ~900行；三阶输入 ladder、两阶段、抑制状态 |
| 压缩配置 | `crates/codegen/xai-grok-shell/src/session/compaction_config.rs` | `CompactionConfig` 结构体、`PrefireState`（两阶段缓存）、`SUPPRESS_*` 常量、`CompactCancelGate` |
| 压缩 prompt（用户侧） | `crates/common/xai-grok-compaction/src/templates/compaction_user_prompt.txt` | 7 section 模板 + broad file definition |
| 压缩 prompt（开发者侧） | `crates/common/xai-grok-compaction/src/templates/compaction_developer_prompt.txt` | 系统指令 |
| 压缩 prompt（内压缩） | `crates/common/xai-grok-compaction/src/templates/intra_compaction_system.txt` | intra-compaction 专用 prompt |
| 压缩 prompt（内压缩用户） | `crates/common/xai-grok-compaction/src/templates/intra_compaction_user.txt` | intra-compaction 用户侧 prompt |
| 压缩模式（3种） | `crates/codegen/xai-chat-state/src/compaction_mode.rs` | `Summary / Transcript / Segments` enum + `transcript_hint()` |
| 分段持久化 | `crates/codegen/xai-chat-state/src/compaction_transcript.rs` | Segment store 渲染、`INDEX_FILE`、detail levels |
| Token 估算 | `crates/codegen/xai-token-estimation/src/lib.rs` | `BYTES_PER_TOKEN = 4`、`estimate_tokens()`、`usage_percentage()` |
| 压缩工具函数 | `crates/codegen/xai-chat-state/src/compaction_utils.rs` | 对话准备、fit-to-budget、boundary helpers |
| 会话状态（历史） | `crates/codegen/xai-chat-state/src/actor/state.rs` | `ChatState`、`estimate_item_tokens()`、`replace_conversation_for_compaction()` |
| 两阶段逻辑 | `crates/codegen/xai-grok-shell/src/session/two_pass.rs` | 95/5 分割、NOTE₁/NOTE₂ builder |
| 压缩上下文渲染 | `crates/codegen/xai-grok-shell/src/session/helpers/compaction_context.rs` | post-compact system reminder（文件、skills、MCP、plan…） |
| 全替换压缩引擎 | `crates/codegen/xai-grok-shell/src/session/helpers/full_replace_compaction.rs` | Sampler/Observer 适配器 |
| Memory flush | `crates/codegen/xai-grok-shell/src/session/helpers/memory_flush.rs` | 压缩前记忆总结 |
| 压缩策略 | `crates/codegen/xai-grok-agent/src/compaction.rs` | `CompactionPolicy`（threshold、model、wall_clock_budget、two_pass） |
| 配置解析 | `crates/codegen/xai-grok-shell/src/util/config/resolve/compaction.rs` | 默认 85%、env/config 优先级 |
| `/compact` 命令 | `crates/codegen/xai-grok-pager/src/slash/commands/compact.rs` | 手动压缩命令 |
| 压缩模式命令 | `crates/codegen/xai-grok-pager/src/slash/commands/compact_mode.rs` | `/compact-mode` 切换 |
| 分段压缩（inter） | `crates/common/xai-grok-compaction/src/inter_compaction/compact.rs` | 跨段压缩逻辑 |
| 分段压缩（intra） | `crates/common/xai-grok-compaction/src/intra_compaction/compact.rs` | 段内压缩逻辑 |
| 代码压缩 | `crates/common/xai-grok-compaction/src/code_compaction/compact.rs` | 代码专用压缩 |

### 7.3 Codex — `/Users/cunyu666/Dev/codex/`

| 概念 | 路径 | 关键行 / 说明 |
|---|---|---|
| 本地压缩（LLM 摘要） | `codex-rs/core/src/compact.rs` | 单路 LLM 摘要、`build_compacted_history()`、20K token 用户消息保留 |
| 远程压缩 V1 | `codex-rs/core/src/compact_remote.rs` | 服务端 V1 端点、`trim_function_call_history_to_fit_context_window()` |
| 远程压缩 V1 请求 | `codex-rs/core/src/compact_remote_request.rs` | 请求构建 |
| 远程压缩 V2 | `codex-rs/core/src/compact_remote_v2.rs` | 服务端 V2、64K token 保留消息预算 |
| 远程压缩 V2 尝试 | `codex-rs/core/src/compact_remote_v2_attempt.rs` | 单次 V2 尝试逻辑 |
| TokenBudget（硬重置） | `codex-rs/core/src/compact_token_budget.rs` | 不摘要，直接丢弃全部历史 |
| 模型回退 | `codex-rs/core/src/compact_model_fallback.rs` | V2 失败后退回 V1/当前模型 |
| 压缩历史分组 | `codex-rs/core/src/compact_remote_history.rs` | 远程压缩的历史项分组 |
| 自动压缩触发 | `codex-rs/core/src/session/turn.rs` | `run_auto_compact()`、pre-turn / mid-turn 触发点 |
| 上下文窗口状态 | `codex-rs/core/src/session/context_window.rs` | `context_window_token_status()`、`AutoCompactTokenLimitScope` |
| Token 预算提醒 | `codex-rs/core/src/session/token_budget.rs` | "还剩 N tokens"注入 |
| 历史管理 + Token 估算 | `codex-rs/core/src/context_manager/history.rs` | `ContextManager`、`estimate_item_token_count()`、图片/音频/token 特殊处理 |
| 历史标准化 | `codex-rs/core/src/context_manager/normalize.rs` | call/output 配对、去孤儿 output、strip 不支持的模态 |
| 自动压缩窗口跟踪 | `codex-rs/core/src/state/auto_compact_window.rs` | window_number、window_id、prefill_input_tokens |
| 回滚截断 | `codex-rs/core/src/thread_rollout_truncation.rs` | fork/rollback 时的历史裁剪 |
| 会话级预算 | `codex-rs/core/src/rollout_budget.rs` | 加权 token 预算、跨线程跟踪 |
| Token 预算上下文 | `codex-rs/core/src/context/token_budget_context.rs` | 模型可见的指导消息 |
| 世界状态/窗口指导 | `codex-rs/core/src/context/world_state/context_window_guidance.rs` | 世界状态快照注入 |
| 输出截断（L0） | `codex-rs/utils/output-truncation/src/lib.rs` | `TruncationPolicy`、middle-out 截断、`approx_token_count()` bytes/4 |
| 压缩 prompt 模板 | `codex-rs/prompts/templates/compact/prompt.md` | LLM 摘要 prompt |
| 摘要前缀模板 | `codex-rs/prompts/templates/compact/summary_prefix.md` | 摘要前缀文本 |
