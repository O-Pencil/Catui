# Agent Loop Frameworks

nanoPencil supports per-model agent loop selection through `agentLoopFramework`.

## Frameworks

| Value | Best fit | Behavior |
|-------|----------|----------|
| `high-intelligence` | High-autonomy models that plan and recover well on their own | Uses the existing nanoPencil loop with lighter orchestration. |
| `low-intelligence` | Lower-intelligence or unstable models, and high-intelligence runs that need tighter control | Uses the structured loop with ordered tool-result pairing, safe tool batching, tool permission gating, output-token recovery, stop hooks, usage summary, and request/result observability. |

`high-intelligence` is the default when a model does not specify a framework.

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
          "agentLoopFramework": "low-intelligence"
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
      "agentLoopFramework": "low-intelligence"
    },
    "provider/high-intelligence-model": {
      "agentLoopFramework": "high-intelligence"
    }
  }
}
```

## Selection Rule

The Agent resolves the loop in this order:

1. Explicit `AgentOptions.agentLoopFramework`
2. Current model's `agentLoopFramework`
3. `high-intelligence`

## Switch The Current Session

Use `/agent-loop` in the terminal UI or ACP clients:

```bash
/agent-loop
/agent-loop high-intelligence
/agent-loop low-intelligence
```

The slash command sets a session-level override. It does not rewrite `models.json`.

RPC clients can call `set_agent_loop_framework` with `"high-intelligence"`, `"low-intelligence"`, or `null` to return to the model default.

For local compatibility, older experimental values `"standard"` and `"structured-adaptive"` are normalized to the new names when read.

## Tool Concurrency

`low-intelligence` batches read-only/concurrency-safe tools. The default maximum concurrency is `10`.

Set `NANOPENCIL_MAX_TOOL_USE_CONCURRENCY` to tune the default without changing code:

```bash
NANOPENCIL_MAX_TOOL_USE_CONCURRENCY=3 nanopencil
```

Programmatic callers can still override this per run with `maxToolConcurrency`.

## Recovery Behavior

When a low-intelligence-adaptation run stops because the model hit its output-token limit, the loop injects an automatic continuation turn and temporarily raises `maxTokens` for the recovery request. Request telemetry is emitted through `stream_request_start`, including the effective `maxTokens`.
