# Security Audit Extension

## Overview

The Security Audit Extension provides Catui with security-audit capabilities, including:
- Audit logging of all operations
- Detection of dangerous command patterns
- Protection of sensitive file access
- Optional interception mechanism

## Quick start

### Installation

Security audit is shipped as a built-in extension and enabled by default. No extra installation is needed.

### Basic usage

```bash
# View the security panel
/security

# View detailed logs
/security-logs

# View statistics
/security-stats

# Clear logs
/security-clear
```

## Architecture

### Layered design

```
┌─────────────────────────────────────────────────┐
│           Security Audit Extension              │
├─────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────┐ │
│  │           Security Interface              │ │  ← Swappable interface layer
│  │  (standardized interface, multiple impls)  │ │
│  └─────────────────────────────────────────┘ │
│                      │                         │
│    ┌─────────────────┼─────────────────┐      │
│    ▼                 ▼                 ▼      │
│ ┌────────┐    ┌───────────┐    ┌──────────┐  │
│ │  v1    │    │   v2     │    │   v3     │  │  ← Upgradeable implementations
│ │ Light  │    │   Med    │    │  Heavy   │  │
│ │ Audit  │    │  Secure  │    │  Guard   │  │
│ └────────┘    └───────────┘    └──────────┘  │
└─────────────────────────────────────────────────┘
```

### Implementation levels

| Level | Capability | Mode |
|-------|------------|------|
| L1 | Audit log | Required |
| L2 | Danger detection | Required |
| L3 | Intercept + confirm | Optional |
| L4 | Allowlist | Optional |

## Dangerous patterns

### Default dangerous-command patterns

```typescript
const DANGEROUS_PATTERNS = [
  // recursive delete
  "rm\\s+-rf",
  "rmdir\\s+/s",
  "del\\s+/s",

  // system modification
  "sudo\\s+",
  "chmod\\s+777",
  "chown\\s+",

  // process control
  "kill\\s+-9",
  "pkill\\s+-9",
  "killall\\s+",

  // download-and-exec
  "curl\\s+.*\\|\\s*sh",
  "wget\\s+.*\\|\\s*sh",

  // dangerous Git operations
  "git\\s+push\\s+--force",

  // containers / system
  "docker\\s+rm\\s+-f",
  "systemctl\\s+stop",
];
```

### Sensitive paths

```typescript
const SENSITIVE_PATHS = [
  "~/.ssh/",      // SSH keys
  "~/.aws/",      // AWS credentials
  "~/.azure/",    // Azure credentials
  ".env",         // environment-variable file
  ".env.local",   // local environment overrides
  ".env.production", // production environment
];
```

## Plug-and-play guide

### Disabling security audit

To disable security audit, set the following in `settings.json`:

```json
{
  "extensions": {
    "security-audit": {
      "enabled": false
    }
  }
}
```

### Custom dangerous patterns

Add custom detection patterns to the extension config:

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

### Allowlist commands

Add common commands to the allowlist:

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

## Upgrade guide

### Current version (v1 — Light Audit)

- [x] Audit-log recording
- [x] Dangerous-command detection
- [x] Sensitive-file detection
- **Warning:** Warning prompts

### Planned: v2 — Med Secure

- [x] All v1 features
- 🔄 User-confirmation mechanism
- 🔄 Configurable interception level

### Planned: v3 — Heavy Guard

- [x] All v2 features
- 🔄 Sandbox execution environment
- 🔄 AI semantic analysis
- 🔄 Full-operation interception

### Upgrade steps

To upgrade to a higher security level:

1. **Back up the config**
   ```bash
   cp ~/.catui/agent/settings.json ~/.catui/agent/settings.json.bak
   ```

2. **Update the extension**
   ```bash
   npm install -g @catui/agent@latest
   ```

3. **Configure the new level**
   ```json
   {
     "security": {
       "mode": "strict",
       "enableInterception": true
     }
   }
   ```

## API reference

### SecurityEngine interface

```typescript
interface SecurityEngine {
  // Check whether a command is safe
  checkCommand(command: string, cwd: string): SecurityCheckResult;

  // Check a file operation
  checkFileOperation(operation: string, path: string): SecurityCheckResult;

  // Record an audit-log event
  log(event: AuditEvent): AuditEvent;

  // Query logs
  queryLogs(options?: LogQueryOptions): AuditEvent[];

  // Get statistics
  getStats(): SecurityStats;

  // Clear logs
  clearLogs(): void;

  // Export logs
  exportLogs(format?: "json" | "html"): string;
}
```

### Audit-log format

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

## Troubleshooting

### Log location

Audit logs are stored at:
```
~/.catui/agent/security-audit.json
```

### Viewing logs

```bash
# Use the catui command
/security-logs 50

# Or read the file directly
cat ~/.catui/agent/security-audit.json
```

### Common questions

**Q: A dangerous command still ran?**
A: The current version (v1) only logs and warns; it does not block execution. Upgrade to v2+ to enable interception.

**Q: How do I add custom detection rules?**
A: Modify the `dangerousPatterns` and `sensitivePaths` in the extension config.

**Q: Logs are too big?**
A: Use `/security-clear` to clear them, or configure `maxLogEntries` to cap the size.

## Related docs

- [Extension development guide](./extensions)
- [Settings configuration](./settings)
- [Security best practices](./security)
