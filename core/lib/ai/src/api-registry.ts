/**
 * [WHO]: ApiProvider, registerApiProvider, registerApiProviderLoader, getApiProvider, ensureApiProvider, reset helpers
 * [FROM]: Depends on core AI stream/model types for provider contracts
 * [TO]: Consumed by core/lib/ai/src/stream.ts and providers/register-builtins.ts for provider dispatch
 * [HERE]: core/lib/ai/src/api-registry.ts - provider registry plus runtime lazy-loader registry
 */

import type {
	Api,
	AssistantMessage,
	AssistantMessageEventStreamContract,
	Context,
	Model,
	SimpleStreamOptions,
	StreamFunction,
	StreamOptions,
	Usage,
} from "./types.js";
import { AssistantMessageEventStream } from "./utils/event-stream.js";

export type ApiStreamFunction = (
	model: Model<Api>,
	context: Context,
	options?: StreamOptions,
) => AssistantMessageEventStreamContract;

export type ApiStreamSimpleFunction = (
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
) => AssistantMessageEventStreamContract;

export interface ApiProvider<TApi extends Api = Api, TOptions extends StreamOptions = StreamOptions> {
	api: TApi;
	stream: StreamFunction<TApi, TOptions>;
	streamSimple: StreamFunction<TApi, SimpleStreamOptions>;
}

export interface ApiProviderInternal {
	api: Api;
	stream: ApiStreamFunction;
	streamSimple: ApiStreamSimpleFunction;
}

export type ApiProviderLoader<TApi extends Api = Api, TOptions extends StreamOptions = StreamOptions> = () => Promise<
	ApiProvider<TApi, TOptions>
>;

type ErasedApiProvider = ApiProvider<any, any>;
type ErasedApiProviderLoader = () => Promise<ErasedApiProvider>;

type RegisteredApiProvider = {
	provider: ApiProviderInternal;
	sourceId?: string;
	lazy?: boolean;
};

type RegisteredApiProviderLoader = {
	loader: ErasedApiProviderLoader;
	sourceId?: string;
	pending?: Promise<ApiProviderInternal | undefined>;
};

const apiProviderRegistry = new Map<string, RegisteredApiProvider>();
const apiProviderLoaders = new Map<string, RegisteredApiProviderLoader>();

function wrapStream<TApi extends Api, TOptions extends StreamOptions>(
	api: TApi,
	stream: StreamFunction<TApi, TOptions>,
): ApiStreamFunction {
	return (model, context, options) => {
		if (model.api !== api) {
			throw new Error(`Mismatched api: ${model.api} expected ${api}`);
		}
		return stream(model as Model<TApi>, context, options as TOptions);
	};
}

function wrapStreamSimple<TApi extends Api>(
	api: TApi,
	streamSimple: StreamFunction<TApi, SimpleStreamOptions>,
): ApiStreamSimpleFunction {
	return (model, context, options) => {
		if (model.api !== api) {
			throw new Error(`Mismatched api: ${model.api} expected ${api}`);
		}
		return streamSimple(model as Model<TApi>, context, options);
	};
}

function emptyUsage(): Usage {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	return JSON.stringify(error) ?? String(error);
}

function createProviderLoadErrorMessage<TApi extends Api>(
	model: Pick<Model<TApi>, "api" | "provider" | "id">,
	error: unknown,
): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		stopReason: "error",
		errorMessage: getErrorMessage(error),
		usage: emptyUsage(),
		timestamp: Date.now(),
	};
}

function createMissingProviderResultMessage<TApi extends Api>(
	model: Pick<Model<TApi>, "api" | "provider" | "id">,
): AssistantMessage {
	return createProviderLoadErrorMessage(model, new Error("Provider stream ended without a final assistant message"));
}

function createLazyProvider(api: Api): ApiProviderInternal {
	return {
		api,
		stream: (model, context, options) => {
			const stream = new AssistantMessageEventStream();
			void pipeLazyProviderStream(api, model, context, options, stream, "stream");
			return stream;
		},
		streamSimple: (model, context, options) => {
			const stream = new AssistantMessageEventStream();
			void pipeLazyProviderStream(api, model, context, options, stream, "streamSimple");
			return stream;
		},
	};
}

async function pipeLazyProviderStream(
	api: Api,
	model: Model<Api>,
	context: Context,
	options: StreamOptions | SimpleStreamOptions | undefined,
	output: AssistantMessageEventStream,
	method: "stream" | "streamSimple",
): Promise<void> {
	try {
		const provider = await ensureApiProvider(api);
		if (!provider) {
			throw new Error(`No API provider registered for api: ${api}`);
		}
		const source =
			method === "stream"
				? provider.stream(model, context, options as StreamOptions)
				: provider.streamSimple(model, context, options as SimpleStreamOptions);
		for await (const event of source) {
			output.push(event);
		}
		if (!source.resultIfResolved()) {
			output.push({ type: "error", reason: "error", error: createMissingProviderResultMessage(model) });
		}
	} catch (error) {
		output.push({ type: "error", reason: "error", error: createProviderLoadErrorMessage(model, error) });
	}
}

export function registerApiProvider<TApi extends Api, TOptions extends StreamOptions>(
	provider: ApiProvider<TApi, TOptions>,
	sourceId?: string,
): void {
	apiProviderRegistry.set(provider.api, {
		provider: {
			api: provider.api,
			stream: wrapStream(provider.api, provider.stream),
			streamSimple: wrapStreamSimple(provider.api, provider.streamSimple),
		},
		sourceId,
	});
}

export function registerApiProviderLoader<TApi extends Api, TOptions extends StreamOptions>(
	api: TApi,
	loader: ApiProviderLoader<TApi, TOptions>,
	sourceId?: string,
): void {
	apiProviderLoaders.set(api, { loader, sourceId });
	apiProviderRegistry.set(api, {
		provider: createLazyProvider(api),
		sourceId,
		lazy: true,
	});
}

export function getApiProvider(api: Api): ApiProviderInternal | undefined {
	return apiProviderRegistry.get(api)?.provider;
}

export async function ensureApiProvider(api: Api): Promise<ApiProviderInternal | undefined> {
	const entry = apiProviderRegistry.get(api);
	if (entry && !entry.lazy) return entry.provider;

	const loader = apiProviderLoaders.get(api);
	if (!loader) return entry?.provider;

	loader.pending ??= loader
		.loader()
		.then((provider) => {
			registerApiProvider(provider, loader.sourceId);
			return getApiProvider(api);
		})
		.finally(() => {
			loader.pending = undefined;
		});
	await loader.pending;

	return getApiProvider(api);
}

export function getApiProviders(): ApiProviderInternal[] {
	return Array.from(apiProviderRegistry.values(), (entry) => entry.provider);
}

export function unregisterApiProviders(sourceId: string): void {
	for (const [api, entry] of apiProviderRegistry.entries()) {
		if (entry.sourceId === sourceId) {
			apiProviderRegistry.delete(api);
		}
	}
	for (const [api, entry] of apiProviderLoaders.entries()) {
		if (entry.sourceId === sourceId) {
			apiProviderLoaders.delete(api);
		}
	}
}

export function clearApiProviders(): void {
	apiProviderRegistry.clear();
	apiProviderLoaders.clear();
}
