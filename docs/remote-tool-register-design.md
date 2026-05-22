# nanoPencil Remote Tool Register — Interface Proposal

> **Status**: draft (2026-05-21)
> **Scope**: nano-pencil engine SDK ↔ Pencil-Agent-Gateway tool callback channel
> **Counterpart**: `Pencil-Agent-Gateway/docs/18-tool-callback-protocol-v0.2.md` (gateway-side wire format)
> **Required by**: Gateway milestone **M-tools-2** (NanoPencilEngineAdapter integration)

---

## DIP Metadata

```text
[WHO]  nanoPencil engine maintainers + NanoPencilEngineAdapter authors in Pencil-Agent-Gateway
[FROM] Caller advertises tools (pencil_client_tools) via Gateway → adapter passes them into a nanoPencil session
[TO]   nano-pencil tool registry exposes those tools as AgentTools whose execute() delegates back through a transport callback
[HERE] docs/remote-tool-register-design.md — SDK contract for embedding nano-pencil inside a host that owns the tool runtime
```

---

## 0. Reading Map

| Section | Question it answers |
|---|---|
| §1 Problem | Why does Gateway need this at all? |
| §2 Decisions | What we are committing to (and rejecting) |
| §3 Public API | What new types/exports nanoPencil ships |
| §4 Wiring | How an embedder hooks the transport in |
| §5 Engine-Side Flow | What happens inside agent-loop when a remote tool gets called |
| §6 Lifecycle & Errors | Timeout, cancel, abort, mismatched ids |
| §7 Cross-Project Touchpoints | Concrete deltas in Gateway / editor |
| §8 Implementation Plan | Three small PRs, sized for a single dev-day each |
| §9 Open Questions | Pre-implementation decisions still pending |
| §10 Non-Goals | Things this proposal will NOT do |

---

## 1. Problem

`Pencil-Agent-Gateway` hosts a nanoPencil engine inside a server process. Callers (`nanopencil-editor` Remote HTTP mode, third-party HTTP clients) reach the engine over the Gateway's OpenAI-compatible HTTP+SSE API. The engine reasons, decides to call a tool — but the **tool implementation must run on the caller's machine** (so that `read_file`, `bash`, `grep` see the user's workspace, not the Gateway container's filesystem). See Gateway docs/18 §1 for the full motivation.

The dual-channel wire protocol on the Gateway side is already designed (and M-tools-1 already ships the wire-format machinery on Gateway). What is missing is the **engine-side SDK seam**: a stable way for the Gateway adapter to say *"these tools exist for this session — when the model wants one, call this callback instead of executing locally"*.

The engine **does not need to learn HTTP/SSE**. The engine just needs to know:

1. Which tools exist for this session (declarative).
2. How to invoke a tool when the model selects it (operational — a Promise-returning callback).
3. How to cancel/abort a pending invocation when the session is aborted.

Everything HTTP-shaped stays in Gateway. nano-pencil stays embeddable, terminal-native, and unaware of who is on the other end of the transport.

## 2. Decisions

### 2.1 Decision Table

| # | Question | Decision | Why |
|---|---|---|---|
| D-1 | Where do remote tools enter the tool registry? | Through `ToolSource`, the existing pluggable surface. We extend `ToolSourceType` with `"remote"` and ship a `RemoteToolSource`. | The `ToolSource` interface is already the documented way to add tool families (builtin/mcp/extension). Reusing it means no new code path in `ToolOrchestrator`, agent-loop, extensions, or session lifecycle. |
| D-2 | How does the engine invoke a remote tool? | The tool's `execute()` calls `transport.invoke({toolCallId, name, arguments, signal})` and returns the `RemoteToolResponse`. Single async call per invocation. | Matches `AgentTool.execute()` shape exactly; nothing else in the loop needs to know "this tool is remote". |
| D-3 | How does the embedder deliver responses back? | The embedder calls `transport.respond(toolCallId, response)`. The engine-side Promise from `invoke()` resolves. | Mirrors the Gateway-side `EngineAdapter.provideToolResponse()` contract — same wire as docs/18 §9. |
| D-4 | Where does the transport live? | A `RemoteToolTransport` object the embedder owns and passes via SDK options. nanoPencil never constructs one itself. | Keeps nanoPencil free of any transport-layer concerns. Multiple embedders (Gateway, future SDK users) can supply their own. |
| D-5 | How does the embedder update advertisements mid-session? | `RemoteToolSource.replaceAdvertisements(next)`. New tools take effect on the next turn. In-flight invocations on removed tools are still allowed to resolve. | Editor sessions typically declare tools once per chat; mid-stream replacement is allowed but not optimized. |
| D-6 | Parallel invocations? | Engine side allows 0 or 1 pending invocation per session at a time. Matches Gateway docs/18 §16 decision 1 (serialized). | Matches the wire decision and keeps the transport's state model trivial. The engine already does not parallelize tool calls in single-threaded agent-loop. |
| D-7 | Do we expose a separate "non-streaming non-remote" code path? | No. `RemoteToolSource` is one more `ToolSource`; with no advertisements registered it loads zero tools and the engine behaves as today. | Avoids a v0.1-vs-v0.2 engine fork. |
| D-8 | What about argument/result size? | Engine does NOT enforce the 256 KiB cap. Gateway is the only enforcer (docs/18 §13 `tool_payload_too_large`). | Keeps the engine free of wire-format constants. The transport is a black-box. |
| D-9 | What about MCP collision (a tool name advertised by both MCP and remote)? | Last-wins inside the registry (existing `ToolOrchestrator` behavior). Embedders SHOULD namespace if both are in play. | Matches existing source-merging semantics; adding precedence rules now is premature. |
| D-10 | Where does this code live? | New file `core/runtime/remote-tools.ts` (types + transport interface) and `core/tools/remote-source.ts` (ToolSource impl + ToolDefinition factory). | Mirrors the existing split: runtime types vs. tools registry impl. |

### 2.2 Rejected Alternatives

- **Embed the transport into `Agent` core.** Would force `@pencil-agent/agent-core` to know about callback channels. Rejected: keeps agent-core terminal-pure.
- **Add a hidden "remote tool" execution path in agent-loop.** Forks the loop and makes every future loop change a two-codepath worry. Rejected: the existing `AgentTool.execute()` is already callback-based, so making it return a Promise from a transport invocation is a normal use of the contract, not a fork.
- **Reuse the MCP client.** MCP is bidirectional but the model is wrong: MCP servers are tool *providers*, the gateway caller is a tool *executor*. Trying to encode "the caller answers" as an MCP server inverts the trust direction and forces gateway clients to speak MCP. Rejected: keep the protocols separated; MCP and remote-tool can coexist via the existing source registry.

## 3. Public API

All new public surface area in **two new files** plus **one SDK option**. No edits to existing public types.

### 3.1 Transport contract — `core/runtime/remote-tools.ts` (NEW)

```ts
/**
 * Caller-side tool advertisement. Structurally compatible with Gateway's
 * `ClientToolAdvertisement` (see Pencil-Agent-Gateway docs/18 §5). We do NOT
 * import Gateway types here — nano-pencil stays standalone — but the field
 * names MUST stay aligned for ergonomic embedder code.
 */
export interface RemoteToolAdvertisement {
  /** Tool name shown to the model. Must match Gateway's TOOL_NAME_REGEX
   *  (^[a-zA-Z][a-zA-Z0-9_]{0,63}$). nano-pencil does not validate; the
   *  embedder (Gateway) is the boundary that enforces wire constraints. */
  name: string;
  /** Description fed to the model when this tool is active. */
  description?: string;
  /** TypeBox or JSON schema for arguments. When omitted, the tool accepts
   *  an arbitrary object. */
  parameters?: Record<string, unknown>;
  /** Per-tool soft hint (e.g. for embedder UI). nano-pencil does not enforce
   *  this. */
  timeoutMs?: number;
}

/**
 * Caller's response to a tool invocation. Mirrors Gateway's `ToolCallResponse`.
 */
export type RemoteToolResponse =
  | { status: "ok"; output: string }
  | { status: "error"; error: { code: string; message: string } }
  | { status: "cancelled" };

/**
 * Outbound invocation payload — engine -> embedder.
 */
export interface RemoteToolInvocation {
  toolCallId: string;
  name: string;
  arguments: Record<string, unknown>;
  /** AbortSignal that fires when the engine cancels this invocation (e.g.
   *  the agent-session was aborted). The embedder MUST listen and, if it has
   *  not yet posted a response, propagate the cancel (e.g. Gateway calls
   *  toolCorr.cancel(id)). */
  signal: AbortSignal;
}

/**
 * Transport object the embedder owns. nanoPencil only calls `invoke`; the
 * embedder is the one calling `respond` from wherever the response arrives
 * (HTTP POST handler, IPC, in-memory test harness, etc.).
 */
export interface RemoteToolTransport {
  /** Called by the engine when the model requests a remote tool.
   *  The returned Promise resolves with the embedder's response or rejects
   *  with one of:
   *    - RemoteToolTransportError (transport-level failure: invalid id,
   *      transport disconnected)
   *    - AbortError when `signal` fires before respond() is called
   *  Engines MUST treat a rejection as a tool execution failure (same as a
   *  thrown exception from a local tool's execute()). */
  invoke(invocation: RemoteToolInvocation): Promise<RemoteToolResponse>;

  /** Optional: called once when the session shuts down so the embedder can
   *  drop any outstanding invocation state. Engines call this exactly once
   *  during dispose; embedders MAY no-op. */
  dispose?(): Promise<void>;
}

/**
 * Sentinel error thrown from `invoke()` when the transport itself fails.
 */
export class RemoteToolTransportError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "RemoteToolTransportError";
  }
}
```

### 3.2 Tool source — `core/tools/remote-source.ts` (NEW)

```ts
import type { ToolSource, ToolSourceType } from "./source.js";
import type { ToolDefinition } from "../extensions/types.js";
import type {
  RemoteToolAdvertisement,
  RemoteToolTransport,
} from "../runtime/remote-tools.js";

/**
 * v0.2 ToolSource impl. Each advertisement becomes one ToolDefinition; the
 * execute() body delegates to the transport. The source is created once per
 * session and held by AgentSession; advertisements can be replaced over the
 * session's lifetime via `replaceAdvertisements`.
 */
export class RemoteToolSource implements ToolSource {
  readonly id: string;
  readonly type: ToolSourceType = "remote"; // (new union member; see §3.3)
  readonly name = "Remote (caller-advertised)";
  readonly description = "Tools whose execute() bodies live in the embedding caller (e.g. Pencil-Agent-Gateway)";

  constructor(opts: {
    /** Unique within the host process. */
    id?: string;
    transport: RemoteToolTransport;
    advertisements: RemoteToolAdvertisement[];
  });

  /** Replace the active advertisement set. New definitions are visible to
   *  the next turn. In-flight invocations continue against the OLD set —
   *  the transport is responsible for completing them. */
  replaceAdvertisements(next: RemoteToolAdvertisement[]): void;

  /** ToolSource impl — returns current ToolDefinitions. */
  load(): Promise<ToolDefinition[]>;

  /** ToolSource impl — discards advertisements; the transport is NOT
   *  disposed here (the embedder owns it). */
  unload(): Promise<void>;

  isEnabled(): boolean;
}
```

### 3.3 Tool source type extension — `core/tools/source.ts` (existing file)

```ts
-export type ToolSourceType = "builtin" | "mcp" | "extension";
+export type ToolSourceType = "builtin" | "mcp" | "extension" | "remote";
```

This is the ONLY edit to an existing file (other than SDK options below).

### 3.4 SDK option — `core/runtime/sdk.ts` (existing file)

```ts
export interface SDKOptions {
  // ... existing fields
  /**
   * Remote tool transport (v0.2). When set, advertisements become AgentTools
   * whose execute() delegates back through the transport. Embedders own the
   * transport object; nano-pencil never constructs one.
   */
  remoteTools?: {
    transport: RemoteToolTransport;
    advertisements: RemoteToolAdvertisement[];
  };
}
```

Inside `createAgentSession()`: if `options.remoteTools` is set, construct a `RemoteToolSource` and register it with the ToolSourceRegistry alongside builtin/mcp/extension sources. The registry already calls `load()` and merges into `ToolOrchestrator.customTools`. No agent-loop changes.

## 4. Wiring — From Embedder's POV

Concrete usage from `Pencil-Agent-Gateway`'s `NanoPencilEngineAdapter`:

```ts
// In NanoPencilEngineAdapter.run(req, opts):
//
// req.clientTools comes from the Gateway chat route, mapped from the
// wire field `pencil_client_tools`. See Pencil-Agent-Gateway docs/18 §5
// + src/routes/chat.ts.

const transport: RemoteToolTransport = {
  async invoke({ toolCallId, name, arguments: args, signal }) {
    // Emit upstream — Gateway's onDelta callback.
    opts.onDelta?.({
      type: "tool_request",
      toolCallId,
      toolName: name,
      toolArguments: args,
      toolTimeoutMs: pickTimeoutForTool(name, req.clientTools),
    });
    // Wait for the embedder-side resolution.
    return await pendingTools.awaitResponse(toolCallId, signal);
  },
};

const { session } = await createAgentSession({
  // ... existing options (cwd, agentDir, model, soul, etc.)
  remoteTools: req.clientTools
    ? { transport, advertisements: req.clientTools }
    : undefined,
});

// Gateway's existing wire shim: when toolCorr.deliver(id, resp) resolves the
// awaiting promise (created by `pendingTools.awaitResponse`), the engine's
// tool execute() returns and the loop continues — exactly the wire that
// docs/18 §15 M-tools-2 says we need.
```

The Gateway side of `pendingTools` is just an in-process Promise registry. It is **not** the `ToolCorrelation` table from M-tools-1 (that one is for HTTP-side correlation). The two live in the same process but speak different ids; they bridge through the `toolCallId` string.

## 5. Engine-Side Flow

```text
agent-loop iteration N
  └── model emits tool_use(name="grep", args=...)
        └── ToolOrchestrator.getTool("grep") -> AgentTool (from RemoteToolSource)
              └── tool.execute(toolCallId, args, signal, onUpdate)
                    └── transport.invoke({ toolCallId, name, arguments, signal })  ← outbound
                          └── ... embedder routes to caller ...
                          └── transport.respond(toolCallId, response)              ← inbound
                                └── Promise resolves
                          ← invoke() returns RemoteToolResponse
                    ← execute() returns AgentToolResult shaped from RemoteToolResponse
              ← AgentTool callback completes
        ← tool_result fed into agent-loop iteration N+1
```

Mapping inside `RemoteToolSource`:

| `RemoteToolResponse` | `AgentToolResult` |
|---|---|
| `{ status: "ok", output }` | `{ content: [{ type: "text", text: output }], details: undefined }` |
| `{ status: "error", error }` | `{ content: [{ type: "text", text: error.message }], details: { error } }` and the execute() rejects/throws — same shape as MCP failure |
| `{ status: "cancelled" }` | Throws `AbortError`; agent-loop treats it as user-cancelled |

The exact `AgentToolResult` mapping is finalized in the implementation PR; the surface that matters for this proposal is "RemoteToolResponse in → AgentToolResult out, no leaks to other engine code".

## 6. Lifecycle & Errors

### 6.1 Cancellation paths

| Source | Path | Engine-side observable |
|---|---|---|
| Gateway SSE aborted by caller | Gateway calls `toolCorr.cancel(id)` → pendingTools rejects → transport.invoke() abort signal fires | execute() throws AbortError; loop terminates with cancelled |
| AgentSession dispose() | Engine fires the invocation's AbortSignal | Same as above |
| Embedder calls `transport.respond(id, { status: "cancelled" })` | Promise resolves with cancelled status | Execute() throws AbortError |

### 6.2 Timeout

**Engine does NOT enforce timeout.** Gateway is the timekeeper (docs/18 §11). When the gateway-side timer fires, the gateway calls `toolCorr.timeOut(id)` which rejects the pending Promise; the rejection propagates through the transport into the engine as an `AbortError` (engine-side this is the same as a cancellation).

This keeps the engine free of wire-format constants and avoids two timers fighting over the same invocation.

### 6.3 Unknown tool name from model

If the model hallucinates a tool name not present in the advertisements:
- `ToolOrchestrator.getTool(name)` returns undefined
- agent-loop's existing "unknown tool" handler runs — model sees a regular tool-result error

No new code path needed. This is also why we did NOT add validation in `RemoteToolAdvertisement`: bad input from the wire is Gateway's problem, hallucinations are agent-loop's problem.

### 6.4 Mid-session advertisement replacement

`replaceAdvertisements(next)`:
1. The transport SHOULD keep accepting `respond()` for any `toolCallId` from the old set.
2. The engine sees the new tool list starting from the next turn's `getTools()` call.
3. If a tool name was removed AND the model still tries to call it → §6.3 handles it as unknown.

The embedder is the source of truth for what is invokable; the engine is the source of truth for what is advertised to the model.

## 7. Cross-Project Touchpoints

| Project | Concrete Change |
|---|---|
| **nanoPencil** | New files `core/runtime/remote-tools.ts` + `core/tools/remote-source.ts`; `ToolSourceType` union + 1; `SDKOptions.remoteTools` field. Approx +400 LOC including tests. Public API additions ONLY (no edits to existing types). |
| **Pencil-Agent-Gateway** | `src/engine/nano-adapter.ts` constructs a `RemoteToolTransport` from `EngineRunOptions` callbacks and passes `req.clientTools` into `createAgentSession({ remoteTools })`. Replaces the M-tools-2 placeholder in `docs/18 §15`. |
| **nanopencil-editor** | No change yet — editor work begins once Gateway adapter ships. Editor's eventual job is in `HttpChatProvider`: handle SSE `pencil.tool_request`, run a tool locally (likely a thin shim over the existing local-mode tool registry), POST `tool_response`. |
| **Asgard Platform** | No change yet — proxy `tool_response` POSTs alongside chat completions (already-decided §16.3); no Asgard code knows about engine internals. |

Documentation isomorphism (DIP):
- This file (`nanoPencil/docs/remote-tool-register-design.md`) — source of truth.
- Gateway `docs/18` §9 (EngineAdapter Contract Extension) — pointer to this doc once approved.
- `core/runtime/CLAUDE.md` P2 — add `remote-tools.ts` line item in the M-tools-2 PR.
- `core/tools/CLAUDE.md` (if separate) — add `remote-source.ts` line item in the same PR.

## 8. Implementation Plan

Three small PRs, sized for a single developer-day each. Each is independently testable.

### N-tools-1: Types and source skeleton (0.5 d)

- Add `core/runtime/remote-tools.ts` with the four types from §3.1.
- Add `core/tools/remote-source.ts` implementing `ToolSource` against an in-memory `transport` mock.
- Extend `ToolSourceType` union with `"remote"`.
- Unit test: `RemoteToolSource.load()` returns ToolDefinitions with correct names/descriptions/parameters; `replaceAdvertisements` updates subsequent `load()` calls; `unload()` is idempotent.

**Verification**: with a mock transport whose `invoke()` returns a canned ok response, a fresh `RemoteToolSource` produces a `ToolDefinition` whose `execute()` returns the canned text.

### N-tools-2: SDK wiring (0.5 d)

- Add `remoteTools` to `SDKOptions`.
- In `createAgentSession()`, construct and register a `RemoteToolSource` when present.
- Unit test: `createAgentSession({ remoteTools: { transport, advertisements: [...] } })` produces a session whose `ToolOrchestrator.getToolNames()` includes the advertised names.

**Verification**: a stub session running one turn with a model fixture that emits one tool_use triggers `transport.invoke()` exactly once with the matching `toolCallId`.

### N-tools-3: End-to-end with real agent-loop (1 d)

- Wire `transport.invoke()` through the actual `agent-loop.ts` execution path (no agent-loop code changes; just a test).
- Integration test using a model fixture that emits one tool_use turn, then a normal text turn after seeing the tool_result. Verifies that:
  1. `invoke()` is called with `toolCallId` from the model.
  2. After `respond()` resolves with `{ status: "ok", output: "X" }`, the model fixture sees a `tool_result` containing `"X"` in iteration N+1.
  3. Aborting the AgentSession mid-invocation fires the transport's `signal` and the execute() throws AbortError.

**Verification**: the same scenario the Gateway M-tools-2 acceptance test runs (with a real model fixture replacing Gateway's `MockEngineAdapter`).

### Out of N-tools-1/2/3

Deferred to follow-ups:
- Schema validation of `arguments` against `RemoteToolAdvertisement.parameters` (engine relies on the model to format args correctly; Gateway is the boundary that enforces wire constraints).
- Parallel invocations (engine-loop is serial; matches Gateway §16 decision).
- Streaming partial tool results (editor v0.2 ships text-blob results only; partial-update flow is a v0.3 conversation).
- Custom result rendering (`renderResult` on ToolDefinition) for remote tools — could be a no-op or fall back to plain-text in v0.2.

## 9. Open Questions

To resolve before N-tools-1 starts:

| # | Question | Default lean | Why it matters |
|---|---|---|---|
| Q-1 | Should `RemoteToolSource` impl be in `core/tools/` (alongside `source.ts`) or in `packages/agent-core/`? | `core/tools/` — it depends on `ToolDefinition` which lives in `core/extensions/types.ts`, so colocating with other ToolSource impls is consistent. | Cross-package dependency direction. |
| Q-2 | Do we surface remote tools to extensions' `tool_call` hook? | Yes — they are AgentTools like any other; `ExtensionRunner`'s wrapping path applies automatically. No special-case. | Determines whether `before_tool_call` / `after_tool_call` extension hooks fire for remote tools. Default keeps everything uniform. |
| Q-3 | Where does the Gateway-side `pendingTools` Promise registry live? | Inside `NanoPencilEngineAdapter` (i.e. Gateway's `src/engine/nano-adapter.ts`), separate from the existing `ToolCorrelation` table. | The two registries handle different concerns: `ToolCorrelation` is for HTTP-route correlation; `pendingTools` is for engine-adapter ↔ transport invoke()/respond() bridging. |
| Q-4 | Should `RemoteToolTransport.invoke()` receive the `Tool` parameters typed schema, or just the raw args object? | Raw `Record<string, unknown>`. Gateway already validates names; arg-shape validation is the model+execute() boundary, not the transport's job. | Keeps the transport interface schema-free (no TypeBox dependency leaks into Gateway). |
| Q-5 | Engine personality / soul integration — does Soul evolve on remote tool usage the same way it does on local tool usage? | Yes. RemoteToolSource produces ordinary AgentTools and Soul hooks see them through the normal event bus. | Decided here to avoid Soul forking later. |

## 10. Non-Goals

This proposal does NOT:

- Define the HTTP wire protocol (lives in Gateway docs/18).
- Define how the editor implements its local tool registry (lives in editor `remote-http-chat-provider-design.md` and follow-ups).
- Add a "remote engine" abstraction to nanoPencil — there is no notion of nano-pencil-talking-to-nano-pencil-over-HTTP at this layer.
- Change the AgentTool / ToolDefinition interfaces — the entire premise is "remote tools are ordinary tools whose execute() happens to delegate over a callback".
- Add a tool-result streaming protocol — v0.2 is single-shot request/response.
- Make claims about persistence — pending invocations live in memory; engine restart aborts in-flight tools.

---

## Appendix A: Glossary

| Term | Defined here as |
|---|---|
| **Embedder** | The host process that calls `createAgentSession()`. For v0.2 the embedder is `Pencil-Agent-Gateway`'s `NanoPencilEngineAdapter`. |
| **Remote tool** | A tool whose `execute()` is implemented by the embedder's transport callback rather than by code that runs inside nano-pencil. |
| **Caller** | The party at the far end of the embedder's HTTP/IPC connection. For Gateway, the caller is `nanopencil-editor` (or a third-party HTTP client). |
| **Transport** | The duplex callback object (`RemoteToolTransport`) that nano-pencil uses outbound (`invoke`) and the embedder uses inbound (`respond`, which is NOT on this interface — see §3.1 note). |
| **Advertisement** | A `RemoteToolAdvertisement` — the caller's declaration that "I can execute a tool with this name and this argument schema". |

## Appendix B: Cross-Reference Table

| Concern | nano-pencil (this doc) | Pencil-Agent-Gateway (docs/18) |
|---|---|---|
| Advertisement type | `RemoteToolAdvertisement` (§3.1) | `ClientToolAdvertisement` / `pencil_client_tools` (§5) |
| Response type | `RemoteToolResponse` (§3.1) | `ToolCallResponse` (§9) |
| Invocation event | `transport.invoke()` outbound (§3.1) | `EngineEvent.tool_request` + SSE `pencil.tool_request` (§6, §8) |
| Response delivery | `transport.respond()` (embedder-side, not on the interface — embedder defines its own respond surface) | `EngineAdapter.provideToolResponse()` (§9) + HTTP POST `tool_response` (§7) |
| Timeout enforcement | Engine does NOT enforce; honors transport's AbortSignal | Gateway enforces (§11) |
| Cancellation | AbortSignal on `RemoteToolInvocation` (§6.1) | SSE abort → `toolCorr.cancel` (§12) |
| Serialized constraint | Engine-loop is serial by construction (§D-6) | `ToolCorrelation` rejects second pending per session (§16 decision 1) |
| Size cap | Not enforced (§D-8) | 256 KiB enforced both directions (§13, §16 decision 4) |

---

**Covenant**: When this proposal lands as implementation, this doc is the source-of-truth for the SDK contract. Any contract drift between nano-pencil code and this doc must be fixed by editing both — see CLAUDE.md DIP rules.
