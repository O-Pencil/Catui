/**
 * [WHO]: Reads optional FreeToken KV capacity and tokenizes fixed request content
 * [FROM]: Depends on fetch/AbortSignal and ai Context tool contracts
 * [TO]: Consumed by discovery.ts and runtime/local-model-budget.ts
 * [HERE]: core/model/freetoken-capacity.ts - deployment metadata adapter
 */
import type { Context } from "@catui/ai/types";

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** Return allocated tokens only for a ready deployment with valid cache geometry. */
export async function readFreeTokenCapacity(
  baseUrl: string,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<number | undefined> {
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/cache/status`, { headers, signal });
    if (!response.ok) return undefined;
    const data = await response.json() as {
      state?: unknown; geometry?: { num_pages?: unknown; page_size?: unknown };
    };
    const pages = data?.geometry?.num_pages;
    const size = data?.geometry?.page_size;
    if (data?.state !== "serving" || !positiveInteger(pages) || !positiveInteger(size)) return undefined;
    const capacity = pages * size;
    return positiveInteger(capacity) ? capacity : undefined;
  } catch {
    return undefined;
  }
}

/** Optional server tokenizer; includes minimal user-message overhead, never history. */
export async function countFreeTokenFixedTokens(
  baseUrl: string,
  model: string,
  context: Pick<Context, "systemPrompt" | "tools">,
  apiKey?: string,
  signal?: AbortSignal,
): Promise<number | undefined> {
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/messages/count_tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(3000)]) : AbortSignal.timeout(3000),
      body: JSON.stringify({
        model,
        system: context.systemPrompt ?? "",
        messages: [{ role: "user", content: "hi" }],
        tools: context.tools?.map((tool) => ({
          name: tool.name, description: tool.description, input_schema: tool.parameters,
        })),
      }),
    });
    if (!response.ok) return undefined;
    const data = await response.json() as { input_tokens?: unknown };
    return positiveInteger(data?.input_tokens) ? data.input_tokens : undefined;
  } catch {
    return undefined;
  }
}
