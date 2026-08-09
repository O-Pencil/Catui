# TR01 — Silent overwrite boundaries

## Finding

Tool conflicts were erased before they could be reviewed:

1. `createExtensionAPI().registerTool()` overwrote a same-extension entry in its local `Map`.
2. `ExtensionRunner.getAllRegisteredTools()` retained only the first registration across extensions.
3. `ToolRuntimeController.build()` flattened base and extension tools into a last-writer-wins `Map`.

Adding collision checks only inside `ToolOrchestrator` was therefore insufficient: the conflicting pair often never reached it.

## Resolution

- Same-extension conflicting descriptions now fail immediately; identical registrations share the first entry.
- The runner returns every extension registration.
- The runtime controller forwards the lossless source list to the orchestrator.
- The orchestrator builds a staged registry and swaps it in only after successful validation.

## Invariant

No layer before `ToolRegistry` may deduplicate tools by effective name, except the same-extension loader after proving the duplicate has the same description.

## Evidence

`test/tool-registry.test.ts` covers each boundary plus rollback and instance identity.
