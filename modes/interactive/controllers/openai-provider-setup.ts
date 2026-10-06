/**
 * [WHO]: collectOpenAIProviderSetup(), OpenAIProviderSetup — URL-first compatible-server setup prompts
 * [FROM]: Depends on core/model discovery and custom-provider constants; existing auth surface types
 * [TO]: Consumed by AuthProviderConfigController and setup workflow tests
 * [HERE]: modes/interactive/controllers/openai-provider-setup.ts — mode-local prompts; no persistence
 */
import type { OpenAICompletionsCompat } from "@catui/ai/types";
import { NO_AUTH_API_KEY } from "../../../core/model/custom-providers.js";
import { inspectOpenAIModels, normalizeOpenAIBaseUrl, type DiscoveredModel } from "../../../core/model/discovery.js";
import type { AuthProviderConfigSurface } from "./auth-provider-config-controller.js";

type SetupSurface = Pick<AuthProviderConfigSurface, "promptInput" | "pickOption" | "showStatus" | "showError">;

export interface OpenAIProviderSetup {
  baseUrl: string;
  apiKey: string;
  modelName: string;
  overrides: { contextWindow: number; maxTokens: number };
  compat: OpenAICompletionsCompat;
}

interface PreviousSetup {
  baseUrl: string;
  apiKey?: string;
  modelName?: string;
  limits: { contextWindow?: number; maxTokens?: number };
}

const MANUAL = "Enter model ID manually";

/** Return a complete draft only after confirmation; cancellation has no side effects. */
export async function collectOpenAIProviderSetup(
  surface: SetupSurface,
  previous: PreviousSetup,
): Promise<OpenAIProviderSetup | undefined> {
  const input = await surface.promptInput(
    "OpenAI-compatible server URL",
    "Server URL, e.g. http://127.0.0.1:1919",
    { initialValue: previous.baseUrl },
  );
  if (input === undefined) return undefined;
  let baseUrl: string;
  try {
    baseUrl = normalizeOpenAIBaseUrl(input);
  } catch (error) {
    surface.showError(error instanceof Error ? error.message : String(error));
    return undefined;
  }
  let sameEndpoint = false;
  try {
    sameEndpoint = baseUrl === normalizeOpenAIBaseUrl(previous.baseUrl);
  } catch { /* A malformed old URL must not carry credentials into a new endpoint. */ }
  let apiKey = sameEndpoint && previous.apiKey !== NO_AUTH_API_KEY ? previous.apiKey : undefined;
  let model: DiscoveredModel | undefined;

  while (!model) {
    surface.showStatus(`Finding models at ${baseUrl}...`);
    let result = await inspectOpenAIModels(baseUrl, apiKey);
    if (result.status === 401 || result.status === 403) {
      surface.showStatus("The server requires authentication. Enter its API key.");
      const key = await surface.promptInput("Server API key", "API key", { initialValue: apiKey });
      if (key === undefined) return undefined;
      if (!key.trim()) {
        surface.showError("This server requires a nonempty API key.");
        continue;
      }
      apiKey = key.trim();
      // A failed key should offer a retry/manual choice instead of an endless key prompt.
      result = await inspectOpenAIModels(baseUrl, apiKey);
    }

    const unique = [...new Map(result.models.map((item) => [item.id, item])).values()];
    if (unique.length === 1) {
      model = unique[0];
      surface.showStatus(`Found model: ${model.id}`);
    } else if (unique.length > 1) {
      const labels = unique.map((item) => `Model: ${item.id}`);
      const choice = await surface.pickOption("Select a model served by this endpoint", [...labels, MANUAL]);
      if (choice === undefined) return undefined;
      model = unique[labels.indexOf(choice)];
      if (choice === MANUAL) model = await enterModel(surface, sameEndpoint ? previous.modelName : undefined);
      if (!model) return undefined;
    } else {
      surface.showStatus(result.error ?? "The server returned no models.");
      const choice = await surface.pickOption("Could not detect a model", ["Retry discovery", MANUAL]);
      if (choice === undefined) return undefined;
      if (choice === "Retry discovery") continue;
      const key = await surface.promptInput("Server API key (optional)", "Leave empty for no authentication", { initialValue: apiKey });
      if (key === undefined) return undefined;
      apiKey = key.trim() || undefined;
      model = await enterModel(surface, sameEndpoint ? previous.modelName : undefined);
      if (!model) return undefined;
    }
  }

  const sameModel = sameEndpoint && previous.modelName === model.id;
  let contextWindow = model.contextWindow ?? (sameModel ? previous.limits.contextWindow : undefined) ?? 8192;
  let maxTokens = model.maxTokens ?? (sameModel ? previous.limits.maxTokens : undefined) ?? 2048;
  if (contextWindow < 2) {
    surface.showError("The reported context window is too small to use. Enter the deployment limits.");
    contextWindow = 8192;
  }
  maxTokens = Math.min(maxTokens, contextWindow - 1);
  const contextSource = model.contextWindow ? "reported by server" : sameModel && previous.limits.contextWindow ? "saved setting" : "conservative default; server did not report a limit";
  const outputSource = model.maxTokens ? "reported by server, capped below context" : sameModel && previous.limits.maxTokens ? "saved setting, capped below context" : "conservative default";
  surface.showStatus(`Context: ${contextWindow} (${contextSource}); max output: ${maxTokens} (${outputSource}).`);

  while (true) {
    const choice = await surface.pickOption(
      `Save ${model.id}? Context ${contextWindow}, max output ${maxTokens}. ${apiKey ? "API key configured" : "No authentication selected"}.`,
      ["Save configuration", "Adjust limits", "Change authentication"],
    );
    if (choice === undefined) return undefined;
    if (choice === "Save configuration") break;
    if (choice === "Change authentication") {
      const auth = await surface.pickOption("Server authentication", ["No authentication", "Use API key"]);
      if (auth === undefined) return undefined;
      if (auth === "No authentication") {
        apiKey = undefined;
      } else {
        const key = await surface.promptInput("Server API key", "API key");
        if (key === undefined) return undefined;
        if (!key.trim()) {
          surface.showError("Enter an API key, or choose No authentication.");
        } else {
          apiKey = key.trim();
        }
      }
      continue;
    }
    const context = await surface.promptInput("Context window (tokens)", "Deployment context limit", { initialValue: String(contextWindow) });
    if (context === undefined) return undefined;
    const output = await surface.promptInput("Max output tokens", "Maximum generated tokens", { initialValue: String(maxTokens) });
    if (output === undefined) return undefined;
    const nextContext = Number(context.trim());
    const nextOutput = Number(output.trim());
    if (!Number.isSafeInteger(nextContext) || !Number.isSafeInteger(nextOutput) || nextOutput <= 0 || nextOutput >= nextContext) {
      surface.showError("Use positive whole numbers; max output must be smaller than context window.");
      continue;
    }
    contextWindow = nextContext;
    maxTokens = nextOutput;
  }

  return {
    baseUrl,
    apiKey: apiKey || NO_AUTH_API_KEY,
    modelName: model.id,
    overrides: { contextWindow, maxTokens },
    compat: {
      maxTokensField: "max_tokens",
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
    },
  };
}

async function enterModel(surface: SetupSurface, previousId?: string): Promise<DiscoveredModel | undefined> {
  const id = await surface.promptInput("Model ID", "Exact model ID configured in your server", {
    initialValue: previousId === "custom-model" ? undefined : previousId,
  });
  if (id === undefined) return undefined;
  if (!id.trim()) {
    surface.showError("Model ID cannot be empty.");
    return undefined;
  }
  return { id: id.trim() };
}
