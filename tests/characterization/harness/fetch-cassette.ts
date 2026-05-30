/**
 * [WHO]: Provides installCassette() — record/replay global.fetch for deterministic model I/O
 * [FROM]: Depends on node:fs (cassette persistence); wraps global.fetch
 * [TO]: Consumed by harness/run-case.ts
 * [HERE]: tests/characterization/harness/fetch-cassette.ts — VCR over the HTTP boundary
 *
 * Strategy: the ai package reaches every provider through global.fetch. We intercept it.
 *   - record: call the real fetch, buffer the response bytes, append to the cassette in
 *     call order (only for the model host), return a reconstructed Response to the caller.
 *   - replay: return the Nth recorded response for the Nth model-host call; 404 everything
 *     else (telemetry noops in a sandbox agent dir with no credentials).
 * Recording raw bytes means we never hand-author SSE and survive provider format changes.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";

interface RecordedResponse {
  status: number;
  headers: Record<string, string>;
  /** base64 of the full response body (SSE stream buffered). */
  bodyBase64: string;
}

const KEEP_HEADERS = ["content-type", "x-request-id"];

function headerHost(input: string | URL | Request): string {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

function pickHeaders(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of KEEP_HEADERS) {
    const v = res.headers.get(k);
    if (v) out[k] = v;
  }
  return out;
}

export interface CassetteHandle {
  /** Restore the original global.fetch and (in record mode) flush the cassette to disk. */
  restore(): void;
}

/**
 * @param cassettePath  cases/<name>/cassette.json
 * @param modelHosts    hosts whose calls are model traffic (recorded/replayed); e.g. ["api.openai.com"]
 * @param record        true → record from real fetch; false → replay from disk
 */
export function installCassette(cassettePath: string, modelHosts: string[], record: boolean): CassetteHandle {
  const original = global.fetch;
  const hosts = new Set(modelHosts);

  if (record) {
    const recorded: RecordedResponse[] = [];
    global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const res = await original(input as Parameters<typeof original>[0], init);
      if (!hosts.has(headerHost(input))) return res;
      const buf = Buffer.from(await res.arrayBuffer());
      recorded.push({ status: res.status, headers: pickHeaders(res), bodyBase64: buf.toString("base64") });
      return new Response(buf, { status: res.status, headers: res.headers });
    }) as typeof fetch;

    return {
      restore() {
        global.fetch = original;
        writeFileSync(cassettePath, JSON.stringify(recorded, null, 2) + "\n", "utf8");
      },
    };
  }

  // replay
  if (!existsSync(cassettePath)) {
    throw new Error(`characterization: missing cassette ${cassettePath}; run RECORD=1 on main first`);
  }
  const recorded = JSON.parse(readFileSync(cassettePath, "utf8")) as RecordedResponse[];
  if (recorded.length === 0) {
    throw new Error(`characterization: empty cassette ${cassettePath}; re-run RECORD=1 on main`);
  }
  let i = 0;
  global.fetch = (async (input: string | URL | Request) => {
    if (!hosts.has(headerHost(input))) {
      return new Response("characterization: unexpected host (not in cassette)", { status: 404 });
    }
    const entry = recorded[i++];
    if (!entry) {
      return new Response("characterization: cassette exhausted", { status: 500 });
    }
    return new Response(Buffer.from(entry.bodyBase64, "base64"), { status: entry.status, headers: entry.headers });
  }) as typeof fetch;

  return {
    restore() {
      global.fetch = original;
    },
  };
}
