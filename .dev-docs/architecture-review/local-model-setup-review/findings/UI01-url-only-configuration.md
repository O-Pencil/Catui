# UI01: URL-only servers cannot complete the existing wizard

Verdict: Fix in the existing mode adapter and model discovery owners.

Evidence: AuthProviderConfigController rejects a blank API key and demands a
manually entered model ID and limits. The model discovery engine already supports
unauthenticated `/models` reads but suppresses status codes, so the wizard cannot
distinguish an authentication challenge from an unavailable endpoint. Explicit
limits supplied by every existing wizard call also disable persistence probing.

Invariant: A reachable compatible server exposing one model can be configured
with its URL and a final confirmation. Model IDs must come from the endpoint,
authentication challenges must remain visible, and unknown limits must be
identified as defaults rather than inferred hardware capabilities.

Boundary decision: Add status/metadata to the producer-owned discovery result;
retain the existing array-returning discovery function for callers. Add only
mode-specific orchestration in the TUI. Preserve Anthropic setup and cloud
credential paths. A changed endpoint must not inherit the previous endpoint's
secret or model limits.
