# 候选 2：stdout 接管（已证伪）

> 来源：`pi/packages/coding-agent/src/core/output-guard.ts`
> 状态：**❌ 不动**——catui 架构不撞这个墙

## 实际是什么

**不是"输出守卫"**——文件名字误导。实际是 **stdout 接管**：

```typescript
// 接管前：所有 stdout 写入会进 TUI frame
// 接管后：stdout.write 被替换成 stderr.write，tool 子进程的 stdout 不会乱掉 TUI

export function takeOverStdout(): void {
  process.stdout.write = ((chunk, encodingOrCallback, callback) => {
    if (typeof encodingOrCallback === "function") {
      return rawStderrWrite(String(chunk), encodingOrCallback);
    }
    return rawStderrWrite(String(chunk), callback);
  }) as typeof process.stdout.write;
}
```

配套：
- `restoreStdout()` — 恢复
- `writeRawStdout()` — 主动写 stdout 的入口
- ENOBUFS / EAGAIN 重试（处理 pipe 满载）
- `flushRawStdout()` — 等所有写出完成

## pi 为什么需要这个

pi 的某些 tool 让子进程 **inherit TTY**（stdin/stdout/stderr 都直通）。这意味着子进程的输出会**直接写终端**，**绕过** TUI 渲染管线，导致 TUI frame 被乱写。

## catui 为什么不需要

**`core/tools/bash.ts` 第 126 行**：

```typescript
const child = spawn(shell, [...args, command], {
  stdio: ["ignore", "pipe", "pipe"],  // ← 不 inherit
});
```

catui 的 bash tool **用 pipe 捕获子进程的 stdout/stderr**，不直通 TTY。这意味着：

1. 子进程的输出**不会**直接写终端
2. 子进程的输出**通过 pipe 流回** catui，由 catui 决定怎么处理（截断 / 摘要 / 直接显示）
3. **不存在"子进程绕过 TUI 写终端"的问题**

`find / -name 'output-guard.ts'` 在 catui **0 命中**。`grep 'takeOverStdout' core/ tools/` **0 命中**。

## 结论

**候选 2 在 catui 当前架构下没需求**。

不是"该拿过来"——是"pi 的特定问题解"，catui 没这个问题。

## 如果 catui 未来改了 bash 策略

如果未来 catui 想支持"直接 inherit TTY 的 tool"（比如 vim / less / htop 这种交互式命令），那时候**才需要**这套接管机制。但在当前架构下，**没有迁移价值**。

## 不动

❌ 不落地。