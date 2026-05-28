# Agent Loop Frameworks

nanoPencil supports per-model agent loop selection through `agentLoopFramework`.

## Frameworks

| Value | Best fit | Behavior |
|-------|----------|----------|
| `standard` | High-autonomy models that plan and recover well on their own | Uses serial tool execution with shared permission gates, tool-result budgets, non-blocking tool summaries, output-token recovery, stop hooks, usage summary, and request/result observability. |
| `weak-model-compatible` | Lower-intelligence or unstable models, and stronger models that need tighter control | Uses the structured loop with ordered tool-result pairing, safe tool batching, streaming tool starts, and the same shared recovery/telemetry guards as `standard`. |

`standard` is the default when a model does not specify a framework.

## Configure A Custom Model

Add `agentLoopFramework` to a model in `models.json`:

```json
{
  "providers": {
    "local": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "models": [
        {
          "id": "qwen-coder-local",
          "name": "Qwen Coder Local",
          "reasoning": false,
          "input": ["text"],
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
          "contextWindow": 128000,
          "maxTokens": 8192,
          "agentLoopFramework": "weak-model-compatible"
        }
      ]
    }
  }
}
```

## Override A Built-In Model

Use `modelOverrides` when the model already exists:

```json
{
  "modelOverrides": {
    "openai/gpt-4o-mini": {
      "agentLoopFramework": "weak-model-compatible"
    },
    "provider/example-model": {
      "agentLoopFramework": "standard"
    }
  }
}
```

## Selection Rule

The Agent resolves the loop in this order:

1. Explicit `AgentOptions.agentLoopFramework`
2. Current model's `agentLoopFramework`
3. `standard`

## Switch The Current Session

Use `/agent-loop` in the terminal UI or ACP clients:

```bash
/agent-loop
/agent-loop standard
/agent-loop weak-model-compatible
```

The slash command sets a session-level override. It does not rewrite `models.json`.

RPC clients can call `set_agent_loop_framework` with `"standard"`, `"weak-model-compatible"`, or `null` to return to the model default.

CLI and SDK callers can set non-persistent overrides for the current process/session:

```bash
nanopencil -p --agent-loop weak-model-compatible \
  --max-turns-per-prompt 3 \
  --max-tool-calls-per-prompt 8 \
  --max-tool-concurrency 2 \
  --print-loop-result \
  "Run bounded checks"
```

These flags do not rewrite `models.json` or settings. `--print-loop-result` writes a final `agent_result` JSON line to stderr in text print mode, so stdout can stay reserved for the assistant answer.

For local compatibility, older experimental values `"high-intelligence"`, `"low-intelligence"`, and `"structured-adaptive"` are normalized to the current names when read.

## Tool Concurrency

`weak-model-compatible` batches read-only/concurrency-safe tools. The default maximum concurrency is `10`.

Set `NANOPENCIL_MAX_TOOL_USE_CONCURRENCY` to tune the default without changing code:

```bash
NANOPENCIL_MAX_TOOL_USE_CONCURRENCY=3 nanopencil
```

Programmatic callers can still override this per run with `maxToolConcurrency`.

## Recovery Behavior

When a run stops because the model hit its output-token limit, the loop injects an automatic continuation turn and temporarily raises `maxTokens` for the recovery request. Request telemetry is emitted through `stream_request_start`, including the effective `maxTokens`.

Both loops also support in-loop model error recovery, aggregate tool-result batch budgets, stop-hook continuation turns, and non-blocking tool-use summaries. `weak-model-compatible` adds safe tool concurrency and streamed tool starts for models that need more orchestration.
