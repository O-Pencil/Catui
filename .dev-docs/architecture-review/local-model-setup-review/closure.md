# Local model setup closure

Verdict: Implementation and local acceptance passed.

## Delivered

The existing compatible-provider TUI now accepts a server origin, discovers
model IDs, handles authentication challenges and provides explicit manual
fallback. Token limits report their provenance, remain editable, and cannot
save an output limit equal to or above context. Cancellation writes nothing.
The same-endpoint rule prevents accidental credential/limit transfer. Saved
OpenAI compatibility flags survive bootstrap and send `max_tokens` without
OpenAI-specific store/developer/reasoning options.

A fresh launch offers local/custom-server setup before the cloud-key prompt,
so local-only users can reach `/model`. Cloud options and Anthropic setup retain
their existing flows. An explicit credential update clears legacy models.json
key fallbacks; auth.json remains the credential owner.

## Evidence

- Eleven workflow tests cover first-run selection, URL-only setup, multi-model
  selection, authentication, retry/manual entry, metadata/default limits,
  credential isolation, edits, timeout and cancellation. The saved model makes
  a real streaming request against a local HTTP fixture through the AI adapter.
- The existing discovery and custom-provider suites pass, including a new
  stale-credential/bootstrap compatibility regression.
- Real PTY smoke with a fresh temporary agent directory: choose setup option 5,
  enter `/model`, select OpenAI-compatible, paste a bare local origin and save.
  The model becomes tui-smoke-local with a 16k context; auth.json contains only
  custom-openai/catui-no-auth, with no cloud credentials. Temporary service and
  agent directory are cleaned up after the check.
- DIP, quality, static/dist package boundaries, structure, build and product /
  script typechecks pass. Structure still records 39 existing oversized files;
  the baseline is unchanged. Verification contracts: 89 passed.
- npm 11.19.0 rejects the pre-existing lockfile during npm ci (@types/node
  22.19.15 vs 22.20.5). Dependencies were installed using npm install
  --ignore-scripts --package-lock=false; no lockfile/dependency changes are
  included. CI installation is a separate pre-existing environment limitation.

## PR self-check

- [x] P3 contracts, module member lists, root command map and user docs updated.
- [x] Five mandatory automated gates passed; no new structural baseline entries.
- [x] Dedicated review completed before code, including first-run follow-up.
- [x] No reverse imports, service-locator context or protocol/dependency changes.
- [x] Root SDK/public package API unchanged; discovery result additions stay internal.
- [x] No LLM calls, prompt injection or inference send-volume increases. Only
  explicit setup requests a model list, with a five-second deadline per attempt.
- [x] Successful first-run terminal smoke plus error/cancel workflow coverage.

## Limits and reopen conditions

The current runtime and OpenAI SDK still require a nonempty credential. No-auth
setup stores a documented nonsecret compatibility value; inference sends its
Bearer header while discovery omits it. Reopen transport contracts if a server
requires the Authorization header to be entirely absent. FreeToken itself was
not installed; fixtures exercise its documented compatible protocol. The
existing custom-openai slot still represents one endpoint/model at a time.
