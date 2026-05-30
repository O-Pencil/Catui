# Security Audit Extension

## 概述

Security Audit Extension 为 NanoPencil 提供安全审计能力，包括：
- 审计日志记录所有操作
- 危险命令模式检测
- 敏感文件访问保护
- 可选的拦截机制

## 快速开始

### 安装

安全审计作为内置扩展，默认启用。无需额外安装。

### 基本使用

```bash
# 查看安全面板
/security

# 查看详细日志
/security-logs

# 查看统计数据
/security-stats

# 清除日志
/security-clear
```

## 架构设计

### 分层设计

```
┌─────────────────────────────────────────────────┐
│           Security Audit Extension              │
├─────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────┐ │
│  │           Security Interface              │ │  ← 可替换的接口层
│  │  (标准化接口，支持不同实现)                 │ │
│  └─────────────────────────────────────────┘ │
│                      │                         │
│    ┌─────────────────┼─────────────────┐      │
│    ▼                 ▼                 ▼      │
│ ┌────────┐    ┌───────────┐    ┌──────────┐  │
│ │  v1    │    │   v2     │    │   v3     │  │
│ │ Light  │    │   Med    │    │  Heavy   │  │  ← 可升级的实现
│ │ Audit  │    │  Secure  │    │  Guard   │  │
│ └────────┘    └───────────┘    └──────────┘  │
└─────────────────────────────────────────────────┘
```

### 实现层级

| 层级 | 功能 | 模式 |
|------|------|------|
| L1 | 审计日志 | 必须 |
| L2 | 危险识别 | 必须 |
| L3 | 拦截确认 | 可选 |
| L4 | 白名单 | 可选 |

## 危险模式

### 默认检测的危险命令模式

```typescript
const DANGEROUS_PATTERNS = [
  // 递归删除
  "rm\\s+-rf",
  "rmdir\\s+/s",
  "del\\s+/s",

  // 系统修改
  "sudo\\s+",
  "chmod\\s+777",
  "chown\\s+",

  // 进程控制
  "kill\\s+-9",
  "pkill\\s+-9",
  "killall\\s+",

  // 网络下载执行
  "curl\\s+.*\\|\\s*sh",
  "wget\\s+.*\\|\\s*sh",

  // Git 危险操作
  "git\\s+push\\s+--force",

  // 容器/系统
  "docker\\s+rm\\s+-f",
  "systemctl\\s+stop",
];
```

### 敏感路径

```typescript
const SENSITIVE_PATHS = [
  "~/.ssh/",      // SSH 密钥
  "~/.aws/",      // AWS 凭证
  "~/.azure/",    // Azure 凭证
  ".env",         // 环境变量文件
  ".env.local",   // 本地环境变量
  ".env.production", // 生产环境变量
];
```

## 插拔指南

### 禁用安全审计

如需禁用安全审计，可以在 `settings.json` 中设置：

```json
{
  "extensions": {
    "security-audit": {
      "enabled": false
    }
  }
}
```

### 自定义危险模式

在扩展配置中添加自定义检测模式：

```json
{
  "security": {
    "dangerousPatterns": [
      "rm\\s+-rf",
      "custom-pattern"
    ],
    "sensitivePaths": [
      "~/.ssh/",
      "~/custom-sensitive/"
    ]
  }
}
```

### 白名单命令

将常用命令加入白名单：

```json
{
  "security": {
    "whitelist": [
      "npm install",
      "npm run dev",
      "git status"
    ]
  }
}
```

## 升级指南

### 当前版本 (v1 - Light Audit)

- ✅ 审计日志记录
- ✅ 危险命令检测
- ✅ 敏感文件检测
- ⚠️ 警告提示

### 计划: v2 - Med Secure

- ✅ 所有 v1 功能
- 🔄 用户确认机制
- 🔄 可配置的拦截级别

### 计划: v3 - Heavy Guard

- ✅ 所有 v2 功能
- 🔄 沙箱执行环境
- 🔄 AI 语义分析
- 🔄 完整操作拦截

### 升级步骤

升级到更高安全级别：

1. **备份配置**
   ```bash
   cp ~/.nanopencil/agent/settings.json ~/.nanopencil/agent/settings.json.bak
   ```

2. **更新扩展**
   ```bash
   npm install -g @pencil-agent/nano-pencil@latest
   ```

3. **配置新级别**
   ```json
   {
     "security": {
       "mode": "strict",
       "enableInterception": true
     }
   }
   ```

## API 参考

### SecurityEngine 接口

```typescript
interface SecurityEngine {
  // 检查命令是否安全
  checkCommand(command: string, cwd: string): SecurityCheckResult;

  // 检查文件操作
  checkFileOperation(operation: string, path: string): SecurityCheckResult;

  // 记录审计日志
  log(event: AuditEvent): AuditEvent;

  // 查询日志
  queryLogs(options?: LogQueryOptions): AuditEvent[];

  // 获取统计
  getStats(): SecurityStats;

  // 清除日志
  clearLogs(): void;

  // 导出日志
  exportLogs(format?: "json" | "html"): string;
}
```

### 审计日志格式

```json
{
  "id": "a1b2c3d4e5f6",
  "timestamp": "2024-01-01T10:00:00.000Z",
  "type": "command",
  "operation": "bash",
  "target": "rm -rf /tmp/test",
  "cwd": "/Users/demo/project",
  "level": "dangerous",
  "status": "warning",
  "reason": "Command matches dangerous pattern: rm\\s+-rf",
  "pattern": "rm\\s+-rf"
}
```

## 故障排除

### 日志位置

审计日志存储在：
```
~/.nanopencil/agent/security-audit.json
```

### 查看日志

```bash
# 使用 nanopencil 命令
/security-logs 50

# 或直接查看文件
cat ~/.nanopencil/agent/security-audit.json
```

### 常见问题

**Q: 危险命令仍然执行了？**
A: 当前版本 (v1) 只记录和警告，不阻止执行。升级到 v2+ 可启用拦截。

**Q: 如何添加自定义检测？**
A: 修改扩展配置中的 `dangerousPatterns` 和 `sensitivePaths`。

**Q: 日志太大怎么办？**
A: 使用 `/security-clear` 清除，或配置 `maxLogEntries` 限制大小。

## 相关文档

- [Extension 开发指南](./extensions)
- [Settings 配置](./settings)
- [安全最佳实践](./security)
