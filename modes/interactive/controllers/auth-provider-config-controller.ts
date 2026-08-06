/**
 * [WHO]: Provides AuthProviderConfigController + AuthProviderConfigContext — interactive auth/provider configuration
 * [FROM]: Depends on @catui/ai OAuth helpers, core/model/custom-providers, config paths, TUI components
 * [TO]: Consumed by modes/interactive/interactive-mode.ts and model-overlay providerConfig port
 * [HERE]: modes/interactive/controllers/auth-provider-config-controller.ts — P5 auth/provider-config slice;
 * built-in provider selection shows a Browse models / API-key action menu so credential updates stay
 * reachable without a hidden shortcut (parity with custom protocol providers)
 *
 * Owns interactive credential/config prompts and OAuth UI. It does not own model selection overlay;
 * model-overlay consumes this controller through ProviderConfigPort and receives model application
 * callbacks through a narrow bridge.
 */

import type { Model } from "@catui/ai/types";
import { getOAuthProviders, type OAuthProvider } from "@catui/ai/oauth";
import type { Component, Container, TUI } from "@catui/tui";
import { getAuthPath, getModelsPath } from "../../../config.js";
import {
  type CustomProtocolProviderId,
  getCustomProtocolProviderBaseUrl,
  getCustomProtocolProviderDefinition,
  getCustomProtocolProviderModelLimits,
  getCustomProtocolProviderModelName,
  isCustomProtocolProvider,
  saveCustomProtocolProviderApiKey,
  saveCustomProtocolProviderConfig,
} from "../../../core/model/custom-providers.js";
import type { ModelRegistry } from "../../../core/model-registry.js";
import {
  CATUI_ALI_TOKEN_PLAN_ANTHROPIC_PROVIDER,
  CATUI_ALI_TOKEN_PLAN_OPENAI_PROVIDER,
} from "../../../catui-defaults.js";
import { LoginDialogComponent } from "../components/login-dialog.js";
import {
  OAuthSelectorComponent,
  type ProviderSelectorItem,
} from "../components/oauth-selector.js";
import { ProviderSelectorComponent } from "../components/provider-selector.js";

type AnyModel = Model<any>;

export interface AuthProviderConfigSurface {
  showSelector(
    create: (done: () => void) => { component: Component; focus: Component },
  ): void;
  showStatus(message: string): void;
  showError(message: string): void;
  promptInput(
    title: string,
    placeholder?: string,
    opts?: { initialValue?: string },
  ): Promise<string | undefined>;
  /** Titled single-choice option picker; resolves undefined on cancel. */
  pickOption(title: string, options: string[]): Promise<string | undefined>;
  requestRender(): void;
  getUi(): TUI;
  getEditorContainer(): Container;
  getEditor(): Component;
  remountEditorShell(): void;
}

export interface AuthProviderModelBridge {
  getCurrentModel(): AnyModel | undefined;
  setCurrentModel(model: AnyModel): Promise<void>;
  showModelSelector(initialSearchInput?: string, filterByProvider?: string): void;
  applySelectedModel(model: AnyModel): Promise<void>;
  updateAvailableProviderCount(): Promise<void>;
}

export interface AuthProviderConfigContext {
  modelRegistry: ModelRegistry;
  surface: AuthProviderConfigSurface;
  modelBridge: AuthProviderModelBridge;
}

export class AuthProviderConfigController {
  constructor(private readonly ctx: AuthProviderConfigContext) {}

  async handleApiKeyCommand(): Promise<void> {
    await this.handleProviderCredentialsCommand();
  }

  async handleLoginCommand(text: string): Promise<void> {
    const rawProvider = text.startsWith("/login ") ? text.slice(7).trim() : "";
    if (!rawProvider) {
      this.showOAuthSelector("login");
      return;
    }

    const providerId = this.resolveProviderId(rawProvider);
    if (!providerId) {
      this.ctx.surface.showError(`Unknown provider: ${rawProvider}`);
      return;
    }

    const oauthProvider = getOAuthProviders().find((provider) => provider.id === providerId);
    if (oauthProvider) {
      await this.showLoginDialog(oauthProvider.id);
      return;
    }

    await this.promptForProviderApiKey(providerId, {
      title: `Set API key for ${providerId}`,
    });
  }

  async ensureProviderConfiguredForSelection(model: AnyModel): Promise<boolean> {
    if (isCustomProtocolProvider(model.provider)) {
      return this.configureCustomProtocolProvider(model.provider);
    }

    const hasKey = await this.ctx.modelRegistry.getApiKey(model);
    if (!hasKey && !this.ctx.modelRegistry.isUsingOAuth(model)) {
      return this.promptForProviderApiKey(model.provider, {
        title: `API key for ${model.provider}`,
      });
    }

    return true;
  }

  async handleProviderSelectionFromSelector(
    provider: string,
    done: () => void,
  ): Promise<void> {
    done();
    this.ctx.surface.requestRender();

    if (!isCustomProtocolProvider(provider)) {
      await this.showBuiltInProviderActions(provider);
      return;
    }

    try {
      const configured = await this.configureCustomProtocolProvider(provider, {
        force: true,
      });
      if (!configured) {
        this.ctx.surface.showStatus("Configuration cancelled");
        return;
      }

      await this.selectConfiguredCustomProvider(provider);
    } catch (error) {
      this.ctx.surface.showError(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Action menu after picking a built-in (non-custom-protocol) provider from the
   * provider selector: browse models or (re)configure the provider API key.
   * Gives built-in providers the same always-reachable credential entry that
   * custom protocol providers (e.g. Anthropic-compatible) have on selection.
   * Both paths continue into the model selector for that provider.
   */
  private async showBuiltInProviderActions(provider: string): Promise<void> {
    const authStorage = this.ctx.modelRegistry.authStorage;
    // OAuth-managed credentials are edited via /login, not the API-key prompt
    // (which would replace the OAuth token with an api_key entry).
    if (authStorage.get(provider)?.type === "oauth") {
      this.ctx.modelBridge.showModelSelector(undefined, provider);
      return;
    }

    const configured = authStorage.hasAuth(provider);
    const browseAction = "Browse models";
    const keyAction = configured ? "Update API key" : "Set API key";

    const choice = await this.ctx.surface.pickOption(provider, [
      browseAction,
      keyAction,
    ]);
    if (choice === undefined) {
      this.ctx.surface.requestRender();
      return;
    }

    if (choice === keyAction) {
      await this.promptForProviderApiKey(provider, {
        title: `${configured ? "Update" : "Set"} API key for ${provider}`,
      });
      this.ctx.modelRegistry.refresh();
    }

    this.ctx.modelBridge.showModelSelector(undefined, provider);
  }

  async showOAuthSelector(mode: "login" | "logout"): Promise<void> {
    const providers = this.getLoginSelectorProviders(mode);
    if (providers.length === 0) {
      this.ctx.surface.showStatus(
        mode === "login"
          ? "No providers available."
          : "No providers logged in. Use /login first.",
      );
      return;
    }

    this.ctx.surface.showSelector((done) => {
      const selector = new OAuthSelectorComponent(
        mode,
        providers,
        async (providerId: string) => {
          done();

          if (mode === "login") {
            const oauthProvider = getOAuthProviders().find(
              (p) => p.id === providerId,
            );
            if (oauthProvider) {
              await this.showLoginDialog(providerId);
            } else {
              await this.promptForProviderApiKey(providerId, {
                title: `Set API key for ${providerId}`,
              });
            }
          } else {
            const providerInfo = getOAuthProviders().find(
              (p) => p.id === providerId,
            );
            const providerName = providerInfo?.name || providerId;

            try {
              this.ctx.modelRegistry.authStorage.logout(providerId);
              this.ctx.modelRegistry.refresh();
              await this.ctx.modelBridge.updateAvailableProviderCount();
              this.ctx.surface.showStatus(`Logged out of ${providerName}`);
            } catch (error: unknown) {
              this.ctx.surface.showError(
                `Logout failed: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          }
        },
        () => {
          done();
          this.ctx.surface.requestRender();
        },
        {
          title:
            mode === "login"
              ? "Select provider to login or configure:"
              : "Select provider to logout:",
        },
      );
      return { component: selector, focus: selector };
    });
  }

  getLoginSelectorProviders(mode: "login" | "logout"): ProviderSelectorItem[] {
    const oauthProviders: ProviderSelectorItem[] = getOAuthProviders().map(
      (provider) => ({
        id: provider.id,
        name: provider.name,
        authType: "oauth",
        loggedIn:
          this.ctx.modelRegistry.authStorage.get(provider.id)?.type === "oauth",
      }),
    );

    if (mode === "logout") {
      return oauthProviders.filter((provider) => provider.loggedIn);
    }

    const items = [...oauthProviders];
    const providerIds = new Set(items.map((provider) => provider.id));
    const apiKeyProviders = [{ id: "openrouter", name: "OpenRouter" }];

    for (const provider of apiKeyProviders) {
      if (providerIds.has(provider.id)) continue;
      items.push({
        id: provider.id,
        name: provider.name,
        authType: "api_key",
        loggedIn: !!this.getStoredApiKey(provider.id),
      });
    }

    return items;
  }

  private getStoredApiKey(provider: string): string | undefined {
    const credential = this.ctx.modelRegistry.authStorage.get(provider);
    return credential?.type === "api_key" ? credential.key : undefined;
  }

  private resolveProviderId(input: string): string | undefined {
    const normalized = input.trim().toLowerCase();
    if (!normalized) return undefined;

    const providerMap = new Map<string, string>();
    for (const model of this.ctx.modelRegistry.getAll()) {
      providerMap.set(model.provider.toLowerCase(), model.provider);
    }
    for (const provider of getOAuthProviders()) {
      providerMap.set(provider.id.toLowerCase(), provider.id);
    }

    return providerMap.get(normalized);
  }

  async promptForProviderApiKey(
    provider: string,
    options: { title?: string } = {},
  ): Promise<boolean> {
    const currentApiKey = this.getStoredApiKey(provider);
    const title = options.title ?? `Update API key for ${provider}`;
    const apiKey = await this.ctx.surface.promptInput(title, "API key", {
      initialValue: currentApiKey,
    });
    if (apiKey === undefined) {
      this.ctx.surface.showStatus("Configuration cancelled");
      return false;
    }

    const trimmedApiKey = apiKey.trim();
    if (!trimmedApiKey) {
      this.ctx.surface.showStatus("Configuration cancelled");
      return false;
    }

    this.ctx.modelRegistry.authStorage.set(provider, {
      type: "api_key",
      key: trimmedApiKey,
    });
    if (provider === CATUI_ALI_TOKEN_PLAN_OPENAI_PROVIDER) {
      this.ctx.modelRegistry.authStorage.set(
        CATUI_ALI_TOKEN_PLAN_ANTHROPIC_PROVIDER,
        {
          type: "api_key",
          key: trimmedApiKey,
        },
      );
    } else if (provider === CATUI_ALI_TOKEN_PLAN_ANTHROPIC_PROVIDER) {
      this.ctx.modelRegistry.authStorage.set(
        CATUI_ALI_TOKEN_PLAN_OPENAI_PROVIDER,
        {
          type: "api_key",
          key: trimmedApiKey,
        },
      );
    }
    this.ctx.modelRegistry.refresh();
    this.ctx.surface.showStatus(`Updated API key for ${provider}`);
    return true;
  }

  private async handleProviderCredentialsCommand(): Promise<void> {
    const currentModel = this.ctx.modelBridge.getCurrentModel();

    if (!currentModel) {
      this.ctx.modelRegistry.refresh();
      const allModels = this.ctx.modelRegistry.getAll();
      const providers = [...new Set(allModels.map((m) => m.provider))].sort();
      if (providers.length === 0) {
        this.ctx.surface.showStatus("No providers available");
        return;
      }
      this.ctx.surface.showSelector((done) => {
        const selector = new ProviderSelectorComponent(
          providers,
          undefined,
          (provider) => {
            done();
            void (async () => {
              await this.promptForProviderApiKey(provider, {
                title: `Set API key for ${provider}`,
              });
              this.ctx.modelRegistry.refresh();
              this.ctx.modelBridge.showModelSelector(undefined, provider);
            })();
          },
          () => {
            done();
            this.ctx.surface.requestRender();
          },
        );
        return { component: selector, focus: selector };
      });
      return;
    }

    const provider = currentModel.provider;

    try {
      if (isCustomProtocolProvider(provider)) {
        const updated = await this.configureCustomProtocolProvider(provider, {
          force: true,
        });
        if (!updated) {
          this.ctx.surface.showStatus("Configuration cancelled");
        }
        return;
      }

      await this.promptForProviderApiKey(provider);
    } catch (error) {
      this.ctx.surface.showError(error instanceof Error ? error.message : String(error));
    }
  }

  private async configureCustomProtocolProvider(
    provider: CustomProtocolProviderId,
    options: { force?: boolean } = {},
  ): Promise<boolean> {
    const definition = getCustomProtocolProviderDefinition(provider);
    const modelsPath = getModelsPath();
    const authStorage = this.ctx.modelRegistry.authStorage;
    const currentBaseUrl =
      getCustomProtocolProviderBaseUrl(modelsPath, provider) ??
      definition.defaultBaseUrl;
    const currentModelName =
      getCustomProtocolProviderModelName(modelsPath, provider) ??
      "custom-model";
    const currentApiKey = this.getStoredApiKey(provider) ?? "";
    const hasExistingApiKey = authStorage.has(provider);
    const storedLimits = getCustomProtocolProviderModelLimits(modelsPath, provider);
    const defaultContextWindow = storedLimits.contextWindow ?? 256000;
    const defaultMaxTokens = storedLimits.maxTokens ?? 32768;

    if (
      !options.force &&
      hasExistingApiKey &&
      currentBaseUrl.trim() &&
      currentModelName.trim()
    ) {
      return true;
    }

    const baseUrl = await this.ctx.surface.promptInput(
      `${definition.label} base URL`,
      definition.defaultBaseUrl,
      { initialValue: currentBaseUrl },
    );
    if (baseUrl === undefined) {
      return false;
    }

    const trimmedBaseUrl = baseUrl.trim();
    if (!trimmedBaseUrl) {
      this.ctx.surface.showError("Base URL cannot be empty.");
      return false;
    }

    const apiKeyInput = await this.ctx.surface.promptInput(
      `${definition.label} API key`,
      hasExistingApiKey && options.force
        ? "Leave empty to keep the current API key"
        : "API key",
      { initialValue: currentApiKey },
    );
    if (apiKeyInput === undefined) {
      return false;
    }

    const trimmedApiKey = apiKeyInput.trim();
    if (!trimmedApiKey && !hasExistingApiKey) {
      this.ctx.surface.showError("API key cannot be empty.");
      return false;
    }

    const modelNameInput = await this.ctx.surface.promptInput(
      `${definition.label} model name`,
      "Model name",
      { initialValue: currentModelName },
    );
    if (modelNameInput === undefined) {
      return false;
    }

    const trimmedModelName = modelNameInput.trim();
    if (!trimmedModelName) {
      this.ctx.surface.showError("Model name cannot be empty.");
      return false;
    }

    const contextWindowInput = await this.ctx.surface.promptInput(
      `${definition.label} context window (tokens)`,
      String(defaultContextWindow),
      { initialValue: String(defaultContextWindow) },
    );
    if (contextWindowInput === undefined) {
      return false;
    }
    const contextWindow = parsePositiveInteger(
      contextWindowInput,
      "Context window",
    );
    if (contextWindow === null) {
      this.ctx.surface.showError(
        "Context window must be a positive integer (e.g. 200000).",
      );
      return false;
    }

    const maxTokensInput = await this.ctx.surface.promptInput(
      `${definition.label} max output tokens`,
      String(defaultMaxTokens),
      { initialValue: String(defaultMaxTokens) },
    );
    if (maxTokensInput === undefined) {
      return false;
    }
    const maxTokens = parsePositiveInteger(maxTokensInput, "Max output tokens");
    if (maxTokens === null) {
      this.ctx.surface.showError(
        "Max output tokens must be a positive integer (e.g. 32768).",
      );
      return false;
    }

    if (maxTokens >= contextWindow) {
      this.ctx.surface.showError(
        "Max output tokens must be smaller than context window.",
      );
      return false;
    }

    const saved = await saveCustomProtocolProviderConfig(modelsPath, provider, {
      baseUrl: trimmedBaseUrl,
      modelName: trimmedModelName,
      apiKey: trimmedApiKey || undefined,
      overrides: { contextWindow, maxTokens },
    });
    if (trimmedApiKey) {
      saveCustomProtocolProviderApiKey(authStorage, provider, trimmedApiKey);
    }

    this.ctx.modelRegistry.refresh();
    await this.refreshCurrentModelForProvider(provider, trimmedModelName);
    const ctxK = contextWindow >= 1000
      ? `${Math.round(contextWindow / 1000)}k`
      : String(contextWindow);
    const maxK = maxTokens >= 1000
      ? `${Math.round(maxTokens / 1000)}k`
      : String(maxTokens);
    this.ctx.surface.showStatus(
      `Saved ${definition.label} configuration (context: ${ctxK}, max output: ${maxK})`,
    );
    return true;
  }

  private async refreshCurrentModelForProvider(
    provider: string,
    preferredModelId?: string,
  ): Promise<void> {
    const currentModel = this.ctx.modelBridge.getCurrentModel();
    if (!currentModel || currentModel.provider !== provider) {
      return;
    }

    const updatedModel =
      (preferredModelId
        ? this.ctx.modelRegistry.find(currentModel.provider, preferredModelId)
        : undefined) ??
      this.ctx.modelRegistry.find(currentModel.provider, currentModel.id);
    if (!updatedModel) {
      return;
    }

    await this.ctx.modelBridge.setCurrentModel(updatedModel);
  }

  private async selectConfiguredCustomProvider(
    provider: CustomProtocolProviderId,
  ): Promise<void> {
    this.ctx.modelRegistry.refresh();
    const modelName = getCustomProtocolProviderModelName(getModelsPath(), provider);
    if (!modelName) {
      this.ctx.surface.showError(`No model configured for ${provider}`);
      return;
    }

    const model = this.ctx.modelRegistry.find(provider, modelName);
    if (!model) {
      this.ctx.surface.showError(`Configured model not found for ${provider}`);
      return;
    }

    await this.ctx.modelBridge.applySelectedModel(model);
  }

  private async showLoginDialog(providerId: string): Promise<void> {
    const providerInfo = getOAuthProviders().find((p) => p.id === providerId);
    const providerName = providerInfo?.name || providerId;
    const usesCallbackServer = providerInfo?.usesCallbackServer ?? false;

    const dialog = new LoginDialogComponent(
      this.ctx.surface.getUi(),
      providerId,
      (_success, _message) => {
        // Completion handled below.
      },
    );

    const editorContainer = this.ctx.surface.getEditorContainer();
    editorContainer.clear();
    editorContainer.addChild(dialog);
    this.ctx.surface.getUi().setFocus(dialog);
    this.ctx.surface.requestRender();

    let manualCodeResolve: ((code: string) => void) | undefined;
    let manualCodeReject: ((err: Error) => void) | undefined;
    const manualCodePromise = new Promise<string>((resolve, reject) => {
      manualCodeResolve = resolve;
      manualCodeReject = reject;
    });

    const restoreEditor = () => {
      this.ctx.surface.remountEditorShell();
      this.ctx.surface.getUi().setFocus(this.ctx.surface.getEditor());
      this.ctx.surface.requestRender();
    };

    try {
      await this.ctx.modelRegistry.authStorage.login(
        providerId as OAuthProvider,
        {
          onAuth: (info: { url: string; instructions?: string }) => {
            dialog.showAuth(info.url, info.instructions);

            if (usesCallbackServer) {
              dialog
                .showManualInput(
                  "Paste redirect URL below, or complete login in browser:",
                )
                .then((value) => {
                  if (value && manualCodeResolve) {
                    manualCodeResolve(value);
                    manualCodeResolve = undefined;
                  }
                })
                .catch(() => {
                  if (manualCodeReject) {
                    manualCodeReject(new Error("Login cancelled"));
                    manualCodeReject = undefined;
                  }
                });
            } else if (providerId === "github-copilot") {
              dialog.showWaiting("Waiting for browser authentication...");
            }
          },

          onPrompt: async (prompt: {
            message: string;
            placeholder?: string;
          }) => {
            return dialog.showPrompt(prompt.message, prompt.placeholder);
          },

          onProgress: (message: string) => {
            dialog.showProgress(message);
          },

          onManualCodeInput: () => manualCodePromise,

          signal: dialog.signal,
        },
      );

      restoreEditor();
      this.ctx.modelRegistry.refresh();
      await this.ctx.modelBridge.updateAvailableProviderCount();
      this.ctx.surface.showStatus(
        `Logged in to ${providerName}. Credentials saved to ${getAuthPath()}`,
      );
    } catch (error: unknown) {
      restoreEditor();
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (errorMsg !== "Login cancelled") {
        this.ctx.surface.showError(`Failed to login to ${providerName}: ${errorMsg}`);
      }
    }
  }
}

function parsePositiveInteger(
  input: string,
  label: string,
): number | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}
