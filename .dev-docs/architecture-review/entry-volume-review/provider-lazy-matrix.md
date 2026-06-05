# EV04 Provider Lazy Matrix

```yaml
review_id: entry-volume-review
finding: EV04
classification: provider loading
status: runtime-slice-validated
created_at: 2026-06-04
```

## Scope

EV04 reviews AI provider lazy loading from the top-level entry/volume perspective. The first runtime slice now changes code only at the provider resolver boundary; metadata chunking and public export narrowing remain deferred.

Before EV04 runtime lazy, the implementation had two eager costs:

- **Model metadata**: `core/lib/ai/src/models.ts` imports the 14k-line `models.generated.ts` and synchronously fills `modelRegistry` at module load.
- **Provider runtime**: `core/lib/ai/src/stream.ts` imported `providers/register-builtins.ts`; that file imported every built-in provider implementation and registered them through top-level side effects.

Those are different costs and must not be collapsed into one "provider service".

## Dependency Shape Before Runtime Slice

```text
@pencil-agent/ai/index.ts
  ├─ exports models.ts
  │    └─ imports models.generated.ts
  ├─ exports stream.ts
  │    └─ imports providers/register-builtins.ts
  │         ├─ imports anthropic/openai/google/bedrock/... provider runtime files
  │         └─ registers all API runtimes as a side effect
  └─ exports OAuth index
       └─ imports all built-in OAuth providers eagerly
```

## Dependency Shape After Runtime Slice

```text
core/lib/ai/src/stream.ts
  └─ imports providers/register-builtins.ts
       └─ registers API-keyed lazy proxy providers
            └─ first stream/streamSimple call imports the matching provider runtime

@pencil-agent/ai/index.ts
  └─ still re-exports provider modules for public compatibility
       └─ root-barrel import cost remains an EV05/Q3 package-surface topic
```

`ModelRegistry` consumes `getProviders()` and `getModels()` synchronously. Many runtime and test call sites consume `getModel()`, `getModels()`, `stream()`, and `complete()` as synchronous/sync-return APIs. Changing these to async would be a public compatibility break.

## Provider Matrix

| Provider group | Built-in model metadata | Runtime API | Auth/OAuth path | Current risk if lazy | EV04 direction |
|----------------|-------------------------|-------------|-----------------|----------------------|----------------|
| `anthropic` | yes | `anthropic-messages` | env/auth + Anthropic OAuth | High: OAuth provider and Anthropic stream errors must remain identical | Runtime lazy only after resolver can load `anthropic.ts`; OAuth eager for login discovery |
| `openai`, `openrouter`, `xai`, `groq`, `cerebras`, `zai`, `mistral`, `minimax`, `huggingface`, token-plan OpenAI-compatible | yes | `openai-completions` | env/auth/custom headers/baseUrl | High: one runtime serves many providers; custom OpenAI-compatible providers depend on same API | Keep API runtime keyed by `api`, not provider; lazy load `openai-completions.ts` on first `api` use |
| `openai-codex`, `github-copilot`, `google-antigravity` | yes | `openai-codex-responses`, OpenAI-compatible variants | OAuth-heavy | High: OAuth refresh/baseUrl modification and model metadata interact | Do not lazy OAuth discovery first; runtime lazy only after smoke matrix |
| `google` | yes | `google-generative-ai` | env/auth | Medium: provider package import cost and error messages | Runtime lazy candidate |
| `google-gemini-cli` | yes | `google-gemini-cli` | OAuth/CLI token path | High: `getModels("github-copilot")`-style helper exists in OAuth code; auth behavior sensitive | Runtime lazy only, OAuth eager until separate review |
| `google-vertex` | yes | `google-vertex` | Google auth/project config | Medium-high: config/env error messages matter | Runtime lazy candidate with explicit missing-config smoke |
| `amazon-bedrock` | yes | `bedrock-converse-stream` | AWS SDK/env/profile | High: AWS SDK import weight is large, but auth/config errors are provider-specific | Good lazy runtime candidate; requires Bedrock smoke/error contract |
| custom providers from `models.json` | user-defined | built-in or custom `api` | models.json/auth fallback | High: must never disappear because metadata module not loaded | Preserve `ModelRegistry` custom parse path; no async catalog requirement |
| extension-registered providers | extension-defined | `registerApiProvider()` or built-in `api` | extension config/oauth | High: extension registration is runtime-owned | Keep `registerApiProvider()` sync and supported; lazy built-ins must not overwrite extension registrations |

## Boundary Decision

### Decision 1: Do Not Make `getModel()` / `getModels()` Async In P6

Reason:

- They are public `@pencil-agent/ai` APIs.
- Tests and core call sites assume synchronous return values.
- `ModelRegistry` uses the synchronous catalog during construction and refresh.

Changing them would create a wide compatibility break and likely change model selector behavior.

### Decision 2: First Implementation Slice Should Be Runtime Lazy, Not Metadata Lazy

The lower-risk cut is:

```text
stream()/complete()
  -> resolveApiProvider(api)
  -> if built-in api is not registered, dynamically import provider runtime for that api
  -> preserve existing stream() return shape by returning an EventStream that bridges async provider loading
```

This moves provider runtime import cost out of startup while preserving model availability and selector behavior.

Important constraint: `stream()` currently returns `AssistantMessageEventStream` synchronously. The lazy resolver cannot make `stream()` return `Promise<...>`; it must bridge asynchronous import internally.

### Decision 3: Metadata Split Is A Later Generator-Level Slice

Splitting `models.generated.ts` into provider-specific files is desirable, but it should be a separate generator-backed slice:

- update `scripts/generate-models.ts`
- emit provider chunks plus an index/manifest
- keep compatibility wrappers for `getModel()`, `getModels()`, `getProviders()`
- preserve `KnownProvider`/`KnownApi` typing expectations

This is larger than runtime lazy and needs its own acceptance matrix.

### Decision 4: OAuth Discovery Stays Eager For Now

`getOAuthProviders()` powers login selectors and provider configuration UX. Making OAuth modules lazy first risks disappearing login options or changing refresh behavior. OAuth can be reviewed after runtime lazy is stable.

## Implementation Sketch For Runtime Lazy

Candidate design:

```text
api-registry.ts
  registerApiProvider(...)
  getApiProvider(...)
  ensureApiProvider(api): Promise<ApiProviderInternal>

providers/register-builtins.ts
  no top-level provider runtime imports
  registers lazy loader table:
    "anthropic-messages" -> import("./anthropic.js")
    "openai-completions" -> import("./openai-completions.js")
    ...

stream.ts
  does not eagerly import all provider runtime modules
  stream() creates an EventStream immediately
  async task loads provider, then pipes provider stream events into the returned EventStream
```

Required invariant:

- If an extension calls `registerApiProvider()` for an API before use, that provider wins.
- If lazy import fails, the user sees an error equivalent in shape to current `No API provider registered for api: X`, but with module-load context.
- Token usage is calculated only from provider stream results, unchanged.

## Acceptance Matrix

| Area | Must verify | Suggested command / smoke |
|------|-------------|---------------------------|
| Build | TypeScript accepts lazy resolver and sync stream facade | `npm run build` on capable machine |
| Model catalog | `getProviders()`, `getModels(provider)`, `ModelRegistry.getAll()` unchanged | targeted unit test/snapshot |
| Runtime provider | First call to each selected API loads its runtime and returns identical event shape | provider smoke matrix |
| OAuth/login | `/login` provider list unchanged | interactive or command catalog smoke |
| Custom models | `models.json` custom OpenAI-compatible provider still appears and streams | local custom provider smoke |
| Extension provider | `api.registerProvider()` streamSimple still overrides/adds provider | extension provider test |
| Errors | unknown `api` and missing credentials produce actionable messages | targeted error tests |
| Token accounting | usage/cost fields unchanged for smoke providers | existing token tests on capable machine |

Minimum provider smoke set:

- `openai-completions` via `openai` or OpenAI-compatible custom provider
- `openai-responses` via `openai`
- `anthropic-messages` via `anthropic`
- `google-generative-ai` via `google`
- `google-gemini-cli`
- `bedrock-converse-stream`
- one OAuth path: `github-copilot` or `openai-codex`

## Non-Goals For First EV04 Code Slice

- Do not split `models.generated.ts` yet.
- Do not change `ModelRegistry` constructor/refresh to async.
- Do not narrow `@pencil-agent/ai` public exports.
- Do not change model selection, provider config, token accounting, prompt payloads, or OAuth provider list.

## Runtime Slice Result

Implemented boundary:

```text
api-registry.ts
  registerApiProvider(...)        # sync custom/provider registration remains
  registerApiProviderLoader(...)  # built-in runtime loader table
  ensureApiProvider(api)          # loads built-in runtime only on first use

providers/register-builtins.ts
  registers API-keyed dynamic imports instead of importing provider runtimes eagerly

stream.ts
  still returns AssistantMessageEventStream synchronously
  awaits provider resolution inside the retry wrapper before piping inner events
```

Compatibility constraint still open:

- `@pencil-agent/ai/index.ts` still re-exports provider modules. P6 intentionally does not narrow public exports, so root-barrel import cost must be handled by EV05/Q3 before claiming full package-entry lazy loading.

Validation:

- Maintainer confirmed `npm run build` passed after `fix(p6): erase lazy provider loader storage type`.
- Maintainer confirmed quality/provider checks passed for the EV04 runtime slice.

## Review Verdict

EV04 can proceed to implementation only as a **runtime lazy provider resolver** first. Metadata chunking remains valid but must be a second, generator-backed slice after runtime lazy proves behavior-neutral.
