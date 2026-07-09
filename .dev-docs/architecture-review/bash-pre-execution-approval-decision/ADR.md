# ADR: bash tool pre-execution approval gate

```yaml
adr_id: bash-pre-execution-approval-decision
status: accepted   # 2026-07-05 拍板（基于 hermes-agent 参考）
created_at: 2026-07-05
predecessor: ../bash-stdin-pipe-decision/ADR.md   # Layer 1（stdin timer）已实装，作为兜底
scope: core/tools/bash.ts + modes/interactive/components/approval-selector.ts + types 接口
references:
  - D:/Projects/Pencil/Template-github/hermes-agent/hermes_cli/callbacks.py:186-241
  - D:/Projects/Pencil/Template-github/hermes-agent/tools/approval.py:498+
  - D:/Projects/Pencil/Template-github/hermes-agent/hermes_cli/cli_commands_mixin.py:1591-1736
related: ../bash-stdin-pipe-decision/   # Layer 1 兜底；Layer 2/3 是本 ADR
```

## Context

`core/tools/bash.ts` 当前在 spawn 前不加任何审批。任何 bash 命令（包括 `rm -rf`、`npx create-*`、`npm install -g`、`curl | bash`、`git push -f` 等）会直接进 spawn 流程。

**Layer 1（已实装）**：30s stdin grace timer 防 hang。但用户初始痛点未解：模型跑命令时，TUI 上**看不到**"等输入"信号，用户**不能**从 TUI 回答 y/N，只能干等 30s。

**Reference**：hermes-agent 实现 pre-execution approval gate：run-time 检测危险模式 → 调用 `approval_callback(cli, command, description)` → TUI 弹选择器（once/session/always/deny/view）→ 用户选 → 决定是否 spawn。60s 超时自动 deny（fail-closed）。

## Decision

**采纳 hermes-agent 的 pre-execution gate 模式，落地 nanoPencil bash tool**：

### D1：危险模式识别（Layer 2）

`core/tools/bash.ts` 新增 `DANGEROUS_PATTERNS` 列表（精简版，从 hermes 借鉴 + Git Bash/Windows 适配）：

```ts
const DANGEROUS_PATTERNS: Array<[RegExp, string]> = [
  // 删除类
  [/\brm\s+(-[^\s]*\s+)*\//, "delete in root path"],
  [/\brm\s+-[^\s]*r/, "recursive delete"],
  [/\bcmd(?:\.exe)?\s+\/(?:c|k)\s+.*\b(?:del|erase|rd|rmdir)\b/, "Windows cmd destructive delete"],
  // 权限类
  [/\bchmod\s+(-[^\s]*\s+)*(777|666|o\+[rwx]*w|a\+[rwx]*w)\b/, "world/other-writable permissions"],
  [/\bchmod\s+--recursive\b.*(777|666|o\+[rwx]*w|a\+[rwx]*w)/, "recursive world/other-writable"],
  // 系统类
  [/\bmkfs\b/, "format filesystem"],
  [/\bdd\s+.*if=/, "disk copy"],
  [/>\s*\/dev\/sd/, "write to block device"],
  [/\bkill\s+-9\s+-1\b/, "kill all processes"],
  [/\bpkill\s+-9\b/, "force kill processes"],
  [/\bkillall\s+(-[^\s]*\s+)*-(9|KILL|SIGKILL)\b/, "force kill processes (killall)"],
  // Shell injection 类
  [/\b(bash|sh|zsh|ksh)\s+-[^\s]*c(\s+|$)/, "shell command via -c/-lc flag"],
  [/\b(python[23]?|perl|ruby|node)\s+-[ec]\s+/, "script execution via -e/-c flag"],
  [/\b(curl|wget)\b.*\|\s*(?:[/\w]*/)?(?:ba)?sh(?:\s|$|-c)/, "pipe remote content to shell"],
  [/(?:\beval\b|\bsource\b|\.)\s*(?:\$\(\s*|`\s*)(?:curl|wget)\b/, "execute remote content via command substitution"],
  // 加固 npm/npx（用户痛点）
  [/\bnpm\s+(?:install|i|add)\s+(?:-g|--global)/, "global npm install"],
  [/\bnpx\s+(?:create-|@?\w+\/)/, "npx create/package (interactive installer)"],
  [/\byarn\s+(?:global\s+)?add\b/, "yarn global add"],
  [/\bpip(?:3)?\s+install\s+--user/, "pip user install (often needs interactive prompts)"],
  // Git 危险推送
  [/\bgit\s+push\s+(?:-f|--force(?:-with-lease)?)\b.*\b(?:origin\s+)?(?:main|master)\b/, "force push to main/master"],
  // Fork bomb
  [/\:?\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, "fork bomb"],
];

function isDangerousCommand(command: string): { matched: boolean; reason?: string } {
  for (const [pattern, reason] of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) return { matched: true, reason };
  }
  return { matched: false };
}
```

**注**：未抄 hermes 全部 ~60 条；选择性砍掉 PowerShell 专属 / SQL / 复杂编码绕过——这些场景 nanoPencil 用户面窄。

### D2：TUI 选择器组件（Layer 2）

新文件 `modes/interactive/components/approval-selector.ts`：

```ts
export interface ApprovalDecision {
  choice: "once" | "session" | "always" | "deny";
  command: string;
  description: string;
  reason: string;
}

export class ApprovalSelector extends Container {
  private static readonly TIMEOUT_MS = 60_000;
  private static readonly instances = new Set<ApprovalSelector>();
  
  /** Serialization lock — pre-execution gate 同时只能有一个 */
  private static async withLock<T>(fn: () => Promise<T>): Promise<T> { ... }
  
  /** Open the selector; resolves to "deny" on timeout (fail-closed). */
  static async request(decision: ApprovalDecision): Promise<string> { ... }
}
```

**选项**：`once` / `session` / `always` / `deny`（长命令 >70 字加 `view`）。

**超时**：60s 内无选择 → `deny`（fail-closed，符合 hermes）。

**并发**：用静态 `Set<ApprovalSelector>` + 顺序 await；不并发弹多个。

### D3：spawn 前 hook（Layer 2）

`core/tools/bash.ts:execute` 在 `resolveSpawnContext` 之后、`spawn` 之前插入：

```ts
const dangerousCheck = isDangerousCommand(resolvedCommand);
if (dangerousCheck.matched && !opts.skipApproval /* 测试用 */) {
  const choice = await ctx.approval.request({
    command: resolvedCommand,
    description: `<from description param>`,
    reason: dangerousCheck.reason!,
  });
  if (choice === "deny") {
    return { content: [{ type: "text", text: `Command denied by user: ${dangerousCheck.reason}` }], isError: true };
  }
  // "once" / "session" / "always" 继续
}
// ... 现有 spawn 流程不动
```

**关键**：`ctx.approval` 由 `createBashTool` 接受注入；print/rpc mode 不注入 → 自动不弹 → 走 fast-path。

### D4：API 契约（无协议变更）

`core/extensions-host/types.ts` 不需要扩展；用现有 `ExtensionUIContext.select + confirm` 即可。

`createBashTool` 接受 `{ approval?: ApprovalClient }` 注入；不传 = fast-path（不进危险模式检测）。`modes/interactive/interactive-mode.ts` 注入 ApprovalSelector 客户端。

### D5：失败模式

| 情况 | 行为 |
|------|------|
| 非 interactive mode（print / rpc） | 不注入 approval → 跳过检查（避免阻塞）|
| 用户拒绝（deny） | 返回 error：`Command denied by user: <reason>` |
| 60s 超时无选择 | 自动 deny（fail-closed）|
| ApprovalSelector 内部异常 | 降级 deny + 记录日志（fail-closed）|
| 命令本身错误（如 ls /nonexistent）| 不匹配 DANGEROUS_PATTERNS → 不弹，直接 spawn 走 exit=2 |

### D6：deferred to Layer 3（不在本 ADR 范围）

- `session` 选项的 session-persistent state（需要 settings.json 持久化 + reload 逻辑）—— 留到 `bash-pre-execution-approval-layer3-decision`
- `view` 选项（长命令展开 + in-place display）—— 留到 layer 3
- per-tool approval callback（不仅是 bash，其他 tool 也要）—— 留到后续

## Consequences

### C1：用户得到什么

- ✅ 跑 `rm -rf /` / `sudo dd if=/dev/zero` / `npx create-something` → TUI 弹选择器，**用户能看到 + 选择**
- ✅ 跑 `npm install <package>`（不带 -g） → 不弹（不在 DANGEROUS_PATTERNS）
- ✅ 跑 `cat foo.txt` / `ls` / `cd` → fast-path（不匹配）→ 不弹
- ✅ 60s 不选 → deny，不会无限等

### C2：失去什么（trade-off）

- ⚠️ 每次危险命令都需用户交互（即使 `npx create-react-app my-app --yes` 已经写死 `--yes`，DANGEROUS_PATTERNS 仍命中 `npx create-*`）——**可通过 settings.json 加白名单缓解**
- ⚠️ spawn 之前多了一道 review → 启动稍慢（5-10ms 检测开销，可忽略）
- ⚠️ Layer 3（session persistence）未做 → 用户每次 session 都要重新选 "always"

### C3：与 Layer 1 兜底的关系

| 行为 | Layer 1（stdin timer）| Layer 2（本 ADR）|
|------|---------------------|------------------|
| 防止 hang | ✅ 30s 后 end stdin | n/a（不进 spawn）|
| 看到 prompt | ❌ 用户看不到 | ✅ TUI 选择器显式拦截 |
| 回答 y/N | ❌ 用户不能输入 | ✅ 用户显式选 |
| 非危险命令 | fast-path（不变）| fast-path（不变）|
| 危险命令 | 等 30s 然后默认 N | 用户显式选（不选则 deny）|

**结论**：Layer 1 留作兜底（即使 Layer 2 漏配某模式也不 hang）；Layer 2 是主路径。

## Reopen 触发条件

1. 用户实测 `npx create-*` 之类命令仍感"30s 等得不耐烦"——说明 DANGEROUS_PATTERNS 太严
2. 用户希望 `session` 选项真正生效——启动 Layer 3 ADR
3. 需要把 approval 推广到其他 tool（read/write/edit）——启动 cross-tool ADR
4. DANGEROUS_PATTERNS 误报过多（如 `npx eslint .` 命中 `npx create-*` 模式但其实 ESLint 不交互）——启动规则细化 ADR

## Acceptance（本 ADR 实施后回填）

- [ ] DANGEROUS_PATTERNS 在 `core/tools/bash.ts` 落地
- [ ] ApprovalSelector 在 `modes/interactive/components/approval-selector.ts` 落地
- [ ] bash tool spawn 前 hook 落地（包括 deny 路径）
- [ ] interactive mode 注入 ApprovalSelector 客户端
- [ ] print/rpc mode 不注入 → fast-path 验证
- [ ] 真实回归 `scripts/_scratch/bash-approval-regression.mjs`：
  - `[1]` 危险命令 → 弹选择器，模拟用户选 once → 命令执行
  - `[2]` 危险命令 → 模拟选 deny → 命令不执行
  - `[3]` 危险命令 → 60s 超时模拟 → 默认 deny
  - `[4]` 普通命令 → 不弹 → fast-path 直接 spawn
- [ ] 五道验收门：`verify:dip` / `verify:quality` / `verify:package-boundary` / `tsc --noEmit` / `build`
- [ ] P3 头 + AGENT.md 同步
- [ ] commit message 写明 reconnect to Layer 1 + reference hermes