# UI02: Fresh local-only users cannot reach model configuration

Evidence: A fresh isolated terminal launch stops in ensureCatuiCodingPlanAuth()
before InteractiveMode is created. Its four choices are cloud Coding Plans;
empty credentials exit the process. Existing Ollama credentials are explicitly
excluded from the precondition that bypasses the question.

Decision reviewed before implementation: Add a fifth local/custom-server choice
in the existing first-run menu. Close readline and proceed to the TUI without
storing a fabricated cloud key. The built-in local default already supplies a
usable initial model selection; configure the real endpoint via `/model`.

Acceptance: Launch with an empty temporary agent directory, choose local/custom,
open `/model`, select OpenAI-compatible and save a URL-only fixture. Verify the
auth file has only the compatible-server nonsecret credential, with no cloud key.
