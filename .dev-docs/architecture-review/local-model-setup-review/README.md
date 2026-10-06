# Local model setup review

Status: Design reviewed; implementation authorized.

## Intake and ownership

Optimize the existing `/model` OpenAI-compatible configuration path for servers
whose only known setting is an HTTP URL. This is an interface capability, with
mode-specific adaptation owned by `modes/interactive/controllers/`. It is not a
new cross-mode feature or slash command, so the section 2b decision tree stops at
mode adaptation rather than introducing an extension.

Reusable endpoint discovery remains in `core/model/discovery.ts`, already used
by the registry and discovery cache. Custom model persistence remains in
`core/model/custom-providers.ts`. Types stay with these owners; no public
protocol, dependency, extension default, or root SDK export changes.

Terminal smoke exposed an additional existing bootstrap owner: catui-defaults.ts
forces a cloud Coding Plan key before a fresh user can reach the TUI. Keep the
cloud flow intact and add an explicit local/custom-server choice which enters
the TUI using the existing local Ollama default. The user then runs `/model`;
no inference request is made during setup. This is a local edit in the existing
CLI bootstrap adapter, not new business state or an extension feature.

## Design and boundary review

- Extract the OpenAI-compatible setup prompts into a mode-local module using
  the existing input, option-picker and status surface. Keep credential writes,
  model persistence and selection in the existing auth controller.
- Normalize a bare HTTP server URL to `/v1`; preserve explicit API prefixes.
- Discover models without credentials first for a new endpoint. Reuse an
  existing credential only for the same normalized endpoint. Ask for a key on
  HTTP 401/403; other failures offer retry or manual entry with the error shown.
- Automatically use a single model; offer a list for multiple models. Never
  present the seeded `custom-model` as an identified running model.
- Use server limits when supplied, or previously saved limits for the same
  endpoint/model. Otherwise show explicit conservative defaults (8192 context,
  up to 2048 output), with an option to adjust before saving.
- Existing runtime/SDK credential interfaces require a nonempty API key. Store
  an internal nonsecret `catui-no-auth` compatibility credential for endpoints
  that need no authentication; users never type a fabricated key. OpenAI SDK
  requests still carry this placeholder Bearer value. A true credential-free
  transport contract is outside this mode-only change.
- Cancellation writes nothing. Discovery is bounded to five seconds per
  attempt and runs only during explicit configuration, never in agent prompts.

## Acceptance

Exercise URL-only, multiple models, authentication, failure/manual fallback,
metadata/default limits, reconfiguration and cancellation with controller tests
and an HTTP fixture. Run DIP, quality, package boundary, build, product/script
typechecks, verification contracts and relevant existing custom-provider tests.
Review the PR checklist in closure.md after verification.
