# EC02: Default Prompt Source Cleanup

## Finding

The default system prompt embeds a personal creator identity. This metadata is
not required for coding behavior and is model-visible by construction.

## Decision

Replace the identity-bearing opening with a generic coding-agent opening.
Retain explicit soul and persona injection because those are selected runtime
inputs. Do not claim that wrapping model-visible text in another tag makes it
secret, and do not add output keyword filters.

