# AS01: `SessionRuntimeContext` can become a service locator

```yaml
finding_id: AS01
severity: load-bearing
lenses: [seam, locality, DIP]
files_primary:
  - core/runtime/session-context.ts
  - core/runtime/model-controller.ts
files_secondary:
  - core/runtime/agent-session.ts
status: selected
```

## Problem

`SessionRuntimeContext` creates the right seam direction, but its current shape exposes whole subsystems to runtime controllers:

- `core/runtime/session-context.ts` exposes `Agent`, `SessionManager`, `SettingsManager`, `ModelRegistry`, and `ExtensionRunner`.
- `core/runtime/model-controller.ts` can therefore reach far beyond model/thinking operations.

This reduces the value of extraction. The import cycle is avoided, but behavioral coupling remains high because the controller receives large objects instead of narrow capabilities.

## Deletion Test

> If `SessionRuntimeContext` were deleted, would complexity concentrate in callers, vanish, or stay roughly the same?

**Result**: concentrates.

The seam is necessary: controllers need a way to access current runtime state without importing `AgentSession`. The problem is not the seam's existence; it is the seam's width.

## Proposed Direction

Replace broad context with controller-specific capability interfaces.

For model work, prefer:

```ts
interface ModelControllerContext {
  getModel(): Model<any> | undefined;
  getThinkingLevel(): ThinkingLevel;
  getScopedModels(): ReadonlyArray<ScopedModel>;
  setAgentModel(model: Model<any>): void;
  setAgentThinkingLevel(level: ThinkingLevel): void;
  getApiKey(model: Model<any>): Promise<string | undefined>;
  getApiKeyForProvider(provider: string): Promise<string | undefined>;
  getAvailableModels(): Promise<Model<any>[]>;
  getAuthCredential(provider: string): AuthCredential | undefined;
  appendModelChange(provider: string, modelId: string): void;
  appendThinkingLevelChange(level: ThinkingLevel): void;
  setDefaultModelAndProvider(provider: string, modelId: string): void;
  setDefaultThinkingLevel(level: ThinkingLevel): void;
  emitModelSelect(event: ModelSelectPayload): Promise<void>;
}
```

The exact names can vary, but the principle should not: expose actions, not subsystems.

## Benefits

- **Leverage**: later controllers can reuse the same pattern without knowing `AgentSession`.
- **Locality**: model-related state access is reviewed in one capability interface.
- **Testability**: `ModelController` can be unit-tested with a fake context instead of real managers.

## Before / After Sketch

```
BEFORE
ModelController -> SessionRuntimeContext -> Agent / SessionManager / SettingsManager / ModelRegistry / ExtensionRunner

AFTER
ModelController -> ModelControllerContext -> narrow model/thinking capabilities
```

## ADR / DIP Conflict Callouts

- This finding refines P4 S2. "Single config assembly" does not mean every collaborator gets the whole assembly.

## Resolution

**Landed**: `67edfd7` (extract model controller context) · 2026-06-01
**Owner**: `core/runtime/session-context.ts`
**Outcome**: established the capability-context pattern — each runtime controller receives a narrow `*ControllerContext` of named capability functions; none receives `AgentSession`, `SessionManager`, or other composition-root objects. `AgentSession` builds one closure-based adapter per controller in its constructor.
**Boundary held**: no service locator; one-directional imports (AgentSession → controllers → session-context, never reverse). Reused by every later slice (AS02/AS04/AS05/AS07/AS08/AS10).

## References

- Parent finding: `../findings/F01-agent-session-god-module.md`
- Gate: `../gates.md` RS-2
