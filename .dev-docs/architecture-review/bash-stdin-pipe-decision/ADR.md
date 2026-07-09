# ADR: bash tool stdin pipe + stdin timeout

```yaml
adr_id: bash-stdin-pipe-decision
status: implemented-but-reopened   # 2026-07-05 实施 + 五道门 + 回归 PASS；2026-07-05 二次实测发现未解决用户最初问题
created_at: 2026-07-05
reopened_at: 2026-07-05
reopen_reason: 30s stdin timer is **defensive fallback only**, not the real fix.
              User's actual pain is "command never showed it needed input". timer
              just prevents infinite hang; user still can't answer y/N from TUI,
              still can't see the prompt. Real fix needs pre-execution gate
              (hermes-agent style: dangerous pattern detection + TUI selector +
              session persistence + fail-closed default). Layer 1 (stdin timer)
              stays as the safety net; layers 2-3 deferred to next ADR.
scope_now: core/tools/bash.ts (Layer 1 — implemented)
scope_next: TBD by successor ADR (`bash-pre-execution-approval-decision`)
references:
  - ../../scripts/_scratch/interactive-bash-repro/ (Layer 1 repro)
  - ../../scripts/_scratch/test-real-bash-debug.mjs (Layer 1 verification)
  - hermes-agent approval_callback in callbacks.py:186-241 (inspiration for Layer 2)
  - hermes-agent DANGEROUS_PATTERNS in tools/approval.py:498+ (inspiration for Layer 2)
```

## Context（背景）

`core/tools/bash.ts:130` 的 spawn 配置 `stdio: ["ignore", "pipe", "pipe"]`，导致任何交互式命令（`read -p`、`npm init`、`npx create-x`、`git push -f`、`ssh-add` 等）在收到 stdin EOF 时：

- **某些 CLI**：立即 exit=1（用户看到"失败"，但实际是 stdin 被切）
- **某些 CLI**：hang 等 stdin 永远不退（用户看到 spinner 一直转、"卡住了"）

用户实测：执行 `npx create-xxx` 类命令，TUI 里 spinner 不动，看不到"是否在等输入"或"已失败"的明确信号。

**复现脚本**：`scripts/_scratch/interactive-bash-repro/compare.mjs` 输出：

```
[A: stdio=ignore] Do you want to proceed? (y/N)
[A: stdio=ignore] [exit=1]
[B: stdio=pipe   ] Do you want to proceed? (y/N)
[B: stdio=pipe   ] [KILLED: 2s 内无响应]
[B: stdio=pipe   ] [exit=null]
```

——`[B]` 形态（"看起来卡住"）正是用户报告的现象。

## Decision（决策 · 2026-07-05 拍板）

**最小改动**：把 `bash.ts:130` 改成 `stdio: ["pipe", "pipe", "pipe"]` + 增加 stdin timeout 保护（默认 30s，超时后 `child.stdin.end()` 强制 EOF）。

### 具体改动

```diff
  // core/tools/bash.ts:130
- stdio: ["ignore", "pipe", "pipe"],
+ stdio: ["pipe", "pipe", "pipe"],
```

加 stdin timeout 逻辑（伪代码，示意）：

```ts
let stdinTimedOut = false;
const stdinTimeoutMs = options.stdinTimeoutMs ?? 30_000;
const stdinTimer = setTimeout(() => {
  stdinTimedOut = true;
  child.stdin.end();   // 强制 EOF，让命令走默认值
}, stdinTimeoutMs);
child.on("close", () => clearTimeout(stdinTimer));
```

### 为什么"只改这一行 + 加超时"是安全的

| 当前（ignore）| 改后（pipe + timeout）|
|---|---|
| read 立即 EOF → 命令立即 exit=1 | read 等 stdin，30s 后 stdin.end() 强制 EOF，命令走默认值 |
| spinner 短停，TaskOutput 报失败 | spinner 转 30s，TaskOutput 显示 prompt，30s 后命令按默认完成 |
| **对模型**：命令快速失败、立即重新规划 | **对模型**：命令走默认选项、继续执行 |

**两个关键保护**：

1. **30s 超时**：防止命令永远 hang（替代 Ctrl+C）
2. **`child.stdin.end()` 强制 EOF**：让命令在 timeout 后按默认行为继续（不是 SIGKILL 杀死）

### 选这条（而不是其他候选）的理由

| 候选 | 评估 | 选择 |
|------|------|------|
| **A. 不改**（用户用 Ctrl+C 救场）| 用户痛点不解 | ❌ |
| **B. 改 stdio='pipe' 不带 timeout** | 改完后命令会 hang 永远不退，比现在更糟 | ❌ |
| **C. 改 stdio='pipe' + 30s timeout**（本决策）| 最小改动、最大安全边界 | ✅ |
| **D. 改 stdio='pipe' + TUI 桥接 + prompt 检测 + UI 提示** | 真正能让用户在 TUI 里回答 y/N | ❌（工程量大；本 ADR 只解决 80% 场景）|
| **E. 完整重构 bash tool**（sandbox / pty / 全交互模式）| 长期方案 | ❌（deferred，见 §Reopen）|

**本 ADR 只动 1-2 行**；完整交互支持（D）作为 reopen 触发条件；不要在本 ADR 里做。

### 不在范围内（Non-Goals）

- ❌ 不做 TUI stdin 桥接（用户不能在 TUI 内回答 y/N）
- ❌ 不做 prompt 检测（不主动告知"命令在等输入"）
- ❌ 不做 bash tool 整体重构
- ❌ 不动 background task 的 spawn（background task 也用 `ops.exec`，**继承同一修复**——这是预期收益，不需要单独改）

### 已知 trade-off

- **30s 超时期间**：用户看到的现象跟现在"卡住"几乎一样（spinner 转、TaskOutput 显示 prompt）——**视觉改进微小**
- **不能输入 y/N**：用户如果想真回答，需要**手动开终端重跑命令**（或加参数跳过 prompt，如 `yes | npx create-x`）
- **30s 可能不够**（慢速 CLI、慢网络下载）：但 timeout 可调，用户/扩展可重写

**这些 trade-off 都接受**——因为本 ADR 是"先消除立即失败 + 永远 hang"，**完整修复在 D 里**。

## Consequences（影响）

- ✅ 之前 EOF 立即失败的命令（如 `read -p`）现在能等 30s 走默认
- ✅ 之前 hang 的命令（少数 CLI）30s 后被强制 EOF
- ✅ background task 继承同样修复（stdin 也 pipe + timeout）
- ⚠️ `child.stdin` 现在是 `Writable | null`——需要保证后续清理路径（spawn 失败时、signal abort 时不泄漏）
- ⚠️ 30s 是默认值，**某些命令可能不够**——后续可让 BashOperations 接受 stdinTimeoutMs 参数

## Reopen 触发条件

满足任一条件，本 ADR reopen，升级到 D（完整交互支持）或 E（整体重构）：

1. 用户实测中 30s 超时频繁不够（多数场景需要更久）
2. 出现新的报告："命令又立刻失败了"（说明 stdin end() 的副作用有问题）
3. 用户开始**需要**在 TUI 内回答 y/N（不只是想看 prompt）
4. bash tool 的 sandbox 化或 pty 化被列入下季度计划

## Acceptance（实施后回填 · 2026-07-05）

- [x] bash.ts stdio 改 'pipe'（[bash.ts:148](../../../core/tools/bash.ts)）
- [x] stdin timeout 30s + child.stdin.end() 逻辑落地（[bash.ts:163-180](../../../core/tools/bash.ts)）
- [x] 真实回归脚本 `bash-regression.mjs` 跑通：
  - read -p 默认 stdin 超时：**elapsed=30096ms**（精确 30s），exit=1
  - echo hello 无 stdin：**elapsed=81ms**，exit=0
  - ls 失败立即退：**elapsed=55ms**，exit=2
  - 之前 `compare.mjs` 的 `[B: stdio=pipe] [KILLED: 2s 内无响应]` 形态**消除**
- [x] 五道验收门通过：
  - `verify:dip` ✅ 591 P3 头合规
  - `verify:quality` ✅ 659 文件，0 环
  - `verify:package-boundary` ✅
  - `tsc --noEmit` ✅ exit=0
  - `build:deps` ✅
- [x] P3 头更新（[bash.ts:1-9](../../../core/tools/bash.ts)）
- [x] 复现脚本 `interactive-bash-repro/compare.mjs` 仍可跑（作为历史 regression 参考）
- [ ] commit message 包含 reopen 条件链接（commit 时回填）