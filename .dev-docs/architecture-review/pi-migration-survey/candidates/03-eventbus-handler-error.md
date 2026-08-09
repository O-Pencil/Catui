# 候选 3：EventBus Handler-Error 派发

> 来源：`pi/packages/coding-agent/src/core/event-bus.ts` vs `catui/core/runtime/event-bus.ts`
> 状态：**❌ 不动**——catui 已实现且更好

## 真读全文

### pi（37 行）

```typescript
export function createEventBus(): EventBusController {
  const emitter = new EventEmitter();
  return {
    emit: (channel, data) => { emitter.emit(channel, data); },
    on: (channel, handler) => {
      const safeHandler = async (data) => {
        try {
          await handler(data);
        } catch (err) {
          console.error(`Event handler error (${channel}):`, err);  // ← 仅 console.error
        }
      };
      emitter.on(channel, safeHandler);
      return () => emitter.off(channel, safeHandler);
    },
    clear: () => { emitter.removeAllListeners(); },
  };
}
```

### catui（37 行）

```typescript
export function createEventBus(): EventBusController {
  const emitter = new EventEmitter();
  return {
    emit: (channel, data) => { emitter.emit(channel, data); },
    on: (channel, handler) => {
      const safeHandler = async (data) => {
        try {
          await handler(data);
        } catch (err) {
          emitter.emit("eventbus:handler-error", { channel, error: err });  // ← 进事件流
        }
      };
      emitter.on(channel, safeHandler);
      return () => emitter.off(channel, safeHandler);
    },
    clear: () => { emitter.removeAllListeners(); },
  };
}
```

## 唯一差异

| 失败处理 | pi | catui |
|---|---|---|
| `console.error` | ✅ | ❌ |
| 派发 `eventbus:handler-error` 事件 | ❌ | ✅ |

**catui 更好**——失败进事件流，外部订阅者可以做：

- 调试日志收集
- 监控告警（metric / sentry）
- 自动重试
- 用户通知

pi 的版本只是吞掉到 console。

## 不动

❌ 不需要迁移。catui 已有，且优于 pi。