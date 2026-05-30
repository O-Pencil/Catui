# core/lib/ai/

> P2 | Parent: ../AGENT.md

Member List
config-path.ts: getDebugLogPath, debug log file path resolution, respects NANOPENCIL_CODING_AGENT_DIR override
debug-logger.ts: DebugLogLevel, DebugLogger, debug logging system for troubleshooting AI provider issues
cli.ts: OAuth CLI tool, AI package CLI for managing credentials, handles login/token operations
env-api-keys.ts: getEnvApiKey, environment-based API key utilities, lazy-loaded for browser/Vite compatibility
stream.ts: stream, streamSimple, streaming entry functions, dispatches to registered API providers, retry wrapper and abort event handling
types.ts: ThinkingBudgets, StreamOptions, SimpleStreamOptions, TextContent, ThinkingContent, core AI types, foundational for all modules
api-registry.ts: ApiProvider, registerApiProvider, getApiProvider, API endpoint registry for provider dispatch
index.ts: ai barrel exports, entry point for package, exports all providers, models, types, utilities
models.ts: getModel, getProviders, getModels, calculateCost, supportsXhigh, model registry and lookup functions
models.generated.ts: MODELS, auto-generated model definitions from scripts/generate-models.ts
providers/simple-options.ts: buildBaseOptions, clampReasoning, adjustMaxTokensForThinking, common options builder
providers/openai-responses.ts: OpenAIResponsesOptions, streamOpenAIResponses, streamSimpleOpenAIResponses, OpenAI Responses API provider
providers/github-copilot-headers.ts: inferCopilotInitiator, hasCopilotVisionInput, buildCopilotDynamicHeaders, Copilot-specific header utilities
providers/openai-completions.ts: OpenAICompletionsOptions, streamOpenAICompletions, OpenAI Chat Completions API provider
providers/anthropic.ts: AnthropicOptions, streamAnthropic, streamSimpleAnthropic, Anthropic Claude API provider
providers/openai-codex-responses.ts: streamOpenAICodexResponses, streamSimpleOpenAICodexResponses, OpenAI Codex (ChatGPT OAuth) provider
providers/google-gemini-cli.ts: GoogleGeminiCliOptions, streamGoogleGeminiCli, streamSimpleGoogleGeminiCli, Google Gemini CLI/Cloud Code Assist
providers/transform-messages.ts: transformMessages, message normalization for cross-provider compatibility, ID sanitization, empty assistant pruning, orphan/duplicate/interrupted tool-result filtering
providers/google-vertex.ts: GoogleVertexOptions, streamGoogleVertex, streamSimpleGoogleVertex, Google Vertex AI provider
providers/google.ts: GoogleOptions, streamGoogle, streamSimpleGoogle, Google Gemini API provider
providers/google-shared.ts: isThinkingPart, retainThoughtSignature, convertMessages, convertTools, shared Google utilities
providers/register-builtins.ts: registerBuiltInApiProviders, resetApiProviders, built-in provider registration
providers/openai-responses-shared.ts: convertResponsesMessages, convertResponsesTools, shared OpenAI Responses utilities
providers/amazon-bedrock.ts: BedrockOptions, streamBedrock, streamSimpleBedrock, AWS Bedrock Converse API provider
providers/azure-openai-responses.ts: AzureOpenAIResponsesOptions, streamAzureOpenAIResponses, Azure OpenAI Responses provider
utils/validation.ts: validateToolCall, validateToolArguments, tool call validation using AJV
utils/typebox-helpers.ts: StringEnum, TypeBox schema helpers for Google API compatibility
utils/sanitize-unicode.ts: sanitizeSurrogates, removes unpaired Unicode surrogates for JSON serialization safety
utils/http-proxy.ts: HTTP proxy setup for fetch-based SDKs in Node.js, Bun has builtin support
utils/event-stream.ts: EventStream, AssistantMessageEventStream, generic async iterable event stream with final-result tracking for SSE handling
utils/overflow.ts: isContextOverflow, getOverflowPatterns, context overflow error detection patterns
utils/json-parse.ts: parseStreamingJson, streaming JSON parser using partial-json for incomplete responses
utils/oauth/anthropic.ts: anthropicOAuthProvider, Anthropic OAuth flow for Claude Pro/Max
utils/oauth/openai-codex.ts: openaiCodexOAuthProvider, OpenAI Codex (ChatGPT OAuth) flow
utils/oauth/google-gemini-cli.ts: geminiCliOAuthProvider, Gemini CLI OAuth for standard Gemini models
utils/oauth/google-antigravity.ts: antigravityOAuthProvider, Antigravity OAuth for Gemini 3, Claude, GPT-OSS via Google Cloud
utils/oauth/types.ts: OAuthCredentials, OAuthProviderInterface, OAuthProviderInfo, OAuth type definitions
utils/oauth/decode-credential.ts: decodeOAuthCredentialSegment, safe base64 decode for embedded OAuth credentials (placeholder-safe)
utils/oauth/github-copilot.ts: normalizeDomain, getGitHubCopilotBaseUrl, githubCopilotOAuthProvider, GitHub Copilot OAuth flow
utils/oauth/index.ts: OAuth barrel exports, exports all OAuth providers and management functions
utils/oauth/pkce.ts: generatePKCE, PKCE utilities using Web Crypto API (Node.js 20+ and browsers)
vitest.config.ts: Vitest configuration for AI package provider and utility tests

Rule: Members complete, one item per line, parent links valid, precise terms first

[COVENANT]: Update this file header on changes and verify against parent AGENT.md
